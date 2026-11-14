const {
  run,
  buildTitleFromMemo,
  formatJst,
  parseDate,
} = require('../../src/javascript/code-nodes/memo-to-gmail-build-memo-mail');

// 2026-11-14 10:30 JST
const SUBMITTED_AT = '2026-11-14T10:30:00.000+09:00';
// now の固定値: 2026-01-02 03:04 JST
const FIXED_NOW = new Date('2026-01-01T18:04:00.000Z');

const runOne = (json, now = FIXED_NOW) => run([{ json }], now)[0].json;

describe('memo-to-gmail-build-memo-mail', () => {
  test('正常例: Form Trigger の出力からメールの件名・本文を作る', () => {
    const items = [
      {
        json: {
          title: '買い物リスト',
          memo: '牛乳\n卵\nパン',
          submittedAt: SUBMITTED_AT,
          formMode: 'test',
        },
      },
    ];

    expect(run(items, FIXED_NOW)).toEqual([
      {
        json: {
          valid: true,
          errors: [],
          subjectTitle: '買い物リスト',
          sentAtText: '2026-11-14 10:30',
          subject: '[メモ] 2026-11-14 10:30 買い物リスト',
          text: '牛乳\n卵\nパン\n\n---\n送信日時: 2026-11-14 10:30',
        },
      },
    ]);
  });

  test('title があればそれを件名に使う（設計書 Case 1）', () => {
    const out = runOne({
      title: 'テスト件名',
      memo: 'テストのメモです\n2 行目',
      submittedAt: SUBMITTED_AT,
    });
    expect(out.valid).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.subjectTitle).toBe('テスト件名');
    expect(out.subject).toBe('[メモ] 2026-11-14 10:30 テスト件名');
    expect(out.text).toBe('テストのメモです\n2 行目\n\n---\n送信日時: 2026-11-14 10:30');
  });

  test('title が空なら memo の先頭から件名を作り、20 文字を超えたら「…」で切る（設計書 Case 2）', () => {
    const out = runOne({
      title: '',
      memo: 'テスト本文の先頭二十文字を件名に使うことを確かめる',
      submittedAt: SUBMITTED_AT,
    });
    expect(out.valid).toBe(true);
    expect(out.subjectTitle).toBe('テスト本文の先頭二十文字を件名に使うこ…');
    expect(Array.from(out.subjectTitle)).toHaveLength(20);
  });

  test('title が空白だけでも memo から件名を作る', () => {
    expect(runOne({ title: '   ', memo: '本文', submittedAt: SUBMITTED_AT }).subjectTitle).toBe(
      '本文',
    );
  });

  test('title・memo の前後の空白を取り除く', () => {
    const out = runOne({ title: '  件名  ', memo: '\n  本文  \n', submittedAt: SUBMITTED_AT });
    expect(out.subjectTitle).toBe('件名');
    expect(out.text).toBe('本文\n\n---\n送信日時: 2026-11-14 10:30');
  });

  describe('memo が空', () => {
    test('空白・改行だけなら valid:false / memo_required（設計書 Case 3）', () => {
      const out = runOne({ title: '空メモ', memo: '   \n  ', submittedAt: SUBMITTED_AT });
      expect(out.valid).toBe(false);
      expect(out.errors).toEqual(['memo_required']);
      expect(out.subjectTitle).toBe('空メモ');
      expect(out.sentAtText).toBe('2026-11-14 10:30');
      expect(out.subject).toBe('[メモ] 2026-11-14 10:30 空メモ');
      expect(out.text).toBe('\n\n---\n送信日時: 2026-11-14 10:30');
    });

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['数値', 123],
      ['オブジェクト', { a: 1 }],
      ['空文字', ''],
    ])('memo が %s なら空扱い', (_label, memo) => {
      const out = runOne({ title: 'x', memo, submittedAt: SUBMITTED_AT });
      expect(out.valid).toBe(false);
      expect(out.errors).toEqual(['memo_required']);
    });

    test('title も無ければ subjectTitle は空文字', () => {
      const out = runOne({ submittedAt: SUBMITTED_AT });
      expect(out.valid).toBe(false);
      expect(out.subjectTitle).toBe('');
      expect(out.subject).toBe('[メモ] 2026-11-14 10:30 ');
    });
  });

  describe('memo から作る件名', () => {
    test('改行（\\r\\n, \\n, \\r）は半角スペースになる', () => {
      const out = runOne({ title: '', memo: 'a\r\nb\nc\rd', submittedAt: SUBMITTED_AT });
      expect(out.subjectTitle).toBe('a b c d');
      // 本文の改行はそのまま
      expect(out.text.startsWith('a\r\nb\nc\rd\n\n---')).toBe(true);
    });

    test('ちょうど 20 文字なら「…」を付けない', () => {
      const memo = 'あいうえおかきくけこさしすせそたちつてと';
      expect(Array.from(memo)).toHaveLength(20);
      expect(runOne({ title: '', memo, submittedAt: SUBMITTED_AT }).subjectTitle).toBe(memo);
    });

    test('21 文字なら「…」を含めて 20 文字に収める', () => {
      const memo = 'あいうえおかきくけこさしすせそたちつてとな';
      expect(buildTitleFromMemo(memo)).toBe('あいうえおかきくけこさしすせそたちつて…');
    });

    test('絵文字（サロゲートペア）を 1 文字と数える', () => {
      const memo = '😀'.repeat(20);
      expect(memo.length).toBe(40); // UTF-16 では 40
      expect(runOne({ title: '', memo, submittedAt: SUBMITTED_AT }).subjectTitle).toBe(memo);

      const longer = '😀'.repeat(21);
      const title = buildTitleFromMemo(longer);
      expect(title).toBe('😀'.repeat(19) + '…');
      // 絵文字が途中で割れていない
      expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    test('改行入りで 20 文字を超える場合も置換後に数える', () => {
      const memo = '1行目のメモです\n2行目のメモです\n3行目';
      expect(runOne({ title: '', memo, submittedAt: SUBMITTED_AT }).subjectTitle).toBe(
        '1行目のメモです 2行目のメモです 3…',
      );
    });
  });

  describe('sentAtText', () => {
    test('submittedAt が無ければ now から作る', () => {
      expect(runOne({ title: 't', memo: 'm' }).sentAtText).toBe('2026-01-02 03:04');
    });

    test.each([
      ['不正な文字列', 'not-a-date'],
      ['空文字', ''],
      ['null', null],
      ['オブジェクト', {}],
    ])('submittedAt が %s なら now から作る', (_label, submittedAt) => {
      const out = runOne({ title: 't', memo: 'm', submittedAt });
      expect(out.sentAtText).toBe('2026-01-02 03:04');
      expect(out.subject).toBe('[メモ] 2026-01-02 03:04 t');
    });

    test('UTC 表記の submittedAt を日本時間に変換する', () => {
      const out = runOne({ title: 't', memo: 'm', submittedAt: '2026-11-14T01:30:00.000Z' });
      expect(out.sentAtText).toBe('2026-11-14 10:30');
    });

    test('日付をまたぐ変換（UTC 15:00 → JST 翌日 00:00）', () => {
      const out = runOne({ title: 't', memo: 'm', submittedAt: '2026-12-31T15:00:00Z' });
      expect(out.sentAtText).toBe('2027-01-01 00:00');
    });

    test('now を省略しても現在時刻で埋まる', () => {
      const out = run([{ json: { title: 't', memo: 'm' } }])[0].json;
      expect(out.sentAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });
  });

  describe('items の境界値', () => {
    test('空配列なら空配列', () => {
      expect(run([], FIXED_NOW)).toEqual([]);
    });

    test('配列以外なら空配列', () => {
      expect(run(undefined, FIXED_NOW)).toEqual([]);
    });

    test('json が無い item は memo_required になる', () => {
      const out = run([{}], FIXED_NOW);
      expect(out).toHaveLength(1);
      expect(out[0].json.errors).toEqual(['memo_required']);
      expect(out[0].json.sentAtText).toBe('2026-01-02 03:04');
    });

    test('入力 1 件につき 1 件を同じ順序で返す', () => {
      const out = run(
        [
          { json: { title: 'A', memo: 'a', submittedAt: SUBMITTED_AT } },
          { json: { title: 'B', memo: '' } },
        ],
        FIXED_NOW,
      );
      expect(out.map((i) => [i.json.subjectTitle, i.json.valid])).toEqual([
        ['A', true],
        ['B', false],
      ]);
    });
  });

  describe('helpers', () => {
    test('formatJst は 0 埋めする', () => {
      expect(formatJst(new Date('2026-02-03T00:05:00Z'))).toBe('2026-02-03 09:05');
    });

    test('parseDate は不正値に null を返す', () => {
      expect(parseDate('x')).toBeNull();
      expect(parseDate(new Date('x'))).toBeNull();
      expect(parseDate(undefined)).toBeNull();
    });
  });
});
