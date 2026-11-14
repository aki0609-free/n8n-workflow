const fs = require('node:fs');
const path = require('node:path');
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

  test('all workflows in workflows/ are valid', () => {
    const dir = path.resolve(__dirname, '../../workflows');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const workflow = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      expect({ file, errors: validateWorkflow(workflow) }).toEqual({ file, errors: [] });
    }
  });
});
