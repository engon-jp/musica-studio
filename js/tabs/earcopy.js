// 耳コピタブ: 音源再生（A-Bループ・ピッチ保持速度変更・帯域フィルタ）＋解析（メロディ検出・コード候補）

import { getCtx, resumeCtx, decodeFile, toMono, startMic, stopMic } from '../audio-engine.js';
import { pitchTrack, framesToNotes, downsample } from '../pitch.js';
import { midiToName, pcName } from '../theory.js';
import { chromaOf, chordCandidates, chordSegments } from '../dsp.js';
import { trackChords } from '../chord-tracker.js';

let panel;
let audioEl = null;
let sourceNode = null, hpF = null, lpF = null, analyser = null;
let audioBuffer = null, monoData = null;
let peaks = null;
let loopA = null, loopB = null, loopOn = true;
let rafId = null;
let lastNotes = null;
let fileName = '';
let specOn = false;
let dragStart = null;

const fmt = (t) => {
  if (t == null || !isFinite(t)) return '-:--';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

export function init(el) {
  panel = el;
  panel.innerHTML = `
    <div class="card">
      <div class="row">
        <button class="btn primary" id="ec-file-btn">🎵 音源ファイルを開く</button>
        <button class="btn" id="ec-rec">🎙 マイクから録音</button>
        <button class="btn" id="ec-demo">🎁 デモ音源で試す</button>
        <input type="file" id="ec-file" accept="audio/*" hidden>
        <span class="hint" id="ec-file-name">mp3 / m4a / wav / aacなど</span>
      </div>
    </div>
    <div class="card">
      <canvas class="wave" id="ec-wave" height="120"></canvas>
      <div class="row transport" style="margin-top:10px">
        <button class="btn" id="ec-play" disabled>▶ 再生</button>
        <button class="btn" id="ec-to-a" disabled>⏮ Aへ</button>
        <span class="time-display" id="ec-time">-:-- / -:--</span>
      </div>
      <div class="row">
        <button class="btn small" id="ec-set-a" disabled>A点=現在</button>
        <button class="btn small" id="ec-set-b" disabled>B点=現在</button>
        <button class="btn small" id="ec-clear-ab" disabled>A-B解除</button>
        <label><input type="checkbox" id="ec-loop" checked> ループ</label>
        <span class="time-display" id="ec-ab"></span>
      </div>
      <div class="row">
        <label>速度</label>
        <input type="range" id="ec-rate" min="0.25" max="1.5" step="0.05" value="1" style="flex:1; min-width:120px">
        <span id="ec-rate-val" style="min-width:3.5em; font-weight:700">1.00x</span>
        <span class="chip" data-rate="0.5">0.5x</span>
        <span class="chip" data-rate="0.75">0.75x</span>
        <span class="chip" data-rate="1">1x</span>
      </div>
      <p class="hint">波形をドラッグでA-B区間指定、タップで頭出し。速度を変えても音程は保たれます。</p>
    </div>
    <div class="card">
      <div class="row">
        <label>帯域フィルタ</label>
        <span class="chip active" data-band="full">全帯域</span>
        <span class="chip" data-band="bass">ベースだけ</span>
        <span class="chip" data-band="vocal">ボーカル帯域</span>
        <span class="chip" data-band="high">高域だけ</span>
      </div>
      <div class="row">
        <label style="min-width:4.5em">低域カット</label>
        <input type="range" id="ec-hp" min="0" max="100" value="0" style="flex:1">
        <span id="ec-hp-val" style="min-width:5em">20 Hz</span>
      </div>
      <div class="row">
        <label style="min-width:4.5em">高域カット</label>
        <input type="range" id="ec-lp" min="0" max="100" value="100" style="flex:1">
        <span id="ec-lp-val" style="min-width:5em">20 kHz</span>
      </div>
      <div class="row">
        <label><input type="checkbox" id="ec-spec-on"> スペクトログラム表示（再生中に流れます）</label>
      </div>
      <canvas class="spec" id="ec-spec" height="160" style="display:none"></canvas>
    </div>
    <div class="card">
      <h2>解析（A-B区間、未指定なら全体・最大30秒）</h2>
      <div class="row">
        <button class="btn" id="ec-melody" disabled>🎼 メロディ検出</button>
        <button class="btn" id="ec-chords" disabled>🎸 コード候補</button>
        <button class="btn" id="ec-prog" disabled>🧠 コード進行（曲全体）</button>
        <label>BPM <input type="number" id="ec-bpm" value="120" min="40" max="240"></label>
        <span class="hint" id="ec-busy"></span>
      </div>
      <div id="ec-melody-out" style="margin-top:8px"></div>
      <div id="ec-chords-out" style="margin-top:8px"></div>
      <div id="ec-prog-out" style="margin-top:8px"></div>
    </div>
  `;

  const $ = (s) => panel.querySelector(s);
  $('#ec-file-btn').addEventListener('click', () => $('#ec-file').click());
  $('#ec-file').addEventListener('change', onFile);
  $('#ec-demo').addEventListener('click', makeDemo);
  $('#ec-rec').addEventListener('click', toggleRec);
  $('#ec-play').addEventListener('click', togglePlay);
  $('#ec-to-a').addEventListener('click', () => { if (audioEl) audioEl.currentTime = loopA ?? 0; });
  $('#ec-set-a').addEventListener('click', () => { loopA = audioEl.currentTime; if (loopB !== null && loopB <= loopA) loopB = null; updateAB(); });
  $('#ec-set-b').addEventListener('click', () => { loopB = audioEl.currentTime; if (loopA === null || loopA >= loopB) loopA = 0; updateAB(); });
  $('#ec-clear-ab').addEventListener('click', () => { loopA = loopB = null; updateAB(); });
  $('#ec-loop').addEventListener('change', (e) => { loopOn = e.target.checked; });
  $('#ec-rate').addEventListener('input', (e) => setRate(Number(e.target.value)));
  panel.querySelectorAll('.chip[data-rate]').forEach((c) =>
    c.addEventListener('click', () => { setRate(Number(c.dataset.rate)); $('#ec-rate').value = c.dataset.rate; })
  );
  panel.querySelectorAll('.chip[data-band]').forEach((c) => c.addEventListener('click', () => setBand(c)));
  $('#ec-hp').addEventListener('input', updateFilters);
  $('#ec-lp').addEventListener('input', updateFilters);
  $('#ec-spec-on').addEventListener('change', (e) => {
    specOn = e.target.checked;
    $('#ec-spec').style.display = specOn ? 'block' : 'none';
  });
  $('#ec-melody').addEventListener('click', analyzeMelody);
  $('#ec-chords').addEventListener('click', analyzeChords);
  $('#ec-prog').addEventListener('click', analyzeProgression);

  const wave = $('#ec-wave');
  wave.addEventListener('pointerdown', onWaveDown);
  wave.addEventListener('pointermove', onWaveMove);
  wave.addEventListener('pointerup', onWaveUp);
  window.addEventListener('resize', () => { computePeaks(); drawWave(); });
}

// ---- ファイル読み込み ----

async function onFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  await loadAudioFile(file);
  e.target.value = '';
}

