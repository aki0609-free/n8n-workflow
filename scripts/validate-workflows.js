#!/usr/bin/env node
/**
 * workflows/ 配下の *.json を JSON 構文 + n8n ワークフロー構造の両面でチェックする。
 * 使い方: node scripts/validate-workflows.js [ファイル...]
 */
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { validateWorkflow } = require('./lib/workflow-validator');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, 'workflows');
const CREDENTIALS_TEMPLATE = path.join(ROOT, 'config', 'credentials.template.json');
const CATEGORIES = path.join(ROOT, 'config', 'categories.yml');

const categoryCodes = fs.existsSync(CATEGORIES)
  ? (YAML.parse(fs.readFileSync(CATEGORIES, 'utf8')).categories || []).map((c) => c.code)
  : undefined;

const knownCredentials = fs.existsSync(CREDENTIALS_TEMPLATE)
  ? JSON.parse(fs.readFileSync(CREDENTIALS_TEMPLATE, 'utf8')).map(({ id, name, type }) => ({
      id,
      name,
      type,
    }))
  : undefined;

function listWorkflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) return [];
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(WORKFLOW_DIR, f));
}

const files =
  process.argv.length > 2 ? process.argv.slice(2).map((f) => path.resolve(f)) : listWorkflowFiles();

if (files.length === 0) {
  console.log('No workflow files found.');
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  let workflow;
  try {
    workflow = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`✗ ${rel}: invalid JSON - ${err.message}`);
    failed += 1;
    continue;
  }
  const errors = validateWorkflow(workflow, { knownCredentials, categoryCodes });
  if (errors.length > 0) {
    failed += 1;
    console.error(`✗ ${rel}`);
    for (const e of errors) console.error(`    - ${e}`);
  } else {
    console.log(`✓ ${rel}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} of ${files.length} workflow file(s) failed validation.`);
  process.exit(1);
}
console.log(`\nAll ${files.length} workflow file(s) are valid.`);
