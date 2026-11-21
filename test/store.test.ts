import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFluviaClient } from '../src/index.ts';
import { createFluviaStore } from '../src/store.ts';
import { ACCOUNT, WALLET, fakeEnv, flush, memoryStorage, wallet } from './helpers.ts';

function setup(storage = memoryStorage()) {
  const browser = fakeEnv();
  const client = createFluviaClient({ walletOrigin: WALLET, env: browser.env, storage });
  return { browser, client, store: createFluviaStore(client) };
}

function approveConnect(browser: ReturnType<typeof fakeEnv>, id: string) {
  browser.deliver(wallet.ready());
  browser.deliver(wallet.event('statusChanged', { connection: { isConnected: true, isNetworkConnected: true } }));
  browser.deliver(wallet.event('accountsChanged', [ACCOUNT]));
  browser.deliver(wallet.result(id, { isConnected: true, isNetworkConnected: true }));
}

const DISCONNECTED = { isConnected: false, isConnecting: false, account: null, networkId: null, error: null };

test('starts disconnected without a session, connected with a stored one', () => {
  assert.deepEqual(setup().store.getSnapshot(), DISCONNECTED);

  const storage = memoryStorage();
  storage.setItem(`fluvia-sdk.session:${WALLET}`, JSON.stringify({ account: ACCOUNT, networkId: 'canton:da-mainnet', connectedAt: 1 }));
  assert.deepEqual(setup(storage).store.getSnapshot(), {
    isConnected: true,
    isConnecting: false,
    account: ACCOUNT,
    networkId: 'canton:da-mainnet',
    error: null,
  });
});

test('connect opens the popup in the same tick, shows connecting, then the account', async () => {
  const { browser, store } = setup();
  const pending = store.connect();
  assert.equal(browser.popups.length, 1, 'popup opened before any await');
  assert.equal(store.getSnapshot().isConnecting, true);

  approveConnect(browser, 'rid-1');
  await pending;
  assert.deepEqual(store.getSnapshot(), {
    isConnected: true,
    isConnecting: false,
    account: ACCOUNT,
    networkId: 'canton:da-mainnet',
    error: null,
  });
});

test('a rejected connect keeps the error and ends connecting, without throwing at the caller', async () => {
  const { browser, store } = setup();
  const pending = store.connect();
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-1', 4001, 'The connection was rejected in Fluvia.'));
  await pending;

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.isConnected, false);
  assert.equal(snapshot.isConnecting, false);
  assert.equal(snapshot.error?.code, 4001);
});

test('a new connect clears the previous error', async () => {
  const { browser, store } = setup();
  const first = store.connect();
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-1', 4001, 'no'));
  await first;

  const second = store.connect();
  assert.equal(store.getSnapshot().error, null);
  approveConnect(browser, 'rid-2');
  await second;
});

test('disconnect, and a 4100 from the wallet, both bring the snapshot back to disconnected', async () => {
  const { browser, client, store } = setup();
  const connecting = store.connect();
  approveConnect(browser, 'rid-1');
  await connecting;

  await store.disconnect();
  assert.deepEqual(store.getSnapshot(), DISCONNECTED);

  const again = store.connect();
  approveConnect(browser, 'rid-2');
  await again;
  const signing = client.signMessage('x').catch(() => {});
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-3', 4100, 'Not connected'));
  await signing;
  assert.deepEqual(store.getSnapshot(), DISCONNECTED);
});

test('listeners hear changes until they unsubscribe', async () => {
  const { browser, store } = setup();
  let calls = 0;
  const unsubscribe = store.subscribe(() => (calls += 1));
  const pending = store.connect();
  approveConnect(browser, 'rid-1');
  await pending;
  assert.ok(calls > 0);

  const before = calls;
  unsubscribe();
  await store.disconnect();
  assert.equal(calls, before);
});

// useSyncExternalStore re-renders forever if getSnapshot returns a new object for the same state.
test('getSnapshot returns the same object while nothing changed', async () => {
  const { browser, store } = setup();
  assert.equal(store.getSnapshot(), store.getSnapshot());
  const pending = store.connect();
  approveConnect(browser, 'rid-1');
  await pending;
  await flush();
  assert.equal(store.getSnapshot(), store.getSnapshot());
});
