import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HeadSnapshot, PrimitiveResult, VerificationReport, Verdict } from "./types.js";
import type { MachineDeliveryV1 } from "./live-delivery.js";

export const MACHINE_SCHEMA_VERSION = "1.0" as const;
export const WEBHOOK_SCHEMA_VERSION = "1.0" as const;
export const TOOL_VERSION = "0.2.0" as const;

export type VerificationExitCode = 0 | 1;

export interface MachineCheckV1 {
  primitive: PrimitiveResult["primitive"];
  name: string;
  status: PrimitiveResult["status"];
  summary: string;
  observedAtBlock?: number;
  firstBadBlock?: number;
  lastGoodBlock?: number;
  evidence?: Record<string, unknown>;
}

export interface MachineIncidentV1 {
  id: string;
  verdict: Verdict;
  observedAtBlock?: number;
  timeline: {
    lastKnownGoodBlock?: number;
    firstDivergenceBlock?: number;
  };
  rootCause: {
    type: string;
    confidence: string;
    summary?: string;
  };
  affected: {
    primitive?: string;
    name?: string;
    status?: string;
    summary?: string;
  };
  values?: Record<string, unknown>;
  eventDiff?: Record<string, unknown>;
  relatedTransactions: string[];
  relatedLogs: Array<Record<string, unknown>>;
  contractChanges: Array<Record<string, unknown>>;
  blockHashMismatch?: Record<string, unknown>;
}

export interface MachineReportV1 {
  schemaVersion: typeof MACHINE_SCHEMA_VERSION;
  kind: "IndexerCheckVerification";
  tool: { name: "indexercheck"; version: typeof TOOL_VERSION };
  generatedAt: string;
  project: { name: string };
  outcome: {
    verdict: Verdict;
    exitCode: VerificationExitCode;
    passed: boolean;
    incidentCount: number;
  };
  heads: {
    canonical?: HeadSnapshot;
    indexed?: HeadSnapshot;
  };
  checks: MachineCheckV1[];
  incidents: MachineIncidentV1[];
  delivery?: MachineDeliveryV1;
}

