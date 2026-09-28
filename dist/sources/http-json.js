import { SourceUnavailableError } from "../core/source.js";
function getPath(obj, path) {
    return path.split(".").filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], obj);
}
function interpolateRange(value, fromBlock, toBlock) {
    if (typeof value === "string")
        return value.replaceAll("{{fromBlock}}", String(fromBlock)).replaceAll("{{toBlock}}", String(toBlock));
    if (Array.isArray(value))
        return value.map((item) => interpolateRange(item, fromBlock, toBlock));
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolateRange(item, fromBlock, toBlock)]));
    return value;
}
function asNumber(value) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string" && value.startsWith("0x"))
        return Number(BigInt(value));
    return Number(value);
}
export class HttpJsonSource {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    requestConfig(override) {
        return {
            url: override?.url ?? this.cfg.url,
            method: override?.method ?? this.cfg.method ?? (override?.body !== undefined || this.cfg.body !== undefined ? "POST" : "GET"),
            headers: { ...(this.cfg.headers ?? {}), ...(override?.headers ?? {}) },
            body: override?.body ?? this.cfg.body,
        };
    }
    async fetchJson(override) {
        const request = this.requestConfig(override);
        const headers = { ...(request.headers ?? {}) };
        let body;
        if (request.body !== undefined) {
            if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type"))
                headers["content-type"] = "application/json";
            body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
        }
        const response = await fetch(request.url, { method: request.method, headers, body });
        if (!response.ok)
            throw new Error(`HTTP JSON ${response.status}`);
        return response.json();
    }
    rowsToEvents(mapping, data) {
        const rows = getPath(data, mapping.arrayPath) ?? [];
        if (!Array.isArray(rows))
            throw new Error(`HTTP JSON arrayPath '${mapping.arrayPath}' did not resolve to an array`);
        return rows.map((row, index) => {
            const blockNumber = asNumber(getPath(row, mapping.blockPath));
            const txHashValue = mapping.txHashPath ? getPath(row, mapping.txHashPath) : undefined;
            const logIndexValue = mapping.logIndexPath ? getPath(row, mapping.logIndexPath) : undefined;
            const txHash = txHashValue === undefined || txHashValue === null ? undefined : String(txHashValue).toLowerCase();
            const logIndex = logIndexValue === undefined || logIndexValue === null ? undefined : asNumber(logIndexValue);
            const idValue = mapping.idPath ? getPath(row, mapping.idPath) : undefined;
            const id = idValue !== undefined && idValue !== null
                ? String(idValue)
                : txHash !== undefined && logIndex !== undefined
                    ? `${txHash}:${logIndex}`
                    : `${blockNumber}:${index}`;
            return {
                id,
                blockNumber,
                txHash,
                logIndex,
                address: mapping.addressPath ? String(getPath(row, mapping.addressPath)).toLowerCase() : undefined,
                eventName: mapping.eventName,
                payload: row,
            };
        });
    }
    async getHead() {
        try {
            if (this.cfg.head) {
                const data = await this.fetchJson(this.cfg.head);
                const blockNumber = asNumber(getPath(data, this.cfg.head.blockPath));
                if (!Number.isFinite(blockNumber))
                    throw new Error(`HTTP JSON head blockPath '${this.cfg.head.blockPath}' is not numeric`);
                return {
                    blockNumber,
                    blockHash: this.cfg.head.hashPath ? String(getPath(data, this.cfg.head.hashPath)) : undefined,
                    reportedHealthy: this.cfg.head.healthyPath ? Boolean(getPath(data, this.cfg.head.healthyPath)) : undefined,
                    reportedSynced: this.cfg.head.syncedPath ? Boolean(getPath(data, this.cfg.head.syncedPath)) : undefined,
                    observedAt: new Date().toISOString(),
                };
            }
            const first = Object.values(this.cfg.events ?? {})[0];
            if (first) {
                const events = this.rowsToEvents(first, await this.fetchJson(first));
                if (events.length)
                    return { blockNumber: Math.max(...events.map((event) => event.blockNumber)), observedAt: new Date().toISOString() };
            }
            const firstState = Object.entries(this.cfg.state ?? {})[0];
            if (firstState) {
                const state = await this.getState(firstState[0]);
                if (state?.blockNumber !== undefined && Number.isFinite(state.blockNumber))
                    return { blockNumber: state.blockNumber, observedAt: new Date().toISOString() };
            }
            throw new Error("HTTP JSON source requires head mapping, a non-empty event mapping, or a state mapping with blockPath");
        }
        catch (error) {
            throw new SourceUnavailableError("http-json", "getHead", error);
        }
    }
    async getState(key) {
        const mapping = this.cfg.state?.[key];
        if (!mapping)
            return undefined;
        const data = await this.fetchJson(mapping);
        const value = getPath(data, mapping.valuePath);
        if (value === undefined || value === null)
            return undefined;
        const blockNumber = mapping.blockPath ? asNumber(getPath(data, mapping.blockPath)) : undefined;
        return {
            key,
            value: String(value),
            blockNumber: blockNumber !== undefined && Number.isFinite(blockNumber) ? blockNumber : undefined,
            payload: data,
            metadata: { sourceType: "http-json" },
        };
    }
    async getEvents(stream) {
        const mapping = this.cfg.events?.[stream];
        if (!mapping)
            return [];
        return this.rowsToEvents(mapping, await this.fetchJson(mapping));
    }
    async getEventsAt(stream, fromBlock, toBlock) {
        return (await this.getEventsAtWithEvidence(stream, fromBlock, toBlock)).events;
    }
    async getEventsAtWithEvidence(stream, fromBlock, toBlock) {
        const mapping = this.cfg.events?.[stream];
        if (!mapping?.historicalRequest) {
            return { events: [], metadata: { coverageProven: false, reason: "HTTP JSON historicalRequest is not configured", requestedFromBlock: fromBlock, requestedToBlock: toBlock } };
        }
        const templated = interpolateRange(mapping.historicalRequest, fromBlock, toBlock);
        const data = await this.fetchJson(templated);
        return {
            events: this.rowsToEvents(mapping, data),
            metadata: {
                coverageProven: mapping.historicalRangeComplete === true,
                coverageBasis: mapping.historicalRangeComplete === true ? "declared-complete-range-request" : "range-request-without-completeness-contract",
                requestedFromBlock: fromBlock,
                requestedToBlock: toBlock,
            },
        };
    }
}
//# sourceMappingURL=http-json.js.map