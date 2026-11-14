const {
  run,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  extractRecords,
} = require('../../src/javascript/code-nodes/format-contacts');

describe('normalize helpers', () => {
  test('normalizeEmail trims, lowercases and validates', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });

  test('normalizeName collapses whitespace', () => {
    expect(normalizeName('  Taro   Yamada ')).toBe('Taro Yamada');
    expect(normalizeName(null)).toBe('');
  });

  test('normalizePhone keeps digits and leading plus', () => {
    expect(normalizePhone('+81 (90) 1234-5678')).toBe('+819012345678');
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('extractRecords', () => {
  test('reads Webhook body.contacts', () => {
    expect(extractRecords({ body: { contacts: [{ email: 'a@b.co' }] } })).toEqual([
      { email: 'a@b.co' },
    ]);
  });

  test('reads a single object or array body', () => {
    expect(extractRecords({ body: { email: 'a@b.co' } })).toEqual([{ email: 'a@b.co' }]);
    expect(extractRecords({ body: [{ email: 'a@b.co' }] })).toEqual([{ email: 'a@b.co' }]);
    expect(extractRecords({ email: 'a@b.co' })).toEqual([{ email: 'a@b.co' }]);
  });
});

describe('run (n8n Code node entrypoint)', () => {
  test('returns a single n8n item with valid, invalid and summary', () => {
    const items = [
      {
        json: {
          body: {
            contacts: [
              { name: ' Alice ', email: 'ALICE@example.com', phone: '090-1111-2222' },
              { name: 'Alice dup', email: 'alice@example.com' },
              { name: 'Bob', email: 'bob@@example' },
            ],
          },
        },
      },
    ];

    const result = run(items);

    expect(result).toHaveLength(1);
    expect(result[0].json).toEqual({
      contacts: [{ name: 'Alice', email: 'alice@example.com', phone: '09011112222' }],
      invalid: [
        {
          name: 'Bob',
          email: null,
          phone: null,
          rawEmail: 'bob@@example',
          reason: 'invalid_email',
        },
      ],
      summary: { valid: 1, invalid: 1 },
    });
  });

  test('handles empty input', () => {
    expect(run([])[0].json.summary).toEqual({ valid: 0, invalid: 0 });
  });
});
