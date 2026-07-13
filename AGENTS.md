# Música Studio

> このフォルダの指示本体（Codex / Claude Code 両対応）。Claude Code は同フォルダの CLAUDE.md が @./AGENTS.md でこれを読み込む。

ギター・音楽活動用の統合Webアプリ。ブラウザだけで動く（ビルド不要・外部CDN依存ゼロ・vanilla JS + ES modules）。

## 機能タブ

1. **チューナー** — マイク入力からMPM（McLeod Pitch Method）でリアルタイム音程検出
2. **コード** — コードダイアグラム表示・コード譜エディタ（`[C]歌詞` 記法）・移調・カポ提案・ストラム再生
3. **耳コピ** — 音源読み込み・A-Bループ・ピッチ保持速度変更・帯域フィルタ・メロディ自動検出・コード候補
4. **ハモリ** — メロディからダイアトニックハモリ自動生成・ピアノロール/五線譜編集・シンセ再生・MIDI書き出し
5. **ピアノ** — コード進行＋メロディからピアノ伴奏自動アレンジ（4スタイル）・大譜表表示・複音スケッチ採譜（実験的）・MIDI書き出し
6. **タブ譜** — 6弦グリッド入力・再生・ASCII出力

## 構成

- `index.html` — 全タブのUI骨格
- `js/` — `app.js`（タブ切替）、`audio-engine.js`（AudioContext/マイク）、`pitch.js`（MPM）、`theory.js`（音楽理論）、`dsp.js`（FFT/クロマ/メロディ抽出）、`synth.js`（Karplus-Strong・声シンセ）、`midi.js`（SMF書き出し）、`chord-shapes.js`（コードフォーム辞書）
- `js/tabs/` — 各タブのUIモジュール
- `test/run-tests.mjs` — Node で実行する自動テスト（`node test/run-tests.mjs`）

## 開発ルール

- 外部ライブラリ・CDNを追加しない（GitHub Pages 公開時も自己完結、オフライン動作を保つ）
- DSP・音楽理論のロジックは純関数として `js/` 直下に置き、DOM依存は `js/tabs/` 側に限定する（Node テストを通すため）
- 変更したら `node test/run-tests.mjs` を実行してから commit する
- 動作確認はローカルサーバー経由（`python3 -m http.server`）。file:// ではマイク・ES modules が動かない
