let mediaViewer = null;
function mediaUrl(item) {
  return /^[a-f0-9]{64}$/.test(item.id || '') ? `https://pocket-media.invalid/${item.id}` : null;
}
function pauseMedia(host = document) {
  host.querySelectorAll('video,audio').forEach((player) => player.pause());
}
function closeMediaViewer() {
  if (!mediaViewer) return false;
  const previous = mediaViewer.returnFocus;
  mediaViewer.remove();
  mediaViewer = null;
  previous?.focus({ preventScroll: true });
  return true;
}
function showMediaImage(item, trigger) {
  closeMediaViewer();
  const dialog = el('dialog', 'media-viewer');
  dialog.returnFocus = trigger;
  dialog.setAttribute('aria-label', item.name);
  const bar = el('div', 'media-viewer-bar');
  const close = button('icon-button', '×', closeMediaViewer);
  close.setAttribute('aria-label', tr('media_close'));
  bar.append(el('span', '', item.name), close);
  const viewport = el('div', 'media-viewport');
  const image = el('img', 'media-full');
  image.alt = item.name;
  image.src = mediaUrl(item);
  const zoom = button('secondary', tr('media_zoom'), () => {
    const enlarged = viewport.classList.toggle('zoomed');
    zoom.setAttribute('aria-pressed', String(enlarged));
  });
  zoom.setAttribute('aria-pressed', 'false');
  bar.append(zoom);
  viewport.append(image);
  dialog.append(bar, viewport);
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeMediaViewer();
  });
  document.body.append(dialog);
  mediaViewer = dialog;
  dialog.showModal();
  close.focus();
}
function releaseMedia(host) {
  pauseMedia(host);
  host.querySelectorAll('video,audio').forEach((player) => {
    player.removeAttribute('src');
    player.load();
  });
}
function appendMedia(host, items = []) {
  for (const item of items.slice(0, 12)) {
    const src = mediaUrl(item);
    if (!src || !['image', 'video', 'audio'].includes(item.kind)) continue;
    const card = el('figure', `media-card media-${item.kind}`);
    card.dataset.mediaId = item.id;
    const caption = el('figcaption', '', item.name);
    const status = el('div', 'media-status');
    status.setAttribute('role', 'status');
    const retry = button('secondary media-retry', tr('media_retry'), () => load());
    retry.hidden = true;
    let player;
    const fail = () => {
      status.textContent = tr('media_failed');
      retry.hidden = false;
    };
    const ready = () => {
      status.textContent = '';
      retry.hidden = true;
    };
    const load = () => {
      status.textContent = tr('media_loading');
      retry.hidden = true;
      player.src = src;
      if (item.kind !== 'image') player.load();
    };
    if (item.kind === 'image') {
      const open = button('media-open', '', () => showMediaImage(item, open));
      open.setAttribute('aria-label', `${tr('media_open')}: ${item.name}`);
      player = el('img');
      player.alt = item.name;
      player.loading = 'lazy';
      player.decoding = 'async';
      player.onload = ready;
      player.onerror = fail;
      player.src = src;
      open.append(player);
      card.append(open);
    } else {
      player = el(item.kind);
      player.controls = true;
      player.preload = 'none';
      player.setAttribute('playsinline', '');
      player.setAttribute('aria-label', item.name);
      player.src = src;
      player.addEventListener('waiting', () => {
        status.textContent = tr('media_loading');
      });
      player.addEventListener('loadeddata', ready);
      player.addEventListener('canplay', ready);
      player.addEventListener('error', fail);
      player.addEventListener('play', () => {
        document.querySelectorAll('video,audio').forEach((other) => {
          if (other !== player) other.pause();
        });
      });
      card.append(player);
    }
    card.append(caption, status, retry);
    host.append(card);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseMedia();
});