async function loadAudioFile(file) {
  fileName = file.name;
  panel.querySelector('#ec-file-name').textContent = '読み込み中…';
  try {
    await resumeCtx();
    ensureGraph();
    audioEl.src && URL.revokeObjectURL(audioEl.src);
    audioEl.src = URL.createObjectURL(file);
    audioBuffer = await decodeFile(file);
    monoData = toMono(audioBuffer);
    loopA = loopB = null;
    computePeaks();
    drawWave();
    updateAB();
    for (const id of ['#ec-play', '#ec-to-a', '#ec-set-a', '#ec-set-b', '#ec-clear-ab', '#ec-melody', '#ec-chords', '#ec-prog']) {
      panel.querySelector(id).disabled = false;
    }
    panel.querySelector('#ec-file-name').textContent = `${fileName}（${fmt(audioBuffer.duration)}）`;
    startRaf();
  } catch (err) {
    panel.querySelector('#ec-file-name').textContent = '読み込み失敗: ' + err.message;
  }
}

// ---- マイク録音（スピーカーで流した曲や自分の演奏を直接キャプチャ）----

let recState = null; // { proc, silent, chunks }

async function toggleRec() {
  const btn = panel.querySelector('#ec-rec');
  if (recState) {
    await finishRec();
    return;
  }
  try {
    const source = await startMic();
    const ctx = getCtx();
    // ScriptProcessor で生PCMを蓄積（非推奨APIだが iOS Safari 含め全対応で確実）
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const silent = ctx.createGain();
    silent.gain.value = 0; // 発火のため destination に繋ぐが無音（ハウリング防止）
    const chunks = [];
    proc.onaudioprocess = (e) => {
      if (!recState) return;
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      const sec = (chunks.length * 4096) / ctx.sampleRate;
      btn.textContent = `⏹ 録音停止（${fmt(sec)}）`;
      if (sec >= 90) finishRec(); // 上限90秒
    };
    source.connect(proc);
    proc.connect(silent);
    silent.connect(ctx.destination);
    recState = { proc, silent, chunks };
    btn.textContent = '⏹ 録音停止（0:00.0）';
    panel.querySelector('#ec-file-name').textContent =
      '🔴 録音中… 採りたい部分（ギターソロ等）を流してください（最長90秒）';
  } catch (e) {
    panel.querySelector('#ec-file-name').textContent = 'マイクを使用できません: ' + e.message;
  }
}

