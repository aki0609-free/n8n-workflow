#!/usr/bin/env node
/**
 * Workflow Studio — ワークフロー（アプリ）を作るための小さな Web サイト。
 *
 *   npm run studio            フォアグラウンドで起動（http://localhost:3100）
 *   npm run up                n8n・Dashy と一緒にバックグラウンドで起動
 *
 * - 設計書から作成: designs/*.md を編集・保存し、claude -p で /build-from-design を実行する
 * - 対話から作成  : claude -p --agent design-interviewer と会話して設計書を作り、保存する
 *
 * Claude Code のサブスクリプション（ログイン）で動かすため、ANTHROPIC_API_KEY は子プロセスに渡さない。
 * 環境変数: STUDIO_PORT（既定 3100）、STUDIO_HOST（既定 127.0.0.1）
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { JobManager } = require('./lib/jobs');
const { checkRequest } = require('./lib/security');
const store = require('./lib/design-store');
const runner = require('./lib/workflow-runner');
const { buildArgs, interviewArgs } = require('../scripts/lib/claude-cli');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.STUDIO_PORT || 3100);
const HOST = process.env.STUDIO_HOST || '127.0.0.1';
const MAX_BODY = 1024 * 1024;
const N8N_URL = process.env.N8N_BASE_URL || `http://localhost:${process.env.N8N_PORT || 5678}`;

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/run': ['run.html', 'text/html; charset=utf-8'],
  '/run.js': ['run.js', 'text/javascript; charset=utf-8'],
};

const jobs = new JobManager({ root: ROOT, command: process.env.STUDIO_CLAUDE_COMMAND || 'claude' });

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/** 対話の 1 往復が終わったら、返答から設計書の下書きを探してイベントにする */
function detectDraft(job, event) {
  if (event.kind !== 'result') return [];
  const draft = store.extractDesignDraft(job.texts.join('\n\n'));
  if (!draft) return [];
  const plan = store.planSave(ROOT, draft.content, { overwrite: true });
  return [{ kind: 'draft', content: draft.content, file: plan.file, problems: plan.problems }];
}

function streamEvents(req, res, job) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const since = Number(req.headers['last-event-id'] ?? -1);
  const send = (e) => res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`);
  for (const e of job.events) if (e.seq > since) send(e);
  if (job.status !== 'running') {
    res.end();
    return;
  }
  const listener = (e) => {
    send(e);
    if (e.kind === 'end') res.end();
  };
  jobs.on(`event:${job.id}`, listener);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    jobs.off(`event:${job.id}`, listener);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const m = req.method;

  if (m === 'GET' && STATIC_FILES[p]) {
    const [file, type] = STATIC_FILES[p];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(path.join(PUBLIC_DIR, file)));
    return;
  }

  if (m === 'GET' && p === '/api/health') return sendJson(res, 200, { ok: true });

  if (m === 'GET' && p === '/api/meta') {
    const running = jobs.running();
    return sendJson(res, 200, {
      categories: store.loadCategories(ROOT),
      running: running ? jobs.summary(running) : null,
      links: {
        n8n: `http://localhost:${process.env.N8N_PORT || 5678}`,
        dashy: `http://localhost:${process.env.DASHY_PORT || 4000}`,
      },
    });
  }

  if (m === 'GET' && p === '/api/designs') return sendJson(res, 200, store.listAll(ROOT));

  if (m === 'GET' && p === '/api/design') {
    const file = url.searchParams.get('file') || '';
    return sendJson(res, 200, { file, content: store.readDesign(ROOT, file) });
  }

  if (m === 'POST' && p === '/api/design/check') {
    const { content = '', file, overwrite } = await readJson(req);
    return sendJson(res, 200, store.planSave(ROOT, String(content), { file, overwrite }));
  }

  if (m === 'PUT' && p === '/api/design') {
    const { content = '', file, overwrite } = await readJson(req);
    const result = store.saveDesign(ROOT, String(content), { file, overwrite: Boolean(overwrite) });
    return sendJson(res, result.errors.length ? 422 : 200, result);
  }

  if (m === 'POST' && p === '/api/build') {
    const { file } = await readJson(req);
    const design = store.listAll(ROOT).find((d) => d.file === file);
    if (!design) return sendJson(res, 404, { error: `設計書が見つかりません: ${file}` });
    if (design.problems.length) {
      return sendJson(res, 422, { error: 'まだ構築できません', problems: design.problems });
    }
    const job = jobs.start({
      kind: 'build',
      label: `構築: ${file}`,
      args: buildArgs(file, { streamJson: true }),
    });
    return sendJson(res, 202, jobs.summary(job));
  }

  if (m === 'POST' && p === '/api/chat') {
    const { message, sessionId } = await readJson(req);
    if (typeof message !== 'string' || !message.trim()) {
      return sendJson(res, 400, { error: 'message is required' });
    }
    const job = jobs.start({
      kind: 'interview',
      label: '対話から作成',
      args: interviewArgs(message.trim(), { sessionId: sessionId || undefined }),
      onEvent: detectDraft,
    });
    return sendJson(res, 202, jobs.summary(job));
  }

  // 実行ページ（Dashy のカードから開く）
  const wfMatch = p.match(/^\/api\/workflows\/([A-Za-z0-9]{1,64})(\/run)?$/);
  if (wfMatch) {
    const info = runner.findWorkflow(ROOT, wfMatch[1]);
    if (!info) return sendJson(res, 404, { error: `ワークフローが見つかりません: ${wfMatch[1]}` });
    if (m === 'GET' && !wfMatch[2]) {
      return sendJson(res, 200, {
        ...info,
        n8nUrl: N8N_URL,
        editorUrl: `${N8N_URL}/workflow/${info.id}`,
      });
    }
    if (m === 'POST' && wfMatch[2] === '/run') {
      const { webhook = 0, body } = await readJson(req);
      return sendJson(
        res,
        200,
        await runner.runWebhook(info, Number(webhook), { body, n8nUrl: N8N_URL }),
      );
    }
  }

  const jobMatch = p.match(/^\/api\/jobs\/([0-9a-f-]{36})(\/events|\/cancel)?$/);
  if (jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) return sendJson(res, 404, { error: 'job not found' });
    if (m === 'GET' && jobMatch[2] === '/events') return streamEvents(req, res, job);
    if (m === 'POST' && jobMatch[2] === '/cancel') {
      return sendJson(res, 200, { cancelled: jobs.cancel(job.id) });
    }
    if (m === 'GET' && !jobMatch[2]) return sendJson(res, 200, jobs.summary(job));
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const denied = checkRequest(req, PORT);
  if (denied) return sendJson(res, 403, { error: denied });
  route(req, res).catch((err) => {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Workflow Studio: http://localhost:${PORT}  (listening on ${HOST}:${PORT})`);
});

function shutdown() {
  const running = jobs.running();
  if (running) jobs.cancel(running.id);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
