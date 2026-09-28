import test from "node:test";
import assert from "node:assert/strict";
import { advanceWatchState } from "../core/watch.js";
function report(canonical, indexed, officialLag, at) {
    return {
        schemaVersion: "1.0",
        kind: "IndexerCheckVerification",
        tool: { name: "indexercheck", version: "0.2.0" },
        generatedAt: at,
        project: { name: "polymarket-production-pilot" },
        outcome: { verdict: "PASS", exitCode: 0, passed: true, incidentCount: 0 },
        heads: { canonical: { blockNumber: canonical }, indexed: { blockNumber: indexed } },
        checks: [{
                primitive: "SOURCE_FRESHNESS",
                name: "orderfilled-freshness",
                status: "PASS",
                summary: "fresh",
                evidence: { classification: "FRESH", freshnessBasis: "polymarket-v2-status", lagBlocks: officialLag },
            }],
        incidents: [],
    };
}
test("M1.4.5 watch lag follows authoritative SOURCE_FRESHNESS telemetry instead of sampled head drift", () => {
    const transition = advanceWatchState(undefined, report(200, 115, 1, "2026-09-27T12:00:00.000Z"));
    const observation = transition.state.observations?.[0];
    assert.equal(observation?.lagBlocks, 1);
    assert.equal(observation?.lagBasis, "polymarket-v2-status");
    assert.equal(observation?.headLagBlocks, 85);
    assert.equal(observation?.sourceFreshness, "FRESH");
});
test("M1.4.5 lag trend is derived from authoritative freshness lag, not diverging head lag", () => {
    const first = advanceWatchState(undefined, report(200, 150, 2, "2026-09-27T12:00:00.000Z"));
    const second = advanceWatchState(first.state, report(260, 151, 1, "2026-09-27T12:01:00.000Z"));
    assert.equal(second.lagTrend, "SHRINKING");
    assert.equal(second.lagDeltaBlocks, -1);
    assert.equal(second.state.observations?.[1]?.headLagBlocks, 109);
});
//# sourceMappingURL=m1.4.5-freshness-telemetry.test.js.map