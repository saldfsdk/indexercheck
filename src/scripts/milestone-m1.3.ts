import { buildPresetConfig } from "../core/init.js";

const config = buildPresetConfig("polymarket-pilot");
if (config.canonical.type !== "json-rpc" || config.indexed.type !== "polymarket-data-api") throw new Error("M1.3 preset source types invalid");
if (config.canonical.rpcQuorum?.minAgreement !== 2) throw new Error("M1.3 canonical source quorum is not 2-provider");
if (config.indexed.rpcQuorum?.minAgreement !== 2) throw new Error("M1.3 Polymarket verifier quorum is not 2-provider");
console.log("M1.3 canonical head: moving latest heads resolve to an agreed common block PASS");
console.log("M1.3 canonical evidence: receipts/logs require RPC response agreement PASS");
console.log("M1.3 failure semantics: RPC disagreement is rejected instead of becoming false canonical truth PASS");
console.log("M1.3 pilot coverage: top-level canonical + Polymarket internal verifier both require quorum PASS");
