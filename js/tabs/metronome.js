// メトロノームタブ: Web Audio 先読みスケジューリング（ズレない）＋タップテンポ＋
// 拍ごとのアクセント編集＋刻み（4分/8分/3連/16分）＋音色3種＋スピードトレーナー

import { getCtx, resumeCtx } from '../audio-engine.js';
import {
  tapTempo, trainerNextBpm, defaultBeatStates, cycleBeatState, ticksPerBar, tickKind, adaptiveAhead,
} from '../metronome-core.js';

const SUBDIVS = [
  { v: 1, label: '♩ 4分' },
  { v: 2, label: '♫ 8分' },
  { v: 3, label: '3連' },
  { v: 4, label: '♬ 16分' },
];
const VARIANTS = [
  { v: 'wood', label: 'ウッド' },
  { v: 'click', label: 'クリック' },
  { v: 'beep', label: 'ビープ' },
];

let panel;
let bpm = 100;
let beats = 4;
let subdiv = 1;
let variant = 'wood';
let vol = 0.7;
let beatStates = defaultBeatStates(4);
let trainer = { on: false, inc: 2, every: 4, max: 160 };
let run = null; // { timer, nextTime, tick, bar, queue, raf }
let taps = [];
let noiseBuf = null;

export function init(el) {
  panel = el;
  loadSettings();
  panel.innerHTML = `
    <div class="card" style="text-align:center">
      <div class="metro-bpm"><span id="mt-bpm">${bpm}</span><span style="font-size:20px; color:var(--text-dim)"> BPM</span></div>
      <div class="row" style="justify-content:center">
        <button class="btn small" data-d="-5">−5</button>
        <button class="btn small" data-d="-1">−1</button>
        <input type="range" id="mt-slider" min="30" max="260" value="${bpm}" style="flex:1; max-width:280px">
        <button class="btn small" data-d="1">＋1</button>
        <button class="btn small" data-d="5">＋5</button>
      </div>
      <div class="row" style="justify-content:center; margin-top:12px">
        <button class="btn" id="mt-tap" style="min-width:110px">👆 タップ</button>
        <button class="btn primary" id="mt-start" style="min-width:150px; font-size:16px">▶ スタート</button>
      </div>
      <div class="metro-dots" id="mt-dots"></div>
      <p class="hint">●をタップで アクセント（オレンジ）→ 普通 → ミュート を切替。小節: <span id="mt-bar">0</span></p>
    </div>
    <div class="card">
      <div class="row">
        <label>拍子
          <select id="mt-beats">${[1,2,3,4,5,6,7,8].map((n) => `<option value="${n}" ${n === beats ? 'selected' : ''}>${n}拍子</option>`).join('')}</select>
        </label>
        <label>刻み</label>
        ${SUBDIVS.map((s) => `<span class="chip ${s.v === subdiv ? 'active' : ''}" data-subdiv="${s.v}">${s.label}</span>`).join('')}
      </div>
      <div class="row">
        <label>音色</label>
        ${VARIANTS.map((s) => `<span class="chip ${s.v === variant ? 'active' : ''}" data-variant="${s.v}">${s.label}</span>`).join('')}
        <label style="margin-left:8px">音量</label>
        <input type="range" id="mt-vol" min="0" max="100" value="${Math.round(vol * 100)}" style="flex:1; min-width:100px">
      </div>
    </div>
    <div class="card">
      <div class="row">
        <label><input type="checkbox" id="mt-tr-on" ${trainer.on ? 'checked' : ''}> 🏃 スピードトレーナー</label>
        <label>＋<input type="number" id="mt-tr-inc" value="${trainer.inc}" min="1" max="20" style="width:60px"> BPM</label>
        <label><input type="number" id="mt-tr-every" value="${trainer.every}" min="1" max="32" style="width:60px"> 小節ごと</label>
        <label>上限 <input type="number" id="mt-tr-max" value="${trainer.max}" min="40" max="260" style="width:70px"></label>
      </div>
      <p class="hint">ゆっくり始めて自動でテンポアップ。速いフレーズの練習の王道です（例: 80から4小節ごとに＋2、上限140）</p>
    </div>
  `;

  const $ = (s) => panel.querySelector(s);
  panel.querySelectorAll('button[data-d]').forEach((b) =>
    b.addEventListener('click', () => setBpm(bpm + Number(b.dataset.d)))
  );
  $('#mt-slider').addEventListener('input', (e) => setBpm(Number(e.target.value)));
  $('#mt-tap').addEventListener('click', onTap);
  $('#mt-start').addEventListener('click', toggle);
  $('#mt-beats').addEventListener('change', (e) => {
    beats = Number(e.target.value);
    const old = beatStates;
    beatStates = defaultBeatStates(beats).map((d, i) => old[i] ?? d);
    buildDots();
    saveSettings();
  });
  panel.querySelectorAll('.chip[data-subdiv]').forEach((c) =>
    c.addEventListener('click', () => {
      subdiv = Number(c.dataset.subdiv);
      panel.querySelectorAll('.chip[data-subdiv]').forEach((x) => x.classList.toggle('active', x === c));
      saveSettings();
    })
  );
  panel.querySelectorAll('.chip[data-variant]').forEach((c) =>
    c.addEventListener('click', () => {
      variant = c.dataset.variant;
      panel.querySelectorAll('.chip[data-variant]').forEach((x) => x.classList.toggle('active', x === c));
      // 試し鳴らし
      resumeCtx().then(() => playClick(getCtx().currentTime + 0.02, 'accent'));
      saveSettings();
    })
  );
  $('#mt-vol').addEventListener('input', (e) => { vol = Number(e.target.value) / 100; saveSettings(); });
  $('#mt-tr-on').addEventListener('change', (e) => { trainer.on = e.target.checked; saveSettings(); });
  for (const k of ['inc', 'every', 'max']) {
    $(`#mt-tr-${k}`).addEventListener('change', (e) => { trainer[k] = Number(e.target.value); saveSettings(); });
  }
  document.addEventListener('keydown', onKey);
  buildDots();
}

