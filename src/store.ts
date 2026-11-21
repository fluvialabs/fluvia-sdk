import { FluviaRpcError, INTERNAL } from './errors.ts';
import type { FluviaClient } from './index.ts';
import type { Account } from './session.ts';

export interface FluviaState {
  isConnected: boolean;
  isConnecting: boolean;
  account: Account | null;
  networkId: string | null;
  error: FluviaRpcError | null;
}

/**
 * Connection state as a subscribable snapshot, for UI frameworks (the React hooks use it through
 * useSyncExternalStore). The snapshot object only changes when the state does.
 */
export function createFluviaStore(client: FluviaClient) {
  const listeners = new Set<() => void>();
  let connecting = false;
  let error: FluviaRpcError | null = null;
  let snapshot = read();

  function read(): FluviaState {
    const session = client.provider.getSession();
    return {
      isConnected: Boolean(session),
      isConnecting: connecting,
      account: session?.account ?? null,
      networkId: session?.networkId ?? null,
      error,
    };
  }

  function update() {
    const next = read();
    const same =
      next.isConnected === snapshot.isConnected &&
      next.isConnecting === snapshot.isConnecting &&
      next.networkId === snapshot.networkId &&
      next.error === snapshot.error &&
      JSON.stringify(next.account) === JSON.stringify(snapshot.account);
    if (same) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  client.provider.on('statusChanged', update);
  client.provider.on('accountsChanged', update);

  return {
    client,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Never rejects: a failure lands in `error`. Call from a click handler. */
    connect(): Promise<void> {
      const pending = client.connect(); // first, so the popup opens inside the click
      connecting = true;
      error = null;
      update();
      return pending
        .then(
          () => {},
          (e: unknown) => {
            error = e instanceof FluviaRpcError ? e : new FluviaRpcError(INTERNAL, e instanceof Error ? e.message : String(e));
          },
        )
        .finally(() => {
          connecting = false;
          update();
        });
    },
    async disconnect(): Promise<void> {
      await client.disconnect();
      update();
    },
  };
}

export type FluviaStore = ReturnType<typeof createFluviaStore>;
