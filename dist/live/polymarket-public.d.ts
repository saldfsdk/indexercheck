export declare const DEFAULT_POLYGON_RPC_URLS: string[];
export declare const DEFAULT_GOLDSKY_ORDERBOOK_URLS: string[];
export declare const DEFAULT_POLYGON_RPC_URL: string;
export declare const DEFAULT_GOLDSKY_ORDERBOOK_URL: string;
export declare const POLYMARKET_EXCHANGE = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";
export declare const POLYMARKET_NEG_RISK_EXCHANGE = "0xc5d563a36ae78145c45a50134d48a1215220f80a";
export declare const ORDER_FILLED_TOPIC0 = "0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6";
export interface LiveBenchmarkResult {
    chainHead: number;
    indexedHead: number;
    headLag: number;
    anchorBlock: number;
    anchorTx: string;
    canonicalEvents: number;
    indexedEventsAtTimestamp: number;
    missingKeys: string[];
    rpcUrl: string;
    graphqlUrl: string;
}
export declare function orderFilledKey(txHash: string, orderHash: string): string;
export declare function findMissingKeys(canonical: Iterable<string>, indexed: Iterable<string>): string[];
export declare function runPolymarketPublicBenchmark(opts?: {
    rpcUrl?: string;
    rpcUrls?: string[];
    graphqlUrl?: string;
    graphqlUrls?: string[];
    maxLagBlocks?: number;
}): Promise<LiveBenchmarkResult>;
