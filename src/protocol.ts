// Mirrors fluvia-fronted-wallet/src/lib/dapp/protocol.ts; test/contract.test.ts keeps them in step.

export const PROTOCOL_VERSION = 1;

export function dappRequest(id: string, method: string, params?: unknown) {
  return { source: 'fluvia-dapp', v: PROTOCOL_VERSION, id, method, ...(params === undefined ? {} : { params }) };
}

export type WalletMessage =
  | { kind: 'ready' }
  | { kind: 'result'; id: string; result: unknown }
  | { kind: 'error'; id: string; error: { code: number; message: string; data?: unknown } }
  | { kind: 'event'; event: string; payload: unknown };

export function readWalletMessage(data: unknown): WalletMessage | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, any>;
  if (m.source !== 'fluvia-wallet' || m.v !== PROTOCOL_VERSION) return null;
  if (m.type === 'ready') return { kind: 'ready' };
  if (typeof m.event === 'string') return { kind: 'event', event: m.event, payload: m.payload };
  if (typeof m.id !== 'string') return null;
  if (m.error && typeof m.error === 'object') {
    const { code, message, data } = m.error;
    return {
      kind: 'error',
      id: m.id,
      error: {
        code: typeof code === 'number' ? code : -32603,
        message: typeof message === 'string' ? message : 'Fluvia returned an error.',
        ...('data' in m.error ? { data } : {}),
      },
    };
  }
  return 'result' in m ? { kind: 'result', id: m.id, result: m.result } : null;
}
