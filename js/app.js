/* SYS Minzo · live app · phase 1
   Flow: device signs in (anonymous Supabase account kept on this device) → first run / device approval →
   staff unlock with their PIN → screens allowed by their role. Every write goes through a server function. */
(function () {
"use strict";
const CFG = window.MINZO_CONFIG;
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "minzo-device" } });
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d) => (Math.round((+n || 0) * (d ? 100 : 1)) / (d ? 100 : 1)).toLocaleString("en-US", { maximumFractionDigits: d ? 2 : 0 }) + " ج.م";
const num = n => (+n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
const norm = s => String(s || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآا]/g, "ا").replace(/ة/g, "ه").replace(/[ىي]/g, "ي").replace(/\s+/g, " ").trim();
const UNITS = { piece: "قطعة", set: "طقم", meter: "متر", dozen: "دستة" };
const KINDS = { admin: "إدارة", cashier: "كاشير", warehouse: "جهاز المخزن", custom: "مخصص" };

/* ---------- server error codes → Arabic ---------- */
const ERR = {
  WRONG_PIN: "الرمز غلط.", LOCKED: "الجهاز اتقفل بعد 5 محاولات غلط. جرّب بعد 5 دقايق.", WRONG_LOCATION: "الرمز ده لموظف في فرع تاني.",
  SESSION_EXPIRED: "انتهت الجلسة — ادخل برمزك تاني.", DEVICE_NOT_APPROVED: "الجهاز لسه مستني الاعتماد.", DEVICE_NOT_REGISTERED: "الجهاز مش متسجّل.",
  PIN_LENGTH: "الرمز الرقمي من ٤ لـ ٨ أرقام.", PIN_REPEATED: "مينفعش كل الأرقام تبقى زي بعض.", PIN_SEQUENCE: "مينفعش أرقام متسلسلة زي ١٢٣٤.",
  PASSWORD_WEAK: "كلمة السر ٦ حروف على الأقل وفيها حروف وأرقام.", PIN_TAKEN: "الرمز ده مستخدم عند موظف تاني — اختار غيره.",
  ESCALATION: "مينفعش تدّي دور أعلى من صلاحيتك.", OUT_OF_SCOPE: "ده خارج الفرع بتاعك.", LAST_OWNER: "مينفعش تلغي آخر حساب مالك.",
  ONLY_OWNER_CREATES_OWNER: "المالك بس اللي يضيف مالك.", ONLY_OWNER_EDITS_OWNER: "المالك بس اللي يعدّل حساب المالك.", ALREADY_SET_UP: "النظام متهيّأ قبل كده.",
  NAME_REQUIRED: "الاسم مطلوب.", BAD_EAN13: "رقم الفحص في باركود EAN-13 غلط.", IMPORT_HAS_ERRORS: "الملف فيه أخطاء — صلّحها الأول.",
  OPENING_AFTER_MOVES: "مينفعش تستورد أرصدة أول المدة لمكان اتعمل فيه حركات.", EDITED_BY_SOMEONE_ELSE: "حد تاني عدّل الصنف ده بعد ما فتحته — افتحه تاني.",
  CANNOT_DISABLE_OWN_DEVICE: "مينفعش توقف الجهاز اللي شغال عليه.", NOT_SET_UP: "النظام لسه ما اتهيّأش."
};
function errText(e) {
  const m = String((e && (e.message || e.error_description || e.error)) || e || "");
  if (/duplicate key.*barcode/.test(m)) return "الباركود ده موجود على صنف تاني.";
  if (/duplicate key.*code/.test(m)) return "الكود ده موجود على صنف تاني.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "مفيش اتصال بالإنترنت.";
  if (/Anonymous sign-ins are disabled/i.test(m)) return "تسجيل الأجهزة مقفول في Supabase — لازم يتفعّل «Anonymous sign-ins».";
  const k = m.split(":")[0].trim();
  if (k.startsWith("NOT_ALLOWED")) return "مش مسموح لدورك.";
  return ERR[k] || m;
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) {
    if (/SESSION_EXPIRED/.test(error.message)) { lockNow(); }
    throw error;
  }
  return data;
}
const T = () => S.sess && S.sess.token;

/* ---------- state ---------- */
const S = { sess: null, route: ls("minzo-route") || "dash", locs: [], depts: [], groups: [], items: [], stock: [], store: null, idle: 0,
  q: "", dep: "all", stockLoc: "all", imp: null };
const role = () => (S.sess && S.sess.role) || {};
const can = (mod, act) => { const p = role().perms || {}; const s = p[mod] != null ? p[mod] : (p["*"] || ""); return s.includes(act || "v"); };
const has = k => { const s = role().sens || []; return s.includes("*") || s.includes(k); };
const seeCost = () => !role().hide_cost;
const locName = id => (S.locs.find(l => l.id === id) || {}).name || "—";

/* ---------- icons ---------- */
const IC = {
  dash: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z", items: "M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10",
  io: "M7 3v14M3 7l4-4 4 4M17 21V7M21 17l-4 4-4-4", stock: "M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10",
  users: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6zM9 12l2 2 4-4", devices: "M3 4h13v10H3zM7 18h5M9.5 14v4M18 8h3v12h-5v-3",
  pos: "M3 4h18v12H3zM8 20h8M12 16v4M7 8h4M7 12h6", lock: "M6 11h12v10H6zM8 11V7a4 4 0 018 0v4", plus: "M12 5v14M5 12h14",
  menu: "M3 6h18M3 12h18M3 18h18", moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z", out: "M15 3h5v18h-5M10 17l5-5-5-5M15 12H3"
};
const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[k]}"/></svg>`;
const MARK = `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M34 104V58a26 26 0 0 1 52 0v46M18 104h84M46 104V84a14 14 0 0 1 28 0v20"/></svg>`;

