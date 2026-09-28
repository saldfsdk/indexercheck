import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
async function incident(file) {
    const project = await loadProject(`${examples}/${file}`);
    const report = await verify(project.config, project.canonical, project.indexed);
    const result = report.results.find((item) => item.primitive === "INCIDENT_REPORT");
    if (!result)
        throw new Error("INCIDENT_REPORT result missing");
    return { report, result };
}
test("M0.6 reserves firstBadBlock for FIRST_DIVERGENCE and uses observedAtBlock for direct observations", async () => {
    const project = await loadProject(`${examples}/contract-upgrade-incident.json`);
    const report = await verify(project.config, project.canonical, project.indexed);
    const state = report.results.find((item) => item.primitive === "STATE_PARITY");
    const divergence = report.results.find((item) => item.primitive === "FIRST_DIVERGENCE");
    const cause = report.results.find((item) => item.primitive === "ROOT_CAUSE_EVIDENCE");
    assert.equal(state?.observedAtBlock, 106);
    assert.equal(state?.firstBadBlock, undefined);
    assert.equal(divergence?.firstBadBlock, 104);
    assert.equal(divergence?.lastGoodBlock, 103);
    assert.equal(cause?.firstBadBlock, undefined);
    assert.equal(cause?.evidence?.firstDivergenceBlock, 104);
});
test("M0.6 assembles contract-upgrade incident with state values, tx/log, and implementation change", async () => {
    const { report, result } = await incident("contract-upgrade-incident.json");
    assert.equal(report.verdict, "DRIFT");
    assert.equal(result.status, "PASS");
    assert.equal(result.observedAtBlock, 106);
    const evidence = result.evidence;
    assert.equal(evidence.incidentVerdict, "DRIFT");
    assert.deepEqual(evidence.timeline, { observedAtBlock: 106, lastKnownGoodBlock: 103, firstDivergenceBlock: 104 });
    assert.deepEqual(evidence.rootCause, {
        cause: "CONTRACT_UPGRADE",
        confidence: "HIGH",
        summary: "Probable root cause: CONTRACT_UPGRADE (HIGH confidence).",
    });
    assert.deepEqual(evidence.values, {
        key: "app.value",
        canonical: "10",
        indexed: "0",
        canonicalBlock: 106,
        indexedBlock: 106,
    });
    assert.deepEqual(evidence.relatedTransactions, ["0xup"]);
    const logs = evidence.relatedLogs;
    assert.equal(logs.some((log) => log.eventName === "Upgraded" && log.txHash === "0xup"), true);
    const changes = evidence.contractChanges;
    assert.equal(changes.some((change) => change.key === "proxy.implementation" && change.before === "0ximpl-a" && change.after === "0ximpl-b"), true);
});
test("M0.6 assembles missed-event incident with the missing canonical event transaction", async () => {
    const { report, result } = await incident("graph-cctp-incident.json");
    assert.equal(report.verdict, "INCOMPLETE");
    const evidence = result.evidence;
    assert.deepEqual(evidence.timeline, { observedAtBlock: 20300003, lastKnownGoodBlock: 20300001, firstDivergenceBlock: 20300002 });
    assert.deepEqual(evidence.relatedTransactions, ["0xbbb"]);
    const logs = evidence.relatedLogs;
    assert.equal(logs.some((log) => log.id === "0xbbb:3" && log.eventName === "MessageSent"), true);
    const eventDiff = evidence.eventDiff;
    assert.equal(eventDiff.stream, "MessageSent");
    assert.equal(eventDiff.missingCount, 1);
});
test("M0.6 carries block-hash mismatch evidence into a reorg incident report", async () => {
    const { result } = await incident("reorg-incident.json");
    const evidence = result.evidence;
    const mismatch = evidence.blockHashMismatch;
    assert.deepEqual(mismatch, { blockNumber: 104, canonicalHash: "0xcanonical104", indexedHash: "0xorphan104" });
    const root = evidence.rootCause;
    assert.equal(root.cause, "REORG_OR_FORK");
    assert.equal(root.confidence, "HIGH");
});
test("M0.6 still assembles an incident when root cause remains UNKNOWN", async () => {
    const { report, result } = await incident("unknown-incident.json");
    assert.equal(report.verdict, "DRIFT");
    assert.equal(result.status, "PASS");
    const root = result.evidence?.rootCause;
    assert.equal(root.cause, "UNKNOWN");
    assert.equal(root.confidence, "LOW");
});
//# sourceMappingURL=incident-report.test.js.map