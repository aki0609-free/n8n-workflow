/**
 * n8n ワークフロー JSON から仕様書生成用の構造情報を抽出する。
 * 推測を含まない「機械的に確定できる事実」だけを返す（解釈は n8n-spec-writer エージェントが行う）。
 */
const { getSourcePath } = require('./code-node-sync');

const CODE_FIELDS = new Set(['jsCode', 'pythonCode', 'code']);

function isTrigger(type) {
  return /trigger$/i.test(type) || type === 'n8n-nodes-base.webhook';
}

function summarizeParameters(parameters = {}) {
  const result = {};
  for (const [key, value] of Object.entries(parameters)) {
    if (CODE_FIELDS.has(key)) continue; // コード本体はソースファイル側で参照する
    result[key] = value;
  }
  return result;
}

function listEdges(connections = {}) {
  const edges = [];
  for (const [from, outputs] of Object.entries(connections)) {
    for (const [connectionType, branches] of Object.entries(outputs || {})) {
      (branches || []).forEach((targets, outputIndex) => {
        for (const target of targets || []) {
          edges.push({
            from,
            to: target.node,
            connectionType,
            outputIndex,
            inputIndex: target.index ?? 0,
          });
        }
      });
    }
  }
  return edges;
}

function escapeMermaid(label) {
  return String(label).replace(/"/g, '#quot;');
}

function toMermaid(nodes, edges) {
  const ids = new Map(nodes.map((n, i) => [n.name, `n${i}`]));
  const lines = ['flowchart LR'];
  for (const node of nodes) {
    const label = `${escapeMermaid(node.name)}<br/><small>${escapeMermaid(node.type)}</small>`;
    const shape = node.isTrigger ? `(["${label}"])` : `["${label}"]`;
    lines.push(`  ${ids.get(node.name)}${shape}`);
  }
  for (const e of edges) {
    const labels = [];
    if (e.connectionType !== 'main') labels.push(e.connectionType);
    if (e.outputIndex > 0) labels.push(`output ${e.outputIndex}`);
    const arrow = labels.length ? `-->|${escapeMermaid(labels.join(' / '))}|` : '-->';
    lines.push(`  ${ids.get(e.from) ?? 'missing'} ${arrow} ${ids.get(e.to) ?? 'missing'}`);
  }
  return lines.join('\n');
}

/**
 * @param {object} workflow パース済みワークフロー
 */
function describeWorkflow(workflow) {
  const nodes = (workflow.nodes || []).map((node) => {
    const params = node.parameters || {};
    return {
      name: node.name,
      type: node.type,
      typeVersion: node.typeVersion,
      isTrigger: isTrigger(node.type),
      disabled: node.disabled === true,
      codeSource: getSourcePath(params.jsCode),
      hasInlineCode:
        [...CODE_FIELDS].some((f) => typeof params[f] === 'string') &&
        !getSourcePath(params.jsCode),
      credentials: Object.entries(node.credentials || {}).map(([type, ref]) => ({
        type,
        name: ref && ref.name,
      })),
      retry: node.retryOnFail
        ? { maxTries: node.maxTries ?? null, waitBetweenTries: node.waitBetweenTries ?? null }
        : null,
      onError: node.onError ?? null,
      notes: node.notes ?? null,
      parameters: summarizeParameters(params),
    };
  });
  const edges = listEdges(workflow.connections);

  return {
    id: workflow.id ?? null,
    name: workflow.name,
    active: workflow.active === true,
    settings: workflow.settings || {},
    tags: (workflow.tags || []).map((t) => (typeof t === 'string' ? t : t.name)),
    triggers: nodes.filter((n) => n.isTrigger).map((n) => n.name),
    codeSources: [...new Set(nodes.map((n) => n.codeSource).filter(Boolean))],
    credentials: nodes.flatMap((n) => n.credentials.map((c) => ({ node: n.name, ...c }))),
    nodes,
    edges,
    mermaid: toMermaid(nodes, edges),
  };
}

function toMarkdown(description, file) {
  const d = description;
  const lines = [
    `# ${d.name}`,
    '',
    `- file: \`${file}\``,
    `- id: \`${d.id ?? '(none)'}\``,
    `- active: ${d.active}`,
    `- triggers: ${d.triggers.join(', ') || '(none)'}`,
    `- code sources: ${d.codeSources.map((s) => `\`${s}\``).join(', ') || '(none)'}`,
    '',
    '## Flow',
    '',
    '```mermaid',
    d.mermaid,
    '```',
    '',
    '## Nodes',
    '',
    '| # | name | type | v | trigger | disabled | credentials | code |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...d.nodes.map(
      (n, i) =>
        `| ${i + 1} | ${n.name} | \`${n.type}\` | ${n.typeVersion} | ${n.isTrigger ? '✓' : ''} | ${
          n.disabled ? '✓' : ''
        } | ${n.credentials.map((c) => c.type).join(', ')} | ${
          n.codeSource ? `\`${n.codeSource}\`` : n.hasInlineCode ? 'inline' : ''
        } |`,
    ),
    '',
    '## Node parameters',
    '',
    ...d.nodes.flatMap((n) => [
      `### ${n.name}`,
      '',
      '```json',
      JSON.stringify(
        { parameters: n.parameters, retry: n.retry, onError: n.onError, notes: n.notes },
        null,
        2,
      ),
      '```',
      '',
    ]),
  ];
  return lines.join('\n');
}

module.exports = { describeWorkflow, toMarkdown, listEdges, toMermaid, isTrigger };
