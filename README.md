# Fluvia SDK

[![npm version](https://img.shields.io/npm/v/@fluvia-labs/sdk)](https://www.npmjs.com/package/@fluvia-labs/sdk)
[![license](https://img.shields.io/npm/l/@fluvia-labs/sdk)](./LICENSE)
[![types](https://img.shields.io/npm/types/@fluvia-labs/sdk)](https://www.npmjs.com/package/@fluvia-labs/sdk)

TypeScript SDK for connecting Canton dApps to the [Fluvia](https://fluvia-labs.com) wallet over
[CIP-0103](https://github.com/canton-foundation/cips/blob/main/cip-0103/cip-0103.md).

Fluvia is a web wallet: users need no browser extension. Requests that require approval open
Fluvia in a popup on desktop or a new tab on mobile, and the window closes once the user responds.

## Features

- No browser extension: works in desktop and mobile browsers
- CIP-0103 provider and a typed client for every method and event
- Adapters for the Canton dApp SDK (`@canton-network/dapp-sdk`) and PartyLayer
- React provider and hooks
- Session persistence: account, network and status reads never open a popup
- No runtime dependencies, safe to import during server-side rendering

## Contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [Integrations](#integrations)
- [API](#api)
- [Error handling](#error-handling)
- [Mobile](#mobile)
- [Configuration](#configuration)
- [Development](#development)
- [Security](#security)
- [License](#license)

## Installation

```bash
npm install @fluvia-labs/sdk
```

| Entry point | Contents |
|---|---|
| `@fluvia-labs/sdk` | `createFluviaClient`, `FluviaProvider`, error helpers, `createFluviaStore`, `FLUVIA_ICON` |
| `@fluvia-labs/sdk/adapter` | `fluviaAdapter` for the Canton dApp SDK |
| `@fluvia-labs/sdk/partylayer` | `FluviaPartyLayerAdapter` for PartyLayer |
| `@fluvia-labs/sdk/react` | `FluviaClientProvider` and hooks |

Optional peer dependencies: `react` 18+ for the React entry, `@partylayer/core` 0.14+ for the
PartyLayer entry.

## Quick start

```ts
import { createFluviaClient, isUserRejection } from '@fluvia-labs/sdk';

const fluvia = createFluviaClient();

connectButton.addEventListener('click', async () => {
  try {
    await fluvia.connect();
    const { partyId } = await fluvia.getPrimaryAccount();
    console.log('Connected as', partyId);
  } catch (error) {
    if (!isUserRejection(error)) throw error;
  }
});
```

> **Important:** methods that open Fluvia must be called from a user gesture (click or tap) before
> any other `await`. Browsers block popups opened outside a user gesture.

## Integrations

### Canton dApp SDK

Extension wallets announce themselves to the page. Web wallets are registered with an adapter:

```ts
import { DiscoveryClient } from '@canton-network/dapp-sdk';
import { fluviaAdapter } from '@fluvia-labs/sdk/adapter';

const discovery = await DiscoveryClient.create({
  adapters: [fluviaAdapter()],
});
```

Fluvia appears in the wallet list. Existing `connect`, `signMessage` and `prepareExecute` calls
work without changes.

### PartyLayer

```ts
import { createPartyLayer } from '@partylayer/sdk';
import { FluviaPartyLayerAdapter } from '@fluvia-labs/sdk/partylayer';

const partyLayer = createPartyLayer({
  network: 'mainnet',
  app: { name: 'My dApp' },
  adapters: [new FluviaPartyLayerAdapter()],
});
```

PartyLayer shows icons only for wallets in its registry. Pass the Fluvia icon through
`walletIcons`:

```tsx
import { FLUVIA_ICON } from '@fluvia-labs/sdk';

<PartyLayerKit adapters={[new FluviaPartyLayerAdapter()]} walletIcons={{ fluvia: FLUVIA_ICON }} />
```

Prefer `FluviaPartyLayerAdapter` over `fluviaAdapter()` with PartyLayer. PartyLayer's generic
adapter bridge forwards only connect, sign and submit; `FluviaPartyLayerAdapter` also supports
`ledgerApi` and transaction status.

### React

```tsx
import { FluviaClientProvider, useConnect, useFluvia, useFluviaAccount } from '@fluvia-labs/sdk/react';

export function App() {
  return (
    <FluviaClientProvider>
      <Wallet />
    </FluviaClientProvider>
  );
}

function Wallet() {
  const fluvia = useFluvia();
  const { isConnected, account } = useFluviaAccount();
  const { connect, isConnecting, error } = useConnect();

  if (!isConnected) {
    return (
      <button onClick={connect} disabled={isConnecting}>
        Connect Fluvia {error && `(error ${error.code})`}
      </button>
    );
  }
  return <button onClick={() => fluvia.signMessage('hello')}>Sign as {account?.partyId}</button>;
}
```

| Hook | Returns |
|---|---|
| `useFluvia()` | The client (see [API](#api)) |
| `useFluviaAccount()` | `{ isConnected, account, networkId }` |
| `useConnect()` | `{ connect, isConnecting, error }`. `connect` never throws; failures are set on `error` |
| `useDisconnect()` | The disconnect function |

`FluviaClientProvider` accepts `options` (see [Configuration](#configuration)) or an existing
`client`. During server-side rendering, hooks return the disconnected state.

For other frameworks, `createFluviaStore(client)` exposes the same state through `subscribe` and
`getSnapshot`.

## API

### Methods

| Method | Opens Fluvia | Returns |
|---|---|---|
| `connect()` | Yes | `{ isConnected, isNetworkConnected }` |
| `disconnect()` | No | `null` |
| `isConnected()` | No | `{ isConnected, isNetworkConnected }` |
| `status()` | No | CIP-0103 status |
| `getActiveNetwork()` | No | `{ networkId }` |
| `listAccounts()` | No | `Account[]` |
| `getPrimaryAccount()` | No | `Account` |
| `signMessage(message)` | Yes | Base64 Ed25519 signature over the UTF-8 message. Messages of exactly 32 or 34 bytes are refused |
| `prepareExecute(params)` | Yes | `null` once executed; the `updateId` is emitted on `txChanged` |
| `prepareExecuteAndWait(params)` | Yes | `{ tx }`, with `tx.payload.updateId` |
| `ledgerApi({ requestMethod, resource, body? })` | Yes | `{ response }` (JSON string) |
| `on(event, listener)` | No | Unsubscribe function |

`disconnect()` clears the session in the dApp only. Users revoke a site's access in Fluvia under
**Settings → Security → Connected sites**.

`client.provider` is the underlying CIP-0103 provider (`request`, `on`, `removeListener`, `emit`)
for libraries that expect one.

### Transactions

`prepareExecute` and `prepareExecuteAndWait` accept:

| Field | Required |
|---|---|
| `commands` | Yes |
| `disclosedContracts` | No |
| `commandId` | No |
| `readAs` | No |
| `synchronizerId` | No |
| `packageIdSelectionPreference` | No |

- Transactions are always submitted as the connected party; `actAs` is ignored.
- The user reviews the transaction and the Fluvia fee before signing.
- Disclosed contracts must include `templateId`, `contractId`, `createdEventBlob` and
  `synchronizerId`.

### Ledger API

Read-only, scoped to the connected party.

| `requestMethod` | `resource` |
|---|---|
| `get` | `/v2/state/ledger-end` |
| `post` | `/v2/state/active-contracts` |
| `post` | `/v2/updates/update-by-id` |
| `post` | `/v2/events/events-by-contract-id` |

### Events

| Event | Emitted when |
|---|---|
| `statusChanged` | The connection status changes |
| `accountsChanged` | The connected account changes |
| `txChanged` | A transaction moves through `pending`, `signed`, `executed` or `failed` |

## Error handling

All errors are instances of `FluviaRpcError` with a numeric `code`. Fluvia-specific reasons are
available through `fluviaErrorCode(error)`.

| Code | Meaning |
|---|---|
| `4001` | User rejected the request or closed the Fluvia window |
| `4100` | Not connected, or access was revoked in Fluvia; the stored session is cleared |
| `4200` | Unsupported method |
| `-32602` | Invalid params |
| `-32603` | Internal error, e.g. `TX_COOLDOWN_ACTIVE`, `FLUVIA_POPUP_BLOCKED` |

```ts
import { fluviaErrorCode, isUnauthorized, isUserRejection } from '@fluvia-labs/sdk';

try {
  await fluvia.prepareExecuteAndWait({ commands });
} catch (error) {
  if (isUserRejection(error)) return;
  if (isUnauthorized(error)) return showConnectButton();
  console.error(fluviaErrorCode(error) ?? error);
}
```

## Mobile

- Fluvia opens in a new tab, prompts for sign-in if needed, and closes after responding. There is
  no timeout; closing the tab rejects with `4001`.
- **iOS home screen app:** a Fluvia app installed to the home screen has separate storage from
  Safari. Requests from a dApp in Safari fail with `FLUVIA_NO_SIGNING_KEY` until the user imports
  their recovery phrase in Safari.
- **In-app browsers** (Telegram, X, Instagram) often block popups (`FLUVIA_POPUP_BLOCKED`). Users
  should open the dApp in Chrome or Safari.

## Configuration

All entry points accept the same options:

| Option | Default | Description |
|---|---|---|
| `walletOrigin` | `https://fluvia-labs.com` | Fluvia wallet origin |
| `storage` | `localStorage` | Session storage. `null` keeps the session in memory for the current page |

```ts
const fluvia = createFluviaClient({ storage: sessionStorage });
```

`fluviaAdapter()` and `new FluviaPartyLayerAdapter()` also accept an existing `client.provider`,
so the adapter and the rest of the dApp share one session.

Only Canton mainnet (`canton:da-mainnet`) is supported.

Your dApp must be served over HTTPS. Fluvia refuses plain HTTP sites, except on the developer's own
machine.

## Development

Requires Node.js 22.18 or newer.

```bash
npm install
npm test
npm run build
```

## Security

### For dApp developers

- The session is stored in your dApp's own storage, so `getPrimaryAccount()` and `status()` are
  not proof of identity. To sign users in:
  1. Have them sign a readable message containing a one-time nonce from your server, such as
     `Sign in to example.com\nNonce: <nonce>`.
  2. On your server, check that `publicKey` belongs to `partyId`: the part after `::` must equal
     `1220` + hex(SHA-256(`0000000c` + raw public key bytes)). A client can send any key.
  3. Verify the signature against that `publicKey`.
- Fluvia refuses to sign messages of exactly 32 or 34 bytes, the sizes of Canton hashes, so a
  signature on a message can never authorize a transaction.
- Every transaction and signature is approved by the user in Fluvia. Your dApp never receives
  keys.

### Reporting a vulnerability

Do not open a public issue. Report it privately at
[github.com/fluvialabs/fluvia-sdk/security/advisories/new](https://github.com/fluvialabs/fluvia-sdk/security/advisories/new).

## License

[Apache-2.0](./LICENSE)