/* ---------- toasts & modal ---------- */
function toast(m, bad) { const d = document.createElement("div"); d.className = "toast"; if (bad) d.style.borderColor = "var(--bad)"; d.textContent = m; $("#toasts").appendChild(d); setTimeout(() => { d.style.transition = "opacity .4s"; d.style.opacity = "0"; setTimeout(() => d.remove(), 400); }, 3600); }
function modal(html) { closeModal(); const m = document.createElement("div"); m.id = "modal"; m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`; m.addEventListener("click", e => { if (e.target === m) closeModal(); }); document.body.appendChild(m); const f = m.querySelector("input,select"); if (f) f.focus(); }
function closeModal() { const m = $("#modal"); if (m) m.remove(); }
const busy = (el, on) => { if (!el) return; el.disabled = on; el.dataset.t = el.dataset.t || el.innerHTML; el.innerHTML = on ? "…" : el.dataset.t; };

/* =====================================================================
   GATE: device account → first run / registration / approval → PIN
   ===================================================================== */
function gate(html) { $("#app").hidden = true; const g = $("#gate"); g.hidden = false; g.innerHTML = `<div class="gbox"><div class="mark">${MARK}</div>${html}</div>`; const f = g.querySelector("input"); if (f) f.focus(); }

async function boot() {
  gate(`<h1>SYS Minzo</h1><p class="sub">جاري التحميل…</p><div class="spin"></div>`);
  try {
    let { data: { session } } = await sb.auth.getSession();
    if (!session) { const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; }
    const st = await rpc("setup_status");
    if (!st.setup_done) return firstRun();
    if (!st.device) return registerDevice();
    if (!st.device.active) return pendingDevice(st.device);
    S.storeName = st.store;
    lockScreen();
  } catch (e) {
    gate(`<h1>SYS Minzo</h1><p class="sub">مش قادر يوصل للسيرفر</p><div class="gerr">${esc(errText(e))}</div><button class="btn gold" style="width:100%;margin-top:12px" id="retry">حاول تاني</button>`);
    $("#retry").onclick = boot;
  }
}

function firstRun() {
  gate(`<h1>أهلًا بيك</h1><p class="sub">أول تشغيل للنظام: هنسجّل المحل وحساب المالك، والجهاز ده هيبقى جهاز الإدارة.</p>
  <div class="stack">
   <div class="field"><label>اسم المحل</label><input class="inp" id="fStore" placeholder="مثال: معرض المنزل الحديث"></div>
   <div class="field"><label>اسم الجهاز ده</label><input class="inp" id="fDev" value="كمبيوتر الإدارة"></div>
   <div class="field"><label>اسم المالك</label><input class="inp" id="fOwner"></div>
   <div class="field"><label>رمز المالك (٤–٨ أرقام، أو كلمة سر فيها حروف وأرقام)</label><input class="inp num" id="fPin" type="password" autocomplete="new-password"></div>
   <div class="field"><label>تأكيد الرمز</label><input class="inp num" id="fPin2" type="password" autocomplete="new-password"></div>
   <button class="btn gold" id="fGo">تهيئة النظام</button><div class="gerr" id="fErr"></div>
  </div><p class="gnote">الرمز ده هو مفتاح المالك لكل الموافقات. احفظه في مكان آمن.</p>`);
  $("#fGo").onclick = async e => {
    const store = $("#fStore").value.trim(), dev = $("#fDev").value.trim(), owner = $("#fOwner").value.trim(), p = $("#fPin").value, p2 = $("#fPin2").value;
    if (!store || !dev || !owner) return ($("#fErr").textContent = "املا كل الخانات.");
    if (p !== p2) return ($("#fErr").textContent = "الرمزين مش زي بعض.");
    busy(e.target, true);
    try { await rpc("setup_first_run", { p_store_name: store, p_device_name: dev, p_owner_name: owner, p_owner_pin: p }); toast("النظام اتهيّأ. ادخل برمز المالك."); S.storeName = store; lockScreen(); }
    catch (er) { $("#fErr").textContent = errText(er); busy(e.target, false); }
  };
}

function registerDevice() {
  gate(`<h1>تسجيل جهاز جديد</h1><p class="sub">اكتب اسم الجهاز، وبعدها المالك أو المدير العام يعتمده من شاشة «الأجهزة».</p>
  <div class="stack"><div class="field"><label>اسم الجهاز</label><input class="inp" id="dName" placeholder="مثال: كاشير المعرض الأول"></div>
  <button class="btn gold" id="dGo">إرسال طلب التسجيل</button><div class="gerr" id="dErr"></div></div>`);
  $("#dGo").onclick = async e => {
    const n = $("#dName").value.trim(); if (!n) return ($("#dErr").textContent = "اكتب اسم الجهاز.");
    busy(e.target, true);
    try { const d = await rpc("device_register", { p_name: n }); pendingDevice({ name: n, id: d.id }); } catch (er) { $("#dErr").textContent = errText(er); busy(e.target, false); }
  };
}

function pendingDevice(d) {
  gate(`<h1>في انتظار الاعتماد</h1><p class="sub">الجهاز «${esc(d.name)}» اتسجّل. اطلب من المالك أو المدير العام يعتمده من شاشة «الأجهزة» ويحدد مكانه.</p>
  <div class="okbox" style="text-align:center">رقم الجهاز: <b class="num">${esc(String(d.id || "").slice(0, 8))}</b></div>
  <button class="btn gold" style="width:100%;margin-top:14px" id="pChk">اتعتمد؟ تحقق تاني</button>`);
  $("#pChk").onclick = boot;
}

let pinBuf = "";
function lockScreen(msg) {
  S.sess = null; pinBuf = "";
  gate(`<h1>${esc(S.storeName || "SYS Minzo")}</h1><p class="sub">اكتب رمزك عشان تدخل</p>
  <div class="pinrow" id="pinDots">${"<i></i>".repeat(4)}</div>
  <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join("")}<button class="fn" data-k="pw">كلمة سر</button><button data-k="0">0</button><button class="fn" data-k="del">مسح</button></div>
  <div class="gerr" id="pErr">${esc(msg || "")}</div>`);
  $("#gate .pad").onclick = e => { const b = e.target.closest("button"); if (!b) return; const k = b.dataset.k;
    if (k === "del") pinBuf = pinBuf.slice(0, -1); else if (k === "pw") return passwordLogin(); else if (pinBuf.length < 8) pinBuf += k;
    drawDots(); if (pinBuf.length >= 4) clearTimeout(S._pt), S._pt = setTimeout(() => tryLogin(pinBuf), pinBuf.length >= 6 ? 50 : 700); };
}
function drawDots() { const n = Math.max(4, pinBuf.length); $("#pinDots").innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pinBuf.length ? "f" : ""}"></i>`).join(""); }
document.addEventListener("keydown", e => { if ($("#gate").hidden || !$("#pinDots")) return; if (/^\d$/.test(e.key) && pinBuf.length < 8) { pinBuf += e.key; drawDots(); } else if (e.key === "Backspace") { pinBuf = pinBuf.slice(0, -1); drawDots(); } else if (e.key === "Enter" && pinBuf.length >= 4) tryLogin(pinBuf); });
function passwordLogin() { gate(`<h1>الدخول بكلمة السر</h1><div class="stack"><input class="inp" id="pw" type="password" autocomplete="current-password"><button class="btn gold" id="pwGo">دخول</button><button class="btn ghost" id="pwBack">رجوع للأرقام</button><div class="gerr" id="pErr"></div></div>`);
  $("#pwGo").onclick = () => tryLogin($("#pw").value); $("#pwBack").onclick = () => lockScreen(); $("#pw").onkeydown = e => { if (e.key === "Enter") tryLogin($("#pw").value); }; }
