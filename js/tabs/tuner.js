// チューナータブ

import { startMic, stopMic, micActive, getCtx } from '../audio-engine.js';
import { detectPitch } from '../pitch.js';
import { freqToNote, midiToFreq, midiToName } from '../theory.js';
import { pluckMidi } from '../synth.js';

const PRESETS = {
  guitar: { label: 'ギター（レギュラー）', strings: [40, 45, 50, 55, 59, 64] },
  halfdown: { label: 'ギター（半音下げ）', strings: [39, 44, 49, 54, 58, 63] },
  dropd: { label: 'ギター（ドロップD）', strings: [38, 45, 50, 55, 59, 64] },
  ukulele: { label: 'ウクレレ（High-G）', strings: [67, 60, 64, 69] },
  chromatic: { label: 'クロマチック（全音自動）', strings: null },
};

let panel;
let analyser = null;
let buf = null;
let rafId = null;
let a4 = 440;
let presetId = 'guitar';
let recentFreqs = [];
let lastGoodTime = 0;
let inTuneCount = 0;
let doneStrings = new Set();

export function init(el) {
  panel = el;
  panel.innerHTML = `
    <div class="card">
      <div class="row">
        <label>チューニング
          <select id="tn-preset">
            ${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}
          </select>
        </label>
        <label>A4 <input type="number" id="tn-a4" value="440" min="415" max="466"> Hz</label>
        <button class="btn primary" id="tn-toggle">🎙 マイク開始</button>
      </div>
    </div>
    <div class="card tuner-display">
      <div class="tuner-note" id="tn-note">–</div>
      <div class="tuner-sub" id="tn-sub">マイクを開始して弦を鳴らしてください</div>
      <svg class="tuner-gauge" id="tn-gauge" viewBox="0 0 420 165"></svg>
      <div class="tuner-strings" id="tn-strings"></div>
      <p class="hint">目盛りは ±50 セント、緑＝±5 セント以内。弦名ボタンを押すと基準音が鳴ります。全弦が緑になれば完了です。</p>
    </div>
  `;

  buildGauge();
  buildStrings();

  panel.querySelector('#tn-preset').addEventListener('change', (e) => {
    presetId = e.target.value;
    doneStrings.clear();
    buildStrings();
  });
  panel.querySelector('#tn-a4').addEventListener('change', (e) => {
    a4 = Math.min(466, Math.max(415, Number(e.target.value) || 440));
  });
  panel.querySelector('#tn-toggle').addEventListener('click', toggleMic);
}

async function toggleMic() {
  const btn = panel.querySelector('#tn-toggle');
  if (micActive()) {
    stopLoop();
    btn.textContent = '🎙 マイク開始';
    btn.classList.add('primary');
    return;
  }
  try {
    const source = await startMic();
    const ctx = getCtx();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    btn.textContent = '⏹ 停止';
    btn.classList.remove('primary');
    doneStrings.clear();
    loop();
  } catch (e) {
    panel.querySelector('#tn-sub').textContent = `マイクを使用できません: ${e.message}`;
  }
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  stopMic();
  analyser = null;
  recentFreqs = [];
}

