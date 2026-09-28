import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { checkFirstDivergence } from "../core/primitives.js";
import { verify } from "../core/verifier.js";
import type { SnapshotSource } from "../core/source.js";
import type { EventRecord, HeadSnapshot, StateValue } from "../core/types.js";

const examples = fileURLToPath(new URL("../../examples/", import.meta.url));

test("M0.4 locates Goldsky WETH first bad block with binary-monotonic search", async () => {
  const p = await loadProject(`${examples}/goldsky-weth-divergence.json`);
  const report = await verify(p.config, p.canonical, p.indexed);
  const result = report.results.find((r) => r.primitive === "FIRST_DIVERGENCE");
  assert.equal(report.verdict, "DRIFT");
  assert.equal(result?.firstBadBlock, 19000001);
  assert.equal(result?.lastGoodBlock, 19000000);
  assert.equal(result?.evidence?.strategy, "binary-monotonic");
});

test("M0.4 locates Graph CCTP first missing-event block", async () => {
  const p = await loadProject(`${examples}/graph-cctp-divergence.json`);
  const report = await verify(p.config, p.canonical, p.indexed);
  const result = report.results.find((r) => r.primitive === "FIRST_DIVERGENCE");
  assert.equal(report.verdict, "INCOMPLETE");
  assert.equal(result?.firstBadBlock, 20300002);
  assert.equal(result?.lastGoodBlock, 20300001);
});

class TimelineSource implements SnapshotSource {
  constructor(private readonly values: Record<number,string>) {}
  async getHead(): Promise<HeadSnapshot> { return { blockNumber: 4 }; }
  async getState(key:string):Promise<StateValue|undefined>{ return {key,value:this.values[4],blockNumber:4}; }
  async getStateAt(key:string,blockNumber:number):Promise<StateValue|undefined>{ return {key,value:this.values[blockNumber],blockNumber}; }
  async getEvents(_stream:string):Promise<EventRecord[]>{ return []; }
  async getEventsAt(_stream:string,_from:number,_to:number):Promise<EventRecord[]>{ return []; }
}

test("M0.4 linear search finds earliest divergence even when parity later self-heals", async () => {
  const canonical = new TimelineSource({1:"ok",2:"ok",3:"ok",4:"ok"});
  const indexed = new TimelineSource({1:"ok",2:"bad",3:"ok",4:"bad"});
  const result = await checkFirstDivergence(canonical,indexed,{
    name:"non-monotonic",
    target:{primitive:"STATE_PARITY",key:"x"},
    fromBlock:1,
    toBlock:4,
    strategy:"linear",
  });
  assert.equal(result.firstBadBlock,2);
  assert.equal(result.lastGoodBlock,1);
  assert.equal(result.evidence?.strategy,"linear");
});
