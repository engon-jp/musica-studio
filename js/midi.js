// SMF (Standard MIDI File) Type-1 書き出し（純関数・DOM非依存 — Node テスト対象）
// tracks: [{ name, notes: [{ midi, start(拍), dur(拍), vel? }] }]

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
const str = (s) => [...s].map((c) => c.charCodeAt(0) & 0xff);
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >>> 8) & 255, n & 255];

export function buildMidi(tracks, bpm = 120, ppq = 480) {
  const chunks = [];
  chunks.push([...str('MThd'), ...u32(6), ...u16(1), ...u16(tracks.length + 1), ...u16(ppq)]);

  // テンポ・拍子トラック
  const tempo = Math.round(60000000 / bpm);
  const t0 = [
    ...vlq(0), 0xff, 0x51, 0x03, (tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255,
    ...vlq(0), 0xff, 0x58, 0x04, 4, 2, 24, 8,
    ...vlq(0), 0xff, 0x2f, 0x00,
  ];
  chunks.push([...str('MTrk'), ...u32(t0.length), ...t0]);

  tracks.forEach((tr, ti) => {
    const ch = ti >= 9 ? ti + 1 : ti; // ch10(ドラム)を避ける
    const evs = [];
    for (const n of tr.notes) {
      const on = Math.max(0, Math.round(n.start * ppq));
      let off = Math.round((n.start + n.dur) * ppq);
      if (off <= on) off = on + 1;
      evs.push([on, 0x90 | (ch & 15), n.midi & 127, n.vel ?? 96]);
      evs.push([off, 0x80 | (ch & 15), n.midi & 127, 0]);
    }
    evs.sort((a, b) => a[0] - b[0] || (a[1] & 0xf0) - (b[1] & 0xf0)); // 同時刻は off が先

    const data = [];
    if (tr.name) {
      const nb = str(tr.name);
      data.push(...vlq(0), 0xff, 0x03, ...vlq(nb.length), ...nb);
    }
    let last = 0;
    for (const [t, ...bytes] of evs) {
      data.push(...vlq(t - last), ...bytes);
      last = t;
    }
    data.push(...vlq(0), 0xff, 0x2f, 0x00);
    chunks.push([...str('MTrk'), ...u32(data.length), ...data]);
  });

  return Uint8Array.from(chunks.flat());
}
