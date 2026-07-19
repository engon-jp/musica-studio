// タブ切替と各タブモジュールの遅延ロード

const TABS = [
  { id: 'tuner', label: '🎯 チューナー' },
  { id: 'metronome', label: '⏱ メトロノーム' },
  { id: 'chords', label: '🎸 コード' },
  { id: 'earcopy', label: '🎧 耳コピ' },
  { id: 'harmony', label: '🎤 ハモリ' },
  { id: 'piano', label: '🎹 ピアノ' },
  { id: 'tab', label: '📝 タブ譜' },
];

const loaded = {}; // id → module
let currentId = null;

const nav = document.getElementById('tab-nav');

for (const t of TABS) {
  const btn = document.createElement('button');
  btn.textContent = t.label;
  btn.dataset.tab = t.id;
  btn.addEventListener('click', () => switchTab(t.id));
  nav.appendChild(btn);
}

async function switchTab(id) {
  if (currentId === id) return;
  if (currentId && loaded[currentId]?.deactivate) loaded[currentId].deactivate();
  currentId = id;
  localStorage.setItem('ms-last-tab', id);

  for (const btn of nav.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.tab === id);
  }
  for (const t of TABS) {
    document.getElementById(`panel-${t.id}`).hidden = t.id !== id;
  }

  const panel = document.getElementById(`panel-${id}`);
  if (!loaded[id]) {
    try {
      const mod = await import(`./tabs/${id}.js`);
      mod.init(panel);
      loaded[id] = mod;
    } catch (e) {
      console.error(`タブ ${id} の読み込みに失敗:`, e);
      panel.innerHTML = `<div class="placeholder">この機能は準備中です<br><small>${e.message}</small></div>`;
      loaded[id] = {};
      return;
    }
  }
  loaded[id].activate?.();
}

// 他タブへデータを渡す共通経路（例: 耳コピ→ハモリ）
window.msBridge = {
  data: {},
  async send(tabId, key, value) {
    this.data[key] = value;
    await switchTab(tabId);
    loaded[tabId]?.receive?.(key, value);
  },
};

switchTab(localStorage.getItem('ms-last-tab') || 'tuner');
