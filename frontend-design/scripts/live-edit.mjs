#!/usr/bin/env node
// Live edit: click an element in a live preview, type an instruction, and any
// coding agent picks it up with `next`, applies it, and reports back with `done`.
// Zero dependencies. Node 18+.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = ".live-edit";
const PREFIX = "/__live-edit";

const USAGE = `live-edit — click-to-instruct preview for any coding agent

  start  [--target <url> | --root <dir>] [--port 4800] [--project <dir>]
           --target  proxy a running dev server (Vite, Next.js, anything)
           --root    serve a static folder (default: project dir) with auto-reload
  next   [--timeout 90] [--json]   wait for the next instruction, print it
  done   <id> [summary]            mark an instruction applied
  fail   <id> <reason>             mark an instruction as not applied
  status                           list all instructions
  stop                             stop the server

Run every command from the project root (or pass --project <dir>).`;

// ---------- args ----------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
const projectDir = path.resolve(args.project || process.cwd());
const stateDir = path.join(projectDir, STATE_DIR);
const serverFile = path.join(stateDir, "server.json");
const requestsFile = path.join(stateDir, "requests.json");

// ---------- CLI (agent side) ----------

function readServer() {
  try {
    return JSON.parse(fs.readFileSync(serverFile, "utf8"));
  } catch {
    console.error(`No live-edit server for ${projectDir}. Start one with: live-edit start`);
    process.exit(1);
  }
}

async function api(method, route, body) {
  const s = readServer();
  const res = await fetch(`http://127.0.0.1:${s.port}${PREFIX}/api${route}`, {
    method,
    headers: { "content-type": "application/json", "x-live-edit-token": s.token },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    console.error(`Live-edit server on port ${s.port} is not responding. Restart it with: live-edit start`);
    process.exit(1);
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    console.error(data.error || `HTTP ${res.status}`);
    process.exit(1);
  }
  return data;
}

function formatRequest(r) {
  const src = r.source?.file
    ? `${r.source.file}${r.source.line ? ":" + r.source.line : ""}${r.source.exact ? "" : "  (approximate)"}`
    : "unknown — search the codebase using the selector, text and HTML below";
  const lines = [
    `LIVE EDIT REQUEST ${r.id}`,
    ``,
    `Instruction: ${r.instruction}`,
    ``,
    `Source:      ${src}`,
  ];
  if (r.components?.length) {
    const comps = r.components.map((c) => (c.file ? `${c.name} (${c.file}${c.line ? ":" + c.line : ""})` : c.name));
    lines.push(`Rendered by: ${comps.join("\n             < ")}`);
  }
  lines.push(
    `Page:        ${r.page}`,
    `Selector:    ${r.selector}`,
    `Element:     <${r.tag}>${r.text ? `  text: "${r.text}"` : ""}`,
  );
  if (r.theme) lines.push(`Theme:       ${r.theme}`);
  if (r.styles) lines.push(`Styles:      ${Object.entries(r.styles).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
  lines.push(``, `HTML:`, r.html, ``);
  lines.push(
    `Scope: change only the code that renders this element to satisfy the instruction.`,
    `Do not touch anything else. Then run:  live-edit done ${r.id} "<one-line summary>"`,
    `If you cannot apply it, run:           live-edit fail ${r.id} "<reason>"`,
  );
  return lines.join("\n");
}

async function cliNext() {
  const timeout = Number(args.timeout ?? 90);
  const r = await api("GET", `/next?timeout=${timeout}`);
  if (!r) {
    console.log(`No new instruction in ${timeout}s. Run \`live-edit next\` again to keep waiting.`);
    process.exit(3);
  }
  console.log(args.json ? JSON.stringify(r, null, 2) : formatRequest(r));
}

