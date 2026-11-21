import { FLUVIA_ICON } from './icon.ts';
import { FluviaProvider, type FluviaProviderOptions } from './provider.ts';

/** The ProviderAdapter shape shared by `@canton-network/dapp-sdk` (DiscoveryClient) and PartyLayer. */
export interface FluviaProviderAdapter {
  readonly providerId: 'fluvia';
  readonly name: 'Fluvia';
  readonly type: 'remote';
  readonly icon: string;
  getInfo(): { providerId: 'fluvia'; name: 'Fluvia'; type: 'remote'; description: string; icon: string; url: string };
  detect(): Promise<boolean>;
  provider(): FluviaProvider;
  restore(): Promise<FluviaProvider | null>;
  teardown(): void;
}

/**
 * Fluvia for dApps that list wallets through the Canton dApp SDK or PartyLayer. Fluvia has no
 * extension to announce itself, so the dApp adds this adapter to its list.
 */
export function fluviaAdapter(source: FluviaProviderOptions | FluviaProvider = {}): FluviaProviderAdapter {
  const provider = source instanceof FluviaProvider ? source : new FluviaProvider(source);
  return {
    providerId: 'fluvia',
    name: 'Fluvia',
    type: 'remote',
    icon: FLUVIA_ICON,
    getInfo: () => ({
      providerId: 'fluvia',
      name: 'Fluvia',
      type: 'remote',
      description: 'Web wallet for Canton, no extension needed',
      icon: FLUVIA_ICON,
      url: provider.walletOrigin,
    }),
    detect: async () => true,
    provider: () => provider,
    restore: async () => (provider.hasSession() ? provider : null),
    teardown: () => {},
  };
}
