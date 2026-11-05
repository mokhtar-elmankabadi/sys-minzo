/* SYS Minzo · silent printing through the local print program (agent/MinzoPrint.ps1)
   The page draws each receipt or label to a picture, turns it into the printer's own language
   (ESC/POS, TSPL, ZPL, EPL) or a PNG for normal Windows printers, and hands it to the program on
   127.0.0.1. When the program isn't running, every print falls back to the browser's print window. */
(function () {
"use strict";
const URL0 = "http://127.0.0.1:17777";
const st = { ok: false, checked: 0, printers: [], version: "", computer: "", queue: { waiting: 0, failed: 0 }, cfg: null, cfgAt: 0 };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

async function call(path, body) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), body ? 8000 : 2500);
  try {
    const r = await fetch(URL0 + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal, cache: "no-store" });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || "AGENT_ERROR"); return j;
  } finally { clearTimeout(t); }
}
async function check() {
  try { const j = await call("/status"); Object.assign(st, { ok: !!j.ok, printers: j.printers || [], version: j.version, computer: j.computer, queue: j.queue || st.queue }); }
  catch (e) { st.ok = false; st.printers = []; }
  st.checked = Date.now(); return st.ok;
}

/* which printer does this device use for a document? (print_map: device row first, then the location row) */
async function loadCfg(force) {
  const M = window.MZ; if (!M || !M.S.sess) return null;
  if (!force && st.cfg && Date.now() - st.cfgAt < 300000) return st.cfg;
  try { const [printers, map] = await Promise.all([M.q("printers", "*"), M.q("print_map", "*")]); st.cfg = { printers, map }; st.cfgAt = Date.now(); } catch (e) {}
  return st.cfg;
}
function route(doc, loc) {
  const M = window.MZ, c = st.cfg; if (!M || !c || !M.S.sess) return null;
  const dev = M.S.sess.device || {}, L = loc || dev.location_id;
  const row = c.map.find(m => m.location_id === +L && m.device_id === dev.id && m.doc === doc && m.printer_id) || c.map.find(m => m.location_id === +L && !m.device_id && m.doc === doc && m.printer_id);
  if (!row) return null;
  const p = c.printers.find(x => x.id === row.printer_id && x.active), f = row.fallback_id ? c.printers.find(x => x.id === row.fallback_id && x.active) : null;
  return p ? { printer: p, fallback: f, size: row.size, copies: row.copies || 1 } : null;
}
const targetOf = p => p && p.addr ? { name: p.conn === "ip" ? (String(p.addr).includes(":") ? p.addr : p.addr + ":9100") : p.addr, ip: p.conn === "ip" } : null;
/* the program can only reach printers that have a Windows name (or an IP) set */
function usable(p) { const t = targetOf(p); if (!t || !st.ok) return false; return t.ip || st.printers.some(w => w.name === t.name); }

/* ---------- drawing HTML to a picture ---------- */
const MM = 96 / 25.4;
async function toCanvas(html, widthMm, opt) {
  opt = opt || {}; const dpmm = opt.dpmm || 8, css = opt.css || "", hMm = opt.heightMm || 0;
  const box = document.createElement("div"); box.setAttribute("dir", "rtl");
  box.style.cssText = `position:fixed;left:-10000px;top:0;width:${widthMm}mm;${hMm ? `height:${hMm}mm;overflow:hidden;` : ""}background:#fff;color:#000;font-family:Tahoma,Arial,sans-serif;font-size:12px`;
  box.innerHTML = `<style>${css}</style>${html}`; document.body.appendChild(box);
  const wPx = Math.ceil(widthMm * MM), hPx = Math.ceil(hMm ? hMm * MM : box.scrollHeight + 2);
  const xhtml = new XMLSerializer().serializeToString(box).replace(/position:\s*fixed;\s*left:\s*-10000px;\s*top:\s*0(px)?;/, ""); box.remove();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
  const img = new Image(); img.decoding = "sync";
  await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("RENDER_FAILED")); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  const W = Math.round(widthMm * dpmm), Hh = Math.round((hMm || hPx / MM) * dpmm), cv = document.createElement("canvas"); cv.width = W; cv.height = Hh;
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, W, Hh); g.imageSmoothingEnabled = true; g.drawImage(img, 0, 0, W, Hh);
  return cv;
}
/* 1 bit per dot, rows padded to whole bytes; black = 1 */
function mono(cv, pad8) {
  const W = cv.width, H = cv.height, wb = Math.ceil((pad8 ? Math.ceil(W / 8) * 8 : W) / 8), d = cv.getContext("2d").getImageData(0, 0, W, H).data, out = new Uint8Array(wb * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114; if (lum < 150) out[y * wb + (x >> 3)] |= 0x80 >> (x & 7); }
  return { wb, H, bits: out };
}
function trimBottom(cv) { /* receipts: cut the empty tail */
  const g = cv.getContext("2d"), d = g.getImageData(0, 0, cv.width, cv.height).data; let last = 0;
  for (let y = cv.height - 1; y >= 0 && !last; y--) for (let x = 0; x < cv.width; x += 2) { if (d[(y * cv.width + x) * 4] < 150) { last = y; break; } }
  const h = Math.min(cv.height, last + 16), o = document.createElement("canvas"); o.width = cv.width; o.height = h; o.getContext("2d").drawImage(cv, 0, 0); return o;
}
const enc = s => new TextEncoder().encode(s);
function cat(parts) { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o; }
function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
const inv = bits => bits.map(b => 255 - b);

