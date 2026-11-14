/* Workflow Studio — 画面側の処理（依存ライブラリなし） */
(() => {
  const $ = (id) => document.getElementById(id);
  const CHAT_KEY = 'studio.chat.v1';

  const state = {
    designs: [],
    file: null, // 編集中の設計書（新規なら null）
    savedContent: '',
    jobSource: null,
    chat: loadChat(),
    draft: null,
  };

  // ---------- 共通 ----------
  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw Object.assign(new Error(data.error || res.statusText), { data, status: res.status });
    return data;
  }

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

  function setProblems(listEl, problems) {
    listEl.replaceChildren(...(problems || []).map((p) => el('li', {}, p)));
  }

  function setBilling(billing) {
    const chip = $('billing');
    chip.hidden = false;
    if (billing === 'subscription') {
      chip.textContent = 'サブスクリプションで実行';
      chip.className = 'chip';
    } else {
      chip.textContent = 'API キーで実行中（従量課金）';
      chip.className = 'chip warn';
    }
  }

  /** ジョブのイベントを SSE で受け取る */
  function followJob(jobId, onEvent) {
    const source = new EventSource(`/api/jobs/${jobId}/events`);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data);
      if (event.kind === 'init' && event.billing) setBilling(event.billing);
      onEvent(event);
      if (event.kind === 'end') source.close();
    };
    source.onerror = () => {
      // ジョブが終わってサーバーが接続を閉じた場合も呼ばれる。終了済みなら再接続しない
      if (source.readyState === EventSource.CLOSED) return;
    };
    return source;
  }

  // ---------- タブ ----------
  function showTab(name) {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    }
    $('tab-design').hidden = name !== 'design';
    $('tab-chat').hidden = name !== 'chat';
    try {
      localStorage.setItem('studio.tab', name);
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  }

  // ---------- 設計書から作成 ----------
  async function loadDesigns() {
    state.designs = await api('GET', '/api/designs');
    renderDesignList();
  }

  function renderDesignList() {
    $('design-list').replaceChildren(
      ...state.designs.map((d) =>
        el(
          'li',
          {},
          el(
            'button',
            { 'aria-current': String(d.file === state.file), onclick: () => openDesign(d.file) },
            el(
              'span',
              { class: 'title' },
              el('span', { class: `badge ${d.status || ''}` }, d.status || '?'),
              d.title || d.id || d.file,
            ),
            el('span', { class: 'file' }, d.file),
          ),
        ),
      ),
    );
  }

  function confirmDiscard() {
    return (
      $('editor').value === state.savedContent ||
      confirm('保存していない変更があります。破棄しますか？')
    );
  }

  async function openDesign(file) {
    if (!confirmDiscard()) return;
    const { content } = await api('GET', `/api/design?file=${encodeURIComponent(file)}`);
    setEditor(file, content);
  }

  async function newDesign() {
    if (!confirmDiscard()) return;
    const { content } = await api(
      'GET',
      `/api/design?file=${encodeURIComponent('designs/_TEMPLATE.md')}`,
    );
    setEditor(null, content);
    $('editor-file').textContent =
      '新規（保存先: designs/<id>.md。front matter の id を書き換えてください）';
  }

  function setEditor(file, content) {
    state.file = file;
    state.savedContent = content;
    $('editor').disabled = false;
    $('editor').value = content;
    $('editor-file').textContent = file || '新規';
    refreshEditorState();
    renderDesignList();
  }

  function refreshEditorState() {
    const d = state.designs.find((x) => x.file === state.file);
    const dirty = $('editor').value !== state.savedContent;
    $('btn-save').disabled = $('editor').disabled || (!dirty && state.file !== null);
    $('btn-build').disabled = !d || dirty || d.problems.length > 0 || isRunning();
    setProblems($('editor-problems'), d && !dirty ? d.problems : []);
  }

  async function save(content, file, { quiet = false } = {}) {
    try {
      return await api('PUT', '/api/design', { content, file: file || undefined });
    } catch (err) {
      const errors = err.data?.errors || [err.message];
      if (!file && errors.some((e) => e.includes('既にあります'))) {
        if (confirm(`${errors[0]}\n上書きしますか？`)) {
          return api('PUT', '/api/design', { content, overwrite: true });
        }
        return null;
      }
      if (!quiet) alert(`保存できませんでした:\n- ${errors.join('\n- ')}`);
      return null;
    }
  }

  async function saveEditor() {
    const result = await save($('editor').value, state.file);
    if (!result) return null;
    await loadDesigns();
    setEditor(result.file, $('editor').value);
    return result;
  }

  // ---------- 構築ジョブ ----------
  let runningJob = null;
  const isRunning = () => runningJob !== null;

  function logLine(cls, text) {
    const log = $('job-log');
    const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
    log.append(el('li', { class: cls }, text));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function showJob(job) {
    runningJob = job.status === 'running' ? job : null;
    $('job').hidden = false;
    $('job-label').textContent = job.label;
    $('job-log').replaceChildren();
    setJobStatus(job.status);
    if (state.jobSource) state.jobSource.close();
    state.jobSource = followJob(job.id, (e) => {
      if (e.kind === 'text') logLine('text', e.text);
      else if (e.kind === 'tool')
        logLine('tool', `› ${e.name}${e.summary ? `  ${e.summary}` : ''}`);
      else if (e.kind === 'tool_error') logLine('error', `✗ ${e.text}`);
      else if (e.kind === 'error') logLine('error', e.text);
      else if (e.kind === 'log') logLine('tool', e.text);
      else if (e.kind === 'end') {
        runningJob = null;
        setJobStatus(e.status);
        loadDesigns().then(refreshEditorState);
      }
    });
    refreshEditorState();
  }

  function setJobStatus(status) {
    const labels = {
      running: '実行中…',
      succeeded: '完了',
      failed: '失敗',
      cancelled: '中止しました',
    };
    $('job-status').textContent = labels[status] || status;
    $('job-status').className =
      `status ${status === 'succeeded' ? 'ok' : status === 'running' ? '' : 'ng'}`;
    $('btn-cancel').hidden = status !== 'running';
  }

  async function startBuild(file) {
    if (
      !confirm(
        `${file} から構築を開始します。\nClaude がワークフロー・コード・テスト・仕様書を作成し、ローカル n8n でテストします。よろしいですか？`,
      )
    )
      return;
    try {
      const job = await api('POST', '/api/build', { file });
      showTab('design');
      showJob(job);
    } catch (err) {
      alert(
        `開始できませんでした: ${err.message}${err.data?.problems ? `\n- ${err.data.problems.join('\n- ')}` : ''}`,
      );
    }
  }

  $('btn-new').addEventListener('click', newDesign);
  $('btn-save').addEventListener('click', saveEditor);
  $('btn-build').addEventListener('click', () => state.file && startBuild(state.file));
  $('btn-cancel').addEventListener(
    'click',
    () => runningJob && api('POST', `/api/jobs/${runningJob.id}/cancel`, {}),
  );
  $('editor').addEventListener('input', refreshEditorState);

  // ---------- 対話から作成 ----------
  function loadChat() {
    try {
      return JSON.parse(localStorage.getItem(CHAT_KEY)) || { sessionId: null, messages: [] };
    } catch {
      return { sessionId: null, messages: [] };
    }
  }

  function persistChat() {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(state.chat));
    } catch {
      /* 保存できなくても動作には影響しない */
    }
  }

  /** 設計書のブロックは右側に出すため、吹き出しでは短い案内に置き換える */
  function displayText(text) {
    return text.replace(/^(~~~|````)(?:markdown|md)[^\n]*\n[\s\S]*?\n\1\s*$/gm, '').trim();
  }

  function renderChat() {
    const items = state.chat.messages.map((m) => {
      const body = m.role === 'assistant' ? displayText(m.text) : m.text;
      return el(
        'li',
        { class: `msg ${m.role}` },
        body || (m.pending ? '考えています…' : ''),
        m.hasDraft ? el('span', { class: 'note' }, '→ 設計書の下書きを右に表示しました') : null,
        m.tools && m.tools.length
          ? el('div', { class: 'tools' }, m.tools.map((t) => `› ${t}`).join('\n'))
          : null,
      );
    });
    $('chat-log').replaceChildren(...items);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  }

  function showDraft(draft) {
    state.draft = draft;
    $('draft').hidden = !draft;
    $('tab-chat').classList.toggle('has-draft', Boolean(draft));
    if (!draft) return;
    $('draft-editor').value = draft.content;
    $('draft-file').textContent = draft.file
      ? `保存先: ${draft.file}`
      : '保存先: （id を確認してください）';
    setProblems($('draft-problems'), draft.problems);
  }

  let chatJob = null;
  function setChatBusy(busy, label) {
    $('btn-chat-send').disabled = busy;
    $('btn-chat-cancel').hidden = !busy;
    $('chat-status').textContent = label || '';
  }

  async function sendChat(message) {
    state.chat.messages.push({ role: 'user', text: message });
    const reply = { role: 'assistant', text: '', tools: [], pending: true };
    state.chat.messages.push(reply);
    renderChat();
    setChatBusy(true, 'Claude が考えています…');
    try {
      chatJob = await api('POST', '/api/chat', { message, sessionId: state.chat.sessionId });
    } catch (err) {
      reply.pending = false;
      reply.text = `（送信できませんでした: ${err.message}）`;
      setChatBusy(false);
      renderChat();
      persistChat();
      return;
    }
    followJob(chatJob.id, (e) => {
      if (e.kind === 'text') {
        reply.text += (reply.text ? '\n\n' : '') + e.text;
        renderChat();
      } else if (e.kind === 'tool') {
        reply.tools.push(`${e.name}${e.summary ? `  ${e.summary}` : ''}`);
        renderChat();
      } else if (e.kind === 'error') {
        reply.text += `\n（エラー: ${e.text}）`;
      } else if (e.kind === 'result') {
        if (e.sessionId) state.chat.sessionId = e.sessionId;
        if (!reply.text && e.text) reply.text = e.text;
      } else if (e.kind === 'draft') {
        reply.hasDraft = true;
        showDraft({ content: e.content, file: e.file, problems: e.problems });
        state.chat.draft = state.draft;
      } else if (e.kind === 'end') {
        reply.pending = false;
        if (e.status !== 'succeeded' && !reply.text)
          reply.text = `（${e.status === 'cancelled' ? '中止しました' : '失敗しました'}）`;
        chatJob = null;
        setChatBusy(false);
        renderChat();
        persistChat();
      }
    });
  }

  $('chat-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const message = $('chat-input').value.trim();
    if (!message || chatJob) return;
    $('chat-input').value = '';
    sendChat(message);
  });
  $('chat-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) $('chat-form').requestSubmit();
  });
  $('btn-chat-cancel').addEventListener(
    'click',
    () => chatJob && api('POST', `/api/jobs/${chatJob.id}/cancel`, {}),
  );
  $('btn-chat-reset').addEventListener('click', () => {
    if (chatJob) return;
    if (state.chat.messages.length && !confirm('会話を消して、新しく始めますか？')) return;
    state.chat = { sessionId: null, messages: [] };
    persistChat();
    showDraft(null);
    renderChat();
  });

  async function saveDraft() {
    const content = $('draft-editor').value;
    const result = await save(content, null);
    if (!result) return null;
    await loadDesigns();
    $('draft-file').textContent = `保存しました: ${result.file}`;
    setProblems($('draft-problems'), result.problems);
    return result;
  }

  $('btn-draft-save').addEventListener('click', saveDraft);
  $('btn-draft-build').addEventListener('click', async () => {
    const result = await saveDraft();
    if (!result) return;
    if (result.problems.length) {
      alert(
        `保存しましたが、まだ構築できません:\n- ${result.problems.join('\n- ')}\n\n会話で未決事項を解消するか、「設計書から作成」で編集してください。`,
      );
      return;
    }
    setEditor(result.file, $('draft-editor').value);
    startBuild(result.file);
  });

  // ---------- 起動時 ----------
  (async () => {
    const meta = await api('GET', '/api/meta');
    $('link-n8n').href = meta.links.n8n;
    $('link-dashy').href = meta.links.dashy;
    await loadDesigns();
    renderChat();
    if (state.chat.draft) showDraft(state.chat.draft);
    let tab = 'design';
    try {
      tab = localStorage.getItem('studio.tab') || 'design';
    } catch {
      /* 既定のタブを使う */
    }
    const fromQuery = new URLSearchParams(location.search).get('tab');
    showTab(fromQuery === 'chat' || fromQuery === 'design' ? fromQuery : tab);
    if (meta.running && meta.running.kind === 'build') showJob(meta.running);
  })().catch((err) => alert(`Studio の読み込みに失敗しました: ${err.message}`));
})();
