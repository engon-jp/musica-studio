// ピアノタブ: コード進行（＋メロディ）からピアノ伴奏を自動アレンジ → 大譜表表示・再生・MIDI
// おまけ: 耳コピ音源から「主要音スケッチ」採譜（実験的）

import { getCtx, resumeCtx } from '../audio-engine.js';
import { estimateKeyFromNotes } from '../theory.js';
import { parseProgressionText, arrangePiano, STYLES } from '../arranger.js';
import { renderStaffSVG } from '../staff.js';
import { pianoNote } from '../synth.js';
import { buildMidi } from '../midi.js';
import { sketchNotes } from '../dsp.js';

let panel;
let bpm = 100;
let melodyBuf = null; // ハモリタブ由来のメロディ（RHに使う）
let arr = null; // {rh, lh, totalBeats}
let arrKey = { tonic: 0, mode: 'major' };
let playState = null;
let playNodes = [];
let rafId = null;

export function init(el) {
  panel = el;
  panel.innerHTML = `
    <div class="card">
      <div class="row">
        <button class="btn" id="pn-from-prog">🧠 耳コピの解析結果を取り込む</button>
        <button class="btn" id="pn-from-harmony">🎤 ハモリのメロディを右手に</button>
        <button class="btn small" id="pn-mel-clear" style="display:none">メロディ解除</button>
      </div>
      <div class="row">
        <textarea id="pn-prog" style="min-height:90px" placeholder="コード進行を書く: 空白区切り＝1小節、カンマ＝小節内分割&#10;例) C G Am Em&#10;    F C F,G C"></textarea>
      </div>
      <div class="row">
        <label>スタイル
          <select id="pn-style">${Object.entries(STYLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        </label>
        <label>BPM <input type="number" id="pn-bpm" value="100" min="40" max="240"></label>
        <button class="btn primary" id="pn-gen">🎹 アレンジ生成</button>
        <span class="hint" id="pn-status"></span>
      </div>
    </div>
    <div class="card">
      <div class="row no-print">
        <button class="btn" id="pn-play" disabled>▶ 再生</button>
        <button class="btn" id="pn-midi" disabled>💾 MIDI書き出し</button>
        <span class="hint" id="pn-info"></span>
      </div>
      <div class="tab-grid-wrap" id="pn-staves" style="margin-top:8px; overflow-x:auto; background:var(--bg-panel); border-radius:12px; padding:6px 2px">
        <p class="hint" style="padding:10px">「🎹 アレンジ生成」を押すと、右手（ト音記号）と左手（ヘ音記号）の大譜表がここに出ます</p>
      </div>
      <p class="hint">青＝右手 ／ 緑＝左手。MIDI は MuseScore 等で開けば印刷用のピアノ譜になります</p>
    </div>
    <div class="card">
      <div class="row">
        <button class="btn" id="pn-sketch">🎧 耳コピ音源から主要音を採譜（実験的）</button>
      </div>
      <p class="hint">耳コピタブで音源を読み込み、聴きたい区間にA-Bを張ってから押してください（未指定なら先頭20秒）。
      鳴っている音の「スケッチ」です — ピアノ以外の音も混ざります。C4以上を右手・未満を左手に振り分けます</p>
    </div>
  `;

  const $ = (s) => panel.querySelector(s);
  $('#pn-bpm').addEventListener('change', (e) => { bpm = Number(e.target.value) || 100; });
  $('#pn-gen').addEventListener('click', generate);
  $('#pn-play').addEventListener('click', togglePlay);
  $('#pn-midi').addEventListener('click', exportMidi);
  $('#pn-from-prog').addEventListener('click', importProgression);
  $('#pn-from-harmony').addEventListener('click', importMelody);
  $('#pn-mel-clear').addEventListener('click', () => setMelody(null, ''));
  $('#pn-sketch').addEventListener('click', sketchFromAudio);

  // 初期デモ（カノン風）
  $('#pn-prog').value = 'C G Am Em\nF C F,G C';
}

