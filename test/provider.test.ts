import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluviaProvider } from '../src/provider.ts';
import { FluviaRpcError, UNAUTHORIZED } from '../src/errors.ts';
import { ACCOUNT, WALLET, fakeEnv, flush, memoryStorage, wallet } from './helpers.ts';

function setup() {
  const browser = fakeEnv();
  const storage = memoryStorage();
  const provider = new FluviaProvider({ walletOrigin: WALLET, env: browser.env, storage });
  return { browser, storage, provider };
}

/** Answers the latest popup the way the Fluvia wallet answers `connect`. */
async function approveConnect(browser: ReturnType<typeof fakeEnv>, id: string) {
  browser.deliver(wallet.ready());
  browser.deliver(wallet.event('statusChanged', { connection: { isConnected: true, isNetworkConnected: true } }));
  browser.deliver(wallet.event('accountsChanged', [ACCOUNT]));
  browser.deliver(wallet.result(id, { isConnected: true, isNetworkConnected: true }));
  await flush();
}

async function connected() {
  const ctx = setup();
  const pending = ctx.provider.request({ method: 'connect' });
  await approveConnect(ctx.browser, 'rid-1');
  await pending;
  return ctx;
}

test('before connecting, status answers locally and account reads refuse with 4100, all without a popup', async () => {
  const { browser, provider } = setup();

  assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });
  const status: any = await provider.request({ method: 'status' });
  assert.equal(status.connection.isConnected, false);
  assert.equal(status.provider.id, 'fluvia');

  for (const method of ['listAccounts', 'getPrimaryAccount', 'getActiveNetwork']) {
    await assert.rejects(provider.request({ method }), (e: any) => e instanceof FluviaRpcError && e.code === UNAUTHORIZED, method);
  }
  assert.equal(browser.popups.length, 0);
});

test('connect opens one popup and remembers the account the wallet announces', async () => {
  const { browser, provider } = await connected();
  assert.equal(browser.popups.length, 1);

  assert.deepEqual(await provider.request({ method: 'getPrimaryAccount' }), ACCOUNT);
  assert.deepEqual(await provider.request({ method: 'listAccounts' }), [ACCOUNT]);
  assert.deepEqual(await provider.request({ method: 'getActiveNetwork' }), { networkId: 'canton:da-mainnet' });
  assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: true, isNetworkConnected: true });
  const status: any = await provider.request({ method: 'status' });
  assert.equal(status.connection.isConnected, true);
  assert.deepEqual(status.network, { networkId: 'canton:da-mainnet' });
  assert.equal(browser.popups.length, 1, 'reads after connect never open a popup');
});

test('the session survives a page reload (a new provider on the same storage)', async () => {
  const { browser, storage } = await connected();
  const reloaded = new FluviaProvider({ walletOrigin: WALLET, env: browser.env, storage });
  assert.deepEqual(await reloaded.request({ method: 'getPrimaryAccount' }), ACCOUNT);
  assert.equal(browser.popups.length, 1);
});

test('sessions are kept per wallet origin', async () => {
  const { browser, storage } = await connected();
  const local = new FluviaProvider({ walletOrigin: 'http://localhost:5173', env: browser.env, storage });
  assert.deepEqual(await local.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });
});

// Safari private mode and blocked site data make storage throw; the dApp must still work for this page.
test('a storage that refuses writes keeps the session for this page', async () => {
  const browser = fakeEnv();
  const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
  const provider = new FluviaProvider({ walletOrigin: WALLET, env: browser.env, storage });
  const pending = provider.request({ method: 'connect' });
  await approveConnect(browser, 'rid-1');
  await pending;
  assert.deepEqual(await provider.request({ method: 'getPrimaryAccount' }), ACCOUNT);
});

test('storage: null keeps the session for this page only', async () => {
  const browser = fakeEnv();
  const provider = new FluviaProvider({ walletOrigin: WALLET, env: browser.env, storage: null });
  const pending = provider.request({ method: 'connect' });
  await approveConnect(browser, 'rid-1');
  await pending;
  assert.deepEqual(await provider.request({ method: 'getPrimaryAccount' }), ACCOUNT);

  const reloaded = new FluviaProvider({ walletOrigin: WALLET, env: browser.env, storage: null });
  assert.deepEqual(await reloaded.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });

  await provider.request({ method: 'disconnect' });
  assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });
});

