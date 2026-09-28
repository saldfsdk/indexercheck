import type { SnapshotSource } from "../core/source.js";
import type { AdapterSourceConfig, EventRecord, HeadSnapshot, StateValue } from "../core/types.js";
export declare class AdapterSource implements SnapshotSource {
    private readonly cfg;
    private readonly runtime;
    readonly adapterName: string;
    private constructor();
    static fromConfig(cfg: AdapterSourceConfig, baseDir: string): Promise<AdapterSource>;
    private invoke;
    getHead(): Promise<HeadSnapshot>;
    getState(key: string): Promise<StateValue | undefined>;
    getEvents(stream: string): Promise<EventRecord[]>;
    getEventsAt(stream: string, fromBlock: number, toBlock: number): Promise<EventRecord[]>;
    getEventsAtWithEvidence(stream: string, fromBlock: number, toBlock: number): Promise<{
        events: EventRecord[];
        metadata: {
            coverageProven: boolean;
            coverageBasis: string;
            requestedFromBlock: number;
            requestedToBlock: number;
            adapter: string;
        };
    }>;
}