function status(msg) {
  panel.querySelector('#pn-status').textContent = msg;
}

function setMelody(notes, msg) {
  melodyBuf = notes;
  panel.querySelector('#pn-mel-clear').style.display = notes ? '' : 'none';
  status(msg);
}

// ---- 取り込み ----

function importProgression() {
  const prog = window.msBridge.data.progression;
  if (!prog) {
    status('先に耳コピタブで「🧠 コード進行（曲全体）」を実行してください');
    return;
  }
  const tokens = [];
  for (const s of prog.segments) {
    const bars = Math.max(1, Math.round(s.beats / 4));
    for (let i = 0; i < bars; i++) tokens.push(s.chord);
  }
  const lines = [];
  for (let i = 0; i < tokens.length; i += 4) lines.push(tokens.slice(i, i + 4).join(' '));
  panel.querySelector('#pn-prog').value = lines.join('\n');
  bpm = prog.bpm || bpm;
  panel.querySelector('#pn-bpm').value = bpm;
  status(`「${prog.file}」の進行を取り込みました（BPM ${bpm}）`);
}

function importMelody() {
  const hm = window.msBridge.data.harmonyMelody;
  if (!hm || hm.notes.length === 0) {
    status('先にハモリタブでメロディを用意してください（デモでもOK）');
    return;
  }
  bpm = hm.bpm || bpm;
  panel.querySelector('#pn-bpm').value = bpm;
  setMelody(hm.notes.map((n) => ({ ...n })), `メロディ ${hm.notes.length} 音を右手に使います`);
}

// ---- 生成・表示 ----

function generate() {
  const chords = parseProgressionText(panel.querySelector('#pn-prog').value);
  if (chords.length === 0 && !melodyBuf) {
    status('コード進行を入力してください（例: C G Am Em）');
    return;
  }
  const style = panel.querySelector('#pn-style').value;
  arr = arrangePiano(chords, melodyBuf, style);
  const all = [...arr.rh, ...arr.lh].map((n) => ({ midi: n.midi, dur: n.dur }));
  arrKey = all.length ? (({ tonic, mode }) => ({ tonic, mode }))(estimateKeyFromNotes(all)) : { tonic: 0, mode: 'major' };
  drawStaves();
  panel.querySelector('#pn-play').disabled = false;
  panel.querySelector('#pn-midi').disabled = false;
  panel.querySelector('#pn-info').textContent =
    `${chords.length}コード / RH ${arr.rh.length}音・LH ${arr.lh.length}音 / ${Math.round(arr.totalBeats / 4)}小節`;
  status(melodyBuf ? '右手=メロディ、左手=伴奏で生成しました' : '右手=コンピング、左手=ベースパターンで生成しました');
}

function drawStaves(playheadBeat = null) {
  if (!arr) return;
  const opts = { tonic: arrKey.tonic, mode: arrKey.mode, minBeats: arr.totalBeats };
  const svgT = renderStaffSVG([{ notes: arr.rh, color: '#5b8cff', name: 'RH' }], { ...opts, clef: 'treble' });
  const svgB = renderStaffSVG([{ notes: arr.lh, color: '#3ecf8e', name: 'LH' }], { ...opts, clef: 'bass' });
  panel.querySelector('#pn-staves').innerHTML =
    `<div style="display:inline-block; min-width:100%">${svgT}<div style="margin-top:-4px">${svgB}</div></div>`;
  if (playheadBeat !== null) setPlayheads(playheadBeat);
}

function setPlayheads(beat) {
  for (const svg of panel.querySelectorAll('#pn-staves svg')) {
    const line = svg.querySelector('[data-role="staff-playhead"]');
    if (!line) continue;
    if (beat === null) {
      line.setAttribute('opacity', 0);
      continue;
    }
    const x = Number(svg.dataset.x0) + beat * Number(svg.dataset.ppb);
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('opacity', 0.8);
  }
}

