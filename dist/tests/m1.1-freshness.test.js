import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildPresetConfig } from "../core/init.js";
import { checkSourceFreshness } from "../core/primitives.js";
import { PolymarketDataApiSource } from "../sources/polymarket-data-api.js";
import { buildMachineReport } from "../core/delivery.js";
import { verify } from "../core/verifier.js";
import { advanceWatchState } from "../core/watch.js";
import { ORDER_FILLED_TOPIC_V2, POLYMARKET_V2_EXCHANGES } from "../live/polymarket-data-api.js";
const TXS = ["4", "5", "6"].map((x) => `0x${x.repeat(64)}`);
function freshnessServerScript(mode) {
    return `
    const http = require("node:http");
    const txs = ${JSON.stringify(TXS)};
    const exchange = ${JSON.stringify(POLYMARKET_V2_EXCHANGES[0])};
    const topic = ${JSON.stringify(ORDER_FILLED_TOPIC_V2)};
    const oldTs = Math.floor(Date.now()/1000) - 600;
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url.startsWith("/trades")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(txs.map(transaction_hash => ({ transaction_hash, timestamp: oldTs }))));
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
            result = i < 0 ? null : {
              transactionHash: txs[i], blockNumber: "0x" + (100 + i).toString(16), status: "0x1",
              logs: [{ address: exchange, topics: [topic], logIndex: "0x0" }]
            };
          }
          if (body.method === "eth_getLogs") {
            const mode = ${JSON.stringify(mode)};
            if (mode === "inactive") result = [];
            if (mode === "stale") result = [{ address: exchange, topics: [topic], blockNumber: "0x96", transactionHash: "0x" + "7".repeat(64), logIndex: "0x0" }]; // 150
            if (mode === "catching-up") result = [{ address: exchange, topics: [topic], blockNumber: "0x6e", transactionHash: "0x" + "8".repeat(64), logIndex: "0x0" }]; // 110
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
async function startFreshnessServer(mode) {
    const child = spawn(process.execPath, ["-e", freshnessServerScript(mode)], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise((resolvePort, rejectPort) => {
        let buffer = "";
        child.stdout.on("data", (chunk) => {
            buffer += String(chunk);
            const end = buffer.indexOf("\n");
            if (end >= 0)
                resolvePort(Number(buffer.slice(0, end)));
        });
        child.on("error", rejectPort);
    });
    return { child, port };
}
function sourceFor(port) {
    return new PolymarketDataApiSource({
        type: "polymarket-data-api",
        dataUrls: [`http://127.0.0.1:${port}/trades`],
        rpcUrls: [`http://127.0.0.1:${port}/rpc`],
        sampleSize: 3,
        freshnessScanMaxBlocks: 5000,
        cacheTtlMs: 1000,
    });
}
const freshnessConfig = { name: "orderfilled-freshness", stream: "OrderFilled", maxAgeSeconds: 300, maxLagBlocks: 120, activityGraceBlocks: 20 };
test("M1.1 preset replaces permissive block-lag freshness with activity-aware SOURCE_FRESHNESS", () => {
    const config = buildPresetConfig("polymarket-pilot");
    assert.equal(config.checks.head, undefined);
    assert.equal(config.checks.sourceFreshness?.[0]?.stream, "OrderFilled");
    assert.equal(config.checks.sourceFreshness?.[0]?.activityGraceBlocks, 20);
});
test("M1.1 old anchor with no canonical activity is INACTIVE, not stalled", async () => {
    const { child, port } = await startFreshnessServer("inactive");
    try {
        const result = await checkSourceFreshness(sourceFor(port), freshnessConfig);
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.classification, "INACTIVE");
        assert.equal(result.evidence?.canonicalActivityAfterAnchor, false);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.1 canonical activity far beyond indexed anchor is STALE", async () => {
    const { child, port } = await startFreshnessServer("stale");
    try {
        const result = await checkSourceFreshness(sourceFor(port), freshnessConfig);
        assert.equal(result.status, "FAIL");
        assert.equal(result.evidence?.classification, "STALE");
        assert.equal(result.evidence?.latestCanonicalActivityBlock, 150);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.1 small canonical activity gap remains CATCHING_UP within grace", async () => {
    const { child, port } = await startFreshnessServer("catching-up");
    try {
        const result = await checkSourceFreshness(sourceFor(port), freshnessConfig);
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.classification, "CATCHING_UP");
        assert.equal(result.evidence?.activityLagBlocks, 8);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
function machineWithHeads(canonical, indexed, generatedAt, classification = "FRESH") {
    const report = {
        name: "trend-project",
        verdict: "PASS",
        generatedAt,
        canonicalHead: { blockNumber: canonical },
        indexedHead: { blockNumber: indexed },
        results: [{ primitive: "SOURCE_FRESHNESS", name: "freshness", status: "PASS", summary: "ok", evidence: { classification } }],
    };
    return buildMachineReport(report);
}
test("M1.1 watch persists freshness observations and detects growing lag trend", () => {
    const first = advanceWatchState(undefined, machineWithHeads(100, 99, "2026-09-27T00:00:00.000Z"));
    const second = advanceWatchState(first.state, machineWithHeads(140, 100, "2026-09-27T00:01:00.000Z"));
    const third = advanceWatchState(second.state, machineWithHeads(180, 101, "2026-09-27T00:02:00.000Z"));
    assert.equal(first.lagTrend, "UNKNOWN");
    assert.equal(second.lagTrend, "GROWING");
    assert.equal(second.lagDeltaBlocks, 39);
    assert.equal(third.lagTrend, "GROWING");
    assert.equal(third.lagGrowthStreak, 2);
    assert.equal(third.state.observations?.length, 3);
    assert.equal(third.state.observations?.[2]?.lagBlocks, 79);
});
class FixedSource {
    head;
    freshness;
    constructor(head, freshness) {
        this.head = head;
        this.freshness = freshness;
    }
    async getHead() { return { blockNumber: this.head }; }
    async getState(_key) { return undefined; }
    async getEvents(_stream) { return []; }
    async getFreshness(_stream) { if (!this.freshness)
        throw new Error("no freshness"); return this.freshness; }
}
test("M1.1 verifier maps stale SOURCE_FRESHNESS to STALLED without CANONICAL_HEAD gate", async () => {
    const canonical = new FixedSource(300);
    const indexed = new FixedSource(100, {
        stream: "OrderFilled", anchorBlock: 100, chainHead: 300, lagBlocks: 200, ageSeconds: 600,
        canonicalActivityAfterAnchor: true, latestCanonicalActivityBlock: 180, scanComplete: true,
    });
    const report = await verify({
        name: "freshness-verdict", canonical: { type: "fixture", file: "unused" }, indexed: { type: "fixture", file: "unused" },
        checks: { sourceFreshness: [freshnessConfig] },
    }, canonical, indexed);
    assert.equal(report.verdict, "STALLED");
    assert.equal(report.results[0]?.primitive, "SOURCE_FRESHNESS");
    assert.equal(report.results[0]?.evidence?.classification, "STALE");
});
//# sourceMappingURL=m1.1-freshness.test.js.map