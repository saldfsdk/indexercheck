export type PrimitiveKind = "CANONICAL_HEAD" | "SOURCE_FRESHNESS" | "STATE_PARITY" | "EVENT_COMPLETENESS" | "TRANSACTION_COMPLETENESS" | "PROVENANCE" | "FIRST_DIVERGENCE" | "ROOT_CAUSE_EVIDENCE" | "INCIDENT_REPORT";
export type CheckStatus = "PASS" | "FAIL" | "UNKNOWN";
export type Verdict = "PASS" | "DRIFT" | "INCOMPLETE" | "STALLED" | "UNKNOWN";
export type RootCauseKind = "MISSED_EVENT" | "CONTRACT_UPGRADE" | "REORG_OR_FORK" | "UNKNOWN";
export type RootCauseConfidence = "HIGH" | "MEDIUM" | "LOW";
export interface HeadSnapshot {
    blockNumber: number;
    blockHash?: string;
    observedAt?: string;
    reportedHealthy?: boolean;
    reportedSynced?: boolean;
}
export interface StateValue {
    key: string;
    value: string;
    blockNumber?: number;
    payload?: unknown;
    metadata?: Record<string, unknown>;
}
export interface EventRecord {
    id: string;
    blockNumber: number;
    txHash?: string;
    logIndex?: number;
    address?: string;
    eventName?: string;
    payload?: Record<string, unknown>;
}
export interface EvmCallArgumentProofConfig {
    type: EvmStaticAbiType;
    indexedPath?: string;
    value?: string | number | boolean;
}
export interface EvmCallStateProofConfig {
    type: "evm-call";
    to: string;
    selector: string;
    args?: EvmCallArgumentProofConfig[];
    returnType: EvmStaticAbiType;
}
export interface StateParityCheckConfig {
    name: string;
    key: string;
    description?: string;
    proof?: EvmCallStateProofConfig;
}
export interface EvmLogReverseCompletenessProofConfig {
    type: "evm-log-reverse";
    canonicalStream?: string;
    windowBlocks?: number;
    settlementLagBlocks?: number;
}
export interface EventCompletenessCheckConfig {
    name: string;
    stream: string;
    description?: string;
    proof?: EvmLogReverseCompletenessProofConfig;
}
export interface HeadCheckConfig {
    name?: string;
    maxLagBlocks?: number;
}
export type EvmStaticAbiType = "address" | "bool" | `uint${number}` | `int${number}` | `bytes${number}`;
export interface EvmLogInputProofConfig {
    name: string;
    type: EvmStaticAbiType;
    indexed: boolean;
    indexedPath?: string;
}
export interface EvmLogProvenanceProofConfig {
    type: "evm-log";
    canonicalStream?: string;
    sampleSize?: number;
    inputs?: EvmLogInputProofConfig[];
}
export interface ProvenanceCheckConfig {
    name: string;
    stream: string;
    minSamples?: number;
    description?: string;
    proof?: EvmLogProvenanceProofConfig;
}
export interface TransactionCompletenessCheckConfig {
    name: string;
    stream: string;
    windowBlocks?: number;
    indexedPageSize?: number;
    maxPages?: number;
    settlementLagBlocks?: number;
    description?: string;
}
export interface SourceFreshnessCheckConfig {
    name: string;
    stream: string;
    maxAgeSeconds?: number;
    maxLagBlocks?: number;
    activityGraceBlocks?: number;
    description?: string;
}
export type FirstDivergenceStrategy = "linear" | "binary-monotonic";
export type FirstDivergenceTarget = {
    primitive: "STATE_PARITY";
    key: string;
} | {
    primitive: "EVENT_COMPLETENESS";
    stream: string;
    startBlock: number;
};
export interface FirstDivergenceCheckConfig {
    name: string;
    target: FirstDivergenceTarget;
    fromBlock: number;
    toBlock?: number;
    strategy?: FirstDivergenceStrategy;
    maxChecks?: number;
    description?: string;
}
export interface RootCauseEvidenceCheckConfig {
    name: string;
    divergence: string;
    eventStreams?: string[];
    upgradeEventStreams?: string[];
    upgradeStateKeys?: string[];
    description?: string;
}
export interface IncidentReportCheckConfig {
    name: string;
    divergence: string;
    rootCause: string;
    affectedCheck: string;
    description?: string;
}
export interface FixtureSourceConfig {
    type: "fixture";
    file: string;
}
export type RpcDecode = "hex" | "uint256" | "bool" | "address";
export interface RpcStateMapping {
    to: string;
    data: string;
    blockTag?: string;
    decode?: RpcDecode;
}
export interface RpcEventMapping {
    address?: string;
    topics?: Array<string | null>;
    fromBlock: number | string;
    toBlock: number | string;
    eventName?: string;
}
export interface RpcQuorumSettings {
    minAgreement?: number;
    maxHeadSkewBlocks?: number;
    agreementLagBlocks?: number;
}
export interface JsonRpcSourceConfig {
    type: "json-rpc";
    url: string;
    fallbackUrls?: string[];
    headers?: Record<string, string>;
    rpcQuorum?: RpcQuorumSettings;
    headTag?: string;
    state?: Record<string, RpcStateMapping>;
    events?: Record<string, RpcEventMapping>;
}
export interface GraphQlFieldMapping {
    query: string;
    variables?: Record<string, unknown>;
    valuePath: string;
    blockPath?: string;
    historicalBlockVariable?: string;
}
export interface GraphQlEventMapping {
    query: string;
    variables?: Record<string, unknown>;
    arrayPath: string;
    idPath?: string;
    blockPath: string;
    txHashPath?: string;
    logIndexPath?: string;
    addressPath?: string;
    eventName?: string;
    historicalFromBlockVariable?: string;
    historicalToBlockVariable?: string;
    historicalRangeComplete?: boolean;
}
export interface GraphQlSourceConfig {
    type: "graphql";
    url: string;
    fallbackUrls?: string[];
    headers?: Record<string, string>;
    head?: {
        query: string;
        variables?: Record<string, unknown>;
        blockPath: string;
        hashPath?: string;
        healthyPath?: string;
        syncedPath?: string;
        historicalBlockVariable?: string;
    };
    state?: Record<string, GraphQlFieldMapping>;
    events?: Record<string, GraphQlEventMapping>;
}
export interface HttpJsonRequestConfig {
    url?: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: unknown;
}
export interface HttpJsonStateMapping extends HttpJsonRequestConfig {
    valuePath: string;
    blockPath?: string;
}
export interface HttpJsonHeadMapping extends HttpJsonRequestConfig {
    blockPath: string;
    hashPath?: string;
    healthyPath?: string;
    syncedPath?: string;
}
export interface HttpJsonEventMapping extends HttpJsonRequestConfig {
    arrayPath: string;
    idPath?: string;
    blockPath: string;
    txHashPath?: string;
    logIndexPath?: string;
    addressPath?: string;
    eventName?: string;
    historicalRequest?: HttpJsonRequestConfig;
    historicalRangeComplete?: boolean;
}
export interface HttpJsonSourceConfig extends HttpJsonRequestConfig {
    type: "http-json";
    url: string;
    head?: HttpJsonHeadMapping;
    state?: Record<string, HttpJsonStateMapping>;
    events?: Record<string, HttpJsonEventMapping>;
}
export interface AdapterSourceConfig {
    type: "adapter";
    module: string;
    options?: unknown;
}
export interface GoldskyErc20SubgraphSourceConfig {
    type: "goldsky-erc20-subgraph";
    graphqlUrl: string;
    rpcUrls: string[];
    rpcQuorum?: RpcQuorumSettings;
    tokenAddress: string;
    sampleSize?: number;
    headers?: Record<string, string>;
}
export interface GoldskyEulerSubgraphSourceConfig {
    type: "goldsky-euler-subgraph";
    graphqlUrl: string;
    rpcUrls: string[];
    rpcQuorum?: RpcQuorumSettings;
    sampleSize?: number;
    headers?: Record<string, string>;
}
export interface PolymarketDataApiSourceConfig {
    type: "polymarket-data-api";
    dataUrls?: string[];
    rpcUrls?: string[];
    rpcQuorum?: RpcQuorumSettings;
    sampleSize?: number;
    maxAnchorLagBlocks?: number;
    freshnessScanMaxBlocks?: number;
    cacheTtlMs?: number;
}
export type SourceConfig = FixtureSourceConfig | JsonRpcSourceConfig | GraphQlSourceConfig | HttpJsonSourceConfig | AdapterSourceConfig | PolymarketDataApiSourceConfig | GoldskyErc20SubgraphSourceConfig | GoldskyEulerSubgraphSourceConfig;
export interface WatchConfig {
    confirmConsecutiveFailures?: Partial<Record<PrimitiveKind, number>>;
}
export interface IndexerCheckConfig {
    name: string;
    canonical: SourceConfig;
    indexed: SourceConfig;
    watch?: WatchConfig;
    checks: {
        head?: HeadCheckConfig;
        sourceFreshness?: SourceFreshnessCheckConfig[];
        stateParity?: StateParityCheckConfig[];
        eventCompleteness?: EventCompletenessCheckConfig[];
        transactionCompleteness?: TransactionCompletenessCheckConfig[];
        provenance?: ProvenanceCheckConfig[];
        firstDivergence?: FirstDivergenceCheckConfig[];
        rootCauseEvidence?: RootCauseEvidenceCheckConfig[];
        incidentReports?: IncidentReportCheckConfig[];
    };
}
/**
 * M0.6 semantics:
 * - observedAtBlock = where a direct observation was made.
 * - firstBadBlock / lastGoodBlock are reserved for FIRST_DIVERGENCE only.
 */
export interface PrimitiveResult {
    primitive: PrimitiveKind;
    name: string;
    status: CheckStatus;
    summary: string;
    observedAtBlock?: number;
    firstBadBlock?: number;
    lastGoodBlock?: number;
    evidence?: Record<string, unknown>;
}
export interface VerificationReport {
    name: string;
    verdict: Verdict;
    generatedAt: string;
    canonicalHead?: HeadSnapshot;
    indexedHead?: HeadSnapshot;
    results: PrimitiveResult[];
}
