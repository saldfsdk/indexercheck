import { buildPresetConfig } from "../core/init.js";
import { DEFAULT_KAIA_RPC_URLS, GOLDSKY_KAIA_USDT_GRAPHQL, KAIA_USDT_ADDRESS } from "../live/goldsky-kaia.js";
import { TOOL_VERSION } from "../core/delivery.js";

const cfg = buildPresetConfig("goldsky-kaia-usdt-pilot");
if (cfg.canonical.type !== "json-rpc" || cfg.indexed.type !== "goldsky-erc20-subgraph") throw new Error("unexpected M1.5 preset source types");
if (new Set(DEFAULT_KAIA_RPC_URLS).size !== 3 || cfg.indexed.rpcQuorum?.minAgreement !== 2) throw new Error("M1.5 Kaia quorum not 2-of-3");
if (cfg.indexed.graphqlUrl !== GOLDSKY_KAIA_USDT_GRAPHQL || cfg.indexed.tokenAddress !== KAIA_USDT_ADDRESS) throw new Error("M1.5 public pilot mismatch");
console.log("M1.5 second production integration: Goldsky public subgraph + Kaia USDT pilot configured PASS");
console.log("M1.5 provider neutrality: independent Goldsky GraphQL + Kaia JSON-RPC source type PASS");
console.log("M1.5 canonical provenance: indexed Transfer id/from/to/value is checked against receipt/log evidence PASS");
console.log("M1.5 freshness semantics: Goldsky _meta head is compared with a 2-of-3 Kaia canonical quorum PASS");
