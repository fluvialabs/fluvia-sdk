import type {
  AdapterConnectResult,
  AdapterContext,
  AdapterDetectResult,
  AdapterEventName,
  CapabilityKey,
  LedgerApiParams,
  LedgerApiResult,
  PartyId,
  PersistedSession,
  Session,
  SignMessageParams,
  Signature,
  SignedMessage,
  SubmitTransactionParams,
  TransactionHash,
  TransactionStatus,
  TxReceipt,
  WalletAdapter,
  WalletId,
} from '@partylayer/core';
import { FluviaProvider, type FluviaProviderOptions } from './provider.ts';

const TX_STATUS: Record<string, TransactionStatus> = {
  pending: 'pending',
  signed: 'submitted',
  executed: 'committed',
  failed: 'failed',
};

type ProviderLike = Pick<FluviaProvider, 'request' | 'on' | 'removeListener' | 'hasSession'>;

/**
 * Fluvia as a native PartyLayer wallet. PartyLayer's bridge for plain ProviderAdapters forwards only
 * connect, sign and submit; this one also serves ledgerApi and transaction status events.
 */
export class FluviaPartyLayerAdapter implements WalletAdapter {
  readonly walletId = 'fluvia' as WalletId;
  readonly name = 'Fluvia';
  private readonly provider: ProviderLike;

  constructor(source: FluviaProviderOptions | ProviderLike = {}) {
    this.provider = 'request' in source ? source : new FluviaProvider(source);
  }

  getCapabilities(): CapabilityKey[] {
    return ['connect', 'disconnect', 'restore', 'signMessage', 'submitTransaction', 'ledgerApi', 'events', 'popup'];
  }

  async detectInstalled(): Promise<AdapterDetectResult> {
    return { installed: true };
  }

  connect(ctx: AdapterContext): Promise<AdapterConnectResult> {
    // Not async: the popup must open in this tick, while the click still counts.
    return this.provider.request({ method: 'connect' }).then(async () => {
      const account = await this.provider.request({ method: 'getPrimaryAccount' });
      const partyId = account.partyId as PartyId;
      return {
        partyId,
        session: { walletId: this.walletId, partyId, network: account.networkId ?? ctx.network },
        capabilities: this.getCapabilities(),
      };
    });
  }

  async disconnect(): Promise<void> {
    await this.provider.request({ method: 'disconnect' });
  }

  async restore(_ctx: AdapterContext, persisted: PersistedSession): Promise<Session | null> {
    if (!this.provider.hasSession()) return null;
    const account = await this.provider.request({ method: 'getPrimaryAccount' });
    return account.partyId === persisted.partyId ? { ...persisted, walletId: this.walletId } : null;
  }

  async signMessage(_ctx: AdapterContext, session: Session, params: SignMessageParams): Promise<SignedMessage> {
    const result = await this.provider.request({ method: 'signMessage', params: { message: params.message } });
    const signature = (typeof result === 'string' ? result : result?.signature) as Signature;
    return { signature, partyId: session.partyId, message: params.message };
  }

  async submitTransaction(_ctx: AdapterContext, _session: Session, params: SubmitTransactionParams): Promise<TxReceipt> {
    // PartyLayer carries the CIP-0103 prepareExecute request in `signedTx`.
    const result = await this.provider.request({ method: 'prepareExecuteAndWait', params: params.signedTx ?? params });
    const updateId: string | undefined = result?.tx?.payload?.updateId;
    if (!updateId) throw new Error('Fluvia did not report an updateId for this transaction.');
    return { transactionHash: updateId as TransactionHash, updateId, commandId: result.tx.commandId, submittedAt: Date.now() };
  }

  async ledgerApi(_ctx: AdapterContext, _session: Session, params: LedgerApiParams): Promise<LedgerApiResult> {
    return this.provider.request({
      method: 'ledgerApi',
      params: { requestMethod: params.requestMethod.toLowerCase(), resource: params.resource, body: params.body },
    });
  }

  on(event: AdapterEventName, handler: (payload: unknown) => void): () => void {
    if (event !== 'txStatus') return () => {};
    const listener = (tx: { status?: string; payload?: { updateId?: string } } | null) => {
      if (!tx?.status) return;
      const updateId = tx.payload?.updateId;
      handler({ status: TX_STATUS[tx.status] ?? 'failed', ...(updateId ? { txId: updateId as TransactionHash } : {}), raw: tx, timestamp: Date.now() });
    };
    this.provider.on('txChanged', listener);
    return () => void this.provider.removeListener('txChanged', listener);
  }
}
