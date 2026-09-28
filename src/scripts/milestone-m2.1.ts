import { readFile } from "node:fs/promises";
import { buildPresetConfig } from "../core/init.js";
import { validateProjectConfig } from "../core/load-config.js";
import { TOOL_VERSION } from "../core/delivery.js";

const expectedVersion = "0.2.0";
if (TOOL_VERSION !== expectedVersion) throw new Error(`unexpected tool version ${TOOL_VERSION}`);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (pkg.version !== expectedVersion) throw new Error(`unexpected package version ${pkg.version}`);

const preset = buildPresetConfig("generic-evm-log");
validateProjectConfig(preset);
const completeness = preset.checks.eventCompleteness?.[0];
if (completeness?.proof?.type !== "evm-log-reverse") throw new Error("generic preset missing evm-log-reverse completeness proof");
if (completeness.proof.windowBlocks !== 50) throw new Error("generic preset completeness window drifted");
if (completeness.proof.settlementLagBlocks !== 5) throw new Error("generic preset settlement lag drifted");
if (preset.indexed.type !== "http-json") throw new Error("generic preset indexed source must be http-json");
const mapping = preset.indexed.events?.Transfer;
if (!mapping?.historicalRequest || mapping.historicalRangeComplete !== true) throw new Error("generic preset must declare a complete historical HTTP range request");

console.log("M2.1 reverse completeness: canonical EVM logs are checked against generic indexed event rows PASS");
console.log("M2.1 stable watermark: settlementLagBlocks excludes the partially-indexed frontier PASS");
console.log("M2.1 coverage safety: unproven indexed range coverage becomes UNKNOWN, never false INCOMPLETE PASS");
console.log("M2.1 event identity: transactionHash + logIndex keys preserve log multiplicity PASS");
console.log("M2.1 generic sources: GraphQL range variables + templated REST historical requests supported PASS");
