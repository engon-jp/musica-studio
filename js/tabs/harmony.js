// ハモリタブ: メロディからダイアトニックハモリを自動生成・ピアノロール編集・再生・MIDI書き出し

import { getCtx, resumeCtx, startMic, stopMic, micActive } from '../audio-engine.js';
import { detectPitch, framesToNotes } from '../pitch.js';
import {
  estimateKeyFromNotes, keyName, pcName, midiToName,
  generateHarmony, HARMONY_PRESETS, SHARP_NAMES,
} from '../theory.js';
import { voiceMidi } from '../synth.js';
import { buildMidi } from '../midi.js';
import { renderStaffSVG } from '../staff.js';

const HLINES = [
  { key: 'third-up', color: '#3ecf8e' },
  { key: 'third-down', color: '#ffd166' },
  { key: 'sixth-up', color: '#ff8fa3' },
  { key: 'octave-down', color: '#b58cff' },
];

let panel;
let melody = []; // [{midi, start(拍), dur(拍)}]
let harmonies = {}; // key → notes
let activeLines = new Set(['third-up']);
let bpm = 120;
let grid = 0.25; // 拍（1/16音符）
let keyAuto = true;
let keyEst = { tonic: 0, mode: 'major' };
let importMeta = null; // 耳コピから来た場合 {offset}
let playState = null;
let playNodes = [];
let rafId = null;
let view = 'roll'; // 'roll' | 'staff'
// マイク入力
let micRec = null;

export function init(el) {
  panel = el;
  panel.innerHTML = `
    <div class="card">
      <div class="row">
        <button class="btn" id="hm-mic">🎙 歌って入力</button>
        <button class="btn" id="hm-demo">🎁 デモ（きらきら星）</button>
        <button class="btn small" id="hm-clear">クリア</button>
        <label>BPM <input type="number" id="hm-bpm" value="120" min="40" max="240"></label>
        <label>グリッド
          <select id="hm-grid">
            <option value="0.25">1/16</option>
            <option value="0.5">1/8</option>
            <option value="1">1/4</option>
          </select>
        </label>
        <span class="hint" id="hm-status">耳コピタブから送るか、🎙で歌うか、ロールをタップして入力</span>
      </div>
      <div class="row" id="hm-mic-live" style="display:none">
        <span style="font-size:28px; font-weight:800" id="hm-mic-note">–</span>
        <span class="hint">歌い終わったらもう一度ボタンを押して確定</span>
      </div>
    </div>
    <div class="card">
      <div class="row">
        <label>キー</label>
        <span id="hm-key-est" style="font-weight:700"></span>
        <select id="hm-key-tonic">${SHARP_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select>
        <select id="hm-key-mode"><option value="major">メジャー</option><option value="minor">マイナー</option></select>
        <button class="btn small" id="hm-key-auto">自動推定に戻す</button>
      </div>
      <div class="row" id="hm-lines">
        ${HLINES.map((h) => `<label style="color:${h.color}"><input type="checkbox" data-line="${h.key}" ${activeLines.has(h.key) ? 'checked' : ''}> ${HARMONY_PRESETS[h.key].label}</label>`).join('')}
      </div>
      <div class="row voice-mixer">
        <span class="voice-label">メロディ音量</span>
        <input type="range" id="hm-vol-mel" min="0" max="100" value="60" style="flex:1">
        <span class="voice-label">ハモリ音量</span>
        <input type="range" id="hm-vol-harm" min="0" max="100" value="55" style="flex:1">
      </div>
    </div>
    <div class="card">
      <div class="row no-print">
        <button class="btn primary" id="hm-play">▶ 再生</button>
        <button class="btn" id="hm-play-orig" disabled>▶ 原曲と同時再生</button>
        <button class="btn" id="hm-midi">💾 MIDI書き出し</button>
        <span class="hint" id="hm-info"></span>
      </div>
      <div class="row no-print" style="margin-top:10px">
        <span class="chip active" data-view="roll">🎹 ピアノロール</span>
        <span class="chip" data-view="staff">🎼 五線譜</span>
      </div>
      <div class="tab-grid-wrap" id="hm-roll-wrap" style="margin-top:8px; overflow-x:auto">
        <canvas class="piano-roll" id="hm-roll"></canvas>
      </div>
      <div class="tab-grid-wrap" id="hm-staff-wrap" style="margin-top:8px; overflow-x:auto; display:none; background:var(--bg-panel); border-radius:12px; padding:6px 2px"></div>
      <p class="hint" id="hm-edit-hint">タップ＝音の追加／音の上をタップ＝削除（メロディのみ編集可。ハモリは自動追従）</p>
    </div>
  `;

  const $ = (s) => panel.querySelector(s);
  $('#hm-mic').addEventListener('click', toggleMicInput);
  $('#hm-demo').addEventListener('click', loadDemoMelody);
  $('#hm-clear').addEventListener('click', () => { melody = []; importMeta = null; refresh(); });
  $('#hm-bpm').addEventListener('change', (e) => { bpm = Number(e.target.value) || 120; });
  $('#hm-grid').addEventListener('change', (e) => { grid = Number(e.target.value); });
  $('#hm-key-tonic').addEventListener('change', () => { keyAuto = false; readKeySelects(); refresh(); });
  $('#hm-key-mode').addEventListener('change', () => { keyAuto = false; readKeySelects(); refresh(); });
  $('#hm-key-auto').addEventListener('click', () => { keyAuto = true; refresh(); });
  panel.querySelectorAll('input[data-line]').forEach((cb) =>
    cb.addEventListener('change', () => {
      cb.checked ? activeLines.add(cb.dataset.line) : activeLines.delete(cb.dataset.line);
      refresh();
    })
  );
  panel.querySelectorAll('.chip[data-view]').forEach((c) =>
    c.addEventListener('click', () => {
      view = c.dataset.view;
      panel.querySelectorAll('.chip[data-view]').forEach((x) => x.classList.toggle('active', x === c));
      $('#hm-roll-wrap').style.display = view === 'roll' ? '' : 'none';
      $('#hm-staff-wrap').style.display = view === 'staff' ? '' : 'none';
      $('#hm-edit-hint').textContent = view === 'roll'
        ? 'タップ＝音の追加／音の上をタップ＝削除（メロディのみ編集可。ハモリは自動追従）'
        : '五線譜は表示専用（編集はピアノロールで）。音符の色＝上のチェックボックスの色';
      refresh();
    })
  );
  $('#hm-play').addEventListener('click', () => togglePlay(false));
  $('#hm-play-orig').addEventListener('click', () => togglePlay(true));
  $('#hm-midi').addEventListener('click', exportMidi);
  $('#hm-roll').addEventListener('pointerdown', onRollTap);

  refresh();
}