test('ignores a stored session that is not valid JSON or has no account', async () => {
  const { browser, storage } = setup();
  for (const raw of ['not json', '{}', JSON.stringify({ account: null }), JSON.stringify({ account: { partyId: 42 } })]) {
    storage.map.clear();
    storage.setItem(`fluvia-sdk.session:${WALLET}`, raw);
    const provider = new FluviaProvider({ walletOrigin: WALLET, env: browser.env, storage });
    assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true }, raw);
  }
});

test('listeners get the wallet events from the popup', async () => {
  const { browser, provider } = setup();
  const seen: string[] = [];
  provider.on('statusChanged', () => seen.push('statusChanged'));
  provider.on('accountsChanged', () => seen.push('accountsChanged'));
  const pending = provider.request({ method: 'connect' });
  await approveConnect(browser, 'rid-1');
  await pending;
  assert.deepEqual(seen, ['statusChanged', 'accountsChanged']);
});

test('signing calls go to the popup and return the wallet answer', async () => {
  const { browser, provider } = await connected();
  const pending = provider.request({ method: 'signMessage', params: { message: 'hello' } });
  browser.deliver(wallet.ready());
  assert.deepEqual(browser.popups[1].received[0].message.params, { message: 'hello' });
  browser.deliver(wallet.result('rid-2', 'sig'));
  assert.equal(await pending, 'sig');
});

// The user removed this dApp in Fluvia: the next call that reaches the wallet says 4100, and the
// dApp must stop believing it is connected.
test('a 4100 from the wallet clears the session and tells listeners', async () => {
  const { browser, provider } = await connected();
  const events: Array<[string, unknown]> = [];
  provider.on('statusChanged', (p) => events.push(['statusChanged', p]));
  provider.on('accountsChanged', (p) => events.push(['accountsChanged', p]));

  const pending = provider.request({ method: 'prepareExecute', params: { commands: [{}] } });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-2', UNAUTHORIZED, 'Not connected'));
  await assert.rejects(pending, (e: any) => e.code === UNAUTHORIZED);

  assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });
  assert.deepEqual(events.map(([name]) => name), ['statusChanged', 'accountsChanged']);
  assert.deepEqual(events[1][1], []);
});

test('other wallet errors leave the session alone', async () => {
  const { browser, provider } = await connected();
  const pending = provider.request({ method: 'prepareExecute', params: { commands: [{}] } });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-2', 4001, 'The transaction was rejected in Fluvia.'));
  await assert.rejects(pending, (e: any) => e.code === 4001);
  assert.deepEqual(await provider.request({ method: 'getPrimaryAccount' }), ACCOUNT);
});

// A popup needs a click; dApps also call disconnect on logout or timers, where it would be blocked.
test('disconnect is local: forgets the session and tells listeners, no popup', async () => {
  const { browser, provider } = await connected();
  const events: string[] = [];
  provider.on('statusChanged', () => events.push('statusChanged'));
  provider.on('accountsChanged', () => events.push('accountsChanged'));

  assert.equal(await provider.request({ method: 'disconnect' }), null);
  assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });
  assert.deepEqual(events, ['statusChanged', 'accountsChanged']);
  assert.equal(browser.popups.length, 1, 'only the connect popup was ever opened');
});

test('hasSession reports the stored session', async () => {
  const { provider } = setup();
  assert.equal(provider.hasSession(), false);
  const ctx = await connected();
  assert.equal(ctx.provider.hasSession(), true);
});

test('a connect that brings no account fails instead of pretending to be connected', async () => {
  const { browser, provider } = setup();
  const pending = provider.request({ method: 'connect' });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.result('rid-1', { isConnected: true, isNetworkConnected: true }));
  await assert.rejects(pending, (e: any) => e instanceof FluviaRpcError && e.code === -32603);
  assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });
});

test('removeListener stops delivery', async () => {
  const { browser, provider } = setup();
  let calls = 0;
  const listener = () => (calls += 1);
  provider.on('accountsChanged', listener);
  provider.removeListener('accountsChanged', listener);
  const pending = provider.request({ method: 'connect' });
  await approveConnect(browser, 'rid-1');
  await pending;
  assert.equal(calls, 0);
});

test('works without a window: importing and constructing touch no browser globals', async () => {
  const provider = new FluviaProvider({ storage: memoryStorage() });
  assert.deepEqual(await provider.request({ method: 'isConnected' }), { isConnected: false, isNetworkConnected: true });
});
