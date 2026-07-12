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

- [ ] 足場＋チューナー
- [ ] コード表＋移調＋カポ提案
- [ ] 耳コピ支援（A-Bループ・速度変更・メロディ検出・コード候補）
- [ ] ハモリ自動生成（キー推定・ダイアトニックハモリ・MIDI書き出し）
- [ ] タブ譜エディタ
- [ ] GitHub Pages デプロイ

## 次のアクション

- （実装中に更新）

## 資料の所在

- 実装計画: `~/.claude/plans/fable-5-claude-cheeky-dragonfly.md`
- スコープ外と分かっていること: ポリフォニック完全自動採譜／本人声質でのハモリ音声合成
