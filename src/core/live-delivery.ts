import { createHmac } from "node:crypto";
import { appendFile } from "node:fs/promises";
import type { MachineReportV1 } from "./delivery.js";

export type DeliveryStatus = "NOT_REQUESTED" | "DELIVERED" | "FAILED";
export type CiProvider = "github-actions" | "generic-ci" | "local";

export interface WebhookDeliveryResultV1 {
  requested: boolean;
  status: DeliveryStatus;
  attempts: number;
  statusCode?: number;
  signed: boolean;
  error?: string;
}

export interface GitHubStepSummaryDeliveryV1 {
  requested: boolean;
  status: DeliveryStatus;
  path?: string;
  error?: string;
}

export interface GitHubDeliveryResultV1 {
  detected: boolean;
  provider: CiProvider;
  annotationsEmitted: number;
  stepSummary: GitHubStepSummaryDeliveryV1;
}

export interface MachineDeliveryV1 {
  webhook: WebhookDeliveryResultV1;
  github: GitHubDeliveryResultV1;
  allRequestedSucceeded: boolean;
}

export interface CiEnvironment {
  isCi: boolean;
  provider: CiProvider;
  githubActions: boolean;
  githubStepSummaryPath?: string;
}

export interface SendWebhookOptions {
  retries?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  secret?: string;
  sleep?: (ms: number) => Promise<void>;
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

function webhookSignature(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function detectCiEnvironment(env: Record<string, string | undefined> = process.env): CiEnvironment {
  const githubActions = env.GITHUB_ACTIONS === "true";
  const genericCi = githubActions || env.CI === "true";
  return {
    isCi: genericCi,
    provider: githubActions ? "github-actions" : genericCi ? "generic-ci" : "local",
    githubActions,
    ...(env.GITHUB_STEP_SUMMARY ? { githubStepSummaryPath: env.GITHUB_STEP_SUMMARY } : {}),
  };
}

export async function sendWebhook<T extends { event: string }>(
  url: string,
  payload: T,
  options: SendWebhookOptions = {},
): Promise<WebhookDeliveryResultV1> {
  const retries = Math.max(0, options.retries ?? 3);
  const timeoutMs = Math.max(1, options.timeoutMs ?? 5000);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 8000);
  const sleep = options.sleep ?? sleepDefault;
  const body = JSON.stringify(payload);
  const signature = options.secret ? webhookSignature(body, options.secret) : undefined;
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    attempts = attempt;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "user-agent": "indexercheck/0.9.0-m0.9-continuous-watch",
        "x-indexercheck-event": payload.event,
      };
      if (signature) {
        headers["x-indexercheck-signature"] = signature;
        headers["x-indexercheck-signature-version"] = "v1";
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      lastStatusCode = response.status;
      if (response.ok) {
        return {
          requested: true,
          status: "DELIVERED",
          attempts: attempt,
          statusCode: response.status,
          signed: Boolean(signature),
        };
      }

      lastError = `Webhook HTTP ${response.status}`;
      if (!retryableStatus(response.status) || attempt > retries) break;
      const retryHeader = retryAfterMs(response.headers.get("retry-after"));
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await sleep(Math.min(maxDelayMs, retryHeader ?? exponential));
    } catch (error) {
      lastStatusCode = undefined;
      lastError = error instanceof Error && error.name === "AbortError"
        ? `Webhook timeout after ${timeoutMs}ms`
        : errorMessage(error);
      if (attempt > retries) break;
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await sleep(exponential);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    requested: true,
    status: "FAILED",
    attempts,
    ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
    signed: Boolean(signature),
    error: lastError ?? "Webhook delivery failed",
  };
}

function commandEscape(value: string, property = false): string {
  let escaped = value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  if (property) escaped = escaped.replaceAll(":", "%3A").replaceAll(",", "%2C");
  return escaped;
}

export function buildGitHubAnnotations(artifact: MachineReportV1): string[] {
  if (artifact.outcome.exitCode === 0) {
    return ["::notice title=IndexerCheck::Verification PASS"];
  }
  if (artifact.incidents.length === 0) {
    return [`::error title=IndexerCheck::Verification ${commandEscape(artifact.outcome.verdict)}`];
  }
  return artifact.incidents.map((incident) => {
    const title = commandEscape(`IndexerCheck: ${incident.rootCause.type}`, true);
    const first = incident.timeline.firstDivergenceBlock ?? "?";
    const message = commandEscape(`${incident.verdict} in ${incident.id}; first divergence block ${first}; confidence ${incident.rootCause.confidence}`);
    return `::error title=${title}::${message}`;
  });
}

export async function appendGitHubStepSummary(path: string, markdown: string): Promise<GitHubStepSummaryDeliveryV1> {
  try {
    await appendFile(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
    return { requested: true, status: "DELIVERED", path };
  } catch (error) {
    return { requested: true, status: "FAILED", path, error: errorMessage(error) };
  }
}

export function notRequestedWebhook(): WebhookDeliveryResultV1 {
  return { requested: false, status: "NOT_REQUESTED", attempts: 0, signed: false };
}

export function notRequestedStepSummary(): GitHubStepSummaryDeliveryV1 {
  return { requested: false, status: "NOT_REQUESTED" };
}

export function buildDeliveryResult(
  webhook: WebhookDeliveryResultV1,
  ci: CiEnvironment,
  annotationsEmitted: number,
  stepSummary: GitHubStepSummaryDeliveryV1,
): MachineDeliveryV1 {
  const requested = [webhook, stepSummary].filter((item) => item.requested);
  return {
    webhook,
    github: {
      detected: ci.githubActions,
      provider: ci.provider,
      annotationsEmitted,
      stepSummary,
    },
    allRequestedSucceeded: requested.every((item) => item.status === "DELIVERED"),
  };
}

export function processExitCode(verificationExitCode: 0 | 1, delivery: MachineDeliveryV1): 0 | 1 | 2 {
  return delivery.allRequestedSucceeded ? verificationExitCode : 2;
}
