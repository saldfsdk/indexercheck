import { isSourceUnavailableError } from "./source.js";
import { buildIncidentReport, checkCanonicalHead, checkEventCompleteness, checkFirstDivergence, checkProvenance, checkTransactionCompleteness, checkRootCauseEvidence, checkSourceFreshness, checkStateParity, } from "./primitives.js";
function deriveVerdict(results) {
    const failures = results.filter((result) => result.status === "FAIL");
    if (failures.some((result) => result.primitive === "EVENT_COMPLETENESS" || result.primitive === "TRANSACTION_COMPLETENESS"))
        return "INCOMPLETE";
    if (failures.some((result) => result.primitive === "STATE_PARITY"))
        return "DRIFT";
    if (failures.some((result) => result.primitive === "PROVENANCE"))
        return "DRIFT";
    if (failures.some((result) => result.primitive === "CANONICAL_HEAD" || result.primitive === "SOURCE_FRESHNESS"))
        return "STALLED";
    const divergence = failures.find((result) => result.primitive === "FIRST_DIVERGENCE");
    if (divergence?.evidence?.targetPrimitive === "EVENT_COMPLETENESS")
        return "INCOMPLETE";
    if (divergence?.evidence?.targetPrimitive === "STATE_PARITY")
        return "DRIFT";
    const nonDiagnosticUnknown = results.some((result) => result.status === "UNKNOWN" &&
        result.primitive !== "ROOT_CAUSE_EVIDENCE" &&
        result.primitive !== "INCIDENT_REPORT");
    if (nonDiagnosticUnknown)
        return "UNKNOWN";
    return "PASS";
}
export async function verify(config, canonical, indexed) {
    const results = [];
    if (config.checks.head)
        results.push(await checkCanonicalHead(canonical, indexed, config.checks.head));
    for (const check of config.checks.sourceFreshness ?? [])
        results.push(await checkSourceFreshness(indexed, check));
    for (const check of config.checks.stateParity ?? [])
        results.push(await checkStateParity(canonical, indexed, check));
    for (const check of config.checks.eventCompleteness ?? [])
        results.push(await checkEventCompleteness(canonical, indexed, check));
    for (const check of config.checks.transactionCompleteness ?? [])
        results.push(await checkTransactionCompleteness(indexed, check));
    for (const check of config.checks.provenance ?? [])
        results.push(await checkProvenance(indexed, check, canonical));
    for (const check of config.checks.firstDivergence ?? [])
        results.push(await checkFirstDivergence(canonical, indexed, check));
    for (const check of config.checks.rootCauseEvidence ?? []) {
        const divergence = results.find((result) => result.primitive === "FIRST_DIVERGENCE" && result.name === check.divergence);
        results.push(await checkRootCauseEvidence(canonical, indexed, check, divergence));
    }
    for (const check of config.checks.incidentReports ?? []) {
        const affected = results.find((result) => result.name === check.affectedCheck &&
            (result.primitive === "STATE_PARITY" || result.primitive === "EVENT_COMPLETENESS" || result.primitive === "CANONICAL_HEAD"));
        const divergence = results.find((result) => result.primitive === "FIRST_DIVERGENCE" && result.name === check.divergence);
        const rootCause = results.find((result) => result.primitive === "ROOT_CAUSE_EVIDENCE" && result.name === check.rootCause);
        results.push(buildIncidentReport(check, affected, divergence, rootCause));
    }
    const safeHead = async (source) => {
        try {
            return await source.getHead();
        }
        catch (error) {
            if (isSourceUnavailableError(error))
                return undefined;
            throw error;
        }
    };
    const [canonicalHead, indexedHead] = await Promise.all([safeHead(canonical), safeHead(indexed)]);
    return { name: config.name, verdict: deriveVerdict(results), generatedAt: new Date().toISOString(), canonicalHead, indexedHead, results };
}
//# sourceMappingURL=verifier.js.map