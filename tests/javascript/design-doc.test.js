const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { parseFrontMatter, checkBuildable, listDesigns } = require('../../scripts/lib/design-doc');

describe('parseFrontMatter', () => {
  test('parses key/value pairs and strips trailing comments', () => {
    const text = '---\nid: order-notify   # comment\ntitle: 注文通知\nstatus: ready\n---\n# body';
    expect(parseFrontMatter(text)).toEqual({
      id: 'order-notify',
      title: '注文通知',
      status: 'ready',
    });
  });

  test('returns null without front matter', () => {
    expect(parseFrontMatter('# no front matter')).toBeNull();
  });
});

describe('checkBuildable', () => {
  test('accepts ready and built', () => {
    expect(checkBuildable({ id: 'a-b', title: 't', status: 'ready' })).toEqual([]);
    expect(checkBuildable({ id: 'a', title: 't', status: 'built' })).toEqual([]);
  });

  test('reports draft, bad id, missing title and invalid status', () => {
    expect(checkBuildable({ id: 'Bad_Id', status: 'draft' })).toEqual([
      'id "Bad_Id" は kebab-case で指定してください',
      'title がありません',
      'status が draft です。記入が終わったら ready にしてください',
    ]);
    expect(checkBuildable({ id: 'a', title: 't', status: 'done' })[0]).toContain('status "done"');
    expect(checkBuildable(null)).toHaveLength(1);
  });
});

describe('repository designs', () => {
  const root = path.resolve(__dirname, '../..');

  test('template has a valid front matter shape (draft)', () => {
    const meta = parseFrontMatter(fs.readFileSync(path.join(root, 'designs/_TEMPLATE.md'), 'utf8'));
    expect(meta).toMatchObject({ id: 'my-workflow', status: 'draft' });
  });

  test('listDesigns skips README and _TEMPLATE, and example is buildable', () => {
    const designs = listDesigns(root);
    expect(designs.map((d) => d.file)).not.toContain('designs/_TEMPLATE.md');
    expect(designs.map((d) => d.file)).not.toContain('designs/README.md');
    const example = designs.find((d) => d.file === 'designs/examples/order-notify.md');
    const codes = YAML.parse(
      fs.readFileSync(path.join(root, 'config/categories.yml'), 'utf8'),
    ).categories.map((c) => c.code);
    expect(checkBuildable(example.meta, codes)).toEqual([]);
  });

  test('checkBuildable validates category when codes are given', () => {
    const meta = { id: 'a', title: 't', status: 'ready', category: 'XXX' };
    expect(checkBuildable(meta, ['SLS'])).toEqual([
      'category "XXX" は config/categories.yml の分類コード（SLS）にしてください',
    ]);
    expect(checkBuildable({ ...meta, category: 'SLS' }, ['SLS'])).toEqual([]);
  });
});
