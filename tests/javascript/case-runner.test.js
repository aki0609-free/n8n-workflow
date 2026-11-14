const fs = require('node:fs');
const path = require('node:path');
const { diffSubset, buildRequest, runCase, isMcpCase } = require('../../scripts/lib/case-runner');

describe('isMcpCase', () => {
  test('is true only for cases with a trigger name and no request', () => {
    expect(isMcpCase({ name: 'f', trigger: 'Form Trigger', inputs: { formData: {} } })).toBe(true);
    expect(isMcpCase({ name: 's', trigger: 'Schedule' })).toBe(true);
    expect(isMcpCase({ name: 'h', request: { path: 'p' } })).toBe(false);
    expect(isMcpCase({ name: 'x', request: { path: 'p' }, trigger: 'Webhook' })).toBe(false);
  });
});

describe('diffSubset', () => {
  test('matches nested subsets and reports mismatched paths', () => {
    const actual = { a: 1, b: { c: [1, { d: 'x', e: 2 }] }, extra: true };
    expect(diffSubset(actual, { b: { c: [1, { d: 'x' }] } })).toEqual([]);
    expect(diffSubset(actual, { a: 2, b: { c: [1] }, z: 0 })).toEqual([
      '$.a: expected 2, got 1',
      '$.b.c: expected length 1, got 2',
      '$.z: missing',
    ]);
    expect(diffSubset('s', { a: 1 })).toEqual(['$: expected object']);
  });
});

describe('buildRequest', () => {
  test('builds webhook URL, query and JSON body', () => {
    const { url, init } = buildRequest(
      { name: 't', request: { path: '/orders', query: { dry: 1 }, body: { x: 1 } } },
      'http://localhost:5678',
    );
    expect(url).toBe('http://localhost:5678/webhook/orders?dry=1');
    expect(init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"x":1}',
    });
  });

  test('requires a path', () => {
    expect(() => buildRequest({ name: 'x', request: {} }, 'http://h/')).toThrow('request.path');
  });
});

describe('runCase', () => {
  const fakeFetch = (status, body) => async () => ({ status, text: async () => body });

  test('passes when status and json subset match', async () => {
    const result = await runCase(
      { name: 'ok', request: { path: 'p' }, expect: { status: 200, json: { a: 1 } } },
      { baseUrl: 'http://h/', fetchFn: fakeFetch(200, '{"a":1,"b":2}') },
    );
    expect(result.ok).toBe(true);
  });

  test('collects status, json and text failures', async () => {
    const result = await runCase(
      {
        name: 'ng',
        request: { path: 'p' },
        expect: { status: 201, json: { a: 1 }, textContains: 'hello' },
      },
      { baseUrl: 'http://h/', fetchFn: fakeFetch(500, 'oops') },
    );
    expect(result.errors).toEqual([
      'status: expected 201, got 500',
      'body: expected JSON response',
      'body: expected to contain "hello"',
    ]);
  });

  test('reports network errors', async () => {
    const result = await runCase(
      { name: 'down', request: { path: 'p' } },
      {
        baseUrl: 'http://h/',
        fetchFn: async () => {
          throw new Error('ECONNREFUSED');
        },
      },
    );
    expect(result).toEqual({ name: 'down', ok: false, errors: ['request failed: ECONNREFUSED'] });
  });
});

describe('tests/workflows/*.cases.json', () => {
  const root = path.resolve(__dirname, '../..');
  const dir = path.join(root, 'tests/workflows');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.cases.json'))
    : [];

  test.each(files)('%s is well-formed and matches a workflow', (file) => {
    const { cases } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    expect(Array.isArray(cases)).toBe(true);
    const workflowPath = path.join(root, 'workflows', file.replace('.cases.json', '.json'));
    expect(fs.existsSync(workflowPath)).toBe(true);
    const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
    const webhookPaths = workflow.nodes
      .filter((n) => n.type === 'n8n-nodes-base.webhook')
      .map((n) => n.parameters.path);
    const nodeNames = workflow.nodes.map((n) => n.name);
    for (const c of cases) {
      expect(typeof c.name).toBe('string');
      if (isMcpCase(c)) {
        // MCP ケース: トリガー名と、判定対象のノード名がワークフローに存在すること
        expect(nodeNames).toContain(c.trigger);
        if (c.expect && c.expect.node !== undefined) expect(nodeNames).toContain(c.expect.node);
      } else {
        expect(webhookPaths).toContain(c.request.path.replace(/^\/+/, ''));
      }
    }
  });
});
