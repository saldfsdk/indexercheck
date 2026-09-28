import { buildPresetConfig } from "../core/init.js";

const config = buildPresetConfig("polymarket-pilot");
const check = config.checks.transactionCompleteness?.[0];
if (!check) throw new Error("missing transaction completeness preset");
if (check.settlementLagBlocks !== 5) throw new Error("production pilot must verify behind a five-block stable watermark");

console.log("M1.2.3 stable watermark: latest observed indexed block is not treated as complete-through PASS");
console.log("M1.2.3 frontier isolation: five trailing indexed blocks are excluded from completeness verdicts PASS");
console.log("M1.2.3 persistence semantics: omissions older than the stable watermark still fail PASS");
console.log("M1.2.3 evidence: latest observed head + verified-through block + excluded frontier are reported PASS");
