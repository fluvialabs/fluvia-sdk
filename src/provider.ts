import { FluviaRpcError, INTERNAL, UNAUTHORIZED } from './errors.ts';
import { browserEnv, callWallet, type PopupEnv } from './popup-transport.ts';
import { clearSession, readSession, writeSession, type Account, type Session, type StorageLike } from './session.ts';

export const DEFAULT_WALLET_ORIGIN = 'https://fluvia-labs.com';
export const CANTON_MAINNET = 'canton:da-mainnet';

export interface FluviaProviderOptions {
  /** Defaults to https://fluvia-labs.com. */
  walletOrigin?: string;
  /** Defaults to localStorage; `null` keeps the session for this page only. */
  storage?: StorageLike | null;
  env?: PopupEnv;
}

type Listener = (...args: any[]) => void;

/**
 * CIP-0103 provider for the Fluvia wallet. After `connect`, status, account and network reads are
 * answered from the stored session; everything else opens the Fluvia popup.
 */
export class FluviaProvider {
  readonly walletOrigin: string;
  private readonly storage: StorageLike | null;
  private readonly env?: PopupEnv;
  private readonly listeners = new Map<string, Set<Listener>>();
  // Used only when the storage could not keep the session.
  private pageSession: Session | null = null;

  constructor(options: FluviaProviderOptions = {}) {
    this.walletOrigin = (options.walletOrigin ?? DEFAULT_WALLET_ORIGIN).replace(/\/+$/, '');
    this.storage = options.storage !== undefined ? options.storage : defaultStorage();
    this.env = options.env;
  }

  async request({ method, params }: { method: string; params?: unknown }): Promise<any> {
    const session = this.getSession();
    switch (method) {
      case 'status':
        return statusEvent(session);
      case 'isConnected':
        return { isConnected: Boolean(session), isNetworkConnected: true };
      case 'getActiveNetwork':
        return { networkId: requireSession(session).networkId };
      case 'listAccounts':
        return [requireSession(session).account];
      case 'getPrimaryAccount':
        return requireSession(session).account;
      case 'connect':
        return this.connect();
      case 'disconnect':
        // Local only: dApps disconnect on logout or timers, where a popup would be blocked.
        // The user removes the site in Fluvia itself.
        this.forget();
        return null;
    }
    try {
      return await this.call(method, params);
    } catch (error) {
      // 4100: the user removed this site in Fluvia.
      if (error instanceof FluviaRpcError && error.code === UNAUTHORIZED) this.forget();
      throw error;
    }
  }

  /** The connected account and network, read without a popup. */
  getSession(): Session | null {
    return readSession(this.storage, this.walletOrigin) ?? this.pageSession;
  }

  hasSession(): boolean {
    return this.getSession() !== null;
  }

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  removeListener(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const listeners = [...(this.listeners.get(event) ?? [])];
    for (const listener of listeners) listener(...args);
    return listeners.length > 0;
  }

  private call(method: string, params?: unknown, onEvent = (event: string, payload: unknown) => void this.emit(event, payload)) {
    return callWallet(this.env ?? browserEnv(), this.walletOrigin, method, params, onEvent);
  }

  private async connect() {
    // The wallet sends the account as an accountsChanged event, not in the connect result.
    const announced: { account?: Account } = {};
    const result = await this.call('connect', undefined, (event, payload) => {
      if (event === 'accountsChanged' && Array.isArray(payload)) {
        const account = payload.find((a) => a?.primary) ?? payload[0];
        if (typeof account?.partyId === 'string') announced.account = account;
      }
      this.emit(event, payload);
    });
    const { account } = announced;
    if (!account) throw new FluviaRpcError(INTERNAL, 'Fluvia connected but sent no account.');
    const session = { account, networkId: account.networkId ?? CANTON_MAINNET, connectedAt: Date.now() };
    this.pageSession = writeSession(this.storage, this.walletOrigin, session) ? null : session;
    return result;
  }

  private forget() {
    if (!this.getSession()) return;
    clearSession(this.storage, this.walletOrigin);
    this.pageSession = null;
    this.emit('statusChanged', statusEvent(null));
    this.emit('accountsChanged', []);
  }
}

function requireSession(session: Session | null): Session {
  if (!session) throw new FluviaRpcError(UNAUTHORIZED, 'Not connected to Fluvia. Call connect first.');
  return session;
}

export type StatusEvent = ReturnType<typeof statusEvent>;

function statusEvent(session: Session | null) {
  return {
    connection: { isConnected: Boolean(session), isNetworkConnected: true },
    provider: { id: 'fluvia', providerType: 'remote', version: '1' },
    network: { networkId: session?.networkId ?? CANTON_MAINNET },
  };
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
