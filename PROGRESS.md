# Música Studio — PROGRESS

## 概要

ギター・音楽活動用の統合Webアプリ（チューナー / コード / 耳コピ / ハモリ / タブ譜）。
ブラウザ完結・ビルド不要。Mac＋iPhone 両対応を想定し GitHub Pages で公開予定。

## 基本情報

- 場所: `~/Documents/_MyProjects/Música/musica-studio/`
- 技術: vanilla JS + ES modules + Web Audio API。外部依存ゼロ
- テスト: `node test/run-tests.mjs`（ピッチ検出精度・音楽理論・MIDI）
- ローカル起動: `python3 -m http.server 8765` → http://localhost:8765

## 経緯

- 2026-07-12: Fable 5 サブスク最終日に一気に構築開始。計画は `~/.claude/plans/fable-5-claude-cheeky-dragonfly.md`
  - 決定: 統合アプリ / Mac+iPhone両対応（GitHub Pages）/ 優先順位 チューナー→コード→耳コピ→ハモリ→タブ譜 / 持ち歌の初期データ登録なし

## 現在のステータス

- [x] 足場＋チューナー（MPM ±1セント精度をテストで確認）
- [x] コード表＋移調＋カポ提案（[C]記法・SVGダイアグラム・ストラム再生・曲保存）
- [x] 耳コピ支援（A-Bループ・ピッチ保持速度変更・帯域フィルタ・スペクトログラム・メロディ検出・コード候補）
- [x] ハモリ自動生成（キー推定・3度上下/6度/オク下・ピアノロール・**五線譜表示＋タップ編集（SVG自前描画・調号/加線/音価対応、追加はキーのダイアトニック音にスナップ）**・シンセ再生・MIDI書き出し・マイク歌唱入力）
- [x] タブ譜エディタ（グリッド入力・KS再生・ASCII出力・印刷CSS）
- [x] GitHub Pages デプロイ → **https://engon-jp.github.io/musica-studio/** （リポジトリ: engon-jp/musica-studio・public）
- 自動テスト: 105件 全通過（`node test/run-tests.mjs`）
- E2E確認済み: 合成WAV→メロディ検出(A3/C#4/E4)→ハモリ生成(3度上)→ピアノロール描画、コード候補判定(A major正解)、タブ譜ASCII出力

## 次のアクション

- 遠藤さんの実機確認: Mac でマイク（チューナー）、iPhone Safari で全タブ（特にマイク許可とタッチ操作）
- 将来アイデア: PWA化（オフライン対応）・ボーカル抽出前処理（ElevenLabs isolate_audio）・コード譜のカポ運指最適化

## 資料の所在

- 実装計画: `~/.claude/plans/fable-5-claude-cheeky-dragonfly.md`
- スコープ外と分かっていること: ポリフォニック完全自動採譜／本人声質でのハモリ音声合成
