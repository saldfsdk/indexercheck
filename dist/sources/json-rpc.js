import { SourceUnavailableError } from "../core/source.js";
import { normalizeBlockForQuorum, normalizeLogsForQuorum, rpcExactQuorum, rpcHeadQuorum, } from "../live/rpc-quorum.js";
function asHexBlock(v) { return typeof v === "number" ? `0x${v.toString(16)}` : v; }
function decodeValue(value, decode = "hex") {
    if (decode === "hex")
        return value.toLowerCase();
    if (decode === "uint256")
        return BigInt(value).toString(10);
    if (decode === "bool")
        return BigInt(value) === 0n ? "false" : "true";
    if (decode === "address")
        return `0x${value.slice(-40)}`.toLowerCase();
    return value;
}
export class JsonRpcSource {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    urls() {
        return [this.cfg.url, ...(this.cfg.fallbackUrls ?? []).filter((url) => url !== this.cfg.url)];
    }
    async rpcSingle(url, method, params) {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(this.cfg.headers ?? {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (body.error)
            throw new Error(`${body.error.code}: ${body.error.message}`);
        return body.result;
    }
    async rpcFallback(method, params) {
        const errors = [];
        for (const url of this.urls()) {
            try {
                return await this.rpcSingle(url, method, params);
            }
            catch (error) {
                errors.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        throw new Error(`JSON-RPC ${method} failed: ${errors.join(" | ")}`);
    }
    quorumMin() {
        if (!this.cfg.rpcQuorum)
            return undefined;
        return Math.max(1, this.cfg.rpcQuorum.minAgreement ?? 2);
    }
    async rpcExact(method, params, normalize = (value) => value) {
        const minAgreement = this.quorumMin();
        if (!minAgreement)
            return this.rpcFallback(method, params);
        const result = await rpcExactQuorum(this.urls(), method, params, (url, m, p) => this.rpcSingle(url, m, p), minAgreement, normalize);
        return result.result;
    }
    async getHead() {
        try {
            const minAgreement = this.quorumMin();
            let block;
            if (minAgreement) {
                const result = await rpcHeadQuorum(this.urls(), this.cfg.headTag ?? "finalized", (url, method, params) => this.rpcSingle(url, method, params), minAgreement, Math.max(0, this.cfg.rpcQuorum?.maxHeadSkewBlocks ?? 8), Math.max(0, this.cfg.rpcQuorum?.agreementLagBlocks ?? 0));
                block = result.result;
            }
            else {
                block = await this.rpcFallback("eth_getBlockByNumber", [this.cfg.headTag ?? "finalized", false]);
            }
            if (!block?.number)
                throw new Error("JSON-RPC head missing block number");
            return { blockNumber: Number(BigInt(block.number)), blockHash: block.hash, observedAt: new Date().toISOString() };
        }
        catch (error) {
            throw new SourceUnavailableError("json-rpc", "getHead", error);
        }
    }
    async getBlockAt(blockNumber) {
        const block = await this.rpcExact("eth_getBlockByNumber", [asHexBlock(blockNumber), false], normalizeBlockForQuorum);
        if (!block?.number)
            return undefined;
        return { blockNumber: Number(BigInt(block.number)), blockHash: block.hash };
    }
    async getState(key) {
        const m = this.cfg.state?.[key];
        if (!m)
            return undefined;
        if (this.quorumMin()) {
            // Quorum state reads use an explicit agreed block so providers cannot be
            // compared at slightly different "latest" heights.
            const head = await this.getHead();
            const blockTag = asHexBlock(head.blockNumber);
            const value = await this.rpcExact("eth_call", [{ to: m.to, data: m.data }, blockTag]);
            return { key, value: decodeValue(value, m.decode), blockNumber: head.blockNumber };
        }
        const blockTag = m.blockTag ?? this.cfg.headTag ?? "finalized";
        const [value, block] = await Promise.all([this.rpcFallback("eth_call", [{ to: m.to, data: m.data }, blockTag]), this.rpcFallback("eth_getBlockByNumber", [blockTag, false])]);
        return { key, value: decodeValue(value, m.decode), blockNumber: block?.number ? Number(BigInt(block.number)) : undefined };
    }
    async getStateAt(key, blockNumber) {
        const m = this.cfg.state?.[key];
        if (!m)
            return undefined;
        const blockTag = asHexBlock(blockNumber);
        const value = await this.rpcExact("eth_call", [{ to: m.to, data: m.data }, blockTag]);
        return { key, value: decodeValue(value, m.decode), blockNumber };
    }
    async getEvmCallProof(request) {
        const blockTag = asHexBlock(request.blockNumber);
        const params = [{ to: request.to, data: request.data }, blockTag];
        const minAgreement = this.quorumMin();
        if (minAgreement) {
            const result = await rpcExactQuorum(this.urls(), "eth_call", params, (url, method, rpcParams) => this.rpcSingle(url, method, rpcParams), minAgreement, (value) => String(value).toLowerCase());
            return { value: String(result.result).toLowerCase(), blockNumber: request.blockNumber, metadata: { rpcQuorum: result.evidence } };
        }
        const value = await this.rpcFallback("eth_call", params);
        return { value: String(value).toLowerCase(), blockNumber: request.blockNumber, metadata: { rpcProviderMode: "fallback" } };
    }
    logsToEvents(stream, logs) {
        const m = this.cfg.events?.[stream];
        return logs.map(log => ({ id: `${String(log.transactionHash).toLowerCase()}:${Number(BigInt(log.logIndex))}`, blockNumber: Number(BigInt(log.blockNumber)), txHash: String(log.transactionHash).toLowerCase(), logIndex: Number(BigInt(log.logIndex)), address: String(log.address).toLowerCase(), eventName: m?.eventName, payload: { topics: log.topics, data: log.data } }));
    }
    async eventsInRange(stream, fromBlock, toBlock) {
        const m = this.cfg.events?.[stream];
        if (!m)
            return { events: [] };
        const params = [{ address: m.address, topics: m.topics, fromBlock: asHexBlock(fromBlock), toBlock: asHexBlock(toBlock) }];
        const minAgreement = this.quorumMin();
        if (minAgreement) {
            const result = await rpcExactQuorum(this.urls(), "eth_getLogs", params, (url, method, rpcParams) => this.rpcSingle(url, method, rpcParams), minAgreement, normalizeLogsForQuorum);
            return { events: this.logsToEvents(stream, result.result), metadata: { rpcQuorum: result.evidence } };
        }
        const logs = await this.rpcFallback("eth_getLogs", params);
        return { events: this.logsToEvents(stream, logs) };
    }
    async getEvents(stream) {
        const m = this.cfg.events?.[stream];
        if (!m)
            return [];
        return (await this.eventsInRange(stream, m.fromBlock, m.toBlock)).events;
    }
    async getEventsAt(stream, fromBlock, toBlock) {
        return (await this.eventsInRange(stream, fromBlock, toBlock)).events;
    }
    async getEventsAtWithEvidence(stream, fromBlock, toBlock) {
        return this.eventsInRange(stream, fromBlock, toBlock);
    }
}
//# sourceMappingURL=json-rpc.js.map