/**
 * n8n ワークフロー JSON の構造バリデーション。
 * JSON 構文エラーは呼び出し側（validate-workflows.js）で検出する。
 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} workflow パース済みのワークフロー
 * @returns {string[]} エラーメッセージの配列（空なら妥当）
 */
function validateWorkflow(workflow) {
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
    }
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

module.exports = { validateWorkflow };
