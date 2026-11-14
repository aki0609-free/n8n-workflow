const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadApiKey, createClient } = require('../../scripts/lib/n8n-api');

const response = (status, body = '') => ({ status, ok: status < 400, text: async () => body });

describe('loadApiKey', () => {
  test('prefers the environment, then secrets/secrets.env', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-api-'));
    expect(loadApiKey(root, {})).toBeNull();
    fs.mkdirSync(path.join(root, 'secrets'));
    fs.writeFileSync(path.join(root, 'secrets', 'secrets.env'), 'N8N_API_KEY=from-file\n');
    expect(loadApiKey(root, {})).toBe('from-file');
    expect(loadApiKey(root, { N8N_API_KEY: 'from-env' })).toBe('from-env');
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('createClient', () => {
  test('sends the API key and parses JSON', async () => {
    const calls = [];
    const client = createClient({
      apiKey: 'k',
      baseUrl: 'http://n8n:5678/',
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        return response(200, '{"active":true}');
      },
    });
    expect(await client.isPublished('W1')).toBe(true);
    expect(calls[0].url).toBe('http://n8n:5678/api/v1/workflows/W1');
    expect(calls[0].init.headers['X-N8N-API-KEY']).toBe('k');
  });

  test('isPublished returns null for unknown workflows', async () => {
    const client = createClient({ apiKey: 'k', fetchFn: async () => response(404, 'nope') });
    expect(await client.isPublished('W1')).toBeNull();
  });

  test('setPublished falls back to activate on older n8n', async () => {
    const urls = [];
    const client = createClient({
      apiKey: 'k',
      baseUrl: 'http://n8n/',
      fetchFn: async (url) => {
        urls.push(String(url));
        return String(url).endsWith('/publish') ? response(404) : response(200, '{}');
      },
    });
    await client.setPublished('W1', true);
    expect(urls).toEqual([
      'http://n8n/api/v1/workflows/W1/publish',
      'http://n8n/api/v1/workflows/W1/activate',
    ]);
  });
});
