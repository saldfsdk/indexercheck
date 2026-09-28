import test from "node:test";
import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { buildMachineReport } from "../core/delivery.js";
import { acknowledgeWatchEvent, advanceWatchState, emptyWatchState, incidentFingerprint, loadWatchState, parseWatchInterval, saveWatchState, } from "../core/watch.js";
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
async function artifact(file) {
    const project = await loadProject(`${examples}/${file}`);
    return buildMachineReport(await verify(project.config, project.canonical, project.indexed));
}
test("M0.9 lifecycle emits detected once and suppresses unchanged duplicate notifications", async () => {
    const incident = await artifact("contract-upgrade-incident.json");
    incident.generatedAt = "2026-09-27T00:00:00.000Z";
    const first = advanceWatchState(undefined, incident, incident.generatedAt);
    assert.equal(first.detected, 1);
    assert.equal(first.events.length, 1);
    assert.equal(first.events[0]?.type, "indexercheck.incident.detected");
    const acknowledged = acknowledgeWatchEvent(first.state, first.events[0].eventId);
    const secondReport = structuredClone(incident);
    secondReport.generatedAt = "2026-09-27T00:01:00.000Z";
    secondReport.incidents[0].observedAtBlock = 999999;
    if (secondReport.incidents[0].values)
        secondReport.incidents[0].values.canonical = "999";
    const second = advanceWatchState(acknowledged, secondReport, secondReport.generatedAt);
    assert.equal(second.unchanged, 1);
    assert.equal(second.detected, 0);
    assert.equal(second.events.length, 0);
});
test("M0.9 same incident fingerprint emits updated when evidence changes", async () => {
    const incident = await artifact("contract-upgrade-incident.json");
    incident.generatedAt = "2026-09-27T00:00:00.000Z";
    const first = advanceWatchState(undefined, incident, incident.generatedAt);
    const fingerprint = incidentFingerprint(incident.project.name, incident.incidents[0]);
    const acknowledged = acknowledgeWatchEvent(first.state, first.events[0].eventId);
    const changed = structuredClone(incident);
    changed.generatedAt = "2026-09-27T00:02:00.000Z";
    changed.incidents[0].rootCause.confidence = "MEDIUM";
    const second = advanceWatchState(acknowledged, changed, changed.generatedAt);
    assert.equal(second.updated, 1);
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0]?.type, "indexercheck.incident.updated");
    assert.equal(second.events[0]?.payload.fingerprint, fingerprint);
    assert.equal(second.events[0]?.payload.previousIncident?.rootCause.confidence, "HIGH");
    assert.equal(second.events[0]?.payload.incident?.rootCause.confidence, "MEDIUM");
});
test("M0.9 emits recovered with duration when active incident disappears", async () => {
    const incident = await artifact("contract-upgrade-incident.json");
    incident.generatedAt = "2026-09-27T00:00:00.000Z";
    const first = advanceWatchState(undefined, incident, incident.generatedAt);
    const acknowledged = acknowledgeWatchEvent(first.state, first.events[0].eventId);
    const clean = await artifact("clean-erc20.json");
    clean.project.name = incident.project.name;
    clean.generatedAt = "2026-09-27T00:06:00.000Z";
    const recovered = advanceWatchState(acknowledged, clean, clean.generatedAt);
    assert.equal(recovered.recovered, 1);
    assert.equal(recovered.events.length, 1);
    assert.equal(recovered.events[0]?.type, "indexercheck.incident.recovered");
    assert.equal(recovered.events[0]?.payload.recovery?.durationMs, 360000);
    assert.equal(Object.keys(recovered.state.active).length, 0);
});
test("M0.9 failed delivery remains pending and is replayed with the same eventId", async () => {
    const incident = await artifact("graph-cctp-incident.json");
    incident.generatedAt = "2026-09-27T00:00:00.000Z";
    const first = advanceWatchState(undefined, incident, incident.generatedAt);
    const eventId = first.events[0].eventId;
    const replayReport = structuredClone(incident);
    replayReport.generatedAt = "2026-09-27T00:01:00.000Z";
    const second = advanceWatchState(first.state, replayReport, replayReport.generatedAt);
    assert.equal(second.detected, 0);
    assert.equal(second.unchanged, 1);
    assert.equal(second.events.length, 1);
    assert.equal(second.events[0]?.eventId, eventId);
});
test("M0.9 persistence round-trips active incidents and pending delivery queue", async () => {
    const path = `./.m0.9-watch-state-${process.pid}.json`;
    const incident = await artifact("contract-upgrade-incident.json");
    const transition = advanceWatchState(emptyWatchState(incident.project.name), incident);
    try {
        await saveWatchState(path, transition.state);
        const loaded = await loadWatchState(path, incident.project.name);
        assert.equal(loaded.schemaVersion, "1.0");
        assert.equal(Object.keys(loaded.active).length, 1);
        assert.equal(Object.keys(loaded.pendingEvents).length, 1);
        const raw = await readFile(path, "utf8");
        assert.equal(raw.includes("indexercheck.incident.detected"), true);
    }
    finally {
        try {
            await unlink(path);
        }
        catch { }
    }
});
test("M0.9 watch never silently ignores a non-PASS report without INCIDENT_REPORT", async () => {
    const report = await artifact("goldsky-weth.json");
    assert.equal(report.outcome.verdict, "DRIFT");
    assert.equal(report.incidents.length, 0);
    const transition = advanceWatchState(undefined, report);
    assert.equal(transition.detected, 1);
    assert.equal(transition.events[0]?.payload.incident?.rootCause.type, "UNKNOWN");
    assert.equal(transition.events[0]?.payload.incident?.affected.primitive, "STATE_PARITY");
});
test("M0.9 interval parser accepts ms/s/m and rejects too-small values", () => {
    assert.equal(parseWatchInterval("500ms"), 500);
    assert.equal(parseWatchInterval("30s"), 30000);
    assert.equal(parseWatchInterval("2m"), 120000);
    let threw = false;
    try {
        parseWatchInterval("1ms");
    }
    catch {
        threw = true;
    }
    assert.equal(threw, true);
});
//# sourceMappingURL=watch.test.js.map