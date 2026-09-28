import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { buildMachineReport, buildWebhookPayload } from "../core/delivery.js";
import {
  appendGitHubStepSummary,
  buildDeliveryResult,
  buildGitHubAnnotations,
  detectCiEnvironment,
  notRequestedStepSummary,
  notRequestedWebhook,
  processExitCode,
  sendWebhook,
} from "../core/live-delivery.js";

const examples = fileURLToPath(new URL("../../examples/", import.meta.url));

async function artifact(file = "contract-upgrade-incident.json") {
  const project = await loadProject(`${examples}/${file}`);
  return buildMachineReport(await verify(project.config, project.canonical, project.indexed));
}

async function listen(server: any): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: any): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error: unknown) => error ? reject(error) : resolve()));
}

test("M0.8 live webhook retries 429, POSTs payload, and signs exact body with HMAC", async () => {
  let requests = 0;
  let receivedBody = "";
  let receivedSignature = "";
  const server = createServer(async (req: any, res: any) => {
    requests += 1;
    const chunks: string[] = [];
    for await (const chunk of req) chunks.push(String(chunk));
    receivedBody = chunks.join("");
    receivedSignature = String(req.headers["x-indexercheck-signature"] ?? "");
    if (requests === 1) {
      res.statusCode = 429;
      res.setHeader("retry-after", "0");
      res.end("rate limited");
      return;
    }
    res.statusCode = 202;
    res.end("accepted");
  });
  const url = await listen(server);
  try {
    const payload = buildWebhookPayload(await artifact());
    const result = await sendWebhook(url, payload, { retries: 2, baseDelayMs: 1, maxDelayMs: 2, timeoutMs: 1000, secret: "test-secret" });
    assert.equal(result.status, "DELIVERED");
    assert.equal(result.attempts, 2);
    assert.equal(result.statusCode, 202);
    assert.equal(result.signed, true);
    assert.equal(requests, 2);
    assert.equal(JSON.parse(receivedBody).event, "indexercheck.incident.detected");
    const expected = `sha256=${createHmac("sha256", "test-secret").update(receivedBody).digest("hex")}`;
    assert.equal(receivedSignature, expected);
  } finally {
    await close(server);
  }
});

test("M0.8 webhook delivery failure is distinct from verification incident", async () => {
  const server = createServer((_req: any, res: any) => {
    res.statusCode = 503;
    res.end("unavailable");
  });
  const url = await listen(server);
  try {
    const machine = await artifact();
    const webhook = await sendWebhook(url, buildWebhookPayload(machine), { retries: 1, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 1000 });
    const ci = detectCiEnvironment({});
    const delivery = buildDeliveryResult(webhook, ci, 0, notRequestedStepSummary());
    assert.equal(machine.outcome.exitCode, 1);
    assert.equal(webhook.status, "FAILED");
    assert.equal(webhook.attempts, 2);
    assert.equal(processExitCode(machine.outcome.exitCode, delivery), 2);
  } finally {
    await close(server);
  }
});

test("M0.8 detects GitHub Actions and builds native annotations", async () => {
  const ci = detectCiEnvironment({ GITHUB_ACTIONS: "true", CI: "true", GITHUB_STEP_SUMMARY: "C:/tmp/summary.md" });
  const annotations = buildGitHubAnnotations(await artifact());
  assert.equal(ci.provider, "github-actions");
  assert.equal(ci.githubActions, true);
  assert.equal(ci.githubStepSummaryPath, "C:/tmp/summary.md");
  assert.equal(annotations.length, 1);
  assert.equal(annotations[0]?.includes("::error title=IndexerCheck%3A CONTRACT_UPGRADE::"), true);
  assert.equal(annotations[0]?.includes("first divergence block 104"), true);
});

test("M0.8 appends GitHub Step Summary instead of replacing existing content", async () => {
  const path = `./.m0.8-step-summary-${process.pid}.md`;
  try {
    await writeFile(path, "# Existing\n", "utf8");
    const result = await appendGitHubStepSummary(path, "## IndexerCheck\nDRIFT");
    const contents = await readFile(path, "utf8");
    assert.equal(result.status, "DELIVERED");
    assert.equal(contents.startsWith("# Existing\n"), true);
    assert.equal(contents.includes("## IndexerCheck\nDRIFT"), true);
  } finally {
    try { await unlink(path); } catch {}
  }
});

