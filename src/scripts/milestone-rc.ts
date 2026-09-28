import { readFile } from "node:fs/promises";
import { TOOL_VERSION } from "../core/delivery.js";

const EXPECTED_VERSION = "0.2.0";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (TOOL_VERSION !== EXPECTED_VERSION) throw new Error(`tool version ${TOOL_VERSION} != ${EXPECTED_VERSION}`);
if (pkg.version !== TOOL_VERSION) throw new Error(`package version ${pkg.version} != machine artifact version ${TOOL_VERSION}`);
if (!Array.isArray(pkg.files)) throw new Error("package.json must define an npm files whitelist");
if (!pkg.scripts?.["check:package"]) throw new Error("package.json missing check:package");
if (!pkg.scripts?.["milestone:m2.3"]) throw new Error("package.json missing M2.3 milestone");
if (pkg.private !== true) throw new Error("RC must remain private until registry publication decisions are explicit");
if (pkg.types !== "./dist/sdk.d.ts") throw new Error("package.json must expose SDK TypeScript declarations");
if (pkg.exports?.["./sdk"]?.types !== "./dist/sdk.d.ts") throw new Error("indexercheck/sdk export must expose TypeScript declarations");
if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("indexer") || !pkg.keywords.includes("evm")) throw new Error("package.json discovery keywords missing indexer/evm");

for (const path of [
  "README.md",
  "CHANGELOG.md",
  "RELEASE_NOTES_v0.2.0.md",
  "docs/M1-DEVELOPMENT-NOTES.md",
  "docs/M2-DEVELOPMENT-NOTES.md",
  "scripts/package-smoke.mjs",
  "examples/polymarket-pilot.json",
  "examples/goldsky-euler-mainnet-pilot.json",
  "examples/generic-evm-log.example.json",
  "examples/generic-adapter.example.json",
  "examples/adapters/custom-indexer.mjs",
  "examples/adapters/custom-indexer.ts",
  "schemas/indexercheck-report-v1.schema.json",
  "schemas/indexercheck-watch-event-v1.schema.json",
  "schemas/indexercheck-watch-state-v1.schema.json",
  "schemas/indexercheck-webhook-v1.schema.json"
]) await readFile(path, "utf8");

const requiredPackEntries = [
  "dist/cli.js",
  "dist/sdk.js",
  "dist/sdk.d.ts",
  "dist/core",
  "dist/live",
  "dist/sources",
  "schemas",
  "examples/generic-evm-log.example.json",
  "examples/generic-adapter.example.json",
  "RELEASE_NOTES_v0.2.0.md"
];
for (const entry of requiredPackEntries) if (!pkg.files.includes(entry)) throw new Error(`npm files whitelist missing ${entry}`);
for (const forbidden of ["src", "dist/tests", "docs"]) {
  if (pkg.files.some((entry: string) => entry === forbidden || entry.startsWith(`${forbidden}/`))) throw new Error(`npm files whitelist should not ship ${forbidden}`);
}

console.log(`v0.2 RC: package + machine artifact versions agree (${TOOL_VERSION}) PASS`);
console.log("v0.2 RC: M2.0 provenance + M2.1 completeness + M2.2 state + M2.3 adapter SDK release surface retained PASS");
console.log("v0.2 RC: generic config + adapter examples + current release notes present PASS");
console.log("v0.2 RC: runtime whitelist + clean-install package smoke gate retained PASS");
console.log("v0.2 RC: report + watch event/state + webhook v1 schemas retained PASS");
console.log("v0.2 RC: SDK TypeScript exports + npm discovery metadata retained PASS");
console.log("v0.2 RC: registry publication remains intentionally blocked by private=true PASS");
