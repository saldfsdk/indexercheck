import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_VERSION, type MachineReportV1 } from "../core/delivery.js";
import { advanceWatchState, deriveQuorumHealth, emptyWatchState } from "../core/watch.js";
import type { WatchConfig } from "../core/types.js";
import { buildPresetConfig } from "../core/init.js";

function incompleteReport(at: string): MachineReportV1 {
  return {
    schemaVersion: "1.0",
    kind: "IndexerCheckVerification",
    tool: { name: "indexercheck", version: TOOL_VERSION },
    generatedAt: at,
    project: { name: "polymarket-production-pilot" },
    outcome: { verdict: "INCOMPLETE", exitCode: 1, passed: false, incidentCount: 0 },
    heads: { canonical: { blockNumber: 110 }, indexed: { blockNumber: 104 } },
    checks: [{
      primitive: "TRANSACTION_COMPLETENESS",
      name: "orderfilled-transaction-completeness",
      status: "FAIL",
      summary: "temporary missing transactions",
      observedAtBlock: 99,
      evidence: { classification: "MISSING_TRANSACTIONS", missingTransactions: ["0xabc"] },
    }],
    incidents: [],
  };
}

function passReport(at: string): MachineReportV1 {
  return {
    schemaVersion: "1.0",
    kind: "IndexerCheckVerification",
    tool: { name: "indexercheck", version: TOOL_VERSION },
    generatedAt: at,
    project: { name: "polymarket-production-pilot" },
    outcome: { verdict: "PASS", exitCode: 0, passed: true, incidentCount: 0 },
    heads: { canonical: { blockNumber: 111 }, indexed: { blockNumber: 110 } },
    checks: [],
    incidents: [],
  };
}

const policy: WatchConfig = { confirmConsecutiveFailures: { TRANSACTION_COMPLETENESS: 3 } };

test("M1.4.1 watch confirms transaction-completeness failure only on the third consecutive tick", () => {
  const first = advanceWatchState(undefined, incompleteReport("2026-09-27T10:00:00.000Z"), "2026-09-27T10:00:00.000Z", policy);
  assert.equal(first.detected, 0);
  assert.equal(first.confirming, 1);
  assert.equal(Object.keys(first.state.active).length, 0);
  assert.equal(Object.values(first.state.candidates ?? {})[0]?.consecutiveFailures, 1);

  const second = advanceWatchState(first.state, incompleteReport("2026-09-27T10:00:05.000Z"), "2026-09-27T10:00:05.000Z", policy);
  assert.equal(second.detected, 0);
  assert.equal(second.confirming, 1);
  assert.equal(Object.values(second.state.candidates ?? {})[0]?.consecutiveFailures, 2);

  const third = advanceWatchState(second.state, incompleteReport("2026-09-27T10:00:10.000Z"), "2026-09-27T10:00:10.000Z", policy);
  assert.equal(third.detected, 1);
  assert.equal(third.confirming, 0);
  assert.equal(Object.keys(third.state.active).length, 1);
  assert.equal(Object.keys(third.state.candidates ?? {}).length, 0);
  assert.equal(third.events[0]?.payload.event, "indexercheck.incident.detected");
});

test("M1.4.1 transient two-tick completeness gap clears without ever creating an incident", () => {
  const first = advanceWatchState(undefined, incompleteReport("2026-09-27T10:00:00.000Z"), "2026-09-27T10:00:00.000Z", policy);
  const second = advanceWatchState(first.state, incompleteReport("2026-09-27T10:00:05.000Z"), "2026-09-27T10:00:05.000Z", policy);
  const recoveredBeforeAlert = advanceWatchState(second.state, passReport("2026-09-27T10:00:10.000Z"), "2026-09-27T10:00:10.000Z", policy);
  assert.equal(recoveredBeforeAlert.detected, 0);
  assert.equal(recoveredBeforeAlert.recovered, 0);
  assert.equal(recoveredBeforeAlert.confirming, 0);
  assert.equal(Object.keys(recoveredBeforeAlert.state.active).length, 0);
  assert.equal(Object.keys(recoveredBeforeAlert.state.candidates ?? {}).length, 0);
  assert.equal(recoveredBeforeAlert.events.length, 0);
});

test("M1.4.1 provider diagnostics preserve the failed RPC identity", () => {
  const report = passReport("2026-09-27T10:00:00.000Z");
  report.checks = [{
    primitive: "SOURCE_FRESHNESS",
    name: "freshness",
    status: "PASS",
    summary: "fresh",
    evidence: {
      classification: "FRESH",
      metadata: {
        rpcQuorum: {
          method: "eth_getBlockByNumber",
          minAgreement: 2,
          successfulProviders: ["https://a.example", "https://b.example"],
          agreeingProviders: ["https://a.example", "https://b.example"],
          failedProviders: [{ url: "https://c.example", error: "timeout" }],
          distinctResponses: 1,
          headSkewBlocks: 1,
        },
      },
    },
  }];
  const health = deriveQuorumHealth(report);
  assert.equal(health.health, "DEGRADED");
  assert.deepEqual(health.failedProviderUrls, ["https://c.example"]);
});

test("M1.4.1 production preset requires three consecutive completeness failures before watch alerting", () => {
  const preset = buildPresetConfig("polymarket-pilot");
  assert.equal(preset.watch?.confirmConsecutiveFailures?.TRANSACTION_COMPLETENESS, 3);
});
