import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { buildGitHubSummary, buildMachineReport, buildWebhookPayload } from "../core/delivery.js";
import {
  appendGitHubStepSummary,
  buildDeliveryResult,
  buildGitHubAnnotations,
  detectCiEnvironment,
  notRequestedStepSummary,
  processExitCode,
  sendWebhook,
} from "../core/live-delivery.js";

const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
const project = await loadProject(`${examples}/contract-upgrade-incident.json`);
const artifact = buildMachineReport(await verify(project.config, project.canonical, project.indexed));
const payload = buildWebhookPayload(artifact);

let requests = 0;
let body = "";
let signature = "";
const server = createServer(async (req: any, res: any) => {
  requests += 1;
  const chunks: string[] = [];
  for await (const chunk of req) chunks.push(String(chunk));
  body = chunks.join("");
  signature = String(req.headers["x-indexercheck-signature"] ?? "");
  if (requests === 1) {
    res.statusCode = 429;
    res.setHeader("retry-after", "0");
    res.end("retry");
    return;
  }
  res.statusCode = 202;
  res.end("accepted");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const url = `http://127.0.0.1:${address.port}`;

try {
  const webhook = await sendWebhook(url, payload, { retries: 2, baseDelayMs: 1, maxDelayMs: 2, timeoutMs: 1000, secret: "milestone-secret" });
  if (webhook.status !== "DELIVERED" || webhook.attempts !== 2 || webhook.statusCode !== 202) throw new Error("M0.8 webhook retry delivery failed");
  const expectedSignature = `sha256=${createHmac("sha256", "milestone-secret").update(body).digest("hex")}`;
  if (signature !== expectedSignature) throw new Error("M0.8 HMAC signature failed");

  const summaryPath = `./.m0.8-milestone-summary-${process.pid}.md`;
  try {
    await writeFile(summaryPath, "# Existing\n", "utf8");
    const ci = detectCiEnvironment({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_STEP_SUMMARY: summaryPath });
    const annotations = buildGitHubAnnotations(artifact);
    const step = await appendGitHubStepSummary(summaryPath, buildGitHubSummary(artifact));
    const delivery = buildDeliveryResult(webhook, ci, annotations.length, step);
    artifact.delivery = delivery;
    const summary = await readFile(summaryPath, "utf8");
    if (annotations.length !== 1 || !annotations[0]?.includes("CONTRACT_UPGRADE") || !summary.includes("CONTRACT_UPGRADE")) throw new Error("M0.8 GitHub Actions delivery failed");
    if (processExitCode(artifact.outcome.exitCode, delivery) !== 1) throw new Error("M0.8 successful delivery exit semantics failed");

    const failedDelivery = buildDeliveryResult({ requested: true, status: "FAILED", attempts: 2, signed: false, error: "test" }, ci, 0, notRequestedStepSummary());
    if (processExitCode(artifact.outcome.exitCode, failedDelivery) !== 2) throw new Error("M0.8 failed delivery exit semantics failed");
  } finally {
    try { await unlink(summaryPath); } catch {}
  }

  console.log("M0.8 live webhook POST: HTTP 429 retry -> 202 delivery PASS");
  console.log("M0.8 HMAC: X-IndexerCheck-Signature sha256 verification PASS");
  console.log("M0.8 GitHub Actions: native annotation + GITHUB_STEP_SUMMARY append PASS");
  console.log("M0.8 delivery semantics: verification exitCode preserved; requested delivery failure -> process exit 2 PASS");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error: unknown) => error ? reject(error) : resolve()));
}
