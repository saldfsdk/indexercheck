import { readFile } from "node:fs/promises";
import { TOOL_VERSION } from "../core/delivery.js";

const EXPECTED_VERSION = "0.2.1";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (TOOL_VERSION !== EXPECTED_VERSION) throw new Error(`tool version ${TOOL_VERSION} != ${EXPECTED_VERSION}`);
if (pkg.version !== TOOL_VERSION) throw new Error(`package version ${pkg.version} != machine artifact version ${TOOL_VERSION}`);
if (pkg.private === true) throw new Error("final release must not be private");
if (pkg.license !== "MIT") throw new Error(`final release license must be MIT, got ${pkg.license}`);
if (pkg.publishConfig?.access !== "public") throw new Error("final release must declare publishConfig.access=public");
if (pkg.devDependencies?.typescript !== "5.8.3") throw new Error("repository build must pin TypeScript 5.8.3 as a devDependency");
if (!Array.isArray(pkg.files)) throw new Error("package.json must define an npm files whitelist");
if (!pkg.scripts?.["check:package"]) throw new Error("package.json missing check:package");
if (!pkg.scripts?.["check:first-publish"]) throw new Error("package.json missing first-publish preflight");
if (pkg.scripts?.prepack !== "npm run build") throw new Error("npm prepack must rebuild dist");
if (!pkg.scripts?.prepublishOnly?.includes("milestone:release")) throw new Error("npm prepublishOnly must enforce release metadata gate");
if (pkg.types !== "./dist/sdk.d.ts") throw new Error("package.json must expose SDK TypeScript declarations");
if (pkg.exports?.["./sdk"]?.types !== "./dist/sdk.d.ts") throw new Error("indexercheck/sdk export must expose TypeScript declarations");
if (!Array.isArray(pkg.keywords) || !pkg.keywords.includes("indexer") || !pkg.keywords.includes("evm")) throw new Error("package discovery keywords missing indexer/evm");
if (pkg.repository?.url !== "git+https://github.com/saldfsdk/indexercheck.git") throw new Error("canonical repository metadata missing");
if (pkg.homepage !== "https://github.com/saldfsdk/indexercheck#readme") throw new Error("canonical homepage metadata missing");
if (pkg.bugs?.url !== "https://github.com/saldfsdk/indexercheck/issues") throw new Error("canonical bugs metadata missing");
if (!pkg.scripts?.["check:repository"]) throw new Error("package.json missing repository existence gate");

for (const path of [
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "RELEASE_NOTES_v0.2.0.md",
  "RELEASE_NOTES_v0.2.1.md",
  "docs/M1-DEVELOPMENT-NOTES.md",
  "docs/M2-DEVELOPMENT-NOTES.md",
  "docs/EXTERNAL-PILOT-ENVIO-ROBINHOOD.md",
  "scripts/package-smoke.mjs",
  "scripts/check-npm-name.mjs",
  "examples/polymarket-pilot.json",
  "examples/goldsky-euler-mainnet-pilot.json",
  "examples/generic-evm-log.example.json",
  "examples/envio-hyperindex.example.json",
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
  "examples/envio-hyperindex.example.json",
  "examples/generic-adapter.example.json",
  "LICENSE",
  "RELEASE_NOTES_v0.2.0.md",
  "RELEASE_NOTES_v0.2.1.md"
];
for (const entry of requiredPackEntries) if (!pkg.files.includes(entry)) throw new Error(`npm files whitelist missing ${entry}`);
for (const forbidden of ["src", "dist/tests", "docs"]) {
  if (pkg.files.some((entry: string) => entry === forbidden || entry.startsWith(`${forbidden}/`))) throw new Error(`npm files whitelist should not ship ${forbidden}`);
}

console.log(`v0.2.1 release: package + machine artifact versions agree (${TOOL_VERSION}) PASS`);
console.log("v0.2.1 release: M2 proof surface + Adapter SDK retained PASS");
console.log("v0.2.1 release: MIT license + public npm metadata retained PASS");
console.log("v0.2.1 release: repository build pins TypeScript 5.8.3 PASS");
console.log("v0.2.1 release: clean-install package smoke + public repository/publish gates retained PASS");
console.log("v0.2.1 release: report + watch event/state + webhook v1 schemas retained PASS");
