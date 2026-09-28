import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const repo = pkg.repository?.url;
if (!repo) {
  console.error("repository check: package.json has no repository URL");
  process.exit(1);
}
const match = String(repo).match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
if (!match) {
  console.error(`repository check: unsupported GitHub repository URL: ${repo}`);
  process.exit(1);
}
const [, owner, name] = match;
const url = `https://api.github.com/repos/${owner}/${name}`;
let response;
try {
  response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "user-agent": "indexercheck-release-preflight" },
    signal: AbortSignal.timeout(15000),
  });
} catch (error) {
  console.error(`repository check: could not reach GitHub for ${owner}/${name}: ${error?.message ?? error}`);
  process.exit(2);
}
if (response.status === 404) {
  console.error(`repository check: ${owner}/${name} does not exist yet FAIL`);
  process.exit(1);
}
if (!response.ok) {
  console.error(`repository check: GitHub returned HTTP ${response.status} for ${owner}/${name}`);
  process.exit(2);
}
const data = await response.json();
if (data.private === true) {
  console.error(`repository check: ${owner}/${name} exists but is private FAIL`);
  process.exit(1);
}
console.log(`repository check: ${owner}/${name} exists and is public PASS`);
