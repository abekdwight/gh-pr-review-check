# AGENTS.md

gh-pr-review-check プロジェクトの開発ガイドラインです。

## プロジェクト概要

GitHub CLI拡張機能。PRレビューデータをローカルJSONLファイルに同期し、AIアシストによるレビュー対応を支援する。

## 開発フロー

### ブランチ戦略

- `main` ブランチは常に安定版を維持
- 新機能・修正は `feature/xxx` または `fix/xxx` ブランチで開発
- PRを作成して `main` にマージ

### バージョニング

**重要**: 機能追加・修正をリリースする際は、必ず以下の手順を実行すること：

1. `package.json` のバージョンを更新（セマンティックバージョニング）
2. コミット＆プッシュ
3. GitHubリリースを作成

```bash
# パッチバージョン（バグ修正）
# package.json: "version": "0.0.1" → "0.0.2"

# マイナーバージョン（機能追加、後方互換）
# package.json: "version": "0.0.1" → "0.1.0"

# メジャーバージョン（破壊的変更）
# package.json: "version": "0.0.1" → "1.0.0"

# リリース作成
gh release create vX.Y.Z --repo abekdwight/gh-pr-review-check \
  --title "vX.Y.Z" \
  --notes "変更内容の要約"
```

## ビルド

```bash
npm run build    # esbuildでdist/index.cjsにバンドル
npm test         # テスト実行
```

## 出力仕様

```
/tmp/{org}/{repo}/pr/{pr-id}/
├── pr-meta.json      # PRメタデータ
└── reviews.jsonl     # レビューエントリ（1行1JSON）
```

### JSONLエントリ型

- `thread` - インラインレビューコメントスレッド
- `review` - レビュー（APPROVED, CHANGES_REQUESTED等）
- `issue_comment` - PRレベルのコメント

### action ステータス

- `pending` - 未処理
- `fix` - 修正予定
- `skip` - スキップ
- `done` - 完了（解決済みスレッドは自動的にdone）

## コーディング規約

- TypeScript使用
- ESM形式（`type: module`）
- テストはvitest使用
- `console.error` で進捗メッセージ、`console.log` で結果出力
