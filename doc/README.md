# ドキュメント

n8n のワークフロー（JSON）と、JavaScript / Python のカスタムロジックを 1 つのリポジトリで管理し、Git と GitHub Actions で検証するプロジェクトのドキュメントです。

## 目次

| ドキュメント | 内容 | こんなときに読む |
| --- | --- | --- |
| [getting-started.md](getting-started.md) | 環境構築とローカル n8n の起動 | 初めてリポジトリを触るとき |
| [project-structure.md](project-structure.md) | フォルダ構成と各ファイルの役割 | どこに何を置くか迷ったとき |
| [development-workflow.md](development-workflow.md) | ワークフロー・Code ノード・Python 処理の開発手順 | 機能を追加・変更するとき |
| [design-driven-development.md](design-driven-development.md) | 設計書（`designs/`）からの自動構築とテストデプロイ | Claude にワークフローを作らせるとき |
| [studio.md](studio.md) | Workflow Studio（ブラウザから設計書・対話でアプリを作る） | Dashy の「アプリ作成」から作るとき |
| [secrets.md](secrets.md) | API キー・認証情報の管理（`secrets/`） | 外部サービスと連携するとき |
| [dashboard.md](dashboard.md) | Dashy のダッシュボードと分類コード | 作ったワークフローを一覧したいとき・分類を追加するとき |
| [ci-cd.md](ci-cd.md) | GitHub Actions で実行されるチェック | CI が落ちたとき |
| [claude-code.md](claude-code.md) | Claude Code のエージェント・スキル・フック | Claude Code で作業するとき |
| [specifications/](specifications/README.md) | ワークフローごとの仕様書 | 各ワークフローの挙動を知りたいとき |

## このプロジェクトの考え方

1. **Git が正（Source of Truth）**
   n8n の UI で編集した内容も、最終的には `workflows/*.json` としてエクスポートしてコミットします。n8n のデータベースは「作業場所」です。
2. **ロジックはコードとして書いてテストする**
   Code ノードの中身は `src/javascript/code-nodes/` に通常の JS ファイルとして書き、Jest でテストします。ワークフロー JSON には同期スクリプトで埋め込みます。
3. **CI で壊れたワークフローを防ぐ**
   JSON 構文・ノード接続の整合性・Code ノードの同期漏れ・テストを、プルリクエストごとに自動チェックします。
4. **秘密情報はリポジトリに入れない**
   API キーは Git 管理外の `secrets/secrets.env` にまとめ、ワークフローからは Credential の固定 ID か `$env` で参照します。
5. **設計書から作る**
   `designs/` に設計書を置けば、Claude Code が構築からテストデプロイまで行います。
6. **仕様書はワークフローに追従させる**
   ワークフローや処理を変更したら、`n8n-spec-writer` サブエージェントで `doc/specifications/` の仕様書を更新します。
7. **無料の範囲で完結させる**
   n8n は無料版（セルフホスト）、AI は Claude Code のサブスクリプションの範囲で使います。n8n の MCP サーバーは無料版で使えるため活用し、
   クレジット制の n8n AI ビルダーや、従量課金の API キーが必要な仕組みには依存しません。
