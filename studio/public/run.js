/* Workflow Studio — 実行ページ（/run?id=<workflowId>） */
(() => {
  const $ = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('id') || '';

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
    }
    return node;
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  function showResult(r) {
    $('result').hidden = false;
    $('result-status').textContent = r.status ? `HTTP ${r.status}` : '接続できませんでした';
    $('result-status').className = `status ${r.ok ? 'ok' : 'ng'}`;
    $('result-hint').hidden = !r.hint;
    $('result-hint').textContent = r.hint || '';
    let text = r.body;
    if (r.contentType && r.contentType.includes('json')) {
      try {
        text = JSON.stringify(JSON.parse(r.body), null, 2);
      } catch {
        /* そのまま表示 */
      }
    }
    $('result-body').textContent = text || '（応答本文なし）';
  }

  function webhookForm(info, hook, index) {
    const hasBody = !['GET', 'HEAD', 'DELETE'].includes(hook.method);
    const textarea = hasBody
      ? el('textarea', { class: 'editor', spellcheck: 'false', rows: '12' })
      : null;
    if (textarea) {
      textarea.value = JSON.stringify(hook.exampleBody ?? {}, null, 2);
    }
    const button = el('button', { class: 'btn primary', type: 'submit' }, '実行');
    const form = el(
      'form',
      { class: 'run-form' },
      el(
        'div',
        { class: 'run-endpoint' },
        el('span', { class: 'badge ready' }, hook.method),
        ` ${info.n8nUrl}/webhook/${hook.path}`,
      ),
      hasBody
        ? el(
            'label',
            { class: 'hint' },
            `送信する JSON${hook.exampleName ? `（例: テストケース「${hook.exampleName}」）` : ''}`,
          )
        : el('p', { class: 'hint' }, 'このリクエストは本文なしで送ります。'),
      textarea,
      el('div', { class: 'actions' }, button),
    );
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      let body;
      if (textarea) {
        try {
          body = JSON.parse(textarea.value || 'null');
        } catch (err) {
          alert(`JSON の形式が正しくありません: ${err.message}`);
          return;
        }
      }
      button.disabled = true;
      button.textContent = '実行中…';
      try {
        showResult(
          await api('POST', `/api/workflows/${encodeURIComponent(id)}/run`, {
            webhook: index,
            body,
          }),
        );
      } catch (err) {
        showResult({ status: 0, ok: false, body: '', hint: err.message });
      } finally {
        button.disabled = false;
        button.textContent = '実行';
      }
    });
    return form;
  }

  function render(info) {
    document.title = `${info.name} を実行`;
    $('wf-name').textContent = info.name;
    $('wf-file').textContent = info.file;
    $('link-editor').href = info.editorUrl;
    const parts = [];

    for (const p of info.forms) {
      parts.push(
        el(
          'p',
          {},
          'このワークフローはフォームで実行します: ',
          el('a', { href: `${info.n8nUrl}/form/${p}` }, `${info.n8nUrl}/form/${p}`),
        ),
      );
    }
    info.webhooks.forEach((hook, i) => parts.push(webhookForm(info, hook, i)));
    if (info.webhooks.length > 0) {
      parts.push(
        el(
          'p',
          { class: 'hint' },
          '本番 URL に送ります。n8n でワークフローを公開（有効化）していないと実行できません。実行すると、通知などの処理も実際に行われます。',
        ),
      );
    }

    if (info.otherTriggers.length > 0 && info.webhooks.length === 0 && info.forms.length === 0) {
      parts.push(
        el(
          'div',
          { class: 'notice' },
          el('h2', {}, 'このページからは実行できません'),
          el(
            'p',
            {},
            `トリガーが ${info.otherTriggers.map((t) => t.node).join('、')} のワークフローは、n8n に外部から実行する手段（API）が無いため、ここからは起動できません。`,
          ),
          el(
            'ul',
            {},
            el(
              'li',
              {},
              'スケジュール実行のものは、n8n で公開（有効化）しておくと決まった時刻に自動で動きます。',
            ),
            el(
              'li',
              {},
              '手動で動かしたい場合は、n8n の編集画面の「Execute workflow」で実行します。',
            ),
            el(
              'li',
              {},
              'Dashy から人が実行するアプリにしたい場合は、トリガーをフォーム（Form）か Webhook に変えると、ここから実行できます。',
            ),
          ),
        ),
      );
    }
    if (parts.length === 0) parts.push(el('p', {}, 'このワークフローにはトリガーがありません。'));
    $('run-body').replaceChildren(...parts);
  }

  api('GET', `/api/workflows/${encodeURIComponent(id)}`)
    .then(render)
    .catch((err) => {
      $('run-body').replaceChildren(
        el('p', { class: 'warn-text' }, `読み込めませんでした: ${err.message}`),
      );
    });
})();
