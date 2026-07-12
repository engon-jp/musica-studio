// 自動テスト: node test/run-tests.mjs
import { detectPitch, pitchTrack, framesToNotes } from '../js/pitch.js';
import {
  midiToFreq, freqToNote, midiToName, noteToPc, parseChord, chordTones,
  transposeChord, estimateKey, estimateKeyFromNotes, keyName,
  snapToScale, diatonicShift, generateHarmony,
} from '../js/theory.js';

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error(`  ✗ FAIL: ${msg}`); }
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const SR = 44100;

function sine(freq, n = 2048, sr = SR, amp = 0.5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return b;
}

function saw(freq, n = 2048, sr = SR, amp = 0.5, harmonics = 12) {
  const b = new Float32Array(n);
  for (let h = 1; h <= harmonics; h++) {
    for (let i = 0; i < n; i++) {
      b[i] += ((amp * (h % 2 ? 1 : -1)) / h) * Math.sin((2 * Math.PI * freq * h * i) / sr);
    }
  }
  return b;
}

console.log('--- ピッチ検出（MPM）---');
const guitarFreqs = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63]; // E2 A2 D3 G3 B3 E4
const extraFreqs = [440, 660, 987.77, 73.42]; // A4, E5, B5, D2(ドロップD)
for (const f of [...guitarFreqs, ...extraFreqs]) {
  for (const [gen, label] of [[sine, 'sine'], [saw, 'saw']]) {
    const r = detectPitch(gen(f), SR);
    ok(r !== null, `${label} ${f}Hz: 検出できること`);
    if (r) {
      const centsErr = Math.abs(1200 * Math.log2(r.freq / f));
      ok(centsErr < 1.0, `${label} ${f}Hz: 誤差 ${centsErr.toFixed(3)}¢ < 1¢`);
    }
  }
}
// 48kHz（iOS想定）でも
for (const f of [82.41, 329.63, 440]) {
  const r = detectPitch(sine(f, 2048, 48000), 48000);
  const centsErr = r ? Math.abs(1200 * Math.log2(r.freq / f)) : 999;
  ok(centsErr < 1.0, `48kHz sine ${f}Hz: 誤差 ${centsErr.toFixed(3)}¢ < 1¢`);
}
// 無音・ノイズは null
ok(detectPitch(new Float32Array(2048), SR) === null, '無音は null');
{
  const noise = new Float32Array(2048).map(() => Math.random() * 0.4 - 0.2);
  const r = detectPitch(noise, SR);
  ok(r === null || r.clarity < 0.95, 'ホワイトノイズを高確信で誤検出しないこと');
}

console.log('--- ピッチ軌跡 → ノート化 ---');
{
  // 0.3秒ずつ A3(220) → C#4(277.18) → E4(329.63)
  const sr = SR;
  const seg = Math.floor(0.3 * sr);
  const data = new Float32Array(seg * 3);
  data.set(sine(220, seg, sr), 0);
  data.set(sine(277.18, seg, sr), seg);
  data.set(sine(329.63, seg, sr), seg * 2);
  const frames = pitchTrack(data, sr);
  const notes = framesToNotes(frames);
  eq(notes.length, 3, 'ノート数が3');
  eq(notes.map((n) => n.midi).join(','), '57,61,64', 'A3, C#4, E4 と認識');
}

console.log('--- 音楽理論: 基本 ---');
eq(midiToName(69), 'A4', 'midi69=A4');
eq(midiToName(40), 'E2', 'midi40=E2');
eq(midiToName(61, true), 'Db4', 'midi61 フラット表記=Db4');
eq(noteToPc('C#'), 1, 'C#=1');
eq(noteToPc('Bb'), 10, 'Bb=10');
ok(Math.abs(midiToFreq(69) - 440) < 1e-9, 'midi69=440Hz');
{
  const n = freqToNote(445);
  eq(n.name, 'A4', '445Hz は A4');
  ok(Math.abs(n.cents - 19.56) < 0.1, `445Hz は +19.6¢ (got ${n.cents.toFixed(2)})`);
}