// 耳コピタブからの受信
export function receive(key, value) {
  if (key !== 'melody') return;
  bpm = value.bpm || 120;
  panel.querySelector('#hm-bpm').value = bpm;
  const spb = 60 / bpm;
  melody = value.notes.map((n) => ({
    midi: n.midi,
    start: Math.round((n.start / spb) / grid) * grid,
    dur: Math.max(grid, Math.round((n.dur / spb) / grid) * grid),
  }));
  importMeta = { offset: value.offset };
  keyAuto = true;
  panel.querySelector('#hm-status').textContent = `耳コピから ${melody.length} 音を受信（クオンタイズ済み）`;
  refresh();
}

// デモメロディ: きらきら星（キーC・BPM100）
function loadDemoMelody() {
  bpm = 100;
  panel.querySelector('#hm-bpm').value = bpm;
  const seq = [
    [60, 0, 1], [60, 1, 1], [67, 2, 1], [67, 3, 1], [69, 4, 1], [69, 5, 1], [67, 6, 2],
    [65, 8, 1], [65, 9, 1], [64, 10, 1], [64, 11, 1], [62, 12, 1], [62, 13, 1], [60, 14, 2],
  ];
  melody = seq.map(([midi, start, dur]) => ({ midi, start, dur }));
  importMeta = null;
  keyAuto = true;
  panel.querySelector('#hm-status').textContent =
    'デモ: きらきら星を読み込みました。キーを自動推定してハモリを生成 → ▶再生で聴けます。チェックでハモリを増減';
  refresh();
}

function readKeySelects() {
  keyEst = {
    tonic: Number(panel.querySelector('#hm-key-tonic').value),
    mode: panel.querySelector('#hm-key-mode').value,
  };
}

// ---- 再計算・描画 ----

