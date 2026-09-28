import { DEFAULT_ETHEREUM_RPC_URLS, GOLDSKY_EULER_MAINNET_GRAPHQL } from "../live/goldsky-euler.js";
const BALANCE_OF_SELECTOR = "70a08231";
const DEBT_OF_SELECTOR = "d283e75f";
const required = ["account", "vault", "balance", "debt", "blockNumber", "transactionHash"];
function encode(selector, address) {
    const raw = String(address).toLowerCase().replace(/^0x/, "");
    return `0x${selector}${raw.padStart(64, "0")}`;
}
function blockTag(value) { return `0x${BigInt(String(value)).toString(16)}`; }
function isRevert(message) {
    const v = message.toLowerCase();
    if (/missing trie|historical state|archive|state is not available|header not found|unknown block|timeout|rate limit|http \d+/.test(v))
        return false;
    return /execution reverted|vm execution error|revert(?:ed)?\b|contract execution error/.test(v);
}
async function rpc(url, method, params) {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), redirect: "follow" });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error)
        throw new Error(`${body.error.code}: ${body.error.message}`);
    return body.result;
}
const query = `query IndexerCheckPreflight { _meta { block { number hash } hasIndexingErrors } __type(name:"TrackingVaultBalance") { fields { name } } trackingVaultBalances(first:1,orderBy:blockNumber,orderDirection:desc){account vault balance debt blockNumber transactionHash} }`;
const res = await fetch(GOLDSKY_EULER_MAINNET_GRAPHQL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
const text = await res.text();
if (!res.ok)
    throw new Error(`Goldsky Euler preflight HTTP ${res.status}: ${text.slice(0, 300)}`);
const body = JSON.parse(text);
if (body.errors?.length)
    throw new Error(`Goldsky Euler preflight GraphQL: ${body.errors.map((x) => x.message).join("; ")}`);
const fields = (body.data?.__type?.fields ?? []).map((x) => x.name);
const missing = required.filter((name) => !fields.includes(name));
if (missing.length)
    throw new Error(`Goldsky Euler schema missing required fields: ${missing.join(", ")}`);
const row = body.data?.trackingVaultBalances?.[0];
if (!row)
    throw new Error("Goldsky Euler preflight found no TrackingVaultBalance row");
console.log(`Goldsky Euler endpoint PASS — metaBlock=${body.data?._meta?.block?.number} fields=${required.join(",")}`);
let archiveReady = 0;
for (const url of DEFAULT_ETHEREUM_RPC_URLS) {
    const checks = [];
    try {
        await rpc(url, "eth_getBlockByNumber", ["latest", false]);
        checks.push("head=PASS");
    }
    catch (error) {
        checks.push(`head=FAIL(${error instanceof Error ? error.message : String(error)})`);
    }
    try {
        await rpc(url, "eth_getTransactionReceipt", [row.transactionHash]);
        checks.push("receipt=PASS");
    }
    catch (error) {
        checks.push(`receipt=FAIL(${error instanceof Error ? error.message : String(error)})`);
    }
    let balanceOk = false;
    let debtOk = false;
    const tag = blockTag(row.blockNumber);
    try {
        await rpc(url, "eth_call", [{ to: row.vault, data: encode(BALANCE_OF_SELECTOR, row.account) }, tag]);
        balanceOk = true;
        checks.push("balanceOf@block=PASS");
    }
    catch (error) {
        checks.push(`balanceOf@block=FAIL(${error instanceof Error ? error.message : String(error)})`);
    }
    try {
        await rpc(url, "eth_call", [{ to: row.vault, data: encode(DEBT_OF_SELECTOR, row.account) }, tag]);
        debtOk = true;
        checks.push("debtOf@block=PASS");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isRevert(message)) {
            debtOk = true;
            checks.push("debtOf@block=REVERT_ZERO");
        }
        else
            checks.push(`debtOf@block=FAIL(${message})`);
    }
    if (balanceOk && debtOk)
        archiveReady++;
    console.log(`RPC ${url} — ${checks.join(" ")}`);
}
if (archiveReady < 2)
    throw new Error(`Goldsky Euler preflight archive-state quorum unavailable: ${archiveReady}/2 providers ready`);
console.log(`Goldsky Euler archive-state quorum PASS — ready=${archiveReady}/${DEFAULT_ETHEREUM_RPC_URLS.length} required=2`);
//# sourceMappingURL=goldsky-euler-preflight.js.map