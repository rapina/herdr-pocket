import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const exampleMedia = new Map([
  ['4'.repeat(64), { name: 'orbit-study.png', type: 'image/png' }],
  ['5'.repeat(64), { name: 'completion-chime.wav', type: 'audio/wav' }],
  ['6'.repeat(64), { name: 'orbit-loop.mp4', type: 'video/mp4' }],
]);
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
const profile = mkdtempSync(resolve(root, 'artifacts/ui-chrome-'));
const server = createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (
    ![
      'index.html',
      'style.css',
      'app.js',
      'i18n.js',
      'ui.js',
      'transport.js',
      'delivery.js',
      'interaction.js',
      'message-content.js',
      'media.js',
      'notifications.js',
      'vendor/mermaid.min.js',
      'bootstrap.js',
    ].includes(name)
  ) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'Content-Type',
    name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html',
  );
  res.end(readFileSync(resolve(root, 'app/src/main/assets', name)));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const chrome = spawn(
  process.env.CHROME_BIN ||
    (process.platform === 'win32'
      ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
      : process.platform === 'darwin'
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : 'google-chrome'),
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
);
let c;
const checks = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function tap(selector) {
  const point = await c.evaluate(
    `(()=>{const n=document.querySelector(${JSON.stringify(selector)});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)})===n};})()`,
  );
  if (!point.hit) throw Error('Touch target missed: ' + selector);
  await c.command('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y }],
  });
  await c.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