const ENC = {
  /* thermal receipt printers: raster in bands, feed, partial cut */
  escpos(cv, o) { const m = mono(cv, true), parts = [new Uint8Array([0x1b, 0x40])];
    for (let y = 0; y < m.H; y += 128) { const h = Math.min(128, m.H - y); parts.push(new Uint8Array([0x1d, 0x76, 0x30, 0, m.wb & 255, m.wb >> 8, h & 255, h >> 8]), m.bits.subarray(y * m.wb, (y + h) * m.wb)); }
    parts.push(new Uint8Array([0x1b, 0x64, 4]));
    if (!o || o.cut !== false) parts.push(new Uint8Array([0x1d, 0x56, 0x42, 0]));
    if (o && o.drawer) parts.push(new Uint8Array([0x1b, 0x70, 0, 25, 250]));
    return cat(parts); },
  /* label printers (TSC, Xprinter label mode…) — in TSPL a 0 bit prints black */
  tspl(cv, o) { const m = mono(cv, true); return cat([enc(`SIZE ${o.w} mm,${o.h} mm\r\nGAP ${o.gap == null ? 2 : o.gap} mm,0\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,${m.wb},${m.H},0,`), inv(m.bits), enc(`\r\nPRINT 1,${o.n || 1}\r\n`)]); },
  zpl(cv, o) { const m = mono(cv, true); let hex = ""; for (let i = 0; i < m.bits.length; i++) hex += (m.bits[i] < 16 ? "0" : "") + m.bits[i].toString(16).toUpperCase();
    return enc(`^XA^PW${cv.width}^LL${cv.height}^FO0,0^GFA,${m.bits.length},${m.bits.length},${m.wb},${hex}^FS^PQ${o.n || 1}^XZ\n`); },
  epl(cv, o) { const m = mono(cv, true); return cat([enc(`\r\nN\r\nq${cv.width}\r\nQ${cv.height},${Math.round((o.gap == null ? 2 : o.gap) * 8)}\r\nGW0,0,${m.wb},${m.H},`), inv(m.bits), enc(`\r\nP${o.n || 1}\r\n`)]); },
};
async function png(cv) { const b = await new Promise(ok => cv.toBlob(ok, "image/png")); return new Uint8Array(await b.arrayBuffer()); }

/* pages: [{ html, widthMm, heightMm?, n? }] — one job, one printer */
async function job(p, fb, pages, meta) {
  const t = targetOf(p), lang = p.lang || "windows", data = [];
  for (const pg of pages) {
    let cv = await toCanvas(pg.html, pg.widthMm, { heightMm: pg.heightMm, css: meta.css, dpmm: lang === "windows" ? (pg.widthMm > 120 ? 6 : 8) : 8 });
    if (!pg.heightMm) cv = trimBottom(cv);
    if (lang === "windows") { const b = b64(await png(cv)); for (let i = 0; i < (pg.n || 1); i++) data.push(b); }
    else { const e = ENC[lang] || ENC.escpos; data.push(b64(e(cv, { w: pg.widthMm, h: pg.heightMm, n: pg.n || 1, cut: meta.cut, drawer: meta.drawer }))); }
  }
  const ft = fb && usable(fb) && (fb.lang || "windows") === lang ? targetOf(fb) : null;
  const r = await call("/print", { printer: t.name, ip: t.ip, fallback: ft && !ft.ip ? ft.name : "", mode: lang === "windows" ? "image" : "raw", fitWidth: true, copies: meta.copies || 1, title: meta.title || "SYS Minzo", doc: meta.doc || "", data });
  st.queue.waiting++; return r.id;
}

const PAPER = { "58": 48, "80": 72, "A5": 130, "A4": 190 };
const RCSS = `.r{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.dim{color:#333}.hr{border-top:1px dashed #000}b{font-weight:bold}svg{display:block}`;

window.MZPA = {
  st, check, call, loadCfg, route, usable, targetOf, toCanvas, job, ENC, mono,
  auto: () => lsGet("mz.autoReceipt", true), setAuto: v => lsSet("mz.autoReceipt", !!v),
  /* sync answer for click handlers, so the print window can still open on the same click when this says no */
  can(doc, loc) { if (!st.cfg) loadCfg(); if (!st.ok) return null; const r = route(doc, loc); return r && usable(r.printer) ? r : null; },
  async receipt(html, title) {
    const r = this.can("sale"); if (!r) return false;
    const w = PAPER[r.size] || PAPER[r.printer.paper] || 72;
    await job(r.printer, r.fallback, [{ html: `<div style="width:${w}mm;padding:0 1mm;box-sizing:border-box;font-size:${w < 60 ? 11 : 12.5}px">${html}</div>`, widthMm: w }], { css: RCSS, copies: r.copies, title: title || "إيصال", doc: "sale" });
    return true; },
  async labels(rows, L0, lblHTML, loc) {
    const r = this.can("labels", loc); if (!r) return false;
    const pages = rows.map(({ it, n }) => ({ html: lblHTML(L0, it, true), widthMm: L0.w, heightMm: L0.h, n }));
    await job(r.printer, r.fallback, pages, { title: "ملصقات", doc: "labels" }); return true; },
  async test(p, html, wMm, hMm) { if (!usable(p)) return false; await job(p, null, [{ html, widthMm: wMm, heightMm: hMm }], { css: RCSS, title: "طباعة تجريبية", doc: "test" }); return true; },
};
/* keep an eye on the program: quickly at start, then every 30 seconds */
check().then(() => loadCfg());
/* when the program isn't installed, look only every 2 minutes so the console stays quiet */
setInterval(() => { if (!st.ok && Date.now() - st.checked < 120000) return; check(); if (window.MZ && window.MZ.S.sess) loadCfg(); }, 30000);
})();
