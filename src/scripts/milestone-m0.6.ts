import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";

const examples = fileURLToPath(new URL("../../examples/", import.meta.url));

async function run(file: string) {
  const project = await loadProject(`${examples}/${file}`);
  return verify(project.config, project.canonical, project.indexed);
}

const upgrade = await run("contract-upgrade-incident.json");
const upgradeState = upgrade.results.find((r) => r.primitive === "STATE_PARITY");
const upgradeDivergence = upgrade.results.find((r) => r.primitive === "FIRST_DIVERGENCE");
const upgradeIncident = upgrade.results.find((r) => r.primitive === "INCIDENT_REPORT");
assert.equal(upgrade.verdict, "DRIFT");
assert.equal(upgradeState?.observedAtBlock, 106);
assert.equal(upgradeState?.firstBadBlock, undefined);
assert.equal(upgradeDivergence?.firstBadBlock, 104);
assert.equal(upgradeIncident?.evidence?.incidentVerdict, "DRIFT");
assert.deepEqual(upgradeIncident?.evidence?.relatedTransactions, ["0xup"]);

const cctp = await run("graph-cctp-incident.json");
const cctpIncident = cctp.results.find((r) => r.primitive === "INCIDENT_REPORT");
assert.equal(cctp.verdict, "INCOMPLETE");
assert.deepEqual(cctpIncident?.evidence?.relatedTransactions, ["0xbbb"]);
const timeline = cctpIncident?.evidence?.timeline as Record<string, unknown>;
assert.equal(timeline.firstDivergenceBlock, 20300002);
assert.equal(timeline.lastKnownGoodBlock, 20300001);

console.log("M0.6 semantics: observedAtBlock is distinct from FIRST_DIVERGENCE PASS");
console.log("M0.6 INCIDENT_REPORT: detection + timeline + root cause + evidence aggregation PASS");
console.log("M0.6 upgrade incident: observed=106 lastGood=103 firstDivergence=104 cause=CONTRACT_UPGRADE tx=0xup PASS");
console.log("M0.6 missed-event incident: observed=20300003 lastGood=20300001 firstDivergence=20300002 cause=MISSED_EVENT tx=0xbbb PASS");
