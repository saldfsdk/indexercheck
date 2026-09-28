import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { buildGitHubSummary, buildMachineReport, buildWebhookPayload } from "../core/delivery.js";
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
async function report(file) {
    const project = await loadProject(`${examples}/${file}`);
    return buildMachineReport(await verify(project.config, project.canonical, project.indexed));
}
const upgrade = await report("contract-upgrade-incident.json");
const clean = await report("clean-erc20.json");
const webhook = buildWebhookPayload(upgrade);
const summary = buildGitHubSummary(upgrade);
if (upgrade.schemaVersion !== "1.0" || upgrade.outcome.exitCode !== 1)
    throw new Error("M0.7 upgrade machine artifact failed");
if (upgrade.incidents[0]?.timeline.firstDivergenceBlock !== 104 || upgrade.incidents[0]?.rootCause.type !== "CONTRACT_UPGRADE")
    throw new Error("M0.7 incident semantics failed");
if (clean.outcome.exitCode !== 0 || clean.incidents.length !== 0)
    throw new Error("M0.7 pass exit code failed");
if (webhook.event !== "indexercheck.incident.detected" || webhook.incidentCount !== 1)
    throw new Error("M0.7 webhook payload failed");
if (!summary.includes("CONTRACT_UPGRADE") || !summary.includes("| app-value-incident | CONTRACT_UPGRADE | HIGH | 106 | 103 | 104 |"))
    throw new Error("M0.7 GitHub summary failed");
console.log("M0.7 machine-readable report: schemaVersion=1.0 + stable exitCode PASS");
console.log("M0.7 incident artifact: observed=106 lastGood=103 firstDivergence=104 cause=CONTRACT_UPGRADE PASS");
console.log("M0.7 webhook payload: indexercheck.incident.detected PASS");
console.log("M0.7 GitHub Actions summary: timeline + root cause + tx evidence PASS");
//# sourceMappingURL=milestone-m0.7.js.map