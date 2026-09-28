import { buildPresetConfig } from "../core/init.js";
import { checkSourceFreshness } from "../core/primitives.js";
import { buildMachineReport, type MachineReportV1 } from "../core/delivery.js";
import { advanceWatchState } from "../core/watch.js";
import type { SnapshotSource, FreshnessSnapshot } from "../core/source.js";
import type { EventRecord, HeadSnapshot, StateValue, VerificationReport } from "../core/types.js";

class FreshnessOnlySource implements SnapshotSource {
  constructor(private readonly snapshot: FreshnessSnapshot) {}
  async getHead(): Promise<HeadSnapshot> { return { blockNumber: this.snapshot.anchorBlock ?? 0 }; }
  async getState(_key: string): Promise<StateValue | undefined> { return undefined; }
  async getEvents(_stream: string): Promise<EventRecord[]> { return []; }
  async getFreshness(_stream: string): Promise<FreshnessSnapshot> { return this.snapshot; }
}

const preset = buildPresetConfig("polymarket-pilot");
if (preset.checks.head) throw new Error("M1.1 preset must not use permissive CANONICAL_HEAD freshness");
if (preset.checks.sourceFreshness?.[0]?.stream !== "OrderFilled") throw new Error("M1.1 preset missing SOURCE_FRESHNESS OrderFilled check");

const config = { name: "freshness", stream: "OrderFilled", maxAgeSeconds: 300, maxLagBlocks: 120, activityGraceBlocks: 20 };
const inactive = await checkSourceFreshness(new FreshnessOnlySource({
  stream: "OrderFilled", anchorBlock: 100, chainHead: 300, lagBlocks: 200,
  anchorTimestamp: "2026-09-27T00:00:00.000Z", ageSeconds: 600,
  canonicalActivityAfterAnchor: false, scanComplete: true,
}), config);
if (inactive.status !== "PASS" || inactive.evidence?.classification !== "INACTIVE") throw new Error("M1.1 inactivity semantics failed");

const stale = await checkSourceFreshness(new FreshnessOnlySource({
  stream: "OrderFilled", anchorBlock: 100, chainHead: 300, lagBlocks: 200,
  anchorTimestamp: "2026-09-27T00:00:00.000Z", ageSeconds: 600,
  canonicalActivityAfterAnchor: true, latestCanonicalActivityBlock: 180, scanComplete: true,
}), config);
if (stale.status !== "FAIL" || stale.evidence?.classification !== "STALE") throw new Error("M1.1 stale semantics failed");

function machine(canonical: number, indexed: number, at: string): MachineReportV1 {
  const report: VerificationReport = {
    name: "m1.1-trend", verdict: "PASS", generatedAt: at,
    canonicalHead: { blockNumber: canonical }, indexedHead: { blockNumber: indexed },
    results: [{ primitive: "SOURCE_FRESHNESS", name: "freshness", status: "PASS", summary: "ok", evidence: { classification: "INACTIVE" } }],
  };
  return buildMachineReport(report);
}
const one = advanceWatchState(undefined, machine(100, 99, "2026-09-27T00:00:00.000Z"));
const two = advanceWatchState(one.state, machine(140, 100, "2026-09-27T00:01:00.000Z"));
const three = advanceWatchState(two.state, machine(180, 101, "2026-09-27T00:02:00.000Z"));
if (three.lagTrend !== "GROWING" || three.lagGrowthStreak !== 2 || three.state.observations?.length !== 3) throw new Error("M1.1 lag trend tracking failed");

console.log("M1.1 freshness semantics: old anchor + no canonical activity -> INACTIVE PASS");
console.log("M1.1 stale detection: canonical activity beyond anchor -> STALE FAIL PASS");
console.log("M1.1 pilot preset: activity-aware SOURCE_FRESHNESS replaces maxLagBlocks=2000 head gate PASS");
console.log("M1.1 watch hardening: lag observations persisted; GROWING trend streak=2 PASS");