async function tryLogin(p) {
  if (S._logging) return; S._logging = true;
  try {
    const r = await rpc("staff_login", { p_pin: p });
    if (r.error) { pinBuf = ""; if ($("#pinDots")) drawDots();
      const t = r.error === "WRONG_PIN" ? `الرمز غلط — فاضل ${r.left} محاولات قبل القفل.` : r.error === "LOCKED" ? `الجهاز مقفول لحد ${new Date(r.until).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}.` : errText(r.error);
      $("#pErr").textContent = t; return; }
    S.sess = r; S.idle = Date.now();
    if (r.staff.must_change) return changePin(true);
    await enterApp();
  } catch (e) { $("#pErr").textContent = errText(e); pinBuf = ""; if ($("#pinDots")) drawDots(); }
  finally { S._logging = false; }
}
function changePin(forced) {
  const h = `<h1>${forced ? "اختار رمزك الخاص" : "تغيير الرمز"}</h1><p class="sub">${forced ? "الرمز ده مؤقت — لازم تختار رمز جديد قبل ما تكمّل." : ""}</p><div class="stack">
   <div class="field"><label>الرمز الحالي</label><input class="inp num" id="cOld" type="password"></div>
   <div class="field"><label>الرمز الجديد</label><input class="inp num" id="cNew" type="password" autocomplete="new-password"></div>
   <div class="field"><label>تأكيد الرمز الجديد</label><input class="inp num" id="cNew2" type="password" autocomplete="new-password"></div>
   <button class="btn gold" id="cGo">حفظ</button>${forced ? "" : `<button class="btn ghost" id="cCancel">إلغاء</button>`}<div class="gerr" id="cErr"></div></div>`;
  if (forced) gate(h); else modal(h.replace("<h1>", "<h2>").replace("</h1>", "</h2>").replace('class="gerr"', 'class="gerr" style="color:var(--bad)"'));
  const root = forced ? $("#gate") : $("#modal");
  root.querySelector("#cGo").onclick = async e => {
    const o = root.querySelector("#cOld").value, n = root.querySelector("#cNew").value, n2 = root.querySelector("#cNew2").value;
    if (n !== n2) return (root.querySelector("#cErr").textContent = "الرمزين الجداد مش زي بعض.");
    busy(e.target, true);
    try { await rpc("staff_change_pin", { p_token: T(), p_old: o, p_new: n }); toast("اتغيّر الرمز."); if (forced) { S.sess.staff.must_change = false; await enterApp(); } else closeModal(); }
    catch (er) { root.querySelector("#cErr").textContent = errText(er); busy(e.target, false); }
  };
  const c = root.querySelector("#cCancel"); if (c) c.onclick = closeModal;
}
function lockNow(msg) { if (T()) rpc("staff_logout", { p_token: T() }).catch(() => {}); S.sess = null; closeModal(); lockScreen(msg); }
setInterval(() => { if (S.sess && Date.now() - S.idle > 10 * 60 * 1000) lockNow("اتقفل تلقائي بعد ١٠ دقايق من غير استخدام."); }, 20000);
["click", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, () => { if (S.sess) S.idle = Date.now(); }, { passive: true }));

/* =====================================================================
   DATA
   ===================================================================== */
async function q(table, sel, mod) { let x = sb.from(table).select(sel || "*"); if (mod) x = mod(x); const { data, error } = await x; if (error) throw error; return data; }
async function loadCore() {
  const [locs, depts, groups, store] = await Promise.all([q("locations", "*", x => x.order("id")), q("departments", "*", x => x.order("sort")), q("item_groups", "*", x => x.order("name")), q("store")]);
  S.locs = locs; S.depts = depts; S.groups = groups; S.store = store[0];
}
async function loadItems() {
  const [items, stock] = await Promise.all([q("items", "*", x => x.eq("hidden", false).order("name").limit(5000)), q("stock", "*", x => x.limit(20000))]);
  S.items = items; S.stock = stock;
}
const stockOf = (id, loc) => S.stock.filter(s => s.item_id === id && (loc == null || loc === "all" || s.location_id === +loc)).reduce((a, s) => a + (+s.qty || 0), 0);

/* =====================================================================
   SHELL
   ===================================================================== */
const NAV = [["التشغيل", ["dash", "stock"]], ["التجارة", ["items", "io"]], ["النظام", ["users", "devices"]]];
const NAME = { dash: "لوحة التحكم", items: "الأصناف", io: "استيراد الأصناف والأرصدة", stock: "المخزون", users: "الموظفين والرموز", devices: "الأجهزة" };
const SUB = { dash: "نظرة سريعة على الأصناف والمخزون في كل مكان.", items: "كل صنف بباركوده ووحدته وسعره، ومسلسل وضمان للأجهزة.", io: "استورد الأصناف من Excel أو CSV بأي شكل أعمدة، ومعاها أرصدة أول المدة.", stock: "رصيد كل صنف في المعرضين والمخزن.", users: "ضيف موظفين وحدد دورهم وفرعهم، وادّيهم رمز مؤقت يغيّروه أول دخول.", devices: "اعتمد الأجهزة الجديدة وحدد نوع كل جهاز ومكانه." };
const allowed = r => ({ dash: can("dash") || can("items"), items: can("items"), io: can("io", "i") && can("items", "a"), stock: can("stock") || can("items"), users: has("users"), devices: has("devices") })[r];