export interface WebhookPayloadV1 {
  schemaVersion: typeof WEBHOOK_SCHEMA_VERSION;
  event: "indexercheck.verification.passed" | "indexercheck.incident.detected";
  generatedAt: string;
  project: string;
  verdict: Verdict;
  exitCode: VerificationExitCode;
  incidentCount: number;
  incidents: MachineIncidentV1[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) as Array<Record<string, unknown>> : [];
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function exitCodeForVerdict(verdict: Verdict): VerificationExitCode {
  return verdict === "PASS" ? 0 : 1;
}

function incidentFromResult(result: PrimitiveResult, fallbackVerdict: Verdict): MachineIncidentV1 {
  const evidence = result.evidence ?? {};
  const timeline = asRecord(evidence.timeline) ?? {};
  const rootCause = asRecord(evidence.rootCause) ?? {};
  const affected = asRecord(evidence.affected) ?? {};
  const incidentVerdict = optionalString(evidence.incidentVerdict) as Verdict | undefined;
  return {
    id: result.name,
    verdict: incidentVerdict ?? fallbackVerdict,
    observedAtBlock: optionalNumber(timeline.observedAtBlock) ?? result.observedAtBlock,
    timeline: {
      lastKnownGoodBlock: optionalNumber(timeline.lastKnownGoodBlock),
      firstDivergenceBlock: optionalNumber(timeline.firstDivergenceBlock),
    },
    rootCause: {
      type: optionalString(rootCause.cause) ?? "UNKNOWN",
      confidence: optionalString(rootCause.confidence) ?? "LOW",
      summary: optionalString(rootCause.summary),
    },
    affected: {
      primitive: optionalString(affected.primitive),
      name: optionalString(affected.name),
      status: optionalString(affected.status),
      summary: optionalString(affected.summary),
    },
    values: asRecord(evidence.values),
    eventDiff: asRecord(evidence.eventDiff),
    relatedTransactions: asStringArray(evidence.relatedTransactions),
    relatedLogs: asRecordArray(evidence.relatedLogs),
    contractChanges: asRecordArray(evidence.contractChanges),
    blockHashMismatch: asRecord(evidence.blockHashMismatch),
  };
}

export function buildMachineReport(report: VerificationReport): MachineReportV1 {
  const incidents = report.results
    .filter((result) => result.primitive === "INCIDENT_REPORT" && result.status === "PASS")
    .map((result) => incidentFromResult(result, report.verdict));
  const checks = report.results.map((result): MachineCheckV1 => ({
    primitive: result.primitive,
    name: result.name,
    status: result.status,
    summary: result.summary,
    ...(result.observedAtBlock !== undefined ? { observedAtBlock: result.observedAtBlock } : {}),
    ...(result.firstBadBlock !== undefined ? { firstBadBlock: result.firstBadBlock } : {}),
    ...(result.lastGoodBlock !== undefined ? { lastGoodBlock: result.lastGoodBlock } : {}),
    ...(result.evidence ? { evidence: result.evidence } : {}),
  }));
  const exitCode = exitCodeForVerdict(report.verdict);
  return {
    schemaVersion: MACHINE_SCHEMA_VERSION,
    kind: "IndexerCheckVerification",
    tool: { name: "indexercheck", version: TOOL_VERSION },
    generatedAt: report.generatedAt,
    project: { name: report.name },
    outcome: {
      verdict: report.verdict,
      exitCode,
      passed: exitCode === 0,
      incidentCount: incidents.length,
    },
    heads: { canonical: report.canonicalHead, indexed: report.indexedHead },
    checks,
    incidents,
  };
}

export function buildWebhookPayload(artifact: MachineReportV1): WebhookPayloadV1 {
  return {
    schemaVersion: WEBHOOK_SCHEMA_VERSION,
    event: artifact.outcome.exitCode === 0 ? "indexercheck.verification.passed" : "indexercheck.incident.detected",
    generatedAt: artifact.generatedAt,
    project: artifact.project.name,
    verdict: artifact.outcome.verdict,
    exitCode: artifact.outcome.exitCode,
    incidentCount: artifact.outcome.incidentCount,
    incidents: artifact.incidents,
  };
}

function markdownValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function buildGitHubSummary(artifact: MachineReportV1): string {
  const lines: string[] = [
    "## IndexerCheck",
    "",
    `**Verdict:** ${artifact.outcome.verdict}  `,
    `**Exit code:** ${artifact.outcome.exitCode}  `,
    `**Canonical head:** ${artifact.heads.canonical?.blockNumber ?? "?"}  `,
    `**Indexed head:** ${artifact.heads.indexed?.blockNumber ?? "?"}`,
    "",
  ];
  if (artifact.incidents.length === 0) {
    lines.push("✅ No incident report was generated.", "");
  } else {
    lines.push("### Incidents", "", "| Incident | Cause | Confidence | Observed | Last good | First divergence |", "|---|---|---|---:|---:|---:|");
    for (const incident of artifact.incidents) {
      lines.push(`| ${markdownValue(incident.id)} | ${markdownValue(incident.rootCause.type)} | ${markdownValue(incident.rootCause.confidence)} | ${markdownValue(incident.observedAtBlock)} | ${markdownValue(incident.timeline.lastKnownGoodBlock)} | ${markdownValue(incident.timeline.firstDivergenceBlock)} |`);
    }
    lines.push("");
    for (const incident of artifact.incidents) {
      lines.push(`#### ${incident.id}`, "", `- Affected: \`${incident.affected.primitive ?? "?"} ${incident.affected.name ?? "?"}\``, `- Probable cause: **${incident.rootCause.type}** (${incident.rootCause.confidence})`);
      if (incident.relatedTransactions.length > 0) lines.push(`- Related transactions: ${incident.relatedTransactions.map((tx) => `\`${tx}\``).join(", ")}`);
      if (incident.eventDiff) lines.push(`- Event diff: missing=${markdownValue(incident.eventDiff.missingCount)}, unexpected=${markdownValue(incident.eventDiff.unexpectedCount)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeTextArtifact(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}
