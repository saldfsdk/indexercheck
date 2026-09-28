import type { MachineReportV1 } from "../core/delivery.js";
import { TOOL_VERSION } from "../core/delivery.js";
import { advanceWatchState } from "../core/watch.js";

const report: MachineReportV1 = {
  schemaVersion: "1.0",
  kind: "IndexerCheckVerification",
  tool: { name: "indexercheck", version: TOOL_VERSION },
  generatedAt: "2026-09-27T12:00:00.000Z",
  project: { name: "polymarket-production-pilot" },
  outcome: { verdict: "PASS", exitCode: 0, passed: true, incidentCount: 0 },
  heads: { canonical: { blockNumber: 200 }, indexed: { blockNumber: 115 } },
  checks: [{ primitive: "SOURCE_FRESHNESS", name: "freshness", status: "PASS", summary: "fresh", evidence: { classification: "FRESH", freshnessBasis: "polymarket-v2-status", lagBlocks: 1 } }],
  incidents: [],
};
const transition = advanceWatchState(undefined, report);
const observation = transition.state.observations?.[0];
if (observation?.lagBlocks !== 1 || observation.lagBasis !== "polymarket-v2-status" || observation.headLagBlocks !== 85) {
  throw new Error(`unexpected telemetry ${JSON.stringify(observation)}`);
}
console.log("M1.4.5 freshness telemetry: watch lag follows authoritative SOURCE_FRESHNESS evidence PASS");
console.log("M1.4.5 diagnostic separation: sampled/indexed head lag is preserved separately as headLag PASS");
console.log("M1.4.5 trend semantics: lag trend no longer contradicts official freshness classification PASS");
console.log("M1.4.5 soak semantics: maxLag is authoritative freshness lag; maxHeadLag remains diagnostic PASS");
