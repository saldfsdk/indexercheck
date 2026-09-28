export declare const DEFAULT_POLYGON_RPC_URLS: string[];
export declare const DEFAULT_POLYMARKET_DATA_URLS: string[];
export declare function polymarketStatusUrl(dataUrl?: string): string;
export declare const POLYMARKET_V2_EXCHANGES: string[];
export declare const POLYMARKET_V1_EXCHANGES: string[];
export declare const ORDER_FILLED_TOPIC_V2 = "0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee";
export declare const ORDER_FILLED_TOPIC_V1 = "0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6";
export interface IndexedTrade {
    transactionHash: string;
    timestamp?: number;
    source: "v2" | "v1";
}
export interface TradeProof {
    transactionHash: string;
    blockNumber: number;
    exchange: string;
    topic0: string;
}
export interface LiveDataApiBenchmarkResult {
    chainHead: number;
    sampledTrades: number;
    uniqueTransactions: number;
    verifiedTransactions: number;
    latestVerifiedBlock: number;
    latestVerifiedLagBlocks: number;
    rpcUrl: string;
    dataUrl: string;
    proofs: TradeProof[];
}
export declare function findOrderFilledProof(receipt: any): TradeProof | undefined;
export declare function runPolymarketDataApiBenchmark(opts?: {
    rpcUrl?: string;
    rpcUrls?: string[];
    dataUrl?: string;
    dataUrls?: string[];
    sampleSize?: number;
    maxAnchorLagBlocks?: number;
}): Promise<LiveDataApiBenchmarkResult>;
