let listScroll = 0,
  returnAddress = null;

const state = {
  tab: 'tasks',
  filter: 'all',
  machine: 'all',
  search: '',
  config: {},
  snapshot: null,
  online: false,
  error: '',
  selected: null,
  detail: null,
  detailError: '',
  loading: false,
  detailLoading: false,
  sendBusy: false,
  chatSession: null,
  chatMessages: [],
  chatHasMore: false,
  chatBefore: null,
  loadingOlder: false,
};
const drafts = new Map();
let outbox;
try {
  outbox = new Map(JSON.parse(localStorage.getItem('pocket-outbox') || '[]').map((m) => [m.id, m]));
} catch {
  outbox = new Map();
}
function saveOutbox() {
  localStorage.setItem('pocket-outbox', JSON.stringify([...outbox.values()]));
}
function elapsed(since) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '';
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
function workingBadge(t) {
  const n = badge(statusOf(t));
  if (statusOf(t) === 'working' && t.workingSince) {
    const time = el('time', 'elapsed', elapsed(t.workingSince));
    time.dataset.since = t.workingSince;
    time.setAttribute('aria-label', tr('elapsed'));
    n.append(time);
  }
  return n;
}
function updateTimers() {
  document.querySelectorAll('.elapsed').forEach((n) => (n.textContent = elapsed(n.dataset.since)));
}
let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  enter($('toast'));
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 5000);
}
function project(t) {
  if (t.project) return t.project;
  const path = t.cwd?.replace(/\\/g, '/').replace(/\/$/, '');
  return path?.split('/').pop() || t.title || tr('terminal');
}
function machineOf(t) {
  return t.address.includes('/')
    ? t.address.split('/')[0]
    : state.snapshot?.localMachine || tr('local_machine');
}
function statusOf(t) {
  return typeof t?.status === 'object' ? t.status?.state : t?.status;
}
const statusLabel = (s) =>
  ({
    working: tr('working'),
    blocked: tr('blocked'),
    done: tr('done'),
    idle: tr('idle'),
    unknown: tr('unknown'),
  })[s] || tr('unknown');
const agentLabel = (a) =>
  ({
    'claude-code': 'Claude Code',
    claude: 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    'cursor-agent': 'Cursor',
    'powershell.exe': 'PowerShell',
    'gemini-cli': 'Gemini',
    pi: 'Pi',
    opencode: 'OpenCode',
  })[a] ||
  a ||
  tr('terminal');
