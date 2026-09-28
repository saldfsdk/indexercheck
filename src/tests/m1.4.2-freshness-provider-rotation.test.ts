import test from "node:test";
import assert from "node:assert/strict";
import type { MachineReportV1 } from "../core/delivery.js";
import { advanceWatchState } from "../core/watch.js";
import type { WatchConfig } from "../core/types.js";
import { buildPresetConfig } from "../core/init.js";
import { DEFAULT_POLYGON_RPC_URLS } from "../live/polymarket-data-api.js";

function staleReport(at: string): MachineReportV1 {
  return {
    schemaVersion: "1.0",
    kind: "IndexerCheckVerification",
    tool: { name: "indexercheck", version: "0.2.0" },
    generatedAt: at,
    project: { name: "polymarket-production-pilot" },
    outcome: { verdict: "STALLED", exitCode: 1, passed: false, incidentCount: 0 },
    heads: { canonical: { blockNumber: 130 }, indexed: { blockNumber: 105 } },
    checks: [{
      primitive: "SOURCE_FRESHNESS",
      name: "orderfilled-freshness",
      status: "FAIL",
      summary: "canonical activity is beyond the indexed anchor",
      observedAtBlock: 130,
      evidence: {
        classification: "STALE",
        anchorBlock: 105,
        latestCanonicalActivityBlock: 130,
        activityLagBlocks: 25,
      },
    }],
    incidents: [],
  };
}

function passReport(at: string): MachineReportV1 {
  return {
    schemaVersion: "1.0",
    kind: "IndexerCheckVerification",
    tool: { name: "indexercheck", version: "0.2.0" },
    generatedAt: at,
    project: { name: "polymarket-production-pilot" },
    outcome: { verdict: "PASS", exitCode: 0, passed: true, incidentCount: 0 },
    heads: { canonical: { blockNumber: 131 }, indexed: { blockNumber: 127 } },
    checks: [{
      primitive: "SOURCE_FRESHNESS",
      name: "orderfilled-freshness",
      status: "PASS",
      summary: "fresh",
      observedAtBlock: 131,
      evidence: { classification: "FRESH" },
    }],
    incidents: [],
  };
}

const policy: WatchConfig = {
  confirmConsecutiveFailures: {
    SOURCE_FRESHNESS: 3,
    TRANSACTION_COMPLETENESS: 3,
  },
};

test("M1.4.2 freshness failure is confirmed only on the third consecutive stale tick", () => {
  const first = advanceWatchState(undefined, staleReport("2026-09-27T11:40:00.000Z"), "2026-09-27T11:40:00.000Z", policy);
  assert.equal(first.detected, 0);
  assert.equal(first.confirming, 1);
  const second = advanceWatchState(first.state, staleReport("2026-09-27T11:40:05.000Z"), "2026-09-27T11:40:05.000Z", policy);
  assert.equal(second.detected, 0);
  assert.equal(second.confirming, 1);
  const third = advanceWatchState(second.state, staleReport("2026-09-27T11:40:10.000Z"), "2026-09-27T11:40:10.000Z", policy);
  assert.equal(third.detected, 1);
  assert.equal(third.confirming, 0);
  assert.equal(third.events[0]?.payload.event, "indexercheck.incident.detected");
});

test("M1.4.2 transient stale freshness clears without detected/recovered alert noise", () => {
  const first = advanceWatchState(undefined, staleReport("2026-09-27T11:40:00.000Z"), "2026-09-27T11:40:00.000Z", policy);
  const second = advanceWatchState(first.state, staleReport("2026-09-27T11:40:05.000Z"), "2026-09-27T11:40:05.000Z", policy);
  const cleared = advanceWatchState(second.state, passReport("2026-09-27T11:40:10.000Z"), "2026-09-27T11:40:10.000Z", policy);
  assert.equal(cleared.detected, 0);
  assert.equal(cleared.recovered, 0);
  assert.equal(cleared.confirming, 0);
  assert.equal(cleared.events.length, 0);
  assert.equal(Object.keys(cleared.state.candidates ?? {}).length, 0);
});

test("M1.4.2 production preset rotates the persistently failing Lava endpoint to current Polygon-listed providers", () => {
  assert.deepEqual(DEFAULT_POLYGON_RPC_URLS, [
    "https://polygon.drpc.org",
    "https://tenderly.rpc.polygon.community",
    "https://polygon.publicnode.com",
  ]);
  const preset = buildPresetConfig("polymarket-pilot");
  assert.deepEqual(
    preset.canonical.type === "json-rpc" ? [preset.canonical.url, ...(preset.canonical.fallbackUrls ?? [])] : [],
    DEFAULT_POLYGON_RPC_URLS,
  );
  assert.deepEqual(preset.indexed.type === "polymarket-data-api" ? preset.indexed.rpcUrls : [], DEFAULT_POLYGON_RPC_URLS);
  assert.equal(preset.watch?.confirmConsecutiveFailures?.SOURCE_FRESHNESS, 3);
});
