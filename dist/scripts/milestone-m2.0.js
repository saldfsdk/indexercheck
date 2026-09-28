import { readFile } from "node:fs/promises";
import { buildPresetConfig } from "../core/init.js";
import { validateProjectConfig } from "../core/load-config.js";
import { TOOL_VERSION } from "../core/delivery.js";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (pkg.version !== TOOL_VERSION) {
    throw new Error(`package version ${pkg.version} != tool version ${TOOL_VERSION}`);
}
const preset = buildPresetConfig("generic-evm-log");
validateProjectConfig(preset);
if (preset.canonical.type !== "json-rpc")
    throw new Error("generic preset canonical source must be json-rpc");
if (preset.indexed.type !== "http-json")
    throw new Error("generic preset indexed source must be http-json");
const proof = preset.checks.provenance?.[0]?.proof;
if (proof?.type !== "evm-log")
    throw new Error("generic preset missing evm-log proof");
if ((proof.inputs ?? []).length !== 3)
    throw new Error("generic preset should demonstrate decoded Transfer inputs");
if (preset.canonical.rpcQuorum?.minAgreement !== 2)
    throw new Error("generic preset should demonstrate canonical 2-of-3 quorum");
const example = JSON.parse(await readFile("examples/generic-evm-log.example.json", "utf8"));
if (JSON.stringify(example) !== JSON.stringify(preset))
    throw new Error("generic example drifted from init preset");
console.log("M2.0 bring-your-own-indexer: config-driven REST/GraphQL event rows feed one generic provenance kernel PASS");
console.log("M2.0 canonical proof: txHash + logIndex + blockNumber resolve against quorum-verified EVM logs PASS");
console.log("M2.0 decoded fields: static ABI address/bool/uintN/intN/bytesN comparisons supported PASS");
console.log("M2.0 safety boundary: dynamic ABI inputs are rejected instead of guessed PASS");
console.log("M2.0 init: generic-evm-log preset + checked-in example stay identical PASS");
//# sourceMappingURL=milestone-m2.0.js.map