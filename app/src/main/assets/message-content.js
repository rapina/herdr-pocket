function messageParts(text) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const parts = [];
  let plain = '';
  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].trimEnd().match(/^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/);
    if (!opening) {
      plain += lines[i];
      continue;
    }
    const fence = opening[1],
      language = opening[2].trim().toLowerCase();
    let end = i + 1;
    while (
      end < lines.length &&
      !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[end])
    )
      end++;
    if (end === lines.length) {
      if (plain) parts.push({ type: 'text', text: plain });
      parts.push({ type: 'literal', text: lines.slice(i).join('') });
      plain = '';
      break;
    }
    if (plain) parts.push({ type: 'text', text: plain });
    plain = '';
    parts.push({
      type: language === 'mermaid' ? 'mermaid' : 'code',
      text: lines
        .slice(i + 1, end)
        .join('')
        .replace(/\r?\n$/, ''),
    });
    i = end;
  }
  if (plain) parts.push({ type: 'text', text: plain });
  return parts;
}

let mermaidReady,
  diagramId = 0,
  diagramQueue = Promise.resolve();
function loadMermaid() {
  if (!mermaidReady)
    mermaidReady = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'vendor/mermaid.min.js';
      script.onerror = () => reject(Error('renderer unavailable'));
      script.onload = () => {
        try {
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: 'dark',
            htmlLabels: false,
            fontFamily: 'sans-serif',
            suppressErrorRendering: true,
            maxTextSize: 20000,
            maxEdges: 250,
            secure: [
              'securityLevel',
              'startOnLoad',
              'maxTextSize',
              'maxEdges',
              'suppressErrorRendering',
              'htmlLabels',
              'themeCSS',
              'dompurifyConfig',
              'secure',
            ],
          });
          resolve(window.mermaid);
        } catch (error) {
          reject(error);
        }
      };
      document.head.append(script);
    });
  return mermaidReady;
}

function diagramImage(svg) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw Error('invalid SVG');
  root
    .querySelectorAll('script,foreignObject,image,iframe,object,embed,audio,video')
    .forEach((n) => n.remove());
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        (/href$/i.test(attribute.name) && !attribute.value.startsWith('#'))
      )
        node.removeAttributeNode(attribute);
    }
  }
  const localUrls = (text) =>
    text.replace(/@import[^;]+;?/gi, '').replace(/url\(([^)]*)\)/gi, (match, value) =>
      value
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .startsWith('#')
        ? match
        : 'none',
    );
  root.querySelectorAll('style').forEach((n) => {
    n.textContent = localUrls(n.textContent);
  });
  root.querySelectorAll('[style]').forEach((n) => {
    n.setAttribute('style', localUrls(n.getAttribute('style')));
  });
  const viewBox = root
    .getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number);
  const image = el('img', 'mermaid-image');
  image.alt = tr('diagram');
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    image.width = Math.ceil(viewBox[2]);
    image.height = Math.ceil(viewBox[3]);
  }
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  return image;
}

async function drawDiagram(figure) {
  if (!figure.isConnected) return;
  const source = figure.diagramSource;
  const preview = figure.querySelector('.diagram-preview');
  const details = figure.querySelector('details');
  const scratch = el('div', 'diagram-scratch');
  try {
    if (source.length > 20000) throw Error('diagram too large');
    const renderer = await loadMermaid();
    if (!figure.isConnected) return;
    document.body.append(scratch);
    const { svg } = await renderer.render(`pocket-diagram-${++diagramId}`, source, scratch);
    if (!figure.isConnected) return;
    const picture = diagramImage(svg);
    const scroll = $('detail-body');
    const following = scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
    preview.replaceChildren(picture);
    figure.dataset.rendered = 'true';
    if (following) scroll.scrollTop = scroll.scrollHeight;
  } catch {
    preview.textContent = tr('diagram_failed');
    figure.dataset.rendered = 'error';
    details.open = true;
  } finally {
    scratch.remove();
  }
}

const diagramObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries)
      if (entry.isIntersecting) {
        diagramObserver.unobserve(entry.target);
        diagramQueue = diagramQueue.then(() => drawDiagram(entry.target)).catch(() => {});
      }
  },
  { rootMargin: '400px' },
);

function releaseMessageContent(host) {
  if (typeof releaseMedia === 'function') releaseMedia(host);
  host.querySelectorAll('.mermaid-block').forEach((n) => diagramObserver.unobserve(n));
}

