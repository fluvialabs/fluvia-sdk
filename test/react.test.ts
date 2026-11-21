import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createFluviaClient } from '../src/index.ts';
import { FluviaClientProvider, useConnect, useFluvia, useFluviaAccount } from '../src/react.ts';
import { ACCOUNT, WALLET, fakeEnv, memoryStorage } from './helpers.ts';

// Server rendering has no wallet session: hooks must render the disconnected state, not crash.
test('renders on the server as disconnected', () => {
  function Status() {
    const { isConnected, account } = useFluviaAccount();
    const { isConnecting } = useConnect();
    return createElement('p', null, `${isConnected}/${account?.partyId ?? 'none'}/${isConnecting}`);
  }
  const storage = memoryStorage();
  storage.setItem(`fluvia-sdk.session:${WALLET}`, JSON.stringify({ account: ACCOUNT, networkId: 'canton:da-mainnet', connectedAt: 1 }));
  const client = createFluviaClient({ walletOrigin: WALLET, env: fakeEnv().env, storage });

  const html = renderToString(createElement(FluviaClientProvider, { client }, createElement(Status)));
  assert.equal(html, '<p>false/none/false</p>');
});

test('useFluvia hands out the client given to the provider', () => {
  const client = createFluviaClient({ walletOrigin: WALLET, env: fakeEnv().env, storage: memoryStorage() });
  let seen: unknown;
  function Probe() {
    seen = useFluvia();
    return null;
  }
  renderToString(createElement(FluviaClientProvider, { client }, createElement(Probe)));
  assert.equal(seen, client);
});

test('hooks outside FluviaClientProvider say what is missing', () => {
  function Orphan() {
    useFluviaAccount();
    return null;
  }
  assert.throws(() => renderToString(createElement(Orphan)), /FluviaClientProvider/);
});
