/**
 * Public M2.3 adapter SDK.
 *
 * Adapters normalize indexed/off-chain data only. Canonical truth remains owned
 * by IndexerCheck's built-in canonical sources and quorum-backed proof kernel.
 */
export interface IndexerAdapterHead {
    blockNumber: number;
    blockHash?: string;
    reportedHealthy?: boolean;
    reportedSynced?: boolean;
    observedAt?: string;
}
export interface IndexerAdapterState {
    value: string | number | boolean | bigint;
    blockNumber?: number;
    payload?: unknown;
    metadata?: Record<string, unknown>;
}
export interface IndexerAdapterEvent {
    id?: string;
    blockNumber: number;
    transactionHash?: string;
    txHash?: string;
    logIndex?: number;
    address?: string;
    eventName?: string;
    payload?: Record<string, unknown>;
}
export interface IndexerAdapterEventRange {
    events: IndexerAdapterEvent[];
    coverageProven: boolean;
    metadata?: Record<string, unknown>;
}
export interface IndexerAdapterRangeRequest {
    fromBlock: number;
    toBlock: number;
}
export interface IndexerAdapterRuntime {
    getHead(): Promise<IndexerAdapterHead> | IndexerAdapterHead;
    getState?(key: string): Promise<IndexerAdapterState | undefined> | IndexerAdapterState | undefined;
    getEvents?(stream: string): Promise<IndexerAdapterEvent[]> | IndexerAdapterEvent[];
    getEventsAt?(stream: string, range: IndexerAdapterRangeRequest): Promise<IndexerAdapterEventRange | IndexerAdapterEvent[]> | IndexerAdapterEventRange | IndexerAdapterEvent[];
}
export interface IndexerAdapterCreateContext<TOptions = unknown> {
    options: TOptions;
    configDir: string;
}
export interface IndexerAdapterDefinition<TOptions = unknown> {
    readonly __indexercheckAdapter: true;
    name?: string;
    create(context: IndexerAdapterCreateContext<TOptions>): Promise<IndexerAdapterRuntime> | IndexerAdapterRuntime;
}
export declare function defineIndexerAdapter<TOptions = unknown>(definition: Omit<IndexerAdapterDefinition<TOptions>, "__indexercheckAdapter">): IndexerAdapterDefinition<TOptions>;
