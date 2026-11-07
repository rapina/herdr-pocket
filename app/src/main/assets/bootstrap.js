$('refresh').append(icon('refresh'));
$('refresh').onclick = () => {
  haptic('tap');
  refresh();
};
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    window.pocketPushRefresh();
    window.pocketOpenNotification();
    refresh();
    loadDetail();
    checkReceipt();
  }
});
setInterval(() => {
  if (document.hidden) return;
  if (state.selected) loadDetail();
  else refresh();
  checkReceipt();
}, 4000);
setInterval(() => {
  if (!document.hidden) updateTimers();
}, 1000);
(async () => {
  try {
    state.config = await native('settings');
    state.sendBusy = !!pendingMessage;
    render();
    await refresh();
    await window.pocketOpenNotification();
    if (pendingMessage) checkReceipt();
  } catch (e) {
    state.error = e.message;
    render();
    toast(e.message);
  }
})();
