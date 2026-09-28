import type { MachineIncidentV1, MachineReportV1 } from "./delivery.js";
import type { WatchConfig } from "./types.js";
export declare const WATCH_STATE_SCHEMA_VERSION: "1.0";
export declare const WATCH_EVENT_SCHEMA_VERSION: "1.0";
export type WatchLifecycleEventType = "indexercheck.incident.detected" | "indexercheck.incident.updated" | "indexercheck.incident.recovered";
export interface WatchLifecyclePayloadV1 {
    schemaVersion: typeof WATCH_EVENT_SCHEMA_VERSION;
    event: WatchLifecycleEventType;
    eventId: string;
    occurredAt: string;
    project: string;
    fingerprint: string;
    incidentId: string;
    incident?: MachineIncidentV1;
    previousIncident?: MachineIncidentV1;
    recovery?: {
        detectedAt: string;
        recoveredAt: string;
        durationMs: number;
    };
    verification: {
        verdict: string;
        generatedAt: string;
        canonicalHead?: number;
        indexedHead?: number;
    };
}
export interface WatchPendingEventV1 {
    eventId: string;
    type: WatchLifecycleEventType;
    createdAt: string;
    payload: WatchLifecyclePayloadV1;
}
export interface WatchActiveIncidentV1 {
    fingerprint: string;
    incidentId: string;
    detectedAt: string;
    lastSeenAt: string;
    snapshotHash: string;
    incident: MachineIncidentV1;
}
export interface WatchCandidateIncidentV1 {
    fingerprint: string;
    incidentId: string;
    firstSeenAt: string;
    lastSeenAt: string;
    consecutiveFailures: number;
    requiredConfirmations: number;
    snapshotHash: string;
    incident: MachineIncidentV1;
}
export type QuorumHealth = "HEALTHY" | "DEGRADED" | "UNKNOWN";
export interface WatchObservationV1 {
    observedAt: string;
    canonicalHead?: number;
    indexedHead?: number;
    lagBlocks?: number;
    lagBasis?: string;
    headLagBlocks?: number;
    sourceFreshness?: string;
    quorumHealth?: QuorumHealth;
    quorumSamples?: number;
    quorumMinAgreement?: number;
    quorumAgreement?: number;
    quorumSuccessfulProviders?: number;
    quorumFailedProviders?: number;
    quorumDistinctResponses?: number;
    quorumHeadSkewBlocks?: number;
    quorumFailedProviderUrls?: string[];
}
export interface QuorumHealthSummary {
    health: QuorumHealth;
    samples: number;
    minAgreement?: number;
    agreement?: number;
    successfulProviders?: number;
    failedProviders?: number;
    distinctResponses?: number;
    headSkewBlocks?: number;
    failedProviderUrls?: string[];
    successfulProviderUrls?: string[];
    agreeingProviderUrls?: string[];
}
export type LagTrend = "GROWING" | "STABLE" | "SHRINKING" | "UNKNOWN";
export interface WatchStateV1 {
    schemaVersion: typeof WATCH_STATE_SCHEMA_VERSION;
    project: string;
    updatedAt: string;
    lastVerdict?: string;
    active: Record<string, WatchActiveIncidentV1>;
    candidates?: Record<string, WatchCandidateIncidentV1>;
    pendingEvents: Record<string, WatchPendingEventV1>;
    observations?: WatchObservationV1[];
}
export interface WatchTransition {
    state: WatchStateV1;
    events: WatchPendingEventV1[];
    detected: number;
    updated: number;
    recovered: number;
    unchanged: number;
    confirming: number;
    lagTrend: LagTrend;
    lagDeltaBlocks?: number;
    lagGrowthStreak: number;
    sourceFreshness?: string;
    quorumHealth: QuorumHealth;
    quorum?: QuorumHealthSummary;
}
export declare function incidentFingerprint(project: string, incident: MachineIncidentV1): string;
export declare function incidentSnapshotHash(incident: MachineIncidentV1): string;
export declare function emptyWatchState(project: string, now?: string): WatchStateV1;
export declare function deriveQuorumHealth(report: MachineReportV1): QuorumHealthSummary;
export declare function deriveLagTrend(observations: WatchObservationV1[]): {
    trend: LagTrend;
    delta?: number;
    growthStreak: number;
};
export declare function advanceWatchState(previous: WatchStateV1 | undefined, report: MachineReportV1, now?: string, policy?: WatchConfig): WatchTransition;
export declare function acknowledgeWatchEvent(state: WatchStateV1, eventIdToAck: string): WatchStateV1;
export declare function loadWatchState(path: string, project: string): Promise<WatchStateV1>;
export declare function saveWatchState(path: string, state: WatchStateV1): Promise<void>;
export declare function parseWatchInterval(value: string): number;