async function finishRec() {
  if (!recState) return;
  const { proc, silent, chunks } = recState;
  recState = null;
  try { proc.disconnect(); silent.disconnect(); } catch { /* 既に切断 */ }
  stopMic();
  panel.querySelector('#ec-rec').textContent = '🎙 マイクから録音';
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const sr = getCtx().sampleRate;
  if (total < sr * 0.5) {
    panel.querySelector('#ec-file-name').textContent = '録音が短すぎました（0.5秒以上流してください）';
    return;
  }
  const data = new Float32Array(total);
  let p = 0;
  for (const c of chunks) { data.set(c, p); p += c.length; }
  const file = new File([encodeWav(data, sr)],
    `マイク録音_${new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}.wav`,
    { type: 'audio/wav' });
  await loadAudioFile(file);
}

// ---- デモ音源（その場で合成: 前半きらきら星メロディ／後半 C→Am→F→G）----

async function makeDemo() {
  const sr = 44100;
  const mel = [
    [261.63, 0.4], [261.63, 0.4], [392.0, 0.4], [392.0, 0.4],
    [440.0, 0.4], [440.0, 0.4], [392.0, 0.8],
    [349.23, 0.4], [349.23, 0.4], [329.63, 0.4], [329.63, 0.4],
    [293.66, 0.4], [293.66, 0.4], [261.63, 0.8],
  ];
  const chords = [
    [130.81, 164.81, 196.0],  // C
    [110.0, 130.81, 164.81],  // Am
    [174.61, 220.0, 261.63],  // F
    [196.0, 246.94, 293.66],  // G
  ];
  const total = mel.reduce((s, n) => s + n[1], 0) + chords.length * 2.0;
  const data = new Float32Array(Math.ceil(sr * total));
  let pos = 0;
  for (const [f, d] of mel) {
    // 音符間に100msの隙間を置く（同音連打が1音に融合しないように）
    const len = Math.floor(sr * (d - 0.1));
    for (let i = 0; i < len; i++) {
      const env = Math.min(1, i / (sr * 0.02)) * Math.exp(-i / (sr * 0.7));
      data[pos + i] = env * (0.5 * Math.sin((2 * Math.PI * f * i) / sr) + 0.12 * Math.sin((2 * Math.PI * 2 * f * i) / sr));
    }
    pos += Math.floor(sr * d);
  }
  for (const tones of chords) {
    const len = sr * 2;
    for (const f of tones) {
      for (let h = 1; h <= 3; h++) {
        for (let i = 0; i < len; i++) {
          const env = Math.min(1, i / (sr * 0.02)) * Math.exp(-i / (sr * 1.2));
          data[pos + i] += env * (0.22 / h) * Math.sin((2 * Math.PI * f * h * i) / sr);
        }
      }
    }
    pos += len;
  }
  const file = new File([encodeWav(data, sr)], 'デモ音源.wav', { type: 'audio/wav' });
  await loadAudioFile(file);
  // 前半（メロディ部分）に A-B を自動設定
  loopA = 0;
  loopB = 6.4;
  updateAB();
  panel.querySelector('#ec-file-name').textContent =
    'デモ: 前半きらきら星のA-B設定済み→🎼メロディ検出！ 後半(6.4s〜)はC→Am→F→G各2秒→A-Bを後半にドラッグして🎸コード候補';
}

