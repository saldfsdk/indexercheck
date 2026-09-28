import type { HeadSnapshot, PrimitiveResult, VerificationReport, Verdict } from "./types.js";
import type { MachineDeliveryV1 } from "./live-delivery.js";
export declare const MACHINE_SCHEMA_VERSION: "1.0";
export declare const WEBHOOK_SCHEMA_VERSION: "1.0";
export declare const TOOL_VERSION: "0.2.0";
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
    tool: {
        name: "indexercheck";
        version: typeof TOOL_VERSION;
    };
    generatedAt: string;
    project: {
        name: string;
    };
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
export declare function exitCodeForVerdict(verdict: Verdict): VerificationExitCode;
export declare function buildMachineReport(report: VerificationReport): MachineReportV1;
export declare function buildWebhookPayload(artifact: MachineReportV1): WebhookPayloadV1;
export declare function buildGitHubSummary(artifact: MachineReportV1): string;
export declare function serializeJson(value: unknown): string;
export declare function writeTextArtifact(path: string, contents: string): Promise<void>;