function onKey(e) {
  if (panel.hidden || e.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  e.preventDefault();
  toggle();
}

function setBpm(v) {
  bpm = Math.min(260, Math.max(30, Math.round(v)));
  panel.querySelector('#mt-bpm').textContent = bpm;
  panel.querySelector('#mt-slider').value = bpm;
  saveSettings();
}

function onTap() {
  taps.push(performance.now());
  if (taps.length > 8) taps.shift();
  const t = tapTempo(taps);
  if (t) setBpm(t);
  resumeCtx().then(() => playClick(getCtx().currentTime + 0.01, 'beat'));
}

// ---- ドット（拍の表示とアクセント編集）----

function buildDots() {
  const wrap = panel.querySelector('#mt-dots');
  wrap.innerHTML = beatStates
    .map((s, i) => `<button class="metro-dot ${s}" data-i="${i}" aria-label="拍${i + 1}"></button>`)
    .join('');
  wrap.querySelectorAll('.metro-dot').forEach((d) =>
    d.addEventListener('click', () => {
      const i = Number(d.dataset.i);
      beatStates[i] = cycleBeatState(beatStates[i]);
      d.className = `metro-dot ${beatStates[i]}`;
      saveSettings();
    })
  );
}

// ---- サウンド ----

function getNoise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function playClick(t, sound) {
  const ctx = getCtx();
  const v = vol * (sound === 'accent' ? 1 : sound === 'beat' ? 0.72 : 0.38);
  if (v < 0.005) return;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (sound === 'accent' ? 0.09 : 0.055));
  g.connect(ctx.destination);

  if (variant === 'click') {
    const src = ctx.createBufferSource();
    src.buffer = getNoise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = sound === 'accent' ? 4200 : sound === 'beat' ? 3200 : 2400;
    bp.Q.value = 1.2;
    src.connect(bp);
    bp.connect(g);
    src.start(t);
    src.stop(t + 0.06);
  } else {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = sound === 'accent' ? 1760 : sound === 'beat' ? 1320 : 990;
    osc.frequency.setValueAtTime(f0, t);
    if (variant === 'wood') osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.025);
    osc.connect(g);
    osc.start(t);
    osc.stop(t + 0.12);
  }
}

