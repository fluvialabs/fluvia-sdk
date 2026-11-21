import { FluviaRpcError, INTERNAL, USER_REJECTED } from './errors.ts';
import { dappRequest, readWalletMessage } from './protocol.ts';

export interface PopupWindow {
  closed: boolean;
  postMessage(message: unknown, targetOrigin: string): void;
}

type MessageListener = (event: { origin: string; source: unknown; data: unknown }) => void;

export interface PopupEnv {
  origin: string;
  open(url: string, name: string, features: string): PopupWindow | null;
  addMessageListener(listener: MessageListener): void;
  removeMessageListener(listener: MessageListener): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  randomId(): string;
}

export function browserEnv(): PopupEnv {
  return {
    origin: window.location.origin,
    open: (url, name, features) => window.open(url, name, features),
    addMessageListener: (listener) => window.addEventListener('message', listener),
    removeMessageListener: (listener) => window.removeEventListener('message', listener),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (handle) => window.clearInterval(handle as number),
    randomId: () => crypto.randomUUID(),
  };
}

/**
 * One request per popup (a tab on phones). Open it from a click handler, before any await, or the
 * browser blocks it. No timeout while it stays open: signing in on a phone can take minutes.
 */
export function callWallet(
  env: PopupEnv,
  walletOrigin: string,
  method: string,
  params?: unknown,
  onEvent: (event: string, payload: unknown) => void = () => {},
): Promise<unknown> {
  const rid = env.randomId();
  const url = `${walletOrigin}/dapp?origin=${encodeURIComponent(env.origin)}&rid=${encodeURIComponent(rid)}`;
  const popup = env.open(url, `fluvia-dapp-${rid}`, 'popup,width=440,height=720');
  if (!popup) {
    return Promise.reject(
      new FluviaRpcError(INTERNAL, 'The browser blocked the Fluvia popup. Allow popups for this site, or call this from a click.', {
        errorCode: 'FLUVIA_POPUP_BLOCKED',
      }),
    );
  }

  return new Promise((resolve, reject) => {
    let sent = false;
    let done = false;

    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      env.clearInterval(watch);
      env.removeMessageListener(onMessage);
      settle();
    };

    const onMessage: MessageListener = (event) => {
      if (event.origin !== walletOrigin || event.source !== popup) return;
      const message = readWalletMessage(event.data);
      if (!message) return;
      if (message.kind === 'ready') {
        // The page can announce ready twice; a resent request would make the user approve twice.
        if (!sent) popup.postMessage(dappRequest(rid, method, params), walletOrigin);
        sent = true;
      } else if (message.kind === 'event') {
        onEvent(message.event, message.payload);
      } else if (message.id === rid && message.kind === 'result') {
        finish(() => resolve(message.result));
      } else if (message.id === rid && message.kind === 'error') {
        const { code, message: text, data } = message.error;
        finish(() => reject(new FluviaRpcError(code, text, data)));
      }
    };

    const watch = env.setInterval(() => {
      if (!popup.closed) return;
      finish(() =>
        reject(new FluviaRpcError(USER_REJECTED, 'The Fluvia window was closed before it answered.', { errorCode: 'FLUVIA_POPUP_CLOSED' })),
      );
    }, 500);

    env.addMessageListener(onMessage);
  });
}