async function enterApp() {
  $("#gate").hidden = true; $("#app").hidden = false;
  try { await loadCore(); await loadItems(); } catch (e) { toast(errText(e), true); }
  if (!allowed(S.route)) S.route = Object.keys(NAME).find(allowed) || "dash";
  render();
}
function renderSide() {
  let h = `<div class="brand"><div class="mono">${MARK.replace("<svg", '<svg width="30" height="30" fill="none" style="stroke:var(--gold)" stroke-width="5" stroke-linecap="round"')}</div><div><b>${esc((S.store && S.store.name) || S.storeName || "")}</b><small>أدوات منزلية · أجهزة · مفروشات</small></div></div>`;
  NAV.forEach(([g, ids]) => { const v = ids.filter(allowed); if (!v.length) return; h += `<div class="navlbl">${g}</div><nav class="nav">${v.map(id => `<button data-go="${id}" class="${S.route === id ? "on" : ""}">${ico(id)}<span>${NAME[id]}</span></button>`).join("")}</nav>`; });
  h += `<div class="foot">المرحلة الأولى<br><span class="num">${esc(CFG.version)}</span></div>`;
  $("#side").innerHTML = h;
}
function renderTop() {
  const s = S.sess; $("#top").innerHTML = `<button class="iconbtn menu-btn" data-act="menu" aria-label="القائمة">${ico("menu")}</button>
  <div class="crumb"><span>${esc((S.store && S.store.name) || "")}</span><span class="dim">/</span><b>${NAME[S.route]}</b></div>
  <span class="ctl">${esc(s.device.name)}${s.device.location_id ? " · " + esc(locName(s.device.location_id)) : ""}</span>
  <button class="ctl" data-act="me" title="تغيير الرمز">${esc(s.staff.name)} · ${esc(s.role.name)}</button>
  <button class="iconbtn" data-act="theme" aria-label="الوضع الليلي">${ico("moon")}</button>
  <button class="iconbtn" data-act="lock" aria-label="قفل" title="قفل">${ico("lock")}</button>`;
}
function header(acts) { return `<div class="ph"><div><div class="eyebrow">${esc((S.store && S.store.name) || "")}</div><h1>${NAME[S.route]}</h1><p>${SUB[S.route]}</p></div>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`; }
function render() { renderSide(); renderTop(); $("#view").innerHTML = V[S.route](); $("#side").classList.remove("open"); if (H[S.route]) H[S.route](); }
function go(r) { if (!allowed(r)) return; S.route = r; ls("minzo-route", r); render(); scrollTo({ top: 0 }); }

/* =====================================================================
   SCREENS
   ===================================================================== */
