import { createHmac } from "node:crypto";
import { appendFile } from "node:fs/promises";
function sleepDefault(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function retryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}
function retryAfterMs(value, now = Date.now()) {
    if (!value)
        return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0)
        return Math.ceil(seconds * 1000);
    const date = Date.parse(value);
    if (Number.isFinite(date))
        return Math.max(0, date - now);
    return undefined;
}
function webhookSignature(body, secret) {
    return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}
export function detectCiEnvironment(env = process.env) {
    const githubActions = env.GITHUB_ACTIONS === "true";
    const genericCi = githubActions || env.CI === "true";
    return {
        isCi: genericCi,
        provider: githubActions ? "github-actions" : genericCi ? "generic-ci" : "local",
        githubActions,
        ...(env.GITHUB_STEP_SUMMARY ? { githubStepSummaryPath: env.GITHUB_STEP_SUMMARY } : {}),
    };
}
export async function sendWebhook(url, payload, options = {}) {
    const retries = Math.max(0, options.retries ?? 3);
    const timeoutMs = Math.max(1, options.timeoutMs ?? 5000);
    const baseDelayMs = Math.max(0, options.baseDelayMs ?? 500);
    const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 8000);
    const sleep = options.sleep ?? sleepDefault;
    const body = JSON.stringify(payload);
    const signature = options.secret ? webhookSignature(body, options.secret) : undefined;
    let lastError;
    let lastStatusCode;
    let attempts = 0;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        attempts = attempt;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = {
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
            if (!retryableStatus(response.status) || attempt > retries)
                break;
            const retryHeader = retryAfterMs(response.headers.get("retry-after"));
            const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
            await sleep(Math.min(maxDelayMs, retryHeader ?? exponential));
        }
        catch (error) {
            lastStatusCode = undefined;
            lastError = error instanceof Error && error.name === "AbortError"
                ? `Webhook timeout after ${timeoutMs}ms`
                : errorMessage(error);
            if (attempt > retries)
                break;
            const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
            await sleep(exponential);
        }
        finally {
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
function commandEscape(value, property = false) {
    let escaped = value
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A");
    if (property)
        escaped = escaped.replaceAll(":", "%3A").replaceAll(",", "%2C");
    return escaped;
}
export function buildGitHubAnnotations(artifact) {
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
export async function appendGitHubStepSummary(path, markdown) {
    try {
        await appendFile(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`, "utf8");
        return { requested: true, status: "DELIVERED", path };
    }
    catch (error) {
        return { requested: true, status: "FAILED", path, error: errorMessage(error) };
    }
}
export function notRequestedWebhook() {
    return { requested: false, status: "NOT_REQUESTED", attempts: 0, signed: false };
}
export function notRequestedStepSummary() {
    return { requested: false, status: "NOT_REQUESTED" };
}
export function buildDeliveryResult(webhook, ci, annotationsEmitted, stepSummary) {
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
export function processExitCode(verificationExitCode, delivery) {
    return delivery.allRequestedSucceeded ? verificationExitCode : 2;
}
//# sourceMappingURL=live-delivery.js.map