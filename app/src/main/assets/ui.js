const $ = (id) => document.getElementById(id);
const icons = {
  copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H4v13h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  devices: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  settings:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--bg)"/><circle cx="16" cy="17" r="3" fill="var(--bg)"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  send: '<path d="m5 12 7-7 7 7M12 5v15"/>',
  folder:
    '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
  terminal: '<path d="m5 7 5 5-5 5M13 17h6"/>',
};
function icon(name) {
  const el = document.createElement('span');
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.terminal}</svg>`;
  return el.firstChild;
}
function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}
function button(className, label, action) {
  const n = el('button', className, label);
  n.type = 'button';
  n.onclick = (e) => {
    haptic('tap');
    action?.(e);
  };
  return n;
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) document.getAnimations().forEach((a) => a.cancel());
});
function motion(node, frames, options = {}) {
  if (!node || reducedMotion.matches) return;
  node.getAnimations().forEach((a) => a.cancel());
  const animation = node.animate(frames, {
    duration: 180,
    easing: 'cubic-bezier(.2,.8,.2,1)',
    ...options,
  });
  animation.onfinish = () => animation.cancel();
  return animation;
}
function haptic(kind) {
  if (!reducedMotion.matches) window.PocketNative?.haptic?.(kind);
}
function enter(node) {
  motion(node, [
    { opacity: 0.4, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'translateY(0)' },
  ]);
}
function busy(node, value) {
  if (node) {
    node.classList.toggle('busy', value);
    node.setAttribute('aria-busy', String(value));
  }
}

function copyMessageButton(text) {
  const control = button('copy-message', '', async () => {
    if (control.disabled) return;
    control.disabled = true;
    try {
      await native('copy', { text });
      control.replaceChildren(icon('check'));
      control.classList.add('copied');
      control.setAttribute('aria-label', tr('copied'));
      setTimeout(() => {
        control.replaceChildren(icon('copy'));
        control.classList.remove('copied');
        control.setAttribute('aria-label', tr('copy_message'));
        control.disabled = false;
      }, 1500);
    } catch {
      control.disabled = false;
      toast(tr('copy_failed'));
    }
  });
  control.setAttribute('aria-label', tr('copy_message'));
  control.append(icon('copy'));
  return control;
}
