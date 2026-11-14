const fs = require('node:fs');
const path = require('node:path');
const {
  parseEnv,
  listKeys,
  collectPlaceholders,
  renderCredentials,
  checkKeys,
  linesToAppend,
} = require('../../scripts/lib/secrets');

describe('parseEnv', () => {
  test('parses comments, quotes, export prefix and inline comments', () => {
    const text = [
      '# comment',
      '',
      'A=1',
      'export B = two ',
      'C="quoted # not comment"',
      "D='single'",
      'E=value # trailing comment',
      'EMPTY=',
      'not a line',
    ].join('\n');
    expect(parseEnv(text)).toEqual({
      A: '1',
      B: 'two',
      C: 'quoted # not comment',
      D: 'single',
      E: 'value',
      EMPTY: '',
    });
    expect(listKeys(text)).toEqual(['A', 'B', 'C', 'D', 'E', 'EMPTY']);
  });
});

describe('renderCredentials', () => {
  const template = [
    { id: 'c1', name: 'Slack', type: 'slackApi', data: { accessToken: '${SLACK}' } },
    {
      id: 'c2',
      name: 'SMTP',
      type: 'smtp',
      data: { port: '${PORT:number}', secure: '${SECURE:boolean}', host: 'smtp.${DOMAIN}' },
    },
    { id: 'c3', name: 'OpenAI', type: 'openAiApi', data: { apiKey: '${KEY}', org: '${ORG?}' } },
  ];

  test('renders typed values, omits empty optional fields, skips incomplete entries', () => {
    const { credentials, skipped } = renderCredentials(template, {
      SLACK: '',
      PORT: '587',
      SECURE: 'true',
      DOMAIN: 'example.com',
      KEY: 'k',
      ORG: '',
    });
    expect(credentials).toEqual([
      {
        id: 'c2',
        name: 'SMTP',
        type: 'smtp',
        data: { port: 587, secure: true, host: 'smtp.example.com' },
      },
      { id: 'c3', name: 'OpenAI', type: 'openAiApi', data: { apiKey: 'k' } },
    ]);
    expect(skipped).toEqual([{ name: 'Slack', missing: ['SLACK'] }]);
  });

  test('reports invalid number conversion as skipped', () => {
    const { skipped } = renderCredentials([template[1]], {
      PORT: 'abc',
      SECURE: 'false',
      DOMAIN: 'x',
    });
    expect(skipped).toEqual([{ name: 'SMTP', missing: [], error: 'expected a number' }]);
  });
});

describe('checkKeys / linesToAppend', () => {
  test('reports status without exposing values', () => {
    expect(checkKeys(['A', 'B', 'C'], { A: 'x', B: ' ' })).toEqual([
      { key: 'A', status: 'set' },
      { key: 'B', status: 'empty' },
      { key: 'C', status: 'missing' },
    ]);
  });

  test('returns example lines for keys missing in secrets', () => {
    expect(linesToAppend('# c\nA=\nB=default\nC=', 'A=filled')).toEqual(['B=default', 'C=']);
  });
});

describe('repository config consistency', () => {
  const root = path.resolve(__dirname, '../..');
  const exampleKeys = listKeys(
    fs.readFileSync(path.join(root, 'config/secrets.example.env'), 'utf8'),
  );
  const template = JSON.parse(
    fs.readFileSync(path.join(root, 'config/credentials.template.json'), 'utf8'),
  );

  test('every placeholder in credentials.template.json exists in secrets.example.env', () => {
    const used = [...new Set(collectPlaceholders(template.map((t) => t.data)).map((p) => p.key))];
    expect(used.filter((k) => !exampleKeys.includes(k))).toEqual([]);
  });

  test('credential ids and names are unique', () => {
    expect(new Set(template.map((t) => t.id)).size).toBe(template.length);
    expect(new Set(template.map((t) => t.name)).size).toBe(template.length);
  });
});
