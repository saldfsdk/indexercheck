import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkEventCompleteness } from "../core/primitives.js";
import { verify } from "../core/verifier.js";
import { JsonRpcSource } from "../sources/json-rpc.js";
import { GraphQlSource } from "../sources/graphql.js";
import { HttpJsonSource } from "../sources/http-json.js";
const TOKEN = "0x00000000000000000000000000000000000000aa";
const TOPIC0 = `0x${"ab".repeat(32)}`;
function tx(n) { return `0x${n.toString(16).padStart(64, "0")}`; }
function canonicalLog(blockNumber, ordinal) {
    return {
        transactionHash: tx(ordinal),
        logIndex: "0x0",
        blockNumber: `0x${blockNumber.toString(16)}`,
        blockHash: `0x${(blockNumber + 5000).toString(16).padStart(64, "0")}`,
        address: TOKEN,
        topics: [TOPIC0],
        data: "0x",
    };
}
const canonicalLogs = [
    canonicalLog(104, 1),
    canonicalLog(106, 2),
    canonicalLog(108, 3),
    canonicalLog(109, 4),
];
const rows = canonicalLogs.map((log) => ({
    transactionHash: log.transactionHash,
    logIndex: 0,
    blockNumber: Number(BigInt(log.blockNumber)),
}));
function rowsInRange(fromBlock, toBlock, missingBlock) {
    return rows.filter((row) => row.blockNumber >= fromBlock && row.blockNumber <= toBlock && row.blockNumber !== missingBlock);
}
async function withServer(fn) {
    const server = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req)
            raw += chunk;
        res.setHeader("content-type", "application/json");
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/rest") {
            res.end(JSON.stringify({ rows }));
            return;
        }
        if (url.pathname === "/rest-range" || url.pathname === "/rest-range-missing") {
            const from = Number(url.searchParams.get("fromBlock"));
            const to = Number(url.searchParams.get("toBlock"));
            const missing = url.pathname.endsWith("missing") ? 106 : undefined;
            res.end(JSON.stringify({ rows: rowsInRange(from, to, missing) }));
            return;
        }
        if (url.pathname === "/graphql") {
            const body = JSON.parse(raw || "{}");
            const from = Number(body.variables?.fromBlock ?? 0);
            const to = Number(body.variables?.toBlock ?? 999999);
            res.end(JSON.stringify({ data: { transfers: rowsInRange(from, to) } }));
            return;
        }
        if (url.pathname === "/rpc-c") {
            res.statusCode = 503;
            res.end(JSON.stringify({ error: "down" }));
            return;
        }
        const body = JSON.parse(raw || "{}");
        if (body.method === "eth_getBlockByNumber") {
            const tag = String(body.params?.[0] ?? "latest");
            const number = tag === "latest" ? 110 : Number(BigInt(tag));
            res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { number: `0x${number.toString(16)}`, hash: `0x${number.toString(16).padStart(64, "0")}`, parentHash: `0x${(number - 1).toString(16).padStart(64, "0")}` } }));
            return;
        }
        if (body.method === "eth_getLogs") {
            const filter = body.params?.[0] ?? {};
            const from = Number(BigInt(filter.fromBlock));
            const to = Number(BigInt(filter.toBlock));
            res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: canonicalLogs.filter((log) => Number(BigInt(log.blockNumber)) >= from && Number(BigInt(log.blockNumber)) <= to) }));
            return;
        }
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    try {
        await fn(base);
    }
    finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
}
function canonical(base) {
    return new JsonRpcSource({
        type: "json-rpc",
        url: `${base}/rpc-a`,
        fallbackUrls: [`${base}/rpc-b`, `${base}/rpc-c`],
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8 },
        headTag: "latest",
        events: { Transfer: { address: TOKEN, topics: [TOPIC0], fromBlock: 0, toBlock: "latest", eventName: "Transfer" } },
    });
}
const check = {
    name: "generic-transfer-completeness",
    stream: "Transfer",
    proof: { type: "evm-log-reverse", canonicalStream: "Transfer", windowBlocks: 7, settlementLagBlocks: 2 },
};
test("M2.1 GraphQL range query proves generic reverse completeness with settlement watermark", async () => withServer(async (base) => {
    const indexed = new GraphQlSource({
        type: "graphql",
        url: `${base}/graphql`,
        events: {
            Transfer: {
                query: "query Transfers($fromBlock: Int!, $toBlock: Int!) { transfers { transactionHash logIndex blockNumber } }",
                arrayPath: "transfers",
                blockPath: "blockNumber",
                txHashPath: "transactionHash",
                logIndexPath: "logIndex",
                historicalFromBlockVariable: "fromBlock",
                historicalToBlockVariable: "toBlock",
                historicalRangeComplete: true,
            },
        },
    });
    const result = await checkEventCompleteness(canonical(base), indexed, check);
    assert.equal(result.status, "PASS");
    assert.equal(result.evidence?.fromBlock, 102);
    assert.equal(result.evidence?.toBlock, 108);
    assert.equal(result.evidence?.canonicalCount, 3);
    assert.equal(result.evidence?.matchedCount, 3);
    assert.equal((result.evidence?.canonicalRange).rpcQuorum.agreeingProviders.length, 2);
    assert.equal((result.evidence?.canonicalRange).rpcQuorum.failedProviders.length, 1);
}));
test("M2.1 REST range query detects a canonical event missing from the indexer", async () => withServer(async (base) => {
    const indexed = new HttpJsonSource({
        type: "http-json",
        url: `${base}/rest`,
        events: {
            Transfer: {
                arrayPath: "rows",
                blockPath: "blockNumber",
                txHashPath: "transactionHash",
                logIndexPath: "logIndex",
                historicalRequest: { url: `${base}/rest-range-missing?fromBlock={{fromBlock}}&toBlock={{toBlock}}` },
                historicalRangeComplete: true,
            },
        },
    });
    const result = await checkEventCompleteness(canonical(base), indexed, check);
    assert.equal(result.status, "FAIL");
    assert.equal(result.evidence?.classification, "MISSING_EVENTS");
    assert.equal(result.evidence?.missingCount, 1);
    assert.deepEqual(result.evidence?.missingEventIds, [`${tx(2)}:0`]);
    assert.equal((result.evidence?.missingEventBlocks)[`${tx(2)}:0`], 106);
    assert.equal(result.evidence?.maxMissingDepthBlocks, 2);
    const config = {
        name: "missing-event",
        canonical: { type: "json-rpc", url: `${base}/rpc-a`, fallbackUrls: [`${base}/rpc-b`, `${base}/rpc-c`], rpcQuorum: { minAgreement: 2 }, headTag: "latest", events: { Transfer: { address: TOKEN, topics: [TOPIC0], fromBlock: 0, toBlock: "latest" } } },
        indexed: { type: "http-json", url: `${base}/rest`, events: { Transfer: { arrayPath: "rows", blockPath: "blockNumber", txHashPath: "transactionHash", logIndexPath: "logIndex", historicalRequest: { url: `${base}/rest-range-missing?fromBlock={{fromBlock}}&toBlock={{toBlock}}` }, historicalRangeComplete: true } } },
        checks: { eventCompleteness: [check] },
    };
    const report = await verify(config, canonical(base), indexed);
    assert.equal(report.verdict, "INCOMPLETE");
}));
test("M2.1 refuses false missing verdict when indexed range completeness is not proven", async () => withServer(async (base) => {
    const indexed = new HttpJsonSource({
        type: "http-json",
        url: `${base}/rest`,
        events: {
            Transfer: {
                arrayPath: "rows",
                blockPath: "blockNumber",
                txHashPath: "transactionHash",
                logIndexPath: "logIndex",
                historicalRequest: { url: `${base}/rest-range-missing?fromBlock={{fromBlock}}&toBlock={{toBlock}}` },
                historicalRangeComplete: false,
            },
        },
    });
    const result = await checkEventCompleteness(canonical(base), indexed, check);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.evidence?.classification, "UNPROVEN_INDEXED_RANGE");
    assert.equal(result.evidence?.coverageProven, false);
}));
test("M2.1 settlement lag excludes canonical frontier events from completeness verdict", async () => withServer(async (base) => {
    const indexed = new HttpJsonSource({
        type: "http-json",
        url: `${base}/rest`,
        events: {
            Transfer: {
                arrayPath: "rows",
                blockPath: "blockNumber",
                txHashPath: "transactionHash",
                logIndexPath: "logIndex",
                historicalRequest: { url: `${base}/rest-range?fromBlock={{fromBlock}}&toBlock={{toBlock}}` },
                historicalRangeComplete: true,
            },
        },
    });
    const result = await checkEventCompleteness(canonical(base), indexed, check);
    assert.equal(result.status, "PASS");
    assert.equal(result.evidence?.verifiedThroughBlock, 108);
    assert.equal((result.evidence?.missingEventIds).includes(`${tx(4)}:0`), false);
    assert.equal(result.evidence?.settlementLagBlocks, 2);
}));
test("M2.1 unavailable canonical head becomes UNKNOWN instead of process failure", async () => {
    const canonicalUnavailable = {
        getHead: async () => { throw new Error("all canonical RPC providers unavailable"); },
        getState: async () => undefined,
        getEvents: async () => [],
    };
    const indexed = {
        getHead: async () => ({ blockNumber: 100 }),
        getState: async () => undefined,
        getEvents: async () => [],
        getEventsAtWithEvidence: async () => ({ events: [], metadata: { coverageProven: true } }),
    };
    const result = await checkEventCompleteness(canonicalUnavailable, indexed, check);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.evidence?.classification, "CANONICAL_PROOF_UNAVAILABLE");
});
//# sourceMappingURL=m2.1-generic-reverse-completeness.test.js.map