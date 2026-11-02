import { establishPrimitive } from "./webkit.js?v=20261031";
import { installWindowP } from "./utils/mem.js?v=20261031";

const output = document.getElementById("console");

// dev instrumentation: mirror every log line + heartbeat to the PC server
const __rseq = { n: 0 };
const __t0 = Date.now();
// remote logging only exists on the local server. on static hosts every
// beacon is an internet TLS request - pure kernel-heap churn during the
// race - so disable it entirely there.
const __remoteLog = location.protocol === "http:";
// quiet mode: while the kernel stage races armed aio groups, network calls
// are kernel-heap churn that can corrupt the reclaim. defer everything.
let __jbQuiet = false;
const __jbDeferred = [];
const __jbDeferredDom = [];
function __ps5send(kind, msg) {
  if (!__remoteLog) return;
  if (__jbQuiet) {
    if (kind === 'log') __jbDeferred.push(msg);
    return;
  }
  try {
    const url = '/__' + kind + '?s=' + (++__rseq.n) + '&t=' + (Date.now() - __t0) +
      (msg ? '&m=' + encodeURIComponent(String(msg).slice(0, 1400)) : '');
    if (navigator.sendBeacon && navigator.sendBeacon(url, ' ')) return;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.send();
  } catch (e) { }
}
window.jbQuiet = function (on) {
  __jbQuiet = !!on;
  if (!__jbQuiet) {
    const domCount = __jbDeferredDom.length;
    __jbDeferredDom.length = 0;
    if (domCount > 0) __writeDom('arm phase completed (' + domCount + ' steps)', 'info');
    const pending = __jbDeferred.splice(0);
    if (pending.length > 0) {
      let i = 0;
      const drain = () => {
        const end = Math.min(i + 8, pending.length);
        while (i < end) __ps5send('log', pending[i++]);
        if (i < pending.length) setTimeout(drain, 4);
      };
      setTimeout(drain, 4);
    }
  }
};
setInterval(() => { if (!__jbQuiet) __ps5send('hb', ''); }, 2000);
window.addEventListener('error', (e) => {
  __ps5send('log', 'JSERROR ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0));
});
window.addEventListener('unhandledrejection', (e) => {
  __ps5send('log', 'REJECTION ' + (e.reason && (e.reason.message || e.reason)));
});
__ps5send('log', 'site.js loaded - remote logging active');

let __statusEl = null;
function __updateStatus(message, type) {
  if (!__statusEl) {
    __statusEl = document.createElement("div");
    __statusEl.style.cssText =
      "position:fixed;top:0;left:0;right:0;z-index:9999;padding:4px 12px;" +
      "background:rgba(0,0,0,.85);color:#9fd0ff;font:12px/1.3 monospace;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
      "border-bottom:1px solid #333;pointer-events:none";
    (document.body || document.documentElement).appendChild(__statusEl);
  }
  const marker = type === "error" ? "-" : (type === "info" || type === "success") ? "+" : "*";
  __statusEl.textContent = `[${marker}] ${new Date().toLocaleTimeString()}  ${message}`;
}

function __writeDom(message, type) {
  let marker = "*";
  if (type === "error") marker = "-";
  if (type === "info" || type === "success") marker = "+";
  const line = document.createElement("div");
  line.textContent = `[${marker}] ${message}`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
  __updateStatus(message, type);
}

function writeLog(message, type = "log", replace = false) {
  window.__jbLastMark = Date.now();
  __ps5send('log', (type !== "log" ? type.toUpperCase() + " " : "") + message);
  if (__jbQuiet) {
    __jbDeferredDom.push([message, type]);
    // single textContent update - negligible churn, vital if we freeze here
    __updateStatus(message, type);
    return;
  }
  if (replace && output.lastElementChild) {
    let marker = "*";
    if (type === "error") marker = "-";
    if (type === "info" || type === "success") marker = "+";
    output.lastElementChild.textContent = `[${marker}] ${message}`;
    output.scrollTop = output.scrollHeight;
    return;
  }
  __writeDom(message, type);
}

function writeEvent(name, detail, type) {
  writeLog(detail == null || detail === "" ? name : `${name}: ${detail}`,
    type || (name === "Failed" ? "error" : "log"));
}

window.writeLog = writeLog;
window.jb = { mark: writeEvent };

// ---- payload menu (ported from soniciso/relapse) --------------------------

const __gcRefs = [];

function __leakPtr(arr) {
  const rt = window.__jb && window.__jb.p;
  if (!rt) return null;
  return rt.read8(rt.leakval(arr).add32(0x10));
}

async function __tcpSend(jb, bufPtr, size) {
  const sock = await jb.chain.syscall(SYS_SOCKET, 2, 1, 0);
  if ((sock.low | 0) < 0) throw new Error("socket failed");
  const sa = jb.p.malloc(16, 1);
  jb.p.write4(sa, 0x3D230210);
  jb.p.write4(sa.add32(4), 0x0100007F);
  jb.p.write4(sa.add32(8), 0);
  jb.p.write4(sa.add32(12), 0);
  const rv = await jb.chain.syscall(SYS_CONNECT, sock, sa, 16);
  if ((rv.low | 0) < 0) { await jb.chain.syscall(SYS_CLOSE, sock); throw new Error("connect failed"); }
  let off = 0;
  while (off < size) {
    const n = await jb.chain.syscall(SYS_WRITE, sock, bufPtr.add32(off), Math.min(size - off, 0x100000));
    if ((n.low | 0) <= 0) break;
    off += (n.low | 0);
  }
  await jb.chain.syscall(SYS_CLOSE, sock);
  if (off < size) throw new Error("incomplete send");
}

window.__sendPayload = async function (name) {
  const jb = window.__jb;
  if (jb) {
    try {
      const res = await fetch("payloads/" + encodeURIComponent(name));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = new Uint8Array(await res.arrayBuffer());
      __gcRefs.push(data);
      const ptr = __leakPtr(data);
      await __tcpSend(jb, ptr, data.length);
      return data.length;
    } catch (e) { }
  }
  const res = await fetch("/api/payload/" + encodeURIComponent(name));
  let j = null;
  try { j = await res.json(); } catch (e) { }
  if (!res.ok || !j || !j.ok)
    throw new Error((j && j.error) || ("HTTP " + res.status));
  return j.bytes;
};

window.__checkElfldr = async function () {
  const jb = window.__jb;
  if (jb) {
    try {
      const sock = await jb.chain.syscall(SYS_SOCKET, 2, 1, 0);
      if ((sock.low | 0) < 0) return false;
      const sa = jb.p.malloc(16, 1);
      jb.p.write4(sa, 0x3D230210);
      jb.p.write4(sa.add32(4), 0x0100007F);
      jb.p.write4(sa.add32(8), 0);
      jb.p.write4(sa.add32(12), 0);
      const rv = await jb.chain.syscall(SYS_CONNECT, sock, sa, 16);
      await jb.chain.syscall(SYS_CLOSE, sock);
      return (rv.low | 0) === 0;
    } catch (e) { return false; }
  }
  try {
    const res = await fetch("/api/elfldr");
    const j = await res.json();
    return !!(j && j.up);
  } catch (e) {
    return false;
  }
};

function buildPayloadMenu() {
  const existing = document.getElementById("relapse-payload-menu");
  if (existing) return existing;
  const tiles = window.PAYLOAD_TILES || [];
  if (!tiles.length) {
    writeLog("no payload list (payloads.js missing)", "error");
    return null;
  }

  const style = document.createElement("style");
  style.textContent = `
    #relapse-payload-menu {
      box-sizing:border-box;
      width:100%;
      min-height:100vh;
      padding:18px 16px 28px;
      background:#0c0c0f;
      color:#fff;
      font:16px/1.45 Arial,sans-serif;
      overflow-y:auto;
      overflow-x:hidden;
    }
    #relapse-payload-menu .payload-header {
      position:relative;
      text-align:center;
      max-width:1100px;
      margin:0 auto 14px;
    }
    #relapse-payload-menu h2 {
      margin:0 0 3px;
      font-size:22px;
      line-height:1.25;
      color:#fff !important;
      -webkit-text-fill-color:#fff !important;
    }
    #relapse-payload-menu .payload-status {
      margin:0;
      color:#ccc !important;
      font-size:13px;
    }
    #relapse-payload-menu .payload-help {
      margin:3px 0 0;
      color:#999 !important;
      font-size:12px;
    }
    #relapse-payload-menu .payload-grid {
      display:grid !important;
      grid-template-columns:repeat(3,minmax(0,1fr));
      gap:1rem 2.5rem;
      width:100%;
      max-width:1600px;
      margin:0 auto;
      padding:0 2rem 2rem;
      box-sizing:border-box;
      align-content:start;
    }
    #relapse-payload-menu .payload-tile {
      display:flex !important;
      flex-direction:column !important;
      justify-content:center !important;
      align-items:stretch !important;
      box-sizing:border-box;
      width:100%;
      min-height:118px !important;
      padding:1rem 2rem;
      border:0;
      border-radius:1.25rem;
      background:#202125 !important;
      color:#fff !important;
      text-decoration:none;
      text-align:center;
      cursor:pointer;
      line-height:1.3;
      transition:background-color .25s ease;
      overflow:visible !important;
    }
    #relapse-payload-menu .payload-tile:focus,
    #relapse-payload-menu .payload-tile:hover {
      outline:0;
      border:0;
      background:#a2a2a6 !important;
      color:#202020 !important;
    }
    #relapse-payload-menu .payload-tile.sending { opacity:.55; }
    #relapse-payload-menu .payload-line {
      display:block !important;
      visibility:visible !important;
      opacity:1 !important;
      position:relative !important;
      width:100% !important;
      height:auto !important;
      margin:0 !important;
      padding:0 !important;
      overflow:visible !important;
      box-sizing:border-box !important;
      text-align:center !important;
      white-space:normal !important;
      text-decoration:none !important;
    }
    #relapse-payload-menu .payload-title {
      color:#fff !important;
      font-size:1.3rem !important;
      line-height:1.55rem !important;
      font-weight:800 !important;
    }
    #relapse-payload-menu .payload-description {
      color:#ccc !important;
      font-size:1rem !important;
      line-height:1.45rem !important;
      font-weight:400 !important;
    }
    #relapse-payload-menu .payload-info {
      color:#999 !important;
      font-size:.9rem !important;
      line-height:1.35rem !important;
      font-weight:400 !important;
    }
    #relapse-payload-menu .payload-tile:hover .payload-title,
    #relapse-payload-menu .payload-tile:focus .payload-title { color:#202020 !important; }
    #relapse-payload-menu .payload-tile:hover .payload-description,
    #relapse-payload-menu .payload-tile:focus .payload-description { color:#444 !important; }
    #relapse-payload-menu .payload-tile:hover .payload-info,
    #relapse-payload-menu .payload-tile:focus .payload-info { color:#555 !important; }
    @media (max-width:700px) {
      #relapse-payload-menu .payload-grid { grid-template-columns:1fr; }
    }
  `;
  document.head.appendChild(style);

  const menu = document.createElement("section");
  menu.id = "relapse-payload-menu";
  // Build the complete payload DOM before the exploit runs; fresh-jailbreak
  // rendering can invalidate dynamically-created rows.
  menu.style.setProperty("visibility", "hidden", "important");
  menu.style.setProperty("opacity", "0", "important");
  menu.style.setProperty("pointer-events", "none", "important");

  const header = document.createElement("div");
  header.className = "payload-header";
  const title = document.createElement("h2");
  title.textContent = "Relapse Payloads (13.60)";
  const status = document.createElement("p");
  status.className = "payload-status";
  status.textContent = "Listening on console port 9021";
  const help = document.createElement("p");
  help.className = "payload-help";
  help.textContent = "Select a payload to send it to the ELF loader.";
  header.append(title, status, help);

  const grid = document.createElement("div");
  grid.className = "payload-grid";

  for (const t of tiles) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "payload-tile";
    a.tabIndex = 0;

    const name = document.createElement("div");
    name.className = "payload-line payload-title";
    name.textContent = t.title;
    const description = document.createElement("div");
    description.className = "payload-line payload-description";
    description.textContent = t.description;
    const info = document.createElement("div");
    info.className = "payload-line payload-info";
    info.textContent = t.info || t.name;

    a.append(name, description, info);
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      if (a.classList.contains("sending")) return;
      a.classList.remove("sent", "failed");
      a.classList.add("sending");
      writeLog(t.title + ": sending ...", "info");
      try {
        const n = await window.__sendPayload(t.name);
        a.classList.remove("sending", "failed");
        a.classList.add("sent");
        writeLog(t.title + ": sent " + n + " bytes to port 9021", "success");
      } catch (err) {
        a.classList.remove("sending", "sent");
        a.classList.add("failed");
        writeLog(t.title + ": " + ((err && err.message) || err), "error");
      }
    });
    grid.appendChild(a);
  }

  menu.append(header, grid);
  document.body.appendChild(menu);
  void menu.offsetHeight;
  for (const el of menu.querySelectorAll(".payload-line")) void el.offsetHeight;
  return menu;
}

