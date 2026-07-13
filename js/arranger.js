// ピアノ自動アレンジ（純関数・DOM非依存 — Node テスト対象）
// コード進行（＋あればメロディ）から、左手パターンと右手（メロディ or ボイスリーディング
// されたコンピング）を生成する。出力はビート単位のノート列（MIDI書き出し・譜面表示兼用）。

import { parseChord, chordTones } from './theory.js';

// テキスト → コード列。空白区切り=1小節(4拍)、カンマ区切りは小節内で等分
// 例: "C Am Dm7,G7 C" → C(4) Am(4) Dm7(2) G7(2) C(4)
export function parseProgressionText(text) {
  const items = [];
  for (const line of String(text).split('\n')) {
    for (const tok of line.trim().split(/\s+/)) {
      if (!tok) continue;
      const parts = tok.split(',').filter((p) => p.length > 0);
      const beats = 4 / parts.length;
      for (const p of parts) {
        if (parseChord(p)) items.push({ symbol: p, beats });
      }
    }
  }
  return items;
}

// 前のボイシングに最も近い転回形を選ぶ（右手コンピング用・C4周辺）
export function nearestVoicing(pcs, prev = null, center = 65) {
  const n = pcs.length;
  let best = null;
  for (let rot = 0; rot < n; rot++) {
    const v = [];
    let last = -Infinity;
    for (let i = 0; i < n; i++) {
      let m = 60 + (((pcs[(rot + i) % n]) % 12) + 12) % 12;
      while (m <= last) m += 12;
      v.push(m);
      last = m;
    }
    for (const shift of [-12, 0, 12]) {
      const vv = v.map((m) => m + shift);
      const avg = vv.reduce((a, b) => a + b, 0) / n;
      if (avg < 57 || avg > 75) continue;
      const score = prev
        ? vv.reduce((s, m) => s + Math.min(...prev.map((pm) => Math.abs(m - pm))), 0)
        : Math.abs(avg - center) * 2;
      if (!best || score < best.score) best = { v: vv, score };
    }
  }
  return best ? best.v : pcs.map((pc) => 60 + pc);
}

export const STYLES = {
  simple: { label: 'シンプル（全音符）' },
  ballad: { label: 'バラード（アルペジオ）' },
  pop8: { label: 'ポップス（8ビート）' },
  bossa: { label: 'ボサノヴァ' },
};

// 1小節ぶんの左手パターン（beats 拍に切り詰め）
function lhPattern(style, root, fifth, beats) {
  const ev = [];
  const add = (off, midi, dur, vel = 88) => {
    if (off < beats) ev.push({ off, midi, dur: Math.min(dur, beats - off), vel });
  };
  switch (style) {
    case 'ballad':
      // 1-5-1(オクターブ上)-5 の8分アルペジオ
      for (let i = 0; i < 8; i++) {
        const m = i % 4 === 0 ? root : i % 2 === 1 ? fifth : root + 12;
        add(i * 0.5, m, 0.5, i % 4 === 0 ? 92 : 76);
      }
      break;
    case 'pop8':
      for (let i = 0; i < 8; i++) {
        add(i * 0.5, i >= 6 ? fifth : root, 0.5, i % 2 === 0 ? 92 : 72);
      }
      break;
    case 'bossa':
      // ルート付点4分 → 5度8分 のツーフィール
      add(0, root, 1.5, 92);
      add(1.5, fifth, 0.5, 74);
      add(2, root, 1.5, 88);
      add(3.5, fifth, 0.5, 74);
      break;
    default: // simple
      add(0, root, beats, 88);
      add(0, root + 12, beats, 62);
  }
  return ev;
}

// 1小節ぶんの右手コンピング（メロディなしの場合）
function rhPattern(style, voicing, beats) {
  const hits =
    style === 'ballad' ? [[0, 2], [2, 2]]
    : style === 'pop8' ? [[1, 0.5], [2.5, 0.5], [3.5, 0.5]]
    : style === 'bossa' ? [[1.5, 0.75], [3, 0.75]]
    : [[0, beats]];
  const ev = [];
  for (const [off, dur] of hits) {
    if (off >= beats) continue;
    for (const m of voicing) ev.push({ off, midi: m, dur: Math.min(dur, beats - off), vel: 78 });
  }
  return ev;
}

// メイン: chords=[{symbol,beats}] melody=[{midi,start,dur}]|null
export function arrangePiano(chords, melody = null, style = 'simple') {
  const lh = [];
  const rh = [];
  let beat = 0;
  let prevVoicing = null;
  for (const c of chords) {
    const p = parseChord(c.symbol);
    if (!p) continue;
    const bassPc = p.bass !== null && p.bass !== undefined ? p.bass : p.root;
    const root = 36 + ((bassPc % 12) + 12) % 12; // C2〜B2
    for (const e of lhPattern(style, root, root + 7, c.beats)) {
      lh.push({ midi: e.midi, start: beat + e.off, dur: e.dur, vel: e.vel });
    }
    if (!melody || melody.length === 0) {
      const tones = chordTones(c.symbol).slice(0, 4);
      const v = nearestVoicing(tones, prevVoicing);
      prevVoicing = v;
      for (const e of rhPattern(style, v, c.beats)) {
        rh.push({ midi: e.midi, start: beat + e.off, dur: e.dur, vel: e.vel });
      }
    }
    beat += c.beats;
  }
  if (melody && melody.length > 0) {
    for (const n of melody) rh.push({ midi: n.midi, start: n.start, dur: n.dur, vel: 100 });
    beat = Math.max(beat, ...melody.map((n) => n.start + n.dur));
  }
  rh.sort((a, b) => a.start - b.start);
  lh.sort((a, b) => a.start - b.start);
  return { rh, lh, totalBeats: Math.ceil(beat / 4) * 4 };
}
