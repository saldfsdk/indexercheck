import test from "node:test";
import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { buildGitHubSummary, buildMachineReport, buildWebhookPayload, serializeJson, writeTextArtifact, } from "../core/delivery.js";
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
async function artifact(file) {
    const project = await loadProject(`${examples}/${file}`);
    return buildMachineReport(await verify(project.config, project.canonical, project.indexed));
}
test("M0.7 machine report v1 exposes stable incident semantics and exitCode=1", async () => {
    const result = await artifact("contract-upgrade-incident.json");
    assert.equal(result.schemaVersion, "1.0");
    assert.equal(result.kind, "IndexerCheckVerification");
    assert.equal(result.tool.name, "indexercheck");
    assert.equal(result.outcome.verdict, "DRIFT");
    assert.equal(result.outcome.exitCode, 1);
    assert.equal(result.outcome.passed, false);
    assert.equal(result.outcome.incidentCount, 1);
    assert.equal(result.incidents[0]?.observedAtBlock, 106);
    assert.deepEqual(result.incidents[0]?.timeline, { lastKnownGoodBlock: 103, firstDivergenceBlock: 104 });
    assert.equal(result.incidents[0]?.rootCause.type, "CONTRACT_UPGRADE");
    assert.equal(result.incidents[0]?.rootCause.confidence, "HIGH");
    assert.deepEqual(result.incidents[0]?.relatedTransactions, ["0xup"]);
});
test("M0.7 clean machine report has exitCode=0 and no incidents", async () => {
    const result = await artifact("clean-erc20.json");
    assert.equal(result.outcome.verdict, "PASS");
    assert.equal(result.outcome.exitCode, 0);
    assert.equal(result.outcome.passed, true);
    assert.equal(result.outcome.incidentCount, 0);
    assert.deepEqual(result.incidents, []);
});
test("M0.7 webhook payload emits incident and pass event names", async () => {
    const failing = buildWebhookPayload(await artifact("graph-cctp-incident.json"));
    const passing = buildWebhookPayload(await artifact("clean-erc20.json"));
    assert.equal(failing.event, "indexercheck.incident.detected");
    assert.equal(failing.exitCode, 1);
    assert.equal(failing.incidentCount, 1);
    assert.equal(passing.event, "indexercheck.verification.passed");
    assert.equal(passing.exitCode, 0);
    assert.equal(passing.incidentCount, 0);
});
test("M0.7 GitHub summary includes timeline and root cause", async () => {
    const summary = buildGitHubSummary(await artifact("contract-upgrade-incident.json"));
    assert.equal(summary.includes("**Verdict:** DRIFT"), true);
    assert.equal(summary.includes("CONTRACT_UPGRADE"), true);
    assert.equal(summary.includes("| app-value-incident | CONTRACT_UPGRADE | HIGH | 106 | 103 | 104 |"), true);
    assert.equal(summary.includes("`0xup`"), true);
});
test("M0.7 artifact writer creates machine-readable JSON file", async () => {
    const path = `./.m0.7-artifact-${process.pid}.json`;
    const result = await artifact("contract-upgrade-incident.json");
    try {
        await writeTextArtifact(path, serializeJson(result));
        const parsed = JSON.parse(await readFile(path, "utf8"));
        assert.equal(parsed.schemaVersion, "1.0");
        assert.equal(parsed.outcome?.exitCode, 1);
    }
    finally {
        try {
            await unlink(path);
        }
        catch { }
    }
});
import { spawnSync } from "node:child_process";
test("M0.7 CLI emits JSON, writes delivery artifacts, and exits 1 for detected incident", async () => {
    const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
    const config = `${examples}/contract-upgrade-incident.json`;
    const base = `./.m0.7-cli-${process.pid}`;
    const reportPath = `${base}-report.json`;
    const webhookPath = `${base}-webhook.json`;
    const summaryPath = `${base}-summary.md`;
    try {
        const run = spawnSync(process.execPath, [
            cli,
            "verify",
            "--config", config,
            "--json",
            "--output", reportPath,
            "--webhook-output", webhookPath,
            "--github-summary", summaryPath,
        ], { encoding: "utf8" });
        assert.equal(run.status, 1);
        assert.equal(run.stderr, "");
        const stdout = JSON.parse(run.stdout);
        assert.equal(stdout.schemaVersion, "1.0");
        assert.equal(stdout.outcome?.exitCode, 1);
        const diskReport = JSON.parse(await readFile(reportPath, "utf8"));
        const diskWebhook = JSON.parse(await readFile(webhookPath, "utf8"));
        const diskSummary = await readFile(summaryPath, "utf8");
        assert.equal(diskReport.outcome?.verdict, "DRIFT");
        assert.equal(diskWebhook.event, "indexercheck.incident.detected");
        assert.equal(diskSummary.includes("CONTRACT_UPGRADE"), true);
    }
    finally {
        for (const path of [reportPath, webhookPath, summaryPath]) {
            try {
                await unlink(path);
            }
            catch { }
        }
    }
});
//# sourceMappingURL=delivery.test.js.map