console.log('--- 音楽理論: コード ---');
{
  const p = parseChord('C#m7/G#');
  eq(p.root, 1, 'C#m7/G# root');
  eq(p.quality, 'm7', 'C#m7/G# quality');
  eq(p.bass, 8, 'C#m7/G# bass');
}
eq(parseChord('BbM7').quality, 'maj7', 'BbM7 → maj7 に正規化');
eq(parseChord('Xyz'), null, '不正コードは null');
eq(parseChord('Cmaj9').quality, 'maj9', 'Cmaj9');
eq(chordTones('C').join(','), '0,4,7', 'C = C,E,G');
eq(chordTones('Am').join(','), '9,0,4', 'Am = A,C,E');
eq(chordTones('G7').join(','), '7,11,2,5', 'G7 = G,B,D,F');
eq(transposeChord('C', 2), 'D', 'C +2 = D');
eq(transposeChord('Am', 3), 'Cm', 'Am +3 = Cm');
eq(transposeChord('F#m7', -2), 'Em7', 'F#m7 -2 = Em7');
eq(transposeChord('Bb', 2, null), 'C', 'Bb +2 = C（フラット系はCで解消）');
eq(transposeChord('Bb', 1, null), 'B', 'Bb +1 = B（フラット表でも pc11 は B）');
eq(transposeChord('C/G', 2), 'D/A', 'オンコードの移調');
eq(transposeChord('Cadd9', -1, true), 'Badd9', 'Cadd9 -1 フラット指定でも B');

console.log('--- 音楽理論: キー推定 ---');
{
  // Cメジャースケールの音を均等に → C major
  const notes = [60, 62, 64, 65, 67, 69, 71, 72].map((m) => ({ midi: m, dur: 1 }));
  notes[0].dur = 3; // トニック強調
  notes[4].dur = 2; // ドミナント強調
  const k = estimateKeyFromNotes(notes);
  eq(keyName(k), 'C', 'Cメジャースケール → C major');
}
{
  // Aナチュラルマイナー、A と E を強調 → A minor
  const notes = [57, 59, 60, 62, 64, 65, 67, 69].map((m) => ({ midi: m, dur: 1 }));
  notes[0].dur = 4;
  notes[4].dur = 2;
  const k = estimateKeyFromNotes(notes);
  eq(keyName(k), 'Am', 'Aマイナー音列 → A minor');
}

console.log('--- 音楽理論: ダイアトニックハモリ ---');
eq(diatonicShift(64, 0, 'major', 2), 67, 'キーC: E4 の3度上 = G4');
eq(diatonicShift(60, 0, 'major', 2), 64, 'キーC: C4 の3度上 = E4');
eq(diatonicShift(59, 0, 'major', 2), 62, 'キーC: B3 の3度上 = D4');
eq(diatonicShift(64, 0, 'major', -2), 60, 'キーC: E4 の3度下 = C4');
eq(diatonicShift(60, 0, 'major', 5), 69, 'キーC: C4 の6度上 = A4');
eq(diatonicShift(60, 0, 'major', 7), 72, 'キーC: C4 のオクターブ上 = C5');
eq(diatonicShift(69, 9, 'minor', 2), 72, 'キーAm: A4 の3度上 = C5');
eq(diatonicShift(61, 0, 'major', 2), 64, 'キーC: C#4(スケール外) → タイは下(C)に丸めて3度上=E');
eq(snapToScale(61, 0, 'major') === 60 || snapToScale(61, 0, 'major') === 62, true, 'C#はCかDに丸まる');
{
  const mel = [
    { midi: 64, start: 0, dur: 0.5 },
    { midi: 65, start: 0.5, dur: 0.5 },
    { midi: 67, start: 1.0, dur: 1.0 },
  ];
  const h = generateHarmony(mel, 0, 'major', 2);
  eq(h.map((n) => n.midi).join(','), '67,69,71', 'E,F,G の3度上 = G,A,B');
  eq(h[2].start, 1.0, 'タイミングは維持');
}

