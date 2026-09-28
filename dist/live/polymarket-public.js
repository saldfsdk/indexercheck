export const DEFAULT_POLYGON_RPC_URLS = [
    "https://polygon.drpc.org",
    "https://polygon.lava.build",
    "https://polygon-bor-rpc.publicnode.com"
];
export const DEFAULT_GOLDSKY_ORDERBOOK_URLS = [
    "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn",
    "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/prod/gn",
    "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/polymarket-orderbook-resync/prod/gn"
];
export const DEFAULT_POLYGON_RPC_URL = DEFAULT_POLYGON_RPC_URLS[0];
export const DEFAULT_GOLDSKY_ORDERBOOK_URL = DEFAULT_GOLDSKY_ORDERBOOK_URLS[0];
export const POLYMARKET_EXCHANGE = "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e";
export const POLYMARKET_NEG_RISK_EXCHANGE = "0xc5d563a36ae78145c45a50134d48a1215220f80a";
export const ORDER_FILLED_TOPIC0 = "0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6";
class HttpStatusError extends Error {
    status;
    retryAfterMs;
    constructor(status, message, retryAfterMs) {
        super(message);
        this.status = status;
        this.retryAfterMs = retryAfterMs;
        this.name = "HttpStatusError";
    }
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function parseRetryAfter(value) {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return Math.ceil(seconds * 1000);
    const dateMs = Date.parse(value);
    if (Number.isFinite(dateMs))
        return Math.max(0, dateMs - Date.now());
    return undefined;
}
function retryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
async function postJson(url, body, label) {
    let last;
    const delays = [2000, 4000, 8000];
    for (let attempt = 0; attempt < 4; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json", "user-agent": "indexercheck-m0.3.1" },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            if (!res.ok) {
                const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
                const error = new HttpStatusError(res.status, `${label} HTTP ${res.status}`, retryAfterMs);
                if (!retryableStatus(res.status))
                    throw error;
                throw error;
            }
            return await res.json();
        }
        catch (error) {
            last = error;
            const isStatus = error instanceof HttpStatusError;
            const canRetry = !isStatus || retryableStatus(error.status);
            if (attempt >= 3 || !canRetry)
                break;
            const base = delays[attempt] ?? 8000;
            const retryAfter = isStatus ? error.retryAfterMs : undefined;
            await sleep(Math.max(base, retryAfter ?? 0));
        }
        finally {
            clearTimeout(timer);
        }
    }
    throw last instanceof Error ? last : new Error(`${label} request failed`);
}
async function rpcSingle(url, method, params) {
    const body = await postJson(url, { jsonrpc: "2.0", id: 1, method, params }, `RPC ${method}`);
    if (body.error)
        throw new Error(`RPC ${method} ${body.error.code}: ${body.error.message}`);
    return body.result;
}
async function rpcWithFallback(urls, method, params) {
    const errors = [];
    for (const url of urls) {
        try {
            return { result: await rpcSingle(url, method, params), url };
        }
        catch (error) {
            errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`All Polygon RPC endpoints failed for ${method}: ${errors.join(" | ")}`);
}
async function gqlSingle(url, query) {
    const body = await postJson(url, { query }, "GraphQL");
    if (body.errors?.length)
        throw new Error(`GraphQL: ${body.errors.map((x) => x.message).join("; ")}`);
    return body.data;
}
async function gqlWithFallback(urls, query) {
    const errors = [];
    for (const url of urls) {
        try {
            return { data: await gqlSingle(url, query), url };
        }
        catch (error) {
            errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`All Goldsky GraphQL endpoints failed: ${errors.join(" | ")}`);
}
export function orderFilledKey(txHash, orderHash) {
    return `${txHash.toLowerCase()}:${orderHash.toLowerCase()}`;
}
export function findMissingKeys(canonical, indexed) {
    const set = new Set(Array.from(indexed, x => x.toLowerCase()));
    return Array.from(canonical, x => x.toLowerCase()).filter(x => !set.has(x));
}
function hexBlock(n) { return `0x${n.toString(16)}`; }
function num(v) { return typeof v === "number" ? v : Number(BigInt(v)); }
async function getOrderFilledLogs(rpcUrls, address, block) {
    const { result, url } = await rpcWithFallback(rpcUrls, "eth_getLogs", [{ address, topics: [ORDER_FILLED_TOPIC0], fromBlock: hexBlock(block), toBlock: hexBlock(block) }]);
    return { logs: Array.isArray(result) ? result : [], url };
}
export async function runPolymarketPublicBenchmark(opts) {
    const rpcUrls = opts?.rpcUrl ? [opts.rpcUrl] : (opts?.rpcUrls?.length ? opts.rpcUrls : DEFAULT_POLYGON_RPC_URLS);
    const graphqlUrls = opts?.graphqlUrl ? [opts.graphqlUrl] : (opts?.graphqlUrls?.length ? opts.graphqlUrls : DEFAULT_GOLDSKY_ORDERBOOK_URLS);
    const maxLagBlocks = opts?.maxLagBlocks ?? 1500;
    const latestQuery = `query LiveAnchor {
    _meta { block { number hash } hasIndexingErrors }
    orderFilledEvents(first: 1, orderBy: timestamp, orderDirection: desc) {
      transactionHash orderHash timestamp
    }
  }`;
    const latest = await gqlWithFallback(graphqlUrls, latestQuery);
    const latestData = latest.data;
    const graphqlUrl = latest.url;
    if (latestData?._meta?.hasIndexingErrors)
        throw new Error("Public indexer reports hasIndexingErrors=true");
    const indexedHead = num(latestData?._meta?.block?.number);
    const anchor = latestData?.orderFilledEvents?.[0];
    if (!anchor?.transactionHash || !anchor?.orderHash)
        throw new Error("Public indexer returned no OrderFilled anchor event");
    const latestRpc = await rpcWithFallback(rpcUrls, "eth_getBlockByNumber", ["latest", false]);
    const latestBlock = latestRpc.result;
    let rpcUrl = latestRpc.url;
    const chainHead = num(latestBlock.number);
    const headLag = chainHead - indexedHead;
    if (headLag < 0)
        throw new Error(`Indexer head ${indexedHead} is ahead of RPC head ${chainHead}`);
    if (headLag > maxLagBlocks)
        throw new Error(`Indexer head lag ${headLag} exceeds max ${maxLagBlocks}`);
    const receiptResult = await rpcWithFallback([rpcUrl, ...rpcUrls.filter(x => x !== rpcUrl)], "eth_getTransactionReceipt", [String(anchor.transactionHash)]);
    rpcUrl = receiptResult.url;
    const receipt = receiptResult.result;
    if (!receipt?.blockNumber)
        throw new Error(`RPC could not resolve anchor transaction ${anchor.transactionHash}`);
    const anchorBlock = num(receipt.blockNumber);
    const blockResult = await rpcWithFallback([rpcUrl, ...rpcUrls.filter(x => x !== rpcUrl)], "eth_getBlockByNumber", [hexBlock(anchorBlock), false]);
    rpcUrl = blockResult.url;
    const block = blockResult.result;
    if (!block?.timestamp)
        throw new Error(`RPC could not resolve anchor block ${anchorBlock}`);
    const ts = num(block.timestamp);
    const indexedRange = await gqlSingle(graphqlUrl, `query BlockEvents {
    orderFilledEvents(
      first: 1000,
      where: { timestamp_gte: "${ts}", timestamp_lte: "${ts}" },
      orderBy: timestamp,
      orderDirection: asc
    ) { transactionHash orderHash timestamp }
  }`);
    const indexedEvents = indexedRange?.orderFilledEvents ?? [];
    const indexedKeys = indexedEvents.map(e => orderFilledKey(String(e.transactionHash), String(e.orderHash)));
    const orderedRpcUrls = [rpcUrl, ...rpcUrls.filter(x => x !== rpcUrl)];
    const standard = await getOrderFilledLogs(orderedRpcUrls, POLYMARKET_EXCHANGE, anchorBlock);
    rpcUrl = standard.url;
    const negRisk = await getOrderFilledLogs([rpcUrl, ...rpcUrls.filter(x => x !== rpcUrl)], POLYMARKET_NEG_RISK_EXCHANGE, anchorBlock);
    rpcUrl = negRisk.url;
    const canonicalLogs = [...standard.logs, ...negRisk.logs];
    if (canonicalLogs.length === 0)
        throw new Error(`No canonical OrderFilled logs found in anchor block ${anchorBlock}`);
    const canonicalKeys = canonicalLogs.map(log => {
        const orderHash = log?.topics?.[1];
        if (!log?.transactionHash || !orderHash)
            throw new Error("Canonical OrderFilled log missing txHash/orderHash");
        return orderFilledKey(String(log.transactionHash), String(orderHash));
    });
    const missingKeys = findMissingKeys(canonicalKeys, indexedKeys);
    if (missingKeys.length)
        throw new Error(`EVENT_COMPLETENESS failed: ${missingKeys.length}/${canonicalKeys.length} canonical OrderFilled event(s) missing from public indexer`);
    const anchorKey = orderFilledKey(String(anchor.transactionHash), String(anchor.orderHash));
    if (!canonicalKeys.includes(anchorKey))
        throw new Error("Indexed anchor event is not present in canonical receipt/logs");
    return { chainHead, indexedHead, headLag, anchorBlock, anchorTx: String(anchor.transactionHash).toLowerCase(), canonicalEvents: canonicalKeys.length, indexedEventsAtTimestamp: indexedKeys.length, missingKeys, rpcUrl, graphqlUrl };
}
//# sourceMappingURL=polymarket-public.js.map