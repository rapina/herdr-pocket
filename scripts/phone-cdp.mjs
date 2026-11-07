import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function connect() {
  const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
  const target = tabs.find((t) => t.url === 'file:///android_asset/index.html');
  if (!target) throw new Error('Herdr Pocket WebView is not open');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    const p = waiting.get(m.id);
    if (p) {
      waiting.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiting.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  return {
    close: () => ws.close(),
    command,
    evaluate: async (expression) => {
      const r = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description);
      return r.result.value;
    },
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const c = await connect();
  try {
    const action = process.argv[2] || 'inspect';
    if (action === 'configure') {
      const { token } = JSON.parse(
        readFileSync(new URL('../.local/config.json', import.meta.url), 'utf8'),
      );
      const url = process.argv[3];
      await c.evaluate(
        `(async()=>{state.tab='settings';render();$('server-url').value=${JSON.stringify(url)};$('server-token').value=${JSON.stringify(token)};document.querySelector('form').requestSubmit();return true;})()`,
      );
      console.log('Connection submitted through the phone settings form.');
    } else if (action === 'eval')
      console.log(JSON.stringify(await c.evaluate(readFileSync(process.argv[3], 'utf8')), null, 2));
    else
      console.log(
        JSON.stringify(
          await c.evaluate(
            `({title:document.title,text:document.body.innerText,visibility:document.visibilityState,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,online:state.online,error:state.error,terminals:state.snapshot?.terminals.length})`,
          ),
          null,
          2,
        ),
      );
  } finally {
    c.close();
  }
}
