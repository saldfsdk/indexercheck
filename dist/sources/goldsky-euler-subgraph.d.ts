import type { SnapshotSource, FreshnessSnapshot, ProvenanceSnapshot } from "../core/source.js";
import type { GoldskyEulerSubgraphSourceConfig, HeadSnapshot, StateValue, EventRecord } from "../core/types.js";
export declare class GoldskyEulerSubgraphSource implements SnapshotSource {
    private readonly cfg;
    constructor(cfg: GoldskyEulerSubgraphSourceConfig);
    private urls;
    private quorumMin;
    private rpcSingle;
    private gql;
    private canonicalHead;
    getHead(): Promise<HeadSnapshot>;
    getFreshness(stream: string): Promise<FreshnessSnapshot>;
    getProvenance(stream: string): Promise<ProvenanceSnapshot>;
    getState(_key: string): Promise<StateValue | undefined>;
    getEvents(_stream: string): Promise<EventRecord[]>;
}
