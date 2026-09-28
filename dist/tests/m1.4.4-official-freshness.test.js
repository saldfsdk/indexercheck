import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { checkSourceFreshness } from "../core/primitives.js";
import { PolymarketDataApiSource } from "../sources/polymarket-data-api.js";
import { buildMachineReport, TOOL_VERSION } from "../core/delivery.js";
import { ORDER_FILLED_TOPIC_V2, POLYMARKET_V2_EXCHANGES } from "../live/polymarket-data-api.js";
const TXS = ["a", "b", "c"].map((x) => `0x${x.repeat(64)}`);
const freshnessConfig = { name: "orderfilled-freshness", stream: "OrderFilled", maxAgeSeconds: 300, maxLagBlocks: 120, activityGraceBlocks: 20 };
function serverScript(mode) {
    return `
    const http = require("node:http");
    const txs = ${JSON.stringify(TXS)};
    const exchange = ${JSON.stringify(POLYMARKET_V2_EXCHANGES[0])};
    const topic = ${JSON.stringify(ORDER_FILLED_TOPIC_V2)};
    const oldTs = Math.floor(Date.now()/1000) - 600;
    const mode = ${JSON.stringify(mode)};
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url.startsWith("/v2/trades")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: txs.map(transaction_hash => ({ transaction_hash, timestamp: oldTs })), pagination: { has_more: false, next_cursor: null } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v2/status") {
        if (mode === "unavailable") { res.statusCode = 404; res.end(JSON.stringify({ error: "missing" })); return; }
        const min = mode === "stale" ? 50 : 198;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: {
          computed_at: new Date().toISOString(), age_seconds: 1,
          serving: { lag_seconds: 1, worst: "activity_feed", mechanisms: [] },
          ingestion: { cursors: 162, network: "polygon", chain_id: 137, max_synced_block: min + 1, min_synced_block: min,
            most_lagged: { source: "test_stream", block: min, behind_max: 1 }, lagging: [] }
        }}));
        return;
      }
      if (req.method === "POST" && req.url === "/rpc") {
        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          let result = null;
          if (body.method === "eth_getBlockByNumber") result = { number: "0xc8", hash: "0xhead" }; // 200
          if (body.method === "eth_getTransactionReceipt") {
            const i = txs.indexOf(String(body.params[0]).toLowerCase());
            result = i < 0 ? null : { transactionHash: txs[i], blockNumber: "0x" + (100 + i).toString(16), status: "0x1",
              logs: [{ address: exchange, topics: [topic], logIndex: "0x0" }] };
          }
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
        });
        return;
      }
      res.statusCode = 404; res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
  `;
}
async function startServer(mode) {
    const child = spawn(process.execPath, ["-e", serverScript(mode)], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise((resolvePort, rejectPort) => {
        let buffer = "";
        child.stdout.on("data", (chunk) => { buffer += String(chunk); const end = buffer.indexOf("\n"); if (end >= 0)
            resolvePort(Number(buffer.slice(0, end))); });
        child.on("error", rejectPort);
    });
    return { child, port };
}
function sourceFor(port) {
    return new PolymarketDataApiSource({
        type: "polymarket-data-api",
        dataUrls: [`http://127.0.0.1:${port}/v2/trades?limit=8&taker_only=true`],
        rpcUrls: [`http://127.0.0.1:${port}/rpc`],
        sampleSize: 3,
        cacheTtlMs: 1000,
    });
}
test("M1.4.4 official status overrides a stale sampled-trade anchor for v2 freshness", async () => {
    const { child, port } = await startServer("fresh");
    try {
        const result = await checkSourceFreshness(sourceFor(port), freshnessConfig);
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.classification, "FRESH");
        assert.equal(result.evidence?.freshnessBasis, "polymarket-v2-status");
        assert.equal(result.evidence?.lagBlocks, 2);
        assert.equal(result.evidence?.metadata?.sampledTradeAnchor?.lagBlocks, 98);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.4.4 official status marks the source stale when the serving watermark really lags", async () => {
    const { child, port } = await startServer("stale");
    try {
        const result = await checkSourceFreshness(sourceFor(port), freshnessConfig);
        assert.equal(result.status, "FAIL");
        assert.equal(result.evidence?.classification, "STALE");
        assert.equal(result.evidence?.lagBlocks, 150);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.4.4 unavailable official status becomes UNKNOWN instead of false STALLED", async () => {
    const { child, port } = await startServer("unavailable");
    try {
        const result = await checkSourceFreshness(sourceFor(port), freshnessConfig);
        assert.equal(result.status, "UNKNOWN");
        assert.equal(result.evidence?.classification, "UNKNOWN");
        assert.equal(result.evidence?.freshnessBasis, "polymarket-v2-status");
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.4.4 machine artifact reports the current tool version", () => {
    const report = { name: "version", verdict: "PASS", generatedAt: "2026-09-27T00:00:00.000Z", results: [] };
    const artifact = buildMachineReport(report);
    assert.equal(artifact.tool.version, TOOL_VERSION);
});
//# sourceMappingURL=m1.4.4-official-freshness.test.js.map