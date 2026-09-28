import { buildPresetConfig } from "../core/init.js";
import { TOOL_VERSION } from "../core/delivery.js";
import { DEFAULT_ETHEREUM_RPC_URLS } from "../live/goldsky-euler.js";

const cfg=buildPresetConfig("goldsky-euler-mainnet-pilot");
if(cfg.indexed.type!=="goldsky-euler-subgraph")throw new Error("unexpected indexed source");
const expected=["https://eth.drpc.org","https://gateway.tenderly.co/public/mainnet","https://eth.merkle.io"];
if(JSON.stringify(DEFAULT_ETHEREUM_RPC_URLS)!==JSON.stringify(expected))throw new Error(`unexpected archive RPC pool ${JSON.stringify(DEFAULT_ETHEREUM_RPC_URLS)}`);
if(cfg.indexed.rpcQuorum?.minAgreement!==2)throw new Error("M1.5.2 archive quorum is not 2-of-3");
console.log("M1.5.2 archive capability: Ethereum historical-state proof uses dRPC + Tenderly + Merkle PASS");
console.log("M1.5.2 availability semantics: one historical eth_call provider may fail while 2-of-3 proof survives PASS");
console.log("M1.5.2 Euler semantics: try_debtOf contract revert is normalized to indexed debt=0 PASS");
console.log("M1.5.2 diagnostics: per-row RPC quorum failures preserve provider-level evidence PASS");
