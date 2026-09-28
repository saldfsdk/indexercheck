import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { PolymarketDataApiSource } from "../sources/polymarket-data-api.js";
import { checkProvenance } from "../core/primitives.js";
import { buildMachineReport } from "../core/delivery.js";
import { advanceWatchState } from "../core/watch.js";
import { ORDER_FILLED_TOPIC_V2, POLYMARKET_V2_EXCHANGES } from "../live/polymarket-data-api.js";

const TXS = ["1", "2", "3"].map((x) => `0x${x.repeat(64)}`);

function serverScript(transientEmptyFirst = false): string {
  return `
    const http = require("node:http");
    const txs = ${JSON.stringify(TXS)};
    const exchange = ${JSON.stringify(POLYMARKET_V2_EXCHANGES[0])};
    const topic = ${JSON.stringify(ORDER_FILLED_TOPIC_V2)};
    let tradeRequests = 0;
    const server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url.startsWith("/trades")) {
        tradeRequests++;
        res.setHeader("content-type", "application/json");
        if (${transientEmptyFirst ? "true" : "false"} && tradeRequests === 1) {
          res.end("[]");
          return;
        }
        res.end(JSON.stringify(txs.map(transaction_hash => ({ transaction_hash }))));
        return;
      }
      if (req.method === "POST" && req.url === "/rpc") {
        const chunks = [];
        req.on("data", c => chunks.push(c));
        req.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          let result = null;
          if (body.method === "eth_getBlockByNumber") result = { number: "0x67", hash: "0xabc" };
          if (body.method === "eth_getTransactionReceipt") {
            const i = txs.indexOf(String(body.params[0]).toLowerCase());
            result = i < 0 ? null : {
              transactionHash: txs[i],
              blockNumber: "0x" + (100 + i).toString(16),
              status: "0x1",
              logs: [{ address: exchange, topics: [topic], logIndex: "0x0" }]
            };
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

async function startServer(transientEmptyFirst = false): Promise<{ child: any; port: number }> {
  const child = spawn(process.execPath, ["-e", serverScript(transientEmptyFirst)], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((resolvePort, rejectPort) => {
    let buffer = "";
    child.stdout.on("data", (chunk: unknown) => {
      buffer += String(chunk);
      const end = buffer.indexOf("\n");
      if (end >= 0) resolvePort(Number(buffer.slice(0, end)));
    });
    child.on("error", rejectPort);
  });
  return { child, port };
}

function pilotConfig(port: number) {
  return {
    name: "m1-pilot-test",
    canonical: { type: "json-rpc", url: `http://127.0.0.1:${port}/rpc`, headTag: "latest" },
    indexed: {
      type: "polymarket-data-api",
      dataUrls: [`http://127.0.0.1:${port}/trades`],
      rpcUrls: [`http://127.0.0.1:${port}/rpc`],
      sampleSize: 3,
      maxAnchorLagBlocks: 10,
      cacheTtlMs: 1000,
    },
    checks: {
      head: { name: "freshness", maxLagBlocks: 10 },
      provenance: [{ name: "orderfilled-provenance", stream: "OrderFilled", minSamples: 3 }],
    },
  };
}

test("M1.0 init creates a usable polymarket production-pilot config", async () => {
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const output = resolve(`./.m1-init-${process.pid}.json`);
  try {
    const run = spawnSync(process.execPath, [cli, "init", "--preset", "polymarket-pilot", "--output", output], { encoding: "utf8" });
    assert.equal(run.status, 0);
    const config = JSON.parse(await readFile(output, "utf8"));
    assert.equal(config.indexed.type, "polymarket-data-api");
    assert.equal(config.checks.provenance[0].stream, "OrderFilled");
    assert.equal(config.canonical.fallbackUrls.length > 0, true);
  } finally { try { await unlink(output); } catch {} }
});

test("M1.0 production pilot verifies live-style indexed rows against canonical receipts", async () => {
  const { child, port } = await startServer();
  const configPath = resolve(`./.m1-pilot-${process.pid}.json`);
  try {
    await writeFile(configPath, JSON.stringify(pilotConfig(port)), "utf8");
    const project = await loadProject(configPath);
    const report = await verify(project.config, project.canonical, project.indexed);
    assert.equal(report.verdict, "PASS");
    const provenance = report.results.find((r) => r.primitive === "PROVENANCE");
    assert.equal(provenance?.status, "PASS");
    assert.equal(provenance?.evidence?.verified, 3);
    assert.equal(report.canonicalHead?.blockNumber, 103);
    assert.equal(report.indexedHead?.blockNumber, 102);
  } finally {
    try { child.kill(); } catch {}
    try { await unlink(configPath); } catch {}
  }
});

