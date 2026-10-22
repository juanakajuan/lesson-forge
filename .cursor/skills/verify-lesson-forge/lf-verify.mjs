#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, writeSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const USAGE = `lf-verify.mjs — drive lesson-forge for one isolated run

Set LF_VERIFY_HOME to a new directory whose path contains lesson-forge-verify.
Run every command from the repository root.

  lf-verify.mjs doctor
  lf-verify.mjs check [lesson.json]
  lf-verify.mjs render <lesson.json>
  lf-verify.mjs site <dir...>
  lf-verify.mjs serve [--page <file.html>]
  lf-verify.mjs browser click --role <role> --name <name> [--last]
  lf-verify.mjs browser fill --role <textbox|slider> --name <name> --value <text> [--last]
  lf-verify.mjs browser snapshot --aria --path <file>
  lf-verify.mjs browser screenshot --path <file>
  lf-verify.mjs browser reload
  lf-verify.mjs cleanup

--last picks the last match in page order when an earlier block has the same
name. doctor and browser talk to the instance this run started. cleanup deletes
LF_VERIFY_HOME only. It does not delete verify-evidence/.
`;

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function homePath() {
  const home = process.env.LF_VERIFY_HOME;
  if (!home) {
    fail("LF_VERIFY_HOME is unset. Use a new directory whose path contains lesson-forge-verify.");
    return null;
  }
  const resolved = resolve(home);
  if (resolved === "/" || resolved === repoRoot || repoRoot.startsWith(resolved + "/")) {
    fail(`Refusing LF_VERIFY_HOME ${resolved}.`);
    return null;
  }
  if (!resolved.includes("lesson-forge-verify")) {
    fail("LF_VERIFY_HOME must contain lesson-forge-verify.");
    return null;
  }
  return resolved;
}

function statePath(home) {
  return join(home, "state.json");
}

async function readState(home) {
  try {
    return JSON.parse(await readFile(statePath(home), "utf8"));
  } catch {
    return null;
  }
}

async function writeState(home, state) {
  const path = statePath(home);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, path);
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function toolchain() {
  const major = Number(process.versions.node.split(".")[0]);
  const chromium = (process.env.PATH ?? "")
    .split(":")
    .map((dir) => join(dir, "chromium"))
    .find((candidate) => existsSync(candidate));
  const chosen = process.env.LF_CHROMIUM || chromium || null;
  const problems = [];
  if (major < 24) problems.push(`node ${process.versions.node} is older than 24`);
  if (!chosen || !existsSync(chosen)) problems.push("chromium is not on PATH");
  if (!existsSync(join(repoRoot, "src/cli.ts"))) problems.push("src/cli.ts is missing");
  if (!existsSync(join(repoRoot, "node_modules/esbuild"))) problems.push("run npm install");
  return {
    ok: problems.length === 0,
    node: `v${process.versions.node}`,
    chromium: chosen,
    problems,
  };
}

function parseFlags(args) {
  const flags = new Map();
  const positionals = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) flags.set(key, "true");
      else {
        flags.set(key, next);
        i++;
      }
    } else positionals.push(arg);
  }
  return { flags, positionals };
}

function runCli(args) {
  return new Promise((resolvePromise) => {
    const command = [process.execPath, join(repoRoot, "src/cli.ts"), ...args];
    const child = spawn(command[0], command.slice(1), { cwd: repoRoot });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      console.log(`command: node src/cli.ts ${args.join(" ")}`);
      console.log(`exit: ${code ?? 1}`);
      console.log("--- stderr ---");
      process.stdout.write(stderr);
      if (stderr && !stderr.endsWith("\n")) console.log();
      console.log("--- stdout ---");
      process.stdout.write(stdout);
      if (stdout && !stdout.endsWith("\n")) console.log();
      resolvePromise(code ?? 1);
    });
  });
}

async function doctor() {
  const tools = toolchain();
  console.log(`toolchain: ${tools.ok ? "ok" : "fail"}`);
  console.log(`node: ${tools.node}`);
  console.log(`chromium: ${tools.chromium ?? "missing"}`);
  for (const problem of tools.problems) console.log(`problem: ${problem}`);
  const home = process.env.LF_VERIFY_HOME ? resolve(process.env.LF_VERIFY_HOME) : null;
  console.log(`home: ${home ?? "unset"}`);
  if (!tools.ok) {
    process.exitCode = 1;
    return;
  }
  if (!home) {
    console.log("instance: none");
    return;
  }
  if (!home.includes("lesson-forge-verify")) {
    fail("LF_VERIFY_HOME must contain lesson-forge-verify.");
    return;
  }
  const state = await readState(home);
  if (!state) {
    console.log("instance: none");
    return;
  }
  const serverUp = alive(state.serverPid);
  const chromeUp = alive(state.chromePid);
  if (!serverUp || !chromeUp) {
    console.log("instance: dead");
    console.log(`url: ${state.url}`);
    fail("The saved instance is not running. Run cleanup, then start a new home.");
    return;
  }
  let header = "";
  let status = 0;
  try {
    const response = await fetch(state.url);
    status = response.status;
    header = response.headers.get("x-lesson-forge-verify") ?? "";
  } catch (err) {
    console.log("instance: dead");
    fail(err instanceof Error ? err.message : String(err));
    return;
  }
  if (status !== 200 || header !== "1") {
    console.log("instance: foreign");
    fail(`GET ${state.url} returned ${status} with verify header "${header}".`);
    return;
  }
  const title = await withPage(state, async (cdp) => evaluate(cdp, `document.querySelector("#app h1")?.textContent ?? ""`));
  if (title !== state.title) {
    console.log("instance: unexpected");
    fail(`Page title is "${title}". This run opened "${state.title}".`);
    return;
  }
  console.log("instance: up");
  console.log(`url: ${state.url}`);
  console.log(`serverPid: ${state.serverPid}`);
  console.log(`chromePid: ${state.chromePid}`);
  console.log(`title: ${title}`);
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function startStatic(outDir) {
  const root = resolve(outDir);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      if (pathname.includes("\0") || pathname.split("/").includes("..")) {
        res.writeHead(403, { "X-Lesson-Forge-Verify": "1" });
        res.end();
        return;
      }
      const file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(root + "/")) {
        res.writeHead(403, { "X-Lesson-Forge-Verify": "1" });
        res.end();
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store", "X-Lesson-Forge-Verify": "1" });
      res.end(body);
    } catch {
      res.writeHead(404, { "X-Lesson-Forge-Verify": "1" });
      res.end();
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("static server has no port"));
        return;
      }
      resolvePromise({ server, port: address.port });
    });
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function launchChrome(profile, url) {
  const chromium = process.env.LF_CHROMIUM || toolchain().chromium;
  if (!chromium) throw new Error("chromium is not on PATH");
  const child = spawn(
    chromium,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-dev-shm-usage",
      "--remote-allow-origins=*",
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--window-size=1280,1400",
      url,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  const append = (chunk) => {
    log += chunk.toString();
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const started = Date.now();
  let debugPort = 0;
  while (Date.now() - started < 10000) {
    const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log);
    if (match) {
      debugPort = Number(match[1]);
      break;
    }
    try {
      const active = await readFile(join(profile, "DevToolsActivePort"), "utf8");
      const port = Number(active.split("\n")[0]);
      if (Number.isInteger(port) && port > 0) {
        debugPort = port;
        break;
      }
    } catch {
      /* file appears after startup */
    }
    if (child.exitCode !== null) throw new Error(`chromium exited ${child.exitCode}\n${log}`);
    await sleep(100);
  }
  if (!debugPort) {
    child.kill("SIGTERM");
    throw new Error(`chromium did not open a debug port\n${log}`);
  }
  return { child, debugPort };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      void this.onMessage(event);
    });
    ws.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("devtools connection closed"));
      this.pending.clear();
    });
  }

  async onMessage(event) {
    try {
      let raw;
      if (typeof event.data === "string") raw = event.data;
      else if (typeof event.data?.text === "function") raw = await event.data.text();
      else raw = String(event.data);
      const message = JSON.parse(raw);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve: done, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message ?? "cdp error"}`));
      else done(message.result ?? {});
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  }

  send(method, params = {}) {
    const id = this.next++;
    return new Promise((done, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, 10000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          done(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

function connect(url) {
  return new Promise((done, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => done(ws));
    ws.addEventListener("error", () => reject(new Error(`devtools websocket failed for ${url}`)));
  });
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function connectPage(state) {
  const pages = await getJson(`http://127.0.0.1:${state.chromePort}/json/list`);
  const page = pages.find((item) => item.id === state.targetId && item.webSocketDebuggerUrl);
  if (!page) throw new Error("the lesson page is not open");
  const ws = await connect(page.webSocketDebuggerUrl);
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 1400,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return { ws, cdp };
}

async function withPage(state, fn) {
  const { ws, cdp } = await connectPage(state);
  try {
    return await fn(cdp);
  } finally {
    ws.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "page script failed");
  }
  return result.result?.value;
}

const FINDER = `function norm(s){return String(s??"").replace(/\\s+/g," ").trim()}
function roleOf(el){
  const explicit=el.getAttribute("role");
  if(explicit) return explicit;
  const tag=el.tagName;
  if(tag==="BUTTON") return "button";
  if(tag==="A") return "link";
  if(tag==="H1"||tag==="H2"||tag==="H3") return "heading";
  if(tag==="INPUT"){
    const type=(el.getAttribute("type")||"text").toLowerCase();
    if(type==="radio") return "radio";
    if(type==="range") return "slider";
    if(type==="text"||type==="search") return "textbox";
  }
  return tag.toLowerCase();
}
function accName(el){
  const labelled=el.getAttribute("aria-label");
  if(labelled) return norm(labelled);
  if(el.tagName==="INPUT" && (el.getAttribute("type")||"") === "radio"){
    const label=el.closest("label");
    return norm(label?label.innerText:"");
  }
  return norm(el.innerText||el.textContent||"");
}
function candidates(role){
  return [...document.querySelectorAll("h1,h2,h3,button,a,input,[role]")].filter((el)=>roleOf(el)===role);
}`;

async function waitForTitle(cdp) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const title = await evaluate(cdp, `document.querySelector("#app h1")?.textContent ?? ""`);
    if (typeof title === "string" && title.trim() !== "") return title;
    await sleep(100);
  }
  throw new Error("the page did not show a lesson heading");
}

async function pickPage(outDir, requested) {
  const names = (await readdir(outDir)).filter((name) => name.endsWith(".html")).sort();
  if (requested) {
    if (!names.includes(requested)) throw new Error(`page ${requested} is not in ${outDir}. html: ${names.join(", ") || "(none)"}`);
    return requested;
  }
  if (names.length === 1) return names[0];
  if (names.includes("index.html")) return "index.html";
  throw new Error(`pass --page. html: ${names.join(", ") || "(none)"}`);
}

async function serve(flags) {
  const home = homePath();
  if (!home) return;
  await mkdir(home, { recursive: true });
  const existing = await readState(home);
  if (existing && alive(existing.serverPid)) {
    fail(`instance already up at ${existing.url}. Use another LF_VERIFY_HOME for a second run.`);
    return;
  }
  const outDir = join(home, "out");
  await mkdir(outDir, { recursive: true });
  const page = await pickPage(outDir, flags.get("page"));
  const { server, port } = await startStatic(outDir);
  const url = `http://127.0.0.1:${port}/${page}`;
  const profile = join(home, "chrome");
  let child;
  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child?.kill("SIGTERM");
    server.close();
  };
  let debugPort;
  try {
    const launched = await launchChrome(profile, url);
    child = launched.child;
    debugPort = launched.debugPort;
  } catch (err) {
    stop();
    throw err;
  }
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`chromium exited ${code ?? 1}`);
      process.exit(1);
    }
  });
  const started = Date.now();
  let targetId = "";
  while (Date.now() - started < 10000) {
    try {
      const pages = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
      const match = pages.find((item) => item.type === "page" && typeof item.url === "string" && item.url.startsWith(url));
      if (match) {
        targetId = match.id;
        break;
      }
    } catch {
      /* chrome is still opening the port */
    }
    await sleep(100);
  }
  if (!targetId) {
    stop();
    throw new Error("chromium did not open the lesson page");
  }
  const state = {
    home,
    outDir,
    url,
    page,
    port,
    chromePort: debugPort,
    serverPid: process.pid,
    chromePid: child.pid,
    targetId,
    title: "",
  };
  try {
    const title = await withPage(state, async (cdp) => {
      await cdp.send("Page.reload", { ignoreCache: true });
      return waitForTitle(cdp);
    });
    state.title = title;
    await writeState(home, state);
  } catch (err) {
    stop();
    throw err;
  }
  writeSync(1, `ready ${state.url}\n`);
  await new Promise(() => {});
}

