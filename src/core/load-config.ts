import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SnapshotSource } from "./source.js";
import type { IndexerCheckConfig, SourceConfig } from "./types.js";
import { FixtureSource } from "../sources/fixture.js";
import { JsonRpcSource } from "../sources/json-rpc.js";
import { GraphQlSource } from "../sources/graphql.js";
import { HttpJsonSource } from "../sources/http-json.js";
import { AdapterSource } from "../sources/adapter.js";
import { PolymarketDataApiSource } from "../sources/polymarket-data-api.js";
import { GoldskyErc20SubgraphSource } from "../sources/goldsky-erc20-subgraph.js";
import { GoldskyEulerSubgraphSource } from "../sources/goldsky-euler-subgraph.js";
import { parseStaticType } from "./generic-provenance.js";
export interface LoadedProject { config: IndexerCheckConfig; canonical: SnapshotSource; indexed: SnapshotSource; }

function isPolymarketV2TradesUrl(raw: string): boolean {
  try {
    return new URL(raw).pathname.includes("/v2/trades");
  } catch {
    return raw.includes("/v2/trades");
  }
}


function validateRpcQuorum(label: string, urls: string[], quorum: { minAgreement?: number } | undefined): void {
  if (!quorum) return;
  const unique = [...new Set(urls)];
  const minAgreement = Math.max(1, quorum.minAgreement ?? 2);
  if (minAgreement > unique.length) {
    throw new Error(`${label} rpcQuorum.minAgreement=${minAgreement} exceeds configured unique RPC providers=${unique.length}`);
  }
}

