import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
export const WATCH_STATE_SCHEMA_VERSION = "1.0";
export const WATCH_EVENT_SCHEMA_VERSION = "1.0";
function stable(value) {
    if (Array.isArray(value))
        return value.map(stable);
    if (!value || typeof value !== "object")
        return value;
    const input = value;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, stable(input[key])]));
}
function hashJson(value) {
    return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export function incidentFingerprint(project, incident) {
    return hashJson({
        project,
        affectedPrimitive: incident.affected.primitive ?? "?",
        affectedName: incident.affected.name ?? incident.id,
    }).slice(0, 24);
}
export function incidentSnapshotHash(incident) {
    // Deliberately exclude observedAtBlock and raw state values. They can change every
    // tick while the underlying incident is unchanged, which would create alert spam.
    return hashJson({
        verdict: incident.verdict,
        timeline: incident.timeline,
        rootCause: incident.rootCause,
        affected: incident.affected,
        eventDiff: incident.eventDiff,
        relatedTransactions: incident.relatedTransactions,
        contractChanges: incident.contractChanges,
        blockHashMismatch: incident.blockHashMismatch,
    });
}
function effectiveIncidents(report) {
    if (report.incidents.length > 0 || report.outcome.exitCode === 0)
        return report.incidents;
    const failing = report.checks.find((check) => check.status !== "PASS");
    return [{
            id: `verification-${failing?.name ?? report.outcome.verdict.toLowerCase()}`,
            verdict: report.outcome.verdict,
            observedAtBlock: failing?.observedAtBlock,
            timeline: {
                ...(failing?.lastGoodBlock !== undefined ? { lastKnownGoodBlock: failing.lastGoodBlock } : {}),
                ...(failing?.firstBadBlock !== undefined ? { firstDivergenceBlock: failing.firstBadBlock } : {}),
            },
            rootCause: {
                type: "UNKNOWN",
                confidence: "LOW",
                summary: "No INCIDENT_REPORT was available; watch mode fell back to the verification outcome.",
            },
            affected: {
                primitive: failing?.primitive,
                name: failing?.name,
                status: failing?.status,
                summary: failing?.summary,
            },
            values: failing?.evidence,
            relatedTransactions: Array.isArray(failing?.evidence?.failedTransactions)
                ? (failing?.evidence?.failedTransactions).filter((value) => typeof value === "string")
                : Array.isArray(failing?.evidence?.missingTransactions)
                    ? (failing?.evidence?.missingTransactions).filter((value) => typeof value === "string")
                    : [],
            relatedLogs: [],
            contractChanges: [],
        }];
}
function eventId(type, fingerprint, basis) {
    return `${type}:${fingerprint}:${hashJson(basis).slice(0, 16)}`;
}
export function emptyWatchState(project, now = new Date().toISOString()) {
    return {
        schemaVersion: WATCH_STATE_SCHEMA_VERSION,
        project,
        updatedAt: now,
        active: {},
        candidates: {},
        pendingEvents: {},
    };
}
function verificationSummary(report) {
    return {
        verdict: report.outcome.verdict,
        generatedAt: report.generatedAt,
        ...(report.heads.canonical?.blockNumber !== undefined ? { canonicalHead: report.heads.canonical.blockNumber } : {}),
        ...(report.heads.indexed?.blockNumber !== undefined ? { indexedHead: report.heads.indexed.blockNumber } : {}),
    };
}
function makeIncidentEvent(type, project, fingerprint, incident, report, occurredAt, basis, previousIncident) {
    const id = eventId(type, fingerprint, basis);
    const payload = {
        schemaVersion: WATCH_EVENT_SCHEMA_VERSION,
        event: type,
        eventId: id,
        occurredAt,
        project,
        fingerprint,
        incidentId: incident.id,
        incident,
        ...(previousIncident ? { previousIncident } : {}),
        verification: verificationSummary(report),
    };
    return { eventId: id, type, createdAt: occurredAt, payload };
}
function makeRecoveryEvent(project, previous, report, occurredAt) {
    const type = "indexercheck.incident.recovered";
    const id = eventId(type, previous.fingerprint, `${previous.detectedAt}|${occurredAt}|${previous.snapshotHash}`);
    const detectedMs = Date.parse(previous.detectedAt);
    const recoveredMs = Date.parse(occurredAt);
    const durationMs = Number.isFinite(detectedMs) && Number.isFinite(recoveredMs)
        ? Math.max(0, recoveredMs - detectedMs)
        : 0;
    return {
        eventId: id,
        type,
        createdAt: occurredAt,
        payload: {
            schemaVersion: WATCH_EVENT_SCHEMA_VERSION,
            event: type,
            eventId: id,
            occurredAt,
            project,
            fingerprint: previous.fingerprint,
            incidentId: previous.incidentId,
            previousIncident: previous.incident,
            recovery: { detectedAt: previous.detectedAt, recoveredAt: occurredAt, durationMs },
            verification: verificationSummary(report),
        },
    };
}
function freshnessClassification(report) {
    const check = report.checks.find((item) => item.primitive === "SOURCE_FRESHNESS");
    const value = check?.evidence?.classification;
    return typeof value === "string" ? value : undefined;
}
function freshnessTelemetry(report) {
    const check = report.checks.find((item) => item.primitive === "SOURCE_FRESHNESS");
    const evidence = asRecord(check?.evidence);
    if (!evidence)
        return {};
    const lagBlocks = numberField(evidence, "lagBlocks");
    const metadata = asRecord(evidence.metadata);
    const basisValue = evidence.freshnessBasis ?? metadata?.freshnessBasis;
    const basis = typeof basisValue === "string" ? basisValue : undefined;
    return { ...(lagBlocks !== undefined ? { lagBlocks } : {}), ...(basis ? { basis } : {}) };
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}
function numberField(record, key) {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function stringArrayLength(record, key) {
    const value = record[key];
    return Array.isArray(value) ? value.filter((item) => typeof item === "string").length : undefined;
}
export function deriveQuorumHealth(report) {
    const samples = [];
    for (const check of report.checks) {
        const evidence = asRecord(check.evidence);
        const metadata = asRecord(evidence?.metadata);
        const quorum = asRecord(metadata?.rpcQuorum);
        if (quorum)
            samples.push(quorum);
    }
    if (samples.length === 0)
        return { health: "UNKNOWN", samples: 0 };
    const minAgreements = samples.map((item) => numberField(item, "minAgreement")).filter((value) => value !== undefined);
    const agreements = samples.map((item) => stringArrayLength(item, "agreeingProviders")).filter((value) => value !== undefined);
    const successes = samples.map((item) => stringArrayLength(item, "successfulProviders")).filter((value) => value !== undefined);
    const failedProviderIds = new Set();
    const successfulProviderIds = new Set();
    const agreeingProviderIds = new Set();
    for (const item of samples) {
        const failed = Array.isArray(item.failedProviders) ? item.failedProviders : [];
        for (const entry of failed) {
            const record = asRecord(entry);
            const url = typeof record?.url === "string" ? record.url : undefined;
            failedProviderIds.add(url ?? JSON.stringify(entry));
        }
        const successful = Array.isArray(item.successfulProviders) ? item.successfulProviders : [];
        for (const entry of successful)
            if (typeof entry === "string")
                successfulProviderIds.add(entry);
        const agreeing = Array.isArray(item.agreeingProviders) ? item.agreeingProviders : [];
        for (const entry of agreeing)
            if (typeof entry === "string")
                agreeingProviderIds.add(entry);
    }
    const distincts = samples.map((item) => numberField(item, "distinctResponses")).filter((value) => value !== undefined);
    const skews = samples.map((item) => numberField(item, "headSkewBlocks")).filter((value) => value !== undefined);
    const minAgreement = minAgreements.length ? Math.max(...minAgreements) : undefined;
    const agreement = agreements.length ? Math.min(...agreements) : undefined;
    const successfulProviders = successes.length ? Math.min(...successes) : undefined;
    const failedProviders = failedProviderIds.size;
    const distinctResponses = distincts.length ? Math.max(...distincts) : undefined;
    const headSkewBlocks = skews.length ? Math.max(...skews) : undefined;
    const quorumProven = minAgreement !== undefined && agreement !== undefined && agreement >= minAgreement;
    const degraded = failedProviders > 0 || (distinctResponses ?? 1) > 1;
    const health = !quorumProven ? "UNKNOWN" : degraded ? "DEGRADED" : "HEALTHY";
    return {
        health,
        samples: samples.length,
        ...(minAgreement !== undefined ? { minAgreement } : {}),
        ...(agreement !== undefined ? { agreement } : {}),
        ...(successfulProviders !== undefined ? { successfulProviders } : {}),
        failedProviders,
        ...(distinctResponses !== undefined ? { distinctResponses } : {}),
        ...(headSkewBlocks !== undefined ? { headSkewBlocks } : {}),
        failedProviderUrls: [...failedProviderIds].sort(),
        successfulProviderUrls: [...successfulProviderIds].sort(),
        agreeingProviderUrls: [...agreeingProviderIds].sort(),
    };
}
function makeObservation(report) {
    const canonicalHead = report.heads.canonical?.blockNumber;
    const indexedHead = report.heads.indexed?.blockNumber;
    const headLagBlocks = canonicalHead !== undefined && indexedHead !== undefined ? canonicalHead - indexedHead : undefined;
    const freshness = freshnessTelemetry(report);
    const lagBlocks = freshness.lagBlocks ?? headLagBlocks;
    const lagBasis = freshness.lagBlocks !== undefined ? (freshness.basis ?? "source-freshness") : (headLagBlocks !== undefined ? "head-difference" : undefined);
    const quorum = deriveQuorumHealth(report);
    return {
        observedAt: report.generatedAt,
        canonicalHead,
        indexedHead,
        ...(lagBlocks !== undefined ? { lagBlocks } : {}),
        ...(lagBasis ? { lagBasis } : {}),
        ...(headLagBlocks !== undefined ? { headLagBlocks } : {}),
        ...(freshnessClassification(report) ? { sourceFreshness: freshnessClassification(report) } : {}),
        quorumHealth: quorum.health,
        quorumSamples: quorum.samples,
        ...(quorum.minAgreement !== undefined ? { quorumMinAgreement: quorum.minAgreement } : {}),
        ...(quorum.agreement !== undefined ? { quorumAgreement: quorum.agreement } : {}),
        ...(quorum.successfulProviders !== undefined ? { quorumSuccessfulProviders: quorum.successfulProviders } : {}),
        ...(quorum.failedProviders !== undefined ? { quorumFailedProviders: quorum.failedProviders } : {}),
        ...(quorum.distinctResponses !== undefined ? { quorumDistinctResponses: quorum.distinctResponses } : {}),
        ...(quorum.headSkewBlocks !== undefined ? { quorumHeadSkewBlocks: quorum.headSkewBlocks } : {}),
        ...(quorum.failedProviderUrls?.length ? { quorumFailedProviderUrls: quorum.failedProviderUrls } : {}),
    };
}
export function deriveLagTrend(observations) {
    const usable = observations.filter((item) => typeof item.lagBlocks === "number");
    if (usable.length < 2)
        return { trend: "UNKNOWN", growthStreak: 0 };
    const previous = usable[usable.length - 2].lagBlocks;
    const current = usable[usable.length - 1].lagBlocks;
    const delta = current - previous;
    const trend = delta > 0 ? "GROWING" : delta < 0 ? "SHRINKING" : "STABLE";
    let growthStreak = 0;
    for (let index = usable.length - 1; index > 0; index -= 1) {
        const now = usable[index].lagBlocks;
        const before = usable[index - 1].lagBlocks;
        if (now > before)
            growthStreak += 1;
        else
            break;
    }
    return { trend, delta, growthStreak };
}
function requiredConfirmations(policy, incident) {
    const primitive = incident.affected.primitive;
    const raw = primitive ? policy?.confirmConsecutiveFailures?.[primitive] : undefined;
    return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 ? raw : 1;
}
export function advanceWatchState(previous, report, now = report.generatedAt, policy) {
    const project = report.project.name;
    const base = previous && previous.project === project ? previous : emptyWatchState(project, now);
    const next = {
        ...base,
        schemaVersion: WATCH_STATE_SCHEMA_VERSION,
        project,
        updatedAt: now,
        lastVerdict: report.outcome.verdict,
        active: {},
        candidates: {},
        pendingEvents: { ...base.pendingEvents },
        observations: [...(base.observations ?? []), makeObservation(report)].slice(-20),
    };
    let detected = 0;
    let updated = 0;
    let recovered = 0;
    let unchanged = 0;
    let confirming = 0;
    const currentFingerprints = new Set();
    for (const incident of effectiveIncidents(report)) {
        const fingerprint = incidentFingerprint(project, incident);
        currentFingerprints.add(fingerprint);
        const snapshotHash = incidentSnapshotHash(incident);
        const old = base.active[fingerprint];
        if (!old) {
            const required = requiredConfirmations(policy, incident);
            if (required > 1) {
                const previousCandidate = base.candidates?.[fingerprint];
                const consecutiveFailures = (previousCandidate?.consecutiveFailures ?? 0) + 1;
                const firstSeenAt = previousCandidate?.firstSeenAt ?? now;
                if (consecutiveFailures < required) {
                    next.candidates[fingerprint] = {
                        fingerprint,
                        incidentId: incident.id,
                        firstSeenAt,
                        lastSeenAt: now,
                        consecutiveFailures,
                        requiredConfirmations: required,
                        snapshotHash,
                        incident,
                    };
                    confirming += 1;
                    continue;
                }
                const pending = makeIncidentEvent("indexercheck.incident.detected", project, fingerprint, incident, report, now, `${snapshotHash}|confirmed:${consecutiveFailures}`);
                next.pendingEvents[pending.eventId] = pending;
                next.active[fingerprint] = { fingerprint, incidentId: incident.id, detectedAt: firstSeenAt, lastSeenAt: now, snapshotHash, incident };
                detected += 1;
                continue;
            }
            const pending = makeIncidentEvent("indexercheck.incident.detected", project, fingerprint, incident, report, now, snapshotHash);
            next.pendingEvents[pending.eventId] = pending;
            next.active[fingerprint] = { fingerprint, incidentId: incident.id, detectedAt: now, lastSeenAt: now, snapshotHash, incident };
            detected += 1;
            continue;
        }
        if (old.snapshotHash !== snapshotHash) {
            const pending = makeIncidentEvent("indexercheck.incident.updated", project, fingerprint, incident, report, now, `${old.snapshotHash}|${snapshotHash}`, old.incident);
            next.pendingEvents[pending.eventId] = pending;
            next.active[fingerprint] = { ...old, incidentId: incident.id, lastSeenAt: now, snapshotHash, incident };
            updated += 1;
            continue;
        }
        next.active[fingerprint] = { ...old, incidentId: incident.id, lastSeenAt: now, snapshotHash, incident };
        unchanged += 1;
    }
    for (const [fingerprint, old] of Object.entries(base.active)) {
        if (currentFingerprints.has(fingerprint))
            continue;
        const pending = makeRecoveryEvent(project, old, report, now);
        next.pendingEvents[pending.eventId] = pending;
        recovered += 1;
    }
    const events = Object.values(next.pendingEvents).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId));
    const trend = deriveLagTrend(next.observations ?? []);
    const quorum = deriveQuorumHealth(report);
    return {
        state: next,
        events,
        detected,
        updated,
        recovered,
        unchanged,
        confirming,
        lagTrend: trend.trend,
        ...(trend.delta !== undefined ? { lagDeltaBlocks: trend.delta } : {}),
        lagGrowthStreak: trend.growthStreak,
        sourceFreshness: freshnessClassification(report),
        quorumHealth: quorum.health,
        quorum,
    };
}
export function acknowledgeWatchEvent(state, eventIdToAck) {
    if (!state.pendingEvents[eventIdToAck])
        return state;
    const pendingEvents = { ...state.pendingEvents };
    delete pendingEvents[eventIdToAck];
    return { ...state, pendingEvents };
}
export async function loadWatchState(path, project) {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        if (parsed.schemaVersion !== WATCH_STATE_SCHEMA_VERSION)
            throw new Error(`Unsupported watch state schema '${String(parsed.schemaVersion)}'`);
        if (parsed.project !== project)
            return emptyWatchState(project);
        if (!parsed.active || !parsed.pendingEvents)
            throw new Error("Invalid watch state: missing active/pendingEvents");
        return parsed;
    }
    catch (error) {
        const code = error.code;
        if (code === "ENOENT")
            return emptyWatchState(project);
        throw error;
    }
}
export async function saveWatchState(path, state) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(temporary, path);
}
export function parseWatchInterval(value) {
    const match = /^([0-9]+(?:\.[0-9]+)?)(ms|s|m)?$/i.exec(value.trim());
    if (!match)
        throw new Error(`Invalid interval '${value}'. Use values like 500ms, 30s, or 2m.`);
    const amount = Number(match[1]);
    const unit = (match[2] ?? "s").toLowerCase();
    const multiplier = unit === "ms" ? 1 : unit === "s" ? 1000 : 60_000;
    const result = Math.round(amount * multiplier);
    if (!Number.isFinite(result) || result < 10)
        throw new Error("Watch interval must be at least 10ms");
    return result;
}
//# sourceMappingURL=watch.js.map