console.log('--- コードフォーム ---');
{
  const { getShape, shapeToMidis, capoSuggestions, easeScore } = await import('../js/chord-shapes.js');
  const c = getShape('C');
  eq(c.frets.join(','), '-1,3,2,0,1,0', 'C のオープンフォーム');
  // C = x32010 → 実音 C3 E3 G3 C4 E4
  eq(shapeToMidis(c).join(','), '48,52,55,60,64', 'C フォームの実音');
  const fsm = getShape('F#m');
  eq(fsm.frets.join(','), '2,4,4,2,2,2', 'F#m は2フレットバレー');
  const csharp = getShape('C#');
  ok(csharp && csharp.barres.length > 0, 'C# は可動バレーフォームで生成される');
  eq(csharp.frets.join(','), '-1,4,6,6,6,4', 'C# は Aフォーム4フレット');
  const gsm7 = getShape('G#m7');
  ok(gsm7 !== null, 'G#m7 も可動フォームで出る');
  ok(easeScore('G') > easeScore('F#'), 'G は F# より弾きやすい');
  // カポ提案: B-E-F#-G#m はカポ4で G-C-D-Em になるはず
  const rows = capoSuggestions(['B', 'E', 'F#', 'G#m']);
  const capo4 = rows.find((r) => r.capo === 4);
  eq(capo4.chords.join(' '), 'G C D Em', 'カポ4で G C D Em');
  const best = rows.reduce((a, b) => (b.score > a.score ? b : a));
  eq(best.capo, 4, 'ベスト提案はカポ4');
}

console.log('--- DSP: FFT・クロマ・コード候補 ---');
{
  const { fft, spectrum, chromaOf, chordCandidates } = await import('../js/dsp.js');
  // FFT: ビン8の正弦波 → スペクトルのピークがビン8
  const n = 256;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 8 * i) / n);
  fft(re, im);
  let peakBin = 0, peakV = 0;
  for (let k = 0; k < n / 2; k++) {
    const v = Math.hypot(re[k], im[k]);
    if (v > peakV) { peakV = v; peakBin = k; }
  }
  eq(peakBin, 8, 'FFT: 正弦波のピークビン');

  // 和音（正弦波合成）→ コード候補
  const mkChord = (freqs, dur = 1.0) => {
    const len = Math.floor(SR * dur);
    const d = new Float32Array(len);
    for (const f of freqs) {
      for (let h = 1; h <= 3; h++) {
        for (let i = 0; i < len; i++) d[i] += (0.5 / h) * Math.sin((2 * Math.PI * f * h * i) / SR);
      }
    }
    return d;
  };
  const cMaj = chordCandidates(chromaOf(mkChord([261.63, 329.63, 392.0]), SR), 3);
  eq(cMaj[0].chord, 'C', 'C-E-G → 最有力候補は C');
  const aMin = chordCandidates(chromaOf(mkChord([220.0, 261.63, 329.63]), SR), 3);
  eq(aMin[0].chord, 'Am', 'A-C-E → 最有力候補は Am');
  const g7 = chordCandidates(chromaOf(mkChord([196.0, 246.94, 293.66, 349.23]), SR), 3);
  ok(g7.slice(0, 2).some((c) => c.chord === 'G7'), `G-B-D-F → 上位2候補に G7（got ${g7.map((c) => c.chord).join(',')}）`);
}

