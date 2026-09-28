import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
test("M0.9 CLI watch deduplicates unchanged incident webhook across iterations", async () => {
    const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
    const config = `${examples}/contract-upgrade-incident.json`;
    const statePath = resolve(`./.m0.9-watch-cli-state-${process.pid}.json`);
    const capturePath = resolve(`./.m0.9-watch-cli-capture-${process.pid}.json`);
    const serverScript = `
    const http = require("node:http");
    const fs = require("node:fs");
    const capture = process.argv[1];
    let count = 0;
    const events = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        count++;
        const body = Buffer.concat(chunks).toString("utf8");
        events.push(JSON.parse(body).event);
        fs.writeFileSync(capture, JSON.stringify({ count, events }));
        res.statusCode = 202;
        res.end("ok");
      });
    });
    server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
  `;
    const child = spawn(process.execPath, ["-e", serverScript, capturePath], { stdio: ["ignore", "pipe", "pipe"] });
    try {
        const port = await new Promise((resolvePort, rejectPort) => {
            let buffer = "";
            child.stdout.on("data", (chunk) => {
                buffer += String(chunk);
                const end = buffer.indexOf("\n");
                if (end >= 0)
                    resolvePort(Number(buffer.slice(0, end)));
            });
            child.on("error", rejectPort);
        });
        const run = spawnSync(process.execPath, [
            cli, "watch", "--config", config,
            "--interval", "10ms",
            "--max-iterations", "2",
            "--state", statePath,
            "--webhook", `http://127.0.0.1:${port}`,
            "--webhook-retries", "0",
            "--json-lines",
        ], { encoding: "utf8" });
        assert.equal(run.status, 0);
        assert.equal(run.stderr, "");
        const lines = run.stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
        assert.equal(lines.length, 2);
        assert.equal(lines[0].lifecycle.length, 1);
        assert.equal(lines[0].lifecycle[0].event, "indexercheck.incident.detected");
        assert.equal(lines[1].lifecycle.length, 0);
        for (let i = 0; i < 50; i += 1) {
            try {
                const capture = JSON.parse(await readFile(capturePath, "utf8"));
                assert.equal(capture.count, 1);
                assert.deepEqual(capture.events, ["indexercheck.incident.detected"]);
                return;
            }
            catch (error) {
                if (i === 49)
                    throw error;
                await new Promise((resolveWait) => setTimeout(resolveWait, 10));
            }
        }
    }
    finally {
        try {
            child.kill();
        }
        catch { }
        for (const path of [statePath, capturePath]) {
            try {
                await unlink(path);
            }
            catch { }
        }
    }
});
test("M0.9 CLI retries pending lifecycle event on the next tick with the same eventId", async () => {
    const cli = fileURLToPath(new URL("../cli.js", import.meta.url));
    const config = `${examples}/graph-cctp-incident.json`;
    const statePath = resolve(`./.m0.9-watch-retry-state-${process.pid}.json`);
    const capturePath = resolve(`./.m0.9-watch-retry-capture-${process.pid}.json`);
    const serverScript = `
    const http = require("node:http");
    const fs = require("node:fs");
    const capture = process.argv[1];
    let count = 0;
    const eventIds = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        count++;
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        eventIds.push(body.eventId);
        fs.writeFileSync(capture, JSON.stringify({ count, eventIds }));
        if (count === 1) { res.statusCode = 503; res.end("down"); return; }
        res.statusCode = 202; res.end("ok");
      });
    });
    server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
  `;
    const child = spawn(process.execPath, ["-e", serverScript, capturePath], { stdio: ["ignore", "pipe", "pipe"] });
    try {
        const port = await new Promise((resolvePort, rejectPort) => {
            let buffer = "";
            child.stdout.on("data", (chunk) => {
                buffer += String(chunk);
                const end = buffer.indexOf("\n");
                if (end >= 0)
                    resolvePort(Number(buffer.slice(0, end)));
            });
            child.on("error", rejectPort);
        });
        const run = spawnSync(process.execPath, [
            cli, "watch", "--config", config,
            "--interval", "10ms",
            "--max-iterations", "2",
            "--state", statePath,
            "--webhook", `http://127.0.0.1:${port}`,
            "--webhook-retries", "0",
            "--json-lines",
        ], { encoding: "utf8" });
        assert.equal(run.status, 0);
        const capture = JSON.parse(await readFile(capturePath, "utf8"));
        assert.equal(capture.count, 2);
        assert.equal(capture.eventIds[0], capture.eventIds[1]);
        const state = JSON.parse(await readFile(statePath, "utf8"));
        assert.equal(Object.keys(state.pendingEvents ?? {}).length, 0);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
        for (const path of [statePath, capturePath]) {
            try {
                await unlink(path);
            }
            catch { }
        }
    }
});
//# sourceMappingURL=watch-cli.test.js.map