const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { validateWorkflow } = require('../../scripts/lib/workflow-validator');

const node = (overrides = {}) => ({
  id: 'n1',
  name: 'Start',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
  ...overrides,
});

describe('validateWorkflow', () => {
  test('accepts a minimal valid workflow', () => {
    expect(validateWorkflow({ name: 'wf', nodes: [node()], connections: {} })).toEqual([]);
  });

  test('rejects non-object root and missing top-level fields', () => {
    expect(validateWorkflow([])).toEqual(['root must be a JSON object']);
    expect(validateWorkflow({})).toEqual([
      '"name" must be a non-empty string',
      '"nodes" must be an array',
      '"connections" must be an object',
    ]);
  });

  test('detects duplicate names / ids and bad node fields', () => {
    const errors = validateWorkflow({
      name: 'wf',
      nodes: [node(), node({ typeVersion: '1', position: [0] })],
      connections: {},
    });
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('duplicate node name "Start"'),
        expect.stringContaining('duplicate node id "n1"'),
        expect.stringContaining('"typeVersion" must be a number'),
        expect.stringContaining('"position" must be [x, y] numbers'),
      ]),
    );
  });

  test('detects dangling connections', () => {
    const errors = validateWorkflow({
      name: 'wf',
      nodes: [node()],
      connections: {
        Start: { main: [[{ node: 'Missing', type: 'main', index: 0 }], null] },
        Ghost: { main: [] },
      },
    });
    expect(errors).toEqual([
      'connections["Start"] -> target node "Missing" does not exist',
      'connections: source node "Ghost" does not exist',
    ]);
  });

  test('detects hardcoded secrets in parameters', () => {
    const errors = validateWorkflow({
      name: 'wf',
      nodes: [
        node({
          parameters: {
            url: 'https://hooks.slack.com/services/T000/B000/XXXXXXXX',
            headers: [{ value: 'Bearer abcdefghijklmnopqrstuvwxyz123456' }],
            note: 'safe text with $env reference: {{ $env.SLACK_WEBHOOK_URL }}',
          },
        }),
      ],
      connections: {},
    });
    expect(errors).toEqual([
      'nodes[0] ("Start").parameters.url: looks like a hardcoded Slack webhook URL',
      'nodes[0] ("Start").parameters.headers[0].value: looks like a hardcoded Bearer token',
    ]);
  });

  test('checks credential references against known credentials', () => {
    const knownCredentials = [{ id: 'credSlackBot0001', name: 'Slack Bot', type: 'slackApi' }];
    const wf = (credentials) => ({ name: 'wf', nodes: [node({ credentials })], connections: {} });

    expect(
      validateWorkflow(wf({ slackApi: { id: 'credSlackBot0001', name: 'Slack Bot' } }), {
        knownCredentials,
      }),
    ).toEqual([]);
    expect(
      validateWorkflow(wf({ slackApi: { id: 'nope', name: 'x' } }), { knownCredentials }),
    ).toEqual([
      'nodes[0] ("Start"): credential id "nope" is not defined in config/credentials.template.json',
    ]);
    expect(
      validateWorkflow(wf({ notionApi: { id: 'credSlackBot0001', name: 'Slack Bot' } }), {
        knownCredentials,
      }),
    ).toEqual([
      'nodes[0] ("Start"): credential "credSlackBot0001" is type "slackApi", but used as "notionApi"',
    ]);
  });

  test('requires exactly one category tag when categoryCodes are given', () => {
    const wf = (tags) => ({ name: 'wf', nodes: [node()], connections: {}, tags });
    const opts = { categoryCodes: ['SLS', 'OPS'] };
    expect(validateWorkflow(wf([{ name: 'SLS' }, { name: 'misc' }]), opts)).toEqual([]);
    expect(validateWorkflow(wf(['SLS']), opts)).toEqual([]);
    expect(validateWorkflow(wf([]), opts)[0]).toContain('found: none');
    expect(validateWorkflow(wf(['SLS', 'OPS']), opts)[0]).toContain('found: SLS, OPS');
  });

  test('requires settings.availableInMCP when requireMcpAccess is given', () => {
    const wf = (settings) => ({ name: 'wf', nodes: [node()], connections: {}, settings });
    const opts = { requireMcpAccess: true };
    expect(validateWorkflow(wf({ executionOrder: 'v1', availableInMCP: true }), opts)).toEqual([]);
    expect(validateWorkflow(wf({ executionOrder: 'v1' }), opts)[0]).toContain('availableInMCP');
    expect(validateWorkflow(wf(undefined), opts)[0]).toContain('availableInMCP');
    expect(validateWorkflow(wf(undefined))).toEqual([]);
  });

  test('all workflows in workflows/ are valid against the credentials template and categories', () => {
    const root = path.resolve(__dirname, '../..');
    const knownCredentials = JSON.parse(
      fs.readFileSync(path.join(root, 'config/credentials.template.json'), 'utf8'),
    );
    const categoryCodes = YAML.parse(
      fs.readFileSync(path.join(root, 'config/categories.yml'), 'utf8'),
    ).categories.map((c) => c.code);
    const dir = path.join(root, 'workflows');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const workflow = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      expect({
        file,
        errors: validateWorkflow(workflow, {
          knownCredentials,
          categoryCodes,
          requireMcpAccess: true,
        }),
      }).toEqual({
        file,
        errors: [],
      });
    }
  });
});