function showPayloadMenu() {
  const consoleEl = document.getElementById("console");
  if (consoleEl) consoleEl.style.display = "none";
  const menu = buildPayloadMenu();
  if (!menu) return;
  menu.style.setProperty("visibility", "visible", "important");
  menu.style.setProperty("opacity", "1", "important");
  menu.style.setProperty("pointer-events", "auto", "important");
  void menu.offsetHeight;
  requestAnimationFrame(() => { void menu.offsetHeight; });
  writeLog("elfldr is up - pick a payload", "success");
}

// Prebuild the menu DOM before anything exploit-related runs.
buildPayloadMenu();

async function getPrimitive() {
  writeLog("Starting WebKit exploit");
  const primitive = installWindowP(await establishPrimitive(writeEvent));
  if (!primitive || typeof primitive.read8 !== "function")
    throw new Error("Memory primitive unavailable");

  writeLog("ARW ready", "success");
  return primitive;
}

function getWebKitBase() {
  const ctor = globalThis.__ps5NativeCtor;
  if (typeof ctor !== "number" || typeof OFFSET_wk_host_constructor_candidates === "undefined")
    throw new Error("WebKit base inputs are unavailable");

  for (const offset of OFFSET_wk_host_constructor_candidates) {
    const base = ctor - offset;
    if (base >= 0x800000000 && base < 0x900000000 && base % 0x4000 === 0)
      return base;
  }

  throw new Error("WebKit base not found");
}