function encodeWav(f32, sr) {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return buf;
}

function ensureGraph() {
  if (audioEl) return;
  const ctx = getCtx();
  audioEl = new Audio();
  audioEl.preservesPitch = true;
  if ('webkitPreservesPitch' in audioEl) audioEl.webkitPreservesPitch = true;
  sourceNode = ctx.createMediaElementSource(audioEl);
  hpF = ctx.createBiquadFilter();
  hpF.type = 'highpass';
  hpF.frequency.value = 20;
  lpF = ctx.createBiquadFilter();
  lpF.type = 'lowpass';
  lpF.frequency.value = 20000;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0.5;
  sourceNode.connect(hpF); hpF.connect(lpF); lpF.connect(analyser); analyser.connect(ctx.destination);
  audioEl.addEventListener('ended', () => updatePlayBtn());
  // ハモリタブから参照できるよう共有
  window.msBridge.data.earcopyAudio = {
    getEl: () => audioEl,
    getLoop: () => ({ a: loopA, b: loopB }),
    getName: () => fileName,
    getMono: () => (monoData ? { data: monoData, sr: audioBuffer.sampleRate, a: loopA, b: loopB } : null),
  };
}

// ---- 再生 ----

async function togglePlay() {
  if (!audioEl) return;
  await resumeCtx();
  if (audioEl.paused) {
    if (loopOn && loopA !== null && loopB !== null &&
        (audioEl.currentTime < loopA - 0.05 || audioEl.currentTime > loopB)) {
      audioEl.currentTime = loopA;
    }
    await audioEl.play();
  } else {
    audioEl.pause();
  }
  updatePlayBtn();
}

function updatePlayBtn() {
  panel.querySelector('#ec-play').textContent = audioEl && !audioEl.paused ? '⏸ 一時停止' : '▶ 再生';
}

function setRate(v) {
  panel.querySelector('#ec-rate-val').textContent = v.toFixed(2) + 'x';
  if (audioEl) audioEl.playbackRate = v;
}

// ---- フィルタ ----

const sliderToFreq = (v) => Math.round(20 * Math.pow(10, (v / 100) * 3)); // 20Hz〜20kHz（対数）

function updateFilters() {
  const hp = sliderToFreq(Number(panel.querySelector('#ec-hp').value));
  const lp = sliderToFreq(Number(panel.querySelector('#ec-lp').value));
  if (hpF) hpF.frequency.value = hp;
  if (lpF) lpF.frequency.value = lp;
  panel.querySelector('#ec-hp-val').textContent = hp >= 1000 ? (hp / 1000).toFixed(1) + ' kHz' : hp + ' Hz';
  panel.querySelector('#ec-lp-val').textContent = lp >= 1000 ? (lp / 1000).toFixed(1) + ' kHz' : lp + ' Hz';
  panel.querySelectorAll('.chip[data-band]').forEach((c) => c.classList.remove('active'));
}

const BANDS = { full: [0, 100], bass: [0, 37], vocal: [32, 78], high: [57, 100] };

function setBand(chip) {
  const [hp, lp] = BANDS[chip.dataset.band];
  panel.querySelector('#ec-hp').value = hp;
  panel.querySelector('#ec-lp').value = lp;
  updateFilters();
  panel.querySelectorAll('.chip[data-band]').forEach((c) => c.classList.toggle('active', c === chip));
}

// ---- 波形 ----

