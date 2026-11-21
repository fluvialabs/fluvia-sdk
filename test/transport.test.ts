import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callWallet } from '../src/popup-transport.ts';
import { FluviaRpcError, USER_REJECTED } from '../src/errors.ts';
import { DAPP, WALLET, fakeEnv, flush, wallet } from './helpers.ts';

test('opens /dapp with this page origin and a request id, sends the request once the popup is ready', async () => {
  const browser = fakeEnv();
  const pending = callWallet(browser.env, WALLET, 'signMessage', { message: 'hi' });

  const popup = browser.popups[0];
  assert.equal(popup.url, `${WALLET}/dapp?origin=${encodeURIComponent(DAPP)}&rid=rid-1`);
  assert.equal(popup.received.length, 0, 'nothing is sent before the popup says ready');

  browser.deliver(wallet.ready());
  assert.deepEqual(popup.received, [
    { message: { source: 'fluvia-dapp', v: 1, id: 'rid-1', method: 'signMessage', params: { message: 'hi' } }, targetOrigin: WALLET },
  ]);

  browser.deliver(wallet.result('rid-1', 'sig'));
  assert.equal(await pending, 'sig');
  assert.equal(browser.listening, false, 'the message listener is removed once answered');
});

test('omits params when the method has none', async () => {
  const browser = fakeEnv();
  const pending = callWallet(browser.env, WALLET, 'connect');
  browser.deliver(wallet.ready());
  assert.deepEqual(browser.popups[0].received[0].message, { source: 'fluvia-dapp', v: 1, id: 'rid-1', method: 'connect' });
  browser.deliver(wallet.result('rid-1', { isConnected: true }));
  await pending;
});

// The popup page announces ready from a React effect; a second announcement must not replay the
// request into a fresh gate (a second approval prompt, or a second transaction).
test('sends the request only once even if the popup announces ready twice', async () => {
  const browser = fakeEnv();
  const pending = callWallet(browser.env, WALLET, 'prepareExecute', { commands: [{}] });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.ready());
  assert.equal(browser.popups[0].received.length, 1);
  browser.deliver(wallet.result('rid-1', null));
  await pending;
});

test('rejects with the wallet error, keeping its code and data', async () => {
  const browser = fakeEnv();
  const pending = callWallet(browser.env, WALLET, 'prepareExecute', { commands: [{}] });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-1', -32603, 'Cooldown Send/Swap. Try again in 120s.', { errorCode: 'TX_COOLDOWN_ACTIVE' }));

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof FluviaRpcError);
    assert.equal(error.code, -32603);
    assert.equal(error.message, 'Cooldown Send/Swap. Try again in 120s.');
    assert.deepEqual(error.data, { errorCode: 'TX_COOLDOWN_ACTIVE' });
    return true;
  });
});

test('passes wallet events to the caller while waiting', async () => {
  const browser = fakeEnv();
  const seen: unknown[] = [];
  const pending = callWallet(browser.env, WALLET, 'prepareExecuteAndWait', { commands: [{}] }, (event, payload) => seen.push([event, payload]));
  browser.deliver(wallet.ready());
  browser.deliver(wallet.event('txChanged', { status: 'pending', commandId: 'c1' }));
  browser.deliver(wallet.result('rid-1', { tx: { status: 'executed' } }));
  await pending;
  assert.deepEqual(seen, [['txChanged', { status: 'pending', commandId: 'c1' }]]);
});

test('ignores messages from another origin, another window, another request or another envelope', async () => {
  const browser = fakeEnv();
  let settled = false;
  const pending = callWallet(browser.env, WALLET, 'connect').finally(() => (settled = true));
  browser.deliver(wallet.ready());

  browser.deliver(wallet.result('rid-1', 'evil'), { origin: 'https://evil.example' });
  browser.deliver(wallet.result('rid-1', 'evil'), { source: { other: 'window' } });
  browser.deliver(wallet.result('rid-2', 'other request'));
  browser.deliver({ ...wallet.result('rid-1', 'old protocol'), v: 2 });
  browser.deliver({ ...wallet.result('rid-1', 'spoofed'), source: 'fluvia-dapp' });
  browser.deliver('not an object');
  await flush();
  assert.equal(settled, false);

  browser.deliver(wallet.result('rid-1', 'ok'));
  assert.equal(await pending, 'ok');
});

test('a popup closed before answering rejects as a user rejection', async () => {
  const browser = fakeEnv();
  const pending = callWallet(browser.env, WALLET, 'connect');
  browser.deliver(wallet.ready());
  browser.popups[0].closed = true;
  browser.tick();

  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof FluviaRpcError);
    assert.equal(error.code, USER_REJECTED);
    assert.deepEqual(error.data, { errorCode: 'FLUVIA_POPUP_CLOSED' });
    return true;
  });
  assert.equal(browser.listening, false);
});

// Signing in or setting up a passkey can take minutes on a phone: only closing the tab ends it.
test('keeps waiting while the popup stays open, however many checks pass', async () => {
  const browser = fakeEnv();
  let settled = false;
  const pending = callWallet(browser.env, WALLET, 'connect').finally(() => (settled = true));
  for (let i = 0; i < 1000; i += 1) browser.tick();
  await flush();
  assert.equal(settled, false);
  browser.deliver(wallet.ready());
  browser.deliver(wallet.result('rid-1', { isConnected: true }));
  await pending;
});

test('a blocked popup rejects at once with a reason the dApp can show', async () => {
  const browser = fakeEnv({ blockPopups: true });
  await assert.rejects(callWallet(browser.env, WALLET, 'connect'), (error: unknown) => {
    assert.ok(error instanceof FluviaRpcError);
    assert.deepEqual(error.data, { errorCode: 'FLUVIA_POPUP_BLOCKED' });
    assert.match(error.message, /popup/i);
    return true;
  });
  assert.equal(browser.listening, false);
});
