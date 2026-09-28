import test from "node:test";
import assert from "node:assert/strict";
import { AdapterSource } from "../sources/adapter.js";
import { checkEventCompleteness, checkProvenance, checkStateParity } from "../core/primitives.js";
import { validateProjectConfig } from "../core/load-config.js";
import type { SnapshotSource } from "../core/source.js";
import type { EventRecord, IndexerCheckConfig } from "../core/types.js";

const TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const CONTRACT = "0x1111111111111111111111111111111111111111";

function word(value: bigint): string { return `0x${value.toString(16).padStart(64, "0")}`; }

const canonicalEvent: EventRecord = {
  id: `${TX}:2`, blockNumber: 100, txHash: TX, logIndex: 2, address: CONTRACT, eventName: "Transfer", payload: { topics: [], data: "0x" },
};

function canonical(): SnapshotSource {
  return {
    async getHead() { return { blockNumber: 105 }; },
    async getState() { return undefined; },
    async getEvents() { return [canonicalEvent]; },
    async getEventsAt(_stream, fromBlock, toBlock) { return canonicalEvent.blockNumber >= fromBlock && canonicalEvent.blockNumber <= toBlock ? [canonicalEvent] : []; },
    async getEventsAtWithEvidence(_stream, fromBlock, toBlock) { return { events: canonicalEvent.blockNumber >= fromBlock && canonicalEvent.blockNumber <= toBlock ? [canonicalEvent] : [], metadata: { coverageProven: true } }; },
    async getEvmCallProof(request) { return { value: word(7n), blockNumber: request.blockNumber, metadata: { rpcQuorum: { agreeingProviders: ["a", "b"] } } }; },
  };
}

const options = {
  headBlock: 104,
  rangeComplete: true,
  events: {
    Transfer: [{ id: "legacy-1", block: 100, tx: TX.toUpperCase(), log: 2, contract: CONTRACT.toUpperCase(), kind: "Transfer", payload: { amount: "7" } }],
  },
  states: {
    Balance: { value: "7", block: 100, payload: { account: ACCOUNT } },
  },
};

test("M2.3 JavaScript adapter normalizes custom event/state shapes into the existing proof kernel", async () => {
  const indexed = await AdapterSource.fromConfig({ type: "adapter", module: "./adapters/custom-indexer.mjs", options }, "examples");
  const head = await indexed.getHead();
  assert.equal(head.blockNumber, 104);
  const event = (await indexed.getEvents("Transfer"))[0];
  assert.equal(event.txHash, TX);
  assert.equal(event.logIndex, 2);
  assert.equal(event.address, CONTRACT);
  const state = await indexed.getState("Balance");
  assert.equal(state?.value, "7");
  assert.equal(state?.blockNumber, 100);

  const provenance = await checkProvenance(indexed, { name: "adapter-provenance", stream: "Transfer", minSamples: 1, proof: { type: "evm-log", canonicalStream: "Transfer", sampleSize: 1 } }, canonical());
  assert.equal(provenance.status, "PASS");

  const completeness = await checkEventCompleteness(canonical(), indexed, { name: "adapter-completeness", stream: "Transfer", proof: { type: "evm-log-reverse", canonicalStream: "Transfer", windowBlocks: 10, settlementLagBlocks: 0 } });
  assert.equal(completeness.status, "PASS");
  assert.equal(completeness.evidence?.coverageProven, true);

  const stateParity = await checkStateParity(canonical(), indexed, { name: "adapter-state", key: "Balance", proof: { type: "evm-call", to: CONTRACT, selector: "0x70a08231", args: [{ type: "address", value: ACCOUNT }], returnType: "uint256" } });
  assert.equal(stateParity.status, "PASS");
});

test("M2.3 TypeScript adapter source is type-stripped and loaded locally when the runtime supports it", async () => {
  const indexed = await AdapterSource.fromConfig({ type: "adapter", module: "./adapters/custom-indexer.ts", options }, "examples");
  assert.equal((await indexed.getHead()).blockNumber, 104);
  assert.equal((await indexed.getEvents("Transfer"))[0].txHash, TX);
  assert.equal((await indexed.getState("Balance"))?.value, "7");
});

test("M2.3 adapter runtime failures become UNKNOWN instead of false DRIFT or INCOMPLETE", async () => {
  const eventFailure = await AdapterSource.fromConfig({ type: "adapter", module: "./adapters/custom-indexer.mjs", options: { ...options, failOperation: "events" } }, "examples");
  const provenance = await checkProvenance(eventFailure, { name: "adapter-provenance", stream: "Transfer", minSamples: 1, proof: { type: "evm-log", canonicalStream: "Transfer", sampleSize: 1 } }, canonical());
  assert.equal(provenance.status, "UNKNOWN");
  assert.equal(provenance.evidence?.classification, "INDEXED_SOURCE_UNAVAILABLE");

  const rangeFailure = await AdapterSource.fromConfig({ type: "adapter", module: "./adapters/custom-indexer.mjs", options: { ...options, failOperation: "range" } }, "examples");
  const completeness = await checkEventCompleteness(canonical(), rangeFailure, { name: "adapter-completeness", stream: "Transfer", proof: { type: "evm-log-reverse", canonicalStream: "Transfer", windowBlocks: 10 } });
  assert.equal(completeness.status, "UNKNOWN");
  assert.equal(completeness.evidence?.classification, "INDEXED_SOURCE_UNAVAILABLE");

  const stateFailure = await AdapterSource.fromConfig({ type: "adapter", module: "./adapters/custom-indexer.mjs", options: { ...options, failOperation: "state" } }, "examples");
  const state = await checkStateParity(canonical(), stateFailure, { name: "adapter-state", key: "Balance", proof: { type: "evm-call", to: CONTRACT, selector: "0x70a08231", returnType: "uint256" } });
  assert.equal(state.status, "UNKNOWN");
  assert.equal(state.evidence?.classification, "INDEXED_SOURCE_UNAVAILABLE");
});

test("M2.3 config keeps adapters indexed-only so custom code cannot redefine canonical truth", () => {
  const valid: IndexerCheckConfig = {
    name: "adapter",
    canonical: { type: "json-rpc", url: "https://rpc-a.example", fallbackUrls: ["https://rpc-b.example"], rpcQuorum: { minAgreement: 2 }, events: { Transfer: { fromBlock: 1, toBlock: 1 } } },
    indexed: { type: "adapter", module: "./adapter.mjs", options: {} },
    checks: { provenance: [{ name: "p", stream: "Transfer", proof: { type: "evm-log", canonicalStream: "Transfer" } }] },
  };
  validateProjectConfig(valid);

  let error: unknown;
  try { validateProjectConfig({ ...valid, canonical: { type: "adapter", module: "./evil.mjs" } }); }
  catch (caught) { error = caught; }
  assert.equal(error instanceof Error, true);
  assert.equal(String((error as Error).message).includes("canonical truth"), true);
});
