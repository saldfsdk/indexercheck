import type { SnapshotSource, FreshnessSnapshot, ProvenanceSnapshot } from "../core/source.js";
import type { GoldskyEulerSubgraphSourceConfig, HeadSnapshot, StateValue, EventRecord } from "../core/types.js";
import { normalizeReceiptForQuorum, rpcExactQuorum, rpcHeadQuorum, RpcQuorumError, type RpcQuorumEvidence } from "../live/rpc-quorum.js";

const BALANCE_OF_SELECTOR = "70a08231";
const DEBT_OF_SELECTOR = "d283e75f";

function normalizeAddress(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function encodeAddressCall(selector: string, account: string): string {
  const raw = normalizeAddress(account).replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(raw)) throw new Error(`Invalid EVM address '${account}'`);
  return `0x${selector}${raw.padStart(64, "0")}`;
}

function hexQuantity(value: number): string {
  return `0x${BigInt(value).toString(16)}`;
}

function uintString(value: unknown): string {
  try { return BigInt(String(value ?? "0")).toString(10); } catch { return String(value ?? ""); }
}

function rpcUint(value: unknown): string {
  try { return BigInt(String(value ?? "0x0")).toString(10); } catch { return String(value ?? ""); }
}

function isExecutionRevert(message: string): boolean {
  const value = message.toLowerCase();
  if (/(missing trie|historical state|archive|state is not available|header not found|unknown block|timeout|timed out|rate limit|too many requests|http \d+)/i.test(value)) return false;
  return /(execution reverted|vm execution error|revert(?:ed)?\b|contract execution error)/i.test(value);
}

interface SemanticUintQuorumResult {
  value: string;
  evidence: RpcQuorumEvidence & { semanticRevertProviders: string[] };
}

