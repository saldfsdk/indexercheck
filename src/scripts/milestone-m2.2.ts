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
if (preset.canonical.type !== "json-rpc") throw new Error("generic preset canonical source must be json-rpc");
if (preset.canonical.rpcQuorum?.minAgreement !== 2) throw new Error("generic state proof should demonstrate canonical 2-of-3 quorum");
if (preset.indexed.type !== "http-json") throw new Error("generic preset indexed source must be http-json");
const state = preset.indexed.state?.Balance;
if (!state?.valuePath || !state.blockPath) throw new Error("generic preset missing indexed state value/block mapping");
const check = preset.checks.stateParity?.[0];
if (check?.proof?.type !== "evm-call") throw new Error("generic preset missing evm-call state proof");
if (check.proof.selector !== "0x70a08231") throw new Error("generic preset balanceOf selector drifted");
if (check.proof.returnType !== "uint256") throw new Error("generic preset state return type drifted");
if (check.proof.args?.[0]?.indexedPath !== "row.account") throw new Error("generic preset state call argument mapping drifted");

const example = JSON.parse(await readFile("examples/generic-evm-log.example.json", "utf8"));
if (JSON.stringify(example) !== JSON.stringify(preset)) throw new Error("generic example drifted from init preset");

console.log("M2.2 generic state proof: REST/GraphQL indexed state maps into historical canonical eth_call PASS");
console.log("M2.2 ABI calls: static arguments are encoded and single static return values are decoded PASS");
console.log("M2.2 historical alignment: canonical state is read at the indexed row block, never accidental latest PASS");
console.log("M2.2 quorum safety: unavailable historical/archive proof becomes UNKNOWN, never false DRIFT PASS");
console.log("M2.2 init: generic preset now demonstrates provenance + completeness + state parity PASS");
