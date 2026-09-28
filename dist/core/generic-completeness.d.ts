import { type SnapshotSource } from "./source.js";
import type { EventCompletenessCheckConfig, PrimitiveResult } from "./types.js";
export declare function genericEvmLogReverseCompleteness(canonical: SnapshotSource, indexed: SnapshotSource, config: EventCompletenessCheckConfig): Promise<PrimitiveResult>;
