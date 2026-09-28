export class RpcQuorumError extends Error {
    evidence;
    constructor(message, evidence) {
        super(message);
        this.evidence = evidence;
        this.name = "RpcQuorumError";
    }
}
function normalizeObject(value) {
    if (Array.isArray(value))
        return value.map(normalizeObject);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, normalizeObject(child)]));
    }
    return value;
}
export function stableFingerprint(value) {
    return JSON.stringify(normalizeObject(value));
}
export function normalizeBlockForQuorum(block) {
    if (!block)
        return null;
    return {
        number: String(block.number ?? "").toLowerCase(),
        hash: String(block.hash ?? "").toLowerCase(),
        parentHash: String(block.parentHash ?? "").toLowerCase(),
    };
}
export function normalizeReceiptForQuorum(receipt) {
    if (!receipt)
        return null;
    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    return {
        transactionHash: String(receipt.transactionHash ?? "").toLowerCase(),
        blockHash: String(receipt.blockHash ?? "").toLowerCase(),
        blockNumber: String(receipt.blockNumber ?? "").toLowerCase(),
        status: String(receipt.status ?? "").toLowerCase(),
        logs: logs.map((log) => ({
            address: String(log?.address ?? "").toLowerCase(),
            transactionHash: String(log?.transactionHash ?? "").toLowerCase(),
            blockHash: String(log?.blockHash ?? "").toLowerCase(),
            blockNumber: String(log?.blockNumber ?? "").toLowerCase(),
            logIndex: String(log?.logIndex ?? "").toLowerCase(),
            topics: Array.isArray(log?.topics) ? log.topics.map((topic) => String(topic).toLowerCase()) : [],
            data: String(log?.data ?? "").toLowerCase(),
        })).sort((a, b) => `${a.transactionHash}:${a.logIndex}`.localeCompare(`${b.transactionHash}:${b.logIndex}`)),
    };
}
export function normalizeLogsForQuorum(value) {
    const logs = Array.isArray(value) ? value : [];
    return logs.map((log) => ({
        address: String(log?.address ?? "").toLowerCase(),
        transactionHash: String(log?.transactionHash ?? "").toLowerCase(),
        blockHash: String(log?.blockHash ?? "").toLowerCase(),
        blockNumber: String(log?.blockNumber ?? "").toLowerCase(),
        logIndex: String(log?.logIndex ?? "").toLowerCase(),
        topics: Array.isArray(log?.topics) ? log.topics.map((topic) => String(topic).toLowerCase()) : [],
        data: String(log?.data ?? "").toLowerCase(),
    })).sort((a, b) => `${a.blockNumber}:${a.transactionHash}:${a.logIndex}`.localeCompare(`${b.blockNumber}:${b.transactionHash}:${b.logIndex}`));
}
export async function rpcExactQuorum(urls, method, params, call, minAgreement, normalize = (value) => value) {
    const uniqueUrls = [...new Set(urls)];
    const outcomes = await Promise.all(uniqueUrls.map(async (url) => {
        try {
            return { url, ok: true, result: await call(url, method, params) };
        }
        catch (error) {
            return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }));
    const successes = outcomes.filter((outcome) => outcome.ok);
    const failures = outcomes.filter((outcome) => !outcome.ok)
        .map((outcome) => ({ url: outcome.url, error: outcome.error }));
    const groups = new Map();
    for (const success of successes) {
        const fingerprint = stableFingerprint(normalize(success.result));
        const group = groups.get(fingerprint) ?? [];
        group.push({ url: success.url, result: success.result });
        groups.set(fingerprint, group);
    }
    const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
    const winner = ranked[0] ?? [];
    const evidence = {
        method,
        minAgreement,
        successfulProviders: successes.map((success) => success.url),
        agreeingProviders: winner.map((item) => item.url),
        failedProviders: failures,
        distinctResponses: groups.size,
    };
    if (winner.length < minAgreement) {
        throw new RpcQuorumError(`Canonical RPC quorum failed for ${method}: agreement ${winner.length}/${minAgreement}, successful=${successes.length}, distinct=${groups.size}`, evidence);
    }
    return { result: winner[0].result, evidence };
}
function blockNumber(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.length > 0) {
        try {
            return Number(BigInt(value));
        }
        catch {
            return undefined;
        }
    }
    return undefined;
}
export async function rpcHeadQuorum(urls, headTag, call, minAgreement, maxHeadSkewBlocks, agreementLagBlocks = 0) {
    const uniqueUrls = [...new Set(urls)];
    const outcomes = await Promise.all(uniqueUrls.map(async (url) => {
        try {
            return { url, ok: true, result: await call(url, "eth_getBlockByNumber", [headTag, false]) };
        }
        catch (error) {
            return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
    }));
    const successes = outcomes.filter((outcome) => outcome.ok)
        .map((outcome) => ({ ...outcome, blockNumber: blockNumber(outcome.result?.number) }))
        .filter((outcome) => outcome.blockNumber !== undefined);
    const failures = outcomes.filter((outcome) => !outcome.ok)
        .map((outcome) => ({ url: outcome.url, error: outcome.error }));
    if (successes.length < minAgreement) {
        throw new RpcQuorumError(`Canonical RPC quorum could not read enough heads: ${successes.length}/${minAgreement}`, {
            method: "eth_getBlockByNumber",
            minAgreement,
            successfulProviders: successes.map((success) => success.url),
            agreeingProviders: [],
            failedProviders: failures,
            distinctResponses: successes.length,
            headTag,
        });
    }
    const heights = successes.map((success) => success.blockNumber);
    const minHead = Math.min(...heights);
    const maxHead = Math.max(...heights);
    const skew = maxHead - minHead;
    if (skew > maxHeadSkewBlocks) {
        throw new RpcQuorumError(`Canonical RPC head skew ${skew} exceeds limit ${maxHeadSkewBlocks}`, {
            method: "eth_getBlockByNumber",
            minAgreement,
            successfulProviders: successes.map((success) => success.url),
            agreeingProviders: [],
            failedProviders: failures,
            distinctResponses: new Set(heights).size,
            headTag,
            observedHeads: Object.fromEntries(successes.map((success) => [success.url, success.blockNumber])),
            headSkewBlocks: skew,
        });
    }
    // M1.3.2: the slowest observed latest head is still the ingestion frontier.
    // Verify an older agreement block so short-lived provider/fork skew cannot
    // become a false canonical-quorum failure.
    const lag = Math.max(0, Math.floor(agreementLagBlocks));
    const agreedBlockNumber = Math.max(0, minHead - lag);
    const safeTag = `0x${agreedBlockNumber.toString(16)}`;
    const exact = await rpcExactQuorum(successes.map((success) => success.url), "eth_getBlockByNumber", [safeTag, false], call, minAgreement, normalizeBlockForQuorum);
    return {
        result: exact.result,
        evidence: {
            ...exact.evidence,
            failedProviders: [...failures, ...exact.evidence.failedProviders],
            observedHeads: Object.fromEntries(successes.map((success) => [success.url, success.blockNumber])),
            observedMinHead: minHead,
            agreedBlockNumber,
            agreementLagBlocks: lag,
            headSkewBlocks: skew,
        },
    };
}
//# sourceMappingURL=rpc-quorum.js.map