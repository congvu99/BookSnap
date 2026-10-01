// Counter of in-flight "foreground" requests (ones the user is waiting on). Pure module: no DOM,
// no Preact, so it can be unit-tested in node. The top progress bar subscribes to it.

let pending = 0;
const listeners = new Set();

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn(pending);
    } catch (err) {
      console.error('network-activity listener failed', err);
    }
  }
}

/** Mark one request as started. Returns an idempotent `end()` to call when it settles. */
export function begin() {
  pending += 1;
  notify();
  let ended = false;
  return function end() {
    if (ended) return;
    ended = true;
    pending -= 1;
    notify();
  };
}

/** @param {(count:number)=>void} fn @returns {() => void} unsubscribe */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingCount() {
  return pending;
}
