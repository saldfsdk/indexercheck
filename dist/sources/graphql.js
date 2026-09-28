import { SourceUnavailableError } from "../core/source.js";
function getPath(obj, path) { return path.split(".").filter(Boolean).reduce((v, k) => v == null ? undefined : v[k], obj); }
function asNumber(v) { if (typeof v === "number")
    return v; if (typeof v === "string" && v.startsWith("0x"))
    return Number(BigInt(v)); return Number(v); }
function withVariable(base, key, value) { return { ...(base ?? {}), [key]: value }; }
export class GraphQlSource {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async query(query, variables) {
        const res = await fetch(this.cfg.url, { method: "POST", headers: { "content-type": "application/json", ...(this.cfg.headers ?? {}) }, body: JSON.stringify({ query, variables: variables ?? {} }) });
        if (!res.ok)
            throw new Error(`GraphQL HTTP ${res.status}`);
        const body = await res.json();
        if (body.errors?.length)
            throw new Error(`GraphQL: ${body.errors.map((x) => x.message).join("; ")}`);
        return body.data;
    }
    headFromData(d, head) {
        return { blockNumber: asNumber(getPath(d, head.blockPath)), blockHash: head.hashPath ? String(getPath(d, head.hashPath)) : undefined, reportedHealthy: head.healthyPath ? Boolean(getPath(d, head.healthyPath)) : undefined, reportedSynced: head.syncedPath ? Boolean(getPath(d, head.syncedPath)) : undefined, observedAt: new Date().toISOString() };
    }
    async getHead() {
        try {
            if (this.cfg.head) {
                const d = await this.query(this.cfg.head.query, this.cfg.head.variables);
                return this.headFromData(d, this.cfg.head);
            }
            const first = Object.entries(this.cfg.events ?? {})[0];
            if (!first)
                throw new Error("GraphQL source requires head mapping or at least one event mapping");
            const events = await this.getEvents(first[0]);
            if (!events.length)
                throw new Error("GraphQL source cannot derive head from an empty event stream");
            return { blockNumber: Math.max(...events.map((event) => event.blockNumber)), observedAt: new Date().toISOString() };
        }
        catch (error) {
            throw new SourceUnavailableError("graphql", "getHead", error);
        }
    }
    async getBlockAt(blockNumber) {
        if (!this.cfg.head)
            return undefined;
        const variable = this.cfg.head.historicalBlockVariable;
        if (!variable)
            return undefined;
        const d = await this.query(this.cfg.head.query, withVariable(this.cfg.head.variables, variable, blockNumber));
        const h = this.headFromData(d, this.cfg.head);
        return Number.isFinite(h.blockNumber) ? h : undefined;
    }
    async getState(key) { const m = this.cfg.state?.[key]; if (!m)
        return undefined; const d = await this.query(m.query, m.variables); const value = getPath(d, m.valuePath); if (value === undefined || value === null)
        return undefined; return { key, value: String(value), blockNumber: m.blockPath ? asNumber(getPath(d, m.blockPath)) : undefined, payload: d, metadata: { sourceType: "graphql" } }; }
    async getStateAt(key, blockNumber) {
        const m = this.cfg.state?.[key];
        if (!m || !m.historicalBlockVariable)
            return undefined;
        const vars = withVariable(m.variables, m.historicalBlockVariable, blockNumber);
        const d = await this.query(m.query, vars);
        const value = getPath(d, m.valuePath);
        if (value === undefined || value === null)
            return undefined;
        return { key, value: String(value), blockNumber: m.blockPath ? asNumber(getPath(d, m.blockPath)) : blockNumber, payload: d, metadata: { sourceType: "graphql", historical: true } };
    }
    rowsToEvents(m, d) {
        const rows = getPath(d, m.arrayPath) ?? [];
        return rows.map((row, i) => { const block = asNumber(getPath(row, m.blockPath)); const tx = m.txHashPath ? String(getPath(row, m.txHashPath)).toLowerCase() : undefined; const li = m.logIndexPath ? asNumber(getPath(row, m.logIndexPath)) : undefined; const id = m.idPath ? String(getPath(row, m.idPath)) : tx !== undefined && li !== undefined ? `${tx}:${li}` : `${block}:${i}`; return { id, blockNumber: block, txHash: tx, logIndex: li, address: m.addressPath ? String(getPath(row, m.addressPath)).toLowerCase() : undefined, eventName: m.eventName, payload: row }; });
    }
    async getEvents(stream) { const m = this.cfg.events?.[stream]; if (!m)
        return []; const d = await this.query(m.query, m.variables); return this.rowsToEvents(m, d); }
    async getEventsAt(stream, fromBlock, toBlock) {
        return (await this.getEventsAtWithEvidence(stream, fromBlock, toBlock)).events;
    }
    async getEventsAtWithEvidence(stream, fromBlock, toBlock) {
        const m = this.cfg.events?.[stream];
        if (!m || !m.historicalFromBlockVariable || !m.historicalToBlockVariable) {
            return { events: [], metadata: { coverageProven: false, reason: "GraphQL historical range variables are not configured", requestedFromBlock: fromBlock, requestedToBlock: toBlock } };
        }
        let vars = withVariable(m.variables, m.historicalFromBlockVariable, fromBlock);
        vars = withVariable(vars, m.historicalToBlockVariable, toBlock);
        const d = await this.query(m.query, vars);
        return { events: this.rowsToEvents(m, d), metadata: { coverageProven: m.historicalRangeComplete === true, coverageBasis: m.historicalRangeComplete === true ? "declared-complete-range-query" : "range-query-without-completeness-contract", requestedFromBlock: fromBlock, requestedToBlock: toBlock } };
    }
}
//# sourceMappingURL=graphql.js.map