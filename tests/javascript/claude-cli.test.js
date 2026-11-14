const {
  buildArgs,
  interviewArgs,
  childEnv,
  parseStreamLine,
  AUTO_ALLOWED_TOOLS,
} = require('../../scripts/lib/claude-cli');

describe('buildArgs', () => {
  test('runs /build-from-design non-interactively with allowed tools', () => {
    const args = buildArgs('designs/a.md');
    expect(args.slice(0, 2)).toEqual(['-p', '/build-from-design designs/a.md']);
    expect(args).toEqual(expect.arrayContaining(['--allowedTools', ...AUTO_ALLOWED_TOOLS]));
    expect(args).not.toContain('--output-format');
    expect(buildArgs('designs/a.md', { streamJson: true }).slice(-3)).toEqual([
      '--output-format',
      'stream-json',
      '--verbose',
    ]);
  });

  test('does not allow MCP tools that mutate n8n workflows', () => {
    for (const t of ['create_workflow_from_code', 'update_workflow', 'publish_workflow']) {
      expect(AUTO_ALLOWED_TOOLS).not.toContain(`mcp__n8n__${t}`);
    }
  });
});

describe('interviewArgs', () => {
  test('uses the design-interviewer agent without write tools', () => {
    const args = interviewArgs('hello');
    expect(args.slice(0, 2)).toEqual(['-p', 'hello']);
    expect(args).toEqual(expect.arrayContaining(['--agent', 'design-interviewer']));
    const allowed = args.slice(
      args.indexOf('--allowedTools') + 1,
      args.indexOf('--disallowedTools'),
    );
    expect(allowed).not.toContain('Write');
    expect(allowed).not.toContain('Bash');
    expect(args).not.toContain('--resume');
  });

  test('resumes a session only with a valid id', () => {
    const id = '0f6a3a52-4c7d-4b8e-9a51-2f8d0c1b7e11';
    expect(interviewArgs('x', { sessionId: id })).toEqual(expect.arrayContaining(['--resume', id]));
    expect(() => interviewArgs('x', { sessionId: '--dangerously-skip' })).toThrow('sessionId');
  });
});

describe('childEnv', () => {
  test('removes API credentials so the subscription is used', () => {
    const env = childEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't' });
    expect(env).toEqual({ PATH: '/bin' });
  });
});

describe('parseStreamLine', () => {
  test('init reports billing source', () => {
    expect(
      parseStreamLine(
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', apiKeySource: 'none' }),
      ),
    ).toEqual([{ kind: 'init', sessionId: 's', billing: 'subscription' }]);
    expect(
      parseStreamLine(
        JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' }),
      )[0].billing,
    ).toBe('api');
  });

  test('assistant text and tool use', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', name: 'Read', input: { file_path: 'designs/_TEMPLATE.md' } },
          {
            type: 'tool_use',
            name: 'mcp__n8n__search_nodes',
            input: { queries: ['form', 'slack'] },
          },
        ],
      },
    });
    expect(parseStreamLine(line)).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'tool', name: 'Read', summary: 'designs/_TEMPLATE.md' },
      { kind: 'tool', name: 'mcp__n8n__search_nodes', summary: 'form, slack' },
    ]);
  });

  test('skips subagent messages, reports tool errors and results', () => {
    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'assistant',
          parent_tool_use_id: 'x',
          message: { content: [{ type: 'text', text: 'inner' }] },
        }),
      ),
    ).toEqual([]);
    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'tool_result', is_error: true, content: 'denied' }] },
        }),
      ),
    ).toEqual([{ kind: 'tool_error', text: 'denied' }]);
    expect(
      parseStreamLine(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'ok',
          session_id: 's',
        }),
      ),
    ).toEqual([{ kind: 'result', ok: true, text: 'ok', sessionId: 's' }]);
  });

  test('non-JSON lines become logs, blank lines are ignored', () => {
    expect(parseStreamLine('plain')).toEqual([{ kind: 'log', text: 'plain' }]);
    expect(parseStreamLine('  ')).toEqual([]);
    expect(parseStreamLine(JSON.stringify({ type: 'rate_limit_event' }))).toEqual([]);
  });
});
