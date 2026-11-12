let pendingMessage,
  postFlight = false,
  receiptFlight = false;
try {
  pendingMessage = JSON.parse(localStorage.getItem('pocket-pending') || 'null');
} catch {
  pendingMessage = null;
}
async function sendMessage(selection) {
  const prompt = state.detail?.interaction;
  const answering = !!selection?.interactionId;
  const choice =
    answering && prompt?.id === selection.interactionId
      ? prompt.choices.find((c) => c.id === selection.choiceId)
      : null;
  if (state.sendBusy || state.detailError || (answering ? !choice : !state.detail?.canSend)) return;
  if (pendingMessage) {
    toast(tr('checking_previous'));
    await checkReceipt();
    return;
  }
  const text = answering ? choice.label : $('message-input').value.trim();
  if (!text) return;
  const id = crypto.randomUUID();
  const terminal = state.detail.terminal;
  pendingMessage = { id, address: state.selected };
  localStorage.setItem('pocket-pending', JSON.stringify(pendingMessage));
  outbox.set(id, {
    ...pendingMessage,
    text,
    sessionId: terminal.sessionId,
    afterOrdinal: Math.max(-1, ...state.chatMessages.map((m) => m.ordinal)),
    sentAt: new Date().toISOString(),
    state: 'sending',
    ...(answering ? { interaction: { id: prompt.id, choiceId: choice.id } } : {}),
  });
  saveOutbox();
  if (!answering) {
    drafts.delete(state.selected);
    $('message-input').value = '';
    $('message-input').style.height = '';
    $('char-count').textContent = '';
  }
  state.sendBusy = true;
  updateSend();
  renderChat();
  $('detail-body').scrollTop = $('detail-body').scrollHeight;
  postFlight = true;
  try {
    const r = await api('/v1/message', {
      id,
      address: pendingMessage.address,
      text,
      createdMs: terminal.created_ms,
      sessionId: terminal.sessionId,
      ...(answering ? { interaction: { id: prompt.id, choiceId: choice.id } } : {}),
    });
    handleReceipt(r);
  } catch (e) {
    if ([400, 401, 403, 404, 409, 413, 415].includes(e.status))
      handleReceipt({ id, state: 'rejected', message: e.code || e.message });
    else handleReceipt({ id, state: 'unknown', message: 'delivery_uncertain' });
  } finally {
    postFlight = false;
  }
}
function handleReceipt(r) {
  const tracked = outbox.get(r.id);
  if (pendingMessage?.id !== r.id && !tracked) return;
  if (!['sending', 'sent', 'unknown', 'rejected'].includes(r.state)) return;
  if (tracked?.state === r.state && r.state !== 'sending') return;
  if (r.state === 'sending') {
    if (tracked) {
      tracked.state = 'sending';
      saveOutbox();
      if (!pendingMessage) {
        pendingMessage = { id: r.id, address: tracked.address };
        localStorage.setItem('pocket-pending', JSON.stringify(pendingMessage));
        state.sendBusy = true;
        updateSend();
      }
    }
    return;
  }
  const address = tracked?.address || pendingMessage.address;
  const item = outbox.get(r.id);
  if (item) {
    item.state = r.state === 'sent' ? 'sent' : r.state === 'unknown' ? 'unknown' : 'failed';
    item.error = r.state === 'rejected' ? r.message : null;
    saveOutbox();
    if (item.state === 'failed' && !item.interaction) restoreDraft(item);
  }
  if (pendingMessage?.id === r.id) {
    pendingMessage = null;
    localStorage.removeItem('pocket-pending');
    state.sendBusy = false;
  }
  if (r.state === 'sent') {
    if (state.selected === address)
      motion(
        $('send-message'),
        [
          { background: 'var(--text)', transform: 'translateY(-3px)' },
          { background: 'var(--accent)', transform: 'translateY(0)' },
        ],
        { duration: 260 },
      );
    haptic('success');
  }
  if (r.state !== 'sent') haptic('reject');
  if (state.selected === address) {
    renderChat();
    updateSend();
    loadDetail();
  } else if (r.state !== 'sent') toast(tr(r.message));
}
function restoreDraft(item) {
  if (drafts.get(item.address)) return;
  drafts.set(item.address, item.text);
  if (state.selected === item.address && !$('message-input').value)
    $('message-input').value = item.text;
}
async function checkReceipt() {
  if (postFlight || receiptFlight || !state.config.configured || document.hidden) return;
  const candidate = pendingMessage || [...outbox.values()].find((m) => m.state === 'unknown');
  if (!candidate) return;
  const id = candidate.id;
  receiptFlight = true;
  try {
    const r = await api(`/v1/receipt?id=${encodeURIComponent(id)}`);
    handleReceipt(r);
  } catch (e) {
    if (pendingMessage?.id !== id && !outbox.has(id)) return;
    handleReceipt({ id, state: 'unknown', message: 'delivery_uncertain' });
  } finally {
    receiptFlight = false;
  }
}