function refresh() {
  // キー推定
  if (keyAuto && melody.length > 0) {
    const k = estimateKeyFromNotes(melody);
    keyEst = { tonic: k.tonic, mode: k.mode };
    panel.querySelector('#hm-key-est').textContent = `推定: ${keyName(k)} (${(k.score * 100).toFixed(0)}%)`;
  } else if (!keyAuto) {
    panel.querySelector('#hm-key-est').textContent = '手動:';
  } else {
    panel.querySelector('#hm-key-est').textContent = '—';
  }
  panel.querySelector('#hm-key-tonic').value = String(keyEst.tonic);
  panel.querySelector('#hm-key-mode').value = keyEst.mode;

  // ハモリ生成
  harmonies = {};
  for (const lk of activeLines) {
    harmonies[lk] = generateHarmony(melody, keyEst.tonic, keyEst.mode, HARMONY_PRESETS[lk].shift);
  }

  panel.querySelector('#hm-play-orig').disabled = !(importMeta && window.msBridge.data.earcopyAudio);
  panel.querySelector('#hm-info').textContent = melody.length ? `${melody.length}音 / キー ${pcName(keyEst.tonic)}${keyEst.mode === 'minor' ? 'm' : ''}` : '';
  drawRoll();
  drawStaff();
}

function drawStaff() {
  const wrap = panel.querySelector('#hm-staff-wrap');
  if (!wrap || view !== 'staff') return;
  if (melody.length === 0) {
    wrap.innerHTML = '<p class="hint" style="padding:12px">メロディがまだありません</p>';
    return;
  }
  const voices = [];
  for (const h of HLINES) {
    if (activeLines.has(h.key) && harmonies[h.key]) {
      voices.push({ notes: harmonies[h.key], color: h.color, name: HARMONY_PRESETS[h.key].label });
    }
  }
  voices.push({ notes: melody, color: '#5b8cff', name: 'メロディ' });
  wrap.innerHTML = renderStaffSVG(voices, { tonic: keyEst.tonic, mode: keyEst.mode });
}

// 五線譜側の再生ヘッド。beat=null で非表示
function setStaffPlayhead(beat) {
  const svg = panel.querySelector('#hm-staff-wrap svg');
  if (!svg) return;
  const line = svg.querySelector('[data-role="staff-playhead"]');
  if (!line) return;
  if (beat === null) {
    line.setAttribute('opacity', 0);
    return;
  }
  const x = Number(svg.dataset.x0) + beat * Number(svg.dataset.ppb);
  line.setAttribute('x1', x);
  line.setAttribute('x2', x);
  line.setAttribute('opacity', 0.8);
}

function rollGeom() {
  const dpr = window.devicePixelRatio || 1;
  let lo = 55, hi = 79;
  const all = [...melody, ...Object.values(harmonies).flat()];
  if (all.length) {
    lo = Math.min(...all.map((n) => n.midi)) - 3;
    hi = Math.max(...all.map((n) => n.midi)) + 3;
  }
  lo = Math.max(24, lo); hi = Math.min(96, Math.max(hi, lo + 14));
  const totalBeats = Math.max(16, Math.ceil(Math.max(4, ...melody.map((n) => n.start + n.dur)) / 4) * 4 + 4);
  const ppb = 48 * dpr;
  const rowH = 11 * dpr;
  const gutter = 40 * dpr;
  const ruler = 18 * dpr;
  return { dpr, lo, hi, totalBeats, ppb, rowH, gutter, ruler,
    W: gutter + totalBeats * ppb, H: ruler + (hi - lo + 1) * rowH };
}

