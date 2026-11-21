import { createContext, createElement, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createFluviaClient, type FluviaClient } from './index.ts';
import type { FluviaProviderOptions } from './provider.ts';
import { createFluviaStore, type FluviaState, type FluviaStore } from './store.ts';

const FluviaContext = createContext<FluviaStore | null>(null);

// A server has no wallet session.
const SERVER_STATE: FluviaState = { isConnected: false, isConnecting: false, account: null, networkId: null, error: null };

export function FluviaClientProvider(props: { client?: FluviaClient; options?: FluviaProviderOptions; children?: ReactNode }) {
  const [store] = useState(() => createFluviaStore(props.client ?? createFluviaClient(props.options)));
  return createElement(FluviaContext.Provider, { value: store }, props.children);
}

function useStore(): FluviaStore {
  const store = useContext(FluviaContext);
  if (!store) throw new Error('Fluvia hooks need a <FluviaClientProvider> above them.');
  return store;
}

function useFluviaState(): FluviaState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_STATE);
}

/** The client, for signMessage, prepareExecute and the rest. */
export function useFluvia(): FluviaClient {
  return useStore().client;
}

export function useFluviaAccount() {
  const { isConnected, account, networkId } = useFluviaState();
  return { isConnected, account, networkId };
}

/** `connect` must run in a click handler; failures show up in `error`. */
export function useConnect() {
  const store = useStore();
  const { isConnecting, error } = useFluviaState();
  return { connect: store.connect, isConnecting, error };
}

export function useDisconnect() {
  return useStore().disconnect;
}

export type { FluviaState };
