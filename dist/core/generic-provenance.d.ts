import type { ProvenanceSnapshot, SnapshotSource } from "./source.js";
import type { ProvenanceCheckConfig } from "./types.js";
export declare function parseStaticType(type: string): {
    kind: "address" | "bool" | "uint" | "int" | "bytes";
    bits?: number;
    bytes?: number;
};
export declare function decodeStaticWord(raw: unknown, type: string): string;
export declare function normalizeStaticValue(value: unknown, type: string): string;
export declare function encodeStaticWord(value: unknown, type: string): string;
export declare function genericEvmLogProvenance(canonical: SnapshotSource, indexed: SnapshotSource, config: ProvenanceCheckConfig): Promise<ProvenanceSnapshot>;
