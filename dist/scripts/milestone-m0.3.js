import { runPolymarketDataApiBenchmark } from "../live/polymarket-data-api.js";
const rpcUrl = process.env.INDEXERCHECK_RPC_URL;
const dataUrl = process.env.INDEXERCHECK_DATA_URL;
const sampleSize = process.env.INDEXERCHECK_SAMPLE_SIZE ? Number(process.env.INDEXERCHECK_SAMPLE_SIZE) : undefined;
const maxAnchorLagBlocks = process.env.INDEXERCHECK_MAX_ANCHOR_LAG_BLOCKS ? Number(process.env.INDEXERCHECK_MAX_ANCHOR_LAG_BLOCKS) : undefined;
try {
    const r = await runPolymarketDataApiBenchmark({ rpcUrl, dataUrl, sampleSize, maxAnchorLagBlocks });
    console.log("M0.3 external live: official Polymarket Data API + public Polygon JSON-RPC PASS");
    console.log(`M0.3 indexed provenance: uniqueTx=${r.uniqueTransactions} verifiedOrderFilled=${r.verifiedTransactions} PASS`);
    console.log(`M0.3 freshness: chain=${r.chainHead} latestIndexedTradeBlock=${r.latestVerifiedBlock} lag=${r.latestVerifiedLagBlocks} PASS`);
    console.log(`M0.3 Data API endpoint used: ${r.dataUrl}`);
    console.log(`M0.3 RPC endpoint used: ${r.rpcUrl}`);
}
catch (error) {
    console.error("M0.3 LIVE FAILED");
    console.error(error instanceof Error ? error.message : String(error));
    console.error("M0.3.2 uses Polymarket's official unauthenticated Data API by default. Override INDEXERCHECK_DATA_URL / INDEXERCHECK_RPC_URL if needed.");
    process.exitCode = 1;
}
//# sourceMappingURL=milestone-m0.3.js.map