# ドキュメント

n8n のワークフロー（JSON）と、JavaScript / Python のカスタムロジックを 1 つのリポジトリで管理し、Git と GitHub Actions で検証するプロジェクトのドキュメントです。

## 目次

| ドキュメント | 内容 | こんなときに読む |
| --- | --- | --- |
| [getting-started.md](getting-started.md) | 環境構築とローカル n8n の起動 | 初めてリポジトリを触るとき |
| [project-structure.md](project-structure.md) | フォルダ構成と各ファイルの役割 | どこに何を置くか迷ったとき |
| [development-workflow.md](development-workflow.md) | ワークフロー・Code ノード・Python 処理の開発手順 | 機能を追加・変更するとき |
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
4. **仕様書はワークフローに追従させる**
   ワークフローや処理を変更したら、`n8n-spec-writer` サブエージェントで `doc/specifications/` の仕様書を更新します。
