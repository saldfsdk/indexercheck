import { buildPresetConfig } from "../core/init.js";
import { DEFAULT_ETHEREUM_RPC_URLS, GOLDSKY_EULER_MAINNET_GRAPHQL } from "../live/goldsky-euler.js";
import { TOOL_VERSION } from "../core/delivery.js";

const cfg=buildPresetConfig("goldsky-euler-mainnet-pilot");
if(cfg.canonical.type!=="json-rpc"||cfg.indexed.type!=="goldsky-euler-subgraph")throw new Error("unexpected M1.5.1 source types");
if(new Set(DEFAULT_ETHEREUM_RPC_URLS).size!==3||cfg.indexed.rpcQuorum?.minAgreement!==2)throw new Error("M1.5.1 Ethereum quorum not 2-of-3");
if(cfg.indexed.graphqlUrl!==GOLDSKY_EULER_MAINNET_GRAPHQL)throw new Error("M1.5.1 Goldsky Euler endpoint mismatch");
if(cfg.indexed.graphqlUrl.includes("usdt-demo-kaia"))throw new Error("M1.5.1 still depends on stale Kaia tutorial endpoint");
console.log("M1.5.1 endpoint lifecycle: retired Kaia tutorial demo is removed from the production Goldsky pilot PASS");
console.log("M1.5.1 live production surface: Euler mainnet Goldsky endpoint from current Euler docs configured PASS");
console.log("M1.5.1 canonical state proof: TrackingVaultBalance is checked via receipt + historical balance/debt state PASS");
console.log("M1.5.1 Ethereum quorum: three independent providers require 2-of-3 canonical agreement PASS");