const V = {}, H = {};
V.dash = () => {
  const sc = seeCost(), byLoc = S.locs.map(l => { const rows = S.stock.filter(s => s.location_id === l.id); const val = rows.reduce((a, s) => { const it = S.items.find(i => i.id === s.item_id); return a + (+s.qty || 0) * (it ? +it.last_cost : 0); }, 0); return { l, n: rows.filter(r => +r.qty > 0).length, val }; });
  const low = S.items.filter(i => +i.min_qty > 0 && stockOf(i.id) <= +i.min_qty);
  let h = header();
  h += `<div class="grid g4">${[["الأصناف", S.items.length], ["أصناف ليها رصيد", new Set(S.stock.filter(s => +s.qty > 0).map(s => s.item_id)).size], ["وصلت للحد الأدنى", low.length], [sc ? "قيمة المخزون (آخر تكلفة)" : "الأماكن", sc ? fmt(byLoc.reduce((a, x) => a + x.val, 0)) : S.locs.length]].map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div></div>`).join("")}</div>`;
  h += `<div class="grid g2"><div class="card rise"><h3>المخزون في كل مكان</h3><div class="tw"><table><thead><tr><th>المكان</th><th class="n">أصناف ليها رصيد</th>${sc ? `<th class="n">القيمة</th>` : ""}</tr></thead><tbody>${byLoc.map(x => `<tr><td>${esc(x.l.name)}</td><td class="n">${x.n}</td>${sc ? `<td class="n">${fmt(x.val)}</td>` : ""}</tr>`).join("")}</tbody></table></div></div>
  <div class="card rise"><h3>أصناف وصلت للحد الأدنى</h3>${low.length ? `<div class="tw"><table><tbody>${low.slice(0, 12).map(i => `<tr><td>${esc(i.name)}</td><td class="n">${num(stockOf(i.id))} / ${num(i.min_qty)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">مفيش أصناف تحت الحد الأدنى.</p>`}</div></div>`;
  if (!S.items.length) h += `<div class="card lux rise" style="text-align:center"><h3 style="justify-content:center">النظام فاضي ولسه بيبدأ</h3><p class="muted">ابدأ بإضافة الأصناف واحد واحد، أو استوردها من Excel مع أرصدة أول المدة.</p><div class="row" style="justify-content:center;gap:8px">${allowed("items") && can("items", "a") ? `<button class="btn" data-go="items">إضافة صنف</button>` : ""}${allowed("io") ? `<button class="btn gold" data-go="io">استيراد من Excel</button>` : ""}</div></div>`;
  return h;
};

/* ---------- items ---------- */
V.items = () => {
  const list = S.items.filter(i => (S.dep === "all" || i.department_id === +S.dep) && (!S.q || norm(i.name + " " + (i.barcode || "") + " " + i.code).includes(norm(S.q))));
  let h = header(can("items", "a") ? `<button class="btn gold" data-act="itemNew">${ico("plus")} صنف جديد</button>` : "");
  h += `<div class="row rise" style="gap:8px"><input class="inp" id="iq" placeholder="ابحث بالاسم أو الباركود أو الكود" value="${esc(S.q)}" style="flex:1;min-width:200px"><select class="inp" id="idep" style="width:auto"><option value="all">كل الأقسام</option>${S.depts.map(d => `<option value="${d.id}" ${+S.dep === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الصنف</th><th>القسم / المجموعة</th><th>الوحدة</th><th class="n">سعر البيع</th>${seeCost() ? `<th class="n">آخر تكلفة</th>` : ""}<th class="n">الرصيد</th><th></th></tr></thead><tbody>${list.slice(0, 400).map(i => `<tr><td class="pname">${esc(i.name)}<small>${esc(i.code)}${i.barcode ? " · " + esc(i.barcode) : ""}${i.serial_required ? " · مسلسل" : ""}</small></td><td>${esc((S.depts.find(d => d.id === i.department_id) || {}).name || "—")}${i.group_id ? `<br><span class="dim" style="font-size:12px">${esc((S.groups.find(g => g.id === i.group_id) || {}).name || "")}</span>` : ""}</td><td>${UNITS[i.unit]}</td><td class="n">${fmt(i.sale_price, 1)}</td>${seeCost() ? `<td class="n">${fmt(i.last_cost, 1)}</td>` : ""}<td class="n">${num(stockOf(i.id))}</td><td>${can("items", "e") ? `<button class="btn sm ghost" data-act="itemEdit" data-id="${i.id}">تعديل</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">${S.items.length ? "مفيش نتايج." : "لسه مفيش أصناف."}</td></tr>`}</tbody></table></div>`;
  if (list.length > 400) h += `<p class="dim">بيظهر أول 400 — استخدم البحث.</p>`;
  return h;
};
H.items = () => { const qi = $("#iq"); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; render(); const n = $("#iq"); n.focus(); n.setSelectionRange(p, p); }; $("#idep").onchange = e => { S.dep = e.target.value; render(); }; };
function ean13() { let b = "200" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"); let s = 0; for (let i = 0; i < 12; i++) s += +b[i] * (i % 2 ? 3 : 1); return b + ((10 - s % 10) % 10); }
function itemModal(it) {
  const x = it || { unit: "piece", sale_price: "", min_qty: 0, warranty_months: 0, serial_required: false, department_id: S.depts[0] && S.depts[0].id };
  const groupsOf = d => S.groups.filter(g => g.department_id === +d);
  modal(`<h2>${it ? "تعديل صنف" : "صنف جديد"}</h2><div class="stack" style="margin-top:10px">
   <div class="field"><label>اسم الصنف</label><input class="inp" id="mName" value="${esc(x.name || "")}"></div>
   <div class="grid g2"><div class="field"><label>الباركود</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="inp num" id="mBc" value="${esc(x.barcode || "")}" placeholder="امسحه بالسكانر"><button class="btn sm" id="mGen" title="للأصناف اللي من غير باركود">توليد</button></div></div>
   <div class="field"><label>الوحدة</label><select class="inp" id="mUnit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}" ${x.unit === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
   <div class="field"><label>القسم</label><select class="inp" id="mDep">${S.depts.map(d => `<option value="${d.id}" ${x.department_id === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
   <div class="field"><label>المجموعة</label><div class="row" style="flex-wrap:nowrap;gap:6px"><select class="inp" id="mGrp"><option value="">— بدون —</option>${groupsOf(x.department_id).map(g => `<option value="${g.id}" ${x.group_id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select><button class="btn sm" id="mGrpNew" title="مجموعة جديدة">${ico("plus")}</button></div></div>
   <div class="field"><label>سعر البيع</label><input class="inp num" id="mPrice" type="number" min="0" step="0.01" value="${x.sale_price}"></div>
   <div class="field"><label>الحد الأدنى للرصيد</label><input class="inp num" id="mMin" type="number" min="0" value="${x.min_qty}"></div>
   <div class="field"><label>مدة الضمان (شهر)</label><input class="inp num" id="mWar" type="number" min="0" value="${x.warranty_months}"></div>
   <div class="field" id="mLenF"><label>أقل طول يتباع (متر)</label><input class="inp num" id="mLen" type="number" min="0" step="0.1" value="${x.min_length || ""}"></div></div>
   <label class="row" style="gap:8px"><input type="checkbox" class="ck" id="mSer" ${x.serial_required ? "checked" : ""}> بيتباع بمسلسل (أجهزة كهربائية)</label>
   ${it ? `<div class="field"><label>سبب التعديل (إجباري لو غيّرت السعر)</label><input class="inp" id="mRsn"></div>` : ""}
   <div id="mErr"></div>
   <div class="row" style="justify-content:space-between">${it && can("items", "d") ? `<button class="btn sm danger" id="mHide">إخفاء الصنف</button>` : "<span></span>"}<span class="row" style="gap:8px"><button class="btn ghost" id="mCancel">إلغاء</button><button class="btn gold" id="mSave">حفظ</button></span></div></div>`);
  const lenF = () => { $("#mLenF").style.display = $("#mUnit").value === "meter" ? "" : "none"; }; lenF();
  $("#mUnit").onchange = lenF; $("#mCancel").onclick = closeModal; $("#mGen").onclick = e => { e.preventDefault(); $("#mBc").value = ean13(); };
  $("#mDep").onchange = () => { $("#mGrp").innerHTML = `<option value="">— بدون —</option>` + groupsOf($("#mDep").value).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join(""); };
  $("#mGrpNew").onclick = async e => { e.preventDefault(); const n = prompt("اسم المجموعة الجديدة"); if (!n) return; try { const id = await rpc("group_save", { p_token: T(), p_department: +$("#mDep").value, p_parent: null, p_name: n }); S.groups.push({ id, department_id: +$("#mDep").value, name: n }); $("#mDep").onchange(); $("#mGrp").value = id; } catch (er) { toast(errText(er), true); } };
  const save = async (extra, btn) => {
    const price = $("#mPrice").value, p = Object.assign({ name: $("#mName").value.trim(), barcode: $("#mBc").value.trim() || null, unit: $("#mUnit").value, department_id: $("#mDep").value, group_id: $("#mGrp").value || null, sale_price: price === "" ? null : +price, min_qty: +$("#mMin").value || 0, warranty_months: +$("#mWar").value || 0, min_length: $("#mUnit").value === "meter" ? ($("#mLen").value || null) : null, serial_required: $("#mSer").checked }, it ? { id: it.id, updated_at: it.updated_at, reason: ($("#mRsn") || {}).value || null } : {}, extra || {});
    if (!p.name) return ($("#mErr").innerHTML = `<div class="warnbox">اكتب اسم الصنف.</div>`);
    if (p.sale_price == null || p.sale_price < 0) return ($("#mErr").innerHTML = `<div class="warnbox">اكتب سعر البيع.</div>`);
    if (it && +it.sale_price !== +p.sale_price && (!p.reason || p.reason.trim().length < 3)) return ($("#mErr").innerHTML = `<div class="warnbox">غيّرت السعر — اكتب السبب.</div>`);
    busy(btn, true);
    try { await rpc("item_save", { p_token: T(), p }); closeModal(); toast("اتحفظ."); await loadItems(); render(); }
    catch (er) { $("#mErr").innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; busy(btn, false); }
  };
  $("#mSave").onclick = e => save(null, e.target);
  const hb = $("#mHide"); if (hb) hb.onclick = e => { if (confirm("الصنف هيتخفى من البيع والقوائم، ويفضل في التقارير. متأكد؟")) save({ hidden: true }, e.target); };
}

/* ---------- import ---------- */
const IFIELDS = [["name", "اسم الصنف", 1, ["اسم", "الصنف", "name", "item", "description", "البيان"]], ["barcode", "الباركود", 0, ["باركود", "barcode", "ean", "upc"]], ["code", "الكود الداخلي", 0, ["كود", "code", "sku", "رقم الصنف"]],
  ["department", "القسم", 1, ["قسم", "department", "category", "الفئة"]], ["group", "المجموعة", 0, ["مجموعة", "group", "sub", "النوع"]], ["unit", "الوحدة", 0, ["وحدة", "unit", "uom"]],
  ["sale_price", "سعر البيع", 1, ["سعر البيع", "سعر", "price", "sale"]], ["cost", "التكلفة", 0, ["تكلفة", "cost", "سعر الشراء", "purchase"]], ["qty", "الرصيد", 0, ["رصيد", "كمية", "qty", "quantity", "stock"]],
  ["min_qty", "الحد الأدنى", 0, ["حد أدنى", "الحد الادنى", "min"]], ["serial_required", "بمسلسل؟", 0, ["مسلسل", "serial"]], ["warranty_months", "الضمان (شهر)", 0, ["ضمان", "warranty"]], ["serials", "المسلسلات (مفصولة بفاصلة)", 0, ["المسلسلات", "serials", "serial numbers"]]];
V.io = () => {
  const I = S.imp;
  let h = header(`<button class="btn sm" data-act="impTpl">تنزيل قالب Excel</button>`);
  h += `<div class="card lux rise"><h3>١ · اختار الملف</h3><p class="muted" style="margin-top:0">Excel أو CSV، بأي ترتيب أعمدة. أول صف لازم يكون عناوين الأعمدة.</p><input type="file" id="impFile" class="inp" accept=".xlsx,.xls,.csv">${I ? `<div class="okbox" style="margin-top:10px">${esc(I.file)} · ${I.rows.length} صف</div>` : ""}</div>`;
  if (!I) return h;
  h += `<div class="card rise"><h3>٢ · اربط أعمدة الملف بالحقول</h3>${IFIELDS.map(([k, n, req]) => `<div class="maprow"><b>${n}${req ? ` <span class="req">*</span>` : ""}</b><select class="inp" data-map="${k}"><option value="-1">— مش موجود —</option>${I.heads.map((x, i) => `<option value="${i}" ${I.map[k] === i ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>`).join("")}
   <div class="field" style="margin-top:12px"><label>الرصيد ده رصيد أول المدة في</label><select class="inp" id="impLoc"><option value="">— الملف من غير أرصدة —</option>${S.locs.map(l => `<option value="${l.id}" ${+I.loc === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
   <p class="dim" style="font-size:12.5px">القسم لازم يكون واحد من: ${S.depts.map(d => esc(d.name)).join("، ")}. الوحدة: قطعة، طقم، متر، دستة، جهاز. المجموعات الجديدة بتتعمل لوحدها.</p>
   <div class="row" style="gap:8px"><button class="btn" data-act="impDry">٣ · تجربة من غير حفظ</button></div></div>`;
  if (I.res) {
    const r = I.res;
    h += `<div class="card rise ${r.errors.length ? "" : "lux"}"><h3>نتيجة التجربة</h3><div class="row" style="gap:8px"><span class="chip ok">${r.new} جديد</span><span class="chip info">${r.updated} تحديث</span><span class="chip ${r.errors.length ? "bad" : "plain"}">${r.errors.length} صف فيه أخطاء</span></div>
     ${r.errors.length ? `<div class="tw" style="margin-top:10px"><table><thead><tr><th class="n">الصف</th><th>الصنف</th><th>الأخطاء</th></tr></thead><tbody>${r.errors.slice(0, 200).map(e => `<tr><td class="n">${e.row + 1}</td><td>${esc(e.name || "—")}</td><td><ul class="errlist" style="margin:0;padding-inline-start:18px">${e.errors.map(x => `<li>${esc(x)}</li>`).join("")}</ul></td></tr>`).join("")}</tbody></table></div><p class="muted">صلّح الأخطاء في الملف وارفعه تاني. مفيش حاجة اتحفظت.</p>`
      : `<div class="okbox" style="margin-top:10px">مفيش أخطاء. ${I.loc ? "الأرصدة هتتسجّل رصيد أول المدة في " + esc(locName(+I.loc)) + " بتكلفتها." : "الملف من غير أرصدة."}</div><button class="btn gold" style="margin-top:10px" data-act="impGo">٤ · حفظ فعلي</button>`}</div>`;
  }
  return h;
};
H.io = () => {
  $("#impFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" }), ws = wb.Sheets[wb.SheetNames[0]], aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).filter(r => r.some(c => String(c).trim() !== ""));
      if (aoa.length < 2) return toast("الملف فاضي أو مفيهوش غير العناوين.", true);
      const heads = aoa[0].map(x => String(x).trim()), map = {};
      const used = new Set();   /* exact header match first, then "contains"; each column is used once */
      IFIELDS.forEach(([k, n, , keys]) => { let i = heads.findIndex((hh, j) => !used.has(j) && [n, ...keys].some(w => norm(hh) === norm(w))); if (i < 0) i = heads.findIndex((hh, j) => !used.has(j) && keys.some(w => norm(hh).includes(norm(w)))); map[k] = i; if (i >= 0) used.add(i); });
      S.imp = { file: f.name, heads, rows: aoa.slice(1), map, loc: "", res: null }; render();
    } catch (er) { toast("مش قادر يقرا الملف: " + er.message, true); }
  };
  document.querySelectorAll("[data-map]").forEach(s => s.onchange = () => { S.imp.map[s.dataset.map] = +s.value; S.imp.res = null; });
  const l = $("#impLoc"); if (l) l.onchange = () => { S.imp.loc = l.value; S.imp.res = null; render(); };
};
function impRows() {
  const I = S.imp, g = (r, k) => I.map[k] >= 0 ? r[I.map[k]] : "";
  return I.rows.map(r => { const o = {}; IFIELDS.forEach(([k]) => { let v = g(r, k); if (v === undefined || v === null) v = ""; if (typeof v === "string") v = v.trim(); if (v !== "") o[k] = v; });
    ["sale_price", "cost", "qty", "min_qty"].forEach(k => { if (o[k] !== undefined) { const n = +String(o[k]).replace(/[,٬\s]/g, "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)); o[k] = isNaN(n) ? -1 : n; } });
    if (o.barcode !== undefined) o.barcode = String(o.barcode).replace(/\.0$/, "");
    if (o.serials) o.serials = String(o.serials).split(/[,،;\n]/).map(x => x.trim()).filter(Boolean); else delete o.serials;
    return o; });
}
async function impRun(commit, btn) {
  const miss = IFIELDS.filter(([k, , req]) => req && !(S.imp.map[k] >= 0)); if (miss.length) return toast("اربط الأعمدة الإلزامية: " + miss.map(x => x[1]).join("، "), true);
  busy(btn, true);
  try { const r = await rpc("items_import", { p_token: T(), p_rows: impRows(), p_location: S.imp.loc ? +S.imp.loc : null, p_commit: commit });
    if (commit) { toast(`اتحفظ: ${r.new} جديد · ${r.updated} تحديث.`); S.imp = null; await loadItems(); go("items"); return; }
    S.imp.res = r; render(); }
  catch (er) { toast(errText(er), true); busy(btn, false); }
}

/* ---------- stock ---------- */
V.stock = () => {
  const sc = seeCost(), locs = S.locs, list = S.items.filter(i => !S.q || norm(i.name + " " + (i.barcode || "")).includes(norm(S.q)));
  let h = header();
  h += `<div class="row rise" style="gap:8px"><input class="inp" id="sq" placeholder="ابحث بالاسم أو الباركود" value="${esc(S.q)}" style="flex:1;min-width:200px"></div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الصنف</th>${locs.map(l => `<th class="n">${esc(l.name)}</th>`).join("")}<th class="n">الإجمالي</th>${sc ? `<th class="n">القيمة</th>` : ""}</tr></thead><tbody>${list.slice(0, 500).map(i => { const tot = stockOf(i.id), low = +i.min_qty > 0 && tot <= +i.min_qty;
    return `<tr><td class="pname">${esc(i.name)}<small>${UNITS[i.unit]}${low ? ` · <span style="color:var(--warn)">تحت الحد الأدنى</span>` : ""}</small></td>${locs.map(l => `<td class="n">${num(stockOf(i.id, l.id)) || "—"}</td>`).join("")}<td class="n"><b>${num(tot)}</b></td>${sc ? `<td class="n">${fmt(tot * i.last_cost)}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="${locs.length + 3}" class="muted">لسه مفيش أصناف.</td></tr>`}</tbody></table></div>`;
  return h;
};
H.stock = () => { const qi = $("#sq"); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; render(); const n = $("#sq"); n.focus(); n.setSelectionRange(p, p); }; };

/* ---------- staff ---------- */
V.users = () => { const L = S.staffList; let h = header(`<button class="btn gold" data-act="staffNew">${ico("plus")} موظف جديد</button>`);
  if (!L) { setTimeout(loadStaff, 0); return h + `<div class="spin"></div>`; }
  h += `<div class="tw rise"><table><thead><tr><th>الاسم</th><th>الدور</th><th>المكان</th><th>الرمز</th><th>الحالة</th><th></th></tr></thead><tbody>${L.map(u => `<tr><td>${esc(u.name)}</td><td>${esc((S.roles.find(r => r.id === u.role_id) || {}).name || u.role_id)}</td><td>${u.location_id ? esc(locName(u.location_id)) : "كل الأماكن"}</td><td>${u.has_pin ? (u.must_change ? `<span class="chip warn">مؤقت</span>` : `<span class="chip ok">متغيّر</span>`) : `<span class="chip bad">مفيش</span>`}</td><td>${u.active ? `<span class="chip ok">شغال</span>` : `<span class="chip plain">موقوف</span>`}</td><td><button class="btn sm ghost" data-act="staffEdit" data-id="${u.id}">تعديل</button></td></tr>`).join("")}</tbody></table></div>`;
  return h; };
async function loadStaff() { try { const [l, roles] = await Promise.all([rpc("staff_list", { p_token: T() }), q("roles", "id,name,max_discount_pct,max_amount", x => x.order("created_at"))]); S.staffList = l; S.roles = roles; if (S.route === "users") render(); } catch (e) { toast(errText(e), true); } }
function genPin() { for (;;) { const p = String(Math.floor(100000 + Math.random() * 900000)); const d = [...p].map(Number); if (/^(\d)\1+$/.test(p) || d.every((x, i) => !i || x === d[i - 1] + 1) || d.every((x, i) => !i || x === d[i - 1] - 1)) continue; return p; } }
function staffModal(u) {
  const own = S.sess.role.id === "owner", top = own || S.sess.role.id === "gm", roles = S.roles.filter(r => own || (r.id !== "owner" && (top || !["gm", "mgr", "acct"].includes(r.id))));
  const x = u || { name: "", role_id: "cashier", location_id: S.sess.staff.location_id, active: true };
  modal(`<h2>${u ? "تعديل موظف" : "موظف جديد"}</h2><div class="stack" style="margin-top:10px">
   <div class="field"><label>الاسم</label><input class="inp" id="uName" value="${esc(x.name)}"></div>
   <div class="grid g2"><div class="field"><label>الدور</label><select class="inp" id="uRole">${roles.map(r => `<option value="${r.id}" ${x.role_id === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div>
   <div class="field"><label>المكان</label><select class="inp" id="uLoc" ${top ? "" : "disabled"}><option value="">كل الأماكن</option>${S.locs.map(l => `<option value="${l.id}" ${x.location_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div></div>
   <div class="field"><label>${u ? "رمز مؤقت جديد (اختياري)" : "رمز مؤقت"} — الموظف لازم يغيّره أول دخول</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="inp num" id="uPin" value="${u ? "" : genPin()}"><button class="btn sm" id="uGen">توليد</button></div></div>
   ${u ? `<label class="row" style="gap:8px"><input type="checkbox" class="ck" id="uAct" ${x.active ? "checked" : ""}> الحساب شغال</label>` : ""}
   <div id="uErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" id="uCancel">إلغاء</button><button class="btn gold" id="uSave">حفظ</button></div></div>`);
  $("#uCancel").onclick = closeModal; $("#uGen").onclick = () => { $("#uPin").value = genPin(); };
  $("#uSave").onclick = async e => {
    const name = $("#uName").value.trim(), pin = $("#uPin").value.trim(); if (!name) return ($("#uErr").innerHTML = `<div class="warnbox">اكتب الاسم.</div>`);
    if (!u && !pin) return ($("#uErr").innerHTML = `<div class="warnbox">اكتب رمز مؤقت.</div>`);
    busy(e.target, true);
    try { await rpc("staff_save", { p_token: T(), p_id: u ? u.id : null, p_name: name, p_role: $("#uRole").value, p_location: $("#uLoc").value ? +$("#uLoc").value : null, p_active: u ? $("#uAct").checked : true, p_temp_pin: pin || null });
      closeModal(); if (pin) modal(`<h2>الرمز المؤقت</h2><p class="muted">ادّي الرمز ده لـ ${esc(name)}. هيطلب منه يغيّره أول ما يدخل.</p><div class="okbox" style="text-align:center;font-size:28px;letter-spacing:6px" class="num">${esc(pin)}</div><button class="btn gold" style="width:100%;margin-top:12px" onclick="document.getElementById('modal').remove()">تمام</button>`);
      S.staffList = null; render(); }
    catch (er) { $("#uErr").innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; busy(e.target, false); }
  };
}

/* ---------- devices ---------- */
V.devices = () => { const D = S.devList; let h = header();
  if (!D) { setTimeout(loadDevices, 0); return h + `<div class="spin"></div>`; }
  const pend = D.filter(d => !d.active && !d.disabled_once), act = D.filter(d => d.active);
  if (pend.length) h += `<div class="card lux rise"><h3>أجهزة مستنية الاعتماد</h3>${pend.map(d => `<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)"><span><b>${esc(d.name)}</b><br><span class="dim num" style="font-size:12px">${esc(d.id.slice(0, 8))} · ${new Date(d.created_at).toLocaleString("ar-EG")}</span></span><button class="btn sm gold" data-act="devEdit" data-id="${d.id}">اعتماد</button></div>`).join("")}</div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الجهاز</th><th>النوع</th><th>المكان</th><th>آخر ظهور</th><th>الحالة</th><th></th></tr></thead><tbody>${D.map(d => `<tr><td>${esc(d.name)}${d.id === S.sess.device.id ? ` <span class="chip gold plain">الجهاز ده</span>` : ""}</td><td>${KINDS[d.kind] || d.kind}</td><td>${d.location_id ? esc(locName(d.location_id)) : "—"}</td><td class="num dim">${d.last_seen ? new Date(d.last_seen).toLocaleString("ar-EG") : "—"}</td><td>${d.active ? `<span class="chip ok">شغال</span>` : `<span class="chip warn">مستني / موقوف</span>`}</td><td><button class="btn sm ghost" data-act="devEdit" data-id="${d.id}">تعديل</button></td></tr>`).join("")}</tbody></table></div>
  <div class="okbox rise">لتسجيل جهاز جديد: افتح رابط النظام على الجهاز ده، واكتب اسمه، وبعدها اعتمده من هنا وحدد نوعه ومكانه. جهاز الكاشير لازم يبقى ليه مكان (معرض) عشان الوردية والدرج.</div>`;
  return h; };
async function loadDevices() { try { S.devList = await q("devices", "*", x => x.order("created_at")); if (S.route === "devices") render(); } catch (e) { toast(errText(e), true); } }
function devModal(d) {
  modal(`<h2>${d.active ? "تعديل جهاز" : "اعتماد جهاز"}</h2><div class="stack" style="margin-top:10px">
   <div class="field"><label>الاسم</label><input class="inp" id="vName" value="${esc(d.name)}"></div>
   <div class="grid g2"><div class="field"><label>النوع</label><select class="inp" id="vKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${d.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
   <div class="field"><label>المكان</label><select class="inp" id="vLoc"><option value="">— بدون —</option>${S.locs.map(l => `<option value="${l.id}" ${d.location_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div></div>
   <label class="row" style="gap:8px"><input type="checkbox" class="ck" id="vAct" ${d.active || !d.active ? "checked" : ""}> الجهاز شغال</label>
   <div id="vErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" id="vCancel">إلغاء</button><button class="btn gold" id="vSave">حفظ</button></div></div>`);
  $("#vCancel").onclick = closeModal;
  $("#vSave").onclick = async e => { busy(e.target, true);
    try { await rpc("device_set", { p_token: T(), p_device: d.id, p_name: $("#vName").value.trim(), p_kind: $("#vKind").value, p_location: $("#vLoc").value ? +$("#vLoc").value : null, p_active: $("#vAct").checked });
      closeModal(); toast("اتحفظ."); S.devList = null; if (d.id === S.sess.device.id) { S.sess.device.location_id = $("#vLoc").value ? +$("#vLoc").value : null; } render(); }
    catch (er) { $("#vErr").innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; busy(e.target, false); } };
}

/* =====================================================================
   EVENTS
   ===================================================================== */
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
  const a = e.target.closest("[data-act]"); if (!a) return; const k = a.dataset.act;
  if (k === "menu") $("#side").classList.toggle("open");
  else if (k === "lock") lockNow();
  else if (k === "me") changePin(false);
  else if (k === "theme") { const cur = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = cur; ls("minzo-theme", cur); }
  else if (k === "itemNew") itemModal(null);
  else if (k === "itemEdit") itemModal(S.items.find(i => i.id === a.dataset.id));
  else if (k === "impDry") impRun(false, a);
  else if (k === "impGo") impRun(true, a);
  else if (k === "impTpl") { const H0 = IFIELDS.map(f => f[1]); const ws = XLSX.utils.aoa_to_sheet([H0, ["طقم حلل جرانيت ١٠ قطع", "", "", "أدوات منزلية", "حلل وأواني", "طقم", 4200, 2850, 10, 3, "لا", 0, ""], ["غسالة ٧ كيلو", "", "", "أجهزة كهربائية", "غسالات", "جهاز", 21900, 15800, 2, 1, "نعم", 24, "SN-001, SN-002"]]); ws["!views"] = [{ RTL: true }]; ws["!cols"] = H0.map(() => ({ wch: 18 })); const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, "الأصناف"); XLSX.writeFile(wb, "قالب-استيراد-الأصناف.xlsx"); }
  else if (k === "staffNew") staffModal(null);
  else if (k === "staffEdit") staffModal(S.staffList.find(u => u.id === a.dataset.id));
  else if (k === "devEdit") devModal(S.devList.find(d => d.id === a.dataset.id));
});
{ const t = ls("minzo-theme"); if (t) document.documentElement.dataset.theme = t; }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
