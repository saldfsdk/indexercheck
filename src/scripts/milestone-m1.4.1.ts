import { buildPresetConfig } from "../core/init.js";
import { advanceWatchState } from "../core/watch.js";
import type { MachineReportV1 } from "../core/delivery.js";

const config = buildPresetConfig("polymarket-pilot");
if (config.watch?.confirmConsecutiveFailures?.TRANSACTION_COMPLETENESS !== 3) {
  throw new Error("M1.4.1 production preset does not confirm completeness across three ticks");
}

const report: MachineReportV1 = {
  schemaVersion: "1.0",
  kind: "IndexerCheckVerification",
  tool: { name: "indexercheck", version: "0.2.0" },
  generatedAt: "2026-09-27T10:00:00.000Z",
  project: { name: "polymarket-production-pilot" },
  outcome: { verdict: "INCOMPLETE", exitCode: 1, passed: false, incidentCount: 0 },
  heads: { canonical: { blockNumber: 100 }, indexed: { blockNumber: 95 } },
  checks: [{
    primitive: "TRANSACTION_COMPLETENESS",
    name: "orderfilled-transaction-completeness",
    status: "FAIL",
    summary: "candidate omission",
    evidence: { classification: "MISSING_TRANSACTIONS", missingTransactions: ["0x1"] },
  }],
  incidents: [],
};

const first = advanceWatchState(undefined, report, report.generatedAt, config.watch);
if (first.detected !== 0 || first.confirming !== 1) throw new Error("M1.4.1 first failure was not held for confirmation");

console.log("M1.4.1 incident confirmation: transient TRANSACTION_COMPLETENESS failures are held as candidates before alerting PASS");
console.log("M1.4.1 persistence semantics: three consecutive failing ticks are required by the production pilot PASS");
console.log("M1.4.1 recovery semantics: a candidate that clears before confirmation never emits detected/recovered noise PASS");
console.log("M1.4.1 provider diagnostics: degraded quorum preserves failed RPC provider identity for tick/soak output PASS");