test("M0.8 CLI auto-writes GITHUB_STEP_SUMMARY while preserving pure JSON stdout", async () => {
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const config = `${examples}/contract-upgrade-incident.json`;
  const summaryPath = `./.m0.8-cli-summary-${process.pid}.md`;
  try {
    await writeFile(summaryPath, "", "utf8");
    const env = { ...process.env, GITHUB_ACTIONS: "true", CI: "true", GITHUB_STEP_SUMMARY: summaryPath };
    const run = spawnSync(process.execPath, [cli, "verify", "--config", config, "--json"], { encoding: "utf8", env });
    assert.equal(run.status, 1);
    const output = JSON.parse(run.stdout) as any;
    assert.equal(output.outcome.exitCode, 1);
    assert.equal(output.delivery.github.detected, true);
    assert.equal(output.delivery.github.annotationsEmitted, 0);
    assert.equal(output.delivery.github.stepSummary.status, "DELIVERED");
    assert.equal(run.stderr, "");
    const summary = await readFile(summaryPath, "utf8");
    assert.equal(summary.includes("CONTRACT_UPGRADE"), true);
  } finally {
    try { await unlink(summaryPath); } catch {}
  }
});

test("M0.8 CLI emits native GitHub annotation on stdout in human mode", async () => {
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const config = `${examples}/contract-upgrade-incident.json`;
  const summaryPath = `./.m0.8-cli-annotation-summary-${process.pid}.md`;
  try {
    await writeFile(summaryPath, "", "utf8");
    const env = { ...process.env, GITHUB_ACTIONS: "true", CI: "true", GITHUB_STEP_SUMMARY: summaryPath };
    const run = spawnSync(process.execPath, [cli, "verify", "--config", config], { encoding: "utf8", env });
    assert.equal(run.status, 1);
    assert.equal(run.stdout.includes("::error title=IndexerCheck%3A CONTRACT_UPGRADE::"), true);
    assert.equal(run.stdout.includes("IndexerCheck — M0.6 — Contract upgrade incident"), true);
    assert.equal(run.stderr, "");
  } finally {
    try { await unlink(summaryPath); } catch {}
  }
});



test("M0.8 CLI --webhook performs live retry delivery and records result in machine artifact", async () => {
  const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
  const config = `${examples}/contract-upgrade-incident.json`;
  const capturePath = resolve(`./.m0.8-cli-webhook-capture-${process.pid}.json`);
  const artifactPath = resolve(`./.m0.8-cli-webhook-report-${process.pid}.json`);
  const serverScript = `
    const http = require("node:http");
    const fs = require("node:fs");
    const capture = process.argv[1];
    let count = 0;
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        count++;
        const body = Buffer.concat(chunks).toString("utf8");
        if (count === 1) {
          res.statusCode = 429;
          res.setHeader("Retry-After", "0");
          res.end("retry");
          return;
        }
        fs.writeFileSync(capture, JSON.stringify({ count, body, signature: req.headers["x-indexercheck-signature"] || "" }));
        res.statusCode = 202;
        res.end("ok", () => server.close());
      });
    });
    server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
  `;
  const child = spawn(process.execPath, ["-e", serverScript, capturePath], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise<number>((resolvePort, rejectPort) => {
      let buffer = "";
      child.stdout.on("data", (chunk: unknown) => {
        buffer += String(chunk);
        const lineEnd = buffer.indexOf("\n");
        if (lineEnd >= 0) resolvePort(Number(buffer.slice(0, lineEnd)));
      });
      child.on("error", rejectPort);
      child.on("exit", (code: number | null) => { if (!buffer && code !== null) rejectPort(new Error(`webhook test server exited ${code}`)); });
    });
    const env = { ...process.env, INDEXERCHECK_WEBHOOK_SECRET: "cli-secret" };
    const run = spawnSync(process.execPath, [
      cli, "verify", "--config", config,
      "--webhook", `http://127.0.0.1:${port}`,
      "--webhook-retries", "1",
      "--webhook-timeout-ms", "1000",
      "--output", artifactPath,
    ], { encoding: "utf8", env });
    assert.equal(run.status, 1);
    const report = JSON.parse(await readFile(artifactPath, "utf8")) as any;
    assert.equal(report.delivery.webhook.status, "DELIVERED");
    assert.equal(report.delivery.webhook.attempts, 2);
    assert.equal(report.delivery.webhook.statusCode, 202);
    assert.equal(report.delivery.webhook.signed, true);

    for (let i = 0; i < 50; i += 1) {
      try {
        const capture = JSON.parse(await readFile(capturePath, "utf8")) as any;
        assert.equal(capture.count, 2);
        assert.equal(capture.signature.startsWith("sha256="), true);
        assert.equal(JSON.parse(capture.body).event, "indexercheck.incident.detected");
        return;
      } catch (error) {
        if (i === 49) throw error;
        await new Promise((resolveWait) => setTimeout(resolveWait, 10));
      }
    }
  } finally {
    try { child.kill(); } catch {}
    for (const path of [capturePath, artifactPath]) { try { await unlink(path); } catch {} }
  }
});

test("M0.8 no requested delivery keeps verification exit code unchanged", async () => {
  const machine = await artifact();
  const ci = detectCiEnvironment({});
  const delivery = buildDeliveryResult(notRequestedWebhook(), ci, 0, notRequestedStepSummary());
  assert.equal(delivery.allRequestedSucceeded, true);
  assert.equal(processExitCode(machine.outcome.exitCode, delivery), 1);
});
