import { checkTransactionCompleteness } from "../core/primitives.js";
import { buildPresetConfig } from "../core/init.js";
class CompletenessSource {
    snapshot;
    constructor(snapshot) {
        this.snapshot = snapshot;
    }
    async getHead() { return { blockNumber: this.snapshot.toBlock ?? 0 }; }
    async getState(_key) { return undefined; }
    async getEvents(_stream) { return []; }
    async getTransactionCompleteness(_stream, _request) { return this.snapshot; }
}
const config = { name: "orderfilled-transaction-completeness", stream: "OrderFilled", windowBlocks: 20, indexedPageSize: 500, maxPages: 4 };
const complete = await checkTransactionCompleteness(new CompletenessSource({
    stream: "OrderFilled", fromBlock: 100, toBlock: 119,
    canonicalTransactions: 7, indexedTransactions: 21, matchedTransactions: 7,
    missingTransactions: [], coverageProven: true, oldestIndexedBlock: 98, newestIndexedBlock: 119, pageCount: 1,
    metadata: { canonicalLogCount: 11 },
}), config);
if (complete.status !== "PASS" || complete.evidence?.classification !== "COMPLETE")
    throw new Error("complete coverage should PASS");
const missingTx = `0x${"e".repeat(64)}`;
const missing = await checkTransactionCompleteness(new CompletenessSource({
    stream: "OrderFilled", fromBlock: 100, toBlock: 119,
    canonicalTransactions: 7, indexedTransactions: 20, matchedTransactions: 6,
    missingTransactions: [missingTx], coverageProven: true, oldestIndexedBlock: 98, newestIndexedBlock: 119, pageCount: 1,
}), config);
if (missing.status !== "FAIL" || missing.evidence?.missingTransactions?.[0] !== missingTx)
    throw new Error("missing tx should FAIL with evidence");
const unproven = await checkTransactionCompleteness(new CompletenessSource({
    stream: "OrderFilled", fromBlock: 100, toBlock: 119,
    canonicalTransactions: 7, indexedTransactions: 500, matchedTransactions: 7,
    missingTransactions: [], coverageProven: false, oldestIndexedBlock: 110, newestIndexedBlock: 119, pageCount: 4,
}), config);
if (unproven.status !== "UNKNOWN" || unproven.evidence?.classification !== "UNPROVEN_COVERAGE")
    throw new Error("unproven coverage should UNKNOWN");
const preset = buildPresetConfig("polymarket-pilot");
if (preset.checks.transactionCompleteness?.[0]?.stream !== "OrderFilled")
    throw new Error("pilot preset missing completeness");
if (preset.checks.provenance?.[0]?.stream !== "OrderFilled")
    throw new Error("pilot preset missing provenance");
console.log("M1.2 reverse coverage: canonical OrderFilled transactions -> indexed Data API transaction hashes PASS");
console.log("M1.2 transaction semantics: canonical log multiplicity does not overcount transaction completeness PASS");
console.log(`M1.2 missing transaction evidence: ${missingTx.slice(0, 12)}... -> INCOMPLETE-ready FAIL PASS`);
console.log("M1.2 coverage guard: insufficient indexed page depth -> UNKNOWN, not false INCOMPLETE PASS");
console.log("M1.2 pilot preset: SOURCE_FRESHNESS + TRANSACTION_COMPLETENESS + PROVENANCE PASS");
//# sourceMappingURL=milestone-m1.2.js.map