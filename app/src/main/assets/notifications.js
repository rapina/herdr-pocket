let pushBusy = false,
  openingNotification = false,
  queuedNotification = null;

function syncPushContext() {
  const terminals = [
    ...(state.snapshot?.terminals || []),
    ...(state.detail?.terminal ? [state.detail.terminal] : []),
  ];
  const selected = terminals.findLast((t) => t.address === state.selected);
  native('pushContext', {
    visibleKey: selected?.notificationKey || '',
    language: I18n.language,
    routes: terminals
      .filter((t) => t.notificationKey)
      .map((t) => ({ key: t.notificationKey, title: project(t) })),
  }).catch(() => {});
}
function updatePushControls() {
  const toggle = $('push-toggle'),
    status = $('push-state');
  if (!toggle || !status) return;
  const p = state.config.push || {};
  toggle.disabled = pushBusy;
  toggle.textContent = tr(
    pushBusy ? 'push_connecting' : p.enabled ? 'push_disable' : 'push_enable',
  );
  toggle.setAttribute('aria-pressed', String(!!p.enabled));
  status.textContent = tr(
    p.enabled
      ? !p.permission
        ? 'push_permission_denied'
        : p.registered
          ? 'push_enabled'
          : 'push_registration_pending'
      : 'push_disabled',
  );
}
window.pocketPushRefresh = async () => {
  try {
    state.config.push = await native('pushStatus');
    updatePushControls();
  } catch {}
  syncPushContext();
  if (queuedNotification) window.pocketOpenNotification();
};
function renderNotificationSettings(host) {
  if (!state.config.configured) return;
  const section = el('section', 'notification-settings');
  section.append(el('h2', '', tr('notifications')));
  const status = el('p', 'muted');
  status.id = 'push-state';
  const toggle = button('secondary wide', '', async () => {
    if (pushBusy) return;
    pushBusy = true;
    updatePushControls();
    try {
      if (!state.config.push?.enabled) {
        const options = await api('/v1/push/options');
        if (!options.available) throw new Error(tr('push_not_configured'));
      }
      state.config.push = await native('push', { enabled: !state.config.push?.enabled });
    } catch (e) {
      toast(e.message);
    } finally {
      pushBusy = false;
      await window.pocketPushRefresh();
      updatePushControls();
    }
  });
  toggle.id = 'push-toggle';
  section.append(
    status,
    toggle,
    button('secondary wide', tr('push_system_settings'), () =>
      native('pushSettings').catch((e) => toast(e.message)),
    ),
  );
  host.append(section);
  updatePushControls();
  window.pocketPushRefresh();
}
window.pocketOpenNotification = async () => {
  if (openingNotification || !state.config.configured) return;
  openingNotification = true;
  try {
    const key = queuedNotification || (await native('notificationIntent')).key;
    if (!key) return;
    queuedNotification = key;
    const { address } = await api(`/v1/push/resolve?key=${encodeURIComponent(key)}`);
    await native('notificationHandled', { key });
    queuedNotification = null;
    if (state.selected && state.selected !== address) closeDetail();
    state.tab = 'tasks';
    if (state.selected !== address) {
      render();
      openDetail(address);
    } else loadDetail();
  } catch (e) {
    if (e.status === 400 || e.status === 410) {
      await native('notificationHandled', { key: queuedNotification });
      queuedNotification = null;
    }
    toast(e.message);
  } finally {
    openingNotification = false;
  }
};