// ---- スケジューラ（先読み方式: タイマーはきっかけ、時刻は AudioContext が正）----
// タブが背面に回るとタイマーは1秒に絞られるため、呼び出し間隔を実測して先読み幅を自動拡大する

const LOOKAHEAD_MS = 25;

async function toggle() {
  if (run) { stop(); return; }
  await resumeCtx();
  const ctx = getCtx();
  run = {
    nextTime: ctx.currentTime + 0.08,
    tick: 0,
    bar: 0,
    queue: [],
    lastRun: 0,
    timer: setInterval(scheduler, LOOKAHEAD_MS),
    raf: 0,
  };
  panel.querySelector('#mt-start').textContent = '⏹ ストップ';
  panel.querySelector('#mt-bar').textContent = '1';
  document.addEventListener('visibilitychange', scheduler);
  visualLoop();
}

function scheduler() {
  if (!run) return;
  const ctx = getCtx();
  const nowMs = performance.now();
  const gap = run.lastRun ? (nowMs - run.lastRun) / 1000 : LOOKAHEAD_MS / 1000;
  run.lastRun = nowMs;
  const ahead = adaptiveAhead(gap);
  while (run.nextTime < ctx.currentTime + ahead) {
    const k = tickKind(run.tick, beats, subdiv, beatStates);
    if (k.sound !== 'mute') playClick(run.nextTime, k.sound);
    if (k.isBeat) run.queue.push({ t: run.nextTime, beatIdx: k.beatIdx, bar: run.bar });
    // 進める
    run.tick++;
    if (run.tick >= ticksPerBar(beats, subdiv)) {
      run.tick = 0;
      run.bar++;
      if (trainer.on) {
        const nb = trainerNextBpm(bpm, trainer, run.bar);
        if (nb !== bpm) setBpm(nb);
      }
    }
    run.nextTime += 60 / bpm / subdiv;
  }
}

function visualLoop() {
  if (!run) return;
  run.raf = requestAnimationFrame(visualLoop);
  const now = getCtx().currentTime;
  let ev = null;
  while (run.queue.length && run.queue[0].t <= now) ev = run.queue.shift();
  if (ev) {
    panel.querySelectorAll('.metro-dot').forEach((d, i) => d.classList.toggle('now', i === ev.beatIdx));
    panel.querySelector('#mt-bar').textContent = ev.bar + 1;
  }
}

function stop() {
  if (!run) return;
  clearInterval(run.timer);
  cancelAnimationFrame(run.raf);
  document.removeEventListener('visibilitychange', scheduler);
  run = null;
  panel.querySelector('#mt-start').textContent = '▶ スタート';
  panel.querySelectorAll('.metro-dot').forEach((d) => d.classList.remove('now'));
}

// ---- 設定の保存 ----

function saveSettings() {
  localStorage.setItem('ms-metronome', JSON.stringify({ bpm, beats, subdiv, variant, vol, beatStates, trainer }));
}

function loadSettings() {
  try {
    const d = JSON.parse(localStorage.getItem('ms-metronome'));
    if (!d) return;
    bpm = d.bpm ?? bpm;
    beats = d.beats ?? beats;
    subdiv = d.subdiv ?? subdiv;
    variant = d.variant ?? variant;
    vol = d.vol ?? vol;
    trainer = { ...trainer, ...(d.trainer || {}) };
    beatStates = Array.isArray(d.beatStates) && d.beatStates.length === beats ? d.beatStates : defaultBeatStates(beats);
  } catch { /* 初回 */ }
}

export function deactivate() {
  stop();
}
