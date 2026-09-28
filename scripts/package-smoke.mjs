import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

function commandFor(name, args) {
  if (process.platform !== "win32" || (name !== "npm" && name !== "npx")) return { executable: name, args };

  // npm/npx are .cmd launchers on Windows. Run them through cmd.exe; native
  // executables such as node should still be spawned directly.
  const shell = process.env.ComSpec || "cmd.exe";
  return {
    executable: shell,
    args: ["/d", "/s", "/c", `${name}.cmd`, ...args],
  };
}

function run(name, args, cwd, label) {
  const command = commandFor(name, args);
  const result = spawnSync(command.executable, command.args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (result.status !== 0) {
    const stdout = result.stdout?.trim();
    const stderr = result.stderr?.trim();
    const failure = [
      `exit ${result.status}`,
      result.signal ? `signal ${result.signal}` : null,
      result.error ? `${result.error.name}: ${result.error.message}` : null,
    ].filter(Boolean).join(", ");
    throw new Error(`${label} failed (${failure})${stdout ? `\nstdout:\n${stdout}` : ""}${stderr ? `\nstderr:\n${stderr}` : ""}`);
  }
  return result.stdout ?? "";
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const EXPECTED_VERSION = pkg.version;

const work = await mkdtemp(join(tmpdir(), "indexercheck-package-smoke-"));
const packDir = join(work, "pack");
const installDir = join(work, "install");

try {
  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  run("npm", ["pack", "--json", "--pack-destination", packDir], root, "npm pack");
  const packJson = run("npm", ["pack", "--json", "--dry-run"], root, "npm pack --dry-run");
  const parsed = JSON.parse(packJson);
  const entry = parsed[0];
  if (!entry || entry.version !== EXPECTED_VERSION) throw new Error("npm pack metadata did not report expected version");

  const paths = new Set((entry.files ?? []).map((file) => file.path));
  const required = [
    "package.json",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "RELEASE_NOTES_v0.2.0.md",
    "dist/cli.js",
    "dist/sdk.js",
    "dist/sdk.d.ts",
    "examples/adapters/custom-indexer.mjs",
    "examples/adapters/custom-indexer.ts",
    "examples/generic-adapter.example.json",
    "examples/polymarket-pilot.json",
    "examples/goldsky-euler-mainnet-pilot.json",
    "examples/generic-evm-log.example.json",
    "schemas/indexercheck-report-v1.schema.json",
  ];
  for (const path of required) {
    if (!paths.has(path)) throw new Error(`packed tarball missing required file: ${path}`);
  }

  const forbiddenPrefixes = ["src/", "dist/tests/", "docs/"];
  for (const path of paths) {
    if (forbiddenPrefixes.some((prefix) => path.startsWith(prefix))) {
      throw new Error(`packed tarball unexpectedly includes development path: ${path}`);
    }
    if (path.startsWith("dist/scripts/milestone-")) {
      throw new Error(`packed tarball unexpectedly includes milestone script: ${path}`);
    }
  }

  const tarball = join(packDir, entry.filename);
  run("npm", ["init", "-y"], installDir, "npm init");
  run("npm", ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], installDir, "tarball install");

  const help = run("npx", ["--no-install", "indexercheck", "--help"], installDir, "installed CLI --help");
  if (!help.includes("Usage:") || !help.includes("indexercheck verify")) {
    throw new Error("installed CLI --help output is incomplete");
  }

  const version = run("npx", ["--no-install", "indexercheck", "--version"], installDir, "installed CLI --version").trim();
  if (version !== EXPECTED_VERSION) throw new Error(`installed CLI version ${version} != ${EXPECTED_VERSION}`);

  const shortVersion = run("npx", ["--no-install", "indexercheck", "-v"], installDir, "installed CLI -v").trim();
  if (shortVersion !== EXPECTED_VERSION) throw new Error(`installed CLI short version ${shortVersion} != ${EXPECTED_VERSION}`);

  run("node", ["--input-type=module", "-e", "import { defineIndexerAdapter } from 'indexercheck/sdk'; const a=defineIndexerAdapter({create(){return {getHead(){return {blockNumber:1}}}}}); if(a.__indexercheckAdapter!==true) process.exit(9);"], installDir, "installed SDK import");

  const consumerAdapter = join(installDir, "consumer-adapter.mjs");
  await writeFile(consumerAdapter, `import { defineIndexerAdapter } from "indexercheck/sdk";\nexport default defineIndexerAdapter({ name: "external-consumer", async create(){ return { async getHead(){ return { blockNumber: 4242 }; } }; } });\n`);
  run("node", ["--input-type=module", "-e", `const m=await import(${JSON.stringify("./consumer-adapter.mjs")}); const c=await m.default.create({options:{}}); const h=await c.getHead(); if(h.blockNumber!==4242) process.exit(10);`], installDir, "external consumer adapter");

  console.log(`Package smoke: npm pack contains ${entry.files.length} file(s), ${entry.size} byte tarball PASS`);
  console.log("Package smoke: development-only src/tests/milestone files excluded PASS");
  console.log("Package smoke: clean tarball install PASS");
  console.log(`Package smoke: npx indexercheck --help + --version/-v (${EXPECTED_VERSION}) PASS`);
  console.log("Package smoke: installed indexercheck/sdk export + defineIndexerAdapter import PASS");
  console.log("Package smoke: external consumer adapter executes against the installed SDK PASS");
} finally {
  await rm(work, { recursive: true, force: true });
}
