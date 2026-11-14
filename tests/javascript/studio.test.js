const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const store = require('../../studio/lib/design-store');
const { checkRequest } = require('../../studio/lib/security');
const { JobManager } = require('../../studio/lib/jobs');

const DESIGN = (id, status = 'ready') =>
  `---\nid: ${id}\ntitle: T\ncategory: SMP\nstatus: ${status}\nowner: me\n---\n\n# T\n`;

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-'));
  fs.mkdirSync(path.join(root, 'designs', 'examples'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(
    path.join(root, 'config', 'categories.yml'),
    'categories:\n  - code: SMP\n    name: サンプル\n',
  );
  fs.writeFileSync(path.join(root, 'designs', '_TEMPLATE.md'), DESIGN('my-workflow', 'draft'));
  fs.writeFileSync(path.join(root, 'designs', 'examples', 'ex.md'), DESIGN('ex'));
  return root;
}

describe('design-store', () => {
  let root;
  beforeEach(() => {
    root = makeRoot();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('lists designs with buildability', () => {
    fs.writeFileSync(path.join(root, 'designs', 'a.md'), DESIGN('a', 'draft'));
    const list = store.listAll(root);
    expect(list.map((d) => [d.file, d.example, d.problems.length > 0])).toEqual([
      ['designs/a.md', false, true],
      ['designs/examples/ex.md', true, false],
    ]);
  });

  test('reads only listed designs or the template', () => {
    expect(store.readDesign(root, 'designs/_TEMPLATE.md')).toContain('my-workflow');
    expect(() => store.readDesign(root, '../package.json')).toThrow('not found');
    expect(() => store.readDesign(root, 'config/categories.yml')).toThrow('not found');
  });

  test('saves a new design as designs/<id>.md and refuses silent overwrite', () => {
    const first = store.saveDesign(root, DESIGN('new-flow'));
    expect(first).toEqual({ file: 'designs/new-flow.md', errors: [], problems: [] });
    expect(fs.readFileSync(path.join(root, first.file), 'utf8')).toBe(DESIGN('new-flow'));

    const again = store.saveDesign(root, DESIGN('new-flow', 'draft'));
    expect(again.errors[0]).toContain('既にあります');
    expect(store.saveDesign(root, DESIGN('new-flow', 'draft'), { overwrite: true }).errors).toEqual(
      [],
    );
  });

  test('rejects invalid ids and unknown target files', () => {
    expect(store.saveDesign(root, DESIGN('../evil')).errors[0]).toContain('kebab-case');
    expect(store.saveDesign(root, 'no front matter').errors[0]).toContain('front matter');
    expect(store.saveDesign(root, DESIGN('x'), { file: 'package.json' }).errors[0]).toContain(
      '既存の設計書ではありません',
    );
    expect(fs.existsSync(path.join(root, 'designs', 'x.md'))).toBe(false);
  });

  test('editing an existing file keeps its path', () => {
    const plan = store.saveDesign(root, DESIGN('ex', 'built'), { file: 'designs/examples/ex.md' });
    expect(plan.file).toBe('designs/examples/ex.md');
    expect(plan.errors).toEqual([]);
  });

  test('extracts the last tilde-fenced design draft, keeping inner code fences', () => {
    const body = `${DESIGN('flow-a')}\n\`\`\`json\n{ "a": 1 }\n\`\`\`\n`;
    const text = `前置き\n~~~markdown\n${DESIGN('old')}\n~~~\n説明\n~~~markdown\n${body}~~~\n後書き`;
    const draft = store.extractDesignDraft(text);
    expect(draft.meta.id).toBe('flow-a');
    expect(draft.content).toContain('```json');
    expect(store.extractDesignDraft('```markdown\n# no front matter\n```')).toBeNull();
    expect(store.extractDesignDraft(`\`\`\`\`md\n${DESIGN('four')}\n\`\`\`\``).meta.id).toBe(
      'four',
    );
  });
});

describe('security.checkRequest', () => {
  const req = (method, url, headers) => ({ method, url, headers });
  const PORT = 3100;

  test('allows local browser GETs and same-origin JSON writes', () => {
    expect(checkRequest(req('GET', '/', { host: 'localhost:3100' }), PORT)).toBeNull();
    expect(
      checkRequest(
        req('POST', '/api/build', {
          host: '127.0.0.1:3100',
          origin: 'http://127.0.0.1:3100',
          'content-type': 'application/json',
        }),
        PORT,
      ),
    ).toBeNull();
  });

  test('blocks other hosts (DNS rebinding) and cross-site writes', () => {
    expect(checkRequest(req('GET', '/', { host: 'evil.example:3100' }), PORT)).toBe('invalid host');
    expect(checkRequest(req('GET', '/', { host: 'localhost:9999' }), PORT)).toBe('invalid host');
    const post = (headers) =>
      checkRequest(req('POST', '/api/chat', { host: 'localhost:3100', ...headers }), PORT);
    expect(post({ origin: 'https://evil.example', 'content-type': 'application/json' })).toBe(
      'invalid origin',
    );
    expect(post({ 'content-type': 'application/json' })).toBe('invalid origin');
    expect(post({ origin: 'http://localhost:3100', 'content-type': 'text/plain' })).toContain(
      'content-type',
    );
  });

  test('allows the Dashy status check only for health endpoints', () => {
    const host = { host: 'host.docker.internal:3100' };
    expect(checkRequest(req('GET', '/', host), PORT)).toBeNull();
    expect(checkRequest(req('GET', '/api/health', host), PORT)).toBeNull();
    expect(checkRequest(req('GET', '/api/designs', host), PORT)).toBe('invalid host');
  });
});

describe('JobManager', () => {
  function fakeSpawn(script) {
    const calls = [];
    const spawnFn = (command, args, options) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => {
        child.emit('close', null, 'SIGTERM');
      };
      calls.push({ command, args, options, child });
      setImmediate(() => script(child));
      return child;
    };
    return { spawnFn, calls };
  }

  const waitEnd = (manager, job) =>
    new Promise((resolve) => {
      if (job.status !== 'running') return resolve();
      manager.on(`event:${job.id}`, (e) => e.kind === 'end' && resolve());
    });

  test('streams parsed events, runs onEvent hooks, and ends with status', async () => {
    const { spawnFn, calls } = fakeSpawn((child) => {
      child.stdout.write(
        `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', apiKeySource: 'none' })}\n`,
      );
      child.stdout.write(
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'hello' }] },
        }),
      );
      child.stdout.write(
        `\n${JSON.stringify({ type: 'result', subtype: 'success', result: 'hello', session_id: 's1' })}\n`,
      );
      child.stdout.end();
      setImmediate(() => child.emit('close', 0, null));
    });
    const manager = new JobManager({ root: '/tmp', spawnFn });
    const job = manager.start({
      kind: 'interview',
      label: 't',
      args: ['-p', 'x'],
      onEvent: (j, e) => (e.kind === 'result' ? [{ kind: 'draft', texts: j.texts.length }] : []),
    });
    await waitEnd(manager, job);
    expect(calls[0].options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(job.status).toBe('succeeded');
    expect(job.events.map((e) => e.kind)).toEqual([
      'init',
      'text',
      'result',
      'draft',
      'exit',
      'end',
    ]);
    expect(job.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('allows only one running job and supports cancel', async () => {
    const { spawnFn } = fakeSpawn(() => {});
    const manager = new JobManager({ root: '/tmp', spawnFn });
    const job = manager.start({ kind: 'build', label: 'b', args: [] });
    expect(() => manager.start({ kind: 'build', label: 'c', args: [] })).toThrow(
      '他の処理が実行中です',
    );
    expect(manager.cancel(job.id)).toBe(true);
    await waitEnd(manager, job);
    expect(job.status).toBe('cancelled');
    expect(manager.running()).toBeNull();
  });

  test('reports a missing claude command', async () => {
    const { spawnFn } = fakeSpawn((child) =>
      child.emit('error', Object.assign(new Error('x'), { code: 'ENOENT' })),
    );
    const manager = new JobManager({ root: '/tmp', spawnFn });
    const job = manager.start({ kind: 'build', label: 'b', args: [] });
    await waitEnd(manager, job);
    expect(job.status).toBe('failed');
    expect(job.events.find((e) => e.kind === 'error').text).toContain(
      'claude コマンドが見つかりません',
    );
  });
});

describe('workflow-runner', () => {
  const runner = require('../../studio/lib/workflow-runner');
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-run-'));
    fs.mkdirSync(path.join(root, 'workflows'));
    fs.mkdirSync(path.join(root, 'tests', 'workflows'), { recursive: true });
    const wf = (id, nodes) => ({ id, name: id, nodes, connections: {} });
    fs.writeFileSync(
      path.join(root, 'workflows', 'hook.json'),
      JSON.stringify(
        wf('Hook0001', [
          {
            name: 'Webhook',
            type: 'n8n-nodes-base.webhook',
            parameters: { httpMethod: 'POST', path: '/hook' },
          },
        ]),
      ),
    );
    fs.writeFileSync(
      path.join(root, 'tests', 'workflows', 'hook.cases.json'),
      JSON.stringify({ cases: [{ name: '例', request: { path: 'hook', body: { a: 1 } } }] }),
    );
    fs.writeFileSync(
      path.join(root, 'workflows', 'cron.json'),
      JSON.stringify(
        wf('Cron0001', [
          { name: 'Every Day', type: 'n8n-nodes-base.scheduleTrigger', parameters: {} },
        ]),
      ),
    );
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('describes webhooks with example bodies from test cases', () => {
    expect(runner.findWorkflow(root, 'Hook0001')).toMatchObject({
      file: 'workflows/hook.json',
      webhooks: [{ method: 'POST', path: 'hook', exampleBody: { a: 1 }, exampleName: '例' }],
      forms: [],
      otherTriggers: [],
    });
    expect(runner.findWorkflow(root, 'Cron0001').otherTriggers).toEqual([
      { node: 'Every Day', type: 'n8n-nodes-base.scheduleTrigger' },
    ]);
    expect(runner.findWorkflow(root, 'nope')).toBeNull();
  });

  test('posts only to the workflow webhook path and reports unpublished workflows', async () => {
    const info = runner.findWorkflow(root, 'Hook0001');
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push({ url, init });
      return {
        status: 404,
        ok: false,
        headers: { get: () => 'application/json' },
        text: async () => '{"message":"The requested webhook \\"POST hook\\" is not registered."}',
      };
    };
    const result = await runner.runWebhook(info, 0, {
      body: { a: 2 },
      n8nUrl: 'http://n8n:5678/',
      fetchFn,
    });
    expect(calls[0].url).toBe('http://n8n:5678/webhook/hook');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBe('{"a":2}');
    expect(result.status).toBe(404);
    expect(result.hint).toContain('公開');
    await expect(runner.runWebhook(info, 5, { n8nUrl: 'http://n8n', fetchFn })).rejects.toThrow(
      'webhook not found',
    );
  });

  test('explains connection failures', async () => {
    const info = runner.findWorkflow(root, 'Hook0001');
    const result = await runner.runWebhook(info, 0, {
      n8nUrl: 'http://n8n',
      fetchFn: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(result).toMatchObject({ status: 0, ok: false });
    expect(result.hint).toContain('接続できませんでした');
  });
});