function drawRoll(playheadBeat = null) {
  const c = panel.querySelector('#hm-roll');
  const gm = rollGeom();
  if (c.width !== gm.W || c.height !== gm.H) {
    c.width = gm.W;
    c.height = gm.H;
    c.style.width = gm.W / gm.dpr + 'px';
    c.style.height = gm.H / gm.dpr + 'px';
  }
  const g = c.getContext('2d');
  g.fillStyle = '#38324a';
  g.fillRect(0, 0, gm.W, gm.H);

  const yOf = (midi) => gm.ruler + (gm.hi - midi) * gm.rowH;
  const xOf = (beat) => gm.gutter + beat * gm.ppb;

  // 行（黒鍵行を暗く、Cの行に線とラベル）
  for (let m = gm.lo; m <= gm.hi; m++) {
    const y = yOf(m);
    if ([1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)) {
      g.fillStyle = 'rgba(255,255,255,0.035)';
      g.fillRect(gm.gutter, y, gm.W - gm.gutter, gm.rowH);
    }
    if (m % 12 === 0) {
      g.strokeStyle = 'rgba(255,255,255,0.15)';
      g.beginPath(); g.moveTo(gm.gutter, y + gm.rowH); g.lineTo(gm.W, y + gm.rowH); g.stroke();
      g.fillStyle = '#9aa1b5';
      g.font = `${10 * gm.dpr}px sans-serif`;
      g.fillText(midiToName(m), 4 * gm.dpr, y + gm.rowH - 2);
    }
  }
  // 拍線＋ルーラー
  for (let b = 0; b <= gm.totalBeats; b++) {
    const x = xOf(b);
    g.strokeStyle = b % 4 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.07)';
    g.beginPath(); g.moveTo(x, gm.ruler); g.lineTo(x, gm.H); g.stroke();
    if (b % 4 === 0) {
      g.fillStyle = '#9aa1b5';
      g.font = `${10 * gm.dpr}px sans-serif`;
      g.fillText(String(b / 4 + 1), x + 3, 12 * gm.dpr);
    }
  }

  // ハモリノート（下層）
  for (const h of HLINES) {
    if (!harmonies[h.key]) continue;
    g.fillStyle = h.color + 'aa';
    for (const n of harmonies[h.key]) {
      g.fillRect(xOf(n.start) + 1, yOf(n.midi) + 1.5, n.dur * gm.ppb - 2, gm.rowH - 3);
    }
  }
  // メロディ（上層）
  g.fillStyle = '#5b8cff';
  g.strokeStyle = '#dfe8ff';
  for (const n of melody) {
    g.fillRect(xOf(n.start) + 1, yOf(n.midi) + 1, n.dur * gm.ppb - 2, gm.rowH - 2);
    g.strokeRect(xOf(n.start) + 1, yOf(n.midi) + 1, n.dur * gm.ppb - 2, gm.rowH - 2);
  }

  // 再生ヘッド
  if (playheadBeat !== null) {
    const x = xOf(playheadBeat);
    g.fillStyle = '#fff';
    g.fillRect(x - 1, gm.ruler, 2, gm.H);
  }
}

function onRollTap(ev) {
  const c = panel.querySelector('#hm-roll');
  const gm = rollGeom();
  const rect = c.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * gm.W;
  const y = ((ev.clientY - rect.top) / rect.height) * gm.H;
  if (x < gm.gutter || y < gm.ruler) return;
  const beat = (x - gm.gutter) / gm.ppb;
  const midi = gm.hi - Math.floor((y - gm.ruler) / gm.rowH);
  // 既存メロディ音の上ならば削除
  const hit = melody.findIndex((n) => n.midi === midi && beat >= n.start && beat < n.start + n.dur);
  if (hit >= 0) {
    melody.splice(hit, 1);
  } else {
    melody.push({ midi, start: Math.floor(beat / grid) * grid, dur: grid });
    melody.sort((a, b) => a.start - b.start);
    voiceMidi(midi, 0, 0.3, { gain: 0.3 });
  }
  refresh();
}

// ---- マイク入力 ----