function loop() {
  rafId = requestAnimationFrame(loop);
  if (!analyser) return;
  analyser.getFloatTimeDomainData(buf);
  const r = detectPitch(buf, getCtx().sampleRate, {
    minFreq: 55,
    maxFreq: 1700,
    clarityThreshold: 0.86,
    rmsThreshold: 0.006,
  });
  render(r);
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function render(r) {
  const noteEl = panel.querySelector('#tn-note');
  const subEl = panel.querySelector('#tn-sub');
  const now = performance.now();

  if (r) {
    recentFreqs.push(r.freq);
    if (recentFreqs.length > 5) recentFreqs.shift();
    lastGoodTime = now;
  } else if (now - lastGoodTime > 700) {
    recentFreqs = [];
    noteEl.classList.remove('in-tune');
    noteEl.style.opacity = 0.35;
    setNeedle(null);
    highlightString(-1);
    inTuneCount = 0;
    return;
  }
  if (recentFreqs.length === 0) return;

  noteEl.style.opacity = 1;
  const freq = median(recentFreqs);
  const strings = PRESETS[presetId].strings;

  let displayName, displayOct, cents, targetIdx = -1;
  if (strings) {
    // 最寄りの弦を対象にする
    let bestDist = Infinity;
    strings.forEach((m, i) => {
      const d = Math.abs(1200 * Math.log2(freq / midiToFreq(m, a4)));
      if (d < bestDist) { bestDist = d; targetIdx = i; }
    });
    const targetMidi = strings[targetIdx];
    cents = 1200 * Math.log2(freq / midiToFreq(targetMidi, a4));
    const nm = midiToName(targetMidi);
    displayName = nm.replace(/-?\d+$/, '');
    displayOct = nm.match(/-?\d+$/)[0];
  } else {
    const n = freqToNote(freq, a4);
    cents = n.cents;
    displayName = n.name.replace(/-?\d+$/, '');
    displayOct = n.name.match(/-?\d+$/)[0];
  }

  const inTune = Math.abs(cents) <= 5;
  noteEl.innerHTML = `${displayName}<span class="oct">${displayOct}</span>`;
  noteEl.classList.toggle('in-tune', inTune);
  subEl.textContent = `${cents >= 0 ? '+' : ''}${cents.toFixed(1)} ¢ ・ ${freq.toFixed(2)} Hz`;
  setNeedle(cents, inTune);
  highlightString(targetIdx);

  // 1秒間チューニング内が続いたらその弦を「完了」に
  if (strings && targetIdx >= 0) {
    inTuneCount = inTune ? inTuneCount + 1 : 0;
    if (inTuneCount > 45 && !doneStrings.has(`${presetId}-${targetIdx}`)) {
      doneStrings.add(`${presetId}-${targetIdx}`);
      buildStrings();
    }
  }
}

// ---- ゲージ ----

function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function buildGauge() {
  const cx = 210, cy = 150;
  let ticks = '';
  for (let c = -50; c <= 50; c += 5) {
    const deg = c * 1.2;
    const major = c % 25 === 0;
    const [x1, y1] = polar(cx, cy, 130, deg);
    const [x2, y2] = polar(cx, cy, major ? 112 : 120, deg);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c === 0 ? 'var(--green)' : 'var(--border)'}" stroke-width="${major ? 3 : 1.5}"/>`;
    if (major) {
      const [tx, ty] = polar(cx, cy, 98, deg);
      ticks += `<text x="${tx}" y="${ty}" fill="var(--text-dim)" font-size="12" text-anchor="middle" dominant-baseline="middle">${c > 0 ? '+' + c : c}</text>`;
    }
  }
  // ±5セントの緑ゾーン
  const [gx1, gy1] = polar(cx, cy, 136, -6);
  const [gx2, gy2] = polar(cx, cy, 136, 6);
  const zone = `<path d="M ${gx1} ${gy1} A 136 136 0 0 1 ${gx2} ${gy2}" stroke="var(--green)" stroke-width="5" fill="none" stroke-linecap="round" opacity="0.85"/>`;

  panel.querySelector('#tn-gauge').innerHTML = `
    ${zone}${ticks}
    <line id="tn-needle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 122}" stroke="var(--text-dim)" stroke-width="4" stroke-linecap="round" opacity="0.3"/>
    <circle cx="${cx}" cy="${cy}" r="7" fill="var(--bg-input)" stroke="var(--border)"/>
  `;
}

function setNeedle(cents, inTune = false) {
  const needle = panel.querySelector('#tn-needle');
  if (cents === null) {
    needle.style.opacity = 0.3;
    return;
  }
  const deg = Math.max(-50, Math.min(50, cents)) * 1.2;
  needle.style.opacity = 1;
  needle.setAttribute('transform', `rotate(${deg} 210 150)`);
  needle.setAttribute('stroke', inTune ? 'var(--green)' : 'var(--accent)');
}

// ---- 弦ボタン ----

function buildStrings() {
  const wrap = panel.querySelector('#tn-strings');
  const strings = PRESETS[presetId].strings;
  if (!strings) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = strings
    .map((m, i) => {
      const done = doneStrings.has(`${presetId}-${i}`) ? ' done' : '';
      return `<button class="string-btn${done}" data-i="${i}">${done ? '✓ ' : ''}${midiToName(m)}<small>${midiToFreq(m, a4).toFixed(1)} Hz</small></button>`;
    })
    .join('');
  wrap.querySelectorAll('.string-btn').forEach((b) =>
    b.addEventListener('click', () => pluckMidi(strings[Number(b.dataset.i)], 0, { gain: 0.5, dur: 2.5 }))
  );
}

function highlightString(idx) {
  panel.querySelectorAll('.string-btn').forEach((b, i) => b.classList.toggle('near', i === idx));
}

export function deactivate() {
  if (rafId) {
    stopLoop();
    const btn = panel.querySelector('#tn-toggle');
    btn.textContent = '🎙 マイク開始';
    btn.classList.add('primary');
  }
}