async function rpcEulerDebtQuorum(
  urls: string[],
  params: unknown[],
  call: (url: string, method: string, params: unknown[]) => Promise<any>,
  minAgreement: number,
): Promise<SemanticUintQuorumResult> {
  const uniqueUrls = [...new Set(urls)];
  const outcomes = await Promise.all(uniqueUrls.map(async (url) => {
    try {
      return { url, ok: true as const, value: rpcUint(await call(url, "eth_call", params)), semanticRevert: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isExecutionRevert(message)) {
        // Euler's mapping uses try_debtOf(); a contract-level revert is represented as debt=0.
        return { url, ok: true as const, value: "0", semanticRevert: true };
      }
      return { url, ok: false as const, error: message };
    }
  }));

  const successes = outcomes.filter((item): item is Extract<typeof outcomes[number], { ok: true }> => item.ok);
  const failures = outcomes.filter((item): item is Extract<typeof outcomes[number], { ok: false }> => !item.ok)
    .map((item) => ({ url: item.url, error: item.error }));
  const groups = new Map<string, typeof successes>();
  for (const item of successes) {
    const group = groups.get(item.value) ?? [];
    group.push(item);
    groups.set(item.value, group);
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const [winnerValue, winner] = ranked[0] ?? [undefined, []];
  const evidence: RpcQuorumEvidence & { semanticRevertProviders: string[] } = {
    method: "eth_call:debtOf",
    minAgreement,
    successfulProviders: successes.map((item) => item.url),
    agreeingProviders: winner.map((item) => item.url),
    failedProviders: failures,
    distinctResponses: groups.size,
    semanticRevertProviders: successes.filter((item) => item.semanticRevert).map((item) => item.url),
  };
  if (!winnerValue || winner.length < minAgreement) {
    throw new RpcQuorumError(
      `Canonical RPC quorum failed for Euler debtOf semantics: agreement ${winner.length}/${minAgreement}, semantic-successful=${successes.length}, distinct=${groups.size}`,
      evidence,
    );
  }
  return { value: winnerValue, evidence };
}

export class GoldskyEulerSubgraphSource implements SnapshotSource {
  constructor(private readonly cfg: GoldskyEulerSubgraphSourceConfig) {}

  private urls(): string[] { return [...new Set(this.cfg.rpcUrls ?? [])]; }
  private quorumMin(): number { return Math.max(1, this.cfg.rpcQuorum?.minAgreement ?? 2); }

  private async rpcSingle(url:string, method:string, params:unknown[]):Promise<any> {
    const res = await fetch(url, {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
      redirect:"follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body:any = await res.json();
    if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
    return body.result;
  }

  private async gql(query:string, variables:Record<string,unknown> = {}):Promise<any> {
    const res = await fetch(this.cfg.graphqlUrl, {
      method:"POST",
      headers:{"content-type":"application/json", ...(this.cfg.headers ?? {})},
      body:JSON.stringify({query,variables}),
    });
    if (!res.ok) throw new Error(`Goldsky GraphQL HTTP ${res.status}`);
    const body:any = await res.json();
    if (body.errors?.length) throw new Error(`Goldsky GraphQL: ${body.errors.map((x:any)=>x.message).join("; ")}`);
    return body.data;
  }

  private async canonicalHead() {
    return rpcHeadQuorum(
      this.urls(),
      "latest",
      (url, method, params) => this.rpcSingle(url, method, params),
      this.quorumMin(),
      Math.max(0, this.cfg.rpcQuorum?.maxHeadSkewBlocks ?? 8),
      Math.max(0, this.cfg.rpcQuorum?.agreementLagBlocks ?? 2),
    );
  }

  async getHead(): Promise<HeadSnapshot> {
    const data = await this.gql(`query IndexerCheckGoldskyMeta { _meta { block { number hash } hasIndexingErrors } }`);
    const block = data?._meta?.block;
    if (block?.number === undefined || block?.number === null) throw new Error("Goldsky _meta block number unavailable");
    return {
      blockNumber: Number(block.number),
      blockHash: block.hash ? String(block.hash).toLowerCase() : undefined,
      reportedHealthy: data?._meta?.hasIndexingErrors === false,
      reportedSynced: true,
      observedAt: new Date().toISOString(),
    };
  }

  async getFreshness(stream:string): Promise<FreshnessSnapshot> {
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

  async getProvenance(stream:string): Promise<ProvenanceSnapshot> {
    const sampleSize = Math.max(1, Math.min(this.cfg.sampleSize ?? 3, 20));
    const data = await this.gql(`query IndexerCheckEulerTracking($first: Int!) {
      trackingVaultBalances(first: $first, orderBy: blockNumber, orderDirection: desc) {
        id account vault balance debt blockNumber blockTimestamp transactionHash
      }
    }`, { first: sampleSize });
    const rows:any[] = Array.isArray(data?.trackingVaultBalances) ? data.trackingVaultBalances : [];
    const failures: Array<{ transactionHash?: string; reason: string }> = [];
    const evidenceRows: Array<Record<string, unknown>> = [];
    let verified = 0;
    let observedAtBlock: number | undefined;

    for (const row of rows.slice(0, sampleSize)) {
      const txHash = String(row?.transactionHash ?? "").toLowerCase();
      const account = normalizeAddress(row?.account);
      const vault = normalizeAddress(row?.vault);
      const blockNumber = Number(row?.blockNumber);
      if (!/^0x[0-9a-f]{64}$/.test(txHash) || !/^0x[0-9a-f]{40}$/.test(account) || !/^0x[0-9a-f]{40}$/.test(vault) || !Number.isSafeInteger(blockNumber)) {
        failures.push({ transactionHash: /^0x[0-9a-f]{64}$/.test(txHash) ? txHash : undefined, reason: "Malformed Euler tracking row" });
        continue;
      }
      observedAtBlock = Math.max(observedAtBlock ?? 0, blockNumber);
      try {
        const receiptQ = await rpcExactQuorum(
          this.urls(), "eth_getTransactionReceipt", [txHash],
          (url, method, params) => this.rpcSingle(url, method, params),
          this.quorumMin(), normalizeReceiptForQuorum,
        );
        const receipt = receiptQ.result;
        const canonicalBlock = receipt?.blockNumber ? Number(BigInt(receipt.blockNumber)) : undefined;
        if (canonicalBlock !== blockNumber) {
          failures.push({ transactionHash: txHash, reason: `Canonical receipt block ${canonicalBlock ?? "unknown"} differs from indexed block ${blockNumber}` });
          evidenceRows.push({ id: row?.id, transactionHash: txHash, blockNumber, account, vault, receiptQuorum: receiptQ.evidence, failure: "receipt-block-mismatch" });
          continue;
        }

        const blockTag = hexQuantity(blockNumber);
        const balanceQ = await rpcExactQuorum(
          this.urls(), "eth_call", [{to:vault,data:encodeAddressCall(BALANCE_OF_SELECTOR, account)}, blockTag],
          (url, method, params) => this.rpcSingle(url, method, params),
          this.quorumMin(), (value) => rpcUint(value),
        );
        const debtQ = await rpcEulerDebtQuorum(
          this.urls(), [{to:vault,data:encodeAddressCall(DEBT_OF_SELECTOR, account)}, blockTag],
          (url, method, params) => this.rpcSingle(url, method, params),
          this.quorumMin(),
        );
        const indexedBalance = uintString(row?.balance);
        const indexedDebt = uintString(row?.debt);
        const canonicalBalance = rpcUint(balanceQ.result);
        const canonicalDebt = debtQ.value;
        const balanceOk = canonicalBalance === indexedBalance;
        const debtOk = canonicalDebt === indexedDebt;
        if (!balanceOk || !debtOk) {
          failures.push({ transactionHash: txHash, reason: `Canonical Euler vault state differs from indexed TrackingVaultBalance id=${String(row?.id ?? "")}` });
          evidenceRows.push({
            id: row?.id, transactionHash: txHash, blockNumber, account, vault,
            indexedBalance, canonicalBalance, indexedDebt, canonicalDebt, balanceOk, debtOk,
            receiptQuorum: receiptQ.evidence, balanceQuorum: balanceQ.evidence, debtQuorum: debtQ.evidence,
          });
          continue;
        }
        verified += 1;
        evidenceRows.push({
          id: row?.id,
          transactionHash: txHash,
          blockNumber,
          account,
          vault,
          balance: indexedBalance,
          debt: indexedDebt,
          receiptQuorum: receiptQ.evidence,
          balanceQuorum: balanceQ.evidence,
          debtQuorum: debtQ.evidence,
        });
      } catch (error) {
        failures.push({ transactionHash: txHash, reason: error instanceof Error ? error.message : String(error) });
        evidenceRows.push({
          id: row?.id,
          transactionHash: txHash,
          blockNumber,
          account,
          vault,
          failure: error instanceof Error ? error.message : String(error),
          ...(error instanceof RpcQuorumError ? { failureQuorum: error.evidence } : {}),
        });
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
        entity: "TrackingVaultBalance",
        stateChecks: ["balanceOf(address)", "try_debtOf(address) => 0 on EVM revert"],
        rows: evidenceRows,
      },
    };
  }

  async getState(_key:string):Promise<StateValue|undefined>{ return undefined; }
  async getEvents(_stream:string):Promise<EventRecord[]>{ return []; }
}
