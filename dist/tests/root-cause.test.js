import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
async function cause(file) {
    const p = await loadProject(`${examples}/${file}`);
    const report = await verify(p.config, p.canonical, p.indexed);
    const result = report.results.find((r) => r.primitive === "ROOT_CAUSE_EVIDENCE");
    if (!result)
        throw new Error("ROOT_CAUSE_EVIDENCE result missing");
    return { report, result };
}
test("M0.5 classifies canonical event omission as MISSED_EVENT with high confidence", async () => {
    const { report, result } = await cause("graph-cctp-root-cause.json");
    assert.equal(report.verdict, "INCOMPLETE");
    assert.equal(result.evidence?.cause, "MISSED_EVENT");
    assert.equal(result.evidence?.confidence, "HIGH");
    assert.equal(result.firstBadBlock, undefined);
    assert.equal(result.evidence?.firstDivergenceBlock, 20300002);
});
test("M0.5 classifies implementation change at first bad block as CONTRACT_UPGRADE", async () => {
    const { report, result } = await cause("contract-upgrade-root-cause.json");
    assert.equal(report.verdict, "DRIFT");
    assert.equal(result.evidence?.cause, "CONTRACT_UPGRADE");
    assert.equal(result.evidence?.confidence, "HIGH");
    const signals = result.evidence?.signals;
    assert.equal(signals.some((s) => s.kind === "UPGRADE_STATE_CHANGED"), true);
});
test("M0.5 classifies historical block hash mismatch as REORG_OR_FORK", async () => {
    const { report, result } = await cause("reorg-root-cause.json");
    assert.equal(report.verdict, "DRIFT");
    assert.equal(result.evidence?.cause, "REORG_OR_FORK");
    assert.equal(result.evidence?.confidence, "HIGH");
});
test("M0.5 returns UNKNOWN instead of guessing when evidence is insufficient", async () => {
    const { report, result } = await cause("unknown-root-cause.json");
    assert.equal(report.verdict, "DRIFT");
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.evidence?.cause, "UNKNOWN");
    assert.equal(result.evidence?.confidence, "LOW");
});
//# sourceMappingURL=root-cause.test.js.map