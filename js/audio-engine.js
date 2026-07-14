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

// deviceId を渡すとそのマイクを使う。既に別デバイスで起動中なら切り替える
export async function startMic(deviceId = null) {
  const c = await resumeCtx();
  if (micStream && deviceId && deviceId !== currentDeviceId) stopMic();
  if (!micStream) {
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) audio.deviceId = { exact: deviceId };
    micStream = await navigator.mediaDevices.getUserMedia({ audio });
    micSource = c.createMediaStreamSource(micStream);
    currentDeviceId = deviceId;
  }
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

// 入力デバイス一覧。ラベルは一度マイク許可が下りた後にしか埋まらない
export async function listAudioInputs() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `マイク ${i + 1}` }));
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
