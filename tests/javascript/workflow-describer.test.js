const { describeWorkflow, toMarkdown } = require('../../scripts/lib/workflow-describer');

const workflow = {
  id: 'wf1',
  name: 'Sample',
  nodes: [
    {
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      parameters: { path: 'hook', httpMethod: 'POST' },
    },
    {
      name: 'Check "VIP"',
      type: 'n8n-nodes-base.if',
      typeVersion: 2,
      parameters: {},
    },
    {
      name: 'Transform',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      parameters: { jsCode: '// @source src/javascript/code-nodes/t.js\n...' },
    },
    {
      name: 'Slack',
      type: 'n8n-nodes-base.slack',
      typeVersion: 2.2,
      retryOnFail: true,
      maxTries: 3,
      credentials: { slackApi: { id: 'c1', name: 'Team Slack' } },
      parameters: {},
    },
  ],
  connections: {
    Webhook: { main: [[{ node: 'Check "VIP"', type: 'main', index: 0 }]] },
    'Check "VIP"': {
      main: [
        [{ node: 'Transform', type: 'main', index: 0 }],
        [{ node: 'Slack', type: 'main', index: 0 }],
      ],
    },
  },
};

describe('describeWorkflow', () => {
  const d = describeWorkflow(workflow);

  test('extracts triggers, code sources and credentials', () => {
    expect(d.triggers).toEqual(['Webhook']);
    expect(d.codeSources).toEqual(['src/javascript/code-nodes/t.js']);
    expect(d.credentials).toEqual([{ node: 'Slack', type: 'slackApi', name: 'Team Slack' }]);
    expect(d.nodes.find((n) => n.name === 'Slack').retry).toEqual({
      maxTries: 3,
      waitBetweenTries: null,
    });
  });

  test('omits code bodies from parameters', () => {
    expect(d.nodes.find((n) => n.name === 'Transform').parameters).toEqual({});
  });

  test('lists edges including branch index', () => {
    expect(d.edges).toEqual([
      { from: 'Webhook', to: 'Check "VIP"', connectionType: 'main', outputIndex: 0, inputIndex: 0 },
      {
        from: 'Check "VIP"',
        to: 'Transform',
        connectionType: 'main',
        outputIndex: 0,
        inputIndex: 0,
      },
      { from: 'Check "VIP"', to: 'Slack', connectionType: 'main', outputIndex: 1, inputIndex: 0 },
    ]);
  });

  test('renders mermaid with escaped quotes and branch labels', () => {
    expect(d.mermaid).toContain('n0(["Webhook<br/><small>n8n-nodes-base.webhook</small>"])');
    expect(d.mermaid).toContain('Check #quot;VIP#quot;');
    expect(d.mermaid).toContain('n1 -->|output 1| n3');
  });

  test('toMarkdown includes flow and node table', () => {
    const md = toMarkdown(d, 'workflows/sample.json');
    expect(md).toContain('```mermaid');
    expect(md).toContain('| 4 | Slack | `n8n-nodes-base.slack` | 2.2 |');
  });
});
