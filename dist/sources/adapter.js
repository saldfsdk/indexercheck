import { readFile, writeFile, unlink } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SourceUnavailableError } from "../core/source.js";
function normalizeHead(head) {
    const blockNumber = Number(head?.blockNumber);
    if (!Number.isInteger(blockNumber) || blockNumber < 0)
        throw new Error("adapter getHead() must return a non-negative integer blockNumber");
    return {
        blockNumber,
        blockHash: head?.blockHash === undefined ? undefined : String(head.blockHash),
        reportedHealthy: head?.reportedHealthy === undefined ? undefined : Boolean(head.reportedHealthy),
        reportedSynced: head?.reportedSynced === undefined ? undefined : Boolean(head.reportedSynced),
        observedAt: head?.observedAt === undefined ? new Date().toISOString() : String(head.observedAt),
    };
}
function normalizeEvent(event, index) {
    const blockNumber = Number(event.blockNumber);
    if (!Number.isInteger(blockNumber) || blockNumber < 0)
        throw new Error(`adapter event[${index}] has invalid blockNumber`);
    const rawTx = event.transactionHash ?? event.txHash;
    const txHash = rawTx === undefined ? undefined : String(rawTx).toLowerCase();
    const logIndex = event.logIndex === undefined ? undefined : Number(event.logIndex);
    if (logIndex !== undefined && (!Number.isInteger(logIndex) || logIndex < 0))
        throw new Error(`adapter event[${index}] has invalid logIndex`);
    const id = event.id ?? (txHash !== undefined && logIndex !== undefined ? `${txHash}:${logIndex}` : `${blockNumber}:${index}`);
    return {
        id: String(id),
        blockNumber,
        txHash,
        logIndex,
        address: event.address === undefined ? undefined : String(event.address).toLowerCase(),
        eventName: event.eventName,
        payload: event.payload ?? {},
    };
}
function normalizeEvents(events) {
    if (!Array.isArray(events))
        throw new Error("adapter event method must return an array of events");
    return events.map(normalizeEvent);
}
async function importTypeScriptAdapter(path) {
    const moduleApi = await import("node:module");
    if (typeof moduleApi.stripTypeScriptTypes !== "function") {
        throw new Error("TypeScript adapters require a Node runtime with module.stripTypeScriptTypes(); compile the adapter to .mjs/.js on older Node versions");
    }
    const source = await readFile(path, "utf8");
    const transformed = moduleApi.stripTypeScriptTypes(source, { mode: "transform", sourceUrl: path });
    const tempPath = path.replace(/\.ts$/i, `.indexercheck-${process.pid}-${Date.now()}.mjs`);
    await writeFile(tempPath, transformed, "utf8");
    try {
        return await import(`${pathToFileURL(tempPath).href}?indexercheck=${Date.now()}`);
    }
    finally {
        await unlink(tempPath).catch(() => undefined);
    }
}
async function importAdapterModule(path) {
    if (extname(path).toLowerCase() === ".ts")
        return importTypeScriptAdapter(path);
    return import(`${pathToFileURL(path).href}?indexercheck=${Date.now()}`);
}
export class AdapterSource {
    cfg;
    runtime;
    adapterName;
    constructor(cfg, runtime, adapterName) {
        this.cfg = cfg;
        this.runtime = runtime;
        this.adapterName = adapterName;
    }
    static async fromConfig(cfg, baseDir) {
        const modulePath = resolve(baseDir, cfg.module);
        const imported = await importAdapterModule(modulePath);
        const definition = (imported.default ?? imported.adapter);
        if (!definition || definition.__indexercheckAdapter !== true || typeof definition.create !== "function") {
            throw new Error(`Adapter module '${cfg.module}' must default-export defineIndexerAdapter({...})`);
        }
        const runtime = await definition.create({ options: cfg.options, configDir: baseDir });
        if (!runtime || typeof runtime.getHead !== "function")
            throw new Error(`Adapter '${definition.name ?? cfg.module}' must implement getHead()`);
        return new AdapterSource(cfg, runtime, definition.name ?? cfg.module);
    }
    async invoke(operation, fn) {
        try {
            return await fn();
        }
        catch (error) {
            throw new SourceUnavailableError("adapter", `${this.adapterName}.${operation}`, error);
        }
    }
    async getHead() {
        return this.invoke("getHead", async () => normalizeHead(await this.runtime.getHead()));
    }
    async getState(key) {
        if (!this.runtime.getState)
            throw new SourceUnavailableError("adapter", `${this.adapterName}.getState`, new Error("method is not implemented"));
        return this.invoke(`getState(${key})`, async () => {
            const state = await this.runtime.getState(key);
            if (!state)
                return undefined;
            const blockNumber = state.blockNumber === undefined ? undefined : Number(state.blockNumber);
            if (blockNumber !== undefined && (!Number.isInteger(blockNumber) || blockNumber < 0))
                throw new Error(`state '${key}' has invalid blockNumber`);
            return {
                key,
                value: String(state.value),
                blockNumber,
                payload: state.payload,
                metadata: { sourceType: "adapter", adapter: this.adapterName, ...(state.metadata ?? {}) },
            };
        });
    }
    async getEvents(stream) {
        if (!this.runtime.getEvents)
            throw new SourceUnavailableError("adapter", `${this.adapterName}.getEvents`, new Error("method is not implemented"));
        return this.invoke(`getEvents(${stream})`, async () => normalizeEvents(await this.runtime.getEvents(stream)));
    }
    async getEventsAt(stream, fromBlock, toBlock) {
        return (await this.getEventsAtWithEvidence(stream, fromBlock, toBlock)).events;
    }
    async getEventsAtWithEvidence(stream, fromBlock, toBlock) {
        if (!this.runtime.getEventsAt)
            throw new SourceUnavailableError("adapter", `${this.adapterName}.getEventsAt`, new Error("method is not implemented"));
        return this.invoke(`getEventsAt(${stream})`, async () => {
            const raw = await this.runtime.getEventsAt(stream, { fromBlock, toBlock });
            const range = Array.isArray(raw)
                ? { events: raw, coverageProven: false, metadata: { reason: "adapter returned an array without an explicit completeness contract" } }
                : raw;
            return {
                events: normalizeEvents(range.events),
                metadata: {
                    coverageProven: range.coverageProven === true,
                    coverageBasis: range.coverageProven === true ? "adapter-declared-complete-range" : "adapter-range-without-completeness-contract",
                    requestedFromBlock: fromBlock,
                    requestedToBlock: toBlock,
                    adapter: this.adapterName,
                    ...(range.metadata ?? {}),
                },
            };
        });
    }
}
//# sourceMappingURL=adapter.js.map