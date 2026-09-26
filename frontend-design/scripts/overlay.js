// Live edit overlay — injected into the preview by live-edit.mjs.
// Hover to highlight, click to select, type an instruction, send it to the agent.
(() => {
  if (window.__liveEdit) return;
  window.__liveEdit = true;

  const PREFIX = "__LIVE_EDIT_PREFIX__";
  const store = {
    get(k) { try { return sessionStorage.getItem("live-edit:" + k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem("live-edit:" + k, v); } catch {} },
  };

  // ---------- UI shell (shadow DOM keeps page CSS out) ----------

  const host = document.createElement("live-edit-root");
  host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
<style>
  :host { color-scheme: light dark; }
  .ui {
    --bg: #ffffff; --surface: #f7f7f6; --text: #18181b; --muted: #71717a;
    --border: rgba(0,0,0,0.10); --accent: #4f46e5; --accent-fg: #ffffff;
    --shadow: 0 0 0 1px rgba(0,0,0,0.06), 0 4px 12px -2px rgba(0,0,0,0.12), 0 16px 32px -8px rgba(0,0,0,0.12);
    --hl: #4f46e5;
    font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--text); letter-spacing: -0.005em;
  }
  @media (prefers-color-scheme: dark) {
    .ui {
      --bg: #151518; --surface: #1c1c20; --text: #f4f4f5; --muted: #a1a1aa;
      --border: rgba(255,255,255,0.10); --accent: #818cf8; --accent-fg: #0a0a0b;
      --shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 16px 40px -8px rgba(0,0,0,0.6);
      --hl: #818cf8;
    }
  }
  * { box-sizing: border-box; }
  button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
  button:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .hl { position: fixed; pointer-events: none; border: 1.5px solid var(--hl); border-radius: 3px;
        background: color-mix(in srgb, var(--hl) 10%, transparent); display: none;
        transition: all 60ms ease-out; }
  .hl.sel { border-width: 2px; background: color-mix(in srgb, var(--hl) 14%, transparent); transition: none; }
  .tag { position: fixed; pointer-events: none; display: none; padding: 2px 6px; border-radius: 4px;
         background: var(--hl); color: #fff; font: 500 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
         white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }

  .bar { position: fixed; right: 16px; bottom: 16px; pointer-events: auto; display: flex; align-items: center;
         gap: 2px; padding: 4px; border-radius: 12px; background: var(--bg); box-shadow: var(--shadow); }
  .bar button { height: 32px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 8px;
                font-weight: 500; }
  .bar button:hover { background: var(--surface); }
  .bar .toggle[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .55; }
  .toggle[aria-pressed="true"] .dot { opacity: 1; }
  .count { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--surface);
           font-size: 11px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); }
  .kbd { font: 11px ui-monospace, monospace; color: var(--muted); }
  .toggle[aria-pressed="true"] .kbd { color: inherit; opacity: .75; }

  .panel, .composer { position: fixed; pointer-events: auto; background: var(--bg); border-radius: 12px;
                      box-shadow: var(--shadow); }
  .panel { right: 16px; bottom: 64px; width: min(360px, calc(100vw - 32px)); max-height: 50vh; overflow: auto;
           padding: 6px; display: none; }
  .panel.open { display: block; }
  .panel h3 { margin: 6px 8px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase;
              letter-spacing: .06em; color: var(--muted); }
  .item { display: grid; grid-template-columns: 10px 1fr; gap: 10px; padding: 8px; border-radius: 8px; }
  .item + .item { border-top: 1px solid var(--border); border-radius: 0; }
  .item .s { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; }
  .s.queued { background: var(--muted); }
  .s.working { background: #f59e0b; animation: pulse 1.2s ease-in-out infinite; }
  .s.done { background: #16a34a; }
  .s.failed { background: #dc2626; }
  @keyframes pulse { 50% { opacity: .35; } }
  .item .note { color: var(--muted); font-size: 12px; margin-top: 2px; }
  .empty { padding: 12px 8px; color: var(--muted); }

  .composer { width: min(380px, calc(100vw - 32px)); padding: 12px; display: none; }
  .composer.open { display: block; }
  .target { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 8px; }
  .target b { color: var(--text); font-weight: 600; }
  textarea { width: 100%; min-height: 76px; resize: vertical; padding: 10px 12px; border-radius: 8px;
             border: 1px solid var(--border); background: var(--surface); color: var(--text);
             font: inherit; font-size: 14px; }
  textarea::placeholder { color: var(--muted); }
  .row { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
  .row .spacer { flex: 1; }
  .ghost { height: 32px; padding: 0 10px; border-radius: 8px; color: var(--muted); }
  .ghost:hover { background: var(--surface); color: var(--text); }
  .primary { height: 32px; padding: 0 14px; border-radius: 8px; background: var(--accent); color: var(--accent-fg);
             font-weight: 600; }
  .primary:disabled { opacity: .5; cursor: default; }

  .toast { position: fixed; left: 50%; bottom: 72px; transform: translate(-50%, 8px); opacity: 0;
           pointer-events: none; padding: 8px 14px; border-radius: 10px; background: var(--text); color: var(--bg);
           font-weight: 500; max-width: calc(100vw - 32px); transition: opacity 160ms, transform 160ms; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  @media (prefers-reduced-motion: reduce) { .hl, .toast { transition: none; } .s.working { animation: none; } }
</style>
<div class="ui">
  <div class="hl"></div>
  <div class="tag"></div>
  <div class="panel" role="region" aria-label="Live edit instructions"></div>
  <div class="composer" role="dialog" aria-label="Instruction for selected element">
    <div class="target"></div>
    <textarea placeholder="What should change? e.g. make this heading larger and tighter"></textarea>
    <div class="row">
      <button class="ghost parent" title="Select the parent element">↑ Parent</button>
      <span class="spacer"></span>
      <button class="ghost cancel">Cancel</button>
      <button class="primary send">Send <span class="kbd">⌘↵</span></button>
    </div>
  </div>
  <div class="bar">
    <button class="toggle" aria-pressed="false" title="Select elements to edit (Alt+Shift+E)">
      <span class="dot"></span>Edit <span class="kbd">⌥⇧E</span>
    </button>
    <button class="list" title="Instructions sent to the agent" aria-expanded="false">
      <span class="count">0</span>
    </button>
  </div>
  <div class="toast" role="status" aria-live="polite"></div>
</div>`;

  const $ = (s) => root.querySelector(s);
  const hl = $(".hl"), tag = $(".tag"), panel = $(".panel"), composer = $(".composer");
  const textarea = $("textarea"), targetLabel = $(".target"), toggleBtn = $(".toggle"), listBtn = $(".list");
  const sendBtn = $(".send"), toast = $(".toast");

  const mount = () => (document.body || document.documentElement).appendChild(host);
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  // Frameworks sometimes replace <body> content; keep the overlay attached.
  setInterval(() => { if (!host.isConnected) mount(); }, 1000);

  // ---------- state ----------

  let editing = false;
  let hovered = null;
  let selected = null;
  let pendingReload = false;
  // Remember statuses across reloads so an edit that reloads the page still
  // shows its "Applied" toast when `done` arrives.
  let requests = (() => { try { return JSON.parse(store.get("requests") || "[]"); } catch { return []; } })();

  function setEditing(on) {
    editing = on;
    store.set("editing", on ? "1" : "");
    toggleBtn.setAttribute("aria-pressed", String(on));
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on) { closeComposer(); hide(); }
  }

  const isOurs = (e) => e.composedPath().includes(host);

  // ---------- highlight ----------

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    const cls = [...el.classList].filter((c) => !c.startsWith("le-")).slice(0, 2);
    if (cls.length) s += "." + cls.join(".");
    return s;
  }

  function place(el, sel) {
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, { display: "block", left: r.left + "px", top: r.top + "px",
                              width: r.width + "px", height: r.height + "px" });
    hl.classList.toggle("sel", !!sel);
    tag.textContent = describe(el) + `  ${Math.round(r.width)}×${Math.round(r.height)}`;
    tag.style.display = "block";
    const above = r.top > 24;
    tag.style.left = Math.max(4, Math.min(r.left, innerWidth - tag.offsetWidth - 4)) + "px";
    tag.style.top = (above ? r.top - 22 : Math.min(r.bottom + 4, innerHeight - 22)) + "px";
  }

  function hide() { hl.style.display = "none"; tag.style.display = "none"; }

  addEventListener("scroll", () => { if (selected) place(selected, true); else if (hovered) place(hovered); }, true);
  addEventListener("resize", () => { if (selected) positionComposer(); });

  document.addEventListener("pointermove", (e) => {
    if (!editing || selected || isOurs(e)) return;
    const el = e.target;
    if (!(el instanceof Element) || el === document.documentElement) return;
    hovered = el;
    place(el);
  }, true);

  // Swallow page interactions while in edit mode, so clicks select instead of navigate.
  for (const type of ["pointerdown", "mousedown", "mouseup", "pointerup", "dblclick", "contextmenu", "submit", "auxclick"]) {
    document.addEventListener(type, (e) => {
      if (!editing || isOurs(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
  }
  document.addEventListener("click", (e) => {
    if (!editing || isOurs(e)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.target instanceof Element) select(e.target);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.shiftKey && e.code === "KeyE") { e.preventDefault(); setEditing(!editing); return; }
    if (e.key === "Escape" && editing && !isOurs(e)) { selected ? closeComposer() : setEditing(false); }
  }, true);

  // ---------- composer ----------

  let sourcePromise = null;

  function select(el) {
    selected = el;
    place(el, true);
    targetLabel.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = describe(el);
    targetLabel.append(b, document.createTextNode("  locating source…"));
    sourcePromise = locate(el).then(resolve).catch(() => ({ source: null, components: [] }));
    sourcePromise.then((info) => {
      if (selected !== el) return;
      const s = info.source;
      targetLabel.lastChild.textContent = s?.file ? `  ${s.file.split("/").slice(-2).join("/")}${s.line ? ":" + s.line : ""}` : "";
      targetLabel.title = s?.file ? `${s.file}${s.line ? ":" + s.line : ""}` : "";
    });
    composer.classList.add("open");
    positionComposer();
    const draft = store.get("draft");
    if (draft) textarea.value = draft;
    textarea.focus();
    updateSend();
  }

  function positionComposer() {
    const r = selected.getBoundingClientRect();
    const w = composer.offsetWidth, h = composer.offsetHeight;
    let top = r.bottom + 10;
    if (top + h > innerHeight - 70) top = r.top - h - 10;
    if (top < 10) top = Math.min(innerHeight - h - 70, Math.max(10, r.top + 10));
    composer.style.left = Math.max(16, Math.min(r.left, innerWidth - w - 16)) + "px";
    composer.style.top = top + "px";
  }

  function closeComposer() {
    composer.classList.remove("open");
    selected = null;
    hide();
    if (pendingReload) location.reload();
  }

  const updateSend = () => { sendBtn.disabled = !textarea.value.trim(); };
  textarea.addEventListener("input", () => { store.set("draft", textarea.value); updateSend(); });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    if (e.key === "Escape") { e.preventDefault(); closeComposer(); }
  });
  $(".cancel").addEventListener("click", closeComposer);
  $(".parent").addEventListener("click", () => {
    const p = selected?.parentElement;
    if (p && p !== document.documentElement) select(p);
  });
  sendBtn.addEventListener("click", send);
  toggleBtn.addEventListener("click", () => setEditing(!editing));
  listBtn.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    listBtn.setAttribute("aria-expanded", String(open));
  });

  async function send() {
    const instruction = textarea.value.trim();
    if (!instruction || !selected) return;
    sendBtn.disabled = true;
    const el = selected;
    const info = await sourcePromise;
    const payload = { instruction, ...capture(el), ...info };
    try {
      const res = await fetch(`${PREFIX}/api/requests`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.status);
      textarea.value = "";
      store.set("draft", "");
      showToast("Sent to agent");
      closeComposer();
    } catch (err) {
      showToast("Couldn't send: " + err.message);
      updateSend();
    }
  }

  let toastTimer;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  // ---------- element context ----------

  function cssPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      if (n.id && document.querySelectorAll("#" + CSS.escape(n.id)).length === 1) {
        parts.unshift("#" + CSS.escape(n.id));
        break;
      }
      let part = n.tagName.toLowerCase();
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(n) + 1})`;
      parts.unshift(part);
      if (part === "body") break;
    }
    return parts.join(" > ");
  }

  function cleanHtml(el) {
    let html = el.outerHTML.replace(/\s(data-le-loc|data-insp-path)="[^"]*"/g, "");
    if (html.length > 1600) html = html.slice(0, 1300) + "\n  …\n" + html.slice(-200);
    return html;
  }

  function capture(el) {
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of ["display", "color", "background-color", "font-family", "font-size", "font-weight",
                     "line-height", "padding", "margin", "border-radius", "gap"]) {
      const v = cs.getPropertyValue(p);
      if (v && v !== "normal" && v !== "0px" && v !== "none" && v !== "rgba(0, 0, 0, 0)") styles[p] = v;
    }
    const de = document.documentElement;
    const theme = de.dataset.theme || (de.classList.contains("dark") ? "dark"
      : de.classList.contains("light") ? "light"
      : matchMedia("(prefers-color-scheme: dark)").matches ? "dark (system)" : "light (system)");
    const r = el.getBoundingClientRect();
    return {
      page: location.pathname + location.search,
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 140),
      html: cleanHtml(el),
      styles,
      theme,
      rect: { x: Math.round(r.left), y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) },
      viewport: `${innerWidth}×${innerHeight}`,
    };
  }

  // ---------- source location ----------
  // Tries, in order: data attributes (static mode / inspector plugins), React
  // fiber debug info (+ source maps for React 19), Vue and Svelte dev metadata.

  const LOC_ATTRS = ["data-le-loc", "data-insp-path", "data-source-loc", "data-loc", "data-source"];

  async function locate(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      for (const a of LOC_ATTRS) {
        const v = n.getAttribute(a);
        const m = v && /^(.+?):(\d+)(?::(\d+))?/.exec(v);
        if (m) return { source: { file: m[1], line: +m[2], exact: n === el, via: a }, components: await reactOwners(el) };
      }
    }
    const react = await reactSource(el);
    if (react) return react;
    const vue = vueSource(el);
    if (vue) return vue;
    const svelte = svelteSource(el);
    if (svelte) return svelte;
    return { source: null, components: [] };
  }

  function fiberOf(el) {
    for (let n = el; n; n = n.parentElement) {
      const k = Object.keys(n).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (k) return n[k];
    }
    return null;
  }

  const nameOf = (type) =>
    type && (type.displayName || type.name || type.render?.displayName || type.render?.name || type.type?.displayName || type.type?.name);

  async function fiberLocation(fiber) {
    const ds = fiber._debugSource;
    if (ds?.fileName) return { file: ds.fileName, line: ds.lineNumber, exact: true, via: "react _debugSource" };
    // Fibers carry _debugStack; server-component owners (React 19 RSC) carry debugStack.
    const stack = (fiber._debugStack || fiber.debugStack)?.stack;
    const frames = stack ? userFrames(stack) : [];
    // Resolved to the original file:line by the live-edit server via source maps.
    return frames.length ? { frames, via: "react debug stack" } : null;
  }


  async function reactOwners(el) {
    const out = [];
    let f = fiberOf(el);
    for (let owner = f?._debugOwner; owner && out.length < 5; owner = owner._debugOwner || owner.owner) {
      const name = owner.name || nameOf(owner.type);
      if (!name || /^(Inner|Outer)?(LayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|ErrorBoundary.*|Router|HotReload|AppRouter|RedirectBoundary|NotFoundBoundary|LoadingBoundary|HTTPAccessFallbackBoundary|DevRootHTTPAccessFallbackBoundary|ClientPageRoot|ClientSegmentRoot|Suspense|StrictMode)$/.test(name)) continue;
      const loc = await fiberLocation(owner).catch(() => null);
      out.push({ name, ...(loc || {}) });
    }
    return out;
  }

  async function reactSource(el) {
    const fiber = fiberOf(el);
    if (!fiber) return null;
    // The fiber may belong to an ancestor if el was created outside React.
    const loc = await fiberLocation(fiber).catch(() => null);
    const components = await reactOwners(el);
    if (!loc && !components.length) return null;
    return { source: loc, components };
  }

  function vueSource(el) {
    for (let n = el; n; n = n.parentElement) {
      const inst = n.__vueParentComponent;
      if (inst) {
        const comps = [];
        for (let i = inst; i && comps.length < 5; i = i.parent) {
          const t = i.type || {};
          comps.push({ name: t.__name || t.name || "Anonymous", file: t.__file });
        }
        return { source: comps[0]?.file ? { file: comps[0].file, exact: false, via: "vue __file" } : null, components: comps };
      }
    }
    return null;
  }

  function svelteSource(el) {
    for (let n = el; n; n = n.parentElement) {
      const loc = n.__svelte_meta?.loc;
      if (loc?.file) return { source: { file: loc.file, line: loc.line, exact: false, via: "svelte __svelte_meta" }, components: [] };
    }
    return null;
  }

  const INTERNAL = /node_modules|\/\.vite\/deps\/|jsx-dev-runtime|jsx-runtime|react-dom|react-server-dom|next\/dist|react-stack-top-frame|\/__live-edit\//;

  // Candidate frames, outermost-first; the server skips any that map into node_modules.
  function userFrames(stack) {
    const out = [];
    for (const raw of stack.split("\n")) {
      const m = /(?:\(|@|at\s)([a-z][\w+.-]*:\/\/.+?):(\d+):(\d+)\)?$/i.exec(raw.trim());
      if (!m || INTERNAL.test(m[1])) continue;
      out.push({ url: m[1], line: +m[2], col: +m[3] });
      if (out.length === 6) break;
    }
    return out;
  }

  // Source maps live on the dev server or on disk (Next.js server chunks), so
  // the live-edit server resolves frames to original files.
  async function resolve(info) {
    const needs = info.source?.frames || info.components?.some((c) => c.frames);
    if (!needs) return info;
    try {
      const res = await fetch(`${PREFIX}/api/resolve`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(info),
      });
      return res.ok ? await res.json() : info;
    } catch { return info; }
  }

  // ---------- request list + live updates ----------

  function renderList() {
    if (requests.some((r) => r.instruction === undefined)) return; // only the reload snapshot so far
    const open = requests.filter((r) => r.status === "queued" || r.status === "working").length;
    $(".count").textContent = open || requests.length;
    $(".count").title = `${open} pending, ${requests.length} total`;
    panel.innerHTML = "<h3>Sent to agent</h3>";
    if (!requests.length) {
      panel.insertAdjacentHTML("beforeend", `<div class="empty">Nothing yet. Turn on Edit, click an element, describe the change.</div>`);
      return;
    }
    for (const r of [...requests].reverse().slice(0, 20)) {
      const item = document.createElement("div");
      item.className = "item";
      const dot = document.createElement("span");
      dot.className = "s " + r.status;
      dot.title = r.status;
      const body = document.createElement("div");
      body.textContent = r.instruction;
      if (r.note || r.status !== "done") {
        const note = document.createElement("div");
        note.className = "note";
        note.textContent = r.note || { queued: "Waiting for agent", working: "Agent is working on it", failed: "Not applied" }[r.status] || "";
        body.append(note);
      }
      item.append(dot, body);
      panel.append(item);
    }
  }

  function connect() {
    const es = new EventSource(`${PREFIX}/events`);
    es.addEventListener("requests", (e) => {
      const next = JSON.parse(e.data);
      for (const r of next) {
        const prev = requests.find((p) => p.id === r.id);
        if (prev && prev.status !== r.status) {
          if (r.status === "done") showToast("Applied" + (r.note ? ": " + r.note : ""));
          if (r.status === "failed") showToast("Not applied" + (r.note ? ": " + r.note : ""));
        }
      }
      requests = next;
      store.set("requests", JSON.stringify(next.map(({ id, status }) => ({ id, status }))));
      renderList();
    });
    es.addEventListener("reload", () => {
      if (composer.classList.contains("open")) pendingReload = true;
      else location.reload();
    });
  }

  renderList();
  connect();
  if (store.get("editing")) setEditing(true);
})();
