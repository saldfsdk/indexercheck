import type {
  SnapshotSource,
  ProvenanceSnapshot,
  FreshnessSnapshot,
  TransactionCompletenessRequest,
  TransactionCompletenessSnapshot,
} from "../core/source.js";
import type { EventRecord, HeadSnapshot, PolymarketDataApiSourceConfig, RpcQuorumSettings, StateValue } from "../core/types.js";
import {
  DEFAULT_POLYGON_RPC_URLS,
  DEFAULT_POLYMARKET_DATA_URLS,
  findOrderFilledProof,
  POLYMARKET_V1_EXCHANGES,
  POLYMARKET_V2_EXCHANGES,
  ORDER_FILLED_TOPIC_V1,
  ORDER_FILLED_TOPIC_V2,
  polymarketStatusUrl,
} from "../live/polymarket-data-api.js";
import {
  normalizeLogsForQuorum,
  normalizeReceiptForQuorum,
  rpcExactQuorum,
  rpcHeadQuorum,
  type RpcQuorumEvidence,
} from "../live/rpc-quorum.js";

interface ProbeFailure { transactionHash?: string; reason: string; }
interface PilotProbe {
  chainHead: number;
  latestIndexedBlock: number;
  latestIndexedTimestampMs?: number;
  sampled: number;
  verified: number;
  failures: ProbeFailure[];
  dataUrl: string;
  rpcUrl: string;
  transactionHashes: string[];
  rpcQuorum?: RpcQuorumEvidence & Record<string, unknown>;
}

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterMs?: number) {
    super(message);
    this.name = "HttpStatusError";
  }
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const dateMs = Date.parse(value);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : undefined;
}
function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function requestJson(url: string, init: RequestInit, label: string): Promise<any> {
  let last: unknown;
  const delays = [500, 1_000, 2_000];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { "user-agent": "indexercheck-m1.4.4", ...(init.headers ?? {}) },
        signal: controller.signal,
      });
      if (!response.ok) throw new HttpStatusError(response.status, `${label} HTTP ${response.status}`, parseRetryAfter(response.headers.get("retry-after")));
      return await response.json();
    } catch (error) {
      last = error;
      const statusError = error instanceof HttpStatusError;
      if (attempt >= 3 || (statusError && !retryableStatus(error.status))) break;
      await sleep(Math.max(delays[attempt] ?? 2_000, statusError ? error.retryAfterMs ?? 0 : 0));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last instanceof Error ? last : new Error(`${label} request failed`);
}

async function rpcSingle(url: string, method: string, params: unknown[]): Promise<any> {
  const body = await requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }, `RPC ${method}`);
  if (body?.error) throw new Error(`RPC ${method} ${body.error.code}: ${body.error.message}`);
  return body?.result;
}

