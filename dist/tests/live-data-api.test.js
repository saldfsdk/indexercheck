import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ORDER_FILLED_TOPIC_V2, POLYMARKET_V2_EXCHANGES, findOrderFilledProof, runPolymarketDataApiBenchmark } from "../live/polymarket-data-api.js";
async function listen(server) {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const a = server.address();
    return `http://127.0.0.1:${a.port}`;
}
async function close(server) {
    await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve()));
}
function tx(char) { return `0x${char.repeat(64)}`; }
function receipt(hash, blockHex) {
    return {
        transactionHash: hash,
        blockNumber: blockHex,
        status: "0x1",
        logs: [{
                address: POLYMARKET_V2_EXCHANGES[0],
                topics: [ORDER_FILLED_TOPIC_V2, tx("b"), `0x${"0".repeat(24)}${"1".repeat(40)}`, `0x${"0".repeat(24)}${"2".repeat(40)}`],
                data: "0x"
            }]
    };
}
test("M0.3.2 recognizes V2 OrderFilled provenance", () => {
    const proof = findOrderFilledProof(receipt(tx("a"), "0x64"));
    assert.equal(proof?.transactionHash, tx("a"));
    assert.equal(proof?.blockNumber, 100);
});
test("M0.3.2 official-data benchmark retries 429 and falls back across RPC endpoints", async () => {
    const txs = [tx("a"), tx("c"), tx("d")];
    let dataRequests = 0;
    const server = createServer(async (req, res) => {
        let raw = "";
        for await (const c of req)
            raw += c;
        res.setHeader("content-type", "application/json");
        if (req.url?.startsWith("/data")) {
            dataRequests++;
            if (dataRequests === 1) {
                res.statusCode = 429;
                res.setHeader("retry-after", "0");
                res.end(JSON.stringify({ error: "busy" }));
                return;
            }
            res.end(JSON.stringify({ data: txs.map((h, i) => ({ transaction_hash: h, timestamp: 1000 + i })) }));
            return;
        }
        if (req.url === "/rpc-bad") {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: "bad endpoint" }));
            return;
        }
        if (req.url === "/rpc-good") {
            const j = JSON.parse(raw || "{}");
            let result = null;
            if (j.method === "eth_getBlockByNumber")
                result = { number: "0x70", timestamp: "0x3e8" };
            if (j.method === "eth_getTransactionReceipt") {
                const idx = txs.indexOf(String(j.params?.[0]).toLowerCase());
                result = idx >= 0 ? receipt(txs[idx], `0x${(100 + idx).toString(16)}`) : null;
            }
            res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
    });
    const base = await listen(server);
    try {
        const r = await runPolymarketDataApiBenchmark({
            dataUrls: [`${base}/data`],
            rpcUrls: [`${base}/rpc-bad`, `${base}/rpc-good`],
            sampleSize: 3,
            maxAnchorLagBlocks: 20
        });
        assert.equal(r.verifiedTransactions, 3);
        assert.equal(r.rpcUrl, `${base}/rpc-good`);
        assert.equal(r.dataUrl, `${base}/data`);
        assert.equal(dataRequests >= 2, true);
    }
    finally {
        await close(server);
    }
});
//# sourceMappingURL=live-data-api.test.js.map