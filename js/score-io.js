// 楽譜ファイルの読み込み（純ロジック — Node テスト対象）
// - parseMidi: SMF(.mid) → {title, bpm, beatsPerBar, key, parts:[{name, notes:[{midi,start(拍),dur}]}]}
// - extractMxlXml: .mxl(ZIP圧縮MusicXML) から XML 文字列を取り出す（DecompressionStream使用）
// - parseMusicXMLDoc: DOM Document → 同上（DOMParser はブラウザ側で用意する）

// ---- SMF (MIDI ファイル) ----

function readVlq(bytes, pos) {
  let v = 0;
  while (true) {
    const b = bytes[pos++];
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) return [v, pos];
  }
}

export function parseMidi(bytes) {
  const str = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  const u16 = (o) => (bytes[o] << 8) | bytes[o + 1];
  const u32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  if (str(0, 4) !== 'MThd') throw new Error('MIDIファイルではありません');
  const ntrks = u16(10);
  const division = u16(12);
  if (division & 0x8000) throw new Error('SMPTE形式のMIDIは非対応です');

  let pos = 14;
  let bpm = 120;
  let bpmSet = false;
  const parts = [];
  for (let tr = 0; tr < ntrks && pos + 8 <= bytes.length; tr++) {
    if (str(pos, 4) !== 'MTrk') break;
    const len = u32(pos + 4);
    let p = pos + 8;
    const end = p + len;
    pos = end;
    let tick = 0, running = 0, name = '';
    const open = new Map();
    const notes = [];
    while (p < end) {
      const [dt, p2] = readVlq(bytes, p);
      p = p2;
      tick += dt;
      let status = bytes[p];
      if (status & 0x80) {
        p++;
        if (status < 0xf0) running = status;
      } else {
        status = running;
      }
      if (status === 0xff) {
        const type = bytes[p++];
        const [mlen, p3] = readVlq(bytes, p);
        p = p3;
        if (type === 0x51 && !bpmSet) {
          const us = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2];
          bpm = Math.round(60000000 / us);
          bpmSet = true;
        } else if (type === 0x03 && !name) {
          name = new TextDecoder().decode(bytes.slice(p, p + mlen));
        }
        p += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        const [slen, p3] = readVlq(bytes, p);
        p = p3 + slen;
      } else {
        const hi = status & 0xf0;
        if (hi === 0x90 || hi === 0x80) {
          const note = bytes[p];
          const vel = bytes[p + 1];
          p += 2;
          const key = (status & 0x0f) * 128 + note;
          if (hi === 0x90 && vel > 0) {
            if (!open.has(key)) open.set(key, []);
            open.get(key).push(tick);
          } else {
            const stack = open.get(key);
            if (stack && stack.length) {
              const onTick = stack.pop();
              notes.push({ midi: note, start: onTick / division, dur: Math.max(0.0625, (tick - onTick) / division) });
            }
          }
        } else if (hi === 0xc0 || hi === 0xd0) {
          p += 1;
        } else {
          p += 2;
        }
      }
    }
    if (notes.length) {
      notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
      parts.push({ name: name || `トラック${parts.length + 1}`, notes });
    }
  }
  return { title: '', bpm, beatsPerBar: 4, key: null, parts };
}

// ---- MXL (ZIP圧縮 MusicXML) ----

export async function extractMxlXml(bytes) {
  // EOCD（End of Central Directory）を末尾から探す
  let e = bytes.length - 22;
  while (e >= 0 && !(bytes[e] === 0x50 && bytes[e + 1] === 0x4b && bytes[e + 2] === 0x05 && bytes[e + 3] === 0x06)) e--;
  if (e < 0) throw new Error('MXL(ZIP)形式を認識できません');
  const rd16 = (o) => bytes[o] | (bytes[o + 1] << 8);
  const rd32 = (o) => (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  const count = rd16(e + 10);
  let off = rd32(e + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (rd32(off) !== 0x02014b50) break;
    const method = rd16(off + 10);
    const csize = rd32(off + 20);
    const nlen = rd16(off + 28), xlen = rd16(off + 30), clen = rd16(off + 32);
    const lho = rd32(off + 42);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nlen));
    entries.push({ name, method, csize, lho });
    off += 46 + nlen + xlen + clen;
  }
  const pick = entries.find((en) => !/^META-INF\//.test(en.name) && /\.(musicxml|xml)$/i.test(en.name));
  if (!pick) throw new Error('ZIP内に楽譜XMLが見つかりません');
  const nlen2 = rd16(pick.lho + 26), xlen2 = rd16(pick.lho + 28);
  const dataStart = pick.lho + 30 + nlen2 + xlen2;
  const raw = bytes.subarray(dataStart, dataStart + pick.csize);
  if (pick.method === 0) return new TextDecoder().decode(raw);
  if (pick.method !== 8) throw new Error('非対応のZIP圧縮形式です');
  const ds = new DecompressionStream('deflate-raw');
  return await new Response(new Blob([raw]).stream().pipeThrough(ds)).text();
}

