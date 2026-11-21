// A fake browser for the dApp page and the Fluvia popup, driven by the tests.

export const DAPP = 'https://dex.example.com';
export const WALLET = 'https://fluvia-labs.com';

export const ACCOUNT = {
  primary: true,
  partyId: 'alice::1220' + 'ab'.repeat(32),
  status: 'allocated',
  hint: 'alice',
  publicKey: 'pk',
  namespace: '1220' + 'ab'.repeat(32),
  networkId: 'canton:da-mainnet',
  signingProviderId: 'fluvia',
};

export function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

export interface FakePopup {
  url: string;
  closed: boolean;
  received: any[];
  postMessage(message: unknown, targetOrigin: string): void;
  close(): void;
}

export function fakeEnv(options: { blockPopups?: boolean } = {}) {
  let listener: ((event: { origin: string; source: unknown; data: unknown }) => void) | null = null;
  const timers = new Set<() => void>();
  const popups: FakePopup[] = [];
  let ids = 0;

  const env = {
    origin: DAPP,
    open(url: string) {
      if (options.blockPopups) return null;
      const popup: FakePopup = {
        url,
        closed: false,
        received: [],
        postMessage(message, targetOrigin) {
          popup.received.push({ message, targetOrigin });
        },
        close() {
          popup.closed = true;
        },
      };
      popups.push(popup);
      return popup;
    },
    addMessageListener(fn: typeof listener) {
      listener = fn;
    },
    removeMessageListener(fn: typeof listener) {
      if (listener === fn) listener = null;
    },
    setInterval(fn: () => void) {
      timers.add(fn);
      return fn;
    },
    clearInterval(handle: unknown) {
      timers.delete(handle as () => void);
    },
    randomId: () => `rid-${++ids}`,
  };

  return {
    env,
    popups,
    get listening() {
      return listener !== null;
    },
    /** A message arriving at the dApp page. */
    deliver(data: unknown, from: { origin?: string; source?: unknown } = {}) {
      listener?.({ origin: from.origin ?? WALLET, source: from.source ?? popups.at(-1), data });
    },
    /** Runs the popup-closed watchers once. */
    tick() {
      for (const fn of [...timers]) fn();
    },
  };
}

export const wallet = {
  ready: () => ({ source: 'fluvia-wallet', v: 1, type: 'ready' }),
  result: (id: string, result: unknown) => ({ source: 'fluvia-wallet', v: 1, id, result }),
  error: (id: string, code: number, message: string, data?: unknown) => ({
    source: 'fluvia-wallet',
    v: 1,
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }),
  event: (event: string, payload: unknown) => ({ source: 'fluvia-wallet', v: 1, event, payload }),
};

/** Lets pending promise callbacks run. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));
