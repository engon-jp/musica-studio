// 楽譜タブ: MusicXML / MXL / MIDI を読み込み → パート別の五線譜表示 → テンポ可変で演奏
// PDFの紙譜面は MuseScore 等で MusicXML に変換してから読み込む想定（タブ内に案内あり）

import { getCtx, resumeCtx } from '../audio-engine.js';
import { parseMidi, extractMxlXml, parseMusicXMLDoc } from '../score-io.js';
import { renderStaffSVG } from '../staff.js';
import { pianoNote } from '../synth.js';
import { adaptiveAhead } from '../metronome-core.js';
import { midiToName } from '../theory.js';

let panel;
let score = null; // {title, bpm, beatsPerBar, key, parts}
let enabled = [];
let playBpm = 120;
let play = null; // {t0, spb, idx, notes, timer, raf, nodes, endBeat, lastRun}

export function init(el) {
  panel = el;
  panel.innerHTML = `
    <div class="card">
      <div class="row">
        <button class="btn primary" id="sc-open">🎼 楽譜ファイルを開く</button>
        <input type="file" id="sc-file" accept=".musicxml,.xml,.mxl,.mid,.midi" hidden>
        <span class="hint" id="sc-name">MusicXML / MXL / MIDI（MuseScoreの「書き出し」から）</span>
      </div>
      <p class="hint">📄 紙の楽譜PDFは: MuseScore(無料)の「ファイル→インポート」やAudiverisでMusicXMLにしてから読み込んでください。
      リピート記号は展開せず頭から順に演奏します</p>
    </div>
    <div class="card" id="sc-control" style="display:none">
      <div class="row" id="sc-parts"></div>
      <div class="row">
        <button class="btn primary" id="sc-play">▶ 演奏</button>
        <label>テンポ</label>
        <input type="range" id="sc-bpm-slider" min="40" max="240" value="120" style="flex:1; min-width:120px">
        <span id="sc-bpm" style="font-weight:800; min-width:3.5em">120</span>
        <span class="hint" id="sc-bpm-orig"></span>
      </div>
      <div class="row">
        <button class="btn small" id="sc-to-harmony">🎤 先頭パートをハモリへ</button>
        <span class="hint">ゆっくり再生して練習 → ハモリ付け → MIDI/譜面化まで全部つながります</span>
      </div>
    </div>
    <div class="card" id="sc-view" style="display:none">
      <div class="tab-grid-wrap" id="sc-staves" style="overflow-x:auto; background:var(--bg-panel); border-radius:12px; padding:6px 2px"></div>
    </div>
  `;

  const $ = (s) => panel.querySelector(s);
  $('#sc-open').addEventListener('click', () => $('#sc-file').click());
  $('#sc-file').addEventListener('change', onFile);
  $('#sc-play').addEventListener('click', togglePlay);
  $('#sc-bpm-slider').addEventListener('input', (e) => {
    playBpm = Number(e.target.value);
    $('#sc-bpm').textContent = playBpm;
  });
  $('#sc-to-harmony').addEventListener('click', sendToHarmony);
}

async function onFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const nameEl = panel.querySelector('#sc-name');
  nameEl.textContent = '読み込み中…';
  stopPlay();
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'mid' || ext === 'midi') {
      score = parseMidi(new Uint8Array(await file.arrayBuffer()));
    } else {
      let xml;
      if (ext === 'mxl') xml = await extractMxlXml(new Uint8Array(await file.arrayBuffer()));
      else xml = await file.text();
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.querySelector('parsererror')) throw new Error('XMLの解析に失敗しました');
      score = parseMusicXMLDoc(doc);
    }
    if (!score.parts.length) throw new Error('音符のあるパートが見つかりません');
    if (!score.title) score = { ...score, title: file.name.replace(/\.[^.]+$/, '') };
    enabled = score.parts.map(() => true);
    playBpm = Math.min(240, Math.max(40, score.bpm || 120));
    panel.querySelector('#sc-bpm-slider').value = playBpm;
    panel.querySelector('#sc-bpm').textContent = playBpm;
    panel.querySelector('#sc-bpm-orig').textContent = `（ファイル指定: ${score.bpm} BPM）`;
    const totalNotes = score.parts.reduce((s, p) => s + p.notes.length, 0);
    nameEl.textContent = `「${score.title}」 ${score.parts.length}パート・${totalNotes}音`;
    panel.querySelector('#sc-control').style.display = '';
    panel.querySelector('#sc-view').style.display = '';
    buildParts();
    drawStaves();
  } catch (err) {
    nameEl.textContent = '読み込み失敗: ' + err.message;
  }
  e.target.value = '';
}

function buildParts() {
  const wrap = panel.querySelector('#sc-parts');
  wrap.innerHTML = '<label>パート:</label>' + score.parts
    .map((p, i) => {
      const lo = Math.min(...p.notes.map((n) => n.midi));
      const hi = Math.max(...p.notes.map((n) => n.midi));
      return `<label><input type="checkbox" data-part="${i}" ${enabled[i] ? 'checked' : ''}>
        ${p.name}（${p.notes.length}音 ${midiToName(lo)}〜${midiToName(hi)}）</label>`;
    })
    .join('');
  wrap.querySelectorAll('input[data-part]').forEach((cb) =>
    cb.addEventListener('change', () => {
      enabled[Number(cb.dataset.part)] = cb.checked;
      drawStaves();
    })
  );
}

