#!/usr/bin/env node
/**
 * Workflow Studio をバックグラウンドで起動・停止する（npm run up / down から使う）。
 *
 *   node scripts/studio-ctl.js start    起動（起動済みなら何もしない）
 *   node scripts/studio-ctl.js stop     停止
 *   node scripts/studio-ctl.js status   状態
 *
 * PID とログは .studio/（Git 管理外）に置く。フォアグラウンドで動かす場合は npm run studio。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, '.studio');
const PID_FILE = path.join(DIR, 'studio.pid');
const LOG_FILE = path.join(DIR, 'studio.log');
const PORT = Number(process.env.STUDIO_PORT || 3100);
const URL_BASE = `http://localhost:${PORT}`;

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    process.kill(pid, 0); // 生きているか確認するだけ
    return pid;
  } catch {
    return null;
  }
}

async function healthy() {
  try {
    const res = await fetch(`${URL_BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function start() {
  if (await healthy()) {
    console.log(`Workflow Studio は起動済みです: ${URL_BASE}`);
    return 0;
  }
  fs.mkdirSync(DIR, { recursive: true });
  const log = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'studio', 'server.js')], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', log, log],
    env: process.env,
  });
  fs.writeFileSync(PID_FILE, String(child.pid));
  child.unref();
  for (let i = 0; i < 20; i += 1) {
    if (await healthy()) {
      console.log(`Workflow Studio を起動しました: ${URL_BASE}（ログ: .studio/studio.log）`);
      return 0;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.error(`Workflow Studio が起動しませんでした。.studio/studio.log を確認してください。`);
  return 1;
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log('Workflow Studio は起動していません');
    fs.rmSync(PID_FILE, { force: true });
    return 0;
  }
  process.kill(pid, 'SIGTERM');
  fs.rmSync(PID_FILE, { force: true });
  console.log('Workflow Studio を停止しました');
  return 0;
}

async function status() {
  const ok = await healthy();
  console.log(ok ? `running  ${URL_BASE}` : 'stopped');
  return 0;
}

const commands = { start, stop, status };
const command = commands[process.argv[2]];
if (!command) {
  console.error('usage: node scripts/studio-ctl.js <start|stop|status>');
  process.exit(1);
}
Promise.resolve(command()).then((code) => process.exit(code));
