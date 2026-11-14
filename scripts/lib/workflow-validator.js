/**
 * n8n ワークフロー JSON の構造バリデーション。
 * JSON 構文エラーは呼び出し側（validate-workflows.js）で検出する。
 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ワークフロー JSON に直書きされた秘密情報を検出するパターン
const SECRET_PATTERNS = [
  { name: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'Slack token', re: /\bxox[abpors]-[A-Za-z0-9-]{10,}/ },
  { name: 'Slack webhook URL', re: /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },
  { name: 'Discord webhook URL', re: /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/ },
  {
    name: 'GitHub token',
    re: /\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/,
  },
  { name: 'Notion secret', re: /\b(?:secret|ntn)_[A-Za-z0-9]{30,}/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/ },
];

function findSecrets(value, pathLabel, found = []) {
  if (typeof value === 'string') {
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(value)) found.push(`${pathLabel}: looks like a hardcoded ${name}`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findSecrets(v, `${pathLabel}[${i}]`, found));
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) findSecrets(v, `${pathLabel}.${k}`, found);
  }
  return found;
}

function validateCredentialRefs(node, label, knownCredentials) {
  const errors = [];
  if (node.credentials === undefined) return errors;
  if (!isPlainObject(node.credentials)) return [`${label}: "credentials" must be an object`];
  for (const [type, ref] of Object.entries(node.credentials)) {
    if (!isPlainObject(ref) || typeof ref.id !== 'string') {
      errors.push(`${label}: credentials.${type} must have a string "id"`);
      continue;
    }
    if (!knownCredentials) continue;
    const known = knownCredentials.find((c) => c.id === ref.id);
    if (!known) {
      errors.push(
        `${label}: credential id "${ref.id}" is not defined in config/credentials.template.json`,
      );
    } else if (known.type !== type) {
      errors.push(
        `${label}: credential "${ref.id}" is type "${known.type}", but used as "${type}"`,
      );
    }
  }
  return errors;
}

/**
 * @param {unknown} workflow パース済みのワークフロー
 * @param {{ knownCredentials?: { id: string, name: string, type: string }[] }} [options]
 *   knownCredentials を渡すと、ノードの Credential 参照がテンプレートに存在するか検証する
 * @returns {string[]} エラーメッセージの配列（空なら妥当）
 */
function validateWorkflow(workflow, options = {}) {
  const { knownCredentials, categoryCodes } = options;
  const errors = [];

  if (!isPlainObject(workflow)) {
    return ['root must be a JSON object'];
  }
  if (typeof workflow.name !== 'string' || workflow.name.trim() === '') {
    errors.push('"name" must be a non-empty string');
  }
  if (!Array.isArray(workflow.nodes)) {
    errors.push('"nodes" must be an array');
  }
  if (!isPlainObject(workflow.connections)) {
    errors.push('"connections" must be an object');
  }
  if (errors.length > 0) return errors;

  if (categoryCodes) {
    const tags = (Array.isArray(workflow.tags) ? workflow.tags : []).map((t) =>
      typeof t === 'string' ? t : t && t.name,
    );
    const found = tags.filter((t) => categoryCodes.includes(t));
    if (found.length !== 1) {
      errors.push(
        `"tags" must contain exactly one category code from config/categories.yml (found: ${
          found.length ? found.join(', ') : 'none'
        }; available: ${categoryCodes.join(', ')})`,
      );
    }
  }

  const names = new Set();
  const ids = new Set();

  workflow.nodes.forEach((node, index) => {
    const label = `nodes[${index}]${node && node.name ? ` ("${node.name}")` : ''}`;
    if (!isPlainObject(node)) {
      errors.push(`${label} must be an object`);
      return;
    }
    if (typeof node.name !== 'string' || node.name === '') {
      errors.push(`${label}: "name" must be a non-empty string`);
    } else if (names.has(node.name)) {
      errors.push(`${label}: duplicate node name "${node.name}"`);
    } else {
      names.add(node.name);
    }
    if (typeof node.id !== 'string' || node.id === '') {
      errors.push(`${label}: "id" must be a non-empty string`);
    } else if (ids.has(node.id)) {
      errors.push(`${label}: duplicate node id "${node.id}"`);
    } else {
      ids.add(node.id);
    }
    if (typeof node.type !== 'string' || node.type === '') {
      errors.push(`${label}: "type" must be a non-empty string`);
    }
    if (typeof node.typeVersion !== 'number') {
      errors.push(`${label}: "typeVersion" must be a number`);
    }
    if (
      !Array.isArray(node.position) ||
      node.position.length !== 2 ||
      !node.position.every((n) => typeof n === 'number')
    ) {
      errors.push(`${label}: "position" must be [x, y] numbers`);
    }
    if (!isPlainObject(node.parameters)) {
      errors.push(`${label}: "parameters" must be an object`);
    } else {
      errors.push(...findSecrets(node.parameters, `${label}.parameters`));
    }
    errors.push(...validateCredentialRefs(node, label, knownCredentials));
  });

  for (const [source, outputs] of Object.entries(workflow.connections)) {
    if (!names.has(source)) {
      errors.push(`connections: source node "${source}" does not exist`);
    }
    if (!isPlainObject(outputs)) {
      errors.push(`connections["${source}"] must be an object`);
      continue;
    }
    for (const [outputType, branches] of Object.entries(outputs)) {
      if (!Array.isArray(branches)) {
        errors.push(`connections["${source}"].${outputType} must be an array`);
        continue;
      }
      branches.forEach((targets, branchIndex) => {
        if (targets === null) return; // 未接続の出力ブランチ
        if (!Array.isArray(targets)) {
          errors.push(`connections["${source}"].${outputType}[${branchIndex}] must be an array`);
          return;
        }
        for (const target of targets) {
          if (!isPlainObject(target) || !names.has(target.node)) {
            const name = isPlainObject(target) ? target.node : String(target);
            errors.push(`connections["${source}"] -> target node "${name}" does not exist`);
          }
        }
      });
    }
  }

  return errors;
}

module.exports = { validateWorkflow, findSecrets, SECRET_PATTERNS };