// ---- 再生 ----

async function togglePlay() {
  if (playState) { stopPlayback(); return; }
  if (!arr) return;
  await resumeCtx();
  const ctx = getCtx();
  const spb = 60 / bpm;
  const t0 = ctx.currentTime + 0.15;
  playNodes = [];
  for (const n of arr.rh) playNodes.push(pianoNote(n.midi, t0 + n.start * spb, Math.max(0.12, n.dur * spb), { gain: 0.24 }));
  for (const n of arr.lh) playNodes.push(pianoNote(n.midi, t0 + n.start * spb, Math.max(0.12, n.dur * spb), { gain: 0.28 }));
  const endBeat = arr.totalBeats;
  playState = { t0, spb, endBeat };
  panel.querySelector('#pn-play').textContent = '⏹ 停止';
  const tick = () => {
    if (!playState) return;
    rafId = requestAnimationFrame(tick);
    const beat = (getCtx().currentTime - playState.t0) / playState.spb;
    if (beat > playState.endBeat + 1) { stopPlayback(); return; }
    setPlayheads(Math.max(0, beat));
  };
  tick();
}

function stopPlayback() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  for (const n of playNodes) { try { n.stop(0); } catch { /* 停止済み */ } }
  playNodes = [];
  playState = null;
  panel.querySelector('#pn-play').textContent = '▶ 再生';
  setPlayheads(null);
}

// ---- MIDI ----

function exportMidi() {
  if (!arr) return;
  const bytes = buildMidi(
    [{ name: 'Piano RH', notes: arr.rh }, { name: 'Piano LH', notes: arr.lh }],
    bpm
  );
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'piano-arrangement.mid';
  a.click();
  URL.revokeObjectURL(a.href);
  status('MIDI を書き出しました（MuseScore で開くと印刷用ピアノ譜になります）');
}

// ---- 主要音スケッチ（実験的）----

function sketchFromAudio() {
  const ea = window.msBridge.data.earcopyAudio;
  const mono = ea?.getMono?.();
  if (!mono || !mono.data) {
    status('耳コピタブで音源を読み込んでから来てください');
    return;
  }
  status('主要音を採譜中…');
  setTimeout(() => {
    const a = mono.a ?? 0;
    const b = mono.b ?? Math.min(mono.data.length / mono.sr, a + 20);
    const s0 = Math.floor(a * mono.sr);
    const s1 = Math.min(mono.data.length, Math.floor(Math.min(b, a + 20) * mono.sr));
    const notes = sketchNotes(mono.data.subarray(s0, s1), mono.sr);
    if (notes.length === 0) {
      status('音を検出できませんでした');
      return;
    }
    const spb = 60 / bpm;
    const grid = 0.25;
    const q = (t) => Math.max(0, Math.round(t / spb / grid) * grid);
    const rh = [], lh = [];
    for (const n of notes) {
      const note = { midi: n.midi, start: q(n.start), dur: Math.max(grid, q(n.start + n.dur) - q(n.start)), vel: 90 };
      (n.midi >= 60 ? rh : lh).push(note);
    }
    const endBeat = Math.max(...[...rh, ...lh].map((n) => n.start + n.dur), 4);
    arr = { rh, lh, totalBeats: Math.ceil(endBeat / 4) * 4 };
    const all = [...rh, ...lh].map((n) => ({ midi: n.midi, dur: n.dur }));
    arrKey = (({ tonic, mode }) => ({ tonic, mode }))(estimateKeyFromNotes(all));
    drawStaves();
    panel.querySelector('#pn-play').disabled = false;
    panel.querySelector('#pn-midi').disabled = false;
    panel.querySelector('#pn-info').textContent = `スケッチ ${notes.length}音（RH ${rh.length}・LH ${lh.length}）`;
    status('主要音スケッチを譜面にしました。候補です — 耳で整えてください');
  }, 30);
}

export function deactivate() {
  stopPlayback();
}
