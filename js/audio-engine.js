// AudioContext・マイク・音源デコードの共有基盤（ブラウザ専用）

let ctx = null;

export function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

// iOS Safari はユーザー操作内で resume が必要
export async function resumeCtx() {
  const c = getCtx();
  if (c.state === 'suspended') await c.resume();
  return c;
}

let micStream = null;
let micSource = null;
let currentDeviceId = null;

async function acquire(deviceId) {
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({ audio });
}

// ユーザーが明示的に選んだマイクを記憶（deviceIdはブラウザ再起動で変わることがあるためラベルも保存）
export function setPreferredMic(id, label) {
  localStorage.setItem('ms-mic-pref', JSON.stringify({ id, label }));
}

// 優先マイクの deviceId を決める: 保存済みの選択 → MacBook等の内蔵マイク → なし(既定)
// ラベルはマイク許可が一度下りるまで空なので、許可前は null が返る
async function findPreferredDeviceId() {
  const inputs = await listAudioInputs();
  if (inputs.length === 0) return null;
  let pref = null;
  try { pref = JSON.parse(localStorage.getItem('ms-mic-pref')); } catch { /* 未設定 */ }
  if (pref) {
    const byId = pref.id && inputs.find((d) => d.id === pref.id);
    if (byId) return byId.id;
    const byLabel = pref.label && inputs.find((d) => d.label && d.label === pref.label);
    if (byLabel) return byLabel.id;
  }
  const builtin = inputs.find((d) => /macbook|内蔵|built-?in/i.test(d.label));
  return builtin ? builtin.id : null;
}

// deviceId を渡すとそのマイクを使う。省略時は「保存済み → 内蔵マイク → 既定」の順で自動選択。
// 既に別デバイスで起動中なら切り替える
export async function startMic(deviceId = null) {
  const c = await resumeCtx();
  if (micStream && deviceId && deviceId !== currentDeviceId) stopMic();
  if (micStream) return micSource;

  let id = deviceId || (await findPreferredDeviceId());
  try {
    micStream = await acquire(id);
  } catch (e) {
    if (!id) throw e;
    micStream = await acquire(null); // 保存デバイスが外れている等 → 既定にフォールバック
    id = null;
  }
  // 初回はラベル未取得のまま既定を掴むので、許可が下りた今、優先マイクと違えば掴み直す
  if (!deviceId) {
    const want = await findPreferredDeviceId();
    const curId = micStream.getAudioTracks()[0]?.getSettings?.().deviceId;
    if (want && curId && want !== curId) {
      for (const t of micStream.getTracks()) t.stop();
      micStream = await acquire(want);
      id = want;
    }
  }
  micSource = c.createMediaStreamSource(micStream);
  currentDeviceId = micStream.getAudioTracks()[0]?.getSettings?.().deviceId || id;
  return micSource;
}

export function stopMic() {
  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
    micStream = null;
    micSource = null;
    currentDeviceId = null;
  }
}

export function micActive() {
  return micStream !== null;
}

// 現在掴んでいるマイクのラベル（未起動なら null）
export function currentMicLabel() {
  const t = micStream && micStream.getAudioTracks()[0];
  return t ? t.label : null;
}

// 入力デバイス一覧（ラベルは一度マイク許可が下りた後にしか埋まらない。空文字のまま返す）
export async function listAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ id: d.deviceId, label: d.label || '' }));
}

export async function decodeFile(file) {
  const c = await resumeCtx();
  const buf = await file.arrayBuffer();
  return c.decodeAudioData(buf);
}

// AudioBuffer → モノラル Float32Array
export function toMono(audioBuffer) {
  const n = audioBuffer.length;
  const out = new Float32Array(n);
  const chs = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < chs; ch++) {
    const d = audioBuffer.getChannelData(ch);
    for (let i = 0; i < n; i++) out[i] += d[i] / chs;
  }
  return out;
}
