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
export declare function detectCiEnvironment(env?: Record<string, string | undefined>): CiEnvironment;
export declare function sendWebhook<T extends {
    event: string;
}>(url: string, payload: T, options?: SendWebhookOptions): Promise<WebhookDeliveryResultV1>;
export declare function buildGitHubAnnotations(artifact: MachineReportV1): string[];
export declare function appendGitHubStepSummary(path: string, markdown: string): Promise<GitHubStepSummaryDeliveryV1>;
export declare function notRequestedWebhook(): WebhookDeliveryResultV1;
export declare function notRequestedStepSummary(): GitHubStepSummaryDeliveryV1;
export declare function buildDeliveryResult(webhook: WebhookDeliveryResultV1, ci: CiEnvironment, annotationsEmitted: number, stepSummary: GitHubStepSummaryDeliveryV1): MachineDeliveryV1;
export declare function processExitCode(verificationExitCode: 0 | 1, delivery: MachineDeliveryV1): 0 | 1 | 2;
