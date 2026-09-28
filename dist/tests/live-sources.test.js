import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { JsonRpcSource } from "../sources/json-rpc.js";
import { GraphQlSource } from "../sources/graphql.js";
import { checkCanonicalHead, checkEventCompleteness, checkStateParity } from "../core/primitives.js";
async function withServer(fn) {
    const server = createServer(async (req, res) => {
        let body = "";
        for await (const c of req)
            body += c;
        const j = JSON.parse(body || "{}");
        res.setHeader("content-type", "application/json");
        if (j.jsonrpc) {
            const method = j.method;
            let result;
            if (method === "eth_getBlockByNumber")
                result = { number: "0x64", hash: "0xabc" };
            else if (method === "eth_call")
                result = "0x0a";
            else if (method === "eth_getLogs")
                result = [{ transactionHash: "0xaaa", logIndex: "0x0", blockNumber: "0x63", address: "0x0000000000000000000000000000000000000001", topics: [], data: "0x" }, { transactionHash: "0xbbb", logIndex: "0x1", blockNumber: "0x64", address: "0x0000000000000000000000000000000000000001", topics: [], data: "0x" }];
            else
                result = null;
            res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
            return;
        }
        const q = String(j.query || "");
        if (q.includes("Head"))
            res.end(JSON.stringify({ data: { meta: { block: { number: 100 }, healthy: true, synced: true } } }));
        else if (q.includes("State"))
            res.end(JSON.stringify({ data: { token: { balance: "10", block: 100 } } }));
        else
            res.end(JSON.stringify({ data: { events: [{ txHash: "0xaaa", logIndex: 0, blockNumber: 99 }] } }));
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    const base = `http://127.0.0.1:${a.port}`;
    try {
        await fn(base);
    }
    finally {
        await new Promise((r, j) => server.close((e) => e ? j(e) : r()));
    }
}
test("M0.2 JSON-RPC + GraphQL adapters perform real HTTP requests", async () => withServer(async (url) => {
    const canonical = new JsonRpcSource({ type: "json-rpc", url, headTag: "finalized", state: { balance: { to: "0x0000000000000000000000000000000000000001", data: "0x70a08231", decode: "uint256" } }, events: { transfers: { address: "0x0000000000000000000000000000000000000001", fromBlock: 99, toBlock: 100 } } });
    const indexed = new GraphQlSource({ type: "graphql", url, head: { query: "query Head { meta { block { number } healthy synced } }", blockPath: "meta.block.number", healthyPath: "meta.healthy", syncedPath: "meta.synced" }, state: { balance: { query: "query State { token { balance block } }", valuePath: "token.balance", blockPath: "token.block" } }, events: { transfers: { query: "query Events { events { txHash logIndex blockNumber } }", arrayPath: "events", txHashPath: "txHash", logIndexPath: "logIndex", blockPath: "blockNumber" } } });
    assert.equal((await checkCanonicalHead(canonical, indexed, { maxLagBlocks: 0 })).status, "PASS");
    assert.equal((await checkStateParity(canonical, indexed, { name: "balance", key: "balance" })).status, "PASS");
    const events = await checkEventCompleteness(canonical, indexed, { name: "transfers", stream: "transfers" });
    assert.equal(events.status, "FAIL");
    assert.equal(events.evidence?.missingCount, 1);
}));
//# sourceMappingURL=live-sources.test.js.map