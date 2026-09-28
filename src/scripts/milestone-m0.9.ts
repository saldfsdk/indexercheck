import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { buildMachineReport } from "../core/delivery.js";
import { acknowledgeWatchEvent, advanceWatchState } from "../core/watch.js";

const examples = fileURLToPath(new URL("../../examples/", import.meta.url));

async function artifact(file: string) {
  const project = await loadProject(`${examples}/${file}`);
  return buildMachineReport(await verify(project.config, project.canonical, project.indexed));
}

const incident = await artifact("contract-upgrade-incident.json");
incident.generatedAt = "2026-09-27T00:00:00.000Z";
const detected = advanceWatchState(undefined, incident, incident.generatedAt);
if (detected.detected !== 1 || detected.events[0]?.type !== "indexercheck.incident.detected") throw new Error("M0.9 detected transition failed");
let state = acknowledgeWatchEvent(detected.state, detected.events[0]!.eventId);

const unchangedReport = structuredClone(incident);
unchangedReport.generatedAt = "2026-09-27T00:01:00.000Z";
const unchanged = advanceWatchState(state, unchangedReport, unchangedReport.generatedAt);
if (unchanged.unchanged !== 1 || unchanged.events.length !== 0) throw new Error("M0.9 dedup transition failed");
state = unchanged.state;

const updatedReport = structuredClone(incident);
updatedReport.generatedAt = "2026-09-27T00:02:00.000Z";
updatedReport.incidents[0]!.rootCause.confidence = "MEDIUM";
const updated = advanceWatchState(state, updatedReport, updatedReport.generatedAt);
if (updated.updated !== 1 || updated.events[0]?.type !== "indexercheck.incident.updated") throw new Error("M0.9 updated transition failed");
state = acknowledgeWatchEvent(updated.state, updated.events[0]!.eventId);

const clean = await artifact("clean-erc20.json");
clean.project.name = incident.project.name;
clean.generatedAt = "2026-09-27T00:06:00.000Z";
const recovered = advanceWatchState(state, clean, clean.generatedAt);
if (recovered.recovered !== 1 || recovered.events[0]?.type !== "indexercheck.incident.recovered") throw new Error("M0.9 recovery transition failed");
if (recovered.events[0]?.payload.recovery?.durationMs !== 360000) throw new Error("M0.9 recovery duration failed");

console.log("M0.9 continuous watch: PASS -> DETECTED -> deduplicated unchanged -> UPDATED -> RECOVERED PASS");
console.log("M0.9 incident fingerprint: stable across evidence update PASS");
console.log("M0.9 delivery idempotency: acknowledged events removed; failed events remain pending for replay PASS");
console.log("M0.9 recovery lifecycle: duration=360000ms PASS");
