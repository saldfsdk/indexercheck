import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PolymarketDataApiSource } from "../sources/polymarket-data-api.js";
import { checkTransactionCompleteness } from "../core/primitives.js";
import { verify } from "../core/verifier.js";
import { buildMachineReport } from "../core/delivery.js";
import { advanceWatchState } from "../core/watch.js";
import { ORDER_FILLED_TOPIC_V2, POLYMARKET_V2_EXCHANGES } from "../live/polymarket-data-api.js";

const tx = (c: string) => `0x${c.repeat(64)}`;
const A = tx("a");
const B = tx("b");
const C = tx("c");
const D = tx("d");
const MISSING = tx("e");
const EXCHANGE = POLYMARKET_V2_EXCHANGES[0];

interface ServerMode { missing?: boolean; missingBlock?: number; forceMore?: boolean; }
interface RequestsSeen { offsets: number; cursors: string[]; takerOnly: string[]; legacyHits: number; }

async function startServer(mode: ServerMode = {}): Promise<{ server: any; base: string; seen: RequestsSeen }> {
  const rows = [
    { transaction_hash: A, timestamp: 1_800_000_004 },
    { transaction_hash: B, timestamp: 1_800_000_003 },
    { transaction_hash: C, timestamp: 1_800_000_002 },
    { transaction_hash: D, timestamp: 1_800_000_001 },
  ];
  const blocks: Record<string, number> = { [A]: 102, [B]: 101, [C]: 100, [D]: 95, [MISSING]: 101 };
  const missingBlock = mode.missingBlock ?? 101;
  const canonicalLogs = [
    { transactionHash: A, blockNumber: "0x66", logIndex: "0x0" },
    { transactionHash: A, blockNumber: "0x66", logIndex: "0x1" }, // two logs, one transaction
    { transactionHash: B, blockNumber: "0x65", logIndex: "0x0" },
    { transactionHash: C, blockNumber: "0x64", logIndex: "0x0" },
    { transactionHash: D, blockNumber: "0x5f", logIndex: "0x0" },
    ...(mode.missing ? [{ transactionHash: MISSING, blockNumber: `0x${missingBlock.toString(16)}`, logIndex: "0x1" }] : []),
  ].map((log) => ({ ...log, address: EXCHANGE, topics: [ORDER_FILLED_TOPIC_V2] }));

  const seen: RequestsSeen = { offsets: 0, cursors: [], takerOnly: [], legacyHits: 0 };
  const server = createServer((req: any, res: any) => {
    if (req.method === "GET" && String(req.url).startsWith("/v2/trades")) {
      const url = new URL(String(req.url), "http://127.0.0.1");
      if (url.searchParams.has("offset")) {
        seen.offsets += 1;
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "offset is not supported in v2" }));
        return;
      }
      const limit = Number(url.searchParams.get("limit") ?? "3");
      const cursor = url.searchParams.get("cursor");
      const start = cursor ? Number(cursor.replace("cursor-", "")) : 0;
      if (cursor) seen.cursors.push(cursor);
      const takerOnly = url.searchParams.get("taker_only");
      if (takerOnly) seen.takerOnly.push(takerOnly);
      const data = rows.slice(start, start + limit);
      const nextStart = start + data.length;
      const naturalMore = nextStart < rows.length;
      const hasMore = naturalMore || Boolean(mode.forceMore);
      const nextCursor = hasMore ? `cursor-${nextStart}` : null;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data, pagination: { has_more: hasMore, next_cursor: nextCursor } }));
      return;
    }
    if (req.method === "GET" && String(req.url).startsWith("/trades")) {
      seen.legacyHits += 1;
      res.statusCode = 500;
      res.end("legacy route must not be used for completeness");
      return;
    }
    if (req.method === "POST" && req.url === "/rpc") {
      let body = "";
      req.on("data", (chunk: unknown) => { body += String(chunk); });
      req.on("end", () => {
        const rpc = JSON.parse(body);
        let result: any = null;
        if (rpc.method === "eth_getBlockByNumber") result = { number: "0x6e", hash: "0xhead" }; // 110
        if (rpc.method === "eth_getTransactionReceipt") {
          const hash = String(rpc.params?.[0] ?? "").toLowerCase();
          const block = blocks[hash];
          result = block === undefined ? null : {
            transactionHash: hash,
            blockNumber: `0x${block.toString(16)}`,
            status: "0x1",
            logs: [{ address: EXCHANGE, topics: [ORDER_FILLED_TOPIC_V2], logIndex: "0x0" }],
          };
        }
        if (rpc.method === "eth_getLogs") {
          const filter = rpc.params?.[0] ?? {};
          const from = Number(BigInt(filter.fromBlock));
          const to = Number(BigInt(filter.toBlock));
          result = canonicalLogs.filter((log) => {
            const block = Number(BigInt(log.blockNumber));
            return block >= from && block <= to;
          });
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
      });
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { server, base: `http://127.0.0.1:${port}`, seen };
}

function source(base: string): PolymarketDataApiSource {
  return new PolymarketDataApiSource({
    type: "polymarket-data-api",
    dataUrls: [`${base}/v2/trades?limit=8`, `${base}/trades?limit=8`],
    rpcUrls: [`${base}/rpc`],
    sampleSize: 3,
    cacheTtlMs: 1000,
  });
}

const completeCheck = {
  name: "orderfilled-transaction-completeness",
  stream: "OrderFilled",
  windowBlocks: 8, // 95..102
  indexedPageSize: 4,
  maxPages: 1,
};

test("M1.2.1 transaction completeness proves canonical OrderFilled transaction coverage via v2 cursor feed", async () => {
  const { server, base, seen } = await startServer();
  try {
    const result = await checkTransactionCompleteness(source(base), completeCheck);
    assert.equal(result.status, "PASS");
    assert.equal(result.evidence?.classification, "COMPLETE");
    assert.equal(result.evidence?.canonicalTransactions, 4);
    assert.equal(result.evidence?.matchedTransactions, 4);
    assert.deepEqual(result.evidence?.missingTransactions, []);
    assert.equal(result.evidence?.coverageProven, true);
    assert.equal(result.evidence?.oldestIndexedBlock, 95);
    const metadata = result.evidence?.metadata as Record<string, unknown>;
    assert.equal(metadata.canonicalLogCount, 5); // duplicate logs in A still count as one tx
    assert.equal(metadata.paginationMode, "v2-cursor");
    assert.equal(seen.offsets, 0);
    assert.equal(seen.legacyHits, 0);
    // M1.2.2: one request comes from the normal production probe and at least
    // one from cursor completeness. Both must pin the same taker-only cohort.
    assert.equal(seen.takerOnly.length >= 2, true);
    assert.equal(seen.takerOnly.every((value) => value === "true"), true);
  } finally { server.close(); }
});

test("M1.2.1 completeness follows pagination.next_cursor and never sends offset", async () => {
  const { server, base, seen } = await startServer();
  try {
    const result = await checkTransactionCompleteness(source(base), {
      ...completeCheck,
      indexedPageSize: 3,
      maxPages: 2,
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.evidence?.coverageProven, true);
    assert.equal(result.evidence?.pageCount, 2);
    assert.equal(result.evidence?.oldestIndexedBlock, 95);
    assert.deepEqual(seen.cursors, ["cursor-3"]);
    assert.equal(seen.offsets, 0);
    assert.equal(seen.legacyHits, 0);
  } finally { server.close(); }
});

test("M1.2.1 missing canonical transaction maps verification verdict to INCOMPLETE", async () => {
  const { server, base } = await startServer({ missing: true });
  try {
    const indexed = source(base);
    const report = await verify({
      name: "m1.2.1-missing",
      canonical: { type: "fixture", file: "unused" },
      indexed: { type: "fixture", file: "unused" },
      checks: { transactionCompleteness: [completeCheck] },
    }, indexed, indexed);
    assert.equal(report.verdict, "INCOMPLETE");
    const completeness = report.results[0];
    assert.equal(completeness.status, "FAIL");
    assert.deepEqual(completeness.evidence?.missingTransactions, [MISSING]);

    const machine = buildMachineReport(report);
    const transition = advanceWatchState(undefined, machine, "2026-09-27T00:00:00.000Z");
    assert.equal(transition.detected, 1);
    assert.deepEqual(transition.events[0].payload.incident?.relatedTransactions, [MISSING]);
  } finally { server.close(); }
});

test("M1.2.1 returns UNKNOWN instead of false missing when cursor page depth cannot prove the window", async () => {
  const { server, base } = await startServer({ forceMore: true });
  try {
    const result = await checkTransactionCompleteness(source(base), {
      name: "deep-window",
      stream: "OrderFilled",
      windowBlocks: 20, // 83..102, but oldest API row proven only to block 95 and cursor says more exists
      indexedPageSize: 4,
      maxPages: 1,
    });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.evidence?.classification, "UNPROVEN_COVERAGE");
    assert.equal(result.evidence?.coverageProven, false);
  } finally { server.close(); }
});

test("M1.2.1 refuses legacy-only feed semantics for completeness instead of silently falling back", async () => {
  const { server, base, seen } = await startServer();
  try {
    const legacyOnly = new PolymarketDataApiSource({
      type: "polymarket-data-api",
      dataUrls: [`${base}/trades?limit=8`],
      rpcUrls: [`${base}/rpc`],
      sampleSize: 3,
      cacheTtlMs: 1000,
    });
    const result = await checkTransactionCompleteness(legacyOnly, completeCheck);
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.evidence?.classification, "UNPROVEN_COVERAGE");
    const metadata = result.evidence?.metadata as Record<string, unknown>;
    assert.equal(metadata.classification, "V2_CURSOR_FEED_REQUIRED");
    assert.equal(seen.legacyHits, 0); // completeness rejects legacy semantics before any legacy request
  } finally { server.close(); }
});

