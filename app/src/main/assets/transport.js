let nativeId = 0;
const pending = new Map();
window.pocketReply = (id, response) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timeout);
  response.ok
    ? p.resolve(response.data)
    : p.reject(
        Object.assign(new Error(tr(response.error)), {
          code: response.error,
          status: response.status || 0,
        }),
      );
};
function native(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++nativeId);
    const timeout = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error(tr('timeout')));
      },
      method === 'push' ? 90000 : 35000,
    );
    pending.set(id, { resolve, reject, timeout });
    if (!window.PocketNative) {
      clearTimeout(timeout);
      pending.delete(id);
      reject(new Error(tr('android_only')));
      return;
    }
    window.PocketNative.call(id, method, JSON.stringify(payload));
  });
}
const api = (path, body) =>
  native('request', { path, method: body ? 'POST' : 'GET', ...(body ? { body } : {}) });