export function validateProjectConfig(config: IndexerCheckConfig): void {
  if (config.canonical.type === "adapter") throw new Error("M2.3 adapter sources are indexed-only; canonical truth must remain a built-in source");
  if (config.indexed.type === "adapter" && (!config.indexed.module || !config.indexed.module.trim())) throw new Error("indexed adapter source requires a non-empty module path");
  for (const [primitive, value] of Object.entries(config.watch?.confirmConsecutiveFailures ?? {})) {
    if (!Number.isInteger(value) || Number(value) < 1) {
      throw new Error(`watch.confirmConsecutiveFailures.${primitive} must be an integer >= 1`);
    }
  }
  if (config.canonical.type === "json-rpc") validateRpcQuorum("canonical", [config.canonical.url, ...(config.canonical.fallbackUrls ?? [])], config.canonical.rpcQuorum);
  for (const check of config.checks.stateParity ?? []) {
    if (check.proof?.type !== "evm-call") continue;
    if (config.canonical.type !== "json-rpc") throw new Error(`STATE_PARITY '${check.name}' evm-call proof requires canonical.type=json-rpc`);
    if (config.indexed.type !== "graphql" && config.indexed.type !== "http-json" && config.indexed.type !== "adapter") {
      throw new Error(`STATE_PARITY '${check.name}' evm-call proof requires indexed.type=graphql, http-json, or adapter`);
    }
    if (config.indexed.type !== "adapter") {
      const mapping = config.indexed.state?.[check.key];
      if (!mapping) throw new Error(`STATE_PARITY '${check.name}' requires indexed.state.${check.key}`);
      if (!mapping.blockPath) throw new Error(`STATE_PARITY '${check.name}' requires indexed.state.${check.key}.blockPath for historical proof`);
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(check.proof.to)) throw new Error(`STATE_PARITY '${check.name}' proof.to must be a 20-byte EVM address`);
    if (!/^0x[0-9a-fA-F]{8}$/.test(check.proof.selector)) throw new Error(`STATE_PARITY '${check.name}' proof.selector must be a 4-byte function selector`);
    parseStaticType(check.proof.returnType);
    for (const [index, arg] of (check.proof.args ?? []).entries()) {
      parseStaticType(arg.type);
      const hasPath = typeof arg.indexedPath === "string" && arg.indexedPath.length > 0;
      const hasValue = arg.value !== undefined;
      if (hasPath === hasValue) throw new Error(`STATE_PARITY '${check.name}' args[${index}] must define exactly one of indexedPath or value`);
    }
  }
  for (const check of config.checks.eventCompleteness ?? []) {
    if (check.proof?.type !== "evm-log-reverse") continue;
    const canonicalStream = check.proof.canonicalStream ?? check.stream;
    if (config.canonical.type !== "json-rpc") {
      throw new Error(`EVENT_COMPLETENESS '${check.name}' evm-log-reverse proof requires canonical.type=json-rpc`);
    }
    if (!config.canonical.events?.[canonicalStream]) {
      throw new Error(`EVENT_COMPLETENESS '${check.name}' requires canonical.events.${canonicalStream}`);
    }
    if (config.indexed.type !== "graphql" && config.indexed.type !== "http-json" && config.indexed.type !== "adapter") {
      throw new Error(`EVENT_COMPLETENESS '${check.name}' evm-log-reverse proof requires indexed.type=graphql, http-json, or adapter`);
    }
    const windowBlocks = check.proof.windowBlocks ?? 100;
    const settlementLagBlocks = check.proof.settlementLagBlocks ?? 0;
    if (!Number.isInteger(windowBlocks) || windowBlocks < 1) throw new Error(`EVENT_COMPLETENESS '${check.name}' windowBlocks must be an integer >= 1`);
    if (!Number.isInteger(settlementLagBlocks) || settlementLagBlocks < 0) throw new Error(`EVENT_COMPLETENESS '${check.name}' settlementLagBlocks must be an integer >= 0`);
    if (config.indexed.type === "graphql") {
      const mapping = config.indexed.events?.[check.stream];
      if (!mapping) throw new Error(`EVENT_COMPLETENESS '${check.name}' requires indexed.events.${check.stream}`);
      const hasFrom = Boolean(mapping.historicalFromBlockVariable);
      const hasTo = Boolean(mapping.historicalToBlockVariable);
      if (hasFrom !== hasTo) throw new Error(`EVENT_COMPLETENESS '${check.name}' GraphQL historical range requires both historicalFromBlockVariable and historicalToBlockVariable`);
      if (mapping.historicalRangeComplete === true && (!hasFrom || !hasTo)) throw new Error(`EVENT_COMPLETENESS '${check.name}' cannot declare historicalRangeComplete without GraphQL historical range variables`);
    }
    if (config.indexed.type === "http-json") {
      const mapping = config.indexed.events?.[check.stream];
      if (!mapping) throw new Error(`EVENT_COMPLETENESS '${check.name}' requires indexed.events.${check.stream}`);
      if (mapping.historicalRangeComplete === true && !mapping.historicalRequest) {
        throw new Error(`EVENT_COMPLETENESS '${check.name}' cannot declare historicalRangeComplete without HTTP historicalRequest`);
      }
    }
  }
  for (const check of config.checks.provenance ?? []) {
    if (check.proof?.type !== "evm-log") continue;
    const canonicalStream = check.proof.canonicalStream ?? check.stream;
    if (config.canonical.type !== "json-rpc") throw new Error(`PROVENANCE '${check.name}' evm-log proof requires canonical.type=json-rpc`);
    if (!config.canonical.events?.[canonicalStream]) {
      throw new Error(`PROVENANCE '${check.name}' requires canonical.events.${canonicalStream} for evm-log proof`);
    }
    if (config.indexed.type === "graphql" && !config.indexed.events?.[check.stream]) {
      throw new Error(`PROVENANCE '${check.name}' requires indexed.events.${check.stream}`);
    }
    if (config.indexed.type === "http-json" && !config.indexed.events?.[check.stream]) {
      throw new Error(`PROVENANCE '${check.name}' requires indexed.events.${check.stream}`);
    }
    for (const input of check.proof.inputs ?? []) parseStaticType(input.type);
  }
  if (config.indexed.type === "polymarket-data-api") validateRpcQuorum("indexed", config.indexed.rpcUrls ?? [], config.indexed.rpcQuorum);
  if (config.indexed.type === "goldsky-erc20-subgraph") validateRpcQuorum("indexed", config.indexed.rpcUrls ?? [], config.indexed.rpcQuorum);
  if (config.indexed.type === "goldsky-euler-subgraph") validateRpcQuorum("indexed", config.indexed.rpcUrls ?? [], config.indexed.rpcQuorum);
  if (config.indexed.type !== "polymarket-data-api") return;
  if (!(config.checks.transactionCompleteness?.length)) return;
  const urls = config.indexed.dataUrls ?? [];
  if (urls.some((url) => !isPolymarketV2TradesUrl(url))) {
    throw new Error(
      "Polymarket TRANSACTION_COMPLETENESS requires v2-only dataUrls; legacy /trades fallback would mix source semantics",
    );
  }
}
async function loadSource(source:SourceConfig,baseDir:string):Promise<SnapshotSource>{
  if(source.type==="fixture") return FixtureSource.fromFile(source.file,baseDir);
  if(source.type==="json-rpc") return new JsonRpcSource(source);
  if(source.type==="graphql") return new GraphQlSource(source);
  if(source.type==="http-json") return new HttpJsonSource(source);
  if(source.type==="adapter") return AdapterSource.fromConfig(source,baseDir);
  if(source.type==="polymarket-data-api") return new PolymarketDataApiSource(source);
  if(source.type==="goldsky-erc20-subgraph") return new GoldskyErc20SubgraphSource(source);
  if(source.type==="goldsky-euler-subgraph") return new GoldskyEulerSubgraphSource(source);
  throw new Error(`Unsupported source: ${JSON.stringify(source)}`);
}
export async function loadProject(configFile:string):Promise<LoadedProject>{ const absolute=resolve(configFile); const raw=await readFile(absolute,"utf8"); const config=JSON.parse(raw) as IndexerCheckConfig; validateProjectConfig(config); const baseDir=dirname(absolute); return {config,canonical:await loadSource(config.canonical,baseDir),indexed:await loadSource(config.indexed,baseDir)}; }
