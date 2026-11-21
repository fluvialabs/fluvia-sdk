import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOfficialProviderAdapter } from '@partylayer/core';
import { fluviaAdapter } from '../src/adapter.ts';
import { FluviaProvider } from '../src/provider.ts';
import { ACCOUNT, WALLET, fakeEnv, memoryStorage } from './helpers.ts';

const options = () => ({ walletOrigin: WALLET, env: fakeEnv().env, storage: memoryStorage() });

test('is an official ProviderAdapter (PartyLayer and the Canton dApp SDK)', () => {
  const adapter = fluviaAdapter(options());
  assert.equal(isOfficialProviderAdapter(adapter), true);
  assert.equal(adapter.providerId, 'fluvia');
  assert.equal(adapter.type, 'remote');
  assert.deepEqual(adapter.getInfo(), {
    providerId: 'fluvia',
    name: 'Fluvia',
    type: 'remote',
    description: 'Web wallet for Canton, no extension needed',
    icon: adapter.icon,
    url: WALLET,
  });
  assert.match(adapter.icon, /^data:image\/svg\+xml/);
});

test('its provider is a CIP-0103 provider', () => {
  const provider = fluviaAdapter(options()).provider();
  for (const method of ['request', 'on', 'emit', 'removeListener'] as const) assert.equal(typeof provider[method], 'function', method);
});

test('detect is true without opening anything: a web wallet needs no install', async () => {
  const browser = fakeEnv();
  assert.equal(await fluviaAdapter({ env: browser.env, storage: memoryStorage() }).detect(), true);
  assert.equal(browser.popups.length, 0);
});

test('restore gives the provider back only when a session is stored', async () => {
  assert.equal(await fluviaAdapter(options()).restore(), null);

  const storage = memoryStorage();
  storage.setItem(`fluvia-sdk.session:${WALLET}`, JSON.stringify({ account: ACCOUNT, networkId: 'canton:da-mainnet', connectedAt: 1 }));
  const restored = await fluviaAdapter({ walletOrigin: WALLET, env: fakeEnv().env, storage }).restore();
  assert.ok(restored);
  assert.deepEqual(await restored.request({ method: 'getPrimaryAccount' }), ACCOUNT);
});

test('accepts an existing provider, so one session serves the adapter and the rest of the page', () => {
  const provider = new FluviaProvider(options());
  assert.equal(fluviaAdapter(provider).provider(), provider);
});

// PartyLayer gives adapters outside its registry no icon; dApps pass this one as walletIcons.
test('the main entry exports the same icon the adapter shows', async () => {
  const { FLUVIA_ICON } = await import('../src/index.ts');
  assert.equal(FLUVIA_ICON, fluviaAdapter(options()).icon);
});