test("M1.0 PROVENANCE fails with transaction evidence when an indexed trade lacks canonical OrderFilled", async () => {
  const script = serverScript().replace('logs: [{ address: exchange, topics: [topic], logIndex: "0x0" }]', 'logs: i === 2 ? [{ address: exchange, topics: ["0xdead"], logIndex: "0x0" }] : [{ address: exchange, topics: [topic], logIndex: "0x0" }]');
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((resolvePort) => {
    let buffer = "";
    child.stdout.on("data", (chunk: unknown) => { buffer += String(chunk); const end = buffer.indexOf("\n"); if (end >= 0) resolvePort(Number(buffer.slice(0, end))); });
  });
  try {
    const source = new PolymarketDataApiSource({ type: "polymarket-data-api", dataUrls: [`http://127.0.0.1:${port}/trades`], rpcUrls: [`http://127.0.0.1:${port}/rpc`], sampleSize: 3, cacheTtlMs: 1000 });
    const result = await checkProvenance(source, { name: "orderfilled-provenance", stream: "OrderFilled", minSamples: 3 });
    assert.equal(result.status, "FAIL");
    assert.equal(result.evidence?.verified, 2);
    assert.deepEqual(result.evidence?.failedTransactions, [TXS[2]]);
  } finally { try { child.kill(); } catch {} }
});

test("M1.0 machine/watch delivery preserves failed provenance transaction evidence", async () => {
  const script = serverScript().replace('logs: [{ address: exchange, topics: [topic], logIndex: "0x0" }]', 'logs: i === 2 ? [{ address: exchange, topics: ["0xdead"], logIndex: "0x0" }] : [{ address: exchange, topics: [topic], logIndex: "0x0" }]');
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  const port = await new Promise<number>((resolvePort) => {
    let buffer = "";
    child.stdout.on("data", (chunk: unknown) => { buffer += String(chunk); const end = buffer.indexOf("\n"); if (end >= 0) resolvePort(Number(buffer.slice(0, end))); });
  });
  const configPath = resolve(`./.m1-evidence-${process.pid}.json`);
  try {
    await writeFile(configPath, JSON.stringify(pilotConfig(port)), "utf8");
    const project = await loadProject(configPath);
    const report = await verify(project.config, project.canonical, project.indexed);
    assert.equal(report.verdict, "DRIFT");
    const artifact = buildMachineReport(report);
    const check = artifact.checks.find((item) => item.primitive === "PROVENANCE");
    assert.deepEqual(check?.evidence?.failedTransactions, [TXS[2]]);
    const transition = advanceWatchState(undefined, artifact, "2026-01-01T00:00:00.000Z");
    assert.equal(transition.detected, 1);
    assert.deepEqual(transition.events[0].payload.incident?.relatedTransactions, [TXS[2]]);
  } finally {
    try { child.kill(); } catch {}
    try { await unlink(configPath); } catch {}
  }
});

test("M1.0 watch survives a transient source error and succeeds on the next tick", async () => {
  const { child, port } = await startServer(true);
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const configPath = resolve(`./.m1-watch-config-${process.pid}.json`);
  const statePath = resolve(`./.m1-watch-state-${process.pid}.json`);
  try {
    await writeFile(configPath, JSON.stringify(pilotConfig(port)), "utf8");
    const run = spawnSync(process.execPath, [cli, "watch", "--config", configPath, "--interval", "10ms", "--max-iterations", "2", "--state", statePath, "--json-lines"], { encoding: "utf8" });
    assert.equal(run.status, 0);
    const lines = run.stdout.trim().split(/\r?\n/).map((line: string) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].kind, "IndexerCheckWatchError");
    assert.equal(lines[1].kind, "IndexerCheckWatchTick");
    assert.equal(lines[1].verdict, "PASS");
  } finally {
    try { child.kill(); } catch {}
    for (const path of [configPath, statePath]) { try { await unlink(path); } catch {} }
  }
});
