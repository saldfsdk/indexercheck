import { normalizeReceiptForQuorum, rpcExactQuorum, rpcHeadQuorum } from "../live/rpc-quorum.js";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
function normalizeAddress(value) {
    const raw = String(value ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(raw))
        return raw;
    return raw;
}
function topicAddress(topic) {
    const raw = String(topic ?? "").toLowerCase();
    return raw.length >= 42 ? `0x${raw.slice(-40)}` : raw;
}
function normalizeUint(value) {
    const raw = String(value ?? "0");
    try {
        return BigInt(raw).toString(10);
    }
    catch {
        return raw;
    }
}
function dataUint(value) {
    const raw = String(value ?? "0x0");
    try {
        return BigInt(raw).toString(10);
    }
    catch {
        return raw;
    }
}
function parseGoldskyId(id) {
    const raw = String(id ?? "").toLowerCase();
    const match = raw.match(/^(0x[0-9a-f]{64})[-:](\d+)$/);
    if (!match)
        return {};
    return { transactionHash: match[1], logIndex: Number(match[2]) };
}
export class GoldskyErc20SubgraphSource {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    urls() { return [...new Set(this.cfg.rpcUrls ?? [])]; }
    quorumMin() { return Math.max(1, this.cfg.rpcQuorum?.minAgreement ?? 2); }
    async rpcSingle(url, method, params) {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body.error)
            throw new Error(`${body.error.code}: ${body.error.message}`);
        return body.result;
    }
    async gql(query, variables = {}) {
        const res = await fetch(this.cfg.graphqlUrl, { method: "POST", headers: { "content-type": "application/json", ...(this.cfg.headers ?? {}) }, body: JSON.stringify({ query, variables }) });
        if (!res.ok)
            throw new Error(`Goldsky GraphQL HTTP ${res.status}`);
        const body = await res.json();
        if (body.errors?.length)
            throw new Error(`Goldsky GraphQL: ${body.errors.map((x) => x.message).join("; ")}`);
        return body.data;
    }
    async canonicalHead() {
        return rpcHeadQuorum(this.urls(), "latest", (url, method, params) => this.rpcSingle(url, method, params), this.quorumMin(), Math.max(0, this.cfg.rpcQuorum?.maxHeadSkewBlocks ?? 8), Math.max(0, this.cfg.rpcQuorum?.agreementLagBlocks ?? 3));
    }
    async getHead() {
        const data = await this.gql(`query IndexerCheckGoldskyMeta { _meta { block { number hash } hasIndexingErrors } }`);
        const block = data?._meta?.block;
        if (block?.number === undefined || block?.number === null)
            throw new Error("Goldsky _meta block number unavailable");
        return {
            blockNumber: Number(block.number),
            blockHash: block.hash ? String(block.hash).toLowerCase() : undefined,
            reportedHealthy: data?._meta?.hasIndexingErrors === false,
            reportedSynced: true,
            observedAt: new Date().toISOString(),
        };
    }
    async getFreshness(stream) {
        const [indexed, canonical] = await Promise.all([this.getHead(), this.canonicalHead()]);
        const lagBlocks = Math.max(0, canonical.evidence.agreedBlockNumber - indexed.blockNumber);
        return {
            stream,
            anchorBlock: indexed.blockNumber,
            chainHead: canonical.evidence.agreedBlockNumber,
            lagBlocks,
            metadata: {
                freshnessBasis: "goldsky-subgraph-meta",
                graphqlUrl: this.cfg.graphqlUrl,
                tokenAddress: this.cfg.tokenAddress.toLowerCase(),
                indexedMetaBlock: indexed.blockNumber,
                rpcQuorum: canonical.evidence,
            },
            reportedFreshness: {
                basis: "goldsky-subgraph-meta",
                available: true,
                lagBlocks,
                observedAt: indexed.observedAt,
                metadata: {
                    indexedMetaBlock: indexed.blockNumber,
                    canonicalQuorumHead: canonical.evidence.agreedBlockNumber,
                },
            },
        };
    }
    async getProvenance(stream) {
        const sampleSize = Math.max(1, Math.min(this.cfg.sampleSize ?? 3, 20));
        // This query intentionally uses only fields demonstrated by Kaia's public
        // Goldsky USDT example. The id encodes txHash-logIndex, allowing canonical
        // receipt verification without depending on optional schema metadata.
        const data = await this.gql(`query IndexerCheckGoldskyTransfers($first: Int!) {
      transfers(first: $first, orderBy: value, orderDirection: desc) { id from to value }
    }`, { first: sampleSize });
        const rows = Array.isArray(data?.transfers) ? data.transfers : [];
        const failures = [];
        let verified = 0;
        let observedAtBlock;
        const evidenceRows = [];
        for (const row of rows.slice(0, sampleSize)) {
            const parsed = parseGoldskyId(row?.id);
            if (!parsed.transactionHash || parsed.logIndex === undefined) {
                failures.push({ reason: `Unrecognized Goldsky transfer id '${String(row?.id ?? "")}'` });
                continue;
            }
            try {
                const receiptQ = await rpcExactQuorum(this.urls(), "eth_getTransactionReceipt", [parsed.transactionHash], (url, method, params) => this.rpcSingle(url, method, params), this.quorumMin(), normalizeReceiptForQuorum);
                const receipt = receiptQ.result;
                const blockNumber = receipt?.blockNumber ? Number(BigInt(receipt.blockNumber)) : undefined;
                if (blockNumber !== undefined)
                    observedAtBlock = Math.max(observedAtBlock ?? 0, blockNumber);
                const log = Array.isArray(receipt?.logs)
                    ? receipt.logs.find((item) => Number(BigInt(item?.logIndex ?? "0x-1")) === parsed.logIndex)
                    : undefined;
                if (!log) {
                    failures.push({ transactionHash: parsed.transactionHash, reason: `Canonical receipt has no logIndex ${parsed.logIndex}` });
                    continue;
                }
                const addressOk = normalizeAddress(log.address) === normalizeAddress(this.cfg.tokenAddress);
                const topicOk = String(log.topics?.[0] ?? "").toLowerCase() === TRANSFER_TOPIC;
                const fromOk = topicAddress(log.topics?.[1]) === normalizeAddress(row.from);
                const toOk = topicAddress(log.topics?.[2]) === normalizeAddress(row.to);
                const valueOk = dataUint(log.data) === normalizeUint(row.value);
                if (!(addressOk && topicOk && fromOk && toOk && valueOk)) {
                    failures.push({ transactionHash: parsed.transactionHash, reason: `Canonical Transfer payload differs from indexed row id=${row.id}` });
                    evidenceRows.push({ id: row.id, transactionHash: parsed.transactionHash, logIndex: parsed.logIndex, addressOk, topicOk, fromOk, toOk, valueOk });
                    continue;
                }
                verified += 1;
                evidenceRows.push({ id: row.id, transactionHash: parsed.transactionHash, logIndex: parsed.logIndex, blockNumber, canonicalQuorum: receiptQ.evidence });
            }
            catch (error) {
                failures.push({ transactionHash: parsed.transactionHash, reason: error instanceof Error ? error.message : String(error) });
            }
        }
        return {
            stream,
            sampled: Math.min(rows.length, sampleSize),
            verified,
            failures,
            observedAtBlock,
            metadata: {
                graphqlUrl: this.cfg.graphqlUrl,
                tokenAddress: this.cfg.tokenAddress.toLowerCase(),
                transferTopic: TRANSFER_TOPIC,
                rows: evidenceRows,
            },
        };
    }
    async getState(_key) { return undefined; }
    async getEvents(_stream) { return []; }
}
//# sourceMappingURL=goldsky-erc20-subgraph.js.map