import type { SnapshotSource } from "./source.js";
import type { IndexerCheckConfig, VerificationReport } from "./types.js";
export declare function verify(config: IndexerCheckConfig, canonical: SnapshotSource, indexed: SnapshotSource): Promise<VerificationReport>;