const PART_COLORS = ['#5b8cff', '#3ecf8e', '#ffd166', '#ff8fa3', '#b58cff', '#e0795a'];

function totalBeats() {
  let end = 4;
  score.parts.forEach((p, i) => {
    if (!enabled[i]) return;
    for (const n of p.notes) end = Math.max(end, n.start + n.dur);
  });
  return end;
}

function drawStaves(playheadBeat = null) {
  if (!score) return;
  const beats = totalBeats();
  const ppb = beats > 240 ? 28 : 48;
  const opts = {
    tonic: score.key?.tonic ?? 0,
    mode: score.key?.mode ?? 'major',
    beatsPerBar: score.beatsPerBar || 4,
    minBeats: Math.ceil(beats / (score.beatsPerBar || 4)) * (score.beatsPerBar || 4),
    pxPerBeat: ppb,
  };
  let html = '<div style="display:inline-block; min-width:100%">';
  score.parts.forEach((p, i) => {
    if (!enabled[i]) return;
    const avg = p.notes.reduce((s, n) => s + n.midi, 0) / p.notes.length;
    const clef = avg < 57 ? 'bass' : 'treble';
    html += `<div class="hint" style="padding:2px 8px">${p.name}</div>` +
      `<div>${renderStaffSVG([{ notes: p.notes, color: PART_COLORS[i % PART_COLORS.length], name: p.name }], { ...opts, clef })}</div>`;
  });
  html += '</div>';
  panel.querySelector('#sc-staves').innerHTML = html;
  if (playheadBeat !== null) setPlayheads(playheadBeat);
}

function setPlayheads(beat) {
  for (const svg of panel.querySelectorAll('#sc-staves svg')) {
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

// ---- 演奏（先読みスケジューリング。長い曲でも重くならない）----

async function togglePlay() {
  if (play) { stopPlay(); return; }
  if (!score) return;
  await resumeCtx();
  const notes = [];
  score.parts.forEach((p, i) => {
    if (enabled[i]) notes.push(...p.notes);
  });
  if (!notes.length) return;
  notes.sort((a, b) => a.start - b.start);
  const ctx = getCtx();
  play = {
    t0: ctx.currentTime + 0.15,
    spb: 60 / playBpm,
    idx: 0,
    notes,
    nodes: [],
    lastRun: 0,
    endBeat: totalBeats(),
    timer: setInterval(schedule, 25),
    raf: 0,
  };
  panel.querySelector('#sc-play').textContent = '⏹ 停止';
  schedule();
  visualLoop();
}

function schedule() {
  if (!play) return;
  const ctx = getCtx();
  const nowMs = performance.now();
  const gap = play.lastRun ? (nowMs - play.lastRun) / 1000 : 0.025;
  play.lastRun = nowMs;
  const ahead = adaptiveAhead(gap);
  const gain = 0.22;
  while (play.idx < play.notes.length) {
    const n = play.notes[play.idx];
    const t = play.t0 + n.start * play.spb;
    if (t >= ctx.currentTime + ahead) break;
    play.idx++;
    play.nodes.push(pianoNote(n.midi, t, Math.max(0.1, n.dur * play.spb * 0.92), { gain }));
    if (play.nodes.length > 96) play.nodes.splice(0, 48);
  }
}

function visualLoop() {
  if (!play) return;
  play.raf = requestAnimationFrame(visualLoop);
  const beat = (getCtx().currentTime - play.t0) / play.spb;
  if (beat > play.endBeat + 2) { stopPlay(); return; }
  setPlayheads(Math.max(0, beat));
  // 再生ヘッドを追いかけてスクロール
  const svg = panel.querySelector('#sc-staves svg');
  const wrap = panel.querySelector('#sc-staves');
  if (svg && wrap) {
    const x = Number(svg.dataset.x0) + Math.max(0, beat) * Number(svg.dataset.ppb);
    if (x > wrap.scrollLeft + wrap.clientWidth * 0.7 || x < wrap.scrollLeft) {
      wrap.scrollLeft = Math.max(0, x - wrap.clientWidth * 0.35);
    }
  }
}

function stopPlay() {
  if (!play) return;
  clearInterval(play.timer);
  cancelAnimationFrame(play.raf);
  for (const n of play.nodes) { try { n.stop(0); } catch { /* 停止済み */ } }
  play = null;
  panel.querySelector('#sc-play').textContent = '▶ 演奏';
  setPlayheads(null);
}

// ---- ハモリタブへ（先頭の有効パートをメロディとして送る）----

function sendToHarmony() {
  if (!score) return;
  const i = enabled.findIndex((v) => v);
  if (i < 0) return;
  const spb = 60 / playBpm;
  window.msBridge.send('harmony', 'melody', {
    notes: score.parts[i].notes.map((n) => ({ midi: n.midi, start: n.start * spb, dur: n.dur * spb })),
    bpm: playBpm,
    offset: null,
    from: 'score',
  });
}

export function deactivate() {
  stopPlay();
}