console.log('--- MIDI 書き出し ---');
{
  const { buildMidi } = await import('../js/midi.js');
  const bytes = buildMidi(
    [{ name: 'Mel', notes: [{ midi: 60, start: 0, dur: 1 }, { midi: 64, start: 1, dur: 0.5 }] }],
    120
  );
  const s = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  // ヘッダ: MThd(4) + 長さ4 + format2 + ntrks2 + division2 = 14バイト
  eq(s(0, 4), 'MThd', 'MThd ヘッダ');
  eq(bytes[7], 6, 'ヘッダ長 = 6');
  eq((bytes[8] << 8) | bytes[9], 1, 'フォーマット1');
  eq((bytes[10] << 8) | bytes[11], 2, 'トラック数 = テンポ + 1');
  eq((bytes[12] << 8) | bytes[13], 480, 'PPQ 480');
  eq(s(14, 4), 'MTrk', 'テンポトラック');
  // テンポイベント: offset22=delta0, 23=FF, 24=51, 25=03, 26-28=07A120 (500000μs=120bpm)
  eq(bytes[24] === 0x51 && bytes[26] === 0x07 && bytes[27] === 0xa1 && bytes[28] === 0x20, true, 'テンポ 500000μs');
  // ノートトラックに 0x90 3C (C4 on) が含まれる
  let found = false;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0x90 && bytes[i + 1] === 60) found = true;
  }
  ok(found, 'ノートオン C4 が含まれる');
}

console.log('--- 五線譜レンダラ ---');
{
  const { keySignature, midiToStaff, renderStaffSVG } = await import('../js/staff.js');
  eq(keySignature(0).count, 0, 'C major: 調号なし');
  eq(keySignature(7).type + keySignature(7).count, 'sharp1', 'G major: ♯1');
  eq(keySignature(2).count, 2, 'D major: ♯2');
  eq(keySignature(5).type + keySignature(5).count, 'flat1', 'F major: ♭1');
  eq(keySignature(10).type + keySignature(10).count, 'flat2', 'Bb major: ♭2');
  eq(keySignature(9, 'minor').count, 0, 'A minor: 調号なし');
  eq(keySignature(4, 'minor').type + keySignature(4, 'minor').count, 'sharp1', 'E minor: ♯1');

  eq(midiToStaff(64).step, 30, 'E4 = ステップ30（第1線）');
  eq(midiToStaff(60).step, 28, 'C4 = ステップ28（下第1線）');
  eq(midiToStaff(69).step, 33, 'A4 = ステップ33');
  eq(midiToStaff(59).step, 27, 'B3 = ステップ27');
  eq(midiToStaff(61).accidental, '#', 'midi61 シャープ表記');
  eq(midiToStaff(61).step, 28, 'C#4 は Cの位置');
  eq(midiToStaff(61, true).accidental, 'b', 'midi61 フラット表記');
  eq(midiToStaff(61, true).step, 29, 'Db4 は Dの位置');

  const svg = renderStaffSVG(
    [{ notes: [{ midi: 60, start: 0, dur: 1 }, { midi: 64, start: 1, dur: 2 }, { midi: 67, start: 3, dur: 0.5 }, { midi: 61, start: 3.5, dur: 0.5 }], color: '#123456', name: 'm' }],
    { tonic: 0, mode: 'major' }
  );
  eq((svg.match(/<ellipse/g) || []).length, 4, '符頭4つ');
  eq((svg.match(/fill="none" stroke="#123456"/g) || []).length, 1, '2分音符（白玉）が1つ');
  ok(svg.includes('♯'), 'スケール外の C#4 に♯が付く');
  ok(svg.includes('data-role="staff-playhead"'), '再生ヘッドを含む');
  ok(svg.includes('𝄞'), 'ト音記号を含む');
  // C4（ステップ28）に加線が1本つく（x範囲の短い line）
  const gSvg = renderStaffSVG([{ notes: [{ midi: 57, start: 0, dur: 1 }], color: '#000', name: 'm' }], { tonic: 7 });
  ok(gSvg.includes('♯'), 'G majorの調号♯が描かれる');
}

console.log(`\n結果: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