test("M1.2.1 preset enables reverse-direction completeness beside provenance on v2 only", () => {
  return import("../core/init.js").then(({ buildPresetConfig }) => {
    const config = buildPresetConfig("polymarket-pilot");
    assert.equal(config.checks.transactionCompleteness?.[0]?.stream, "OrderFilled");
    assert.equal(config.checks.transactionCompleteness?.[0]?.windowBlocks, 20);
    assert.equal(config.checks.provenance?.[0]?.stream, "OrderFilled");
    const urls = config.indexed.type === "polymarket-data-api" ? config.indexed.dataUrls ?? [] : [];
    assert.equal(urls.length >= 1, true);
    assert.equal(urls.every((url) => url.includes("/v2/")), true);
  });
});


test("M1.2.3 stable completeness watermark excludes the partially-ingested frontier", async () => {
  const { server, base } = await startServer({ missing: true, missingBlock: 101 });
  try {
    const result = await checkTransactionCompleteness(source(base), {
      ...completeCheck,
      settlementLagBlocks: 2, // latest indexed block 102 => verify only through 100
    });
    assert.equal(result.status, "PASS");
    assert.equal(result.evidence?.classification, "COMPLETE");
    assert.equal(result.evidence?.toBlock, 100);
    assert.deepEqual(result.evidence?.missingTransactions, []);
    const metadata = result.evidence?.metadata as Record<string, unknown>;
    assert.equal(metadata.latestObservedIndexedBlock, 102);
    assert.equal(metadata.verifiedThroughBlock, 100);
    assert.equal(metadata.settlementLagBlocks, 2);
    assert.equal(metadata.excludedFrontierFromBlock, 101);
    assert.equal(metadata.excludedFrontierToBlock, 102);
  } finally { server.close(); }
});

