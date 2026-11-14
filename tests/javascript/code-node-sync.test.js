const vm = require('node:vm');
const { getSourcePath, buildNodeCode, syncWorkflow } = require('../../scripts/lib/code-node-sync');

const SOURCE = `function run(items) { return items.map((i) => ({ json: { doubled: i.json.n * 2 } })); }
module.exports = { run };
`;

describe('getSourcePath', () => {
  test('parses the @source marker on the first line', () => {
    expect(getSourcePath('// @source src/javascript/code-nodes/a.js\nfoo')).toBe(
      'src/javascript/code-nodes/a.js',
    );
    expect(getSourcePath('return items;')).toBeNull();
    expect(getSourcePath(undefined)).toBeNull();
  });
});

describe('buildNodeCode', () => {
  test('generated code runs like an n8n Code node (wrapped in a function with $input)', () => {
    const code = buildNodeCode('src/x.js', SOURCE);
    // n8n は Code ノード本体を関数でラップして実行する。それを模倣して評価する
    const sandbox = { $input: { all: () => [{ json: { n: 2 } }, { json: { n: 5 } }] } };
    const result = vm.runInNewContext(`(function () {\n${code}\n})()`, sandbox);
    expect(result).toEqual([{ json: { doubled: 4 } }, { json: { doubled: 10 } }]);
  });
});

describe('syncWorkflow', () => {
  const makeWorkflow = (jsCode) => ({
    nodes: [
      { name: 'Code', type: 'n8n-nodes-base.code', parameters: { jsCode } },
      { name: 'Other', type: 'n8n-nodes-base.set', parameters: {} },
      { name: 'Manual', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [];' } },
    ],
  });

  test('embeds the source and reports changes, then is idempotent', () => {
    const wf = makeWorkflow('// @source src/x.js\n');
    const read = jest.fn().mockReturnValue(SOURCE);

    expect(syncWorkflow(wf, read)).toEqual([{ name: 'Code', source: 'src/x.js' }]);
    expect(read).toHaveBeenCalledWith('src/x.js');
    expect(wf.nodes[0].parameters.jsCode).toBe(buildNodeCode('src/x.js', SOURCE));
    expect(wf.nodes[2].parameters.jsCode).toBe('return [];');

    expect(syncWorkflow(wf, read)).toEqual([]);
  });
});
