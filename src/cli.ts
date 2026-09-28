#!/usr/bin/env node
import { loadProject } from "./core/load-config.js";
import { writePresetConfig, type InitPreset } from "./core/init.js";
import { verify } from "./core/verifier.js";
import type { PrimitiveResult, VerificationReport } from "./core/types.js";
import {
  buildGitHubSummary,
  buildMachineReport,
  TOOL_VERSION,
  buildWebhookPayload,
  serializeJson,
  writeTextArtifact,
} from "./core/delivery.js";
import {
  appendGitHubStepSummary,
  buildDeliveryResult,
  buildGitHubAnnotations,
  detectCiEnvironment,
  notRequestedStepSummary,
  notRequestedWebhook,
  processExitCode,
  sendWebhook,
  type MachineDeliveryV1,
} from "./core/live-delivery.js";
import {
  acknowledgeWatchEvent,
  advanceWatchState,
  loadWatchState,
  parseWatchInterval,
  saveWatchState,
  type WatchLifecyclePayloadV1,
} from "./core/watch.js";

function usage(exitCode = 2): void {
  const write = exitCode === 0 ? console.log : console.error;
  write("Usage:");
  write("  indexercheck --help|-h");
  write("  indexercheck --version|-v");
  write("  indexercheck init --preset generic-evm-log|polymarket-pilot|goldsky-kaia-usdt-pilot|goldsky-euler-mainnet-pilot [--output indexercheck.json] [--force]");
  write("  indexercheck verify --config <file> [--json] [--output <file>] [--webhook-output <file>] [--github-summary <file>] [--webhook <url>] [--webhook-retries <n>] [--webhook-timeout-ms <ms>] [--webhook-secret-env <ENV_NAME>] [--github-annotations|--no-github-annotations] [--no-github-step-summary]");
  write("  indexercheck watch --config <file> [--interval 60s] [--state <file>] [--webhook <url>] [--webhook-retries <n>] [--webhook-timeout-ms <ms>] [--webhook-secret-env <ENV_NAME>] [--max-iterations <n>] [--json-lines] [--soak-summary]");
  process.exitCode = exitCode;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function integerOption(args: string[], name: string, fallback: number): number {
  const value = optionValue(args, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function requiredConfig(args: string[]): string | undefined {
  const configIndex = args.indexOf("--config");
  return configIndex >= 0 ? args[configIndex + 1] : undefined;
}

function webhookSettings(args: string[]) {
  const webhookUrl = optionValue(args, "--webhook");
  const webhookSecretEnvArg = optionValue(args, "--webhook-secret-env");
  const valuedOptions = [
    ["--webhook", webhookUrl],
    ["--webhook-secret-env", webhookSecretEnvArg],
    ["--webhook-retries", optionValue(args, "--webhook-retries")],
    ["--webhook-timeout-ms", optionValue(args, "--webhook-timeout-ms")],
  ] as const;
  if (valuedOptions.some(([name, value]) => args.includes(name) && !value)) throw new Error("Missing value for webhook option");
  const webhookRetries = integerOption(args, "--webhook-retries", 3);
  const webhookTimeoutMs = integerOption(args, "--webhook-timeout-ms", 5000);
  const secretEnvName = webhookSecretEnvArg ?? "INDEXERCHECK_WEBHOOK_SECRET";
  const webhookSecret = process.env[secretEnvName] as string | undefined;
  if (webhookSecretEnvArg && !webhookSecret) throw new Error(`Webhook secret environment variable '${secretEnvName}' is not set`);
  return { webhookUrl, webhookRetries, webhookTimeoutMs, webhookSecret };
}

function renderIncident(result: PrimitiveResult): void {
  const incident = result.evidence ?? {};
  const timeline = incident.timeline as Record<string, unknown> | undefined;
  const rootCause = incident.rootCause as Record<string, unknown> | undefined;
  const affected = incident.affected as Record<string, unknown> | undefined;
  const values = incident.values as Record<string, unknown> | undefined;
  const eventDiff = incident.eventDiff as Record<string, unknown> | undefined;
  const relatedTransactions = Array.isArray(incident.relatedTransactions) ? incident.relatedTransactions as string[] : [];
  const relatedLogs = Array.isArray(incident.relatedLogs) ? incident.relatedLogs as Array<Record<string, unknown>> : [];
  const contractChanges = Array.isArray(incident.contractChanges) ? incident.contractChanges as Array<Record<string, unknown>> : [];
  const blockHashMismatch = incident.blockHashMismatch as Record<string, unknown> | undefined;

  console.log("");
  console.log(`Incident Report — ${result.name}`);
  console.log(`Incident verdict    ${incident.incidentVerdict ?? "UNKNOWN"}`);
  console.log(`Observed at         ${timeline?.observedAtBlock !== undefined ? `block ${timeline.observedAtBlock}` : "?"}`);
  console.log(`Last known good     ${timeline?.lastKnownGoodBlock !== undefined ? `block ${timeline.lastKnownGoodBlock}` : "?"}`);
  console.log(`First divergence    ${timeline?.firstDivergenceBlock !== undefined ? `block ${timeline.firstDivergenceBlock}` : "?"}`);
  console.log(`Probable cause      ${rootCause?.cause ?? "UNKNOWN"}`);
  console.log(`Confidence          ${rootCause?.confidence ?? "LOW"}`);
  console.log(`Affected check      ${affected?.primitive ?? "?"} ${affected?.name ?? "?"}`);

  if (values) {
    console.log(`State key           ${values.key ?? "?"}`);
    console.log(`Canonical           ${values.canonical ?? "?"}`);
    console.log(`Indexed             ${values.indexed ?? "?"}`);
  }
  if (eventDiff) {
    console.log(`Event stream        ${eventDiff.stream ?? "?"}`);
    console.log(`Missing events      ${eventDiff.missingCount ?? 0}`);
    console.log(`Unexpected events   ${eventDiff.unexpectedCount ?? 0}`);
  }
  for (const tx of relatedTransactions) console.log(`Related tx          ${tx}`);
  for (const log of relatedLogs) {
    const eventName = log.eventName ?? "event";
    const tx = log.txHash ? ` tx=${log.txHash}` : "";
    const logIndex = log.logIndex !== undefined ? ` logIndex=${log.logIndex}` : "";
    console.log(`Related log         ${eventName}${tx}${logIndex}`);
  }
  for (const change of contractChanges) console.log(`Contract change     ${change.key ?? "state"}: ${change.before ?? "?"} -> ${change.after ?? "?"}`);
  if (blockHashMismatch) {
    console.log(`Block hash          canonical=${blockHashMismatch.canonicalHash ?? "?"}`);
    console.log(`                    indexed=${blockHashMismatch.indexedHash ?? "?"}`);
  }
}

function renderDelivery(delivery: MachineDeliveryV1): void {
  const hasDelivery = delivery.webhook.requested || delivery.github.stepSummary.requested || delivery.github.annotationsEmitted > 0;
  if (!hasDelivery) return;
  console.log("");
  console.log("Delivery");
  if (delivery.webhook.requested) {
    const status = delivery.webhook.statusCode !== undefined ? `${delivery.webhook.status} HTTP ${delivery.webhook.statusCode}` : delivery.webhook.status;
    console.log(`Webhook             ${status} attempts=${delivery.webhook.attempts} signed=${delivery.webhook.signed}`);
    if (delivery.webhook.error) console.log(`Webhook error       ${delivery.webhook.error}`);
  }
  if (delivery.github.stepSummary.requested) {
    console.log(`GitHub summary      ${delivery.github.stepSummary.status}`);
    if (delivery.github.stepSummary.error) console.log(`GitHub error        ${delivery.github.stepSummary.error}`);
  }
  if (delivery.github.annotationsEmitted > 0) console.log(`GitHub annotations  ${delivery.github.annotationsEmitted}`);
}

function render(report: VerificationReport, delivery?: MachineDeliveryV1): void {
  console.log(`IndexerCheck — ${report.name}`);
  console.log("");
  console.log(`Verdict            ${report.verdict}`);
  console.log(`Canonical head     ${report.canonicalHead?.blockNumber ?? "?"}`);
  console.log(`Indexed head       ${report.indexedHead?.blockNumber ?? "?"}`);
  console.log("");
  for (const result of report.results) {
    if (result.primitive === "INCIDENT_REPORT") continue;
    const observed = result.observedAtBlock !== undefined ? ` observedAtBlock=${result.observedAtBlock}` : "";
    const bad = result.primitive === "FIRST_DIVERGENCE" && result.firstBadBlock !== undefined ? ` firstBadBlock=${result.firstBadBlock}` : "";
    const good = result.primitive === "FIRST_DIVERGENCE" && result.lastGoodBlock !== undefined ? ` lastGoodBlock=${result.lastGoodBlock}` : "";
    const cause = result.primitive === "ROOT_CAUSE_EVIDENCE" && result.evidence?.cause ? ` cause=${result.evidence.cause} confidence=${result.evidence.confidence}` : "";
    const freshness = result.primitive === "SOURCE_FRESHNESS" && result.evidence?.classification ? ` classification=${result.evidence.classification}` : "";
    const completeness = result.primitive === "TRANSACTION_COMPLETENESS" && result.evidence?.classification
      ? ` classification=${result.evidence.classification} canonical=${result.evidence.canonicalTransactions ?? "?"} missing=${Array.isArray(result.evidence.missingTransactions) ? result.evidence.missingTransactions.length : "?"}`
      : "";
    const eventCompleteness = result.primitive === "EVENT_COMPLETENESS" && result.evidence?.classification
      ? ` classification=${result.evidence.classification}`
      : "";

    console.log(`${result.status.padEnd(7)} ${result.primitive.padEnd(24)} ${result.name}${observed}${bad}${good}${cause}${freshness}${completeness}${eventCompleteness}`);
    console.log(`        ${result.summary}`);

    if (result.status === "UNKNOWN" && result.evidence?.rpcQuorum) {
      const rpc = result.evidence.rpcQuorum as Record<string, unknown>;
      const agreeing = Array.isArray(rpc.agreeingProviders) ? rpc.agreeingProviders.length : "?";
      const successful = Array.isArray(rpc.successfulProviders) ? rpc.successfulProviders.length : "?";
      const minAgreement = rpc.minAgreement ?? "?";
      const distinct = rpc.distinctResponses ?? "?";

      console.log(
        `        RPC quorum method=${rpc.method ?? "?"} agreement=${agreeing}/${minAgreement} successful=${successful} distinct=${distinct}`,
      );

      const failedProviders = Array.isArray(rpc.failedProviders)
        ? rpc.failedProviders as Array<Record<string, unknown>>
        : [];

      for (const failure of failedProviders) {
        console.log(
          `        RPC failed ${failure.url ?? "?"}: ${failure.error ?? "unknown error"}`,
        );
      }
    }
  }
  for (const result of report.results.filter((item) => item.primitive === "INCIDENT_REPORT")) renderIncident(result);
  if (delivery) renderDelivery(delivery);
}

async function initCommand(args: string[]): Promise<void> {
  const presetValue = optionValue(args, "--preset") ?? "polymarket-pilot";
  if (args.includes("--preset") && !optionValue(args, "--preset")) { usage(); return; }
  if (presetValue !== "generic-evm-log" && presetValue !== "polymarket-pilot" && presetValue !== "goldsky-kaia-usdt-pilot" && presetValue !== "goldsky-euler-mainnet-pilot") throw new Error(`Unsupported preset '${presetValue}'. Available: generic-evm-log, polymarket-pilot, goldsky-kaia-usdt-pilot, goldsky-euler-mainnet-pilot`);
  const outputPath = optionValue(args, "--output") ?? "indexercheck.json";
  if (args.includes("--output") && !optionValue(args, "--output")) { usage(); return; }
  const config = await writePresetConfig(outputPath, presetValue as InitPreset, args.includes("--force"));
  console.log(`Created ${outputPath}`);
  console.log(`Preset             ${presetValue}`);
  console.log(`Project            ${config.name}`);
  console.log(`Next               indexercheck verify --config ${outputPath}`);
  console.log(`Watch              indexercheck watch --config ${outputPath} --interval 60s`);
}

async function verifyCommand(args: string[]): Promise<void> {
  const configFile = requiredConfig(args);
  if (!configFile) { usage(); return; }
  const outputPath = optionValue(args, "--output");
  const webhookOutput = optionValue(args, "--webhook-output");
  const githubSummary = optionValue(args, "--github-summary");
  const valuedOptions = [["--output", outputPath], ["--webhook-output", webhookOutput], ["--github-summary", githubSummary]] as const;
  if (valuedOptions.some(([name, value]) => args.includes(name) && !value)) { usage(); return; }
  if (args.includes("--json") && args.includes("--github-annotations")) throw new Error("--github-annotations cannot be combined with --json; use --output <file> for machine JSON");

  const { webhookUrl, webhookRetries, webhookTimeoutMs, webhookSecret } = webhookSettings(args);
  const project = await loadProject(configFile);
  const report = await verify(project.config, project.canonical, project.indexed);
  const artifact = buildMachineReport(report);
  const webhookPayload = buildWebhookPayload(artifact);
  const ci = detectCiEnvironment();

  const webhookDelivery = webhookUrl
    ? await sendWebhook(webhookUrl, webhookPayload, { retries: webhookRetries, timeoutMs: webhookTimeoutMs, secret: webhookSecret })
    : notRequestedWebhook();
  const summary = buildGitHubSummary(artifact);
  const autoStepSummary = ci.githubActions && Boolean(ci.githubStepSummaryPath) && !args.includes("--no-github-step-summary");
  const stepSummaryDelivery = autoStepSummary && ci.githubStepSummaryPath
    ? await appendGitHubStepSummary(ci.githubStepSummaryPath, summary)
    : notRequestedStepSummary();
  const annotationsEnabled = !args.includes("--json") && (args.includes("--github-annotations") || (ci.githubActions && !args.includes("--no-github-annotations")));
  const annotations = annotationsEnabled ? buildGitHubAnnotations(artifact) : [];
  for (const annotation of annotations) process.stdout.write(`${annotation}\n`);

  const delivery = buildDeliveryResult(webhookDelivery, ci, annotations.length, stepSummaryDelivery);
  artifact.delivery = delivery;
  if (outputPath) await writeTextArtifact(outputPath, serializeJson(artifact));
  if (webhookOutput) await writeTextArtifact(webhookOutput, serializeJson(webhookPayload));
  if (githubSummary) await writeTextArtifact(githubSummary, `${summary}\n`);
  if (args.includes("--json")) process.stdout.write(serializeJson(artifact));
  else render(report, delivery);
  process.exitCode = processExitCode(artifact.outcome.exitCode, delivery);
}

function watchLine(payload: WatchLifecyclePayloadV1): string {
  const cause = payload.incident?.rootCause.type ?? payload.previousIncident?.rootCause.type ?? "UNKNOWN";
  const first = payload.incident?.timeline.firstDivergenceBlock ?? payload.previousIncident?.timeline.firstDivergenceBlock;
  const suffix = first !== undefined ? ` firstDivergence=${first}` : "";
  return `${payload.event} incident=${payload.incidentId} cause=${cause}${suffix}`;
}

async function watchCommand(args: string[]): Promise<void> {
  const configFile = requiredConfig(args);
  if (!configFile) { usage(); return; }
  const intervalRaw = optionValue(args, "--interval") ?? "60s";
  const intervalMs = parseWatchInterval(intervalRaw);
  const statePath = optionValue(args, "--state") ?? ".indexercheck/watch-state.json";
  if (args.includes("--state") && !optionValue(args, "--state")) { usage(); return; }
  const maxIterationsRaw = optionValue(args, "--max-iterations");
  const maxIterations = maxIterationsRaw === undefined ? undefined : integerOption(args, "--max-iterations", 0);
  if (maxIterations !== undefined && maxIterations < 1) throw new Error("--max-iterations must be at least 1");
  const jsonLines = args.includes("--json-lines");
  const soakSummary = args.includes("--soak-summary");
  const { webhookUrl, webhookRetries, webhookTimeoutMs, webhookSecret } = webhookSettings(args);

  let stopping = false;
  let stopResolve: (() => void) | undefined;
  const stopPromise = new Promise<void>((resolveStop) => { stopResolve = resolveStop; });
  const stop = () => { stopping = true; stopResolve?.(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let iteration = 0;
  let unresolvedDeliveryFailure = false;
  let lastTickRuntimeError = false;
  let successfulTicks = 0;
  let errorTicks = 0;
  let quorumHealthyTicks = 0;
  let quorumDegradedTicks = 0;
  let quorumUnknownTicks = 0;
  let maxObservedLagBlocks: number | undefined;
  let maxObservedHeadLagBlocks: number | undefined;
  let maxObservedQuorumSkewBlocks: number | undefined;
  let maxConfirmingIncidents = 0;
  const failedProviderTickCounts = new Map<string, number>();
  try {
    while (!stopping && (maxIterations === undefined || iteration < maxIterations)) {
      iteration += 1;
      try {
        const project = await loadProject(configFile);
        const report = await verify(project.config, project.canonical, project.indexed);
        const artifact = buildMachineReport(report);
        let state = await loadWatchState(statePath, artifact.project.name);
        const transition = advanceWatchState(state, artifact, artifact.generatedAt, project.config.watch);
        state = transition.state;
        unresolvedDeliveryFailure = false;
        lastTickRuntimeError = false;
        successfulTicks += 1;
        if (transition.quorumHealth === "HEALTHY") quorumHealthyTicks += 1;
        else if (transition.quorumHealth === "DEGRADED") quorumDegradedTicks += 1;
        else quorumUnknownTicks += 1;
        maxConfirmingIncidents = Math.max(maxConfirmingIncidents, transition.confirming);
        for (const url of transition.quorum?.failedProviderUrls ?? []) {
          let label = url;
          try { label = new URL(url).hostname; } catch {}
          failedProviderTickCounts.set(label, (failedProviderTickCounts.get(label) ?? 0) + 1);
        }
        const latestObservation = state.observations?.[state.observations.length - 1];
        const tickLag = latestObservation?.lagBlocks;
        if (tickLag !== undefined) maxObservedLagBlocks = maxObservedLagBlocks === undefined ? tickLag : Math.max(maxObservedLagBlocks, tickLag);
        const tickHeadLag = latestObservation?.headLagBlocks;
        if (tickHeadLag !== undefined) maxObservedHeadLagBlocks = maxObservedHeadLagBlocks === undefined ? tickHeadLag : Math.max(maxObservedHeadLagBlocks, tickHeadLag);
        const tickSkew = transition.quorum?.headSkewBlocks;
        if (tickSkew !== undefined) maxObservedQuorumSkewBlocks = maxObservedQuorumSkewBlocks === undefined ? tickSkew : Math.max(maxObservedQuorumSkewBlocks, tickSkew);

        const emitted: WatchLifecyclePayloadV1[] = [];
        for (const event of transition.events) {
          let delivered = true;
          if (webhookUrl) {
            const result = await sendWebhook(webhookUrl, event.payload, { retries: webhookRetries, timeoutMs: webhookTimeoutMs, secret: webhookSecret });
            delivered = result.status === "DELIVERED";
            if (!delivered && !jsonLines) console.error(`[watch] webhook FAILED eventId=${event.eventId} attempts=${result.attempts} ${result.error ?? ""}`.trim());
          }
          if (delivered || !webhookUrl) {
            state = acknowledgeWatchEvent(state, event.eventId);
            emitted.push(event.payload);
          } else {
            unresolvedDeliveryFailure = true;
          }
        }
        await saveWatchState(statePath, state);

        if (jsonLines) {
          process.stdout.write(`${JSON.stringify({
            kind: "IndexerCheckWatchTick",
            iteration,
            generatedAt: artifact.generatedAt,
            verdict: artifact.outcome.verdict,
            activeIncidents: Object.keys(state.active).length,
            pendingDeliveries: Object.keys(state.pendingEvents).length,
            confirmingIncidents: transition.confirming,
            lagBlocks: state.observations?.[state.observations.length - 1]?.lagBlocks,
            lagBasis: state.observations?.[state.observations.length - 1]?.lagBasis,
            headLagBlocks: state.observations?.[state.observations.length - 1]?.headLagBlocks,
            lagTrend: transition.lagTrend,
            lagDeltaBlocks: transition.lagDeltaBlocks,
            lagGrowthStreak: transition.lagGrowthStreak,
            sourceFreshness: transition.sourceFreshness,
            quorumHealth: transition.quorumHealth,
            quorum: transition.quorum,
            lifecycle: emitted,
          })}\n`);
        } else {
          const latestObservation = state.observations?.[state.observations.length - 1];
          const lagPart = latestObservation?.lagBlocks !== undefined ? ` lag=${latestObservation.lagBlocks}` : "";
          const lagBasisPart = latestObservation?.lagBasis ? ` lagBasis=${latestObservation.lagBasis}` : "";
          const headLagPart = latestObservation?.headLagBlocks !== undefined && latestObservation.headLagBlocks !== latestObservation.lagBlocks ? ` headLag=${latestObservation.headLagBlocks}` : "";
          const deltaPart = transition.lagDeltaBlocks !== undefined ? ` delta=${transition.lagDeltaBlocks >= 0 ? "+" : ""}${transition.lagDeltaBlocks}` : "";
          const freshPart = transition.sourceFreshness ? ` freshness=${transition.sourceFreshness}` : "";
          const quorum = transition.quorum;
          const failedBy = (quorum?.failedProviderUrls ?? []).map((url) => { try { return new URL(url).hostname; } catch { return url; } });
          const quorumPart = ` quorum=${transition.quorumHealth}`
            + (quorum?.agreement !== undefined && quorum.minAgreement !== undefined ? ` agreement=${quorum.agreement}/${quorum.minAgreement}` : "")
            + (quorum?.successfulProviders !== undefined ? ` rpcSuccess=${quorum.successfulProviders}` : "")
            + (quorum?.failedProviders !== undefined ? ` rpcFailed=${quorum.failedProviders}` : "")
            + (quorum?.distinctResponses !== undefined ? ` rpcDistinct=${quorum.distinctResponses}` : "")
            + (quorum?.headSkewBlocks !== undefined ? ` rpcSkew=${quorum.headSkewBlocks}` : "")
            + (failedBy.length ? ` rpcFailedBy=${failedBy.join(",")}` : "");
          console.log(`[${artifact.generatedAt}] ${artifact.outcome.verdict} active=${Object.keys(state.active).length} confirming=${transition.confirming} detected=${transition.detected} updated=${transition.updated} recovered=${transition.recovered} unchanged=${transition.unchanged} pending=${Object.keys(state.pendingEvents).length}${lagPart}${lagBasisPart}${headLagPart} trend=${transition.lagTrend}${deltaPart} growthStreak=${transition.lagGrowthStreak}${freshPart}${quorumPart}`);
          for (const payload of emitted) console.log(`  ${watchLine(payload)}`);
        }
      } catch (error) {
        lastTickRuntimeError = true;
        errorTicks += 1;
        const message = error instanceof Error ? error.message : String(error);
        if (jsonLines) {
          process.stdout.write(`${JSON.stringify({
            kind: "IndexerCheckWatchError",
            iteration,
            occurredAt: new Date().toISOString(),
            error: message,
          })}\n`);
        } else {
          console.error(`[watch] verification ERROR iteration=${iteration} ${message}`);
        }
      }

      if (stopping || (maxIterations !== undefined && iteration >= maxIterations)) break;
      await Promise.race([
        new Promise<void>((resolveWait) => setTimeout(resolveWait, intervalMs)),
        stopPromise,
      ]);
    }
  } finally {
    process.off?.("SIGINT", stop);
    process.off?.("SIGTERM", stop);
  }

  if (!jsonLines) console.log(`[watch] stopped after ${iteration} iteration(s)`);
  if (soakSummary) {
    const summary = {
      kind: "IndexerCheckWatchSoakSummary",
      iterations: iteration,
      successfulTicks,
      errorTicks,
      quorumHealthyTicks,
      quorumDegradedTicks,
      quorumUnknownTicks,
      maxObservedLagBlocks,
      maxObservedQuorumSkewBlocks,
      maxConfirmingIncidents,
      failedProviderTickCounts: Object.fromEntries([...failedProviderTickCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
    if (jsonLines) process.stdout.write(`${JSON.stringify(summary)}\n`);
    else {
      const rpcFailures = [...failedProviderTickCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([host, count]) => `${host}:${count}`).join(",");
      console.log(`[watch] soak successful=${successfulTicks} errors=${errorTicks} quorumHealthy=${quorumHealthyTicks} quorumDegraded=${quorumDegradedTicks} quorumUnknown=${quorumUnknownTicks} maxConfirming=${maxConfirmingIncidents}${maxObservedLagBlocks !== undefined ? ` maxLag=${maxObservedLagBlocks}` : ""}${maxObservedHeadLagBlocks !== undefined ? ` maxHeadLag=${maxObservedHeadLagBlocks}` : ""}${maxObservedQuorumSkewBlocks !== undefined ? ` maxRpcSkew=${maxObservedQuorumSkewBlocks}` : ""}${rpcFailures ? ` rpcFailures=${rpcFailures}` : ""}`);
    }
  }
  process.exitCode = unresolvedDeliveryFailure || lastTickRuntimeError ? 2 : 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--help" || args[0] === "-h") return usage(0);
  if (args[0] === "--version" || args[0] === "-v") {
    console.log(TOOL_VERSION);
    return;
  }
  if (args[0] === "init") return initCommand(args);
  if (args[0] === "verify") return verifyCommand(args);
  if (args[0] === "watch") return watchCommand(args);
  usage();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 2;
});