const agentOf = (t) => t.agent || t.status?.app || t.foreground?.name || '';
function badge(s) {
  return el('span', `badge ${s || 'unknown'}`, statusLabel(s));
}
function updateConnection() {
  $('connection').className =
    `connection ${state.online ? 'online' : state.config.configured ? 'offline' : ''}`;
  $('connection-text').textContent = state.online
    ? tr('connected')
    : state.config.configured
      ? tr('disconnected')
      : tr('not_connected');
  const at = state.snapshot?.observedAt;
  $('updated').textContent = at
    ? `${new Date(at).toLocaleTimeString(I18n.language === 'ko' ? 'ko-KR' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`
    : '';
}
function renderNav() {
  $('nav').replaceChildren(
    ...[
      ['tasks', tr('tasks'), 'grid'],
      ['devices', tr('devices'), 'devices'],
      ['settings', tr('settings'), 'settings'],
    ].map(([id, label, i]) => {
      const b = button(state.tab === id ? 'active' : '', '', () => {
        if (state.tab === id) return;
        state.tab = id;
        render();
        window.scrollTo(0, 0);
        enter($('main').querySelector('h1'));
      });
      b.setAttribute('aria-label', label);
      b.setAttribute('aria-current', state.tab === id ? 'page' : 'false');
      b.append(icon(i), el('span', '', label));
      return b;
    }),
  );
}
function render() {
  updateConnection();
  renderNav();
  $('refresh').setAttribute('aria-label', tr('refresh'));
  $('nav').setAttribute('aria-label', tr('main_nav'));
  $('detail').setAttribute('aria-label', tr('session_detail'));
  $('main').replaceChildren();
  if (state.tab === 'settings') renderSettings();
  else if (!state.config.configured) renderWelcome();
  else if (state.tab === 'devices') renderDevices();
  else renderTasks();
}
function renderWelcome() {
  renderSettings();
}
function renderTasks() {
  const main = $('main');
  const terminals = state.snapshot?.terminals || [];
  const notice = el('div', `notice ${state.error ? '' : 'hidden'}`, state.error);
  notice.id = 'list-error';
  main.append(notice);
  const stats = el('div', 'stats');
  for (const [id, label, cls] of [
    ['working', tr('working'), 'working'],
    ['blocked', tr('blocked'), 'attention'],
    ['done', tr('done'), 'done'],
  ]) {
    const b = button(`stat ${cls} ${state.filter === id ? 'active' : ''}`, '', () => {
      state.filter = state.filter === id ? 'all' : id;
      syncTasks();
    });
    b.dataset.filter = id;
    b.setAttribute('aria-pressed', String(state.filter === id));
    b.append(
      el('strong', '', String(terminals.filter((t) => statusOf(t) === id).length)),
      el('span', '', label),
    );
    stats.append(b);
  }
  main.append(stats);
  const search = el('label', 'search');
  const input = el('input');
  input.placeholder = tr('search');
  input.value = state.search;
  input.setAttribute('aria-label', tr('search_tasks'));
  input.oninput = () => {
    state.search = input.value;
    renderCards();
  };
  search.append(icon('search'), input);
  main.append(search);
  const filters = el('div', 'filters');
  filters.id = 'machine-filters';
  main.append(filters);
  renderMachineFilters();
  const cards = el('div', 'cards');
  cards.id = 'cards';
  main.append(cards);
  renderCards();
}
function renderMachineFilters() {
  const host = $('machine-filters');
  if (!host) return;
  const machines = [...new Set((state.snapshot?.terminals || []).map(machineOf))];
  const signature = JSON.stringify([machines, state.machine]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const scroll = host.scrollLeft;
  host.replaceChildren(
    ...['all', ...machines].map((m) => {
      const b = button(
        `chip ${state.machine === m ? 'active' : ''}`,
        m === 'all' ? tr('all') : m,
        () => {
          state.machine = m;
          syncTasks();
        },
      );
      b.setAttribute('aria-pressed', String(state.machine === m));
      return b;
    }),
  );
  host.scrollLeft = scroll;
}
function syncTasks() {
  if (!$('cards')) return;
  const terms = state.snapshot?.terminals || [];
  document.querySelectorAll('.stat').forEach((b) => {
    const value = String(terms.filter((t) => statusOf(t) === b.dataset.filter).length),
      n = b.querySelector('strong');
    if (n.textContent !== value) {
      n.textContent = value;
      enter(n);
    }
    b.classList.toggle('active', state.filter === b.dataset.filter);
    b.setAttribute('aria-pressed', String(state.filter === b.dataset.filter));
  });
  const notice = $('list-error');
  notice.textContent = state.error;
  notice.classList.toggle('hidden', !state.error);
  renderMachineFilters();
  renderCards();
}
function renderCards() {
  const list = $('cards');
  if (!list) return;
  const terms = (state.snapshot?.terminals || [])
    .filter(
      (t) =>
        (state.filter === 'all' || statusOf(t) === state.filter) &&
        (state.machine === 'all' || machineOf(t) === state.machine) &&
        `${t.project} ${t.sessionTitle} ${t.cwd} ${t.agent} ${t.address}`
          .toLowerCase()
          .includes(state.search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(statusOf(b) === 'working') - Number(statusOf(a) === 'working') ||
        (Date.parse(b.lastResponseAt) || 0) - (Date.parse(a.lastResponseAt) || 0) ||
        a.address.localeCompare(b.address),
    );
  const existing = new Map([...list.querySelectorAll('.card')].map((n) => [n.dataset.address, n]));
  list.querySelector('.empty')?.remove();
  terms.forEach((t, index) => {
    let card = existing.get(t.address);
    existing.delete(t.address);
    const signature = JSON.stringify([
      project(t),
      t.sessionTitle,
      agentOf(t),
      statusOf(t),
      machineOf(t),
      t.workingSince,
    ]);
    const isNew = !card;
    if (isNew) {
      card = button('card', '', () => openDetail(t.address));
      card.dataset.address = t.address;
    }
    if (card.dataset.signature !== signature) {
      card.dataset.signature = signature;
      card.dataset.status = statusOf(t) || 'unknown';
      const top = el('div', 'card-top');
      top.append(el('span', 'agent-name', agentLabel(agentOf(t))), workingBadge(t));
      const foot = el('div', 'card-foot');
      foot.append(el('span', 'machine-mini', machineOf(t)), icon('arrow'));
      card.replaceChildren(
        top,
        el('div', 'project-title', project(t)),
        el('div', 'session-title', t.sessionTitle || t.address),
        foot,
      );
      if (!isNew)
        motion(card, [{ borderColor: 'var(--lime)' }, { borderColor: 'var(--line)' }], {
          duration: 500,
        });
    }
    if (list.children[index] !== card) list.insertBefore(card, list.children[index] || null);
  });
  existing.forEach((n) => n.remove());
  if (!terms.length)
    list.append(el('div', 'empty', state.snapshot ? tr('no_tasks') : tr('loading')));
}
function renderDevices() {
  const main = $('main');
  main.append(el('h1', '', tr('devices')));
  if (state.error) main.append(el('div', 'notice', state.error));
  if (!state.snapshot) {
    main.append(el('div', 'empty', tr('loading')));
    return;
  }
  const machines = [
    {
      name: state.snapshot.localMachine,
      state: state.online ? 'connected' : 'unknown',
      local: true,
    },
    ...(state.snapshot.machines || []),
  ];
  for (const m of machines) {
    const row = el('div', `machine-row ${state.online ? m.state : ''}`),
      i = el('div', 'icon');
    i.append(icon('devices'));
    const info = el('div', 'info');
    info.append(
      el('div', 'name', m.name),
      el(
        'small',
        '',
        `${m.local ? tr('bridge_prefix') : ''}${tr('terminals_count', { count: (state.snapshot.terminals || []).filter((t) => machineOf(t) === m.name).length })} · ${state.online ? (m.state === 'connected' ? tr('connected') : m.state) : tr('last_known')}`,
      ),
    );
    row.append(i, info, el('span', 'dot'));
    main.append(row);
  }
}
function renderSettings() {
  const main = $('main');
  main.append(el('h1', '', tr('connection_settings')));
  const language = el('label', 'field');
  language.append(el('span', '', tr('language')));
  const select = el('select');
  select.id = 'language';
  select.setAttribute('aria-label', tr('language'));
  for (const [code, name] of [
    ['ko', '한국어'],
    ['en', 'English'],
  ]) {
    const option = el('option', '', name);
    option.value = code;
    select.append(option);
  }
  select.value = I18n.language;
  select.onchange = () => {
    const url = $('server-url')?.value,
      key = $('server-token')?.value;
    I18n.setLanguage(select.value);
    render();
    if (url !== undefined) $('server-url').value = url;
    if (key !== undefined) $('server-token').value = key;
  };
  language.append(select);
  main.append(language);
  renderNotificationSettings(main);
  const form = el('form');
  const urlField = el('label', 'field');
  urlField.append(el('span', '', tr('server_url')));
  const url = el('input');
  url.id = 'server-url';
  url.type = 'url';
  url.inputMode = 'url';
  url.autocomplete = 'off';
  url.autocapitalize = 'off';
  url.spellcheck = false;
  url.placeholder = 'https://bridge.example.com:9443';
  url.value = state.config.url || '';
  urlField.append(url);
  const keyField = el('label', 'field');
  keyField.append(el('span', '', tr('connection_key')));
  const key = el('input');
  key.id = 'server-token';
  key.type = 'password';
  key.autocomplete = 'off';
  key.placeholder = state.config.configured ? tr('key_saved') : tr('key_placeholder');
  keyField.append(key);
  const submit = button('primary wide', tr('connect'), null);
  submit.type = 'submit';
  form.append(urlField, keyField, submit);
  form.onsubmit = async (e) => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = tr('connecting');
    try {
      state.config = await native('configure', { url: url.value, token: key.value });
      key.value = '';
      state.snapshot = null;
      await refresh();
      if (state.online) {
        state.tab = 'tasks';
        render();
        haptic('success');
        toast(tr('connected'));
      } else toast(state.error);
    } catch (e) {
      toast(e.message);
    } finally {
      submit.disabled = false;
      submit.textContent = tr('connect');
    }
  };
  main.append(form);
  if (state.config.configured)
    main.append(
      button('secondary reset-button', tr('forget'), async () => {
        state.config = await native('forget');
        state.snapshot = null;
        state.online = false;
        state.error = '';
        drafts.clear();
        outbox.clear();
        saveOutbox();
        pendingMessage = null;
        state.sendBusy = false;
        localStorage.removeItem('pocket-pending');
        render();
      }),
    );
}
async function refresh() {
  if (state.loading || !state.config.configured || document.hidden) return;
  state.loading = true;
  busy($('refresh'), true);
  try {
    state.snapshot = await api('/v1/snapshot');
    syncPushContext();
    state.online = true;
    state.error = '';
  } catch (e) {
    state.online = false;
    state.error = e.message;
  } finally {
    state.loading = false;
    busy($('refresh'), false);
    updateConnection();
    if (state.tab !== 'settings' && !state.selected) {
      if (state.tab === 'tasks' && $('cards')) syncTasks();
      else render();
    }
  }
}
function openDetail(address) {
  listScroll = window.scrollY;
  returnAddress = address;
  state.selected = address;
  state.detail = null;
  state.detailError = '';
  state.chatSession = null;
  state.chatMessages = [];
  state.chatHasMore = false;
  state.chatBefore = null;
  renderDetail();
  $('app').hidden = true;
  motion(
    $('detail'),
    [
      { transform: 'translateX(32px)', opacity: 0.2 },
      { transform: 'translateX(0)', opacity: 1 },
    ],
    { duration: 220 },
  );
  $('detail').querySelector('button').focus({ preventScroll: true });
  loadDetail();
}
function closeDetail() {
  closeMediaViewer();
  pauseMedia($('detail'));
  state.selected = null;
  state.detail = null;
  syncPushContext();
  $('detail').classList.add('hidden');
  $('app').hidden = false;
  render();
  window.scrollTo(0, listScroll);
  [...document.querySelectorAll('.card')]
    .find((n) => n.dataset.address === returnAddress)
    ?.focus({ preventScroll: true });
  enter($('main').querySelector('h1'));
}
window.pocketBack = () => {
  if (closeMediaViewer()) return true;
  if (state.selected) {
    closeDetail();
    return true;
  }
  if (state.tab !== 'tasks') {
    state.tab = 'tasks';
    render();
    return true;
  }
  return false;
};
function renderDetail() {
  const host = $('detail');
  host.classList.remove('hidden');
  releaseMessageContent(host);
  host.replaceChildren();
  const terminal = state.detail?.terminal ||
    state.snapshot?.terminals.find((t) => t.address === state.selected) || {
      address: state.selected,
    };
  const header = el('div', 'detail-header'),
    back = button('icon-button', '', closeDetail);
  back.setAttribute('aria-label', tr('back'));
  back.append(icon('back'));
  const heading = el('div', 'detail-heading');
  heading.append(
    el('h2', '', project(terminal)),
    el('small', '', `${machineOf(terminal)} / ${agentLabel(agentOf(terminal))}`),
  );
  const reload = button('icon-button', '', () => loadDetail());
  reload.id = 'detail-refresh';
  reload.setAttribute('aria-label', tr('refresh_chat'));
  reload.append(icon('refresh'));
  header.append(back, heading, reload);
  const body = el('div', 'detail-body');
  body.id = 'detail-body';
  const err = el('div', 'notice hidden');
  err.id = 'detail-error';
  const meta = el('div', 'detail-meta');
  meta.id = 'detail-meta';
  const path = el('div', 'chat-title', terminal.sessionTitle || '');
  path.id = 'detail-path';
  const time = el('span', 'output-time');
  time.id = 'output-time';
  meta.append(time);
  const older = button('secondary older hidden', tr('older'), loadOlder);
  older.id = 'older-messages';
  const out = el('div', 'conversation', tr('loading'));
  out.id = 'conversation';
  out.setAttribute('role', 'log');
  body.append(err, meta, path, older, out);
  const composer = el('div', 'composer');
  composer.id = 'composer';
  const label = el('div', 'composer-label');
  const count = el('span');
  count.id = 'char-count';
  label.append(count);
  const row = el('div', 'composer-row'),
    input = el('textarea');
  input.id = 'message-input';
  input.maxLength = 4000;
  input.placeholder = tr('message_placeholder');
  input.setAttribute('aria-label', tr('message_label'));
  input.value = drafts.get(state.selected) || '';
  input.oninput = () => {
    drafts.set(state.selected, input.value);
    count.textContent = input.value.length > 3500 ? `${input.value.length} / 4000` : '';
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 144)}px`;
    updateSend();
  };
  const send = button('primary send', '', sendMessage);
  send.id = 'send-message';
  send.disabled = true;
  send.setAttribute('aria-label', tr('send'));
  send.append(icon('send'));
  row.append(input, send);
  const notice = el('div', 'composer-notice');
  notice.id = 'composer-notice';
  composer.append(label, row, notice);
  const activity = el('div', 'activity hidden');
  activity.id = 'activity';
  activity.setAttribute('role', 'status');
  body.append(activity);
  const interaction = el('section', 'interaction hidden');
  interaction.id = 'interaction';
  body.append(interaction);
  host.append(header, body, composer);
  updateDetail();
}
function updateSend() {
  const send = $('send-message');
  if (send) {
    send.disabled =
      state.sendBusy ||
      !state.detail?.canSend ||
      !!state.detailError ||
      !$('message-input')?.value.trim();
    busy(send, state.sendBusy);
  }
  updateInteraction();
}
function updateDetail() {
  syncPushContext();
  if (!state.selected) return;
  const data = state.detail;
  if (data && !data.terminal.sessionId && !state.detailError)
    state.detailError = tr(data.conversation?.unavailable || 'session_unavailable');
  $('detail-error').classList.toggle('hidden', !state.detailError);
  $('detail-error').textContent = state.detailError
    ? tr('stale_chat', { error: state.detailError })
    : '';
  if (data) {
    const t = data.terminal;
    const meta = $('detail-meta');
    meta.replaceChildren(workingBadge(t), $('output-time'));
    document.querySelector('.detail-heading h2').textContent = project(t);
    $('detail-path').textContent = t.sessionTitle || '';
    if (!t.sessionId && state.chatSession) {
      updateActivity();
      updateSend();
      return;
    }
    const scroll = $('detail-body'),
      atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    const first = state.chatSession !== t.sessionId || !state.chatMessages.length;
    if (state.chatSession !== t.sessionId) {
      state.chatSession = t.sessionId;
      state.chatMessages = [];
    }
    const chat = data.conversation || {};
    const merged = new Map(state.chatMessages.map((m) => [m.id, m]));
    for (const m of chat.messages || []) merged.set(m.id, m);
    const messages = [...merged.values()].sort((a, b) => a.ordinal - b.ordinal);
    const changed = JSON.stringify(messages) !== JSON.stringify(state.chatMessages);
    state.chatMessages = messages;
    if (first || state.chatBefore === null) {
      state.chatHasMore = !!chat.hasMore;
      state.chatBefore = chat.before ?? null;
    }
    if (
      changed ||
      !messages.length ||
      [...outbox.values()].some((m) => m.address === state.selected)
    )
      renderChat(chat.unavailable);
    updateActivity();
    updateInteraction();
    if (first || atBottom) scroll.scrollTop = scroll.scrollHeight;
    $('output-time').textContent = new Date(data.observedAt).toLocaleTimeString(
      I18n.language === 'ko' ? 'ko-KR' : 'en-GB',
      { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
    );
    $('composer-notice').textContent =
      statusOf(t) === 'blocked' ? '' : !data.canSend ? tr('send_unavailable') : '';
  }
  updateActivity();
  updateSend();
}
function updateActivity() {
  const host = $('activity');
  if (!host) return;
  const active = statusOf(state.detail?.terminal) === 'working' && !state.detailError;
  host.classList.toggle('hidden', !active);
  if (!active) return;
  const activity = state.detail?.conversation?.activity;
  const text = activity
    ? tr(activity.state === 'running' ? 'activity_running' : 'activity_complete', {
        activity: tr(activity.label),
      })
    : tr('working');
  const signature = JSON.stringify([text, activity?.timestamp]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const mark = el('span', 'activity-mark');
  mark.setAttribute('aria-hidden', 'true');
  host.replaceChildren(mark, el('span', '', text));
  if (activity?.timestamp)
    host.append(
      el(
        'time',
        '',
        new Date(activity.timestamp).toLocaleTimeString(
          I18n.language === 'ko' ? 'ko-KR' : 'en-GB',
          { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false },
        ),
      ),
    );
}
function chatEntries() {
  const messages = [...state.chatMessages],
    localMessages = [],
    claimed = new Set();
  let changed = false;
  for (const item of outbox.values()) {
    if (item.address !== state.selected || item.sessionId !== state.detail?.terminal.sessionId)
      continue;
    const index = messages.findIndex(
      (m) =>
        m.role === 'user' &&
        m.text.trim() === item.text &&
        m.ordinal > item.afterOrdinal &&
        !claimed.has(m.id),
    );
    if (index >= 0) {
      claimed.add(messages[index].id);
      if (item.state === 'sending') messages[index] = { ...messages[index], delivery: 'sending' };
      else {
        outbox.delete(item.id);
        changed = true;
      }
    } else
      localMessages.push({
        id: `local:${item.id}`,
        role: 'user',
        text: item.text,
        timestamp: item.sentAt,
        ordinal: item.afterOrdinal + 0.5,
        delivery: item.state,
        deliveryError: item.error,
      });
  }
  if (changed) saveOutbox();
  return [...messages, ...localMessages].sort((a, b) => a.ordinal - b.ordinal);
}
function renderChat(unavailable) {
  const host = $('conversation');
  if (!host) return;
  const previous = new Map(
    [...host.querySelectorAll('.chat-message')].map((n) => [n.dataset.messageId, n]),
  );
  const hadMessages = previous.size > 0;
  const entries = chatEntries();
  const nodes = entries.map((message) => {
    const old = previous.get(message.id);
    if (
      old &&
      old.messageText === message.text &&
      old.mediaSignature === JSON.stringify(message.media || []) &&
      old.dataset.delivery === (message.delivery || '')
    )
      return old;
    const bubble = el('article', `chat-message ${message.role}`);
    bubble.messageText = message.text;
    bubble.mediaSignature = JSON.stringify(message.media || []);
    bubble.dataset.messageId = message.id;
    bubble.dataset.delivery = message.delivery || '';
    const meta = el('div', 'chat-meta');
    meta.append(
      el(
        'span',
        '',
        message.role === 'user' ? tr('you') : agentLabel(agentOf(state.detail.terminal)),
      ),
    );
    if (message.timestamp)
      meta.append(
        el(
          'time',
          '',
          new Date(message.timestamp).toLocaleTimeString(
            I18n.language === 'ko' ? 'ko-KR' : 'en-GB',
            { hour: '2-digit', minute: '2-digit', hour12: false },
          ),
        ),
      );
    meta.append(copyMessageButton(message.text));
    bubble.append(meta, messageContent(message.text, message.media));
    appendMedia(bubble, message.media);
    if (message.delivery) {
      const delivery = el(
        'div',
        'delivery',
        {
          sending: tr('sending'),
          sent: tr('sent'),
          unknown: tr('delivery_unknown'),
          failed: message.deliveryError
            ? `${tr('failed')}: ${tr(message.deliveryError)}`
            : tr('failed'),
        }[message.delivery],
      );
      delivery.setAttribute('role', 'status');
      bubble.append(delivery);
    }
    if (hadMessages && !old) enter(bubble);
    return bubble;
  });
  if (!host.querySelector('.chat-message')) host.replaceChildren();
  const keep = new Set(nodes);
  [...host.children].forEach((n) => {
    if (!keep.has(n)) {
      releaseMessageContent(n);
      n.remove();
    }
  });
  nodes.forEach((n, i) => {
    if (host.children[i] !== n) host.insertBefore(n, host.children[i] || null);
  });
  if (!entries.length) host.append(el('div', 'empty', tr(unavailable) || tr('no_chat')));
  $('older-messages').classList.toggle('hidden', !state.chatHasMore);
}
async function loadOlder() {
  if (state.loadingOlder || !state.chatHasMore) return;
  state.loadingOlder = true;
  const address = state.selected,
    session = state.chatSession;
  $('older-messages').disabled = true;
  try {
    const data = await api(
      `/v1/terminal?address=${encodeURIComponent(address)}&before=${state.chatBefore}`,
    );
    if (state.selected !== address || data.terminal.sessionId !== session) return;
    const scroll = $('detail-body'),
      height = scroll.scrollHeight,
      top = scroll.scrollTop;
    const merged = new Map(
      [...data.conversation.messages, ...state.chatMessages].map((m) => [m.id, m]),
    );
    state.chatMessages = [...merged.values()].sort((a, b) => a.ordinal - b.ordinal);
    state.chatHasMore = !!data.conversation.hasMore;
    state.chatBefore = data.conversation.before;
    renderChat(data.conversation.unavailable);
    scroll.scrollTop = top + scroll.scrollHeight - height;
  } catch (e) {
    toast(e.message);
  } finally {
    state.loadingOlder = false;
    if ($('older-messages')) $('older-messages').disabled = false;
  }
}
async function loadDetail() {
  const address = state.selected;
  if (!address || state.detailLoading || document.hidden) return;
  state.detailLoading = true;
  busy($('detail-refresh'), true);
  try {
    const data = await api(`/v1/terminal?address=${encodeURIComponent(address)}`);
    if (state.selected === address) {
      state.detail = data;
      state.detailError = '';
      updateDetail();
    }
  } catch (e) {
    if (state.selected === address) {
      state.detailError = e.message;
      updateDetail();
    }
  } finally {
    state.detailLoading = false;
    busy($('detail-refresh'), false);
    if (state.selected && state.selected !== address) loadDetail();
  }
}
