import type { SnapshotSource } from "../core/source.js";
import type { EventRecord, HeadSnapshot, HttpJsonSourceConfig, StateValue } from "../core/types.js";
export declare class HttpJsonSource implements SnapshotSource {
    private readonly cfg;
    constructor(cfg: HttpJsonSourceConfig);
    private requestConfig;
    private fetchJson;
    private rowsToEvents;
    getHead(): Promise<HeadSnapshot>;
    getState(key: string): Promise<StateValue | undefined>;
    getEvents(stream: string): Promise<EventRecord[]>;
    getEventsAt(stream: string, fromBlock: number, toBlock: number): Promise<EventRecord[]>;
    getEventsAtWithEvidence(stream: string, fromBlock: number, toBlock: number): Promise<{
        events: never[];
        metadata: {
            coverageProven: boolean;
            reason: string;
            requestedFromBlock: number;
            requestedToBlock: number;
            coverageBasis?: undefined;
        };
    } | {
        events: EventRecord[];
        metadata: {
            coverageProven: boolean;
            coverageBasis: string;
            requestedFromBlock: number;
            requestedToBlock: number;
            reason?: undefined;
        };
    }>;
}
