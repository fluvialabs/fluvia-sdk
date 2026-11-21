import { FluviaProvider, type FluviaProviderOptions, type StatusEvent } from './provider.ts';
import type { Account } from './session.ts';

export { FluviaProvider, DEFAULT_WALLET_ORIGIN, CANTON_MAINNET, type FluviaProviderOptions, type StatusEvent } from './provider.ts';
export * from './errors.ts';
export { FLUVIA_ICON } from './icon.ts';
export type { PopupEnv } from './popup-transport.ts';
export type { Account, Session, StorageLike } from './session.ts';
export { createFluviaStore, type FluviaState, type FluviaStore } from './store.ts';

export interface PrepareExecuteParams {
  commands: unknown[];
  disclosedContracts?: unknown[];
  commandId?: string;
  readAs?: string[];
  synchronizerId?: string;
  packageIdSelectionPreference?: string[];
}

export interface TxChangedEvent {
  status: 'pending' | 'signed' | 'executed' | 'failed';
  commandId: string;
  payload?: { updateId?: string; completionOffset?: number; [field: string]: unknown };
}

export interface Connection {
  isConnected: boolean;
  isNetworkConnected: boolean;
}

export type FluviaEvent = 'statusChanged' | 'accountsChanged' | 'txChanged';

/** Methods that open Fluvia (connect, disconnect, signMessage, prepareExecute*, ledgerApi) must run in a click handler. */
export function createFluviaClient(options: FluviaProviderOptions = {}) {
  const provider = new FluviaProvider(options);
  const call = (method: string, params?: unknown) => provider.request({ method, params });

  return {
    provider,
    connect: (): Promise<Connection> => call('connect'),
    disconnect: (): Promise<null> => call('disconnect'),
    isConnected: (): Promise<Connection> => call('isConnected'),
    status: (): Promise<StatusEvent> => call('status'),
    getActiveNetwork: (): Promise<{ networkId: string }> => call('getActiveNetwork'),
    listAccounts: (): Promise<Account[]> => call('listAccounts'),
    getPrimaryAccount: (): Promise<Account> => call('getPrimaryAccount'),
    // Fluvia answers with a bare string; the spec shape is { signature }.
    signMessage: async (message: string): Promise<string> => {
      const result = await call('signMessage', { message });
      return typeof result === 'string' ? result : result?.signature;
    },
    /** Resolves once executed; the updateId comes on txChanged. */
    prepareExecute: (params: PrepareExecuteParams): Promise<null> => call('prepareExecute', params),
    prepareExecuteAndWait: (params: PrepareExecuteParams): Promise<{ tx: TxChangedEvent }> => call('prepareExecuteAndWait', params),
    ledgerApi: (params: { requestMethod: string; resource: string; body?: unknown }): Promise<{ response: string }> =>
      call('ledgerApi', params),
    /** Returns the unsubscribe function. */
    on(event: FluviaEvent, listener: (payload: any) => void) {
      provider.on(event, listener);
      return () => void provider.removeListener(event, listener);
    },
    request: call,
  };
}

export type FluviaClient = ReturnType<typeof createFluviaClient>;