function computePeaks() {
  const canvas = panel.querySelector('#ec-wave');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = 120 * dpr;
  if (!monoData) { peaks = null; return; }
  const W = canvas.width;
  peaks = new Float32Array(W * 2);
  const step = monoData.length / W;
  for (let x = 0; x < W; x++) {
    let mn = 1, mx = -1;
    const s = Math.floor(x * step), e = Math.min(monoData.length, Math.ceil((x + 1) * step));
    for (let i = s; i < e; i += Math.max(1, Math.floor((e - s) / 50))) {
      const v = monoData[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    peaks[x * 2] = mn;
    peaks[x * 2 + 1] = mx;
  }
}

function drawWave() {
  const canvas = panel.querySelector('#ec-wave');
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.fillStyle = '#38324a';
  g.fillRect(0, 0, W, H);
  if (!peaks || !audioBuffer) return;
  const dur = audioBuffer.duration;

  // A-B区間の背景
  if (loopA !== null) {
    const xa = (loopA / dur) * W;
    const xb = loopB !== null ? (loopB / dur) * W : xa;
    g.fillStyle = 'rgba(91,140,255,0.15)';
    g.fillRect(xa, 0, Math.max(2, xb - xa), H);
    g.fillStyle = '#5b8cff';
    g.fillRect(xa - 1, 0, 2, H);
    if (loopB !== null) g.fillRect(xb - 1, 0, 2, H);
  }
  // ドラッグ中の選択
  if (dragStart && dragStart.moved) {
    const x1 = Math.min(dragStart.x, dragStart.curX), x2 = Math.max(dragStart.x, dragStart.curX);
    g.fillStyle = 'rgba(255,209,102,0.18)';
    g.fillRect(x1, 0, x2 - x1, H);
  }

  g.strokeStyle = '#3ecf8e';
  g.globalAlpha = 0.9;
  g.beginPath();
  const mid = H / 2, amp = H / 2 - 4;
  for (let x = 0; x < W; x++) {
    g.moveTo(x + 0.5, mid + peaks[x * 2] * amp);
    g.lineTo(x + 0.5, mid + peaks[x * 2 + 1] * amp);
  }
  g.stroke();
  g.globalAlpha = 1;

  // 再生ヘッド
  if (audioEl) {
    const x = (audioEl.currentTime / dur) * W;
    g.fillStyle = '#fff';
    g.fillRect(x - 1, 0, 2, H);
  }
}

function waveX2Time(ev) {
  const canvas = panel.querySelector('#ec-wave');
  const rect = canvas.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  return frac * (audioBuffer ? audioBuffer.duration : 0);
}

function onWaveDown(ev) {
  if (!audioBuffer) return;
  const canvas = panel.querySelector('#ec-wave');
  try { canvas.setPointerCapture(ev.pointerId); } catch { /* 合成イベント等では不可 */ }
  const rect = canvas.getBoundingClientRect();
  const x = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  dragStart = { x, curX: x, t: waveX2Time(ev), moved: false, clientX: ev.clientX };
}

function onWaveMove(ev) {
  if (!dragStart) return;
  const canvas = panel.querySelector('#ec-wave');
  const rect = canvas.getBoundingClientRect();
  dragStart.curX = ((ev.clientX - rect.left) / rect.width) * canvas.width;
  if (Math.abs(ev.clientX - dragStart.clientX) > 6) dragStart.moved = true;
  drawWave();
}

function onWaveUp(ev) {
  if (!dragStart) return;
  const endT = waveX2Time(ev);
  if (dragStart.moved) {
    loopA = Math.min(dragStart.t, endT);
    loopB = Math.max(dragStart.t, endT);
    if (loopB - loopA < 0.1) { loopA = null; loopB = null; }
    updateAB();
  } else if (audioEl) {
    audioEl.currentTime = endT;
  }
  dragStart = null;
  drawWave();
}

function updateAB() {
  const s = loopA !== null ? `A: ${fmt(loopA)}${loopB !== null ? ' → B: ' + fmt(loopB) : ''}` : '';
  panel.querySelector('#ec-ab').textContent = s;
  drawWave();
}

// ---- rAF ループ（時刻表示・ループ制御・スペクトログラム）----

function startRaf() {
  if (rafId) return;
  const tick = () => {
    rafId = requestAnimationFrame(tick);
    if (!audioEl || !audioBuffer) return;
    panel.querySelector('#ec-time').textContent = `${fmt(audioEl.currentTime)} / ${fmt(audioBuffer.duration)}`;
    if (loopOn && loopA !== null && loopB !== null && audioEl.currentTime > loopB) {
      audioEl.currentTime = loopA;
    }
    if (!audioEl.paused) {
      drawWave();
      if (specOn) drawSpec();
    }
  };
  tick();
}

function drawSpec() {
  const canvas = panel.querySelector('#ec-spec');
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== canvas.clientWidth * dpr) {
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = 160 * dpr;
  }
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const colW = 2 * dpr;
  g.drawImage(canvas, -colW, 0);
  g.fillStyle = '#38324a';
  g.fillRect(W - colW, 0, colW, H);

  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bins);
  const sr = getCtx().sampleRate;
  const fmin = 55, fmax = 6000;
  for (let y = 0; y < H; y++) {
    const f = fmin * Math.pow(fmax / fmin, 1 - y / H);
    const bin = Math.min(bins.length - 1, Math.round((f * analyser.fftSize) / sr));
    const v = bins[bin] / 255;
    if (v < 0.05) continue;
    const r = Math.round(20 + 235 * Math.max(0, v - 0.6) / 0.4);
    const gg = Math.round(25 + 200 * Math.max(0, v - 0.25));
    const b = Math.round(40 + 215 * Math.min(1, v * 2));
    g.fillStyle = `rgb(${r},${gg},${b})`;
    g.fillRect(W - colW, y, colW, 1);
  }
}

