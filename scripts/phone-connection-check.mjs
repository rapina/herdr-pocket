import assert from 'node:assert/strict';
import { connect } from './phone-cdp.mjs';
const c = await connect();
try {
  await c.evaluate('closeDetail()');
  const deadline = Date.now() + 30000;
  const wantOnline = process.argv[2] !== 'offline';
  let result;
  do {
    await c.evaluate('refresh()');
    result = await c.evaluate(
      '({online:state.online,configured:state.config.configured,count:state.snapshot?.terminals.length||0,error:state.error,staleBanner:!!document.querySelector("#list-error:not(.hidden)")})',
    );
    if (result.online === wantOnline) break;
    await new Promise((r) => setTimeout(r, 500));
  } while (Date.now() < deadline);
  assert.equal(result.online, wantOnline);
  assert.equal(result.configured, true);
  if (!wantOnline) {
    assert.ok(result.count > 0);
    assert.equal(result.staleBanner, true);
  } else assert.ok(result.count > 0);
  console.log(wantOnline ? 'RECONNECTED' : 'OFFLINE WITH STALE BANNER', result);
} finally {
  c.close();
}
