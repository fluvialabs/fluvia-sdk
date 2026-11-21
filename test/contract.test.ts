import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dappRequest, readWalletMessage } from '../src/protocol.ts';

// The SDK keeps its own copy of protocol v1. While it lives next to the wallet, check both copies
// against each other, so a change on one side fails here instead of in production.
const walletProtocol = new URL('../../fluvia-fronted-wallet/src/lib/dapp/protocol.ts', import.meta.url);
const skip = existsSync(walletProtocol) ? false : 'wallet source not next to the SDK';

test('the wallet gate accepts the request envelope the SDK sends', { skip }, async () => {
  const wallet = await import(walletProtocol.href);
  const opener = {};
  const gate = wallet.createRequestGate({ origin: 'https://dex.example.com', rid: 'r1', opener });
  const sent = dappRequest('r1', 'prepareExecute', { commands: [1] });
  assert.deepEqual(gate({ source: opener, origin: 'https://dex.example.com', data: sent }), {
    id: 'r1',
    method: 'prepareExecute',
    params: { commands: [1] },
  });
});

test('the SDK reads every message the wallet sends', { skip }, async () => {
  const wallet = await import(walletProtocol.href);
  assert.deepEqual(readWalletMessage(wallet.walletReady()), { kind: 'ready' });
  assert.deepEqual(readWalletMessage(wallet.walletResult('r1', { ok: 1 })), { kind: 'result', id: 'r1', result: { ok: 1 } });
  assert.deepEqual(readWalletMessage(wallet.rpcError('r1', 4001, 'no', { errorCode: 'X' })), {
    kind: 'error',
    id: 'r1',
    error: { code: 4001, message: 'no', data: { errorCode: 'X' } },
  });
  assert.deepEqual(readWalletMessage(wallet.walletEvent('txChanged', { status: 'pending' })), {
    kind: 'event',
    event: 'txChanged',
    payload: { status: 'pending' },
  });
});

test('both sides use the same error codes', { skip }, async () => {
  const wallet = await import(walletProtocol.href);
  const sdk = await import('../src/errors.ts');
  assert.equal(sdk.USER_REJECTED, wallet.DAPP_ERRORS.USER_REJECTED);
  assert.equal(sdk.UNAUTHORIZED, wallet.DAPP_ERRORS.UNAUTHORIZED);
  assert.equal(sdk.UNSUPPORTED_METHOD, wallet.DAPP_ERRORS.UNSUPPORTED_METHOD);
  assert.equal(sdk.INVALID_PARAMS, wallet.DAPP_ERRORS.INVALID_PARAMS);
  assert.equal(sdk.INTERNAL, wallet.DAPP_ERRORS.INTERNAL);
});