// ---- 解析 ----

function analysisRange() {
  const sr = audioBuffer.sampleRate;
  let a = loopA !== null && loopB !== null ? loopA : 0;
  let b = loopA !== null && loopB !== null ? loopB : audioBuffer.duration;
  if (b - a > 30) b = a + 30;
  return { a, b, data: monoData.subarray(Math.floor(a * sr), Math.floor(b * sr)), sr };
}

function busy(msg) {
  panel.querySelector('#ec-busy').textContent = msg;
}

function analyzeMelody() {
  if (!monoData) return;
  busy('メロディ解析中…');
  setTimeout(() => {
    const { a, data, sr } = analysisRange();
    // 〜11kHzに間引いてMPMを約60倍高速化（半音量子化には十分な精度）
    const factor = Math.max(1, Math.floor(sr / 11025));
    const frames = pitchTrack(downsample(data, factor), sr / factor, {
      windowSize: 512, hopSize: 256, clarityThreshold: 0.85, minFreq: 70, maxFreq: 1200,
    });
    const notes = framesToNotes(frames);
    lastNotes = { notes, offset: a };
    const out = panel.querySelector('#ec-melody-out');
    if (notes.length === 0) {
      out.innerHTML = '<p class="hint">メロディを検出できませんでした。ボーカルや単音楽器が目立つ区間・帯域フィルタの活用を試してください。</p>';
    } else {
      out.innerHTML = `
        <div class="note-seq">${notes.map((n) => `<span class="note-chip" title="${n.start.toFixed(2)}s">${midiToName(n.midi)}</span>`).join('')}</div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary" id="ec-send-harmony">🎤 ハモリタブへ送る（${notes.length}音）</button>
          <button class="btn" id="ec-send-tab">📝 ギターのタブ譜へ</button>
        </div>`;
      out.querySelector('#ec-send-harmony').addEventListener('click', () => {
        const bpm = Number(panel.querySelector('#ec-bpm').value) || 120;
        window.msBridge.send('harmony', 'melody', {
          notes: notes.map((n) => ({ ...n })),
          bpm,
          offset: a,
          from: 'earcopy',
        });
      });
      out.querySelector('#ec-send-tab').addEventListener('click', () => {
        const bpm = Number(panel.querySelector('#ec-bpm').value) || 120;
        const spb = 60 / bpm;
        const t0 = notes[0].start;
        window.msBridge.send('tab', 'guitarline', {
          notes: notes.map((n) => ({
            midi: n.midi,
            startBeat: (n.start - t0) / spb,
            beats: Math.max(0.25, n.dur / spb),
          })),
          bpm,
        });
      });
    }
    busy('');
  }, 30);
}

function analyzeChords() {
  if (!monoData) return;
  busy('コード解析中…');
  setTimeout(() => {
    const { a, b, data, sr } = analysisRange();
    const overall = chordCandidates(chromaOf(data, sr), 5);
    const nSeg = Math.min(8, Math.max(1, Math.round((b - a) / 2)));
    const segs = nSeg > 1 ? chordSegments(data, sr, nSeg) : [];
    const maxScore = overall[0]?.score || 1;
    panel.querySelector('#ec-chords-out').innerHTML = `
      <p class="hint">区間全体の候補（上位5つ）:</p>
      <ul class="cand-list">${overall.map((c) => `
        <li><span style="font-weight:700">${c.chord}</span>
        <span class="score-bar" style="width:${Math.round((c.score / maxScore) * 120)}px"></span>
        <span class="hint">${(c.score * 100).toFixed(0)}%</span></li>`).join('')}
      </ul>
      ${segs.length ? `<p class="hint" style="margin-top:8px">時間分割（${((b - a) / nSeg).toFixed(1)}秒ごとのトップ候補）:</p>
      <div class="note-seq">${segs.map((s) => `<span class="note-chip">${s.candidates[0].chord}</span>`).join(' ')}</div>` : ''}
      <p class="hint" style="margin-top:6px">※自動判定は候補です。ベース音（最低音）を頼りに耳で確定させるのがコツ。</p>
    `;
    busy('');
  }, 30);
}

