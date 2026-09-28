import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const name = pkg.name;
const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;

let response;
try {
  response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15000) });
} catch (error) {
  console.error(`npm name check: could not reach registry for ${name}: ${error?.message ?? error}`);
  process.exit(2);
}

if (response.status === 404) {
  console.log(`npm name check: ${name} is currently unregistered/available PASS`);
  process.exit(0);
}
if (response.ok) {
  let latest = "unknown";
  try {
    const data = await response.json();
    latest = data?.["dist-tags"]?.latest ?? data?.version ?? "unknown";
  } catch {}
  console.error(`npm name check: ${name} is already registered (latest=${latest}) FAIL`);
  process.exit(1);
}
console.error(`npm name check: registry returned HTTP ${response.status} for ${name}`);
process.exit(2);
