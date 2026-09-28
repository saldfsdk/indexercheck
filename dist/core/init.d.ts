import type { IndexerCheckConfig } from "./types.js";
export type InitPreset = "generic-evm-log" | "polymarket-pilot" | "goldsky-kaia-usdt-pilot" | "goldsky-euler-mainnet-pilot";
export declare function buildPresetConfig(preset: InitPreset): IndexerCheckConfig;
export declare function writePresetConfig(path: string, preset: InitPreset, force?: boolean): Promise<IndexerCheckConfig>;
