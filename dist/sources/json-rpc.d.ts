import type { EventRangeSnapshot, EvmCallProofRequest, EvmCallProofSnapshot, SnapshotSource } from "../core/source.js";
import type { EventRecord, HeadSnapshot, JsonRpcSourceConfig, StateValue } from "../core/types.js";
export declare class JsonRpcSource implements SnapshotSource {
    private readonly cfg;
    constructor(cfg: JsonRpcSourceConfig);
    private urls;
    private rpcSingle;
    private rpcFallback;
    private quorumMin;
    private rpcExact;
    getHead(): Promise<HeadSnapshot>;
    getBlockAt(blockNumber: number): Promise<HeadSnapshot | undefined>;
    getState(key: string): Promise<StateValue | undefined>;
    getStateAt(key: string, blockNumber: number): Promise<StateValue | undefined>;
    getEvmCallProof(request: EvmCallProofRequest): Promise<EvmCallProofSnapshot>;
    private logsToEvents;
    private eventsInRange;
    getEvents(stream: string): Promise<EventRecord[]>;
    getEventsAt(stream: string, fromBlock: number, toBlock: number): Promise<EventRecord[]>;
    getEventsAtWithEvidence(stream: string, fromBlock: number, toBlock: number): Promise<EventRangeSnapshot>;
}
