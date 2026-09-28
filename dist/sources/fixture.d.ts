import type { SnapshotSource } from "../core/source.js";
import type { EventRecord, HeadSnapshot, StateValue } from "../core/types.js";
export declare class FixtureSource implements SnapshotSource {
    private readonly doc;
    private constructor();
    static fromFile(file: string, baseDir: string): Promise<FixtureSource>;
    getHead(): Promise<HeadSnapshot>;
    getBlockAt(blockNumber: number): Promise<HeadSnapshot | undefined>;
    getState(key: string): Promise<StateValue | undefined>;
    getStateAt(key: string, blockNumber: number): Promise<StateValue | undefined>;
    getEvents(stream: string): Promise<EventRecord[]>;
    getEventsAt(stream: string, fromBlock: number, toBlock: number): Promise<EventRecord[]>;
}
