import type { SnapshotSource, FreshnessSnapshot, ProvenanceSnapshot } from "../core/source.js";
import type { GoldskyErc20SubgraphSourceConfig, HeadSnapshot, StateValue, EventRecord } from "../core/types.js";
export declare class GoldskyErc20SubgraphSource implements SnapshotSource {
    private readonly cfg;
    constructor(cfg: GoldskyErc20SubgraphSourceConfig);
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
