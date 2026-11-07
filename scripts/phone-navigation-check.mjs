import { connect } from './phone-cdp.mjs';
import { writeFileSync } from 'node:fs';
const c = await connect();
const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function tap(selector) {
  const point = await c.evaluate(
    `(()=>{const n=document.querySelector(${JSON.stringify(selector)}),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)})===n};})()`,
  );
  if (!point.hit) throw Error('Hit target missed: ' + selector);
  await c.command('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y }],
  });
  await c.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
try {
  await c.evaluate(
    `if(state.selected)closeDetail();state.tab='tasks';state.machine='all';state.filter='all';render();window.scrollTo(0,0);window.navigationErrors=[];addEventListener('error',e=>navigationErrors.push(e.message));`,
  );
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) {
      await tap('.stat.working');
      await wait(120);
    }
    await tap('.card');
    await wait(250);
    const opened = await c.evaluate(
      `!!state.selected&&!$('detail').classList.contains('hidden')&&$('app').hidden`,
    );
    if (!opened) throw Error('Touch did not open session ' + i);
    for (let n = 0; n < 25; n++) {
      if (await c.evaluate(`!!state.detail`)) break;
      await wait(100);
    }
    results.push(
      await c.evaluate(
        `({selected:state.selected,loaded:!!state.detail,role:state.chatMessages.at(-1)?.role,messages:state.chatMessages.length,activity:$('activity').textContent,activityVisible:!$('activity').classList.contains('hidden')})`,
      ),
    );
    await tap('.detail-header button');
    await wait(250);
    if (!(await c.evaluate(`!state.selected&&!$('app').hidden`)))
      throw Error('Touch did not return ' + i);
  }
  await tap('.card');
  await wait(800);
  await c.evaluate(`$('detail-body').scrollTop=$('detail-body').scrollHeight`);
  const errors = await c.evaluate(`navigationErrors`);
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log(JSON.stringify({ cycles: results.length, results, errors }, null, 2));
  writeFileSync(
    'artifacts/navigation-checks.json',
    JSON.stringify({ cycles: results.length, results, errors }, null, 2),
  );
} finally {
  c.close();
}
