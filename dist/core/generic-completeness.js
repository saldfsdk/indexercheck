function eventKey(event) {
    if (!event.txHash || event.logIndex === undefined || !Number.isFinite(event.logIndex))
        return undefined;
    return `${event.txHash.toLowerCase()}:${event.logIndex}`;
}
async function readRange(source, stream, fromBlock, toBlock) {
    if (source.getEventsAtWithEvidence)
        return source.getEventsAtWithEvidence(stream, fromBlock, toBlock);
    if (source.getEventsAt)
        return { events: await source.getEventsAt(stream, fromBlock, toBlock), metadata: { coverageProven: false, reason: "range evidence unavailable" } };
    return undefined;
}
function blocksByKey(events) {
    const out = {};
    for (const event of events) {
        const key = eventKey(event);
        if (key)
            out[key] = event.blockNumber;
    }
    return out;
}
export async function genericEvmLogReverseCompleteness(canonical, indexed, config) {
    const proof = config.proof;
    if (!proof || proof.type !== "evm-log-reverse")
        throw new Error("genericEvmLogReverseCompleteness requires an evm-log-reverse proof");
    const canonicalStream = proof.canonicalStream ?? config.stream;
    const windowBlocks = Math.max(1, Math.min(proof.windowBlocks ?? 100, 100_000));
    const settlementLagBlocks = Math.max(0, Math.min(proof.settlementLagBlocks ?? 0, 100_000));
    let canonicalHead;
    try {
        canonicalHead = await canonical.getHead();
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            primitive: "EVENT_COMPLETENESS", name: config.name, status: "UNKNOWN",
            summary: `Canonical head could not be proven for '${canonicalStream}'.`,
            evidence: { stream: config.stream, canonicalStream, classification: "CANONICAL_PROOF_UNAVAILABLE", windowBlocks, settlementLagBlocks, reason },
        };
    }
    const toBlock = canonicalHead.blockNumber - settlementLagBlocks;
    if (toBlock < 0) {
        return {
            primitive: "EVENT_COMPLETENESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Canonical settled watermark is below block zero for '${canonicalStream}'.`,
            observedAtBlock: canonicalHead.blockNumber,
            evidence: { stream: config.stream, canonicalStream, classification: "UNPROVEN_WINDOW", windowBlocks, settlementLagBlocks, canonicalHead: canonicalHead.blockNumber },
        };
    }
    const fromBlock = Math.max(0, toBlock - windowBlocks + 1);
    let canonicalRange;
    try {
        canonicalRange = await readRange(canonical, canonicalStream, fromBlock, toBlock);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            primitive: "EVENT_COMPLETENESS", name: config.name, status: "UNKNOWN",
            summary: `Canonical historical range could not be proven for '${canonicalStream}'.`, observedAtBlock: toBlock,
            evidence: { stream: config.stream, canonicalStream, classification: "CANONICAL_PROOF_UNAVAILABLE", fromBlock, toBlock, windowBlocks, settlementLagBlocks, reason },
        };
    }
    let indexedRange;
    try {
        indexedRange = await readRange(indexed, config.stream, fromBlock, toBlock);
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            primitive: "EVENT_COMPLETENESS", name: config.name, status: "UNKNOWN",
            summary: `Indexed historical range is unavailable for '${config.stream}'.`, observedAtBlock: toBlock,
            evidence: { stream: config.stream, canonicalStream, classification: "INDEXED_SOURCE_UNAVAILABLE", fromBlock, toBlock, windowBlocks, settlementLagBlocks, reason },
        };
    }
    if (!canonicalRange) {
        return {
            primitive: "EVENT_COMPLETENESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Canonical source cannot read historical '${canonicalStream}' events for generic reverse completeness.`,
            observedAtBlock: toBlock,
            evidence: { stream: config.stream, canonicalStream, classification: "UNPROVEN_CANONICAL_RANGE", fromBlock, toBlock, windowBlocks, settlementLagBlocks },
        };
    }
    if (!indexedRange) {
        return {
            primitive: "EVENT_COMPLETENESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Indexed source cannot read the requested historical '${config.stream}' range.`,
            observedAtBlock: toBlock,
            evidence: { stream: config.stream, canonicalStream, classification: "UNPROVEN_INDEXED_RANGE", fromBlock, toBlock, windowBlocks, settlementLagBlocks },
        };
    }
    const coverageProven = indexedRange.metadata?.coverageProven === true;
    if (!coverageProven) {
        return {
            primitive: "EVENT_COMPLETENESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Could not prove indexed '${config.stream}' coverage for blocks ${fromBlock}-${toBlock}.`,
            observedAtBlock: toBlock,
            evidence: {
                stream: config.stream,
                canonicalStream,
                classification: "UNPROVEN_INDEXED_RANGE",
                fromBlock,
                toBlock,
                windowBlocks,
                settlementLagBlocks,
                canonicalCount: canonicalRange.events.length,
                indexedCount: indexedRange.events.length,
                coverageProven: false,
                indexedRange: indexedRange.metadata,
                canonicalRange: canonicalRange.metadata,
            },
        };
    }
    const canonicalEvents = canonicalRange.events.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
    const indexedEvents = indexedRange.events.filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
    const invalidCanonical = canonicalEvents.filter((event) => !eventKey(event));
    const invalidIndexed = indexedEvents.filter((event) => !eventKey(event));
    if (invalidCanonical.length || invalidIndexed.length) {
        return {
            primitive: "EVENT_COMPLETENESS",
            name: config.name,
            status: "UNKNOWN",
            summary: `Strong event identity (transactionHash + logIndex) is missing in the requested '${config.stream}' range.`,
            observedAtBlock: toBlock,
            evidence: {
                stream: config.stream,
                canonicalStream,
                classification: "UNPROVEN_EVENT_IDENTITY",
                fromBlock,
                toBlock,
                windowBlocks,
                settlementLagBlocks,
                invalidCanonicalCount: invalidCanonical.length,
                invalidIndexedCount: invalidIndexed.length,
                coverageProven: true,
            },
        };
    }
    const canonicalByKey = new Map(canonicalEvents.map((event) => [eventKey(event), event]));
    const indexedByKey = new Map(indexedEvents.map((event) => [eventKey(event), event]));
    const missing = canonicalEvents.filter((event) => !indexedByKey.has(eventKey(event)));
    const unexpected = indexedEvents.filter((event) => !canonicalByKey.has(eventKey(event)));
    const missingIds = missing.map((event) => eventKey(event));
    const missingBlocks = blocksByKey(missing);
    const missingDepths = missing.map((event) => Math.max(0, toBlock - event.blockNumber));
    const pass = missing.length === 0;
    const classification = canonicalEvents.length === 0 ? "NO_CANONICAL_ACTIVITY" : pass ? "COMPLETE" : "MISSING_EVENTS";
    return {
        primitive: "EVENT_COMPLETENESS",
        name: config.name,
        status: pass ? "PASS" : "FAIL",
        summary: canonicalEvents.length === 0
            ? `No canonical '${canonicalStream}' events occurred in settled blocks ${fromBlock}-${toBlock}; nothing is missing.`
            : pass
                ? `Indexed source covers all ${canonicalEvents.length} canonical '${canonicalStream}' event(s) in settled blocks ${fromBlock}-${toBlock}.`
                : `Indexed source is missing ${missing.length}/${canonicalEvents.length} canonical '${canonicalStream}' event(s) in settled blocks ${fromBlock}-${toBlock}.`,
        observedAtBlock: toBlock,
        evidence: {
            stream: config.stream,
            canonicalStream,
            proofMode: "evm-log-reverse",
            classification,
            fromBlock,
            toBlock,
            canonicalHead: canonicalHead.blockNumber,
            verifiedThroughBlock: toBlock,
            windowBlocks,
            settlementLagBlocks,
            canonicalCount: canonicalEvents.length,
            indexedCount: indexedEvents.length,
            matchedCount: canonicalEvents.length - missing.length,
            missingCount: missing.length,
            missingEventIds: missingIds,
            missingEventBlocks: missingBlocks,
            oldestMissingBlock: missing.length ? Math.min(...missing.map((event) => event.blockNumber)) : undefined,
            newestMissingBlock: missing.length ? Math.max(...missing.map((event) => event.blockNumber)) : undefined,
            maxMissingDepthBlocks: missingDepths.length ? Math.max(...missingDepths) : undefined,
            minMissingDepthBlocks: missingDepths.length ? Math.min(...missingDepths) : undefined,
            unexpectedIndexedCount: unexpected.length,
            unexpectedIndexedEventIds: unexpected.map((event) => eventKey(event)),
            coverageProven: true,
            indexedRange: indexedRange.metadata,
            canonicalRange: canonicalRange.metadata,
        },
    };
}
//# sourceMappingURL=generic-completeness.js.map