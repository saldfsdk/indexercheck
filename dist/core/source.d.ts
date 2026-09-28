import type { EventRecord, HeadSnapshot, StateValue } from "./types.js";
export interface ProvenanceFailure {
    transactionHash?: string;
    reason: string;
}
export interface ReportedFreshness {
    basis: string;
    available: boolean;
    ageSeconds?: number;
    lagBlocks?: number;
    observedAt?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
}
export interface FreshnessSnapshot {
    stream: string;
    anchorBlock?: number;
    chainHead?: number;
    lagBlocks?: number;
    anchorTimestamp?: string;
    ageSeconds?: number;
    canonicalActivityAfterAnchor?: boolean;
    latestCanonicalActivityBlock?: number;
    scanComplete?: boolean;
    metadata?: Record<string, unknown>;
    reportedFreshness?: ReportedFreshness;
}
export interface TransactionCompletenessRequest {
    windowBlocks: number;
    indexedPageSize: number;
    maxPages: number;
    settlementLagBlocks: number;
}
export interface TransactionCompletenessSnapshot {
    stream: string;
    fromBlock?: number;
    toBlock?: number;
    canonicalTransactions: number;
    indexedTransactions: number;
    matchedTransactions: number;
    missingTransactions: string[];
    missingTransactionBlocks?: Record<string, number>;
    oldestMissingBlock?: number;
    newestMissingBlock?: number;
    maxMissingDepthBlocks?: number;
    minMissingDepthBlocks?: number;
    coverageProven: boolean;
    oldestIndexedBlock?: number;
    newestIndexedBlock?: number;
    pageCount: number;
    metadata?: Record<string, unknown>;
}
export interface EventRangeSnapshot {
    events: EventRecord[];
    metadata?: Record<string, unknown>;
}
export interface EvmCallProofRequest {
    to: string;
    data: string;
    blockNumber: number;
}
export interface EvmCallProofSnapshot {
    value: string;
    blockNumber: number;
    metadata?: Record<string, unknown>;
}
export interface ProvenanceSnapshot {
    stream: string;
    sampled: number;
    verified: number;
    failures: ProvenanceFailure[];
    observedAtBlock?: number;
    metadata?: Record<string, unknown>;
}
export interface SnapshotSource {
    getHead(): Promise<HeadSnapshot>;
    getState(key: string): Promise<StateValue | undefined>;
    getEvents(stream: string): Promise<EventRecord[]>;
    getStateAt?(key: string, blockNumber: number): Promise<StateValue | undefined>;
    getEvmCallProof?(request: EvmCallProofRequest): Promise<EvmCallProofSnapshot>;
    getEventsAt?(stream: string, fromBlock: number, toBlock: number): Promise<EventRecord[]>;
    getEventsAtWithEvidence?(stream: string, fromBlock: number, toBlock: number): Promise<EventRangeSnapshot>;
    getBlockAt?(blockNumber: number): Promise<HeadSnapshot | undefined>;
    getProvenance?(stream: string): Promise<ProvenanceSnapshot>;
    getTransactionCompleteness?(stream: string, request: TransactionCompletenessRequest): Promise<TransactionCompletenessSnapshot>;
    getFreshness?(stream: string): Promise<FreshnessSnapshot>;
}
export declare class SourceUnavailableError extends Error {
    readonly sourceType: string;
    readonly operation: string;
    constructor(sourceType: string, operation: string, cause: unknown);
}
export declare function isSourceUnavailableError(error: unknown): error is SourceUnavailableError;