// ---- コード進行トラッカー（曲全体）----

let progResult = null;

async function analyzeProgression() {
  if (!monoData) return;
  const btn = panel.querySelector('#ec-prog');
  btn.disabled = true;
  try {
    const res = await trackChords(monoData, audioBuffer.sampleRate, {
      onProgress: (p) => busy(`コード進行を解析中… ${Math.round(p * 100)}%`),
    });
    progResult = res;
    if (res) {
      window.msBridge.data.progression = {
        segments: res.segments.map((s) => ({ chord: s.chord, beats: s.beats })),
        bpm: res.bpm,
        file: fileName,
      };
    }
    renderProg(res);
  } catch (e) {
    panel.querySelector('#ec-prog-out').innerHTML = `<p class="hint">解析エラー: ${e.message}</p>`;
  } finally {
    btn.disabled = false;
    busy('');
  }
}

function renderProg(res) {
  const out = panel.querySelector('#ec-prog-out');
  if (!res || res.segments.length === 0) {
    out.innerHTML = '<p class="hint">コード進行を解析できませんでした（音が薄い/短すぎる可能性）</p>';
    return;
  }
  const keyLabel = pcName(res.key.tonic, res.useFlat) + (res.key.mode === 'minor' ? 'm' : '');
  out.innerHTML = `
    <p class="hint">推定テンポ ${res.bpm} BPM ・ キー ${keyLabel} ・ ${res.segments.length}区間。ブロックをタップで頭出し＋A-Bループ設定</p>
    <div class="prog-strip">${res.segments.map((s, i) => `
      <div class="prog-block" data-i="${i}" style="min-width:${Math.max(38, Math.round((s.end - s.start) * 24))}px">
        <b>${s.chord}</b>${s.hint ? `<span class="prog-hint">${s.hint}</span>` : ''}
        <small>${fmt(s.start)}</small>
      </div>`).join('')}
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn primary" id="ec-prog-send">📝 コード譜タブへ送る</button>
      <button class="btn" id="ec-bass-send" ${res.bassline?.length ? '' : 'disabled'}>🎸 ベースのタブ譜を作る（${res.bassline?.length ?? 0}音）</button>
      <span class="hint">自動解析は候補です。仕上げはあなたの耳で</span>
    </div>`;
  out.querySelectorAll('.prog-block').forEach((el) =>
    el.addEventListener('click', () => {
      const s = res.segments[Number(el.dataset.i)];
      loopA = s.start;
      loopB = s.end;
      updateAB();
      if (audioEl) audioEl.currentTime = s.start;
      out.querySelectorAll('.prog-block').forEach((x) => x.classList.toggle('active', x === el));
    })
  );
  out.querySelector('#ec-bass-send')?.addEventListener('click', () => {
    if (!res.bassline?.length) return;
    window.msBridge.send('tab', 'bassline', { notes: res.bassline, bpm: res.bpm });
  });
  out.querySelector('#ec-prog-send').addEventListener('click', () => {
    const lines = [];
    for (let i = 0; i < res.segments.length; i += 4) {
      lines.push(res.segments.slice(i, i + 4).map((s) => `[${s.chord}]`).join(' '));
    }
    const text = lines.join('\n') +
      `\n\n※「${fileName}」の自動解析（BPM ${res.bpm}・キー ${keyLabel}）。候補なので耳で最終確認を`;
    window.msBridge.send('chords', 'analyzed', { title: `${fileName} のコード進行`, text });
  });
}

export function activate() {
  if (audioBuffer) startRaf();
}

export function deactivate() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}
