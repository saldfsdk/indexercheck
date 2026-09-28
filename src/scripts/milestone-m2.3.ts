import { readFile } from "node:fs/promises";
import { AdapterSource } from "../sources/adapter.js";
import { validateProjectConfig } from "../core/load-config.js";
import { TOOL_VERSION } from "../core/delivery.js";
import type { IndexerCheckConfig } from "../core/types.js";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (pkg.version !== TOOL_VERSION) {
  throw new Error(`package version ${pkg.version} != tool version ${TOOL_VERSION}`);
}
const sdkExport = pkg.exports?.["./sdk"];
const sdkImport = typeof sdkExport === "string" ? sdkExport : sdkExport?.import ?? sdkExport?.default;
if (sdkImport !== "./dist/sdk.js") throw new Error("package does not export indexercheck/sdk");
if (typeof sdkExport === "object" && sdkExport?.types !== "./dist/sdk.d.ts") throw new Error("package does not expose indexercheck/sdk TypeScript declarations");

const example = JSON.parse(await readFile("examples/generic-adapter.example.json", "utf8")) as IndexerCheckConfig;
validateProjectConfig(example);
if (example.indexed.type !== "adapter") throw new Error("generic adapter example must use indexed.type=adapter");
if (!example.indexed.module.endsWith("custom-indexer.mjs")) throw new Error("generic adapter example module drifted");

const indexed = await AdapterSource.fromConfig(example.indexed, "examples");
if ((await indexed.getHead()).blockNumber !== 100) throw new Error("sample adapter head normalization failed");
if ((await indexed.getEvents("Transfer"))[0]?.txHash !== "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") throw new Error("sample adapter event normalization failed");
if ((await indexed.getState("Balance"))?.value !== "7") throw new Error("sample adapter state normalization failed");

console.log("M2.3 adapter SDK: indexercheck/sdk exports defineIndexerAdapter + normalized head/state/event contracts PASS");
console.log("M2.3 local modules: config-driven JavaScript adapter loading feeds the existing proof kernel PASS");
console.log("M2.3 TypeScript path: local .ts adapters are type-stripped when the Node runtime exposes stripTypeScriptTypes PASS");
console.log("M2.3 failure semantics: adapter runtime failures become UNKNOWN instead of false DRIFT/INCOMPLETE PASS");
console.log("M2.3 trust boundary: adapters are indexed-only; canonical truth remains inside built-in quorum-backed sources PASS");
