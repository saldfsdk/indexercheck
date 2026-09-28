import test from "node:test";
import assert from "node:assert/strict";
import type { MachineReportV1 } from "../core/delivery.js";
import { advanceWatchState, deriveQuorumHealth } from "../core/watch.js";

function reportWithQuorum(quorum: Record<string, unknown>): MachineReportV1 {
  return {
    schemaVersion: "1.0",
    kind: "IndexerCheckVerification",
    tool: { name: "indexercheck", version: "0.2.0" },
    generatedAt: "2026-09-27T10:30:00.000Z",
    project: { name: "polymarket-production-pilot" },
    outcome: { verdict: "PASS", exitCode: 0, passed: true, incidentCount: 0 },
    heads: {
      canonical: { blockNumber: 100 },
      indexed: { blockNumber: 99 },
    },
    checks: [
      {
        primitive: "SOURCE_FRESHNESS",
        name: "freshness",
        status: "PASS",
        summary: "fresh",
        evidence: {
          classification: "FRESH",
          metadata: { rpcQuorum: quorum },
        },
      },
    ],
    incidents: [],
  };
}

const healthyQuorum = {
  method: "eth_getBlockByNumber",
  minAgreement: 2,
  successfulProviders: ["a", "b", "c"],
  agreeingProviders: ["a", "b", "c"],
  failedProviders: [],
  distinctResponses: 1,
  headSkewBlocks: 2,
};

test("M1.4 watch classifies full 3-provider agreement as HEALTHY", () => {
  const health = deriveQuorumHealth(reportWithQuorum(healthyQuorum));
  assert.equal(health.health, "HEALTHY");
  assert.equal(health.samples, 1);
  assert.equal(health.agreement, 3);
  assert.equal(health.minAgreement, 2);
  assert.equal(health.successfulProviders, 3);
  assert.equal(health.failedProviders, 0);
  assert.equal(health.distinctResponses, 1);
  assert.equal(health.headSkewBlocks, 2);
});

test("M1.4 watch marks surviving 2-of-3 quorum as DEGRADED instead of failed", () => {
  const health = deriveQuorumHealth(reportWithQuorum({
    ...healthyQuorum,
    successfulProviders: ["a", "b"],
    agreeingProviders: ["a", "b"],
    failedProviders: [{ url: "c", error: "timeout" }],
  }));
  assert.equal(health.health, "DEGRADED");
  assert.equal(health.agreement, 2);
  assert.equal(health.failedProviders, 1);
});

test("M1.4 watch persists quorum health beside lag/freshness observations", () => {
  const report = reportWithQuorum(healthyQuorum);
  const transition = advanceWatchState(undefined, report);
  assert.equal(transition.quorumHealth, "HEALTHY");
  assert.equal(transition.quorum?.agreement, 3);
  const observation = transition.state.observations?.[0];
  assert.equal(observation?.lagBlocks, 1);
  assert.equal(observation?.sourceFreshness, "FRESH");
  assert.equal(observation?.quorumHealth, "HEALTHY");
  assert.equal(observation?.quorumAgreement, 3);
  assert.equal(observation?.quorumSuccessfulProviders, 3);
  assert.equal(observation?.quorumHeadSkewBlocks, 2);
});