async function browser(args) {
  const home = homePath();
  if (!home) return;
  const state = await readState(home);
  if (!state || !alive(state.serverPid) || !alive(state.chromePid)) {
    fail("No live instance. Run serve in this LF_VERIFY_HOME first.");
    return;
  }
  const { flags, positionals } = parseFlags(args);
  const action = positionals[0];
  if (action === "reload") {
    const title = await withPage(state, async (cdp) => {
      await evaluate(cdp, "window.__lfVerifyStale = true");
      await cdp.send("Page.reload", { ignoreCache: true });
      const started = Date.now();
      while (Date.now() - started < 15000) {
        const stale = await evaluate(cdp, "window.__lfVerifyStale === true").catch(() => true);
        if (stale === false) return waitForTitle(cdp);
        await sleep(50);
      }
      throw new Error("the page did not reload");
    });
    if (title !== state.title) {
      fail(`Page title is "${title}" after reload. This run opened "${state.title}".`);
      return;
    }
    console.log(`reloaded ${state.url}`);
    return;
  }
  if (action === "snapshot") {
    if (flags.get("aria") !== "true" || !flags.get("path")) {
      fail("Use browser snapshot --aria --path <file>.");
      return;
    }
    const text = await withPage(state, (cdp) => evaluate(cdp, snapshotExpression()));
    await writeProof(flags.get("path"), text.endsWith("\n") ? text : `${text}\n`);
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    return;
  }
  if (action === "screenshot") {
    const path = flags.get("path");
    if (!path) {
      fail("Use browser screenshot --path <file>.");
      return;
    }
    const data = await withPage(state, async (cdp) => {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      return shot.data;
    });
    await writeProof(path, Buffer.from(data, "base64"));
    console.log(`wrote ${resolve(path)}`);
    return;
  }
  if (action === "click" || action === "fill") {
    const role = flags.get("role");
    const name = flags.get("name");
    if (!role || !name) {
      fail(`Use browser ${action} --role <role> --name <name>.`);
      return;
    }
    const value = flags.get("value");
    if (action === "fill" && value === undefined) {
      fail("Use browser fill --role <textbox|slider> --name <name> --value <text>.");
      return;
    }
    const last = flags.get("last") === "true";
    const result = await withPage(state, (cdp) =>
      evaluate(cdp, action === "click" ? clickExpression(role, name, last) : fillExpression(role, name, value, last)),
    );
    if (!result?.ok) {
      fail(result?.message ?? "the page action failed");
      return;
    }
    console.log(result.message);
    return;
  }
  fail(USAGE);
}

