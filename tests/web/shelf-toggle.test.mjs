import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ShelfSync } from '../../web/js/shelf-sync.js';

/** send() whose calls resolve/reject on demand; tracks concurrency. */
function controlledSend() {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const send = (on) =>
    new Promise((resolve, reject) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({
        on,
        resolve: () => ((inFlight -= 1), resolve()),
        reject: (e) => ((inFlight -= 1), reject(e)),
      });
    });
  return { send, calls, max: () => maxInFlight };
}
const tick = () => new Promise((r) => setImmediate(r));

test('toggle flips immediately and sends once', async () => {
  const c = controlledSend();
  const s = new ShelfSync(c.send);
  s.toggle();
  assert.equal(s.shown, true);
  assert.deepEqual(c.calls.map((x) => x.on), [true]);
  c.calls[0].resolve();
  await tick();
  assert.equal(s.shown, true);
  assert.equal(s.confirmed, true);
});

test('rapid taps keep one request in flight and settle on the last wish', async () => {
  const c = controlledSend();
  const s = new ShelfSync(c.send);
  s.toggle(); // on
  s.toggle(); // off
  s.toggle(); // on
  assert.equal(s.shown, true);
  assert.equal(c.calls.length, 1);
  c.calls[0].resolve();
  await tick();
  assert.equal(c.max(), 1);
  assert.equal(s.shown, true);
  assert.equal(c.calls.length, 1); // wish already matches confirmed: nothing more to send
});

test('on then off sends PUT then DELETE sequentially', async () => {
  const c = controlledSend();
  const s = new ShelfSync(c.send);
  s.toggle();
  s.toggle();
  assert.equal(s.shown, false);
  c.calls[0].resolve();
  await tick();
  assert.deepEqual(c.calls.map((x) => x.on), [true, false]);
  c.calls[1].resolve();
  await tick();
  assert.equal(c.max(), 1);
  assert.equal(s.confirmed, false);
  assert.equal(s.shown, false);
});

test('failure rolls back to the confirmed state and reports', async () => {
  const c = controlledSend();
  const errors = [];
  const shownLog = [];
  const s = new ShelfSync(c.send, { onChange: (v) => shownLog.push(v), onError: (e) => errors.push(e) });
  s.setServer(false);
  s.toggle();
  c.calls[0].reject(new Error('boom'));
  await tick();
  assert.equal(s.shown, false);
  assert.equal(errors.length, 1);
  assert.equal(shownLog.at(-1), false);
});

test('stale server value does not override a pending wish', async () => {
  const c = controlledSend();
  const s = new ShelfSync(c.send);
  s.setServer(false);
  s.toggle();
  s.setServer(false); // stale poll started before the PUT
  assert.equal(s.shown, true);
  c.calls[0].resolve();
  await tick();
  assert.equal(s.shown, true);
});

test('server value applies when nothing is pending', () => {
  const s = new ShelfSync(() => Promise.resolve());
  s.setServer(true);
  assert.equal(s.shown, true);
});
