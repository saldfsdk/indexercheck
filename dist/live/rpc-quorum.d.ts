export interface RpcQuorumConfig {
    minAgreement?: number;
    maxHeadSkewBlocks?: number;
}
export interface RpcQuorumEvidence {
    [key: string]: unknown;
    method: string;
    minAgreement: number;
    successfulProviders: string[];
    agreeingProviders: string[];
    failedProviders: Array<{
        url: string;
        error: string;
    }>;
    distinctResponses: number;
}
export declare class RpcQuorumError extends Error {
    readonly evidence: RpcQuorumEvidence & Record<string, unknown>;
    constructor(message: string, evidence: RpcQuorumEvidence & Record<string, unknown>);
}
export type RpcCaller = (url: string, method: string, params: unknown[]) => Promise<any>;
export type RpcNormalizer = (value: any) => unknown;
export declare function stableFingerprint(value: unknown): string;
export declare function normalizeBlockForQuorum(block: any): unknown;
export declare function normalizeReceiptForQuorum(receipt: any): unknown;
export declare function normalizeLogsForQuorum(value: any): unknown;
export declare function rpcExactQuorum(urls: string[], method: string, params: unknown[], call: RpcCaller, minAgreement: number, normalize?: RpcNormalizer): Promise<{
    result: any;
    evidence: RpcQuorumEvidence;
}>;
export declare function rpcHeadQuorum(urls: string[], headTag: string, call: RpcCaller, minAgreement: number, maxHeadSkewBlocks: number, agreementLagBlocks?: number): Promise<{
    result: any;
    evidence: RpcQuorumEvidence & {
        observedHeads: Record<string, number>;
        observedMinHead: number;
        agreedBlockNumber: number;
        agreementLagBlocks: number;
        headSkewBlocks: number;
    };
}>;
