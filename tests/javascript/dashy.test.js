const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const {
  getCategoryCodes,
  validateCategories,
  shortTitle,
  fillLinks,
  webhookEndpoints,
  buildDashyConfig,
} = require('../../scripts/lib/dashy');

const links = {
  n8nBaseUrl: 'http://localhost:5678/',
  studioUrl: 'http://localhost:3100',
  repoUrl: 'https://github.com/o/r',
  repoBranch: 'main',
};

const categories = [
  { code: 'SLS', name: '営業', icon: 'fas fa-handshake' },
  { code: 'OPS', name: '運用' },
];

const webhookWorkflow = (overrides = {}) => ({
  id: 'Wf000000000000001',
  name: '注文通知（金額で振り分け）',
  tags: [{ name: 'SLS' }],
  nodes: [
    {
      name: 'Webhook',
      type: 'n8n-nodes-base.webhook',
      parameters: { httpMethod: 'POST', path: '/order-notify' },
    },
  ],
  ...overrides,
});

describe('helpers', () => {
  test('getCategoryCodes accepts string and object tags', () => {
    expect(
      getCategoryCodes({ tags: ['SLS', { name: 'x' }, { name: 'OPS' }] }, ['SLS', 'OPS']),
    ).toEqual(['SLS', 'OPS']);
    expect(getCategoryCodes({}, ['SLS'])).toEqual([]);
  });

  test('validateCategories checks code format, duplicates and names', () => {
    expect(validateCategories(categories)).toEqual([]);
    expect(
      validateCategories([{ code: 'sls', name: 'a' }, { code: 'OPS' }, { code: 'OPS', name: 'b' }]),
    ).toEqual([
      'categories[0]: code "sls" は英大文字で始まる 2〜5 文字にしてください',
      'categories[1]: name がありません',
      'categories[2]: code "OPS" が重複しています',
    ]);
  });

  test('shortTitle drops parenthetical and truncates to 18 chars', () => {
    expect(shortTitle('Contacts Intake (Webhook → Format)')).toBe('Contacts Intake');
    expect(shortTitle('注文通知（金額で振り分け）')).toBe('注文通知');
    const long = shortTitle('A very long workflow name that exceeds');
    expect([...long]).toHaveLength(18);
    expect(long.endsWith('…')).toBe(true);
  });

  test('fillLinks replaces placeholders recursively and keeps unknown ones', () => {
    expect(fillLinks({ a: ['{studioUrl}/x', '{unknown}'] }, links)).toEqual({
      a: ['http://localhost:3100/x', '{unknown}'],
    });
  });

  test('webhookEndpoints builds production URLs', () => {
    expect(webhookEndpoints(webhookWorkflow(), links.n8nBaseUrl)).toEqual([
      { method: 'POST', path: 'order-notify', url: 'http://localhost:5678/webhook/order-notify' },
    ]);
  });
});

describe('buildDashyConfig', () => {
  const dashboard = {
    links,
    pageInfo: { title: 'Portal', navLinks: [{ title: 'n8n', path: '{n8nBaseUrl}' }] },
    appConfig: { preventWriteToDisk: true },
    toolsSection: { name: 'Tools', items: [{ title: 'アプリ作成', url: '{studioUrl}' }] },
  };

  test('builds tools section, category sections and workflow items', () => {
    const { config, warnings } = buildDashyConfig({
      dashboard,
      categories,
      workflows: [
        {
          name: 'order-notify',
          workflow: webhookWorkflow(),
          hasSpec: true,
          designPath: 'designs/order-notify.md',
          summary: '注文通知の設計',
        },
      ],
    });

    expect(warnings).toEqual([]);
    expect(config.pageInfo.navLinks[0].path).toBe('http://localhost:5678/');
    expect(config.sections.map((s) => s.name)).toEqual(['Tools', '[SLS] 営業']);
    expect(config.sections[0].items[0].url).toBe('http://localhost:3100');

    const item = config.sections[1].items[0];
    expect(item).toMatchObject({
      title: '注文通知',
      url: 'http://localhost:5678/workflow/Wf000000000000001',
      tags: ['SLS', 'POST'],
      description: '[SLS] 注文通知（金額で振り分け） | 注文通知の設計 | POST /webhook/order-notify',
    });
    expect(item.subItems).toEqual([
      {
        title: 'POST http://localhost:5678/webhook/order-notify をコピー',
        url: 'http://localhost:5678/webhook/order-notify',
        icon: 'fas fa-copy',
        target: 'clipboard',
      },
      {
        title: '仕様書',
        url: 'https://github.com/o/r/blob/main/doc/specifications/order-notify.md',
        icon: 'fas fa-file-alt',
      },
      {
        title: '設計書',
        url: 'https://github.com/o/r/blob/main/designs/order-notify.md',
        icon: 'fas fa-drafting-compass',
      },
    ]);
  });

  test('puts workflows without exactly one category into 未分類 with a warning', () => {
    const { config, warnings } = buildDashyConfig({
      dashboard: { links },
      categories,
      workflows: [
        { name: 'a', workflow: webhookWorkflow({ tags: [] }), hasSpec: false, designPath: null },
        {
          name: 'b',
          workflow: webhookWorkflow({ name: 'B', tags: ['SLS', 'OPS'] }),
          hasSpec: false,
          designPath: null,
        },
      ],
    });
    expect(warnings).toHaveLength(2);
    expect(config.sections.map((s) => s.name)).toEqual(['未分類']);
    expect(config.sections[0].items[0].subItems).toHaveLength(1);
  });
});

describe('repository config', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (rel) => YAML.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

  test('config/categories.yml is valid', () => {
    expect(validateCategories(read('config/categories.yml').categories)).toEqual([]);
  });

  test('config/dashboard.yml has links and no unresolved placeholders after fill', () => {
    const dashboard = read('config/dashboard.yml');
    expect(Object.keys(dashboard.links)).toEqual(
      expect.arrayContaining(['n8nBaseUrl', 'studioUrl', 'repoUrl', 'repoBranch']),
    );
    const filled = JSON.stringify(fillLinks(dashboard, dashboard.links));
    expect(filled).not.toMatch(/\{(n8nBaseUrl|studioUrl|repoUrl|repoBranch)\}/);
  });
});