function snapshotExpression() {
  return `(() => {
${FINDER}
const lines=[];
for (const el of document.querySelectorAll("h1,h2,h3,button,a,input,[role=status],[role=progressbar]")) {
  const role=roleOf(el);
  const name=accName(el);
  if (!name) continue;
  lines.push(role + ' "' + name.replaceAll('\\\\','\\\\\\\\').replaceAll('"','\\\\"') + '"');
}
for (const row of document.querySelectorAll(".mastery-row")) {
  const [badge, text] = [...row.children].map((el) => norm(el.textContent));
  lines.push('mastery "' + badge + ': ' + String(text ?? "").replaceAll('"','\\"') + '"');
}
for (const block of document.querySelectorAll(".block")) {
  lines.push('block "' + norm(block.innerText).slice(0, 240).replaceAll('"','\\\\"') + '"');
}
return lines.join("\\n");
})()`;
}

function clickExpression(role, name, last) {
  return `(() => {
${FINDER}
const role=${JSON.stringify(role)};
const name=${JSON.stringify(name)};
const matches=candidates(role).filter((el)=>accName(el)===name);
const hits=${last ? "matches.slice(-1)" : "matches"};
if (hits.length!==1) {
  const found=candidates(role).map((el)=>accName(el)).filter(Boolean);
  return {ok:false, message:"expected one "+role+" named "+JSON.stringify(name)+". found: "+found.join(" | ")};
}
const el=hits[0];
if (el.disabled || el.getAttribute("aria-disabled")==="true") return {ok:false, message:role+" "+JSON.stringify(name)+" is disabled"};
el.scrollIntoView({block:"center", behavior:"instant"});
el.click();
return {ok:true, message:"clicked "+role+" "+JSON.stringify(name)};
})()`;
}