async function toggleMicInput() {
  const btn = panel.querySelector('#hm-mic');
  const live = panel.querySelector('#hm-mic-live');
  if (micRec) {
    // 確定
    cancelAnimationFrame(micRec.raf);
    stopMic();
    const frames = micRec.frames;
    micRec = null;
    btn.textContent = '🎙 歌って入力';
    live.style.display = 'none';
    const notes = framesToNotes(frames, 440, { minDur: 0.1 });
    if (notes.length === 0) {
      panel.querySelector('#hm-status').textContent = '音程を検出できませんでした。もう少しはっきり歌ってみてください';
      return;
    }
    const spb = 60 / bpm;
    const t0 = notes[0].start;
    melody = notes.map((n) => ({
      midi: n.midi,
      start: Math.round(((n.start - t0) / spb) / grid) * grid,
      dur: Math.max(grid, Math.round((n.dur / spb) / grid) * grid),
    }));
    importMeta = null;
    keyAuto = true;
    panel.querySelector('#hm-status').textContent = `歌から ${melody.length} 音を採譜しました`;
    refresh();
    return;
  }
  try {
    const source = await startMic();
    const ctx = getCtx();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    micRec = { frames: [], start: performance.now(), raf: 0 };
    btn.textContent = '⏹ 確定';
    live.style.display = 'flex';
    const loop = () => {
      if (!micRec) return;
      micRec.raf = requestAnimationFrame(loop);
      analyser.getFloatTimeDomainData(buf);
      const r = detectPitch(buf, ctx.sampleRate, { minFreq: 70, maxFreq: 1000, clarityThreshold: 0.85 });
      const t = (performance.now() - micRec.start) / 1000;
      micRec.frames.push({ t, freq: r ? r.freq : null, clarity: r ? r.clarity : 0 });
      panel.querySelector('#hm-mic-note').textContent = r
        ? midiToName(Math.round(69 + 12 * Math.log2(r.freq / 440)))
        : '–';
    };
    loop();
  } catch (e) {
    panel.querySelector('#hm-status').textContent = 'マイクを使用できません: ' + e.message;
  }
}

// ---- 再生 ----

async function togglePlay(withOriginal) {
  if (playState) { stopPlayback(); return; }
  if (melody.length === 0) return;
  await resumeCtx();
  const ctx = getCtx();
  const spb = 60 / bpm;
  const t0 = ctx.currentTime + 0.15;
  const volMel = Number(panel.querySelector('#hm-vol-mel').value) / 100 * 0.5;
  const volHarm = Number(panel.querySelector('#hm-vol-harm').value) / 100 * 0.5;

  playNodes = [];
  if (volMel > 0.01) {
    for (const n of melody) playNodes.push(voiceMidi(n.midi, t0 + n.start * spb, Math.max(0.15, n.dur * spb), { gain: volMel }));
  }
  for (const lk of activeLines) {
    for (const n of harmonies[lk] || []) {
      playNodes.push(voiceMidi(n.midi, t0 + n.start * spb, Math.max(0.15, n.dur * spb), { gain: volHarm }));
    }
  }
  const endBeat = Math.max(...melody.map((n) => n.start + n.dur));

  let audioEl = null;
  if (withOriginal && importMeta && window.msBridge.data.earcopyAudio) {
    audioEl = window.msBridge.data.earcopyAudio.getEl();
    audioEl.playbackRate = 1;
    audioEl.currentTime = importMeta.offset;
    audioEl.play();
  }

  playState = { t0, spb, endBeat, audioEl };
  panel.querySelector('#hm-play').textContent = '⏹ 停止';
  const tick = () => {
    if (!playState) return;
    rafId = requestAnimationFrame(tick);
    const beat = (getCtx().currentTime - playState.t0) / playState.spb;
    if (beat > playState.endBeat + 1) { stopPlayback(); return; }
    if (view === 'roll') drawRoll(Math.max(0, beat));
    else setStaffPlayhead(Math.max(0, beat));
  };
  tick();
}

function stopPlayback() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  for (const n of playNodes) { try { n.stop(0); } catch { /* 既に停止 */ } }
  playNodes = [];
  if (playState?.audioEl) playState.audioEl.pause();
  playState = null;
  panel.querySelector('#hm-play').textContent = '▶ 再生';
  drawRoll();
  setStaffPlayhead(null);
}

// ---- MIDI ----

function exportMidi() {
  if (melody.length === 0) return;
  const tracks = [{ name: 'Melody', notes: melody }];
  for (const lk of activeLines) {
    tracks.push({ name: HARMONY_PRESETS[lk].label, notes: harmonies[lk] || [] });
  }
  const bytes = buildMidi(tracks, bpm);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'harmony.mid';
  a.click();
  URL.revokeObjectURL(a.href);
  panel.querySelector('#hm-status').textContent = 'MIDI を書き出しました（MuseScore などで開けます）';
}

export function deactivate() {
  stopPlayback();
  if (micRec) {
    cancelAnimationFrame(micRec.raf);
    stopMic();
    micRec = null;
    const btn = panel.querySelector('#hm-mic');
    if (btn) btn.textContent = '🎙 歌って入力';
  }
}