async function cliStatus() {
  const list = await api("GET", "/requests");
  if (!list.length) return console.log("No instructions yet.");
  for (const r of list) {
    const note = r.note ? `  — ${r.note}` : "";
    console.log(`${r.id}  ${r.status.padEnd(7)}  ${r.instruction.slice(0, 70)}${note}`);
  }
}

// ---------- server ----------

function loadRequests() {
  try {
    const list = JSON.parse(fs.readFileSync(requestsFile, "utf8"));
    // Anything claimed by an agent that died goes back in the queue.
    for (const r of list) if (r.status === "working") r.status = "queued";
    return list;
  } catch {
    return [];
  }
}

async function startServer() {
  const port = Number(args.port || 4800);
  const target = args.target ? new URL(args.target) : null;
  const root = target ? null : path.resolve(projectDir, args.root || ".");
  const token = crypto.randomBytes(16).toString("hex");
  const requests = loadRequests();
  const waiters = new Set(); // pending `next` long-polls
  const clients = new Set(); // SSE connections from overlays

  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, ".gitignore"), "*\n");
  const persist = () => fs.writeFileSync(requestsFile, JSON.stringify(requests, null, 2));

  const broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };
  const publicList = () =>
    requests.map(({ id, status, instruction, note, selector }) => ({ id, status, instruction, note, selector }));
  const changed = () => { persist(); broadcast("requests", publicList()); };

  const claimNext = () => {
    const r = requests.find((x) => x.status === "queued");
    if (!r) return null;
    r.status = "working";
    changed();
    return r;
  };
  const wakeWaiter = () => {
    for (const w of waiters) {
      const r = claimNext();
      if (!r) return;
      waiters.delete(w);
      w(r);
    }
  };

  const overlaySrc = () =>
    fs.readFileSync(path.join(HERE, "overlay.js"), "utf8").replace("__LIVE_EDIT_PREFIX__", PREFIX);

  const origin = `http://localhost:${port}`;
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

  const sendJson = (res, code, data) => {
    res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > 1_000_000) { reject(new Error("body too large")); req.destroy(); }
        else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  async function handleApi(req, res, url) {
    const route = url.pathname.slice(PREFIX.length + 4); // strip "/api"
    const fromAgent = req.headers["x-live-edit-token"] === token;
    // Browser calls must come from the preview's own origin, so other sites
    // open in the same browser cannot queue instructions for the agent.
    const fromOverlay = !fromAgent && [origin, `http://127.0.0.1:${port}`].includes(req.headers.origin);

    if (req.method === "POST" && route === "/requests") {
      if (!fromOverlay && !fromAgent) return sendJson(res, 403, { error: "forbidden" });
      const body = JSON.parse(await readBody(req));
      if (!body.instruction?.trim()) return sendJson(res, 400, { error: "instruction is required" });
      if (body.source?.file) body.source.file = normalizeFile(body.source.file);
      for (const c of body.components || []) if (c.file) c.file = normalizeFile(c.file);
      const r = {
        ...body,
        instruction: body.instruction.trim(),
        id: "le-" + crypto.randomBytes(3).toString("hex"),
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      requests.push(r);
      changed();
      wakeWaiter();
      return sendJson(res, 201, { id: r.id });
    }

    if (req.method === "GET" && route === "/requests") {
      if (!fromOverlay && !fromAgent && req.headers.origin) return sendJson(res, 403, { error: "forbidden" });
      return sendJson(res, 200, fromAgent ? requests : publicList());
    }

    if (req.method === "POST" && route === "/resolve") {
      if (!fromOverlay && !fromAgent) return sendJson(res, 403, { error: "forbidden" });
      const info = JSON.parse(await readBody(req));
      const one = async (loc) => {
        if (!loc?.frames) return loc?.file ? { ...loc, file: normalizeFile(loc.file) } : loc;
        const { frames, ...rest } = loc;
        for (const frame of frames) {
          const mapped = await resolveFrame(frame).catch(() => null);
          if (!mapped) continue;
          const file = normalizeFile(mapped.file);
          if (/(^|\/)node_modules\/|^\/?(webpack|turbopack)\//.test(file)) continue; // library internals
          return { ...rest, file, line: mapped.line, exact: true, via: rest.via + " + source map" };
        }
        // No map: Turbopack still names the module in ?id=[project]/path; else use the URL path.
        const url = frames[0].url;
        const id = /[?&]id=([^&]+)/.exec(url);
        const guess = id ? decodeURIComponent(decodeURIComponent(id[1])).split(/[+ ]/)[0] : url.replace(/^(about|rsc):\/\/React\/Server\//, "");
        return { ...rest, file: normalizeFile(guess), exact: false };
      };
      return sendJson(res, 200, {
        source: await one(info.source),
        components: await Promise.all((info.components || []).map(one)),
      });
    }

    if (!fromAgent) return sendJson(res, 403, { error: "agent token required" });

    if (req.method === "GET" && route === "/next") {
      const r = claimNext();
      if (r) return sendJson(res, 200, r);
      const timeoutMs = Math.max(0, Number(url.searchParams.get("timeout") || 90)) * 1000;
      let timer;
      const waiter = (found) => { clearTimeout(timer); sendJson(res, 200, found); };
      waiters.add(waiter);
      timer = setTimeout(() => { waiters.delete(waiter); res.writeHead(204).end(); }, timeoutMs);
      // Agent gave up (killed/timed out on its side): don't hand it a request.
      res.on("close", () => { clearTimeout(timer); waiters.delete(waiter); });
      return;
    }

    const m = route.match(/^\/requests\/([\w-]+)\/(done|fail|requeue)$/);
    if (req.method === "POST" && m) {
      const r = requests.find((x) => x.id === m[1]);
      if (!r) return sendJson(res, 404, { error: `no request ${m[1]}` });
      const body = JSON.parse((await readBody(req)) || "{}");
      r.status = { done: "done", fail: "failed", requeue: "queued" }[m[2]];
      r.note = body.note || "";
      r.updatedAt = new Date().toISOString();
      changed();
      if (m[2] === "requeue") wakeWaiter();
      return sendJson(res, 200, { id: r.id, status: r.status });
    }

    if (req.method === "POST" && route === "/stop") {
      sendJson(res, 200, { ok: true });
      setTimeout(shutdown, 50);
      return;
    }

    sendJson(res, 404, { error: "unknown route" });
  }

  function handleEvents(req, res) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write(`event: requests\ndata: ${JSON.stringify(publicList())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
  }

  const injectTag = `<script src="${PREFIX}/overlay.js" defer></script>`;
  function injectOverlay(html) {
    if (html.includes(injectTag)) return html;
    const m = html.match(/<\/head\s*>/i) || html.match(/<body[^>]*>/i);
    if (!m) return injectTag + html;
    const at = m[0].startsWith("</") ? m.index : m.index + m[0].length;
    return html.slice(0, at) + injectTag + html.slice(at);
  }

  // ----- static mode -----

  const MIME = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
    ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain; charset=utf-8",
  };

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    let file = path.join(root, rel);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    } catch {}
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    if (!fs.existsSync(file)) return res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    if (ext === ".html" || ext === ".htm") {
      const relFile = path.relative(projectDir, file).split(path.sep).join("/");
      const html = annotateHtml(fs.readFileSync(file, "utf8"), relFile);
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return res.end(injectOverlay(html));
    }
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  }

  // ----- proxy mode -----

  function proxy(req, res) {
    const headers = { ...req.headers, host: target.host, "accept-encoding": "identity" };
    delete headers["x-live-edit-token"];
    if (headers.origin) headers.origin = target.origin;
    if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin);
    const upstream = http.request(
      { hostname: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers },
      (up) => {
        const h = { ...up.headers };
        if (h.location) h.location = h.location.replace(target.origin, origin);
        const isHtml = (h["content-type"] || "").includes("text/html");
        if (!isHtml) {
          res.writeHead(up.statusCode, h);
          return up.pipe(res);
        }
        const chunks = [];
        up.on("data", (c) => chunks.push(c));
        up.on("end", () => {
          delete h["content-length"];
          delete h["content-encoding"];
          delete h["content-security-policy"];
          res.writeHead(up.statusCode, h);
          res.end(injectOverlay(Buffer.concat(chunks).toString("utf8")));
        });
      },
    );
    upstream.on("error", () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
      res.end(injectOverlay(`<!doctype html><title>Dev server down</title><body style="font:15px system-ui;padding:40px">
        <h1 style="font-size:18px">Can't reach ${target.origin}</h1><p>Start your dev server, then reload.</p></body>`));
    });
    req.pipe(upstream);
  }

  // HMR websockets (Vite, Next.js, webpack) pass straight through.
  function proxyUpgrade(req, socket, head) {
    const headers = { ...req.headers, host: target.host };
    if (headers.origin) headers.origin = target.origin;
    const upstream = http.request({
      hostname: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers,
    });
    upstream.on("upgrade", (upRes, upSocket, upHead) => {
      const lines = [`HTTP/1.1 ${upRes.statusCode} ${upRes.statusMessage}`];
      for (let i = 0; i < upRes.rawHeaders.length; i += 2) lines.push(`${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      if (upHead?.length) socket.write(upHead);
      if (head?.length) upSocket.write(head);
      upSocket.pipe(socket).pipe(upSocket);
      upSocket.on("error", () => socket.destroy());
      socket.on("error", () => upSocket.destroy());
    });
    upstream.on("response", (r) => {
      socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\n\r\n`);
    });
    upstream.on("error", () => socket.destroy());
    upstream.end();
  }

  // ----- source maps -----
  // A stack frame points at served/compiled code; follow its source map back
  // to the original file and line. Handles Vite modules (inline maps), Turbopack
  // chunks (sectioned maps) and Next.js server chunks read from disk.

  async function readResource(url) {
    const clean = url.replace(/^(about|rsc):\/\/React\/Server\//, "");
    if (clean.startsWith("file://")) {
      let file = fileURLToPath(clean.replace(/[?#].*$/, ""));
      // Next.js double-encodes chunk names ("%255Broot…" → "[root…").
      if (!fs.existsSync(file)) file = decodeURIComponent(file);
      if (!file.startsWith(projectDir + path.sep)) return null; // never read outside the project
      return { text: fs.readFileSync(file, "utf8"), base: pathToFileURL(file).href };
    }
    if (/^https?:/.test(clean)) {
      const u = new URL(clean);
      if (!target) {
        const file = path.join(root, decodeURIComponent(u.pathname));
        if (!file.startsWith(root)) return null;
        return { text: fs.readFileSync(file, "utf8"), base: clean };
      }
      const res = await fetch(target.origin + u.pathname + u.search);
      return res.ok ? { text: await res.text(), base: clean } : null;
    }
    return null;
  }

  async function resolveFrame({ url, line, col }) {
    const script = await readResource(url);
    if (!script) return null;
    const refs = [...script.text.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)/g)];
    if (!refs.length) return null;
    const ref = refs[refs.length - 1][1];
    let map, mapBase = script.base;
    if (ref.startsWith("data:")) {
      const comma = ref.indexOf(",");
      const data = ref.slice(comma + 1);
      map = JSON.parse(ref.slice(0, comma).includes("base64") ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data));
    } else {
      mapBase = new URL(ref, script.base).href;
      const m = await readResource(mapBase);
      if (!m) return null;
      map = JSON.parse(m.text);
    }
    // Turbopack server frames (…chunk.js?id=[project]/app/page.tsx…) number lines
    // within that module's section, not the whole chunk.
    const id = /[?&]id=([^&?]+)/.exec(url);
    if (id && map.sections) {
      const modulePath = decodeURIComponent(decodeURIComponent(id[1])).split(/[+ ]/)[0].replace(/^\[project\]\//, "");
      const sec = map.sections.find((s) => s.map?.sources?.some((x) => x.endsWith("/" + modulePath)));
      map = sec?.map;
      if (!map) return null;
    }
    const hit = lookupMap(map, line, col);
    if (!hit) return null;
    let file = hit.file;
    if (!/^[a-z][\w+.-]*:/i.test(file) && !file.startsWith("/")) {
      file = mapBase.startsWith("file:") ? fileURLToPath(new URL(file, mapBase)) : new URL(file, mapBase).pathname;
    }
    return { file, line: hit.line };
  }

  // ----- wire up -----

  const server = http.createServer(async (req, res) => {
    // Block DNS-rebinding: only answer to localhost names.
    if (!allowedHosts.has(req.headers.host)) return res.writeHead(403).end("forbidden host");
    const url = new URL(req.url, origin);
    try {
      if (url.pathname === `${PREFIX}/overlay.js`) {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        return res.end(overlaySrc());
      }
      if (url.pathname === `${PREFIX}/events`) return handleEvents(req, res);
      if (url.pathname.startsWith(`${PREFIX}/api/`)) return await handleApi(req, res, url);
      if (target) return proxy(req, res);
      return serveStatic(req, res, url);
    } catch (err) {
      if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
    }
  });
  if (target) server.on("upgrade", proxyUpgrade);

  // Static mode: reload the preview when files change.
  let watcher;
  if (root) {
    let t;
    watcher = fs.watch(root, { recursive: true }, (_e, name) => {
      if (!name || /(^|[\\/])(\.live-edit|node_modules|\.git)([\\/]|$)/.test(name)) return;
      clearTimeout(t);
      t = setTimeout(() => broadcast("reload", { file: name }), 120);
    });
  }

  function shutdown() {
    watcher?.close();
    for (const c of clients) c.end();
    try { fs.unlinkSync(serverFile); } catch {}
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") console.error(`Port ${port} is busy. Use --port <other>.`);
    else console.error(err.message);
    process.exit(1);
  });

  server.listen(port, "127.0.0.1", () => {
    fs.writeFileSync(serverFile, JSON.stringify({ port, token, pid: process.pid, target: target?.origin, root }, null, 2));
    console.log(`Live edit preview: ${origin}`);
    console.log(target ? `Proxying ${target.origin}` : `Serving ${root}`);
    console.log(`VS Code: Ctrl/Cmd+Shift+P → "Simple Browser: Show" → paste the URL above.`);
    console.log(`Agent: run \`live-edit next\` from ${projectDir} to receive instructions.`);
  });
}

// ---------- source-map lookup (VLQ, including sectioned index maps) ----------

const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

function vlq(seg) {
  const out = [];
  let value = 0, shift = 0;
  for (const ch of seg) {
    let d = B64[ch];
    const more = d & 32;
    d &= 31;
    value += d << shift;
    if (more) shift += 5;
    else { out.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
  }
  return out;
}

function decodeMappings(str) {
  const lines = [];
  let src = 0, oLine = 0, oCol = 0;
  for (const lineStr of str.split(";")) {
    const segs = [];
    let gCol = 0;
    if (lineStr) for (const s of lineStr.split(",")) {
      const v = vlq(s);
      gCol += v[0];
      if (v.length >= 4) { src += v[1]; oLine += v[2]; oCol += v[3]; segs.push([gCol, src, oLine, oCol]); }
    }
    lines.push(segs);
  }
  return lines;
}

// line and col are 1-based, as in stack traces.
function lookupMap(map, line, col) {
  if (map.sections) {
    let sec = null;
    for (const s of map.sections) {
      const { line: l, column: c } = s.offset;
      if (l < line - 1 || (l === line - 1 && c <= col - 1)) sec = s;
    }
    if (!sec?.map) return null;
    const rel = line - sec.offset.line;
    return lookupMap(sec.map, rel, rel === 1 ? col - sec.offset.column : col);
  }
  const segs = decodeMappings(map.mappings || "")[line - 1];
  if (!segs?.length) return null;
  let best = segs[0];
  for (const s of segs) if (s[0] <= col - 1) best = s; else break;
  const file = (map.sourceRoot ? map.sourceRoot.replace(/\/?$/, "/") : "") + map.sources[best[1]];
  return { file, line: best[2] + 1 };
}

// Browsers report sources as URLs or bundler pseudo-paths; turn them into
// project-relative paths when the file exists.
function normalizeFile(f) {
  let p = String(f);
  if (/^https?:/.test(p)) p = new URL(p).pathname;
  p = decodeURIComponent(p)
    .replace(/^[a-z][\w+.-]*:\/{1,3}/i, "/") // webpack://, webpack-internal:///, turbopack:///, file://
    .replace(/[?#].*$/, "")
    .replace(/^\/@fs\//, "/")
    .replace(/^\/?_N_E\//, "/")
    .replace(/^\/?\[project\]\//, "/")
    .replace(/^\/?\([^)]*\)\//, "/") // (app-pages-browser)/
    .replace(/^\/\.\//, "/");
  const candidates = [p, path.join(projectDir, p), path.join(projectDir, p.replace(/^\/+/, ""))];
  for (const c of candidates) {
    if (path.isAbsolute(c) && c.startsWith(projectDir + path.sep) && fs.existsSync(c)) {
      return path.relative(projectDir, c).split(path.sep).join("/");
    }
  }
  return p.replace(/^\/+/, "");
}

// Tag every element in a static HTML file with data-le-loc="file:line" so a
// click maps back to the exact source line. Skips script/style/comments.
function annotateHtml(html, relFile) {
  let out = "";
  let line = 1;
  let i = 0;
  const RAW = /^(script|style|textarea|title)$/i;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) { out += html.slice(i); break; }
    const chunk = html.slice(i, lt);
    line += countNewlines(chunk);
    out += chunk;
    i = lt;
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i);
      const stop = end === -1 ? html.length : end + 3;
      const c = html.slice(i, stop);
      line += countNewlines(c); out += c; i = stop; continue;
    }
    const m = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(i, i + 64));
    if (!m) { out += "<"; i++; continue; }
    const tag = m[1];
    out += `<${tag} data-le-loc="${relFile}:${line}"`;
    i += m[0].length;
    if (RAW.test(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag.toLowerCase()}`, i);
      const stop = close === -1 ? html.length : close;
      const c = html.slice(i, stop);
      line += countNewlines(c); out += c; i = stop;
    }
  }
  return out;
}

function countNewlines(s) {
  let n = 0;
  for (let k = 0; k < s.length; k++) if (s.charCodeAt(k) === 10) n++;
  return n;
}

// ---------- dispatch ----------

switch (cmd) {
  case "start": await startServer(); break;
  case "next": await cliNext(); break;
  case "done":
  case "fail": {
    const id = args._[1];
    if (!id) { console.error(`Usage: live-edit ${cmd} <id> ${cmd === "done" ? "[summary]" : "<reason>"}`); process.exit(1); }
    const r = await api("POST", `/requests/${id}/${cmd}`, { note: args._.slice(2).join(" ") });
    console.log(`${r.id} → ${r.status}`);
    break;
  }
  case "requeue": {
    const r = await api("POST", `/requests/${args._[1]}/requeue`, {});
    console.log(`${r.id} → ${r.status}`);
    break;
  }
  case "status": await cliStatus(); break;
  case "stop": await api("POST", "/stop"); console.log("Stopped."); break;
  default: console.log(USAGE); process.exit(cmd && cmd !== "help" ? 1 : 0);
}