function fillExpression(role, name, value, last) {
  return `(() => {
${FINDER}
const role=${JSON.stringify(role)};
const name=${JSON.stringify(name)};
const value=${JSON.stringify(value)};
const matches=candidates(role).filter((el)=>accName(el)===name);
const hits=${last ? "matches.slice(-1)" : "matches"};
if (hits.length!==1) {
  const found=candidates(role).map((el)=>accName(el)).filter(Boolean);
  return {ok:false, message:"expected one "+role+" named "+JSON.stringify(name)+". found: "+found.join(" | ")};
}
const el=hits[0];
el.focus();
el.value=value;
el.dispatchEvent(new Event("input",{bubbles:true}));
el.dispatchEvent(new Event("change",{bubbles:true}));
return {ok:true, message:"filled "+role+" "+JSON.stringify(name)};
})()`;
}

async function writeProof(path, body) {
  const full = resolve(path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, body);
}

async function waitDead(pid) {
  for (let i = 0; i < 30; i++) {
    if (!alive(pid)) return;
    await sleep(100);
  }
}

async function cleanup() {
  const home = homePath();
  if (!home) return;
  const state = await readState(home);
  if (state) {
    if (alive(state.serverPid)) process.kill(state.serverPid, "SIGTERM");
    if (alive(state.chromePid)) process.kill(state.chromePid, "SIGTERM");
    await waitDead(state.serverPid);
    await waitDead(state.chromePid);
    if (alive(state.chromePid)) process.kill(state.chromePid, "SIGKILL");
    if (alive(state.serverPid)) process.kill(state.serverPid, "SIGKILL");
    await waitDead(state.chromePid);
    await waitDead(state.serverPid);
  }
  await rm(home, { recursive: true, force: true });
  console.log(`removed ${home}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (command === "doctor") return doctor();
  if (command === "cleanup") return cleanup();
  if (command === "check") {
    const code = await runCli(rest.length === 0 ? ["check"] : ["check", ...rest]);
    process.exitCode = code;
    return;
  }
  if (command === "render") {
    const home = homePath();
    if (!home) return;
    const lesson = rest[0];
    if (!lesson) {
      fail("Use render <lesson.json>.");
      return;
    }
    const outDir = join(home, "out");
    await mkdir(outDir, { recursive: true });
    const page = `${lesson.split("/").pop()?.replace(/\.json$/, "") ?? "lesson"}.html`;
    const code = await runCli(["render", lesson, "-o", join(outDir, page)]);
    process.exitCode = code;
    return;
  }
  if (command === "site") {
    const home = homePath();
    if (!home) return;
    if (rest.length === 0) {
      fail("Use site <dir...>.");
      return;
    }
    const outDir = join(home, "out");
    await mkdir(outDir, { recursive: true });
    const code = await runCli(["site", ...rest, "-o", outDir]);
    process.exitCode = code;
    return;
  }
  if (command === "serve") return serve(parseFlags(rest).flags);
  if (command === "browser") return browser(rest);
  fail(USAGE);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
