export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Account {
  partyId: string;
  networkId?: string;
  [field: string]: unknown;
}

export interface Session {
  account: Account;
  networkId: string;
  connectedAt: number;
}

const keyFor = (walletOrigin: string) => `fluvia-sdk.session:${walletOrigin}`;

export function readSession(storage: StorageLike | null, walletOrigin: string): Session | null {
  try {
    const parsed = JSON.parse(storage?.getItem(keyFor(walletOrigin)) ?? 'null');
    return typeof parsed?.account?.partyId === 'string' && typeof parsed.networkId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** False when nothing was stored: no storage, or it threw (Safari private mode, blocked site data). */
export function writeSession(storage: StorageLike | null, walletOrigin: string, session: Session): boolean {
  try {
    storage?.setItem(keyFor(walletOrigin), JSON.stringify(session));
    return Boolean(storage);
  } catch {
    return false;
  }
}

export function clearSession(storage: StorageLike | null, walletOrigin: string): void {
  try {
    storage?.removeItem(keyFor(walletOrigin));
  } catch {}
}
