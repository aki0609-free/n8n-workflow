/**
 * Workflow Studio: claude -p の実行（ジョブ）を管理し、出力をイベントとして中継する。
 * 同時に動かすジョブは 1 つだけ（リポジトリを同時に書き換えないため）。
 */
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { childEnv, parseStreamLine } = require('../../scripts/lib/claude-cli');

const MAX_EVENTS = 5000;
const MAX_JOBS = 20;

class JobManager extends EventEmitter {
  /**
   * @param {{ root: string, command?: string, spawnFn?: typeof spawn }} options
   */
  constructor({ root, command = 'claude', spawnFn = spawn }) {
    super();
    this.root = root;
    this.command = command;
    this.spawnFn = spawnFn;
    this.jobs = new Map();
  }

  running() {
    return [...this.jobs.values()].find((j) => j.status === 'running') || null;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  /**
   * @param {{ kind: string, label: string, args: string[], onEvent?: (job, event) => object[] | void }} spec
   *   onEvent は各イベントの後に呼ばれ、追加のイベントを返せる（例: 設計書の下書きの検出）
   */
  start({ kind, label, args, onEvent }) {
    const busy = this.running();
    if (busy) {
      throw Object.assign(new Error(`他の処理が実行中です: ${busy.label}`), { status: 409 });
    }
    const job = {
      id: crypto.randomUUID(),
      kind,
      label,
      status: 'running',
      startedAt: new Date().toISOString(),
      events: [],
      texts: [],
      child: null,
    };
    this.jobs.set(job.id, job);
    this.trim();

    const push = (event) => {
      const e = { seq: job.events.length, ...event };
      if (job.events.length < MAX_EVENTS) job.events.push(e);
      if (event.kind === 'text') job.texts.push(event.text);
      this.emit(`event:${job.id}`, e);
      if (onEvent) for (const extra of onEvent(job, event) || []) push(extra);
    };

    let child;
    try {
      child = this.spawnFn(this.command, args, {
        cwd: this.root,
        env: childEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      push({ kind: 'error', text: err.message });
      this.finish(job, 'failed', push);
      return job;
    }
    job.child = child;

    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        for (const event of parseStreamLine(line)) push(event);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      for (const line of chunk.split('\n')) if (line.trim()) push({ kind: 'log', text: line });
    });
    child.on('error', (err) => {
      push({
        kind: 'error',
        text:
          err.code === 'ENOENT'
            ? 'claude コマンドが見つかりません。Claude Code をインストールしてログインしてください。'
            : err.message,
      });
      this.finish(job, 'failed', push);
    });
    child.on('close', (code, signal) => {
      if (buffer.trim()) for (const event of parseStreamLine(buffer)) push(event);
      buffer = '';
      if (job.status !== 'running') return;
      const status = job.cancelled ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
      push({ kind: 'exit', code, signal: signal || null });
      this.finish(job, status, push);
    });
    return job;
  }

  finish(job, status, push) {
    if (job.status !== 'running') return;
    job.status = status;
    job.finishedAt = new Date().toISOString();
    job.child = null;
    push({ kind: 'end', status });
  }

  cancel(id) {
    const job = this.get(id);
    if (!job || job.status !== 'running' || !job.child) return false;
    job.cancelled = true;
    job.child.kill('SIGTERM');
    return true;
  }

  trim() {
    const finished = [...this.jobs.values()].filter((j) => j.status !== 'running');
    while (this.jobs.size > MAX_JOBS && finished.length > 0) {
      this.jobs.delete(finished.shift().id);
    }
  }

  summary(job) {
    const { id, kind, label, status, startedAt, finishedAt } = job;
    return { id, kind, label, status, startedAt, finishedAt: finishedAt || null };
  }
}

module.exports = { JobManager };
