import { isSourceUnavailableError } from "./source.js";
import { genericEvmLogProvenance } from "./generic-provenance.js";
import { genericEvmLogReverseCompleteness } from "./generic-completeness.js";
import { genericEvmCallStateParity } from "./generic-state.js";
export async function checkCanonicalHead(canonical, indexed, config = {}) {
    let canonicalHead;
    let indexedHead;
    try {
        [canonicalHead, indexedHead] = await Promise.all([canonical.getHead(), indexed.getHead()]);
    }
    catch (error) {
        if (!isSourceUnavailableError(error))
            throw error;
        return {
            primitive: "CANONICAL_HEAD",
            name: config.name ?? "head",
            status: "UNKNOWN",
            summary: "Head evidence is unavailable.",
            evidence: { classification: "SOURCE_UNAVAILABLE", reason: error.message },
        };
    }
    const maxLagBlocks = config.maxLagBlocks ?? 0;
    const lagBlocks = canonicalHead.blockNumber - indexedHead.blockNumber;
    const status = lagBlocks <= maxLagBlocks ? "PASS" : "FAIL";
    return {
        primitive: "CANONICAL_HEAD",
        name: config.name ?? "head",
        status,
        summary: status === "PASS"
            ? `Indexed head is within ${maxLagBlocks} block(s) of canonical head.`
            : `Indexed head lags canonical head by ${lagBlocks} block(s).`,
        observedAtBlock: canonicalHead.blockNumber,
        evidence: {
            canonicalHead: canonicalHead.blockNumber,
            indexedHead: indexedHead.blockNumber,
            lagBlocks,
            maxLagBlocks,
            indexedReportedHealthy: indexedHead.reportedHealthy,
            indexedReportedSynced: indexedHead.reportedSynced,
        },
    };
}
export async function checkSourceFreshness(indexed, config) {
    if (!indexed.getFreshness) {
        return {
            primitive: "SOURCE_FRESHNESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Indexed source does not support freshness stream '${config.stream}'.`,
            evidence: { stream: config.stream, classification: "UNKNOWN" },
        };
    }
    const snapshot = await indexed.getFreshness(config.stream);
    const maxAgeSeconds = Math.max(0, config.maxAgeSeconds ?? 300);
    const maxLagBlocks = Math.max(0, config.maxLagBlocks ?? 120);
    const activityGraceBlocks = Math.max(0, config.activityGraceBlocks ?? 20);
    // M1.4.4: when a source exposes an authoritative serving/ingestion
    // watermark, evaluate freshness from that watermark instead of inferring
    // liveness from the newest sampled entity. This keeps generic sources on
    // the original activity-aware path while allowing managed APIs to publish
    // their own explicit freshness contract.
    if (snapshot.reportedFreshness) {
        const reported = snapshot.reportedFreshness;
        if (!reported.available) {
            return {
                primitive: "SOURCE_FRESHNESS",
                name: config.name,
                status: "UNKNOWN",
                summary: `Authoritative freshness status for '${config.stream}' is unavailable.`,
                observedAtBlock: snapshot.chainHead,
                evidence: {
                    stream: config.stream,
                    classification: "UNKNOWN",
                    freshnessBasis: reported.basis,
                    reason: reported.reason,
                    maxAgeSeconds,
                    maxLagBlocks,
                    metadata: snapshot.metadata,
                    reportedFreshness: reported,
                },
            };
        }
        const reportedAgeExceeded = reported.ageSeconds !== undefined && reported.ageSeconds > maxAgeSeconds;
        const reportedLagExceeded = reported.lagBlocks !== undefined && reported.lagBlocks > maxLagBlocks;
        const status = reportedAgeExceeded || reportedLagExceeded ? "FAIL" : "PASS";
        const classification = status === "FAIL" ? "STALE" : "FRESH";
        const summary = status === "PASS"
            ? `Authoritative source watermark for '${config.stream}' is fresh.`
            : `Authoritative source watermark for '${config.stream}' exceeds freshness limits.`;
        return {
            primitive: "SOURCE_FRESHNESS",
            name: config.name,
            status,
            summary,
            observedAtBlock: snapshot.chainHead,
            evidence: {
                stream: config.stream,
                classification,
                freshnessBasis: reported.basis,
                anchorBlock: snapshot.anchorBlock,
                chainHead: snapshot.chainHead,
                lagBlocks: reported.lagBlocks,
                anchorTimestamp: snapshot.anchorTimestamp,
                ageSeconds: reported.ageSeconds,
                maxAgeSeconds,
                maxLagBlocks,
                activityGraceBlocks,
                metadata: snapshot.metadata,
                reportedFreshness: reported,
            },
        };
    }
    const lagBlocks = snapshot.lagBlocks ?? ((snapshot.chainHead !== undefined && snapshot.anchorBlock !== undefined) ? snapshot.chainHead - snapshot.anchorBlock : undefined);
    const activityLagBlocks = snapshot.latestCanonicalActivityBlock !== undefined && snapshot.anchorBlock !== undefined
        ? Math.max(0, snapshot.latestCanonicalActivityBlock - snapshot.anchorBlock)
        : undefined;
    const ageExceeded = snapshot.ageSeconds !== undefined && snapshot.ageSeconds > maxAgeSeconds;
    const lagExceeded = lagBlocks !== undefined && lagBlocks > maxLagBlocks;
    let status = "PASS";
    let classification = "FRESH";
    let summary = `Indexed source '${config.stream}' is fresh.`;
    if (snapshot.canonicalActivityAfterAnchor === true) {
        if ((activityLagBlocks ?? 0) > activityGraceBlocks) {
            status = "FAIL";
            classification = "STALE";
            summary = `Canonical '${config.stream}' activity exists ${activityLagBlocks} block(s) beyond the latest indexed anchor.`;
        }
        else {
            classification = "CATCHING_UP";
            summary = `Indexed source is within the ${activityGraceBlocks}-block activity grace window.`;
        }
    }
    else if (snapshot.canonicalActivityAfterAnchor === false) {
        if (ageExceeded || lagExceeded) {
            classification = "INACTIVE";
            summary = `Indexed anchor is old, but no canonical '${config.stream}' activity exists after it; treating the source as inactive rather than stalled.`;
        }
    }
    else if (ageExceeded || lagExceeded) {
        status = "UNKNOWN";
        classification = "UNPROVEN_STALE";
        summary = `Indexed anchor exceeds freshness limits, but canonical activity after the anchor could not be proven or disproven.`;
    }
    return {
        primitive: "SOURCE_FRESHNESS",
        name: config.name,
        status,
        summary,
        observedAtBlock: snapshot.chainHead,
        evidence: {
            stream: config.stream,
            classification,
            anchorBlock: snapshot.anchorBlock,
            chainHead: snapshot.chainHead,
            lagBlocks,
            anchorTimestamp: snapshot.anchorTimestamp,
            ageSeconds: snapshot.ageSeconds,
            maxAgeSeconds,
            maxLagBlocks,
            activityGraceBlocks,
            canonicalActivityAfterAnchor: snapshot.canonicalActivityAfterAnchor,
            latestCanonicalActivityBlock: snapshot.latestCanonicalActivityBlock,
            activityLagBlocks,
            scanComplete: snapshot.scanComplete,
            metadata: snapshot.metadata,
        },
    };
}
export async function checkStateParity(canonical, indexed, config) {
    if (config.proof?.type === "evm-call")
        return genericEvmCallStateParity(canonical, indexed, config);
    const [expected, actual] = await Promise.all([
        canonical.getState(config.key),
        indexed.getState(config.key),
    ]);
    if (!expected || !actual) {
        return {
            primitive: "STATE_PARITY",
            name: config.name,
            status: "UNKNOWN",
            summary: `State key '${config.key}' is missing from ${!expected ? "canonical" : "indexed"} source.`,
            evidence: { key: config.key, canonical: expected, indexed: actual },
        };
    }
    const equal = expected.value === actual.value;
    const observedAtBlock = Math.max(expected.blockNumber ?? 0, actual.blockNumber ?? 0) || undefined;
    return {
        primitive: "STATE_PARITY",
        name: config.name,
        status: equal ? "PASS" : "FAIL",
        summary: equal
            ? `Indexed state matches canonical state for '${config.key}'.`
            : `Indexed state diverges from canonical state for '${config.key}'.`,
        observedAtBlock,
        evidence: {
            key: config.key,
            canonicalValue: expected.value,
            indexedValue: actual.value,
            canonicalBlock: expected.blockNumber,
            indexedBlock: actual.blockNumber,
        },
    };
}
export async function checkEventCompleteness(canonical, indexed, config) {
    if (config.proof?.type === "evm-log-reverse")
        return genericEvmLogReverseCompleteness(canonical, indexed, config);
    const [expectedEvents, actualEvents] = await Promise.all([
        canonical.getEvents(config.stream),
        indexed.getEvents(config.stream),
    ]);
    const expectedById = new Map(expectedEvents.map((event) => [event.id, event]));
    const actualById = new Map(actualEvents.map((event) => [event.id, event]));
    const missing = expectedEvents.filter((event) => !actualById.has(event.id));
    const unexpected = actualEvents.filter((event) => !expectedById.has(event.id));
    const pass = missing.length === 0 && unexpected.length === 0;
    const observedAtBlock = [...expectedEvents, ...actualEvents]
        .map((event) => event.blockNumber)
        .sort((a, b) => b - a)[0];
    return {
        primitive: "EVENT_COMPLETENESS",
        name: config.name,
        status: pass ? "PASS" : "FAIL",
        summary: pass
            ? `Indexed event stream '${config.stream}' is complete.`
            : `Indexed event stream '${config.stream}' differs from canonical logs.`,
        observedAtBlock,
        evidence: {
            stream: config.stream,
            canonicalCount: expectedEvents.length,
            indexedCount: actualEvents.length,
            missingCount: missing.length,
            unexpectedCount: unexpected.length,
            missingEventIds: missing.map((event) => event.id),
            unexpectedEventIds: unexpected.map((event) => event.id),
        },
    };
}
export async function checkTransactionCompleteness(indexed, config) {
    if (!indexed.getTransactionCompleteness) {
        return {
            primitive: "TRANSACTION_COMPLETENESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Indexed source does not support transaction completeness stream '${config.stream}'.`,
            evidence: { stream: config.stream },
        };
    }
    const windowBlocks = Math.max(1, config.windowBlocks ?? 20);
    const indexedPageSize = Math.max(1, Math.min(config.indexedPageSize ?? 500, 10_000));
    const maxPages = Math.max(1, Math.min(config.maxPages ?? 4, 20));
    const settlementLagBlocks = Math.max(0, Math.min(config.settlementLagBlocks ?? 0, 10_000));
    const snapshot = await indexed.getTransactionCompleteness(config.stream, { windowBlocks, indexedPageSize, maxPages, settlementLagBlocks });
    if (!snapshot.coverageProven) {
        return {
            primitive: "TRANSACTION_COMPLETENESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Could not prove indexed API coverage for the requested ${windowBlocks}-block '${config.stream}' window.`,
            observedAtBlock: snapshot.toBlock,
            evidence: {
                stream: config.stream,
                classification: "UNPROVEN_COVERAGE",
                windowBlocks,
                indexedPageSize,
                maxPages,
                settlementLagBlocks,
                fromBlock: snapshot.fromBlock,
                toBlock: snapshot.toBlock,
                canonicalTransactions: snapshot.canonicalTransactions,
                indexedTransactions: snapshot.indexedTransactions,
                matchedTransactions: snapshot.matchedTransactions,
                missingTransactions: snapshot.missingTransactions,
                missingTransactionBlocks: snapshot.missingTransactionBlocks,
                oldestMissingBlock: snapshot.oldestMissingBlock,
                newestMissingBlock: snapshot.newestMissingBlock,
                maxMissingDepthBlocks: snapshot.maxMissingDepthBlocks,
                minMissingDepthBlocks: snapshot.minMissingDepthBlocks,
                coverageProven: false,
                oldestIndexedBlock: snapshot.oldestIndexedBlock,
                newestIndexedBlock: snapshot.newestIndexedBlock,
                pageCount: snapshot.pageCount,
                metadata: snapshot.metadata,
            },
        };
    }
    const pass = snapshot.missingTransactions.length === 0;
    const classification = snapshot.canonicalTransactions === 0 ? "NO_CANONICAL_ACTIVITY" : (pass ? "COMPLETE" : "MISSING_TRANSACTIONS");
    return {
        primitive: "TRANSACTION_COMPLETENESS",
        name: config.name,
        status: pass ? "PASS" : "FAIL",
        summary: snapshot.canonicalTransactions === 0
            ? `No canonical '${config.stream}' transactions occurred in the verified window; nothing is missing.`
            : pass
                ? `Indexed source covers all ${snapshot.canonicalTransactions} canonical '${config.stream}' transaction(s) in blocks ${snapshot.fromBlock}-${snapshot.toBlock}.`
                : `Indexed source is missing ${snapshot.missingTransactions.length}/${snapshot.canonicalTransactions} canonical '${config.stream}' transaction(s) in blocks ${snapshot.fromBlock}-${snapshot.toBlock}.${snapshot.maxMissingDepthBlocks !== undefined ? ` Oldest missing transaction is ${snapshot.maxMissingDepthBlocks} block(s) behind the verified-through block.` : ""}`,
        observedAtBlock: snapshot.toBlock,
        evidence: {
            stream: config.stream,
            classification,
            windowBlocks,
            indexedPageSize,
            maxPages,
            settlementLagBlocks,
            fromBlock: snapshot.fromBlock,
            toBlock: snapshot.toBlock,
            canonicalTransactions: snapshot.canonicalTransactions,
            indexedTransactions: snapshot.indexedTransactions,
            matchedTransactions: snapshot.matchedTransactions,
            missingTransactions: snapshot.missingTransactions,
            missingTransactionBlocks: snapshot.missingTransactionBlocks,
            oldestMissingBlock: snapshot.oldestMissingBlock,
            newestMissingBlock: snapshot.newestMissingBlock,
            maxMissingDepthBlocks: snapshot.maxMissingDepthBlocks,
            minMissingDepthBlocks: snapshot.minMissingDepthBlocks,
            coverageProven: true,
            oldestIndexedBlock: snapshot.oldestIndexedBlock,
            newestIndexedBlock: snapshot.newestIndexedBlock,
            pageCount: snapshot.pageCount,
            metadata: snapshot.metadata,
        },
    };
}
export async function checkProvenance(indexed, config, canonical) {
    let snapshot;
    if (config.proof?.type === "evm-log") {
        if (!canonical) {
            return {
                primitive: "PROVENANCE",
                name: config.name,
                status: "UNKNOWN",
                summary: `Generic evm-log provenance for '${config.stream}' requires a canonical source.`,
                evidence: { stream: config.stream, proofMode: "evm-log" },
            };
        }
        try {
            snapshot = await genericEvmLogProvenance(canonical, indexed, config);
        }
        catch (error) {
            if (!isSourceUnavailableError(error))
                throw error;
            const canonicalUnavailable = error.sourceType === "canonical";
            return {
                primitive: "PROVENANCE", name: config.name, status: "UNKNOWN",
                summary: canonicalUnavailable ? `Canonical event proof is unavailable for '${config.stream}'.` : `Indexed event data is unavailable for '${config.stream}'.`,
                evidence: { stream: config.stream, proofMode: "evm-log", classification: canonicalUnavailable ? "CANONICAL_PROOF_UNAVAILABLE" : "INDEXED_SOURCE_UNAVAILABLE", reason: error.message },
            };
        }
    }
    else {
        if (!indexed.getProvenance) {
            return {
                primitive: "PROVENANCE",
                name: config.name,
                status: "UNKNOWN",
                summary: `Indexed source does not support provenance stream '${config.stream}'.`,
                evidence: { stream: config.stream },
            };
        }
        snapshot = await indexed.getProvenance(config.stream);
    }
    const minSamples = Math.max(1, config.minSamples ?? 1);
    const enoughSamples = snapshot.sampled >= minSamples;
    const complete = snapshot.failures.length === 0 && snapshot.verified === snapshot.sampled;
    const pass = enoughSamples && complete;
    const failureTxs = snapshot.failures.map((failure) => failure.transactionHash).filter((value) => typeof value === "string");
    return {
        primitive: "PROVENANCE",
        name: config.name,
        status: pass ? "PASS" : "FAIL",
        summary: pass
            ? `Verified ${snapshot.verified}/${snapshot.sampled} indexed '${config.stream}' row(s) against canonical chain evidence.`
            : `Provenance verification failed for '${config.stream}': verified ${snapshot.verified}/${snapshot.sampled}, failures=${snapshot.failures.length}, minSamples=${minSamples}.`,
        observedAtBlock: snapshot.observedAtBlock,
        evidence: {
            stream: config.stream,
            sampled: snapshot.sampled,
            verified: snapshot.verified,
            minSamples,
            failureCount: snapshot.failures.length,
            failedTransactions: failureTxs,
            failures: snapshot.failures,
            metadata: snapshot.metadata,
        },
    };
}
async function evaluateHistoricalTarget(canonical, indexed, target, blockNumber) {
    if (target.primitive === "STATE_PARITY") {
        if (!canonical.getStateAt || !indexed.getStateAt) {
            throw new Error("Historical state reads are not supported by one or both sources.");
        }
        const [expected, actual] = await Promise.all([
            canonical.getStateAt(target.key, blockNumber),
            indexed.getStateAt(target.key, blockNumber),
        ]);
        if (!expected || !actual) {
            throw new Error(`Historical state '${target.key}' is unavailable at block ${blockNumber}.`);
        }
        return {
            pass: expected.value === actual.value,
            evidence: {
                blockNumber,
                key: target.key,
                canonicalValue: expected.value,
                indexedValue: actual.value,
            },
        };
    }
    if (!canonical.getEventsAt || !indexed.getEventsAt) {
        throw new Error("Historical event reads are not supported by one or both sources.");
    }
    const [expectedEvents, actualEvents] = await Promise.all([
        canonical.getEventsAt(target.stream, target.startBlock, blockNumber),
        indexed.getEventsAt(target.stream, target.startBlock, blockNumber),
    ]);
    const expectedIds = new Set(expectedEvents.map((event) => event.id));
    const actualIds = new Set(actualEvents.map((event) => event.id));
    const missing = expectedEvents.filter((event) => !actualIds.has(event.id));
    const unexpected = actualEvents.filter((event) => !expectedIds.has(event.id));
    return {
        pass: missing.length === 0 && unexpected.length === 0,
        evidence: {
            blockNumber,
            stream: target.stream,
            startBlock: target.startBlock,
            canonicalCount: expectedEvents.length,
            indexedCount: actualEvents.length,
            missingEventIds: missing.map((event) => event.id),
            unexpectedEventIds: unexpected.map((event) => event.id),
        },
    };
}
export async function checkFirstDivergence(canonical, indexed, config) {
    const strategy = config.strategy ?? "linear";
    const maxChecks = config.maxChecks ?? 10_000;
    const [canonicalHead, indexedHead] = await Promise.all([canonical.getHead(), indexed.getHead()]);
    const toBlock = config.toBlock ?? Math.min(canonicalHead.blockNumber, indexedHead.blockNumber);
    const fromBlock = config.fromBlock;
    if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock > toBlock) {
        return {
            primitive: "FIRST_DIVERGENCE",
            name: config.name,
            status: "UNKNOWN",
            summary: `Invalid divergence range ${fromBlock}..${toBlock}.`,
            evidence: { fromBlock, toBlock, strategy, targetPrimitive: config.target.primitive },
        };
    }
    let checksPerformed = 0;
    const evaluate = async (block) => {
        checksPerformed += 1;
        if (checksPerformed > maxChecks)
            throw new Error(`FIRST_DIVERGENCE exceeded maxChecks=${maxChecks}.`);
        return evaluateHistoricalTarget(canonical, indexed, config.target, block);
    };
    try {
        const start = await evaluate(fromBlock);
        if (!start.pass) {
            return {
                primitive: "FIRST_DIVERGENCE",
                name: config.name,
                status: "FAIL",
                summary: `Divergence is already present at the start of the search range (block ${fromBlock}).`,
                firstBadBlock: fromBlock,
                evidence: {
                    targetPrimitive: config.target.primitive,
                    target: config.target,
                    strategy,
                    fromBlock,
                    toBlock,
                    checksPerformed,
                    firstBadEvidence: start.evidence,
                },
            };
        }
        const end = toBlock === fromBlock ? start : await evaluate(toBlock);
        if (end.pass) {
            return {
                primitive: "FIRST_DIVERGENCE",
                name: config.name,
                status: "PASS",
                summary: `No divergence found in blocks ${fromBlock}..${toBlock}.`,
                lastGoodBlock: toBlock,
                evidence: {
                    targetPrimitive: config.target.primitive,
                    target: config.target,
                    strategy,
                    fromBlock,
                    toBlock,
                    checksPerformed,
                    endEvidence: end.evidence,
                },
            };
        }
        let lastGoodBlock = fromBlock;
        let firstBadBlock = toBlock;
        let lastGoodEvidence = start.evidence;
        let firstBadEvidence = end.evidence;
        if (strategy === "binary-monotonic") {
            let low = fromBlock;
            let high = toBlock;
            while (high - low > 1) {
                const mid = Math.floor((low + high) / 2);
                const current = await evaluate(mid);
                if (current.pass) {
                    low = mid;
                    lastGoodBlock = mid;
                    lastGoodEvidence = current.evidence;
                }
                else {
                    high = mid;
                    firstBadBlock = mid;
                    firstBadEvidence = current.evidence;
                }
            }
        }
        else {
            for (let block = fromBlock + 1; block <= toBlock; block += 1) {
                const current = block === toBlock ? end : await evaluate(block);
                if (!current.pass) {
                    firstBadBlock = block;
                    firstBadEvidence = current.evidence;
                    break;
                }
                lastGoodBlock = block;
                lastGoodEvidence = current.evidence;
            }
        }
        return {
            primitive: "FIRST_DIVERGENCE",
            name: config.name,
            status: "FAIL",
            summary: `First divergence located at block ${firstBadBlock}; last known-good block is ${lastGoodBlock}.`,
            firstBadBlock,
            lastGoodBlock,
            evidence: {
                targetPrimitive: config.target.primitive,
                target: config.target,
                strategy,
                monotonicAssumption: strategy === "binary-monotonic",
                fromBlock,
                toBlock,
                checksPerformed,
                lastGoodEvidence,
                firstBadEvidence,
            },
        };
    }
    catch (error) {
        return {
            primitive: "FIRST_DIVERGENCE",
            name: config.name,
            status: "UNKNOWN",
            summary: error instanceof Error ? error.message : String(error),
            evidence: {
                targetPrimitive: config.target.primitive,
                target: config.target,
                strategy,
                fromBlock,
                toBlock,
                checksPerformed,
            },
        };
    }
}
function causeResult(config, cause, confidence, firstDivergenceBlock, lastGoodBlock, signals, extra = {}) {
    const known = cause !== "UNKNOWN";
    return {
        primitive: "ROOT_CAUSE_EVIDENCE",
        name: config.name,
        status: known ? "PASS" : "UNKNOWN",
        summary: known
            ? `Probable root cause: ${cause} (${confidence} confidence).`
            : "No supported root-cause pattern was proven by the available evidence.",
        evidence: {
            cause,
            confidence,
            divergenceCheck: config.divergence,
            firstDivergenceBlock,
            lastGoodBlock,
            signals,
            ...extra,
        },
    };
}
async function compareEventsAtBlock(canonical, indexed, stream, blockNumber) {
    if (!canonical.getEventsAt || !indexed.getEventsAt) {
        return { missingIds: [], unexpectedIds: [], missingEvents: [], unexpectedEvents: [], canonicalCount: 0, indexedCount: 0 };
    }
    const [expected, actual] = await Promise.all([
        canonical.getEventsAt(stream, blockNumber, blockNumber),
        indexed.getEventsAt(stream, blockNumber, blockNumber),
    ]);
    const expectedIds = new Set(expected.map((event) => event.id));
    const actualIds = new Set(actual.map((event) => event.id));
    const missingEvents = expected.filter((event) => !actualIds.has(event.id));
    const unexpectedEvents = actual.filter((event) => !expectedIds.has(event.id));
    return {
        missingIds: missingEvents.map((event) => event.id),
        unexpectedIds: unexpectedEvents.map((event) => event.id),
        missingEvents,
        unexpectedEvents,
        canonicalCount: expected.length,
        indexedCount: actual.length,
    };
}
export async function checkRootCauseEvidence(canonical, indexed, config, divergence) {
    if (!divergence || divergence.primitive !== "FIRST_DIVERGENCE") {
        return causeResult(config, "UNKNOWN", "LOW", undefined, undefined, [], {
            reason: `FIRST_DIVERGENCE result '${config.divergence}' was not found.`,
        });
    }
    if (divergence.status !== "FAIL" || divergence.firstBadBlock === undefined) {
        return causeResult(config, "UNKNOWN", "LOW", divergence.firstBadBlock, divergence.lastGoodBlock, [], {
            reason: `FIRST_DIVERGENCE result '${config.divergence}' did not establish a failing block.`,
        });
    }
    const firstBadBlock = divergence.firstBadBlock;
    const lastGoodBlock = divergence.lastGoodBlock;
    const signals = [];
    try {
        if (canonical.getBlockAt && indexed.getBlockAt) {
            const [canonicalBlock, indexedBlock] = await Promise.all([
                canonical.getBlockAt(firstBadBlock),
                indexed.getBlockAt(firstBadBlock),
            ]);
            if (canonicalBlock?.blockHash && indexedBlock?.blockHash && canonicalBlock.blockHash.toLowerCase() !== indexedBlock.blockHash.toLowerCase()) {
                signals.push({
                    kind: "BLOCK_HASH_MISMATCH",
                    blockNumber: firstBadBlock,
                    canonicalHash: canonicalBlock.blockHash,
                    indexedHash: indexedBlock.blockHash,
                });
                return causeResult(config, "REORG_OR_FORK", "HIGH", firstBadBlock, lastGoodBlock, signals);
            }
        }
        const target = divergence.evidence?.target;
        const targetStream = target?.primitive === "EVENT_COMPLETENESS" && typeof target.stream === "string" ? target.stream : undefined;
        const eventStreams = [...new Set([...(targetStream ? [targetStream] : []), ...(config.eventStreams ?? [])])];
        for (const stream of eventStreams) {
            const comparison = await compareEventsAtBlock(canonical, indexed, stream, firstBadBlock);
            if (comparison.missingIds.length > 0) {
                signals.push({ kind: "MISSING_CANONICAL_EVENTS", stream, blockNumber: firstBadBlock, ...comparison });
            }
        }
        if (signals.some((signal) => signal.kind === "MISSING_CANONICAL_EVENTS")) {
            return causeResult(config, "MISSED_EVENT", "HIGH", firstBadBlock, lastGoodBlock, signals);
        }
        if (lastGoodBlock !== undefined && canonical.getStateAt) {
            for (const key of config.upgradeStateKeys ?? []) {
                const [before, after] = await Promise.all([
                    canonical.getStateAt(key, lastGoodBlock),
                    canonical.getStateAt(key, firstBadBlock),
                ]);
                if (before && after && before.value !== after.value) {
                    signals.push({
                        kind: "UPGRADE_STATE_CHANGED",
                        key,
                        lastGoodBlock,
                        firstDivergenceBlock: firstBadBlock,
                        before: before.value,
                        after: after.value,
                    });
                }
            }
        }
        if (canonical.getEventsAt) {
            for (const stream of config.upgradeEventStreams ?? []) {
                const events = await canonical.getEventsAt(stream, firstBadBlock, firstBadBlock);
                if (events.length > 0) {
                    signals.push({
                        kind: "UPGRADE_EVENT_OBSERVED",
                        stream,
                        blockNumber: firstBadBlock,
                        eventIds: events.map((event) => event.id),
                        events,
                    });
                }
            }
        }
        if (signals.some((signal) => signal.kind === "UPGRADE_STATE_CHANGED")) {
            return causeResult(config, "CONTRACT_UPGRADE", "HIGH", firstBadBlock, lastGoodBlock, signals);
        }
        if (signals.some((signal) => signal.kind === "UPGRADE_EVENT_OBSERVED")) {
            return causeResult(config, "CONTRACT_UPGRADE", "MEDIUM", firstBadBlock, lastGoodBlock, signals);
        }
        return causeResult(config, "UNKNOWN", "LOW", firstBadBlock, lastGoodBlock, signals, {
            targetPrimitive: divergence.evidence?.targetPrimitive,
        });
    }
    catch (error) {
        return causeResult(config, "UNKNOWN", "LOW", firstBadBlock, lastGoodBlock, signals, {
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}
function incidentVerdictFor(affected) {
    if (affected.primitive === "STATE_PARITY")
        return "DRIFT";
    if (affected.primitive === "EVENT_COMPLETENESS")
        return "INCOMPLETE";
    if (affected.primitive === "CANONICAL_HEAD")
        return "STALLED";
    return "UNKNOWN";
}
export function buildIncidentReport(config, affected, divergence, rootCause) {
    if (!affected) {
        return {
            primitive: "INCIDENT_REPORT",
            name: config.name,
            status: "UNKNOWN",
            summary: `Affected check '${config.affectedCheck}' was not found.`,
            evidence: { affectedCheck: config.affectedCheck, divergenceCheck: config.divergence, rootCauseCheck: config.rootCause },
        };
    }
    if (!divergence || divergence.primitive !== "FIRST_DIVERGENCE" || divergence.status !== "FAIL" || divergence.firstBadBlock === undefined) {
        return {
            primitive: "INCIDENT_REPORT",
            name: config.name,
            status: "UNKNOWN",
            summary: `FIRST_DIVERGENCE result '${config.divergence}' did not establish an incident timeline.`,
            observedAtBlock: affected.observedAtBlock,
            evidence: { affectedCheck: config.affectedCheck, divergenceCheck: config.divergence, rootCauseCheck: config.rootCause },
        };
    }
    if (!rootCause || rootCause.primitive !== "ROOT_CAUSE_EVIDENCE") {
        return {
            primitive: "INCIDENT_REPORT",
            name: config.name,
            status: "UNKNOWN",
            summary: `ROOT_CAUSE_EVIDENCE result '${config.rootCause}' was not found.`,
            observedAtBlock: affected.observedAtBlock,
            evidence: {
                affectedCheck: config.affectedCheck,
                divergenceCheck: config.divergence,
                rootCauseCheck: config.rootCause,
                firstDivergenceBlock: divergence.firstBadBlock,
                lastGoodBlock: divergence.lastGoodBlock,
            },
        };
    }
    const rootEvidence = rootCause.evidence ?? {};
    const signals = Array.isArray(rootEvidence.signals) ? rootEvidence.signals : [];
    const relatedLogs = [];
    const relatedTransactions = new Set();
    const contractChanges = [];
    let blockHashMismatch;
    for (const signal of signals) {
        if (signal.kind === "MISSING_CANONICAL_EVENTS") {
            const events = Array.isArray(signal.missingEvents) ? signal.missingEvents : [];
            for (const event of events) {
                relatedLogs.push(event);
                if (event.txHash)
                    relatedTransactions.add(event.txHash);
            }
        }
        if (signal.kind === "UPGRADE_EVENT_OBSERVED") {
            const events = Array.isArray(signal.events) ? signal.events : [];
            for (const event of events) {
                relatedLogs.push(event);
                if (event.txHash)
                    relatedTransactions.add(event.txHash);
            }
        }
        if (signal.kind === "UPGRADE_STATE_CHANGED") {
            contractChanges.push({
                key: signal.key,
                before: signal.before,
                after: signal.after,
                lastGoodBlock: signal.lastGoodBlock,
                firstDivergenceBlock: signal.firstDivergenceBlock,
            });
        }
        if (signal.kind === "BLOCK_HASH_MISMATCH") {
            blockHashMismatch = {
                blockNumber: signal.blockNumber,
                canonicalHash: signal.canonicalHash,
                indexedHash: signal.indexedHash,
            };
        }
    }
    const affectedEvidence = affected.evidence ?? {};
    const values = affected.primitive === "STATE_PARITY" ? {
        key: affectedEvidence.key,
        canonical: affectedEvidence.canonicalValue,
        indexed: affectedEvidence.indexedValue,
        canonicalBlock: affectedEvidence.canonicalBlock,
        indexedBlock: affectedEvidence.indexedBlock,
    } : undefined;
    const eventDiff = affected.primitive === "EVENT_COMPLETENESS" ? {
        stream: affectedEvidence.stream,
        canonicalCount: affectedEvidence.canonicalCount,
        indexedCount: affectedEvidence.indexedCount,
        missingCount: affectedEvidence.missingCount,
        unexpectedCount: affectedEvidence.unexpectedCount,
        missingEventIds: affectedEvidence.missingEventIds,
        unexpectedEventIds: affectedEvidence.unexpectedEventIds,
    } : undefined;
    const cause = typeof rootEvidence.cause === "string" ? rootEvidence.cause : "UNKNOWN";
    const confidence = typeof rootEvidence.confidence === "string" ? rootEvidence.confidence : "LOW";
    const incidentVerdict = incidentVerdictFor(affected);
    return {
        primitive: "INCIDENT_REPORT",
        name: config.name,
        status: "PASS",
        summary: `Incident assembled: ${incidentVerdict}; first divergence block ${divergence.firstBadBlock}; probable cause ${cause} (${confidence}).`,
        observedAtBlock: affected.observedAtBlock,
        evidence: {
            incidentVerdict,
            affected: {
                primitive: affected.primitive,
                name: affected.name,
                status: affected.status,
                summary: affected.summary,
            },
            timeline: {
                observedAtBlock: affected.observedAtBlock,
                lastKnownGoodBlock: divergence.lastGoodBlock,
                firstDivergenceBlock: divergence.firstBadBlock,
            },
            rootCause: {
                cause,
                confidence,
                summary: rootCause.summary,
            },
            values,
            eventDiff,
            relatedTransactions: [...relatedTransactions],
            relatedLogs,
            contractChanges,
            blockHashMismatch,
        },
    };
}
//# sourceMappingURL=primitives.js.map