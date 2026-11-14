/**
 * Claude Code CLI（claude -p）の呼び出しに関する共通処理。
 * scripts/design.js（design:build --auto）と Workflow Studio（studio/）で使う。
 *
 * 費用の方針: Claude Code のサブスクリプション（ログイン）の範囲で動かす。
 * 環境変数 ANTHROPIC_API_KEY があると API の従量課金に切り替わるため、子プロセスには渡さない。
 */

// 非対話モードの構築で Claude に許可するツール。.claude/settings.json の deny は引き続き有効
const AUTO_ALLOWED_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'Agent',
  'Skill',
  'Bash(npm run:*)',
  'Bash(npm test:*)',
  'Bash(npm test)',
  'Bash(node scripts/validate-workflows.js:*)',
  'Bash(node scripts/sync-code-nodes.js:*)',
  'Bash(node scripts/describe-workflow.js:*)',
  'Bash(node scripts/n8n-test-run.js:*)',
  'Bash(node -e:*)',
  'Bash(bash scripts/n8n-import.sh:*)',
  'Bash(bash scripts/n8n-credentials.sh:*)',
  'Bash(.venv/bin/ruff:*)',
  'Bash(.venv/bin/pytest:*)',
  'Bash(docker compose ps:*)',
  'Bash(docker compose up:*)',
  'Bash(docker compose logs:*)',
  'Bash(curl -sf http://localhost:*)',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(date:*)',
  // n8n MCP（.mcp.json）。ノード定義の取得・検証と、テスト実行だけを許可する。
  // n8n 上のワークフローを作成・更新・公開・アーカイブするツールは許可しない（正は workflows/*.json）
  'mcp__n8n__search_nodes',
  'mcp__n8n__get_node_types',
  'mcp__n8n__validate_node_config',
  'mcp__n8n__get_workflow_best_practices',
  'mcp__n8n__explore_node_resources',
  'mcp__n8n__list_credentials',
  'mcp__n8n__search_workflows',
  'mcp__n8n__get_workflow_details',
  'mcp__n8n__execute_workflow',
  'mcp__n8n__get_workflow_execution',
  'mcp__n8n__search_workflow_executions',
];

const AUTO_SYSTEM_PROMPT = [
  'あなたは非対話モード（claude -p）で実行されています。ユーザーに質問することはできません。',
  '- 設計書に未決事項や不足があり構築できない場合は、質問を設計書の「11. 未決事項」に追記して終了する。',
  '- secrets:check で未入力のキーがある場合は、Phase 2〜3 まで進めたうえで、記入が必要なキーを報告して終了する。',
  '- 最後に、実施内容・テスト結果・ユーザーが行うべきことを簡潔に出力する。',
].join('\n');

// 対話から設計書を作るときに使うツール（読み取りと n8n のノード定義の参照だけ。ファイルは書かない）
const INTERVIEW_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'mcp__n8n__search_nodes',
  'mcp__n8n__get_node_types',
  'mcp__n8n__get_workflow_best_practices',
];
const INTERVIEW_DISALLOWED_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Agent'];

/** 設計書から非対話モードで構築するときの引数 */
function buildArgs(designFile, { streamJson = false } = {}) {
  return [
    '-p',
    `/build-from-design ${designFile}`,
    '--permission-mode',
    'acceptEdits',
    '--allowedTools',
    ...AUTO_ALLOWED_TOOLS,
    '--append-system-prompt',
    AUTO_SYSTEM_PROMPT,
    ...(streamJson ? ['--output-format', 'stream-json', '--verbose'] : []),
  ];
}

/** 対話から設計書を作るときの 1 往復分の引数（sessionId があれば会話を続ける） */
function interviewArgs(message, { sessionId } = {}) {
  if (sessionId && !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new Error('invalid sessionId');
  }
  return [
    '-p',
    message,
    ...(sessionId ? ['--resume', sessionId] : []),
    '--agent',
    'design-interviewer',
    '--allowedTools',
    ...INTERVIEW_ALLOWED_TOOLS,
    '--disallowedTools',
    ...INTERVIEW_DISALLOWED_TOOLS,
    '--output-format',
    'stream-json',
    '--verbose',
  ];
}

/** 子プロセスの環境変数。API キーを外してサブスクリプションで動かす */
function childEnv(env = process.env) {
  const copy = { ...env };
  delete copy.ANTHROPIC_API_KEY;
  delete copy.ANTHROPIC_AUTH_TOKEN;
  return copy;
}

function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return '';
  const value =
    input.description ||
    input.file_path ||
    input.path ||
    input.pattern ||
    input.command ||
    input.skill ||
    (Array.isArray(input.queries) ? input.queries.join(', ') : undefined) ||
    input.prompt;
  return value === undefined ? '' : String(value).replace(/\s+/g, ' ').slice(0, 160);
}

/**
 * stream-json の 1 行を、画面に出しやすいイベントの配列に変換する。
 *   { kind: 'init', sessionId, billing }      billing: 'subscription' | 'api'
 *   { kind: 'text', text }                    Claude の発言
 *   { kind: 'tool', name, summary }           ツールの使用
 *   { kind: 'tool_error', text }              ツールの失敗
 *   { kind: 'result', ok, text, sessionId }   1 回の実行の終わり
 */
function parseStreamLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return line.trim() ? [{ kind: 'log', text: line }] : [];
  }
  if (msg.type === 'system' && msg.subtype === 'init') {
    return [
      {
        kind: 'init',
        sessionId: msg.session_id,
        billing: !msg.apiKeySource || msg.apiKeySource === 'none' ? 'subscription' : 'api',
      },
    ];
  }
  if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
    if (msg.parent_tool_use_id) return []; // サブエージェント内部の発言は省く
    return msg.message.content.flatMap((c) => {
      if (c.type === 'text' && c.text) return [{ kind: 'text', text: c.text }];
      if (c.type === 'tool_use') {
        return [{ kind: 'tool', name: c.name, summary: summarizeToolInput(c.input) }];
      }
      return [];
    });
  }
  if (msg.type === 'user' && msg.message && Array.isArray(msg.message.content)) {
    return msg.message.content
      .filter((c) => c.type === 'tool_result' && c.is_error)
      .map((c) => ({
        kind: 'tool_error',
        text: (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 300),
      }));
  }
  if (msg.type === 'result') {
    return [
      {
        kind: 'result',
        ok: msg.subtype === 'success' && !msg.is_error,
        text: typeof msg.result === 'string' ? msg.result : '',
        sessionId: msg.session_id,
      },
    ];
  }
  return [];
}

module.exports = {
  AUTO_ALLOWED_TOOLS,
  AUTO_SYSTEM_PROMPT,
  INTERVIEW_ALLOWED_TOOLS,
  buildArgs,
  interviewArgs,
  childEnv,
  parseStreamLine,
};
