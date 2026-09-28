import type { SnapshotSource, ProvenanceSnapshot, FreshnessSnapshot, TransactionCompletenessRequest, TransactionCompletenessSnapshot } from "../core/source.js";
import type { EventRecord, HeadSnapshot, PolymarketDataApiSourceConfig, StateValue } from "../core/types.js";
import { type RpcQuorumEvidence } from "../live/rpc-quorum.js";
interface ProbeFailure {
    transactionHash?: string;
    reason: string;
}
interface PilotProbe {
    chainHead: number;
    latestIndexedBlock: number;
    latestIndexedTimestampMs?: number;
    sampled: number;
    verified: number;
    failures: ProbeFailure[];
    dataUrl: string;
    rpcUrl: string;
    transactionHashes: string[];
    rpcQuorum?: RpcQuorumEvidence & Record<string, unknown>;
}
export declare function probePolymarketDataApi(config: PolymarketDataApiSourceConfig): Promise<PilotProbe>;
export declare class PolymarketDataApiSource implements SnapshotSource {
    private readonly config;
    private cache?;
    constructor(config: PolymarketDataApiSourceConfig);
    private probe;
    getHead(): Promise<HeadSnapshot>;
    getState(_key: string): Promise<StateValue | undefined>;
    getEvents(_stream: string): Promise<EventRecord[]>;
    getTransactionCompleteness(stream: string, request: TransactionCompletenessRequest): Promise<TransactionCompletenessSnapshot>;
    getProvenance(stream: string): Promise<ProvenanceSnapshot>;
    getFreshness(stream: string): Promise<FreshnessSnapshot>;
}
export {};
