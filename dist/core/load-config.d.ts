import type { SnapshotSource } from "./source.js";
import type { IndexerCheckConfig } from "./types.js";
export interface LoadedProject {
    config: IndexerCheckConfig;
    canonical: SnapshotSource;
    indexed: SnapshotSource;
}
export declare function validateProjectConfig(config: IndexerCheckConfig): void;
export declare function loadProject(configFile: string): Promise<LoadedProject>;
