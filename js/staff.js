// 五線譜 SVG レンダラ（純関数・DOM非依存 — Node テスト対象）
// 簡易記譜: 音価は 全音符(4拍〜)/2分(2拍〜)/4分(1拍〜)/8分(0.5拍〜)/16分 を
// 符頭・符幹・旗で表現。連桁・休符・付点は使わない（見て歌うための譜面）。

import { SHARP_NAMES, FLAT_NAMES, MAJOR_SCALE, MINOR_SCALE } from './theory.js';

// 調号: メジャーの主音（マイナーは平行調に変換）→ ♯/♭ の数
export function keySignature(tonic, mode = 'major') {
  const majorPc = mode === 'minor' ? (tonic + 3) % 12 : ((tonic % 12) + 12) % 12;
  const s = (majorPc * 7) % 12; // 五度圏: シャープ s 個の調の主音は (7s) mod 12
  return s <= 6 ? { type: 'sharp', count: s } : { type: 'flat', count: 12 - s };
}

const LETTER_IDX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// midi → 譜表ステップ（C0=0, 1文字=1、C4=28, E4=30）と臨時記号
export function midiToStaff(midi, useFlat = false) {
  const pc = ((midi % 12) + 12) % 12;
  const name = useFlat ? FLAT_NAMES[pc] : SHARP_NAMES[pc];
  const oct = Math.floor(midi / 12) - 1;
  return {
    step: oct * 7 + LETTER_IDX[name[0]],
    accidental: name[1] || null, // '#' | 'b' | null
  };
}

// 調号の ♯/♭ を置くステップ位置（ト音記号）
const SHARP_STEPS = [38, 35, 39, 36, 33, 37, 34]; // F5 C5 G5 D5 A4 E5 B4
const FLAT_STEPS = [34, 37, 33, 36, 32, 35, 31];  // B4 E5 A4 D5 G4 C5 F4

// 調号が変化させる文字の順（♯: F C G D A E B ／ ♭: B E A D G C F）
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // LETTER_IDX で F=3, C=0, ...
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B

// 譜表ステップ → MIDI（調号を適用したダイアトニック音。五線譜クリック編集用）
export function staffStepToMidi(step, tonic = 0, mode = 'major') {
  const ks = keySignature(tonic, mode);
  const letter = ((step % 7) + 7) % 7;
  const octave = Math.floor(step / 7);
  let acc = 0;
  const order = ks.type === 'sharp' ? SHARP_ORDER : FLAT_ORDER;
  if (order.slice(0, ks.count).includes(letter)) acc = ks.type === 'sharp' ? 1 : -1;
  return (octave + 1) * 12 + LETTER_PC[letter] + acc;
}