// ---- MusicXML ----

const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// doc: DOMParser で得た Document（score-partwise）
export function parseMusicXMLDoc(doc) {
  if (!doc.querySelector('score-partwise')) {
    throw new Error('score-partwise 形式のMusicXMLのみ対応です（MuseScoreの書き出しはこの形式）');
  }
  const title = doc.querySelector('work work-title, movement-title')?.textContent.trim() || '';
  let bpm = 120, bpmSet = false;
  let beatsPerBar = 4, beatsSet = false;
  let fifths = null, mode = 'major';

  const partNames = {};
  for (const sp of doc.querySelectorAll('part-list score-part')) {
    partNames[sp.getAttribute('id')] = sp.querySelector('part-name')?.textContent.trim() || '';
  }

  const parts = [];
  for (const partEl of doc.querySelectorAll('score-partwise > part')) {
    let divisions = 1;
    let cursor = 0;
    let lastNoteStart = 0;
    const notes = [];
    for (const measure of partEl.children) {
      if (measure.tagName !== 'measure') continue;
      for (const el of measure.children) {
        const tag = el.tagName;
        if (tag === 'attributes') {
          const d = el.querySelector('divisions');
          if (d) divisions = Number(d.textContent) || 1;
          const tb = el.querySelector('time > beats');
          if (tb && !beatsSet) { beatsPerBar = Number(tb.textContent) || 4; beatsSet = true; }
          const f = el.querySelector('key > fifths');
          if (f && fifths === null) {
            fifths = Number(f.textContent) || 0;
            mode = el.querySelector('key > mode')?.textContent || 'major';
          }
        } else if (tag === 'direction' || tag === 'sound') {
          const s = tag === 'sound' ? el : el.querySelector('sound[tempo]');
          if (s?.getAttribute('tempo') && !bpmSet) { bpm = Math.round(Number(s.getAttribute('tempo'))); bpmSet = true; }
        } else if (tag === 'backup') {
          cursor -= Number(el.querySelector('duration')?.textContent || 0) / divisions;
        } else if (tag === 'forward') {
          cursor += Number(el.querySelector('duration')?.textContent || 0) / divisions;
        } else if (tag === 'note') {
          if (el.querySelector(':scope > grace')) continue; // 装飾音は飛ばす
          const dur = Number(el.querySelector(':scope > duration')?.textContent || 0) / divisions;
          const isChord = !!el.querySelector(':scope > chord');
          const start = isChord ? lastNoteStart : cursor;
          if (!el.querySelector(':scope > rest')) {
            const step = el.querySelector('pitch > step')?.textContent;
            if (step && step in STEP_PC) {
              const alter = Number(el.querySelector('pitch > alter')?.textContent || 0);
              const octave = Number(el.querySelector('pitch > octave')?.textContent ?? 4);
              const midi = (octave + 1) * 12 + STEP_PC[step] + alter;
              const ties = [...el.querySelectorAll(':scope > tie')].map((t) => t.getAttribute('type'));
              notes.push({
                midi,
                start,
                dur: dur || 0.25,
                tieStart: ties.includes('start'),
                tieStop: ties.includes('stop'),
              });
            }
          }
          if (!isChord) {
            lastNoteStart = cursor;
            cursor += dur;
          }
        }
      }
    }
    const merged = mergeTies(notes);
    if (merged.length) {
      const id = partEl.getAttribute('id');
      parts.push({ name: partNames[id] || id || `パート${parts.length + 1}`, notes: merged });
    }
  }

  let key = null;
  if (fifths !== null) {
    const majorTonic = ((fifths * 7) % 12 + 12) % 12;
    const isMinor = /minor/i.test(mode);
    key = { tonic: isMinor ? (majorTonic + 9) % 12 : majorTonic, mode: isMinor ? 'minor' : 'major' };
  }
  return { title, bpm, beatsPerBar, key, parts };
}

// タイでつながった音を1つに結合
export function mergeTies(notes) {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out = [];
  const openTies = new Map(); // midi → 結合先ノート
  for (const n of sorted) {
    if (n.tieStop) {
      const prev = openTies.get(n.midi);
      if (prev && Math.abs(prev.start + prev.dur - n.start) < 0.02) {
        prev.dur += n.dur;
        if (!n.tieStart) openTies.delete(n.midi);
        continue;
      }
    }
    const copy = { midi: n.midi, start: n.start, dur: n.dur };
    out.push(copy);
    if (n.tieStart) openTies.set(n.midi, copy);
    else openTies.delete(n.midi);
  }
  return out;
}