async function rpcFallback(urls: string[], method: string, params: unknown[]): Promise<{ result: any; url: string }> {
  const errors: string[] = [];
  for (const url of urls) {
    try { return { result: await rpcSingle(url, method, params), url }; }
    catch (error) { errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  throw new Error(`All RPC endpoints failed for ${method}: ${errors.join(" | ")}`);
}

interface CanonicalRpcResult { result: any; url: string; quorum?: RpcQuorumEvidence & Record<string, unknown>; }

function quorumMin(settings: RpcQuorumSettings | undefined): number | undefined {
  return settings ? Math.max(1, settings.minAgreement ?? 2) : undefined;
}

async function rpcCanonical(
  urls: string[],
  settings: RpcQuorumSettings | undefined,
  method: string,
  params: unknown[],
  normalize: (value: any) => unknown = (value) => value,
): Promise<CanonicalRpcResult> {
  const minAgreement = quorumMin(settings);
  if (!minAgreement) return rpcFallback(urls, method, params);
  const quorum = await rpcExactQuorum(urls, method, params, rpcSingle, minAgreement, normalize);
  return { result: quorum.result, url: quorum.evidence.agreeingProviders[0] ?? urls[0], quorum: quorum.evidence };
}

async function rpcCanonicalHead(
  urls: string[],
  settings: RpcQuorumSettings | undefined,
): Promise<CanonicalRpcResult> {
  const minAgreement = quorumMin(settings);
  if (!minAgreement) return rpcFallback(urls, "eth_getBlockByNumber", ["latest", false]);
  const quorum = await rpcHeadQuorum(
    urls,
    "latest",
    rpcSingle,
    minAgreement,
    Math.max(0, settings?.maxHeadSkewBlocks ?? 8),
    Math.max(0, settings?.agreementLagBlocks ?? 0),
  );
  return { result: quorum.result, url: quorum.evidence.agreeingProviders[0] ?? urls[0], quorum: quorum.evidence };
}

interface TradeRow { hash: string; timestampMs?: number; }

function normalizeTimestampMs(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric < 10_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
}

function tradeRows(body: any): TradeRow[] {
  const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
  return rows
    .map((row: any) => ({
      hash: String(row?.transaction_hash ?? row?.transactionHash ?? "").toLowerCase(),
      timestampMs: normalizeTimestampMs(row?.timestamp),
    }))
    .filter((row: TradeRow) => /^0x[0-9a-f]{64}$/.test(row.hash));
}

interface OfficialStatusSnapshot {
  url: string;
  computedAt?: string;
  statusAgeSeconds?: number;
  servingLagSeconds?: number;
  effectiveAgeSeconds?: number;
  servingWorst?: string;
  ingestionCursorCount?: number;
  network?: string;
  chainId?: number;
  maxSyncedBlock?: number;
  minSyncedBlock?: number;
  mostLaggedSource?: string;
  mostLaggedBlock?: number;
  mostLaggedBehindMax?: number;
}

function finiteNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function parseOfficialStatus(body: any, url: string): OfficialStatusSnapshot {
  const data = body?.data && typeof body.data === "object" ? body.data : undefined;
  if (!data) throw new Error("Polymarket /v2/status response is missing data envelope");
  const statusAgeSeconds = finiteNumber(data.age_seconds);
  const servingLagSeconds = finiteNumber(data.serving?.lag_seconds);
  const mostLagged = data.ingestion?.most_lagged;
  return {
    url,
    computedAt: typeof data.computed_at === "string" ? data.computed_at : undefined,
    statusAgeSeconds,
    servingLagSeconds,
    effectiveAgeSeconds: (statusAgeSeconds ?? 0) + (servingLagSeconds ?? 0),
    servingWorst: typeof data.serving?.worst === "string" ? data.serving.worst : undefined,
    ingestionCursorCount: finiteNumber(data.ingestion?.cursors),
    network: typeof data.ingestion?.network === "string" ? data.ingestion.network : undefined,
    chainId: finiteNumber(data.ingestion?.chain_id),
    maxSyncedBlock: finiteNumber(data.ingestion?.max_synced_block),
    minSyncedBlock: finiteNumber(data.ingestion?.min_synced_block),
    mostLaggedSource: typeof mostLagged?.source === "string" ? mostLagged.source : undefined,
    mostLaggedBlock: finiteNumber(mostLagged?.block),
    mostLaggedBehindMax: finiteNumber(mostLagged?.behind_max),
  };
}

async function fetchOfficialStatus(dataUrl: string): Promise<OfficialStatusSnapshot> {
  const url = polymarketStatusUrl(dataUrl);
  const body = await requestJson(url, { method: "GET", headers: { accept: "application/json" } }, "Polymarket Data API status");
  return parseOfficialStatus(body, url);
}

function stableDataUrl(raw: string): string {
  if (!raw.includes("/v2/")) return raw;
  const url = new URL(raw);
  // M1.2.2: every production v2 probe uses the same cohort semantics as
  // cursor completeness. Never let provenance/freshness silently drift into
  // legacy pagination or a different maker/taker row shape.
  url.searchParams.delete("offset");
  url.searchParams.delete("cursor");
  url.searchParams.delete("takerOnly");
  url.searchParams.delete("taker_only");
  url.searchParams.set("taker_only", "true");
  return url.toString();
}

async function dataFallback(urls: string[]): Promise<{ trades: TradeRow[]; url: string }> {
  const errors: string[] = [];
  for (const configuredUrl of urls) {
    const url = stableDataUrl(configuredUrl);
    try {
      const body = await requestJson(url, { method: "GET", headers: { accept: "application/json" } }, "Polymarket Data API");
      const trades = tradeRows(body);
      if (!trades.length) throw new Error("no trade transaction hashes in response");
      return { trades, url: configuredUrl };
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`All Polymarket Data API endpoints failed: ${errors.join(" | ")}`);
}

function v2PagedDataUrl(raw: string, limit: number, cursor?: string): string {
  const url = new URL(raw);
  // Data API v2 is cursor-only. Never send the legacy offset parameter.
  url.searchParams.delete("offset");
  url.searchParams.delete("takerOnly");
  url.searchParams.delete("taker_only");
  url.searchParams.delete("cursor");
  // Explicitly keep the feed in one-row-per-fill taker semantics. This is the
  // stable cohort we compare against canonical settlement transactions.
  url.searchParams.set("taker_only", "true");
  if (cursor) {
    url.searchParams.delete("limit");
    url.searchParams.set("cursor", cursor);
  } else {
    url.searchParams.set("limit", String(limit));
  }
  return url.toString();
}

interface V2TradePage {
  trades: TradeRow[];
  url: string;
  rowCount: number;
  nextCursor?: string;
  hasMore: boolean;
}

function parseV2Pagination(body: any): { nextCursor?: string; hasMore: boolean } {
  const pagination = body?.pagination && typeof body.pagination === "object" ? body.pagination : {};
  const next = pagination?.next_cursor ?? pagination?.nextCursor;
  const nextCursor = typeof next === "string" && next.length > 0 ? next : undefined;
  const hasMore = typeof pagination?.has_more === "boolean"
    ? pagination.has_more
    : typeof pagination?.hasMore === "boolean"
      ? pagination.hasMore
      : nextCursor !== undefined;
  return { nextCursor, hasMore };
}

async function dataV2PageFallback(
  urls: string[],
  limit: number,
  cursor?: string,
): Promise<V2TradePage> {
  const v2Urls = urls.filter((url) => url.includes("/v2/"));
  if (!v2Urls.length) throw new Error("transaction completeness requires a Polymarket Data API v2 trades endpoint");
  const errors: string[] = [];
  for (const baseUrl of v2Urls) {
    const url = v2PagedDataUrl(baseUrl, limit, cursor);
    try {
      const body = await requestJson(url, { method: "GET", headers: { accept: "application/json" } }, "Polymarket Data API v2");
      if (!Array.isArray(body?.data)) throw new Error("v2 response is missing the { data, pagination } envelope");
      const { nextCursor, hasMore } = parseV2Pagination(body);
      return { trades: tradeRows(body), url: baseUrl, rowCount: body.data.length, nextCursor, hasMore };
    } catch (error) {
      errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`All Polymarket Data API v2 endpoints failed: ${errors.join(" | ")}`);
}

async function receiptBlockForTrade(
  trade: TradeRow,
  rpcUrls: string[],
  activeRpc: string,
  rpcQuorum?: RpcQuorumSettings,
): Promise<{ block?: number; rpcUrl: string }> {
  const ordered = [activeRpc, ...rpcUrls.filter((url) => url !== activeRpc)];
  const receiptResult = await rpcCanonical(ordered, rpcQuorum, "eth_getTransactionReceipt", [trade.hash], normalizeReceiptForQuorum);
  const receipt = receiptResult.result;
  if (!receipt) return { rpcUrl: receiptResult.url };
  return { block: blockNumber(receipt.blockNumber), rpcUrl: receiptResult.url };
}

async function canonicalOrderFilledTransactions(
  rpcUrls: string[],
  activeRpc: string,
  fromBlock: number,
  toBlock: number,
  rpcQuorum?: RpcQuorumSettings,
): Promise<{ transactions: string[]; transactionBlocks: Record<string, number>; logCount: number; rpcUrl: string; quorum?: RpcQuorumEvidence & Record<string, unknown> }> {
  const ordered = [activeRpc, ...rpcUrls.filter((url) => url !== activeRpc)];
  const logsResult = await rpcCanonical(ordered, rpcQuorum, "eth_getLogs", [{
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
    address: [...POLYMARKET_V2_EXCHANGES, ...POLYMARKET_V1_EXCHANGES],
    topics: [[ORDER_FILLED_TOPIC_V2, ORDER_FILLED_TOPIC_V1]],
  }], normalizeLogsForQuorum);
  const logs = Array.isArray(logsResult.result) ? logsResult.result : [];
  const transactionBlocks: Record<string, number> = {};
  for (const log of logs) {
    const hash = String(log?.transactionHash ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hash)) continue;
    const block = blockNumber(log?.blockNumber);
    if (block === undefined) continue;
    transactionBlocks[hash] = Math.min(transactionBlocks[hash] ?? block, block);
  }
  const transactions = Object.keys(transactionBlocks);
  return { transactions, transactionBlocks, logCount: logs.length, rpcUrl: logsResult.url, quorum: logsResult.quorum };
}

function blockNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    try { return Number(BigInt(value)); } catch { return undefined; }
  }
  return undefined;
}

export async function probePolymarketDataApi(config: PolymarketDataApiSourceConfig): Promise<PilotProbe> {
  const rpcUrls = config.rpcUrls?.length ? config.rpcUrls : DEFAULT_POLYGON_RPC_URLS;
  const dataUrls = config.dataUrls?.length ? config.dataUrls : DEFAULT_POLYMARKET_DATA_URLS;
  const sampleSize = Math.max(1, Math.min(config.sampleSize ?? 3, 8));

  const indexed = await dataFallback(dataUrls);
  const unique: TradeRow[] = [];
  const seen = new Set<string>();
  const orderedTrades = [...indexed.trades].sort((a, b) => (b.timestampMs ?? 0) - (a.timestampMs ?? 0));
  for (const trade of orderedTrades) {
    if (seen.has(trade.hash)) continue;
    seen.add(trade.hash);
    unique.push(trade);
    if (unique.length >= sampleSize) break;
  }
  if (unique.length < sampleSize) throw new Error(`Data API returned only ${unique.length} unique trade transaction(s); need ${sampleSize}`);

  const latest = await rpcCanonicalHead(rpcUrls, config.rpcQuorum);
  let activeRpc = latest.url;
  const chainHead = blockNumber(latest.result?.number);
  if (chainHead === undefined) throw new Error("RPC latest block is missing block number");

  const failures: ProbeFailure[] = [];
  let verified = 0;
  let latestIndexedBlock = 0;
  let latestIndexedTimestampMs = 0;
  for (const trade of unique) {
    const transactionHash = trade.hash;
    if (trade.timestampMs !== undefined) latestIndexedTimestampMs = Math.max(latestIndexedTimestampMs, trade.timestampMs);
    try {
      const ordered = [activeRpc, ...rpcUrls.filter((url) => url !== activeRpc)];
      const receiptResult = await rpcCanonical(ordered, config.rpcQuorum, "eth_getTransactionReceipt", [transactionHash], normalizeReceiptForQuorum);
      activeRpc = receiptResult.url;
      const receipt = receiptResult.result;
      if (!receipt) {
        failures.push({ transactionHash, reason: "canonical receipt not found" });
        continue;
      }
      const receiptBlock = blockNumber(receipt.blockNumber);
      if (receiptBlock !== undefined) latestIndexedBlock = Math.max(latestIndexedBlock, receiptBlock);
      if (receipt.status !== undefined && String(receipt.status).toLowerCase() !== "0x1") {
        failures.push({ transactionHash, reason: "canonical transaction reverted" });
        continue;
      }
      const proof = findOrderFilledProof(receipt);
      if (!proof) {
        failures.push({ transactionHash, reason: "no recognized Polymarket OrderFilled event in canonical receipt" });
        continue;
      }
      verified += 1;
      latestIndexedBlock = Math.max(latestIndexedBlock, proof.blockNumber);
    } catch (error) {
      failures.push({ transactionHash, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    chainHead,
    latestIndexedBlock,
    sampled: unique.length,
    verified,
    failures,
    dataUrl: indexed.url,
    rpcUrl: activeRpc,
    transactionHashes: unique.map((trade) => trade.hash),
    ...(latest.quorum ? { rpcQuorum: latest.quorum } : {}),
    ...(latestIndexedTimestampMs > 0 ? { latestIndexedTimestampMs } : {}),
  };
}

export class PolymarketDataApiSource implements SnapshotSource {
  private cache?: { expiresAt: number; promise: Promise<PilotProbe> };
  constructor(private readonly config: PolymarketDataApiSourceConfig) {}

  private probe(): Promise<PilotProbe> {
    const ttl = Math.max(0, this.config.cacheTtlMs ?? 5_000);
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) return this.cache.promise;
    const promise = probePolymarketDataApi(this.config).catch((error) => {
      if (this.cache?.promise === promise) this.cache = undefined;
      throw error;
    });
    this.cache = { expiresAt: now + ttl, promise };
    return promise;
  }

  async getHead(): Promise<HeadSnapshot> {
    const result = await this.probe();
    const lag = result.latestIndexedBlock > 0 ? result.chainHead - result.latestIndexedBlock : result.chainHead;
    return {
      blockNumber: result.latestIndexedBlock,
      observedAt: new Date().toISOString(),
      reportedHealthy: result.failures.length === 0,
      reportedSynced: lag <= (this.config.maxAnchorLagBlocks ?? 100_000),
    };
  }

  async getState(_key: string): Promise<StateValue | undefined> { return undefined; }
  async getEvents(_stream: string): Promise<EventRecord[]> { return []; }

  async getTransactionCompleteness(
    stream: string,
    request: TransactionCompletenessRequest,
  ): Promise<TransactionCompletenessSnapshot> {
    if (stream !== "OrderFilled") throw new Error(`Polymarket Data API source supports only transaction completeness stream 'OrderFilled', got '${stream}'`);
    const configuredDataUrls = this.config.dataUrls?.length ? this.config.dataUrls : DEFAULT_POLYMARKET_DATA_URLS;
    const configuredV2Urls = configuredDataUrls.filter((url) => url.includes("/v2/"));
    if (!configuredV2Urls.length) {
      return {
        stream,
        canonicalTransactions: 0,
        indexedTransactions: 0,
        matchedTransactions: 0,
        missingTransactions: [],
        coverageProven: false,
        pageCount: 0,
        metadata: {
          classification: "V2_CURSOR_FEED_REQUIRED",
          reason: "transaction completeness requires Polymarket Data API v2 cursor semantics and never falls back to legacy v1",
        },
      };
    }
    const probe = await this.probe();
    if (probe.latestIndexedBlock <= 0) {
      return {
        stream,
        canonicalTransactions: 0,
        indexedTransactions: 0,
        matchedTransactions: 0,
        missingTransactions: [],
        coverageProven: false,
        pageCount: 0,
        metadata: { reason: "no verified indexed anchor block" },
      };
    }

    const rpcUrls = this.config.rpcUrls?.length ? this.config.rpcUrls : DEFAULT_POLYGON_RPC_URLS;
    const dataUrls = configuredDataUrls;
    const settlementLagBlocks = Math.max(0, request.settlementLagBlocks ?? 0);
    if (probe.latestIndexedBlock <= settlementLagBlocks) {
      return {
        stream,
        canonicalTransactions: 0,
        indexedTransactions: 0,
        matchedTransactions: 0,
        missingTransactions: [],
        coverageProven: false,
        newestIndexedBlock: probe.latestIndexedBlock,
        pageCount: 0,
        metadata: {
          classification: "NO_STABLE_FRONTIER",
          reason: `latest indexed block ${probe.latestIndexedBlock} does not exceed settlement lag ${settlementLagBlocks}`,
          settlementLagBlocks,
        },
      };
    }
    // M1.2.3: the newest observed trade only proves that indexing has reached
    // that block; it does not prove every trade in that same trailing block
    // range has landed in the Data API yet. Verify a deliberately older,
    // stable watermark so eventual-consistency at the ingestion frontier does
    // not become a false INCOMPLETE incident.
    const indexedStableThrough = probe.latestIndexedBlock - settlementLagBlocks;
    // M1.3.2: completeness never asks canonical RPCs to prove data beyond the
    // finality-aware quorum head. Both sides must be compared inside the same
    // settled block domain.
    const toBlock = Math.min(indexedStableThrough, probe.chainHead);
    const fromBlock = Math.max(0, toBlock - Math.max(1, request.windowBlocks) + 1);
    let activeRpc = probe.rpcUrl;

    const canonical = await canonicalOrderFilledTransactions(rpcUrls, activeRpc, fromBlock, toBlock, this.config.rpcQuorum);
    activeRpc = canonical.rpcUrl;
    const canonicalSet = new Set(canonical.transactions);

    const indexedSet = new Set<string>();
    let oldestIndexedBlock: number | undefined;
    let newestIndexedBlock: number | undefined = probe.latestIndexedBlock;
    let pageCount = 0;
    let coverageProven = false;
    let activeDataUrl = probe.dataUrl;
    let stoppedByShortPage = false;

    let cursor: string | undefined;
    let stoppedByEndOfFeed = false;
    const v2Urls = configuredV2Urls;
    if (!v2Urls.length) {
      return {
        stream,
        fromBlock,
        toBlock,
        canonicalTransactions: canonical.transactions.length,
        indexedTransactions: 0,
        matchedTransactions: 0,
        missingTransactions: [],
        coverageProven: false,
        newestIndexedBlock,
        pageCount: 0,
        metadata: {
          classification: "V2_CURSOR_FEED_REQUIRED",
          reason: "transaction completeness does not mix legacy v1 trade semantics into a v2 canonical comparison",
          canonicalLogCount: canonical.logCount,
          rpcUrl: activeRpc,
        },
      };
    }
    activeDataUrl = v2Urls.includes(activeDataUrl) ? activeDataUrl : v2Urls[0];

    for (let page = 0; page < request.maxPages; page += 1) {
      const orderedDataUrls = [activeDataUrl, ...v2Urls.filter((url) => url !== activeDataUrl)];
      const response = await dataV2PageFallback(orderedDataUrls, request.indexedPageSize, cursor);
      activeDataUrl = response.url;
      pageCount += 1;
      for (const trade of response.trades) indexedSet.add(trade.hash);

      const uniqueOldest: TradeRow[] = [];
      const seen = new Set<string>();
      const candidates = [...response.trades].sort((a, b) => (a.timestampMs ?? Number.MAX_SAFE_INTEGER) - (b.timestampMs ?? Number.MAX_SAFE_INTEGER));
      for (const trade of candidates) {
        if (seen.has(trade.hash)) continue;
        seen.add(trade.hash);
        uniqueOldest.push(trade);
        if (uniqueOldest.length >= 5) break;
      }
      for (const trade of uniqueOldest) {
        try {
          const boundary = await receiptBlockForTrade(trade, rpcUrls, activeRpc, this.config.rpcQuorum);
          activeRpc = boundary.rpcUrl;
          if (boundary.block !== undefined) oldestIndexedBlock = Math.min(oldestIndexedBlock ?? boundary.block, boundary.block);
        } catch { /* boundary evidence stays unknown; the next candidate/page may prove coverage */ }
      }

      if (oldestIndexedBlock !== undefined && oldestIndexedBlock <= fromBlock) {
        coverageProven = true;
        break;
      }
      if (!response.hasMore || !response.nextCursor) {
        stoppedByEndOfFeed = true;
        coverageProven = true;
        break;
      }
      cursor = response.nextCursor;
    }

    const missingTransactions = canonical.transactions.filter((hash) => !indexedSet.has(hash));
    const missingTransactionBlocks = Object.fromEntries(
      missingTransactions
        .map((hash) => [hash, canonical.transactionBlocks[hash]] as const)
        .filter((entry): entry is readonly [string, number] => typeof entry[1] === "number"),
    );
    const missingBlocks = Object.values(missingTransactionBlocks);
    const oldestMissingBlock = missingBlocks.length ? Math.min(...missingBlocks) : undefined;
    const newestMissingBlock = missingBlocks.length ? Math.max(...missingBlocks) : undefined;
    const maxMissingDepthBlocks = oldestMissingBlock !== undefined ? Math.max(0, toBlock - oldestMissingBlock) : undefined;
    const minMissingDepthBlocks = newestMissingBlock !== undefined ? Math.max(0, toBlock - newestMissingBlock) : undefined;
    const matchedTransactions = canonical.transactions.length - missingTransactions.length;
    return {
      stream,
      fromBlock,
      toBlock,
      canonicalTransactions: canonical.transactions.length,
      indexedTransactions: indexedSet.size,
      matchedTransactions,
      missingTransactions,
      ...(missingTransactions.length ? {
        missingTransactionBlocks,
        oldestMissingBlock,
        newestMissingBlock,
        maxMissingDepthBlocks,
        minMissingDepthBlocks,
      } : {}),
      coverageProven,
      oldestIndexedBlock,
      newestIndexedBlock,
      pageCount,
      metadata: {
        canonicalLogCount: canonical.logCount,
        dataUrl: activeDataUrl,
        rpcUrl: activeRpc,
        rpcQuorum: canonical.quorum,
        stoppedByEndOfFeed,
        paginationMode: "v2-cursor",
        takerOnly: true,
        requestedWindowBlocks: request.windowBlocks,
        indexedPageSize: request.indexedPageSize,
        maxPages: request.maxPages,
        settlementLagBlocks,
        latestObservedIndexedBlock: probe.latestIndexedBlock,
        verifiedThroughBlock: toBlock,
        canonicalQuorumHead: probe.chainHead,
        indexedStableThroughBlock: indexedStableThrough,
        excludedFrontierFromBlock: settlementLagBlocks > 0 ? toBlock + 1 : undefined,
        excludedFrontierToBlock: settlementLagBlocks > 0 ? probe.latestIndexedBlock : undefined,
        ...(missingTransactions.length ? {
          oldestMissingBlock,
          newestMissingBlock,
          maxMissingDepthBlocks,
          minMissingDepthBlocks,
        } : {}),
      },
    };
  }

  async getProvenance(stream: string): Promise<ProvenanceSnapshot> {
    if (stream !== "OrderFilled") throw new Error(`Polymarket Data API source supports only provenance stream 'OrderFilled', got '${stream}'`);
    const result = await this.probe();
    return {
      stream,
      sampled: result.sampled,
      verified: result.verified,
      failures: result.failures,
      observedAtBlock: result.latestIndexedBlock || undefined,
      metadata: {
        chainHead: result.chainHead,
        latestIndexedBlock: result.latestIndexedBlock,
        lagBlocks: result.latestIndexedBlock > 0 ? result.chainHead - result.latestIndexedBlock : result.chainHead,
        latestIndexedTimestamp: result.latestIndexedTimestampMs ? new Date(result.latestIndexedTimestampMs).toISOString() : undefined,
        dataUrl: result.dataUrl,
        rpcUrl: result.rpcUrl,
        rpcQuorum: result.rpcQuorum,
        transactionHashes: result.transactionHashes,
      },
    };
  }

  async getFreshness(stream: string): Promise<FreshnessSnapshot> {
    if (stream !== "OrderFilled") throw new Error(`Polymarket Data API source supports only freshness stream 'OrderFilled', got '${stream}'`);
    const result = await this.probe();

    // M1.4.4: Data API v2 publishes an explicit serving watermark and
    // ingestion cursor status. Treat that as the freshness contract. The
    // newest sampled trade remains useful diagnostics, but it is not a safe
    // proxy for how far the whole serving pipeline has progressed.
    if (result.dataUrl.includes("/v2/")) {
      const sampledTradeAnchorBlock = result.latestIndexedBlock || undefined;
      const sampledTradeLagBlocks = sampledTradeAnchorBlock !== undefined
        ? Math.max(0, result.chainHead - sampledTradeAnchorBlock)
        : result.chainHead;
      const sampledTradeTimestamp = result.latestIndexedTimestampMs
        ? new Date(result.latestIndexedTimestampMs).toISOString()
        : undefined;
      const sampledTradeAgeSeconds = result.latestIndexedTimestampMs
        ? Math.max(0, Math.round((Date.now() - result.latestIndexedTimestampMs) / 1000))
        : undefined;

      try {
        const official = await fetchOfficialStatus(result.dataUrl);
        const anchorBlock = official.minSyncedBlock ?? official.maxSyncedBlock;
        const lagBlocks = anchorBlock !== undefined ? Math.max(0, result.chainHead - anchorBlock) : undefined;
        return {
          stream,
          anchorBlock,
          chainHead: result.chainHead,
          lagBlocks,
          anchorTimestamp: official.computedAt,
          ageSeconds: official.effectiveAgeSeconds,
          scanComplete: true,
          reportedFreshness: {
            basis: "polymarket-v2-status",
            available: true,
            ageSeconds: official.effectiveAgeSeconds,
            lagBlocks,
            observedAt: official.computedAt,
            metadata: {
              statusUrl: official.url,
              statusAgeSeconds: official.statusAgeSeconds,
              servingLagSeconds: official.servingLagSeconds,
              servingWorst: official.servingWorst,
              ingestionCursorCount: official.ingestionCursorCount,
              network: official.network,
              chainId: official.chainId,
              maxSyncedBlock: official.maxSyncedBlock,
              minSyncedBlock: official.minSyncedBlock,
              mostLaggedSource: official.mostLaggedSource,
              mostLaggedBlock: official.mostLaggedBlock,
              mostLaggedBehindMax: official.mostLaggedBehindMax,
            },
          },
          metadata: {
            freshnessBasis: "polymarket-v2-status",
            statusUrl: official.url,
            officialStatus: {
              computedAt: official.computedAt,
              statusAgeSeconds: official.statusAgeSeconds,
              servingLagSeconds: official.servingLagSeconds,
              effectiveAgeSeconds: official.effectiveAgeSeconds,
              servingWorst: official.servingWorst,
              ingestionCursorCount: official.ingestionCursorCount,
              network: official.network,
              chainId: official.chainId,
              maxSyncedBlock: official.maxSyncedBlock,
              minSyncedBlock: official.minSyncedBlock,
              mostLaggedSource: official.mostLaggedSource,
              mostLaggedBlock: official.mostLaggedBlock,
              mostLaggedBehindMax: official.mostLaggedBehindMax,
            },
            sampledTradeAnchor: {
              block: sampledTradeAnchorBlock,
              lagBlocks: sampledTradeLagBlocks,
              timestamp: sampledTradeTimestamp,
              ageSeconds: sampledTradeAgeSeconds,
            },
            dataUrl: result.dataUrl,
            rpcUrl: result.rpcUrl,
            rpcQuorum: result.rpcQuorum,
            transactionHashes: result.transactionHashes,
          },
        };
      } catch (error) {
        return {
          stream,
          chainHead: result.chainHead,
          scanComplete: false,
          reportedFreshness: {
            basis: "polymarket-v2-status",
            available: false,
            reason: error instanceof Error ? error.message : String(error),
          },
          metadata: {
            freshnessBasis: "polymarket-v2-status",
            sampledTradeAnchor: {
              block: sampledTradeAnchorBlock,
              lagBlocks: sampledTradeLagBlocks,
              timestamp: sampledTradeTimestamp,
              ageSeconds: sampledTradeAgeSeconds,
            },
            dataUrl: result.dataUrl,
            rpcUrl: result.rpcUrl,
            rpcQuorum: result.rpcQuorum,
            transactionHashes: result.transactionHashes,
          },
        };
      }
    }

    // Legacy/non-v2 sources retain the M1.1 activity-aware heuristic.
    const anchorBlock = result.latestIndexedBlock || undefined;
    const chainHead = result.chainHead;
    const lagBlocks = anchorBlock !== undefined ? Math.max(0, chainHead - anchorBlock) : chainHead;
    const anchorTimestamp = result.latestIndexedTimestampMs ? new Date(result.latestIndexedTimestampMs).toISOString() : undefined;
    const ageSeconds = result.latestIndexedTimestampMs ? Math.max(0, Math.round((Date.now() - result.latestIndexedTimestampMs) / 1000)) : undefined;

    let canonicalActivityAfterAnchor: boolean | undefined;
    let latestCanonicalActivityBlock: number | undefined;
    let scanComplete = true;
    let activeRpc = result.rpcUrl;
    let scannedToBlock = anchorBlock;
    if (anchorBlock !== undefined && anchorBlock < chainHead) {
      const maxScanBlocks = Math.max(1, this.config.freshnessScanMaxBlocks ?? 5_000);
      const scanTo = Math.min(chainHead, anchorBlock + maxScanBlocks);
      scannedToBlock = scanTo;
      scanComplete = scanTo >= chainHead;
      const ordered = [activeRpc, ...(this.config.rpcUrls?.length ? this.config.rpcUrls : DEFAULT_POLYGON_RPC_URLS).filter((url) => url !== activeRpc)];
      const logsResult = await rpcCanonical(ordered, this.config.rpcQuorum, "eth_getLogs", [{
        fromBlock: `0x${(anchorBlock + 1).toString(16)}`,
        toBlock: `0x${scanTo.toString(16)}`,
        address: [...POLYMARKET_V2_EXCHANGES, ...POLYMARKET_V1_EXCHANGES],
        topics: [[ORDER_FILLED_TOPIC_V2, ORDER_FILLED_TOPIC_V1]],
      }], normalizeLogsForQuorum);
      activeRpc = logsResult.url;
      const logs = Array.isArray(logsResult.result) ? logsResult.result : [];
      canonicalActivityAfterAnchor = logs.length > 0 ? true : (scanComplete ? false : undefined);
      for (const log of logs) {
        const block = blockNumber(log?.blockNumber);
        if (block !== undefined) latestCanonicalActivityBlock = Math.max(latestCanonicalActivityBlock ?? 0, block);
      }
    } else if (anchorBlock !== undefined) {
      canonicalActivityAfterAnchor = false;
    }

    return {
      stream,
      anchorBlock,
      chainHead,
      lagBlocks,
      anchorTimestamp,
      ageSeconds,
      canonicalActivityAfterAnchor,
      latestCanonicalActivityBlock,
      scanComplete,
      metadata: {
        freshnessBasis: "sampled-trade-activity",
        dataUrl: result.dataUrl,
        rpcUrl: activeRpc,
        rpcQuorum: result.rpcQuorum,
        scannedFromBlock: anchorBlock !== undefined ? anchorBlock + 1 : undefined,
        scannedToBlock,
        transactionHashes: result.transactionHashes,
      },
    };
  }
}
