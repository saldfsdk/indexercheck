import type { SnapshotSource } from "../core/source.js";
import { SourceUnavailableError } from "../core/source.js";
import type { EventRecord, HeadSnapshot, HttpJsonEventMapping, HttpJsonRequestConfig, HttpJsonSourceConfig, StateValue } from "../core/types.js";

function getPath(obj: any, path: string): any {
  return path.split(".").filter(Boolean).reduce((value, key) => value == null ? undefined : value[key], obj);
}


function interpolateRange(value: unknown, fromBlock: number, toBlock: number): unknown {
  if (typeof value === "string") return value.replaceAll("{{fromBlock}}", String(fromBlock)).replaceAll("{{toBlock}}", String(toBlock));
  if (Array.isArray(value)) return value.map((item) => interpolateRange(item, fromBlock, toBlock));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolateRange(item, fromBlock, toBlock)]));
  return value;
}

function asNumber(value: any): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.startsWith("0x")) return Number(BigInt(value));
  return Number(value);
}

export class HttpJsonSource implements SnapshotSource {
  constructor(private readonly cfg: HttpJsonSourceConfig) {}

  private requestConfig(override?: HttpJsonRequestConfig): Required<Pick<HttpJsonRequestConfig, "method">> & HttpJsonRequestConfig & { url: string } {
    return {
      url: override?.url ?? this.cfg.url,
      method: override?.method ?? this.cfg.method ?? (override?.body !== undefined || this.cfg.body !== undefined ? "POST" : "GET"),
      headers: { ...(this.cfg.headers ?? {}), ...(override?.headers ?? {}) },
      body: override?.body ?? this.cfg.body,
    };
  }

  private async fetchJson(override?: HttpJsonRequestConfig): Promise<any> {
    const request = this.requestConfig(override);
    const headers: Record<string, string> = { ...(request.headers ?? {}) };
    let body: string | undefined;
    if (request.body !== undefined) {
      if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
      body = typeof request.body === "string" ? request.body : JSON.stringify(request.body);
    }
    const response = await fetch(request.url, { method: request.method, headers, body });
    if (!response.ok) throw new Error(`HTTP JSON ${response.status}`);
    return response.json();
  }

  private rowsToEvents(mapping: HttpJsonEventMapping, data: any): EventRecord[] {
    const rows: any[] = getPath(data, mapping.arrayPath) ?? [];
    if (!Array.isArray(rows)) throw new Error(`HTTP JSON arrayPath '${mapping.arrayPath}' did not resolve to an array`);
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

  async getHead(): Promise<HeadSnapshot> {
    try {
      if (this.cfg.head) {
        const data = await this.fetchJson(this.cfg.head);
        const blockNumber = asNumber(getPath(data, this.cfg.head.blockPath));
        if (!Number.isFinite(blockNumber)) throw new Error(`HTTP JSON head blockPath '${this.cfg.head.blockPath}' is not numeric`);
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
        if (events.length) return { blockNumber: Math.max(...events.map((event) => event.blockNumber)), observedAt: new Date().toISOString() };
      }
      const firstState = Object.entries(this.cfg.state ?? {})[0];
      if (firstState) {
        const state = await this.getState(firstState[0]);
        if (state?.blockNumber !== undefined && Number.isFinite(state.blockNumber)) return { blockNumber: state.blockNumber, observedAt: new Date().toISOString() };
      }
      throw new Error("HTTP JSON source requires head mapping, a non-empty event mapping, or a state mapping with blockPath");
    } catch (error) {
      throw new SourceUnavailableError("http-json", "getHead", error);
    }
  }

  async getState(key: string): Promise<StateValue | undefined> {
    const mapping = this.cfg.state?.[key];
    if (!mapping) return undefined;
    const data = await this.fetchJson(mapping);
    const value = getPath(data, mapping.valuePath);
    if (value === undefined || value === null) return undefined;
    const blockNumber = mapping.blockPath ? asNumber(getPath(data, mapping.blockPath)) : undefined;
    return {
      key,
      value: String(value),
      blockNumber: blockNumber !== undefined && Number.isFinite(blockNumber) ? blockNumber : undefined,
      payload: data,
      metadata: { sourceType: "http-json" },
    };
  }
  async getEvents(stream: string): Promise<EventRecord[]> {
    const mapping = this.cfg.events?.[stream];
    if (!mapping) return [];
    return this.rowsToEvents(mapping, await this.fetchJson(mapping));
  }
  async getEventsAt(stream: string, fromBlock: number, toBlock: number): Promise<EventRecord[]> {
    return (await this.getEventsAtWithEvidence(stream, fromBlock, toBlock)).events;
  }
  async getEventsAtWithEvidence(stream: string, fromBlock: number, toBlock: number) {
    const mapping = this.cfg.events?.[stream];
    if (!mapping?.historicalRequest) {
      return { events: [], metadata: { coverageProven: false, reason: "HTTP JSON historicalRequest is not configured", requestedFromBlock: fromBlock, requestedToBlock: toBlock } };
    }
    const templated = interpolateRange(mapping.historicalRequest, fromBlock, toBlock) as HttpJsonRequestConfig;
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
