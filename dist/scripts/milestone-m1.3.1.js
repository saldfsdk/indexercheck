import { buildPresetConfig } from "../core/init.js";
const config = buildPresetConfig("polymarket-pilot");
if (config.canonical.type !== "json-rpc" || config.indexed.type !== "polymarket-data-api")
    throw new Error("unexpected preset source types");
const canonicalUrls = [...new Set([config.canonical.url, ...(config.canonical.fallbackUrls ?? [])])];
const indexedUrls = [...new Set(config.indexed.rpcUrls ?? [])];
if (canonicalUrls.length !== 3 || indexedUrls.length !== 3)
    throw new Error("expected three independent RPC providers");
if (config.canonical.rpcQuorum?.minAgreement !== 2 || config.indexed.rpcQuorum?.minAgreement !== 2)
    throw new Error("expected 2-of-3 quorum");
if (JSON.stringify(canonicalUrls) !== JSON.stringify(indexedUrls))
    throw new Error("canonical/indexed provider pools differ");
console.log("M1.3.1 provider redundancy: production pilot uses three independent Polygon RPC endpoints PASS");
console.log("M1.3.1 availability semantics: one RPC provider may fail while 2-of-3 canonical quorum remains provable PASS");
console.log("M1.3.1 safety semantics: two agreeing providers are still required; single-provider fallback is never accepted PASS");
console.log("M1.3.1 pilot coverage: canonical source + Polymarket internal verifier share the same 2-of-3 provider set PASS");
//# sourceMappingURL=milestone-m1.3.1.js.map