// voices: [{ notes: [{midi, start(拍), dur(拍)}], color, name }]
// opts.clef: 'treble'（ト音・既定）| 'bass'（ヘ音）。opts.minBeats で複数譜表の幅を揃える
// 戻り値: SVG文字列。root に data-x0 / data-ppb（再生ヘッド位置計算用）
export function renderStaffSVG(voices, opts = {}) {
  const {
    tonic = 0, mode = 'major', clef = 'treble',
    beatsPerBar = 4, pxPerBeat = 48, gap = 9, minBeats = 0,
    textColor = '#46403a', lineColor = '#b7ab99',
  } = opts;

  const ks = keySignature(tonic, mode);
  const useFlat = ks.type === 'flat';
  const scale = mode === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
  const scaleSet = new Set(scale.map((iv) => (tonic + iv) % 12));

  // 譜表の下線/上線ステップ（ト音: E4=30〜F5=38 ／ ヘ音: G2=18〜A3=26）
  const staffBottom = clef === 'bass' ? 18 : 30;
  const staffTop = staffBottom + 8;

  const all = voices.flatMap((v) => v.notes);
  const lastBeat = all.length ? Math.max(...all.map((n) => n.start + n.dur)) : beatsPerBar;
  const totalBeats = Math.max(minBeats, beatsPerBar, Math.ceil(lastBeat / beatsPerBar) * beatsPerBar);

  const steps = all.map((n) => midiToStaff(n.midi, useFlat).step);
  const topStep = Math.max(staffTop + 4, (steps.length ? Math.max(...steps) : staffTop) + 3);
  const bottomStep = Math.min(staffBottom - 4, (steps.length ? Math.min(...steps) : staffBottom) - 3);

  const topMargin = 14, bottomMargin = 12;
  const yOf = (step) => topMargin + ((topStep - step) * gap) / 2;
  const left = 16 + gap * 4.6 + ks.count * gap * 1.15;
  const x0 = left + gap * 1.5;
  const xOf = (beat) => x0 + beat * pxPerBeat;
  const W = Math.ceil(xOf(totalBeats) + 12);
  const H = Math.ceil(yOf(bottomStep) + bottomMargin);

  let s = '';

  // 五線
  for (let st = staffBottom; st <= staffTop; st += 2) {
    s += `<line x1="4" y1="${yOf(st)}" x2="${W - 4}" y2="${yOf(st)}" stroke="${lineColor}" stroke-width="1"/>`;
  }
  // 小節線
  for (let b = 0; b <= totalBeats; b += beatsPerBar) {
    const x = xOf(b) - pxPerBeat * 0.18;
    s += `<line x1="${x}" y1="${yOf(staffTop)}" x2="${x}" y2="${yOf(staffBottom)}" stroke="${lineColor}" stroke-width="${b === 0 || b === totalBeats ? 1.8 : 1}"/>`;
  }
  // 音部記号（システムフォントの記譜グリフ）
  if (clef === 'bass') {
    s += `<text x="10" y="${yOf(staffTop - 2) + gap * 1.5}" font-size="${gap * 3.9}" fill="${textColor}">𝄢</text>`;
  } else {
    s += `<text x="8" y="${yOf(32) + gap * 1.6}" font-size="${gap * 5}" fill="${textColor}">𝄞</text>`;
  }
  // 調号（ヘ音記号は各位置が2オクターブ−1度＝14ステップ下）
  const clefShift = clef === 'bass' ? 14 : 0;
  const sigSteps = useFlat ? FLAT_STEPS : SHARP_STEPS;
  const sigGlyph = useFlat ? '♭' : '♯';
  for (let i = 0; i < ks.count; i++) {
    s += `<text x="${16 + gap * 4.6 + i * gap * 1.15}" y="${yOf(sigSteps[i] - clefShift) + gap * 0.42}" font-size="${gap * 2.2}" fill="${textColor}" text-anchor="middle">${sigGlyph}</text>`;
  }

  // 音符（voices 順に描画 = 後のボイスが上に載る）
  const headRx = gap * 0.66, headRy = gap * 0.5;
  for (const v of voices) {
    for (const n of v.notes) {
      const { step, accidental } = midiToStaff(n.midi, useFlat);
      const hx = xOf(n.start) + headRx;
      const hy = yOf(step);

      // 加線（譜表の外側の偶数ステップに音符位置まで）
      if (step <= staffBottom - 2) {
        for (let st = staffBottom - 2; st >= step; st -= 2) s += ledger(hx, yOf(st), gap, lineColor);
      }
      if (step >= staffTop + 2) {
        for (let st = staffTop + 2; st <= step; st += 2) s += ledger(hx, yOf(st), gap, lineColor);
      }

      // 臨時記号（スケール外の音のみ。調号でカバーされる音は省略）
      const pc = ((n.midi % 12) + 12) % 12;
      if (!scaleSet.has(pc)) {
        const glyph = accidental === '#' ? '♯' : accidental === 'b' ? '♭' : '♮';
        s += `<text x="${hx - gap * 1.7}" y="${hy + gap * 0.42}" font-size="${gap * 1.9}" fill="${v.color}" text-anchor="middle">${glyph}</text>`;
      }

      // 符頭
      const hollow = n.dur >= 2;
      s += `<ellipse cx="${hx}" cy="${hy}" rx="${headRx}" ry="${headRy}" transform="rotate(-14 ${hx} ${hy})" ` +
        (hollow ? `fill="none" stroke="${v.color}" stroke-width="1.9"` : `fill="${v.color}"`) + '/>';

      // 符幹と旗（全音符は幹なし）
      if (n.dur < 4) {
        const up = step < staffBottom + 4;
        const sx = up ? hx + headRx * 0.88 : hx - headRx * 0.88;
        const sy1 = hy + (up ? -1 : 1) * headRy * 0.4;
        const sy2 = hy + (up ? -1 : 1) * gap * 3.1;
        s += `<line x1="${sx}" y1="${sy1}" x2="${sx}" y2="${sy2}" stroke="${v.color}" stroke-width="1.6"/>`;
        const flags = n.dur < 0.5 ? 2 : n.dur < 1 ? 1 : 0;
        for (let f = 0; f < flags; f++) {
          const fy = sy2 + (up ? 1 : -1) * (f * gap * 0.75);
          s += `<path d="M ${sx} ${fy} q ${gap * 1.1} ${(up ? 1 : -1) * gap * 0.55} ${gap * 0.55} ${(up ? 1 : -1) * gap * 1.6}" stroke="${v.color}" stroke-width="1.4" fill="none"/>`;
        }
      }
    }
  }

  // 再生ヘッド（呼び出し側が x を動かす）
  s += `<line data-role="staff-playhead" x1="${x0}" y1="${yOf(topStep)}" x2="${x0}" y2="${yOf(bottomStep)}" stroke="#e0795a" stroke-width="2" opacity="0"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-x0="${x0}" data-ppb="${pxPerBeat}" data-topstep="${topStep}" data-topmargin="${topMargin}" data-gap="${gap}" data-useflat="${useFlat ? 1 : 0}">${s}</svg>`;
}

function ledger(hx, y, gap, color) {
  return `<line x1="${hx - gap * 1.15}" y1="${y}" x2="${hx + gap * 1.15}" y2="${y}" stroke="${color}" stroke-width="1"/>`;
}
