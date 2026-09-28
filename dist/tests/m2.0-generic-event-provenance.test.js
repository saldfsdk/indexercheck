import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkProvenance } from "../core/primitives.js";
import { validateProjectConfig } from "../core/load-config.js";
import { JsonRpcSource } from "../sources/json-rpc.js";
import { GraphQlSource } from "../sources/graphql.js";
import { HttpJsonSource } from "../sources/http-json.js";
const TOKEN = "0x00000000000000000000000000000000000000aa";
const FROM = "0x0000000000000000000000000000000000000011";
const TO = "0x0000000000000000000000000000000000000022";
const TOPIC0 = `0x${"ab".repeat(32)}`;
function addressWord(address) { return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`; }
function uintWord(value) { return `0x${value.toString(16).padStart(64, "0")}`; }
function tx(n) { return `0x${n.toString(16).padStart(64, "0")}`; }
function canonicalLog(blockNumber, index) {
    return {
        transactionHash: tx(index + 1),
        logIndex: "0x0",
        blockNumber: `0x${blockNumber.toString(16)}`,
        blockHash: `0x${(blockNumber + 1000).toString(16).padStart(64, "0")}`,
        address: TOKEN,
        topics: [TOPIC0, addressWord(FROM), addressWord(TO)],
        data: uintWord(BigInt(100 + index)),
    };
}
const indexedRows = [100, 101, 102].map((blockNumber, index) => ({
    transactionHash: tx(index + 1),
    logIndex: 0,
    blockNumber,
    from: FROM,
    to: TO,
    value: String(100 + index),
}));
async function withServer(fn) {
    const server = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req)
            raw += chunk;
        res.setHeader("content-type", "application/json");
        if (req.url === "/rest") {
            res.end(JSON.stringify({ rows: indexedRows }));
            return;
        }
        if (req.url === "/graphql") {
            res.end(JSON.stringify({ data: { transfers: indexedRows } }));
            return;
        }
        if (String(req.url).startsWith("/rpc-c")) {
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
            const logs = from >= 100 && from <= 102 ? [canonicalLog(from, from - 100)] : [];
            res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: logs }));
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
const proof = {
    name: "generic-transfer-provenance",
    stream: "Transfer",
    minSamples: 3,
    proof: {
        type: "evm-log",
        canonicalStream: "Transfer",
        sampleSize: 3,
        inputs: [
            { name: "from", type: "address", indexed: true, indexedPath: "from" },
            { name: "to", type: "address", indexed: true, indexedPath: "to" },
            { name: "value", type: "uint256", indexed: false, indexedPath: "value" },
        ],
    },
};
test("M2.0 GraphQL rows verify against generic canonical EVM logs with 2-of-3 quorum", async () => withServer(async (base) => {
    const indexed = new GraphQlSource({
        type: "graphql",
        url: `${base}/graphql`,
        events: { Transfer: { query: "query Transfers { transfers { transactionHash logIndex blockNumber from to value } }", arrayPath: "transfers", txHashPath: "transactionHash", logIndexPath: "logIndex", blockPath: "blockNumber", addressPath: undefined, eventName: "Transfer" } },
    });
    const result = await checkProvenance(indexed, proof, canonical(base));
    assert.equal(result.status, "PASS");
    assert.equal(result.evidence?.verified, 3);
    const metadata = result.evidence?.metadata;
    assert.equal(metadata.proofMode, "evm-log");
    assert.equal(metadata.rows[0].fields.value.ok, true);
    assert.equal(metadata.rows[0].rpcQuorum.agreeingProviders.length, 2);
    assert.equal(metadata.rows[0].rpcQuorum.failedProviders.length, 1);
    assert.equal((await indexed.getHead()).blockNumber, 102);
}));
test("M2.0 REST JSON rows use the same generic EVM-log proof kernel", async () => withServer(async (base) => {
    const indexed = new HttpJsonSource({
        type: "http-json",
        url: `${base}/rest`,
        events: { Transfer: { arrayPath: "rows", blockPath: "blockNumber", txHashPath: "transactionHash", logIndexPath: "logIndex", eventName: "Transfer" } },
    });
    const result = await checkProvenance(indexed, proof, canonical(base));
    assert.equal(result.status, "PASS");
    assert.equal(result.evidence?.sampled, 3);
    assert.equal((await indexed.getHead()).blockNumber, 102);
}));
test("M2.0 generic provenance catches a decoded indexed field mismatch", async () => withServer(async (base) => {
    const badRows = indexedRows.map((row, index) => index === 1 ? { ...row, value: "999" } : row);
    const indexed = new HttpJsonSource({
        type: "http-json",
        url: `${base}/rest`,
        events: { Transfer: { arrayPath: "rows", blockPath: "blockNumber", txHashPath: "transactionHash", logIndexPath: "logIndex", eventName: "Transfer" } },
    });
    // Override the source fetch with a minimal source so the mismatch stays focused on the proof kernel.
    const mismatchSource = {
        ...indexed,
        getHead: indexed.getHead.bind(indexed),
        getState: indexed.getState.bind(indexed),
        getEvents: async () => badRows.map((row, index) => ({ id: `${row.transactionHash}:0`, blockNumber: row.blockNumber, txHash: row.transactionHash, logIndex: 0, eventName: "Transfer", payload: row })),
    };
    const result = await checkProvenance(mismatchSource, proof, canonical(base));
    assert.equal(result.status, "FAIL");
    assert.equal(result.evidence?.verified, 2);
    assert.equal(String((result.evidence?.failures)[0].reason).includes("event field 'value' mismatch"), true);
}));
test("M2.0 config validation rejects unsupported dynamic ABI inputs", () => {
    const config = {
        name: "generic",
        canonical: { type: "json-rpc", url: "https://rpc-a.example", events: { Transfer: { address: TOKEN, topics: [TOPIC0], fromBlock: 0, toBlock: "latest" } } },
        indexed: { type: "http-json", url: "https://indexer.example/transfers", events: { Transfer: { arrayPath: "rows", blockPath: "blockNumber", txHashPath: "transactionHash", logIndexPath: "logIndex" } } },
        checks: { provenance: [{ ...proof, proof: { ...proof.proof, inputs: [{ name: "memo", type: "bytes", indexed: false }] } }] },
    };
    let caught;
    try {
        validateProjectConfig(config);
    }
    catch (error) {
        caught = error;
    }
    assert.equal(caught instanceof Error, true);
    assert.equal(String(caught.message).includes("Unsupported static ABI type"), true);
});
test("M2.0 unavailable canonical event proof becomes UNKNOWN instead of false DRIFT", async () => {
    const indexed = {
        getHead: async () => ({ blockNumber: 102 }),
        getState: async () => undefined,
        getEvents: async () => indexedRows.map((row) => ({ id: `${row.transactionHash}:0`, blockNumber: row.blockNumber, txHash: row.transactionHash, logIndex: 0, eventName: "Transfer", payload: row })),
    };
    const unavailableCanonical = {
        getHead: async () => ({ blockNumber: 110 }),
        getState: async () => undefined,
        getEvents: async () => [],
        getEventsAtWithEvidence: async () => { throw new Error("RPC quorum unavailable"); },
    };
    const result = await checkProvenance(indexed, proof, unavailableCanonical);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.evidence?.classification, "CANONICAL_PROOF_UNAVAILABLE");
});
test("M2.0 config validation requires JSON-RPC canonical truth for generic evm-log proof", () => {
    const config = {
        name: "generic-invalid-canonical",
        canonical: { type: "fixture", file: "canonical.json" },
        indexed: { type: "http-json", url: "https://indexer.example/transfers", events: { Transfer: { arrayPath: "rows", blockPath: "blockNumber", txHashPath: "transactionHash", logIndexPath: "logIndex" } } },
        checks: { provenance: [proof] },
    };
    let caught;
    try {
        validateProjectConfig(config);
    }
    catch (error) {
        caught = error;
    }
    assert.equal(caught instanceof Error, true);
    assert.equal(String(caught.message).includes("requires canonical.type=json-rpc"), true);
});
//# sourceMappingURL=m2.0-generic-event-provenance.test.js.map