function messageLink(raw) {
  const value = raw.trim().replace(/^<|>$/g, '');
  if (!value || value.length > 4096 || /[\u0000-\u0020\u007f]/.test(value.replace(/ /g, '')))
    return null;
  try {
    if (/^https?:\/\//i.test(value)) {
      if (/\s|\\/.test(value)) return null;
      const url = new URL(value);
      if (!url.hostname || url.username || url.password || url.hostname === 'pocket-media.invalid')
        return null;
      return { kind: 'web', target: url.href };
    }
    let path = value;
    if (/^file:/i.test(path)) {
      const url = new URL(path.replace(/\\/g, '/'));
      if (url.hostname && url.hostname !== 'localhost') return null;
      path = decodeURIComponent(url.pathname);
    } else {
      if (/^[a-z][\w+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
      path = decodeURIComponent(path);
    }
    path = path.replace(/^\/([a-z]:[\\/])/i, '$1').replace(/\\/g, '/');
    if (
      !path ||
      /[\u0000-\u001f\u007f]/.test(path) ||
      path.startsWith('//') ||
      path.startsWith('#')
    )
      return null;
    return { kind: 'local', target: path };
  } catch {
    return null;
  }
}

function inlineParts(text) {
  const pattern =
    /(`+)([^\n]*?)\1|!?\[([^\]\n]+)\]\(\s*(<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+)\s*\)|\*\*(?=\S)([\s\S]*?\S)\*\*|(?:https?:\/\/|file:[\/\\]+|[a-z]:[\/\\])[^\s<>"'`]+/gi;
  const result = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > offset) result.push({ type: 'text', text: text.slice(offset, match.index) });
    if (match[1]) result.push({ type: 'code', text: match[2] });
    else if (match[5]) result.push({ type: 'bold', text: match[5] });
    else {
      let target = match[4] || match[0],
        suffix = '';
      if (!match[4]) {
        while (
          /[.,;:!?\]}]$/.test(target) ||
          (target.endsWith(')') &&
            (target.match(/\)/g)?.length || 0) > (target.match(/\(/g)?.length || 0))
        ) {
          suffix = target.slice(-1) + suffix;
          target = target.slice(0, -1);
        }
      }
      const link = messageLink(target);
      result.push(
        link
          ? { type: 'link', text: match[3] || target, ...link }
          : { type: 'text', text: match[0].slice(0, match[0].length - suffix.length) },
      );
      if (suffix) result.push({ type: 'text', text: suffix });
    }
    offset = match.index + match[0].length;
  }
  if (offset < text.length) result.push({ type: 'text', text: text.slice(offset) });
  return result;
}

function appendMessageText(host, text, media = [], depth = 0) {
  for (const part of inlineParts(text)) {
    if (part.type === 'bold' && depth < 3) {
      const strong = el('strong');
      appendMessageText(strong, part.text, media, depth + 1);
      host.append(strong);
    } else if (part.type === 'code') host.append(el('code', 'inline-code', part.text));
    else if (part.type === 'link') {
      const link = el('a', 'message-link', part.text);
      link.href = part.kind === 'web' ? part.target : '#';
      link.title = part.target;
      link.rel = 'noopener noreferrer';
      link.onclick = async (event) => {
        event.preventDefault();
        haptic('tap');
        try {
          if (part.kind === 'web') await native('openLink', { url: part.target });
          else {
            const item = media.find((m) => m.path && messageLink(m.path)?.target === part.target);
            if (item?.kind === 'image') showMediaImage(item, link);
            else if (item) {
              const card = [...host.closest('.chat-message').querySelectorAll('.media-card')].find(
                (n) => n.dataset.mediaId === item.id,
              );
              card?.scrollIntoView({
                block: 'center',
                behavior: reducedMotion.matches ? 'instant' : 'smooth',
              });
              card?.querySelector('video,audio')?.focus({ preventScroll: true });
            } else {
              await native('copy', { text: part.target });
              toast(tr('path_copied'));
            }
          }
        } catch {
          toast(tr('link_open_failed'));
        }
      };
      host.append(link);
    } else host.append(document.createTextNode(part.text));
  }
}

function messageContent(text, media = []) {
  const host = el('div', 'chat-text');
  for (const part of messageParts(text)) {
    if (part.type === 'literal') {
      host.append(document.createTextNode(part.text));
      continue;
    }
    if (part.type === 'text') {
      appendMessageText(host, part.text, media);
      continue;
    }
    if (part.type === 'code') {
      const pre = el('pre', 'code-block');
      pre.append(el('code', '', part.text));
      host.append(pre);
      continue;
    }
    const figure = el('figure', 'mermaid-block');
    figure.diagramSource = part.text;
    const preview = el('div', 'diagram-preview', tr('diagram_loading'));
    const details = el('details', 'diagram-source');
    const code = el('pre');
    code.append(el('code', '', part.text));
    details.append(el('summary', '', tr('diagram_code')), code);
    figure.append(preview, details);
    host.append(figure);
    diagramObserver.observe(figure);
  }
  return host;
}
