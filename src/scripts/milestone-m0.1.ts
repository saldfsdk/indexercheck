import assert from "node:assert/strict";
import { loadProject } from "../core/load-config.js";
import { fileURLToPath } from "node:url";
import { verify } from "../core/verifier.js";

const examples = fileURLToPath(new URL("../../examples/", import.meta.url));

async function run(name: string, expected: string): Promise<void> {
  const p = await loadProject(`${examples}/${name}.json`);
  const report = await verify(p.config, p.canonical, p.indexed);
  assert.equal(report.verdict, expected);
  console.log(`${name.padEnd(18)} ${report.verdict} PASS`);
}

await run("clean-erc20", "PASS");
await run("goldsky-weth", "DRIFT");
await run("graph-cctp", "INCOMPLETE");

console.log("M0.1 primitives: CANONICAL_HEAD + STATE_PARITY + EVENT_COMPLETENESS PASS");
console.log("M0.1 benchmark: clean + 2 Golden Bug fixtures PASS");
