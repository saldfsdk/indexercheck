import type { SnapshotSource } from "./source.js";
import type { PrimitiveResult, StateParityCheckConfig } from "./types.js";
export declare function genericEvmCallStateParity(canonical: SnapshotSource, indexed: SnapshotSource, config: StateParityCheckConfig): Promise<PrimitiveResult>;
