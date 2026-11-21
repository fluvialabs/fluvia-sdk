import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluviaPartyLayerAdapter } from '../src/partylayer.ts';

const ACCOUNT = { primary: true, partyId: 'alice::1220abc', networkId: 'canton:da-mainnet' };

function fakeProvider(overrides: Record<string, (params?: any) => unknown> = {}) {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const calls: Array<{ method: string; params?: unknown }> = [];
  const answers: Record<string, (params?: any) => unknown> = {
    connect: () => ({ isConnected: true, isNetworkConnected: true }),
    getPrimaryAccount: () => ACCOUNT,
    disconnect: () => null,
    signMessage: () => ({ signature: 'c2lnbmF0dXJl' }),
    ledgerApi: () => ({ response: '{"offset":9}' }),
    prepareExecuteAndWait: () => ({ tx: { status: 'executed', commandId: 'c1', payload: { updateId: 'upd-1', completionOffset: 3 } } }),
    ...overrides,
  };
  return {
    calls,
    session: true,
    hasSession() {
      return this.session;
    },
    request({ method, params }: { method: string; params?: unknown }) {
      calls.push({ method, ...(params === undefined ? {} : { params }) });
      return Promise.resolve().then(() => answers[method](params));
    },
    on(event: string, listener: (p: unknown) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return this;
    },
    removeListener(event: string, listener: (p: unknown) => void) {
      listeners.get(event)?.delete(listener);
      return this;
    },
    fire(event: string, payload: unknown) {
      listeners.get(event)?.forEach((listener) => listener(payload));
    },
  };
}

const adapterFor = (provider: ReturnType<typeof fakeProvider>) => new FluviaPartyLayerAdapter(provider as any);
const ctx: any = { network: 'mainnet', origin: 'https://dex.example.com', appName: 'test' };
const session: any = { sessionId: 's1', walletId: 'fluvia', partyId: ACCOUNT.partyId, network: 'canton:da-mainnet', createdAt: 0, origin: ctx.origin, capabilitiesSnapshot: [] };

test('declares what Fluvia does, including ledgerApi and events, and no raw transaction signing', () => {
  const caps = adapterFor(fakeProvider()).getCapabilities();
  for (const cap of ['connect', 'disconnect', 'restore', 'signMessage', 'submitTransaction', 'ledgerApi', 'events', 'popup']) assert.ok(caps.includes(cap as any), cap);
  assert.equal(caps.includes('signTransaction' as any), false);
});

test('connect asks the provider in the same tick (the popup must open inside the click), then returns the party', async () => {
  const provider = fakeProvider();
  const pending = adapterFor(provider).connect(ctx);
  assert.deepEqual(provider.calls, [{ method: 'connect' }]);
  const result = await pending;
  assert.equal(result.partyId, ACCOUNT.partyId);
  assert.deepEqual(result.session, { walletId: 'fluvia', partyId: ACCOUNT.partyId, network: 'canton:da-mainnet' });
});

test('signMessage accepts the spec shape and the old bare string', async () => {
  assert.deepEqual(await adapterFor(fakeProvider()).signMessage(ctx, session, { message: 'hi' }), {
    signature: 'c2lnbmF0dXJl',
    partyId: ACCOUNT.partyId,
    message: 'hi',
  });
  const old = fakeProvider({ signMessage: () => 'b2xk' });
  assert.equal((await adapterFor(old).signMessage(ctx, session, { message: 'hi' })).signature, 'b2xk');
});

test('submitTransaction sends the CIP-0103 request PartyLayer carries in signedTx and returns the real updateId', async () => {
  const provider = fakeProvider();
  const receipt = await adapterFor(provider).submitTransaction(ctx, session, { signedTx: { commands: [{}], commandId: 'c1' } });
  assert.deepEqual(provider.calls.at(-1), { method: 'prepareExecuteAndWait', params: { commands: [{}], commandId: 'c1' } });
  assert.equal(receipt.updateId, 'upd-1');
  assert.equal(receipt.commandId, 'c1');
  assert.equal(receipt.transactionHash, 'upd-1');
});

test('submitTransaction without an updateId fails instead of inventing a receipt', async () => {
  const adapter = adapterFor(fakeProvider({ prepareExecuteAndWait: () => ({ tx: { status: 'executed' } }) }));
  await assert.rejects(adapter.submitTransaction(ctx, session, { signedTx: { commands: [{}] } }), /updateId/);
});

test('ledgerApi lowercases the verb and passes the body through', async () => {
  const provider = fakeProvider();
  const result = await adapterFor(provider).ledgerApi(ctx, session, { requestMethod: 'POST', resource: '/v2/state/active-contracts', body: { a: 1 } } as any);
  assert.deepEqual(provider.calls.at(-1), {
    method: 'ledgerApi',
    params: { requestMethod: 'post', resource: '/v2/state/active-contracts', body: { a: 1 } },
  });
  assert.deepEqual(result, { response: '{"offset":9}' });
});

test('txChanged reaches PartyLayer as txStatus with its status names, until unsubscribed', () => {
  const provider = fakeProvider();
  const seen: any[] = [];
  const off = adapterFor(provider).on('txStatus', (update) => seen.push(update));
  provider.fire('txChanged', { status: 'executed', commandId: 'c1', payload: { updateId: 'u' } });
  provider.fire('txChanged', { status: 'failed', commandId: 'c1' });
  off();
  provider.fire('txChanged', { status: 'pending', commandId: 'c2' });
  assert.deepEqual(seen.map((u) => u.status), ['committed', 'failed']);
  assert.equal(seen[0].txId, 'u');
  assert.equal(adapterFor(provider).on('connect' as any, () => {})(), undefined, 'other events: a no-op unsubscribe');
});

test('restore keeps a session only when the provider still holds the same party', async () => {
  assert.equal((await adapterFor(fakeProvider()).restore(ctx, { ...session, encrypted: '' }))?.partyId, ACCOUNT.partyId);
  const other = fakeProvider({ getPrimaryAccount: () => ({ ...ACCOUNT, partyId: 'mallory::1' }) });
  assert.equal(await adapterFor(other).restore(ctx, { ...session, encrypted: '' }), null);
  const none = Object.assign(fakeProvider(), { session: false });
  assert.equal(await adapterFor(none).restore(ctx, { ...session, encrypted: '' }), null);
});

test('disconnect goes through the provider', async () => {
  const provider = fakeProvider();
  await adapterFor(provider).disconnect();
  assert.deepEqual(provider.calls, [{ method: 'disconnect' }]);
});
