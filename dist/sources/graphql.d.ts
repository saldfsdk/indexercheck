import type { SnapshotSource } from "../core/source.js";
import type { EventRecord, GraphQlSourceConfig, HeadSnapshot, StateValue } from "../core/types.js";
export declare class GraphQlSource implements SnapshotSource {
    private readonly cfg;
    constructor(cfg: GraphQlSourceConfig);
    private query;
    private headFromData;
    getHead(): Promise<HeadSnapshot>;
    getBlockAt(blockNumber: number): Promise<HeadSnapshot | undefined>;
    getState(key: string): Promise<StateValue | undefined>;
    getStateAt(key: string, blockNumber: number): Promise<StateValue | undefined>;
    private rowsToEvents;
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
