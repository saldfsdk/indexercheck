import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { FixtureSource } from "../sources/fixture.js";
import {
  checkCanonicalHead,
  checkEventCompleteness,
  checkStateParity,
} from "../core/primitives.js";

const baseDir = fileURLToPath(new URL("../../examples/", import.meta.url));

async function source(file: string) {
  return FixtureSource.fromFile(`fixtures/${file}`, baseDir);
}

test("CANONICAL_HEAD passes when indexed head is within configured lag", async () => {
  const canonical = await source("clean-canonical.json");
  const indexed = await source("clean-indexed.json");
  const result = await checkCanonicalHead(canonical, indexed, { maxLagBlocks: 2 });
  assert.equal(result.status, "PASS");
});

test("STATE_PARITY catches WETH-style indexed balance drift", async () => {
  const canonical = await source("goldsky-weth-canonical.json");
  const indexed = await source("goldsky-weth-indexed.json");
  const result = await checkStateParity(canonical, indexed, {
    name: "alice-weth-balance",
    key: "weth.balance:0xalice",
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.observedAtBlock, 19000001);
  assert.equal(result.firstBadBlock, undefined);
  assert.equal(result.evidence?.canonicalValue, "10000000000000000000");
  assert.equal(result.evidence?.indexedValue, "0");
});

test("EVENT_COMPLETENESS catches healthy/synced CCTP silent data loss", async () => {
  const canonical = await source("graph-cctp-canonical.json");
  const indexed = await source("graph-cctp-indexed.json");
  const result = await checkEventCompleteness(canonical, indexed, {
    name: "cctp-message-sent",
    stream: "MessageSent",
  });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.evidence?.missingEventIds, ["0xbbb:3"]);
  assert.equal(result.observedAtBlock, 20300003);
  assert.equal(result.firstBadBlock, undefined);
});