test("M1.2.3 stable completeness watermark still fails for an older persistent omission", async () => {
  const { server, base } = await startServer({ missing: true, missingBlock: 99 });
  try {
    const result = await checkTransactionCompleteness(source(base), {
      ...completeCheck,
      settlementLagBlocks: 2,
    });
    assert.equal(result.status, "FAIL");
    assert.equal(result.evidence?.classification, "MISSING_TRANSACTIONS");
    assert.deepEqual(result.evidence?.missingTransactions, [MISSING]);
    assert.equal(result.evidence?.toBlock, 100);
    assert.deepEqual(result.evidence?.missingTransactionBlocks, { [MISSING]: 99 });
    assert.equal(result.evidence?.oldestMissingBlock, 99);
    assert.equal(result.evidence?.newestMissingBlock, 99);
    assert.equal(result.evidence?.maxMissingDepthBlocks, 1);
    assert.equal(result.evidence?.minMissingDepthBlocks, 1);
  } finally { server.close(); }
});

test("M1.2.3 production preset verifies a five-block stable watermark", () => {
  return import("../core/init.js").then(({ buildPresetConfig }) => {
    const config = buildPresetConfig("polymarket-pilot");
    assert.equal(config.checks.transactionCompleteness?.[0]?.settlementLagBlocks, 5);
  });
});