function check(name, value) {
  checks.push({ name, value });
  if (!value) throw Error(name);
}
try {
  const debuggerUrl = await new Promise((resolve, reject) => {
    let log = '',
      settled = false;
    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(Error(`${error}\n${log || '(Chrome wrote no stderr)'}`));
      else resolve(url);
    };
    const timeout = setTimeout(() => finish('Chrome startup timeout after 30 seconds'), 30000);
    chrome.once('error', (error) => finish(`Chrome launch failed: ${error.message}`));
    chrome.once('exit', (code, signal) =>
      finish(`Chrome exited before DevTools was ready (code=${code}, signal=${signal})`),
    );
    chrome.stderr.on('data', (data) => {
      log = (log + data).slice(-8192);
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
    });
  });
  const port = new URL(debuggerUrl).port;
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(
    tabs.find((t) => t.type === 'page' && t.url === 'about:blank').webSocketDebuggerUrl,
  );
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Fetch.requestPaused') {
      const id = new URL(m.params.request.url).pathname.slice(1);
      const example = exampleMedia.get(id);
      if (example) {
        const bytes = readFileSync(resolve(root, 'docs/examples', example.name));
        const range = Object.entries(m.params.request.headers)
          .find(([key]) => key.toLowerCase() === 'range')?.[1]
          ?.match(/^bytes=(\d+)-(\d*)$/);
        const start = range ? Number(range[1]) : 0;
        const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        const headers = [
          { name: 'Content-Type', value: example.type },
          { name: 'Accept-Ranges', value: 'bytes' },
        ];
        if (range)
          headers.push({ name: 'Content-Range', value: `bytes ${start}-${end}/${bytes.length}` });
        command('Fetch.fulfillRequest', {
          requestId: m.params.requestId,
          responseCode: range ? 206 : 200,
          responseHeaders: headers,
          body: bytes.subarray(start, end + 1).toString('base64'),
        }).catch(() => {});
        return;
      }
      const image = id === '1'.repeat(64);
      const audio = id === '2'.repeat(64);
      const bytes = image
        ? Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Z1sAAAAASUVORK5CYII=',
            'base64',
          )
        : Buffer.alloc(32044);
      if (audio) {
        bytes.write('RIFF');
        bytes.writeUInt32LE(bytes.length - 8, 4);
        bytes.write('WAVEfmt ', 8);
        bytes.writeUInt32LE(16, 16);
        bytes.writeUInt16LE(1, 20);
        bytes.writeUInt16LE(1, 22);
        bytes.writeUInt32LE(8000, 24);
        bytes.writeUInt32LE(16000, 28);
        bytes.writeUInt16LE(2, 32);
        bytes.writeUInt16LE(16, 34);
        bytes.write('data', 36);
        bytes.writeUInt32LE(32000, 40);
      }
      command('Fetch.fulfillRequest', {
        requestId: m.params.requestId,
        responseCode: image || audio ? 200 : 404,
        responseHeaders: [{ name: 'Content-Type', value: image ? 'image/png' : 'audio/wav' }],
        body: bytes.toString('base64'),
      }).catch(() => {});
      return;
    }
    const p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
  };
  const command = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  c = {
    command,
    evaluate: async (expression) => {
      const r = await command('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    close: () => ws.close(),
  };
  await command('Page.enable');
  await command('Fetch.enable', { patterns: [{ urlPattern: 'https://pocket-media.invalid/*' }] });
  await command('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 833,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `
    localStorage.setItem('pocket-language','ko');window.designErrors=[];window.addEventListener('error',e=>designErrors.push(e.message));
    window.fixturePush={enabled:false,registered:false,permission:true};window.fixturePushAvailable=false;window.fixtureNotification=null;window.fixtureResolveFail=false;window.designRequests=[];window.designHaptics=[];window.fixtureResult='sent';window.fixtureDelay=20;window.fixturePostDelay=240;window.fixtureReceiptMissing=false;
    window.fixtureTerminals=Array.from({length:8},(_,i)=>({address:'workstation/t'+i,project:['atlas-core','signal-lab','orbit-api','frame-kit'][i%4],sessionTitle:['상태 동기화 개선','렌더링 검증','API 응답 처리','인터페이스 테스트'][i%4],agent:'codex',status:{state:i<2?'working':i===2?'blocked':'done'},sessionId:'session-'+i,created_ms:1}));
    fixtureTerminals[0].notificationKey='11111111-1111-4111-8111-111111111111';fixtureTerminals.forEach((t,i)=>{t.lastResponseAt=new Date(Date.now()+i*1000).toISOString();t.workingSince=i<2?new Date(Date.now()-125000).toISOString():null;});
    window.fixtureSnapshot={localMachine:'workstation',terminals:fixtureTerminals,machines:[],observedAt:new Date().toISOString()};
    window.fixtureDetail={terminal:fixtureTerminals[0],canSend:true,observedAt:new Date().toISOString(),conversation:{messages:[{id:'m1',ordinal:1,role:'user',text:'상태 동기화를 확인해줘.',timestamp:new Date().toISOString()},{id:'m2',ordinal:2,role:'assistant',text:'변경된 상태만 갱신하도록 수정했습니다.\\n\\n목록을 읽는 동안 스크롤 위치가 유지됩니다.',timestamp:new Date().toISOString()}],hasMore:false}};
    window.PocketNative={haptic:kind=>designHaptics.push(kind),call:(id,method,payload)=>{const p=JSON.parse(payload);designRequests.push({method,...p});if(p.path?.startsWith('/v1/receipt')&&fixtureReceiptMissing){setTimeout(()=>pocketReply(id,{ok:false,error:'receipt_missing',status:404}),10);return;}if(p.path?.startsWith('/v1/push/resolve')&&fixtureResolveFail){setTimeout(()=>pocketReply(id,{ok:false,error:'network_error',status:503}),10);return;}let data;if(method==='pushStatus')data=fixturePush;else if(method==='push')data=fixturePush={...fixturePush,enabled:p.enabled,registered:p.enabled};else if(method==='notificationIntent')data={key:fixtureNotification};else if(method==='notificationHandled'){fixtureNotification=null;data={};}else if(method==='pushContext')data={};else if(p.path==='/v1/push/options')data={available:fixturePushAvailable};else if(p.path?.startsWith('/v1/push/resolve'))data={address:'workstation/t0'};else if(method==='copy')data={copied:true};else if(method==='settings')data={configured:true};else if(p.path==='/v1/message')data={id:p.body.id,state:fixtureResult,message:'전송 거부'};else if(p.path?.startsWith('/v1/receipt'))data={id:new URL('http://test'+p.path).searchParams.get('id'),state:'sent'};else if(p.path==='/v1/snapshot')data=fixtureSnapshot;else data={...fixtureDetail,terminal:fixtureTerminals.find(t=>t.address===new URL('http://test'+p.path).searchParams.get('address'))||fixtureDetail.terminal};setTimeout(()=>pocketReply(id,{ok:true,data}),p.path==='/v1/message'?fixturePostDelay:fixtureDelay);}};
  `,
  });
  await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  for (let n = 0; n < 40; n++) {
    if (await c.evaluate(`typeof state!=='undefined'&&state.online`)) break;
    await wait(50);
  }
  check('fixture connected', await c.evaluate(`state.online`));
  check(
    'no horizontal overflow',
    await c.evaluate(`document.documentElement.scrollWidth<=innerWidth`),
  );
  check(
    'working first then newest agent response',
    await c.evaluate(
      `[...document.querySelectorAll('.card')].map(n=>n.dataset.address).join(',')==='workstation/t1,workstation/t0,workstation/t7,workstation/t6,workstation/t5,workstation/t4,workstation/t3,workstation/t2'`,
    ),
  );
  check(
    'working timer shows turn duration',
    await c.evaluate(`document.querySelector('.elapsed').textContent==='2:05'`),
  );
  let shot = await command('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(root, 'artifacts/design-demo-list.png'), Buffer.from(shot.data, 'base64'));
  await c.evaluate(
    `window.savedCard=document.querySelector('.card');window.savedSearch=document.querySelector('.search input');savedSearch.focus({preventScroll:true});`,
  );
  await c.evaluate(`refresh()`);
  check(
    'poll preserves card and search focus',
    await c.evaluate(
      `savedCard===document.querySelector('.card')&&savedSearch===document.activeElement`,
    ),
  );
  await c.evaluate(
    `savedSearch.blur();window.scrollTo(0,120);window.savedScroll=scrollY;document.querySelector('.card').click();`,
  );
  await wait(80);
  check(
    'conversation loaded',
    await c.evaluate(`!!state.detail&&!!document.querySelector('.chat-message')`),
  );
  check('background cannot receive focus', await c.evaluate(`$('app').hidden`));
  await c.evaluate(`document.querySelector('.chat-message.assistant .copy-message').click()`);
  await wait(70);
  check(
    'copy sends only the full message text and shows feedback',
    await c.evaluate(
      `designRequests.find(r=>r.method==='copy').text===fixtureDetail.conversation.messages[1].text&&document.querySelector('.chat-message.assistant .copy-message').getAttribute('aria-label')==='복사됨'`,
    ),
  );
  check(
    'each message has one accessible copy target',
    await c.evaluate(
      `document.querySelectorAll('.copy-message').length===document.querySelectorAll('.chat-message').length&&[...document.querySelectorAll('.copy-message')].every(n=>n.getBoundingClientRect().width>=44&&n.getBoundingClientRect().height>=44&&n.getAttribute('aria-label'))`,
    ),
  );

  await wait(250);
  shot = await command('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(root, 'artifacts/design-demo-chat.png'), Buffer.from(shot.data, 'base64'));
  await c.evaluate(`closeDetail()`);
  check(
    'back restores list position and focus',
    await c.evaluate(
      `Math.abs(scrollY-savedScroll)<2&&document.activeElement.dataset.address===returnAddress&&!$('app').hidden`,
    ),
  );
  await c.evaluate(`openDetail('workstation/t0')`);
  await wait(80);
  await c.evaluate(
    `$('message-input').value='UI fixture only';$('message-input').dispatchEvent(new Event('input'));$('send-message').click();$('send-message').click();`,
  );
  check(
    'send immediately clears input and shows pending bubble',
    await c.evaluate(
      `state.sendBusy&&$('send-message').disabled&&$('message-input').value===''&&document.querySelector('[data-delivery=sending] .chat-text').textContent==='UI fixture only'&&document.querySelector('[data-delivery=sending] .delivery').textContent==='보내는 중…'&&$('composer-notice').textContent===''&&!$('receipt')`,
    ),
  );
  await c.evaluate(
    `$('message-input').value='Next draft';$('message-input').dispatchEvent(new Event('input'));`,
  );
  await wait(320);
  check(
    'confirmation preserves next draft',
    await c.evaluate(
      `designRequests.filter(p=>p.path==='/v1/message').length===1&&!state.sendBusy&&$('message-input').value==='Next draft'&&document.querySelector('[data-delivery=sent] .delivery').textContent==='전달됨'&&$('composer-notice').textContent===''&&designHaptics.includes('success')`,
    ),
  );
  await c.evaluate(
    `fixtureDetail.conversation.messages.push({id:'echo',ordinal:3,role:'user',text:'UI fixture only',timestamp:new Date().toISOString()});state.detail=fixtureDetail;updateDetail();`,
  );
  check(
    'transcript echo replaces pending bubble without duplicate',
    await c.evaluate(
      `[...document.querySelectorAll('.chat-text')].filter(n=>n.textContent==='UI fixture only').length===1&&outbox.size===0`,
    ),
  );
  await c.evaluate(
    `fixtureResult='rejected';$('message-input').value='Keep this draft';$('message-input').dispatchEvent(new Event('input'));$('send-message').click();`,
  );
  await wait(320);
  check(
    'rejection keeps draft and feedback',
    await c.evaluate(
      `$('message-input').value==='Keep this draft'&&document.querySelector('[data-delivery=failed] .delivery').textContent.includes('전송 거부')&&$('composer-notice').textContent===''&&designHaptics.includes('reject')`,
    ),
  );
  await c.evaluate(
    `fixtureDetail.canSend=false;fixtureDetail.terminal.status.state='blocked';state.detail=fixtureDetail;updateDetail();`,
  );
  check(
    'blocked action stays unavailable',
    await c.evaluate(`$('send-message').disabled&&$('composer-notice').textContent===''`),
  );
  await c.evaluate(
    `fixtureDetail.interaction={id:'question-one',kind:'question',question:'Which environment should be used?',choices:[{id:'1',label:'Preview (Recommended)',description:'Only preview users can access it.'},{id:'2',label:'Production',description:'Available to all users.'},{id:'3',label:'Keep current settings',description:'Leave the configuration unchanged.'}]};fixtureResult='sent';state.detail=fixtureDetail;updateDetail();window.choiceRequests=designRequests.filter(p=>p.path==='/v1/message').length;`,
  );
  check(
    'question displays actual options and requires an explicit selection',
    await c.evaluate(
      `!$('interaction').classList.contains('hidden')&&$('composer').classList.contains('hidden')&&document.querySelectorAll('.question-choice').length===3&&$('submit-choice').disabled`,
    ),
  );
  await c.evaluate(
    `document.querySelector('[data-choice-id="2"]').click();window.savedChoice=document.querySelector('[data-choice-id="2"]');updateDetail();$('interaction').scrollIntoView({block:'end'});`,
  );
  check(
    'selecting a choice preserves it across refresh without sending',
    await c.evaluate(
      `savedChoice===document.querySelector('[data-choice-id="2"]')&&savedChoice.getAttribute('aria-checked')==='true'&&!$('submit-choice').disabled&&designRequests.filter(p=>p.path==='/v1/message').length===choiceRequests`,
    ),
  );
  shot = await command('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    resolve(root, 'artifacts/design-demo-question.png'),
    Buffer.from(shot.data, 'base64'),
  );
  await c.evaluate(`$('submit-choice').click();$('submit-choice').click();`);
  check(
    'choice submission creates one pending message and locks the dialog',
    await c.evaluate(
      `state.sendBusy&&$('submit-choice').disabled&&document.querySelector('[data-delivery=sending] .chat-text').textContent==='Production'&&designRequests.filter(p=>p.path==='/v1/message').length===choiceRequests+1&&designRequests.at(-1).body.interaction.choiceId==='2'`,
    ),
  );
  await wait(320);
  check(
    'delivered choice cannot submit the same prompt again',
    await c.evaluate(
      `!state.sendBusy&&$('submit-choice').disabled&&document.querySelector('[data-delivery=sent] .chat-text').textContent==='Production'`,
    ),
  );
  await c.evaluate(
    `fixtureDetail.conversation.messages.push({id:'after-choice',ordinal:4,role:'assistant',text:'Continuing with the selected option.',timestamp:new Date().toISOString()});state.detail=fixtureDetail;updateDetail();`,
  );
  check(
    'work after a choice appears below the selected answer',
    await c.evaluate(
      `(()=>{const entries=[...document.querySelectorAll('.chat-message')];return entries.at(-1).dataset.messageId==='after-choice'&&entries.findIndex(n=>n.querySelector('.chat-text').textContent==='Production')<entries.findIndex(n=>n.dataset.messageId==='after-choice');})()`,
    ),
  );
  await c.evaluate(`openDetail('workstation/t0')`);
  await wait(180);
  check(
    'reopening preserves the order of choice and subsequent work',
    await c.evaluate(
      `document.querySelector('.chat-message:last-child').dataset.messageId==='after-choice'&&document.querySelector('[data-delivery=sent] .chat-text').textContent==='Production'`,
    ),
  );
  await c.evaluate(
    `for(const id of ['repeat-one','repeat-two'])outbox.set(id,{id,address:state.selected,sessionId:state.chatSession,text:'Repeated local answer',afterOrdinal:3,state:'sent',sentAt:new Date().toISOString()});renderChat();`,
  );
  check(
    'identical local answers do not reconcile against each other',
    await c.evaluate(
      `[...document.querySelectorAll('.chat-text')].filter(n=>n.textContent==='Repeated local answer').length===2&&outbox.has('repeat-one')&&outbox.has('repeat-two')`,
    ),
  );
  await c.evaluate(
    `outbox.delete('repeat-one');outbox.delete('repeat-two');saveOutbox();renderChat();`,
  );
  await c.evaluate(
    `fixtureDetail.interaction={...fixtureDetail.interaction,id:'question-two',question:'A different question'};state.detail=fixtureDetail;updateDetail();`,
  );
  check(
    'new question clears the previous selection',
    await c.evaluate(
      `$('submit-choice').disabled&&![...document.querySelectorAll('.question-choice')].some(n=>n.getAttribute('aria-checked')==='true')`,
    ),
  );
  await c.evaluate(`fixtureDetail.interaction=null;`);
  await c.evaluate(
    `fixtureDetail.canSend=true;fixtureDetail.terminal.status.state='working';state.detail=fixtureDetail;state.detailError='연결 끊김';updateDetail();`,
  );
  check(
    'offline action stays unavailable',
    await c.evaluate(`$('send-message').disabled&&!$('detail-error').classList.contains('hidden')`),
  );
  await c.evaluate(
    `state.detailError='';state.detail=fixtureDetail;updateDetail();window.savedBubble=document.querySelector('.chat-message');updateDetail();`,
  );
  check(
    'unchanged chat keeps DOM',
    await c.evaluate(`savedBubble===document.querySelector('.chat-message')`),
  );
  await c.evaluate(
    `window.savedSession=state.chatSession;state.detail={...fixtureDetail,terminal:{...fixtureDetail.terminal,sessionId:null},conversation:{messages:[],unavailable:'session_unavailable'}};updateDetail();`,
  );
  check(
    'temporary session lookup failure preserves history and blocks send',
    await c.evaluate(
      `state.chatSession===savedSession&&savedBubble===document.querySelector('.chat-message')&&state.chatMessages.length>0&&$('send-message').disabled&&!$('detail-error').classList.contains('hidden')`,
    ),
  );
  await c.evaluate(`state.detail=fixtureDetail;state.detailError='';updateDetail();`);
  check(
    'session recovery clears stale notice without replacing chat',
    await c.evaluate(
      `savedBubble===document.querySelector('.chat-message')&&$('detail-error').classList.contains('hidden')&&!$('send-message').disabled`,
    ),
  );
  await c.evaluate(`fixtureDelay=100;openDetail('workstation/t0');openDetail('workstation/t1');`);
  await wait(280);
  check(
    'rapid switch loads final target',
    await c.evaluate(
      `state.detail.terminal.address===state.selected&&state.selected==='workstation/t1'`,
    ),
  );
  await command('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await c.evaluate(`closeDetail();openDetail('workstation/t0');`);
  check(
    'reduced motion removes transition',
    await c.evaluate(`reducedMotion.matches&&$('detail').getAnimations().length===0`),
  );
  await command('Emulation.setEmulatedMedia', { features: [] });
  for (const width of [320, 600, 840]) {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height: 800,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await c.evaluate(`closeDetail();render();window.scrollTo(0,0);`);
    check(
      'layout fits ' + width,
      await c.evaluate(`document.documentElement.scrollWidth<=innerWidth`),
    );
  }
  await command('Emulation.setDeviceMetricsOverride', {
    width: 360,
    height: 833,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await c.evaluate(`closeDetail();window.scrollTo(0,0);`);
  for (let i = 0; i < 12; i++) {
    await tap('.card');
    await wait(240);
    check(
      'touch opens detail ' + i,
      await c.evaluate(`!!state.selected&&!$('detail').classList.contains('hidden')`),
    );
    await tap('.detail-header button');
    await wait(240);
    check('touch returns to list ' + i, await c.evaluate(`!state.selected&&!$('app').hidden`));
  }
  await tap('.card');
  await wait(240);
  await c.evaluate(
    `state.detail={...fixtureDetail,terminal:{...fixtureDetail.terminal,status:{state:'working'}},conversation:{...fixtureDetail.conversation,activity:{label:'명령 실행',state:'running',timestamp:new Date().toISOString()}}};updateDetail();`,
  );
  check(
    'working activity follows chat',
    await c.evaluate(
      `!$('activity').classList.contains('hidden')&&$('activity').textContent.includes('명령 실행 중')&&$('activity').previousElementSibling===$('conversation')`,
    ),
  );
  await c.evaluate(`state.detail.terminal.status.state='done';updateDetail();`);
  check(
    'finished session hides activity',
    await c.evaluate(`$('activity').classList.contains('hidden')`),
  );
  await c.evaluate(`openDetail('workstation/t0')`);
  await wait(180);
  await c.evaluate(
    `fixtureDetail.canSend=true;fixtureResult='sent';fixturePostDelay=800;fixtureReceiptMissing=true;state.detail=fixtureDetail;state.detailError='';updateDetail();$('message-input').value='Delayed delivery';$('message-input').dispatchEvent(new Event('input'));window.requestsBefore=designRequests.filter(p=>p.path?.startsWith('/v1/receipt')).length;$('send-message').click();`,
  );
  await c.evaluate(`checkReceipt()`);
  check(
    'receipt polling waits for POST',
    await c.evaluate(
      `postFlight&&state.sendBusy&&designRequests.filter(p=>p.path?.startsWith('/v1/receipt')).length===requestsBefore`,
    ),
  );
  await c.evaluate(`postFlight=false;checkReceipt()`);
  check(
    'missing receipt is uncertain, never failed or restored',
    await c.evaluate(
      `$('message-input').value===''&&!document.querySelector('[data-delivery=failed] .chat-text')?.textContent.includes('Delayed delivery')&&[...outbox.values()].some(m=>m.text==='Delayed delivery'&&m.state==='unknown')`,
    ),
  );
  await wait(850);
  check(
    'late successful POST resolves uncertainty without resending',
    await c.evaluate(
      `designRequests.filter(p=>p.path==='/v1/message'&&p.body.text==='Delayed delivery').length===1&&[...outbox.values()].some(m=>m.text==='Delayed delivery'&&m.state==='sent')&&$('message-input').value===''`,
    ),
  );
  await c.evaluate(
    `closeDetail();state.tab='settings';render();$('language').value='en';$('language').dispatchEvent(new Event('change'));`,
  );
  check(
    'English setting translates connection fields',
    await c.evaluate(
      `document.documentElement.lang==='en'&&document.querySelector('h1').textContent==='Connection'&&$('server-token').placeholder==='Saved · enter to replace'`,
    ),
  );
  await c.evaluate(`state.tab='tasks';render();`);
  check(
    'English list labels and errors',
    await c.evaluate(
      `document.querySelector('.stat span').textContent==='Working'&&document.querySelector('.search input').placeholder==='Search'&&tr('receipt_missing')==='No delivery record yet.'`,
    ),
  );
  await c.evaluate(`openDetail('workstation/t0')`);
  await wait(180);
  check(
    'English conversation controls preserve source messages',
    await c.evaluate(
      `$('message-input').placeholder==='Message…'&&$('send-message').getAttribute('aria-label')==='Send message'&&state.chatMessages.some(m=>m.text==='상태 동기화를 확인해줘.')`,
    ),
  );
  await c.evaluate(
    `closeDetail();state.tab='settings';render();$('language').value='ko';$('language').dispatchEvent(new Event('change'));`,
  );
  check(
    'Korean language preference persists',
    await c.evaluate(
      `localStorage.getItem('pocket-language')==='ko'&&document.querySelector('h1').textContent==='연결 설정'`,
    ),
  );
  await c.evaluate(`state.tab='tasks';render();openDetail('workstation/t0')`);
  await wait(180);
  const diagramText =
    'Flow\n```mermaid\nflowchart TD\nA["시작"] --> B["완료"]\n```\nSequence\n```mermaid\nsequenceDiagram\nAlice->>Bob: Hello\n```\n```mermaid\nnot a diagram\n```';
  await c.evaluate(
    `window.diagramText=${JSON.stringify(diagramText)};state.chatMessages.push({id:'diagrams',ordinal:300,role:'assistant',text:diagramText});updateDetail();document.querySelector('[data-id="diagrams"]')?.scrollIntoView();`,
  );
  // Reveal each block so the lazy renderer can process it.
  for (let i = 0; i < 3; i++) {
    await c.evaluate(
      `document.querySelectorAll('.mermaid-block')[${i}].scrollIntoView({block:'center'})`,
    );
    for (let j = 0; j < 150; j++) {
      if (await c.evaluate(`!!document.querySelectorAll('.mermaid-block')[${i}].dataset.rendered`))
        break;
      await wait(100);
    }
  }
  await wait(100);
  check(
    'flowchart and sequence render as local images',
    await c.evaluate(
      `document.querySelectorAll('.mermaid-image').length===2&&[...document.querySelectorAll('.mermaid-image')].every(n=>n.complete&&n.naturalWidth>0&&n.src.startsWith('data:image/svg+xml'))`,
    ),
  );
  check(
    'invalid Mermaid preserves source without leftover render markup',
    await c.evaluate(
      `document.querySelector('[data-rendered="error"] details').open&&!document.querySelector('.diagram-scratch')`,
    ),
  );
  check(
    'diagrams do not overflow the viewport',
    await c.evaluate(`document.documentElement.scrollWidth<=innerWidth`),
  );
  await c.evaluate(
    `window.savedDiagram=document.querySelector('.mermaid-image');updateDetail();savedDiagram.closest('.chat-message').querySelector('.copy-message').click()`,
  );
  await wait(70);
  check(
    'refresh preserves diagram and copy preserves original fences',
    await c.evaluate(
      `savedDiagram===document.querySelector('.mermaid-image')&&designRequests.filter(r=>r.method==='copy').at(-1).text===diagramText&&document.querySelectorAll('script[src="vendor/mermaid.min.js"]').length===1`,
    ),
  );
  await c.evaluate(`savedDiagram.scrollIntoView({block:'start'})`);
  shot = await command('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    resolve(root, 'artifacts/design-demo-mermaid.png'),
    Buffer.from(shot.data, 'base64'),
  );
  const plainCode =
    'Before\n```text\n  <b>literal</b>\n    indented\n' + 'long '.repeat(100) + '\n```\nAfter';
  await c.evaluate(
    `window.plainCode=${JSON.stringify(plainCode)};state.chatMessages.push({id:'code-check',ordinal:301,role:'assistant',text:plainCode});updateDetail();document.querySelector('[data-message-id="code-check"]').scrollIntoView({block:'center'})`,
  );
  check(
    'text fences show literal code with preserved indentation',
    await c.evaluate(
      `(()=>{const n=document.querySelector('[data-message-id="code-check"]');return n.querySelector('pre code').textContent===plainCode.split('\\n').slice(2,-2).join('\\n')&&!n.querySelector('b')&&!n.textContent.includes('\x60\x60\x60text')&&getComputedStyle(n.querySelector('pre')).whiteSpace==='pre'&&document.documentElement.scrollWidth<=innerWidth;})()`,
    ),
  );
  await c.evaluate(
    `document.querySelector('[data-message-id="code-check"] .copy-message').click()`,
  );
  await wait(70);
  check(
    'code copy keeps original fences',
    await c.evaluate(`designRequests.filter(r=>r.method==='copy').at(-1).text===plainCode`),
  );
  const boldText = '**굵게** 일반 **B** **<img src=x>**\n```text\n**literal**\n```';
  await c.evaluate(
    `window.boldText=${JSON.stringify(boldText)};state.chatMessages.push({id:'bold-check',ordinal:302,role:'assistant',text:boldText});updateDetail();document.querySelector('[data-message-id="bold-check"]').scrollIntoView({block:'center'})`,
  );
  check(
    'bold emphasis renders safely outside code',
    await c.evaluate(
      `(()=>{const n=document.querySelector('[data-message-id="bold-check"]');return [...n.querySelectorAll('strong')].map(s=>s.textContent).join('|')==='굵게|B|<img src=x>'&&n.querySelector('pre').textContent==='**literal**'&&!n.querySelector('img')&&Number(getComputedStyle(n.querySelector('strong')).fontWeight)>=600;})()`,
    ),
  );
  await c.evaluate(
    `document.querySelector('[data-message-id="bold-check"] .copy-message').click()`,
  );
  await wait(70);
  check(
    'bold copy preserves Markdown markers',
    await c.evaluate(`designRequests.filter(r=>r.method==='copy').at(-1).text===boldText`),
  );
  const linkText =
    '[Guide](https://example.com/guide?q=1&x=2) **[Bold](https://example.com/bold)**\nhttps://example.com/plain.\n[Image](file:///workspace/demo/preview.png) [Notes](docs/notes.md)\n`https://example.com/code`\n```text\nhttps://example.com/fenced\n```\n[unsafe](javascript:alert(1))';
  await c.evaluate(
    `fixtureDelay=20;window.linkText=${JSON.stringify(linkText)};state.chatMessages.push({id:'link-check',ordinal:303,role:'assistant',text:linkText,media:[{id:'1'.repeat(64),kind:'image',name:'preview.png',path:'/workspace/demo/preview.png'}]});renderChat();document.querySelector('[data-message-id="link-check"]').scrollIntoView({block:'start'})`,
  );
  check(
    'web and Markdown links render without activating code or unsafe schemes',
    await c.evaluate(
      `(()=>{const n=document.querySelector('[data-message-id="link-check"]');return n.querySelectorAll('a').length===5&&!!n.querySelector('strong a')&&!n.querySelector('code a')&&n.querySelector('pre').textContent==='https://example.com/fenced'&&n.textContent.includes('[unsafe](javascript:alert(1))');})()`,
    ),
  );
  await tap('[data-message-id="link-check"] a');
  await wait(80);
  check(
    'link touch delegates the URL to native without navigating the WebView',
    await c.evaluate(
      `designRequests.filter(r=>r.method==='openLink').at(-1).url==='https://example.com/guide?q=1&x=2'&&location.pathname==='/'`,
    ),
  );
  await c.evaluate(`document.querySelectorAll('[data-message-id="link-check"] a')[3].click()`);
  check(
    'local image link opens its authenticated preview',
    await c.evaluate(
      `!!document.querySelector('.media-viewer')?.open&&document.querySelector('.media-full').src.endsWith('/'+'1'.repeat(64))`,
    ),
  );
  await c.evaluate(
    `closeMediaViewer();document.querySelectorAll('[data-message-id="link-check"] a')[4].click()`,
  );
  await wait(80);
  check(
    'other local file links copy the path',
    await c.evaluate(
      `designRequests.filter(r=>r.method==='copy').at(-1).text==='docs/notes.md'&&$('toast').textContent===tr('path_copied')`,
    ),
  );
  await c.evaluate(
    `document.querySelector('[data-message-id="link-check"] .copy-message').click()`,
  );
  await wait(80);
  check(
    'message copy preserves original link Markdown',
    await c.evaluate(`designRequests.filter(r=>r.method==='copy').at(-1).text===linkText`),
  );
  await c.evaluate(`fixtureDelay=20;closeDetail();state.tab='settings';render()`);
  await wait(70);
  await c.evaluate(`$('push-toggle').click()`);
  await wait(100);
  check(
    'notification setup reports missing Firebase without enabling',
    await c.evaluate(
      `$('toast').textContent===tr('push_not_configured')&&!fixturePush.enabled&&!pushBusy`,
    ),
  );
  await c.evaluate(`fixturePushAvailable=true;$('push-toggle').click();$('push-toggle').click()`);
  await wait(160);
  check(
    'notification toggle enables once and shows actual status',
    await c.evaluate(
      `fixturePush.enabled&&$('push-state').textContent===tr('push_enabled')&&designRequests.filter(r=>r.method==='push'&&r.enabled).length===1`,
    ),
  );
  await c.evaluate(`$('push-toggle').click()`);
  await wait(100);
  check(
    'notification toggle disables',
    await c.evaluate(`!fixturePush.enabled&&$('push-state').textContent===tr('push_disabled')`),
  );
  await c.evaluate(`state.tab='tasks';render();openDetail('workstation/t1')`);
  await wait(100);
  await c.evaluate(
    `fixtureNotification='11111111-1111-4111-8111-111111111111';fixtureResolveFail=true;pocketOpenNotification()`,
  );
  await wait(100);
  check(
    'offline notification intent is retained for reconnection',
    await c.evaluate(
      `!!queuedNotification&&!!fixtureNotification&&state.selected==='workstation/t1'`,
    ),
  );
  await c.evaluate(`fixtureResolveFail=false;pocketOpenNotification()`);
  await wait(180);
  check(
    'notification opens its session and acknowledges only after resolution',
    await c.evaluate(
      `state.selected==='workstation/t0'&&!fixtureNotification&&!queuedNotification`,
    ),
  );
  check(
    'visible session is sent to native notification suppression',
    await c.evaluate(
      `designRequests.filter(r=>r.method==='pushContext').at(-1).visibleKey==='11111111-1111-4111-8111-111111111111'`,
    ),
  );
  await c.evaluate(`state.chatMessages.push({id:'media-check',ordinal:900,role:'assistant',text:'Media samples',media:[
    {id:'1'.repeat(64),kind:'image',name:'image.png'},
    {id:'2'.repeat(64),kind:'audio',name:'sound.wav'},
    {id:'3'.repeat(64),kind:'video',name:'clip.mp4'}]});renderChat();document.querySelector('.media-card').scrollIntoView({block:'center'})`);
  await wait(400);
  check(
    'image preview loads and media controls fit the viewport',
    await c.evaluate(
      `document.querySelector('.media-card img').naturalWidth>0&&document.querySelector('audio').controls&&document.querySelector('video').controls&&!document.querySelector('video').autoplay&&document.querySelector('video').preload==='none'&&document.documentElement.scrollWidth<=innerWidth`,
    ),
  );
  await tap('.media-open');
  check(
    'image viewer opens and Back closes only the viewer',
    await c.evaluate(
      `document.querySelector('.media-viewer').open&&pocketBack()&&!document.querySelector('.media-viewer')&&!!state.selected`,
    ),
  );
  await c.evaluate(
    `window.savedPlayer=document.querySelector('audio');savedPlayer.muted=true;savedPlayer.play()`,
  );
  await wait(300);
  check(
    'audio plays and refresh preserves the player',
    await c.evaluate(
      `(()=>{renderChat();return savedPlayer===document.querySelector('audio')&&!savedPlayer.paused&&savedPlayer.currentTime>0;})()`,
    ),
  );
  await c.evaluate(`pauseMedia()`);
  check('background pause stops audio', await c.evaluate(`savedPlayer.paused`));
  await c.evaluate(`document.querySelector('video').load()`);
  await wait(300);
  check(
    'missing or unsupported media offers retry',
    await c.evaluate(
      `!document.querySelector('.media-video .media-retry').hidden&&document.querySelector('.media-video .media-status').textContent===tr('media_failed')`,
    ),
  );
  await c.evaluate(`closeDetail()`);
  check('closing conversation stops playback', await c.evaluate(`savedPlayer.paused`));
  await c.evaluate(
    `fixtureTerminals[0].agent='cursor';fixtureTerminals[0].status={app:'cursor',state:'working'};fixtureDetail.canSend=false;openDetail('workstation/t0')`,
  );
  await wait(200);
  check(
    'Cursor working chat shows its agent and blocks new input',
    await c.evaluate(
      `agentLabel(agentOf(state.detail.terminal))==='Cursor'&&!$('activity').classList.contains('hidden')&&$('send-message').disabled`,
    ),
  );
  await c.evaluate(
    `fixtureTerminals[0].status.state='done';fixtureDetail.canSend=true;state.detail={...state.detail,canSend:true};$('message-input').value='follow up';updateDetail()`,
  );
  check(
    'Cursor completed chat accepts a follow-up',
    await c.evaluate(`!$('send-message').disabled`),
  );
  check('no runtime errors', await c.evaluate(`designErrors.length===0`));
  console.log(JSON.stringify({ checks }, null, 2));
  writeFileSync(resolve(root, 'artifacts/design-checks.json'), JSON.stringify({ checks }, null, 2));
  if (process.argv.includes('--screenshots')) {
    const { captureExamples } = await import('./example-screenshots.mjs');
    await captureExamples(c, root);
  }
} finally {
  c?.close();
  chrome.kill();
  server.close();
}
