import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFluviaClient, isUserRejection, fluviaErrorCode } from '../src/index.ts';
import { ACCOUNT, WALLET, fakeEnv, flush, memoryStorage, wallet } from './helpers.ts';

function setup() {
  const browser = fakeEnv();
  const client = createFluviaClient({ walletOrigin: WALLET, env: browser.env, storage: memoryStorage() });
  return { browser, client };
}

async function connect(browser: ReturnType<typeof fakeEnv>, client: ReturnType<typeof createFluviaClient>) {
  const pending = client.connect();
  browser.deliver(wallet.ready());
  browser.deliver(wallet.event('accountsChanged', [ACCOUNT]));
  browser.deliver(wallet.result('rid-1', { isConnected: true, isNetworkConnected: true }));
  return pending;
}

test('connect, then read the account without another popup', async () => {
  const { browser, client } = setup();
  assert.deepEqual(await connect(browser, client), { isConnected: true, isNetworkConnected: true });
  assert.equal((await client.getPrimaryAccount()).partyId, ACCOUNT.partyId);
  assert.equal(browser.popups.length, 1);
});

// The Fluvia wallet answers signMessage with a bare string; the CIP-0103 spec shape is { signature }.
test('signMessage hands back the signature string for either answer shape', async () => {
  const { browser, client } = setup();
  await connect(browser, client);

  let pending = client.signMessage('hello');
  browser.deliver(wallet.ready());
  browser.deliver(wallet.result('rid-2', 'sig-a'));
  assert.equal(await pending, 'sig-a');

  pending = client.signMessage('hello');
  browser.deliver(wallet.ready());
  browser.deliver(wallet.result('rid-3', { signature: 'sig-b' }));
  assert.equal(await pending, 'sig-b');
});

test('prepareExecuteAndWait returns the executed event', async () => {
  const { browser, client } = setup();
  await connect(browser, client);
  const tx = { status: 'executed', commandId: 'c1', payload: { updateId: 'u1', completionOffset: 7 } };
  const pending = client.prepareExecuteAndWait({ commands: [{ CreateCommand: {} }] });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.result('rid-2', { tx }));
  assert.deepEqual(await pending, { tx });
});

test('on() returns an unsubscribe function', async () => {
  const { browser, client } = setup();
  let calls = 0;
  const off = client.on('accountsChanged', () => (calls += 1));
  await connect(browser, client);
  off();
  await client.disconnect();
  assert.equal(calls, 1);
});

test('error helpers read the code and Fluvia reason', async () => {
  const { browser, client } = setup();
  await connect(browser, client);
  const pending = client.prepareExecute({ commands: [{}] });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-2', 4001, 'The transaction was rejected in Fluvia.'));
  const error = await pending.catch((e) => e);
  assert.equal(isUserRejection(error), true);

  const second = client.prepareExecute({ commands: [{}] });
  browser.deliver(wallet.ready());
  browser.deliver(wallet.error('rid-3', -32603, 'Cooldown', { errorCode: 'TX_COOLDOWN_ACTIVE' }));
  assert.equal(fluviaErrorCode(await second.catch((e) => e)), 'TX_COOLDOWN_ACTIVE');
  await flush();
});