async function run() {
  const rejection = window.firmware.rejection();
  if (rejection)
    throw new Error(rejection);

  let primitive = null;

  // Sender-only mode: the console is already jailbroken and elfldr owns 9021.
  // Skip the whole exploit and go straight to the payload menu.
  const senderMode = new URLSearchParams(location.search).get("sender") === "1";
  if (senderMode) {
    writeLog("payload sender mode - checking elfldr on :9021", "info");
    if (!(await window.__checkElfldr())) {
      // Static hosts (GitHub Pages) have no /api probe. Build the userland
      // primitives - safe on a jailbroken console - and check 9021 directly.
      writeLog("no server probe - building primitives to check the console", "info");
      for (let i = 0; i < 100 && typeof wk_gadgetmap === "undefined"; i++)
        await new Promise((r) => setTimeout(r, 100));
      primitive = await getPrimitive();
      await ensureJb(primitive);
    }
    if (await window.__checkElfldr()) {
      writeLog("elfldr is up - loading payloads", "success");
      showPayloadMenu();
      return;
    }
    writeLog("elfldr is down - continuing into jailbreak", "info");
  }

  // Prevent re-running jailbreak if already active
  if (await window.__checkElfldr()) {
    writeLog("jailbreak already active - loading payloads", "info");
    try { localStorage.setItem("relapse.jbDone", "1"); } catch (e) {}
    showPayloadMenu();
    return;
  }

  writeLog("Credits: Sonic_Iso, Jordy, ntfargo, ufm42, Dr. Yenyen, TheFlow, SlidyBat, Flatz, cow, nhk, bollarz, Sleirsgoevy, EchoStretch, EarthOnion", "info");
  writeLog(`Agent: ${navigator.userAgent}`, "info");
  writeLog(`Firmware: ${window.fw_str}`, "info");
  if (!primitive) primitive = await getPrimitive();
  writeLog(`WebKit base: 0x${getWebKitBase().toString(16)}`, "info");

  await import("./relapse_exploit.js?v=20261031");

  // Stall watchdog: the kernel stage must keep producing log lines (even
  // quiet-deferred ones update __jbLastMark). If nothing moves for 2min the
  // console is likely wedged mid-race - reload beats waiting on a corpse.
  window.__jbLastMark = Date.now();
  const stallTimer = setInterval(() => {
    if (Date.now() - window.__jbLastMark <= 120000) return;
    clearInterval(stallTimer);
    try {
      const key = "relapse.reloads";
      const n = (parseInt(sessionStorage.getItem(key) || "0", 10)) + 1;
      sessionStorage.setItem(key, String(n));
      if (n <= 8) {
        writeLog("kernel stage stalled 2min - auto-reload " + n + "/8", "error");
        setTimeout(() => location.reload(), 1500);
      } else {
        writeLog("stalled and out of reloads - reload manually", "error");
      }
    } catch (e) { location.reload(); }
  }, 5000);
  try {
    await main(primitive);
  } finally {
    clearInterval(stallTimer);
  }

  // Kernel exploit done - give elfldr a moment to bind, then reveal the menu.
  for (let i = 0; i < 5; i++) {
    if (await window.__checkElfldr()) {
      try { localStorage.setItem("relapse.jbDone", "1"); } catch (e) {}
      showPayloadMenu();
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  writeLog("elfldr did not come up on 9021 - payload menu unavailable", "error");
}

const __senderMode = new URLSearchParams(location.search).get("sender") === "1";

run().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  writeLog(msg, "error");
  // Sender mode also runs the full jailbreak when elfldr is down - a failed
  // attempt must reload there too, not leave a dead page.
  if (window.firmware && window.firmware.rejection()) return;
  try {
    const key = "relapse.reloads";
    const n = (parseInt(sessionStorage.getItem(key) || "0", 10)) + 1;
    sessionStorage.setItem(key, String(n));
    if (n <= 8) {
      const delay = Math.min(1500 + (n - 1) * 500, 4000);
      writeLog(`auto-reload ${n}/8 in ${(delay / 1000).toFixed(1)}s`, "info");
      setTimeout(() => location.reload(), delay);
    } else {
      writeLog("too many reloads - reload manually", "error");
    }
  } catch (e) { }
});