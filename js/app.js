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
  NO_OPEN_SHIFT: "مفيش وردية مفتوحة على درج الجهاز ده.", PLAN_REQUIRED: "اختار خطة التقسيط.", CUSTOMER_REQUIRED: "لازم اسم العميل وموبايله.", APPROVER_NOT_VALID: "رمز الموافقة غلط أو صلاحيته مش كفاية.",
  RETURN_MORE_THAN_SOLD: "الكمية أكتر من اللي اتباع (أو رجع قبل كده).", HAS_RETURNS: "الفاتورة عليها مرتجع — مينفعش تتلغي كلها.", INSTALMENT_SETTLED: "شركة التقسيط حوّلت فلوس الفاتورة دي — مينفعش تتلغي.",
  REASON_REQUIRED: "اكتب السبب.", REF_REQUIRED: "اكتب رقم التحويل.", HELD_ALREADY_TAKEN: "الفاتورة دي اتسترجعت قبل كده.", SELLER_CANNOT_COLLECT: "البائع بيبعت الفاتورة للكاشير — مش بيقبض.",
  INSUFFICIENT_STOCK: "الرصيد مش كفاية", SERIAL_NOT_AVAILABLE: "المسلسل ده مش متاح في المعرض", DAY_CLOSING_WINDOW: "اليوم في وقت التقفيل — البيع مقفول لحد ميعاد الفتح.", UNDERPAID: "المدفوع أقل من المطلوب.",
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
  if (ERR[k] && m.includes(":") && ["INSUFFICIENT_STOCK", "SERIAL_NOT_AVAILABLE"].includes(k)) return ERR[k] + ": " + m.split(":").slice(1).join(":");
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
  transfers: "M4 7h13l-3-3M20 17H7l3 3", cash: "M2 6h20v12H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 12h.01M18 12h.01",
  inst: "M3 6h18v12H3zM3 10h18M7 15h3M14 15h3",
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
    S.sess = r; S.idle = Date.now(); S.dir = null; S.cash = null; S.tr = null; P.shift = undefined; setTimeout(qFlush, 1500);
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
const NAV = [["التشغيل", ["dash", "pos", "stock", "transfers"]], ["المال", ["cash", "inst"]], ["التجارة", ["items", "io"]], ["النظام", ["users", "devices"]]];
const NAME = { inst: "شركات التقسيط", pos: "نقطة البيع", cash: "الخزنة والورديات", transfers: "التحويلات", dash: "لوحة التحكم", items: "الأصناف", io: "استيراد الأصناف والأرصدة", stock: "المخزون", users: "الموظفين والرموز", devices: "الأجهزة" };
const SUB = { inst: "البيع بالتقسيط عن طريق ValU وأمان وكونتكت وغيرهم: الخطط، ومين بيشيل العمولة، والمستحق عند كل شركة لحد ما تحوّل.", pos: "", cash: "رصيد الأدراج والخزنة، واعتماد تسليم الورديات، وفواتير الأيام الأخيرة وإلغاؤها.", transfers: "نقل البضاعة بين المعرضين والمخزن بطلب واعتماد وشحن واستلام.", dash: "نظرة سريعة على الأصناف والمخزون في كل مكان.", items: "كل صنف بباركوده ووحدته وسعره، ومسلسل وضمان للأجهزة.", io: "استورد الأصناف من Excel أو CSV بأي شكل أعمدة، ومعاها أرصدة أول المدة.", stock: "رصيد كل صنف في المعرضين والمخزن.", users: "ضيف موظفين وحدد دورهم وفرعهم، وادّيهم رمز مؤقت يغيّروه أول دخول.", devices: "اعتمد الأجهزة الجديدة وحدد نوع كل جهاز ومكانه." };
const allowed = r => ({ inst: can("inst") || ["owner", "gm"].includes(S.sess.role.id), pos: can("pos", "a"), cash: can("cash") || can("close"), transfers: can("transfers"), dash: can("dash") || can("items"), items: can("items"), io: can("io", "i") && can("items", "a"), stock: can("stock") || can("items"), users: has("users"), devices: has("devices") })[r];

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
   POINT OF SALE · SHIFTS · CASH · TRANSFERS
   ===================================================================== */
const PAYN = { cash: "نقدي", card: "فيزا", insta: "إنستاباي", wallet: "محفظة" };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const P = { cart: [], disc: 0, pin: "", cust: { name: "", phone: "" }, seller: "", plan: "", heldId: null, pay: { cash: "", card: "", insta: "", wallet: "", inst: "" }, dep: "all", q: "", shift: undefined, serials: [] };
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
async function loadDir() { if (!S.dir) S.dir = await rpc("staff_directory", { p_token: T() }); return S.dir; }
const who = id => ((S.dir || []).find(x => x.id === id) || {}).name || "—";

/* ---------- offline queue: sales are kept on this device and re-sent (the server ignores duplicates) ---------- */
const QK = "minzo-sale-queue";
const qGet = () => { try { return JSON.parse(ls(QK) || "[]"); } catch (e) { return []; } };
const qSet = a => ls(QK, JSON.stringify(a));
async function qFlush() {
  if (!T()) return; const a = qGet(); if (!a.length) return; const left = [];
  for (const x of a) { try { await rpc("sale_post", { p_token: T(), p: x }); } catch (e) { if (/fetch|network/i.test(e.message || "")) left.push(x); else { x._err = errText(e); left.push(x); } } }
  qSet(left); if (left.length < a.length) { toast(`اتبعت ${a.length - left.length} فاتورة كانت محفوظة على الجهاز.`); await loadItems().catch(() => {}); if (S.route === "pos" || S.route === "cash") render(); }
}
addEventListener("online", qFlush); setInterval(qFlush, 30000);

/* ---------- pricing preview (the server re-prices; this is for the screen only) ---------- */
function cartCalc() {
  const st = S.store || {}, vatOn = st.vat_registered && st.vat_from && today() >= st.vat_from;
  let gross = 0, vat = 0;
  P.cart.forEach(l => { const it = S.items.find(i => i.id === l.id); l.it = it; gross += it.sale_price * l.qty; });
  const disc = Math.round(gross * P.disc) / 100; let total = gross - disc;
  if (vatOn) { P.cart.forEach(l => { const r = (l.it.vat_rate != null ? +l.it.vat_rate : +st.vat_rate) / 100, sh = l.it.sale_price * l.qty * (1 - P.disc / 100); vat += st.prices_include_vat ? sh - sh / (1 + r) : sh * r; }); vat = Math.round(vat * 100) / 100; if (!st.prices_include_vat) total += vat; }
  const paid = Object.values(P.pay).reduce((a, v) => a + (+v || 0), 0);
  return { gross, disc, vat, total: Math.round(total * 100) / 100, paid, change: paid - total, vatOn, incl: st.prices_include_vat };
}

V.pos = () => {
  const d = S.sess.device, loc = d.location_id;
  let h = header();
  if (!loc || (S.locs.find(l => l.id === loc) || {}).kind !== "showroom") return h + `<div class="card lux rise" style="text-align:center"><h3 style="justify-content:center">الجهاز ده مش مربوط بمعرض</h3><p class="muted">البيع بيتم من جهاز مربوط بمعرض عشان الدرج والوردية. المالك أو المدير العام يحدد مكان الجهاز من شاشة «الأجهزة».</p>${has("devices") ? `<button class="btn gold" data-go="devices">شاشة الأجهزة</button>` : ""}</div>`;
  if (P.shift === undefined) { setTimeout(posShift, 0); return h + `<div class="spin"></div>`; }
  const isSeller = S.sess.role.id === "seller";
  if (!P.shift && !isSeller) return h + `<div class="card lux rise" style="max-width:480px"><h3>مفيش وردية مفتوحة على درج ${esc(locName(loc))}</h3><div class="field"><label>رصيد الدرج في أول الوردية (الفكّة)</label><input class="inp num" id="shFloat" type="number" min="0" value="0"></div><button class="btn gold" style="margin-top:10px" data-act="shOpen">فتح وردية</button></div>`;
  const q = qGet(), c = cartCalc(), max = +S.sess.role.max_discount_pct || 0;
  const items = S.items.filter(i => (P.dep === "all" || i.department_id === +P.dep) && (!P.q || norm(i.name + " " + (i.barcode || "") + " " + i.code).includes(norm(P.q))));
  h = `<div class="ph"><div><div class="eyebrow">${esc(locName(loc))}${P.shift ? ` · وردية ${esc(P.shift.cashier_name)} من ${new Date(P.shift.opened_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}` : " · البائع بيجهّز الفاتورة للكاشير"}${P.heldNo ? ` · <b>${esc(P.heldNo)}</b>` : ""}</div><h1>${NAME.pos}</h1></div><div class="acts">${q.length ? `<span class="chip warn">${q.length} فاتورة محفوظة على الجهاز</span>` : ""}${isSeller ? "" : `<button class="btn sm" data-act="heldList">المعلّقة</button><button class="btn sm" data-act="shHand">تسليم الوردية</button>`}</div></div>`;
  h += `<div class="pos"><div class="stack" style="gap:12px;min-width:0">
   <div class="scan">${ico("items")}<input id="posQ" placeholder="امسح الباركود أو اكتب اسم الصنف" value="${esc(P.q)}" autocomplete="off"></div>
   <div class="tabs">${[["all", "الكل"], ...S.depts.map(x => [String(x.id), x.name])].map(([k, n]) => `<button data-act="posDep" data-k="${k}" class="${String(P.dep) === k ? "on" : ""}">${esc(n)}</button>`).join("")}</div>
   <div class="pgrid">${items.slice(0, 120).map(i => { const st = stockOf(i.id, loc); return `<button class="pcard ${st <= 0 ? "out" : ""}" data-act="posAdd" data-id="${i.id}"><b>${esc(i.name)}</b><span class="dim num" style="font-size:11.5px">${esc(i.barcode || i.code)}</span><div class="pr"><span class="num">${fmt(i.sale_price)}</span><span class="chip plain">${num(st)} ${UNITS[i.unit]}</span></div></button>`; }).join("") || `<p class="muted">${S.items.length ? "مفيش نتايج." : "لسه مفيش أصناف."}</p>`}</div></div>
  <div class="card cart stick"><h3>الفاتورة</h3>${P.cart.length ? P.cart.map((l, n) => { const it = l.it; const sers = P.serials.filter(s => s.item_id === it.id && !P.cart.some((o, m) => m !== n && o.serial === s.serial));
     return `<div class="cline"><div><div class="nm">${esc(it.name)}</div><span class="dim num" style="font-size:12px">${fmt(it.sale_price, 1)} × ${num(l.qty)} ${UNITS[it.unit]}</span></div><div class="stack" style="gap:6px;align-items:flex-end"><span class="num">${fmt(it.sale_price * l.qty, 1)}</span>${it.serial_required ? `<button class="btn sm ghost" data-act="posDel" data-n="${n}">حذف</button>` : it.unit === "meter" ? `<span class="row" style="gap:4px"><input class="inp num" style="width:80px;padding:4px 8px" type="number" min="0.1" step="0.1" data-mqty="${n}" value="${l.qty}"><button class="btn sm ghost" data-act="posDel" data-n="${n}">✕</button></span>` : `<span class="qty"><button data-act="posQty" data-n="${n}" data-d="-1">−</button><span>${l.qty}</span><button data-act="posQty" data-n="${n}" data-d="1">+</button></span>`}</div>
     ${it.serial_required ? `<div style="grid-column:1/-1" class="row"><span class="dim" style="font-size:12px">المسلسل</span><select class="inp" style="padding:5px 8px;font-size:12.5px;flex:1" data-ser="${n}"><option value="">— اختار —</option>${sers.map(s => `<option ${l.serial === s.serial ? "selected" : ""}>${esc(s.serial)}</option>`).join("")}</select>${it.warranty_months ? `<span class="chip gold plain">${it.warranty_months} شهر ضمان</span>` : ""}</div>` : ""}
     ${it.unit === "meter" ? `<div style="grid-column:1/-1" class="row"><span class="dim" style="font-size:12px">فاقد قص (سم) — اختياري</span><input class="inp num" type="number" min="0" style="width:90px;padding:4px 8px" data-waste="${n}" value="${l.waste || ""}"></div>` : ""}</div>`; }).join("") : `<div class="muted" style="padding:24px 0;text-align:center">امسح أول صنف</div>`}
   ${P.cart.length ? `<div class="stack" style="gap:2px;margin-top:8px"><div class="tot"><span class="muted">الإجمالي</span><span class="num">${fmt(c.gross, 1)}</span></div>
    <div class="tot"><span class="muted">خصم % <span class="dim">(حدّك ${max}%)</span></span><input class="inp num" style="width:70px;padding:4px 8px" type="number" min="0" max="100" id="posDisc" value="${P.disc}"></div>
    ${P.disc > max ? `<div class="warnbox">فوق حدّك — اكتب رمز مدير حدّه أعلى: <input class="inp num" type="password" id="posPin" style="margin-top:6px" value="${esc(P.pin)}"></div>` : ""}
    ${c.disc ? `<div class="tot up"><span>الخصم</span><span class="num">−${fmt(c.disc, 1)}</span></div>` : ""}
    ${c.vatOn ? `<div class="tot dim"><span>${c.incl ? "منها ضريبة القيمة المضافة" : "ضريبة القيمة المضافة"}</span><span class="num">${fmt(c.vat, 1)}</span></div>` : ""}
    <div class="tot big"><span>المطلوب</span><span class="num">${fmt(c.total, 1)}</span></div></div>
   <div class="field"><label>العميل ${P.cart.some(l => l.it.serial_required) || +P.pay.inst > 0 ? `<b style="color:var(--warn)">— إجباري للأجهزة</b>` : `<span class="dim">(اختياري)</span>`}</label><div class="row" style="flex-wrap:nowrap"><input class="inp" id="cName" placeholder="الاسم" value="${esc(P.cust.name)}"><input class="inp num" id="cPhone" placeholder="01xxxxxxxxx" value="${esc(P.cust.phone)}" inputmode="tel"></div></div>
   <div class="field"><label>البائع <span class="dim">(للعمولة)</span></label><select class="inp" id="posSeller"><option value="">— بدون —</option>${(S.dir || []).filter(x => x.active && x.role_id === "seller" && (!x.location_id || x.location_id === loc)).map(x => `<option value="${x.id}" ${P.seller === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
   ${isSeller ? `<div id="posErr"></div><div class="row" style="flex-wrap:nowrap"><button class="btn ghost" data-act="posClear">تفريغ</button><button class="btn gold" style="flex:1" data-act="heldSend">إرسال للكاشير · <span class="num">${fmt(c.total, 1)}</span></button></div>` : `<div class="field"><label>الدفع <button class="btn sm ghost" data-act="payAll" style="margin-inline-start:6px">الكل نقدي</button></label><div class="grid g2" style="gap:6px">${Object.entries(PAYN).map(([k, n]) => `<label class="row" style="gap:6px;flex-wrap:nowrap"><span class="dim" style="width:64px;font-size:12.5px">${n}</span><input class="inp num" type="number" min="0" data-pay="${k}" value="${esc(P.pay[k])}"></label>`).join("")}</div>
    ${(S.finPl || []).some(p => p.active) ? `<div class="row" style="gap:6px;flex-wrap:nowrap;margin-top:6px"><span class="dim" style="width:64px;font-size:12.5px">تقسيط</span><select class="inp" id="posPlan" style="flex:2;font-size:12.5px"><option value="">— الشركة والخطة —</option>${S.finPl.filter(p => p.active && (S.finCo.find(c0 => c0.id === p.company_id) || {}).active).map(p => `<option value="${p.id}" ${+P.plan === p.id ? "selected" : ""}>${esc(planName(p.id))} — ${p.payer === "store" ? "على المحل " + (+p.rate) + "%" : "على العميل"}</option>`).join("")}</select><input class="inp num" type="number" min="0" data-pay="inst" value="${esc(P.pay.inst)}" style="flex:1"></div>${P.plan && +P.pay.inst > 0 ? (() => { const pl = S.finPl.find(x => x.id === +P.plan), co = S.finCo.find(x => x.id === pl.company_id), cm = pl.payer === "store" ? +P.pay.inst * pl.rate / 100 : 0; return `<div class="${cm ? "warnbox" : "okbox"}" style="font-size:12.5px;margin-top:6px">الشركة هتحوّل ${fmt(+P.pay.inst - cm, 1)} بعد ${co.transfer_days} يوم${cm ? " · عمولة على المحل " + fmt(cm, 1) : ""}</div>`; })() : ""}` : ""}
    ${c.paid ? `<div class="tot" style="margin-top:6px"><span class="muted">${c.change >= 0 ? "الباقي للعميل" : "ناقص"}</span><span class="num" style="color:${c.change >= 0 ? "var(--ok)" : "var(--bad)"}">${fmt(Math.abs(c.change), 1)}</span></div>` : ""}</div>
   <div id="posErr"></div>
   <div class="row" style="flex-wrap:nowrap"><button class="btn ghost" data-act="posClear">تفريغ</button><button class="btn gold" style="flex:1" data-act="posPay">إتمام البيع · <span class="num">${fmt(c.total, 1)}</span></button></div>`}` : ""}</div></div>`;
  return h;
};
H.pos = () => {
  const qi = $("#posQ"); if (!qi) return;
  qi.focus();
  qi.oninput = () => { P.q = qi.value; const p = qi.selectionStart; render(); const n = $("#posQ"); n.focus(); n.setSelectionRange(p, p); };
  qi.onkeydown = e => { if (e.key !== "Enter") return; const v = qi.value.trim(); const it = S.items.find(i => i.barcode === v || i.code === v); if (it) { posAdd(it.id); P.q = ""; render(); } else if (v) toast("مفيش صنف بالباركود ده.", true); };
  const dsc = $("#posDisc"); if (dsc) dsc.onchange = () => { P.disc = Math.max(0, Math.min(100, +dsc.value || 0)); render(); };
  const pin = $("#posPin"); if (pin) pin.oninput = () => { P.pin = pin.value; };
  const cn = $("#cName"), cp = $("#cPhone"); if (cn) { cn.oninput = () => { P.cust.name = cn.value; }; cp.oninput = () => { P.cust.phone = cp.value; }; }
  const sl = $("#posSeller"); if (sl) sl.onchange = () => { P.seller = sl.value; };
  const pp = $("#posPlan"); if (pp) pp.onchange = () => { P.plan = pp.value; if (P.plan && !(+P.pay.inst > 0)) { const c = cartCalc(); P.pay = { cash: "", card: "", insta: "", wallet: "", inst: String(c.total) }; } render(); };
  document.querySelectorAll("[data-pay]").forEach(x => x.onchange = () => { P.pay[x.dataset.pay] = x.value; render(); });
  document.querySelectorAll("[data-ser]").forEach(x => x.onchange = () => { P.cart[+x.dataset.ser].serial = x.value; });
  document.querySelectorAll("[data-mqty]").forEach(x => x.onchange = () => { P.cart[+x.dataset.mqty].qty = Math.max(0.1, +x.value || 0.1); render(); });
  document.querySelectorAll("[data-waste]").forEach(x => x.onchange = () => { P.cart[+x.dataset.waste].waste = Math.max(0, +x.value || 0); });
};
async function posShift() {
  try { const [sh, ser] = await Promise.all([rpc("shift_current", { p_token: T() }), q("serials", "serial,item_id", x => x.eq("location_id", S.sess.device.location_id).eq("status", "in_stock").limit(5000)), loadDir(), loadFin()]);
    P.shift = sh; P.serials = ser; } catch (e) { P.shift = null; toast(errText(e), true); }
  if (S.route === "pos") render();
}
function posAdd(id) {
  const it = S.items.find(i => i.id === id); if (!it) return;
  if (it.serial_required) { P.cart.push({ id, qty: 1, serial: "" }); return; }
  const l = P.cart.find(x => x.id === id && !x.serial); if (l) l.qty = +(l.qty + 1).toFixed(3); else P.cart.push({ id, qty: 1 });
}
async function posPay(btn) {
  const c = cartCalc(), err = m => ($("#posErr").innerHTML = `<div class="warnbox">${esc(m)}</div>`);
  if (P.cart.some(l => l.it.serial_required && !l.serial)) return err("اختار المسلسل لكل جهاز.");
  if (P.cart.some(l => l.it.serial_required) && (!P.cust.name.trim() || !/^01\d{9}$/.test(P.cust.phone.trim()))) return err("الأجهزة محتاجة اسم العميل وموبايل صحيح.");
  if (+P.pay.inst > 0 && !P.plan) return err("اختار شركة التقسيط والخطة.");
  if (+P.pay.inst > 0 && (!P.cust.name.trim() || !/^01\d{9}$/.test(P.cust.phone.trim()))) return err("التقسيط محتاج اسم العميل وموبايل صحيح.");
  if (P.cust.phone && !/^01\d{9}$/.test(P.cust.phone.trim())) return err("رقم الموبايل غلط.");
  if (c.paid < c.total - 0.004) return err("المدفوع أقل من المطلوب.");
  const nonCash = c.paid - (+P.pay.cash || 0); if (nonCash > c.total + 0.004) return err("الفيزا والمحافظ أكتر من المطلوب — الباقي بيرجع من النقدي بس.");
  const p = { client_uuid: uuid(), lines: P.cart.map(l => ({ item_id: l.id, qty: l.qty, serial: l.serial || null, cut_waste_m: l.waste || null })), discount_pct: P.disc, approver_pin: P.disc > (+S.sess.role.max_discount_pct || 0) ? P.pin : null,
    customer: P.cust.phone ? { name: P.cust.name.trim(), phone: P.cust.phone.trim() } : null, seller_id: P.seller || null,
    payments: Object.entries(P.pay).filter(([, v]) => +v > 0).map(([m, v]) => m === "inst" ? { method: m, amount: +v, plan_id: +P.plan } : { method: m, amount: +v }), held_id: P.heldId || null };
  busy(btn, true);
  try { const r = await rpc("sale_post", { p_token: T(), p }); posDone(r, c); }
  catch (e) {
    if (/fetch|network/i.test(e.message || "")) { const a = qGet(); a.push(p); qSet(a); posDone({ no: "محفوظة على الجهاز", total: c.total, change: c.change, offline: true }, c); }
    else { err(errText(e)); busy(btn, false); }
  }
}
function posDone(r, c) {
  const lines = P.cart.map(l => ({ n: l.it.name, q: l.qty, u: UNITS[l.it.unit], p: l.it.sale_price, sn: l.serial }));
  const pays = Object.entries(P.pay).filter(([, v]) => +v > 0); P.planDone = P.plan;
  P.cart = []; P.disc = 0; P.pin = ""; P.cust = { name: "", phone: "" }; P.seller = ""; P.plan = ""; P.heldId = null; P.heldNo = null; P.pay = { cash: "", card: "", insta: "", wallet: "", inst: "" };
  modal(`<h2>${r.offline ? "اتحفظت على الجهاز" : "تم البيع"}</h2>${r.offline ? `<div class="warnbox">مفيش نت — الفاتورة اتحفظت على الجهاز وهتتبعت لوحدها أول ما النت يرجع.</div>` : ""}
   <div class="receipt" id="rcpt"><div style="text-align:center;font-family:var(--f-display);font-size:16px">${esc(S.store.name)}</div><div style="text-align:center" class="dim">${esc(locName(S.sess.device.location_id))} · ${new Date().toLocaleString("ar-EG")}</div><div style="text-align:center" class="num">${esc(r.no)}</div><div class="hr" style="margin:8px 0"></div>
   ${lines.map(x => `<div class="r"><span>${esc(x.n)} × ${num(x.q)}${x.sn ? `<br><span class="dim">SN ${esc(x.sn)}</span>` : ""}</span><span>${fmt(x.p * x.q, 1)}</span></div>`).join("")}
   ${c.disc ? `<div class="r"><span>خصم</span><span>−${fmt(c.disc, 1)}</span></div>` : ""}${c.vatOn ? `<div class="r"><span>ض.ق.م</span><span>${fmt(r.vat != null ? r.vat : c.vat, 1)}</span></div>` : ""}
   <div class="hr" style="margin:8px 0"></div><div class="r"><b>الإجمالي</b><b>${fmt(r.total, 1)}</b></div>${pays.map(([k, v]) => `<div class="r"><span>${k === "inst" ? "تقسيط · " + esc(planName(P.planDone)) : PAYN[k]}</span><span>${fmt(v, 1)}</span></div>`).join("")}${(r.change || 0) > 0 ? `<div class="r"><span>الباقي</span><span>${fmt(r.change, 1)}</span></div>` : ""}</div>
   <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" data-act="rcptPrint">طباعة</button><button class="btn gold" data-act="rcptOk">فاتورة جديدة</button></div>`);
  loadItems().then(() => { P.shift = undefined; }).catch(() => {});
}
function handModal() {
  const den = [200, 100, 50, 20, 10, 5, 1];
  modal(`<h2>تسليم الوردية</h2><p class="muted" style="margin:0 0 10px">عدّ الدرج بالفئات واكتب إجمالي الفيزا والإنستاباي والمحافظ من الأجهزة. الفرق بيظهر بعد التسليم.</p><div class="stack">
   <div class="grid g2" style="gap:6px">${den.map(d => `<label class="row" style="gap:6px;flex-wrap:nowrap"><span class="num" style="width:44px">${d}</span>×<input class="inp num" type="number" min="0" data-den="${d}" value="0"></label>`).join("")}</div>
   <div class="row between"><span class="muted">إجمالي النقدي المعدود</span><b class="num" id="hTot">0</b></div>
   <div class="grid g2" style="gap:6px">${["card", "insta", "wallet"].map(k => `<div class="field"><label>${PAYN[k]}</label><input class="inp num" type="number" min="0" data-hp="${k}" value="0"></div>`).join("")}</div>
   <div class="field"><label>سبب الفرق (إجباري لو فيه فرق)</label><input class="inp" id="hRsn"></div><div id="hErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="shHandGo">تسليم</button></div></div>`);
  document.querySelectorAll("[data-den]").forEach(x => x.oninput = () => { $("#hTot").textContent = num([...document.querySelectorAll("[data-den]")].reduce((a, y) => a + (+y.dataset.den) * (+y.value || 0), 0)); });
}
async function handGo(btn) {
  const counted = { den: {}, card: 0, insta: 0, wallet: 0 }; document.querySelectorAll("[data-den]").forEach(x => { counted.den[x.dataset.den] = +x.value || 0; }); document.querySelectorAll("[data-hp]").forEach(x => { counted[x.dataset.hp] = +x.value || 0; });
  busy(btn, true);
  try { const r = await rpc("shift_handover", { p_token: T(), p_counted: counted, p_reason: $("#hRsn").value.trim() || null });
    modal(`<h2>اتسلّمت الوردية</h2><div class="stack"><div class="row between"><span>النقدي المفروض</span><b class="num">${fmt(r.expected, 1)}</b></div><div class="row between"><span>المعدود</span><b class="num">${fmt(r.counted, 1)}</b></div><div class="row between"><span>الفرق</span><b class="num" style="color:${+r.diff < 0 ? "var(--bad)" : +r.diff > 0 ? "var(--warn)" : "var(--ok)"}">${fmt(r.diff, 1)}</b></div><p class="muted">التسليم مستني اعتماد مدير الفرع أو مدير الشيفت من شاشة «الخزنة والورديات».</p><button class="btn gold" data-act="mClose">تمام</button></div>`);
    P.shift = undefined; render(); }
  catch (e) { $("#hErr").innerHTML = `<div class="warnbox">${esc(errText(e))}${/REASON/.test(e.message) ? " فيه فرق بين المعدود والمسجّل." : ""}</div>`; busy(btn, false); }
}

/* ---------- cash & shifts (approvals, today's invoices, balances) ---------- */
V.cash = () => { let h = header(); const C = S.cash; if (!C) { setTimeout(loadCash, 0); return h + `<div class="spin"></div>`; }
  const pend = C.shifts.filter(s => s.status === "handed"), canAp = can("close", "p");
  h += `<div class="grid g4">${C.accts.map((a, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${esc(a.name)}</div><div class="val">${fmt(a.bal)}</div><div class="dim" style="font-size:12px">نقدي</div></div>`).join("")}</div>`;
  h += `<div class="card rise"><h3>الورديات</h3><div class="tw"><table><thead><tr><th>المكان</th><th>الكاشير</th><th>من</th><th>إلى</th><th class="n">المفروض</th><th class="n">المعدود</th><th class="n">الفرق</th><th>الحالة</th><th></th></tr></thead><tbody>${C.shifts.map(s => `<tr><td>${esc(locName(s.location_id))}</td><td>${esc(who(s.cashier_id))}</td><td class="num dim">${new Date(s.opened_at).toLocaleString("ar-EG")}</td><td class="num dim">${s.closed_at ? new Date(s.closed_at).toLocaleString("ar-EG") : "—"}</td><td class="n">${s.expected_cash != null ? fmt(s.expected_cash, 1) : "—"}</td><td class="n">${s.counted_cash != null ? fmt(s.counted_cash, 1) : "—"}</td><td class="n" style="color:${+s.diff < 0 ? "var(--bad)" : +s.diff > 0 ? "var(--warn)" : ""}">${s.diff != null ? fmt(s.diff, 1) : "—"}${s.diff_reason ? `<br><span class="dim" style="font-size:12px">${esc(s.diff_reason)}</span>` : ""}</td><td><span class="chip ${s.status === "open" ? "info" : s.status === "handed" ? "warn" : "ok"}">${{ open: "مفتوحة", handed: "مستنية اعتماد", approved: "معتمدة" }[s.status]}</span></td><td>${s.status === "handed" && canAp ? `<button class="btn sm gold" data-act="shAppr" data-id="${s.id}">اعتماد</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">لسه مفيش ورديات.</td></tr>`}</tbody></table></div>${pend.length && !canAp ? `<p class="dim">في ${pend.length} تسليم مستني اعتماد مدير.</p>` : ""}</div>`;
  h += `<div class="card rise"><h3>فواتير آخر ٣ أيام</h3><div class="tw"><table><thead><tr><th>الفاتورة</th><th>المكان</th><th>الكاشير</th><th>الوقت</th><th class="n">الإجمالي</th>${seeCost() ? `<th class="n">الربح</th>` : ""}<th>الحالة</th><th></th></tr></thead><tbody>${C.sales.map(x => `<tr><td class="num">${esc(x.no)}</td><td>${esc(locName(x.location_id))}</td><td>${esc(who(x.cashier_id))}</td><td class="num dim">${new Date(x.created_at).toLocaleString("ar-EG")}</td><td class="n">${fmt(x.total, 1)}</td>${seeCost() ? `<td class="n">${fmt(x.total - x.vat - x.cost, 1)}</td>` : ""}<td>${x.status === "void" ? `<span class="chip bad">ملغاة</span><br><span class="dim" style="font-size:12px">${esc(x.void_reason || "")}</span>` : `<span class="chip ok">سارية</span>`}</td><td class="row" style="gap:4px;flex-wrap:nowrap">${x.status === "posted" && can("returns", "a") ? `<button class="btn sm ghost" data-act="saleRet" data-id="${x.id}">مرتجع</button>` : ""}${x.status === "posted" && (["owner", "gm"].includes(S.sess.role.id) || has("voidInvoice") || has("voidRequest")) ? `<button class="btn sm ghost" data-act="saleVoid" data-id="${x.id}" data-no="${esc(x.no)}">إلغاء</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">لسه مفيش فواتير.</td></tr>`}</tbody></table></div></div>`;
  return h; };
async function loadCash() {
  try { await loadDir(); const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const [accts, moves, shifts, sales] = await Promise.all([q("cash_accounts", "*", x => x.order("id")), q("cash_moves", "account_id,amount,method", x => x.eq("method", "cash").limit(50000)), q("shifts", "*", x => x.order("opened_at", { ascending: false }).limit(60)), q("sales", "*", x => x.gte("created_at", since).order("created_at", { ascending: false }).limit(300))]);
    accts.forEach(a => { a.bal = moves.filter(m => m.account_id === a.id).reduce((s, m) => s + +m.amount, 0); });
    S.cash = { accts, shifts, sales }; if (S.route === "cash") render(); } catch (e) { toast(errText(e), true); }
}
function apprModal(s) {
  modal(`<h2>اعتماد تسليم الوردية</h2><div class="stack"><div class="row between"><span>الكاشير</span><b>${esc(who(s.cashier_id))}</b></div><div class="row between"><span>المعدود</span><b class="num">${fmt(s.counted_cash, 1)}</b></div><div class="row between"><span>الفرق</span><b class="num">${fmt(s.diff, 1)}</b></div>
   <div class="field"><label>توريد للخزنة الرئيسية من الدرج (والباقي يفضل فكّة)</label><input class="inp num" id="aTr" type="number" min="0" max="${s.counted_cash}" value="${Math.max(0, (+s.counted_cash || 0) - (+s.opening_float || 0))}"></div><div id="aErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="shApprGo" data-id="${s.id}">اعتماد</button></div></div>`);
}
function voidModal(id, no) {
  const direct = ["owner", "gm"].includes(S.sess.role.id) || has("voidInvoice");
  modal(`<h2>إلغاء الفاتورة ${esc(no)}</h2><p class="muted">البضاعة هترجع المخزون بتكلفتها، والمسلسلات ترجع متاحة، والمبلغ يتسجّل مرتجع على الدرج. الفاتورة الأصلية بتفضل ظاهرة كملغاة.</p><div class="stack">
   <div class="field"><label>السبب</label><input class="inp" id="vRsn"></div>${direct ? "" : `<div class="field"><label>رمز المدير العام أو المالك للموافقة</label><input class="inp num" type="password" id="vPin"></div>`}<div id="vErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn danger" data-act="saleVoidGo" data-id="${id}">إلغاء الفاتورة</button></div></div>`);
}

/* ---------- transfers ---------- */
const TST = { requested: ["مطلوب", "info"], approved: ["معتمد", "gold"], shipped: ["في الطريق", "warn"], received: ["اتستلم", "ok"], cancelled: ["ملغي", "plain"] };
const myLoc = l => S.sess.role.scope_all_locations || !S.sess.staff.location_id || S.sess.staff.location_id === l;
V.transfers = () => { let h = header(can("transfers", "a") ? `<button class="btn gold" data-act="trNew">${ico("plus")} طلب تحويل</button>` : ""); const L = S.tr; if (!L) { setTimeout(loadTr, 0); return h + `<div class="spin"></div>`; }
  h += `<div class="tw rise"><table><thead><tr><th>الرقم</th><th>من</th><th>إلى</th><th>الأصناف</th><th>الحالة</th><th>بواسطة</th><th></th></tr></thead><tbody>${L.map(t => { const st = TST[t.status]; let act = "";
    if (t.status === "requested" && can("transfers", "p") && myLoc(t.from_location)) act = `<button class="btn sm gold" data-act="trAppr" data-id="${t.id}">اعتماد</button>`;
    else if (t.status === "approved" && can("transfers", "a") && myLoc(t.from_location)) act = `<button class="btn sm gold" data-act="trShip" data-id="${t.id}">شحن</button>`;
    else if (t.status === "shipped" && can("transfers", "a") && myLoc(t.to_location)) act = `<button class="btn sm gold" data-act="trRecv" data-id="${t.id}">استلام</button>`;
    return `<tr><td class="num">${esc(t.no)}<br><span class="dim" style="font-size:12px">${new Date(t.created_at).toLocaleString("ar-EG")}</span></td><td>${esc(locName(t.from_location))}</td><td>${esc(locName(t.to_location))}</td><td>${t.lines.map(l => `${esc((S.items.find(i => i.id === l.item_id) || {}).name || "—")} × ${num(l.qty)}${l.qty_received != null && +l.qty_received !== +l.qty ? ` <span style="color:var(--bad)">(وصل ${num(l.qty_received)})</span>` : ""}`).join("<br>")}${t.note ? `<br><span class="dim" style="font-size:12px">${esc(t.note)}</span>` : ""}</td><td><span class="chip ${st[1]}">${st[0]}</span></td><td>${esc(who(t.requested_by))}</td><td>${act}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">لسه مفيش تحويلات.</td></tr>`}</tbody></table></div>
  <div class="okbox rise">التحويل بيمشي: طلب ← اعتماد من مكان الإرسال ← شحن (البضاعة بتخرج بتكلفتها) ← استلام في المكان التاني (بنفس التكلفة). لو وصل أقل، العجز بيتسجّل بسبب.</div>`;
  return h; };
async function loadTr() { try { await loadDir(); const [t, l] = await Promise.all([q("transfers", "*", x => x.order("created_at", { ascending: false }).limit(200)), q("transfer_lines", "*", x => x.limit(5000))]); t.forEach(x => x.lines = l.filter(y => y.transfer_id === x.id)); S.tr = t; if (S.route === "transfers") render(); } catch (e) { toast(errText(e), true); } }
function trNewModal() {
  S.trd = { from: S.locs.find(l => l.kind === "warehouse") ? S.locs.find(l => l.kind === "warehouse").id : S.locs[0].id, to: S.sess.staff.location_id || S.locs[0].id, lines: [], note: "" }; trDraw();
}
async function trDraw() {
  const d = S.trd; if (!d.ser || d.serFrom !== d.from) { d.ser = await q("serials", "serial,item_id", x => x.eq("location_id", d.from).eq("status", "in_stock").limit(5000)).catch(() => []); d.serFrom = d.from; }
  modal(`<h2>طلب تحويل</h2><div class="stack" style="margin-top:10px"><div class="grid g2"><div class="field"><label>من</label><select class="inp" id="tFrom">${S.locs.map(l => `<option value="${l.id}" ${d.from === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div><div class="field"><label>إلى</label><select class="inp" id="tTo">${S.locs.map(l => `<option value="${l.id}" ${d.to === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div></div>
   <div class="row" style="gap:6px;flex-wrap:nowrap"><select class="inp" id="tItem" style="flex:2">${S.items.filter(i => stockOf(i.id, d.from) > 0).map(i => `<option value="${i.id}">${esc(i.name)} — متاح ${num(stockOf(i.id, d.from))}</option>`).join("")}</select><input class="inp num" id="tQty" type="number" min="0.1" step="any" value="1" style="width:80px"><button class="btn sm" data-act="trAddLine">${ico("plus")}</button></div>
   ${d.lines.map((l, n) => { const it = S.items.find(i => i.id === l.item_id); return `<div class="row between" style="border-bottom:1px solid var(--line);padding:6px 0"><span>${esc(it.name)} × <b class="num">${num(l.qty)}</b>${it.serial_required ? `<br><select class="inp" multiple size="3" data-trser="${n}" style="margin-top:4px">${d.ser.filter(s => s.item_id === it.id).map(s => `<option ${(l.serials || []).includes(s.serial) ? "selected" : ""}>${esc(s.serial)}</option>`).join("")}</select><span class="dim" style="font-size:12px">اختار ${num(l.qty)} مسلسل (Ctrl للاختيار المتعدد)</span>` : ""}</span><button class="btn sm ghost" data-act="trDelLine" data-n="${n}">✕</button></div>`; }).join("")}
   <div class="field"><label>ملاحظة</label><input class="inp" id="tNote" value="${esc(d.note)}"></div><div id="tErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="trSave">إرسال الطلب</button></div></div>`);
  $("#tFrom").onchange = e => { d.from = +e.target.value; d.lines = []; trDraw(); }; $("#tTo").onchange = e => { d.to = +e.target.value; }; $("#tNote").oninput = e => { d.note = e.target.value; };
  document.querySelectorAll("[data-trser]").forEach(x => x.onchange = () => { d.lines[+x.dataset.trser].serials = [...x.selectedOptions].map(o => o.value); });
}
function trRecvModal(t) {
  modal(`<h2>استلام ${esc(t.no)}</h2><p class="muted">اكتب الكمية اللي وصلت فعلًا لكل صنف.</p><div class="stack">${t.lines.map(l => `<div class="row between"><span>${esc((S.items.find(i => i.id === l.item_id) || {}).name || "—")} <span class="dim">(اتشحن ${num(l.qty)})</span></span><input class="inp num" type="number" min="0" max="${l.qty}" step="any" data-rcv="${l.item_id}" value="${l.qty}" style="width:90px"></div>`).join("")}
   <div class="field"><label>سبب العجز (لو فيه)</label><input class="inp" id="rRsn"></div><div id="rErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="trRecvGo" data-id="${t.id}">تأكيد الاستلام</button></div></div>`);
}
async function opsClick(k, a) {
  const wrap = async (fn, after) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { toast(errText(e), true); busy(a, false); } };
  if (k === "posDep") { P.dep = a.dataset.k; render(); }
  else if (k === "posAdd") { posAdd(a.dataset.id); render(); }
  else if (k === "posQty") { const l = P.cart[+a.dataset.n]; l.qty += +a.dataset.d; if (l.qty <= 0) P.cart.splice(+a.dataset.n, 1); render(); }
  else if (k === "posDel") { P.cart.splice(+a.dataset.n, 1); render(); }
  else if (k === "posClear") { P.cart = []; P.disc = 0; P.plan = ""; P.heldId = null; P.heldNo = null; P.pay = { cash: "", card: "", insta: "", wallet: "", inst: "" }; render(); }
  else if (k === "payAll") { const c = cartCalc(); P.pay = { cash: String(c.total), card: "", insta: "", wallet: "", inst: "" }; P.plan = ""; render(); }
  else if (k === "posPay") posPay(a);
  else if (k === "rcptPrint") { const w = window.open("", "_blank", "width=380,height=600"); if (!w) return toast("المتصفح منع نافذة الطباعة.", true); w.document.write(`<html dir="rtl"><head><title>إيصال</title><style>body{font-family:Tahoma,Arial;font-size:12px;width:72mm;margin:0 auto}.r{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.dim{color:#666}.hr{border-top:1px dashed #000}</style></head><body>${$("#rcpt").innerHTML}<script>print();setTimeout(()=>close(),500)<\/script></body></html>`); w.document.close(); }
  else if (k === "rcptOk") { closeModal(); render(); }
  else if (k === "shOpen") wrap(() => rpc("shift_open", { p_token: T(), p_float: +$("#shFloat").value || 0 }), async () => { P.shift = undefined; toast("الوردية اتفتحت."); render(); });
  else if (k === "shHand") handModal();
  else if (k === "shHandGo") handGo(a);
  else if (k === "shAppr") apprModal(S.cash.shifts.find(s => s.id === a.dataset.id));
  else if (k === "shApprGo") wrap(() => rpc("shift_approve", { p_token: T(), p_shift: a.dataset.id, p_to_treasury: +$("#aTr").value || 0 }), async () => { closeModal(); toast("اتعتمد."); S.cash = null; render(); });
  else if (k === "saleVoid") voidModal(a.dataset.id, a.dataset.no);
  else if (k === "saleVoidGo") wrap(() => rpc("sale_void", { p_token: T(), p_sale: a.dataset.id, p_reason: $("#vRsn").value.trim(), p_approver_pin: ($("#vPin") || {}).value || null }), async () => { closeModal(); toast("الفاتورة اتلغت."); S.cash = null; await loadItems(); render(); });
  else if (k === "trNew") trNewModal();
  else if (k === "trAddLine") { const id = $("#tItem").value, qy = +$("#tQty").value; if (!id || !(qy > 0)) return; if (qy > stockOf(id, S.trd.from)) return toast("الكمية أكتر من المتاح.", true); const it = S.items.find(i => i.id === id); if (it.serial_required && qy % 1) return toast("الأجهزة بالعدد.", true); const ex = S.trd.lines.find(l => l.item_id === id); if (ex) ex.qty += qy; else S.trd.lines.push({ item_id: id, qty: qy, serials: [] }); trDraw(); }
  else if (k === "trDelLine") { S.trd.lines.splice(+a.dataset.n, 1); trDraw(); }
  else if (k === "trSave") { const d = S.trd; if (d.from === d.to) return ($("#tErr").innerHTML = `<div class="warnbox">اختار مكانين مختلفين.</div>`); if (!d.lines.length) return ($("#tErr").innerHTML = `<div class="warnbox">ضيف صنف.</div>`);
    for (const l of d.lines) { const it = S.items.find(i => i.id === l.item_id); if (it.serial_required && (l.serials || []).length !== l.qty) return ($("#tErr").innerHTML = `<div class="warnbox">اختار ${num(l.qty)} مسلسل لـ ${esc(it.name)}.</div>`); }
    wrap(() => rpc("transfer_create", { p_token: T(), p_from: d.from, p_to: d.to, p_lines: d.lines.map(l => { const it = S.items.find(i => i.id === l.item_id); return it.serial_required ? { item_id: l.item_id, qty: l.qty, serials: l.serials } : { item_id: l.item_id, qty: l.qty }; }), p_note: d.note || null }), async () => { closeModal(); toast("الطلب اتبعت."); S.tr = null; render(); }); }
  else if (k === "trAppr") wrap(() => rpc("transfer_approve", { p_token: T(), p_id: a.dataset.id }), async () => { toast("اتعتمد."); S.tr = null; render(); });
  else if (k === "trShip") wrap(() => rpc("transfer_ship", { p_token: T(), p_id: a.dataset.id }), async () => { toast("اتشحن — البضاعة خرجت من المكان."); S.tr = null; await loadItems(); render(); });
  else if (k === "trRecv") trRecvModal(S.tr.find(t => t.id === a.dataset.id));
  else if (k === "trRecvGo") { const rec = {}; document.querySelectorAll("[data-rcv]").forEach(x => { rec[x.dataset.rcv] = +x.value; }); wrap(() => rpc("transfer_receive", { p_token: T(), p_id: a.dataset.id, p_received: rec, p_reason: $("#rRsn").value.trim() || null }), async () => { closeModal(); toast("اتستلم."); S.tr = null; await loadItems(); render(); }); }
  else if (k === "mClose") closeModal();
  else return ops2Click(k, a);
  return true;
}


/* =====================================================================
   PHASE 2a · held invoices, instalment companies, partial returns
   ===================================================================== */
async function loadFin() { const [co, pl] = await Promise.all([q("finance_companies", "*", x => x.order("name")), q("finance_plans", "*", x => x.order("months"))]); S.finCo = co; S.finPl = pl; return S.finPl; }
const planName = id => { const p = (S.finPl || []).find(x => x.id === +id); if (!p) return "—"; const c = (S.finCo || []).find(x => x.id === p.company_id) || {}; return `${c.name} · ${p.name}`; };

/* ---------- seller sends, cashier picks up ---------- */
async function heldSend(btn) {
  if (!P.cart.length) return;
  const p = { lines: P.cart.map(l => ({ item_id: l.id, qty: l.qty, serial: l.serial || null, cut_waste_m: l.waste || null })), customer: P.cust.phone ? { name: P.cust.name.trim(), phone: P.cust.phone.trim() } : null, discount_pct: P.disc, seller_id: P.seller || null };
  busy(btn, true);
  try { const r = await rpc("held_create", { p_token: T(), p }); toast(`الفاتورة ${r.no} اتبعتت للكاشير.`); P.cart = []; P.disc = 0; P.cust = { name: "", phone: "" }; render(); }
  catch (e) { toast(errText(e), true); busy(btn, false); }
}
async function heldList() {
  try { await loadDir(); const L = await q("held_sales", "*", x => x.eq("status", "open").eq("location_id", S.sess.device.location_id).order("created_at"));
    modal(`<h2>الفواتير المعلّقة</h2><div class="stack" style="margin-top:10px">${L.map(h => { const n = (h.payload.lines || []).length, tot = (h.payload.lines || []).reduce((a, l) => { const it = S.items.find(i => i.id === l.item_id); return a + (it ? it.sale_price * l.qty : 0); }, 0);
      return `<div class="row between card" style="padding:12px"><span><b class="num">${esc(h.no)}</b> · ${new Date(h.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}${h.seller_id ? ` · <span class="chip gold plain">من ${esc(who(h.seller_id))}</span>` : ""}<br><span class="dim" style="font-size:12.5px">${n} صنف · ${fmt(tot)}${h.payload.customer ? " · " + esc(h.payload.customer.name || "") : ""}</span></span><span class="row" style="gap:6px"><button class="btn sm gold" data-act="heldTake" data-id="${h.id}">استرجاع</button><button class="btn sm ghost" data-act="heldCancel" data-id="${h.id}">إلغاء</button></span></div>`; }).join("") || `<p class="muted">مفيش فواتير معلّقة.</p>`}<button class="btn ghost" data-act="mClose">إغلاق</button></div>`); }
  catch (e) { toast(errText(e), true); }
}
async function heldTake(id) {
  if (P.cart.length) return toast("فضّي الفاتورة الحالية الأول.", true);
  try { const h = await rpc("held_take", { p_token: T(), p_id: id });
    P.cart = (h.lines || []).filter(l => S.items.some(i => i.id === l.item_id)).map(l => ({ id: l.item_id, qty: +l.qty, serial: l.serial || "", waste: l.cut_waste_m || 0 }));
    P.cust = h.customer ? { name: h.customer.name || "", phone: h.customer.phone || "" } : { name: "", phone: "" }; P.seller = h.seller_id || ""; P.disc = +h.discount_pct || 0; P.heldId = id; P.heldNo = h.held_no;
    closeModal(); toast(`اتسترجعت ${h.held_no}.`); render(); }
  catch (e) { toast(errText(e), true); }
}

/* ---------- returns ---------- */
async function returnModal(saleId) {
  try { const [sale, lines] = await Promise.all([q("sales", "*", x => x.eq("id", saleId)), q("sale_lines", "*", x => x.eq("sale_id", saleId))]);
    const done = await q("return_lines", "sale_line_id,qty,returns!inner(sale_id)", x => x.eq("returns.sale_id", saleId)).catch(() => []);
    const s = sale[0], dq = id => done.filter(d => d.sale_line_id === id).reduce((a, d) => a + +d.qty, 0), approve = can("returns", "p");
    S._ret = { sale: s, lines };
    modal(`<h2>مرتجع على ${esc(s.no)}</h2><p class="muted" style="margin:0 0 10px">${new Date(s.created_at).toLocaleString("ar-EG")} · ${fmt(s.total, 1)}</p><div class="stack">
     ${lines.map(l => { const it = S.items.find(i => i.id === l.item_id) || { name: "—", unit: "piece" }, left = +l.qty - dq(l.id); return `<div class="card" style="padding:10px"><div class="row between"><b>${esc(it.name)}</b><span class="dim num">اتباع ${num(l.qty)} · رجع قبل كده ${num(dq(l.id))}</span></div>${l.serial ? `<div class="dim num" style="font-size:12px">SN ${esc(l.serial)}</div>` : ""}
       ${left > 0 ? `<div class="row" style="gap:8px;margin-top:6px;flex-wrap:nowrap"><label class="row" style="gap:6px">الكمية <input class="inp num" type="number" min="0" max="${left}" step="${it.unit === "meter" ? "0.1" : "1"}" data-rq="${l.id}" value="0" style="width:80px"></label><select class="inp" data-rc="${l.id}" style="flex:1"><option value="resell">سليم — يرجع للبيع</option><option value="damaged">تالف — ما يرجعش للمخزون</option></select></div>` : `<div class="dim">رجع بالكامل</div>`}</div>`; }).join("")}
     <div class="grid g2"><div class="field"><label>طريقة رد الفلوس</label><select class="inp" id="rRef">${Object.entries(PAYN).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}<option value="credit">من غير رد فلوس (استبدال)</option></select></div><div class="field"><label>السبب</label><input class="inp" id="rWhy"></div></div>
     ${approve ? "" : `<div class="field"><label>رمز المدير للموافقة</label><input class="inp num" type="password" id="rPin"></div>`}<div id="rErr"></div>
     <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="retGo" data-id="${s.id}">تسجيل المرتجع</button></div></div>`); }
  catch (e) { toast(errText(e), true); }
}
async function retGo(btn, saleId) {
  const lines = [...document.querySelectorAll("[data-rq]")].map(x => ({ sale_line_id: +x.dataset.rq, qty: +x.value || 0, condition: document.querySelector(`[data-rc="${x.dataset.rq}"]`).value })).filter(l => l.qty > 0);
  if (!lines.length) return ($("#rErr").innerHTML = `<div class="warnbox">اكتب كمية المرتجع.</div>`);
  busy(btn, true);
  try { const r = await rpc("return_post", { p_token: T(), p_sale: saleId, p_lines: lines, p_reason: $("#rWhy").value.trim(), p_refund: $("#rRef").value, p_approver_pin: ($("#rPin") || {}).value || null });
    closeModal(); toast(`اتسجّل المرتجع ${r.no} بقيمة ${fmt(r.amount, 1)}.`); S.cash = null; await loadItems(); render(); }
  catch (e) { $("#rErr").innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; busy(btn, false); }
}

/* ---------- instalment companies screen ---------- */
V.inst = () => { let h = header(can("inst", "e") || ["owner", "gm"].includes(S.sess.role.id) ? `<button class="btn gold" data-act="finCoNew">${ico("plus")} شركة تقسيط</button>` : ""); const F = S.finView; if (!F) { setTimeout(loadFinView, 0); return h + `<div class="spin"></div>`; }
  const open = F.rec.filter(r => r.status === "open"), late = open.filter(r => r.due_date < today()), canE = can("inst", "e") || ["owner", "gm"].includes(S.sess.role.id);
  h += `<div class="grid g4">${[["مستحق عند الشركات", fmt(open.reduce((a, r) => a + +r.net, 0)), open.length + " فاتورة"], ["متأخر عن ميعاده", fmt(late.reduce((a, r) => a + +r.net, 0)), late.length + " فاتورة"], ["عمولات على المحل", fmt(F.rec.filter(r => r.status !== "cancelled").reduce((a, r) => a + +r.commission, 0))], ["اتحصّل", fmt(F.rec.filter(r => r.status === "settled").reduce((a, r) => a + +r.received, 0))]].map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div>${k[2] ? `<div class="dim" style="font-size:12px">${k[2]}</div>` : ""}</div>`).join("")}</div>`;
  h += `<div class="grid g3">${S.finCo.map(c => `<div class="card rise"><h3>${esc(c.name)}${c.active ? "" : ` <span class="chip plain">موقوفة</span>`}${canE ? `<button class="btn sm ghost" data-act="finCoEdit" data-id="${c.id}">تعديل</button>` : ""}</h3><div class="stack" style="gap:5px;font-size:13px"><div class="row between"><span class="muted">بتحوّل بعد</span><b class="num">${c.transfer_days} يوم</b></div>${S.finPl.filter(p => p.company_id === c.id && p.active).map(p => `<div class="row between"><span>${esc(p.name)} <span class="dim">(${p.months} شهر)</span></span><span class="chip ${p.payer === "store" ? "warn" : "plain"}">${p.payer === "store" ? "على المحل " + (+p.rate) + "%" : "على العميل"}</span></div>`).join("")}</div></div>`).join("") || `<div class="card"><p class="muted">لسه مفيش شركات تقسيط. ضيف ValU أو أمان أو كونتكت وخططهم.</p></div>`}</div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الفاتورة</th><th>الشركة والخطة</th><th>المكان</th><th class="n">البيع</th><th class="n">عمولة على المحل</th><th class="n">صافي هيتحوّل</th><th>الميعاد</th><th>الحالة</th><th></th></tr></thead><tbody>${F.rec.map(r => { const st = r.status === "settled" ? ["اتحصّلت", "ok"] : r.status === "cancelled" ? ["ملغاة", "plain"] : r.due_date < today() ? ["متأخرة", "bad"] : ["مفتوحة", "info"];
    return `<tr><td class="num">${esc(r.sale_no || "")}<br><span class="dim" style="font-size:12px">${new Date(r.created_at).toLocaleDateString("ar-EG")}</span></td><td>${esc(planName(r.plan_id))}</td><td>${esc(locName(r.location_id))}</td><td class="n">${fmt(r.amount, 1)}</td><td class="n">${+r.commission ? fmt(r.commission, 1) : "—"}</td><td class="n"><b>${fmt(r.net, 1)}</b></td><td class="num">${esc(r.due_date)}</td><td><span class="chip ${st[1]}">${st[0]}</span>${r.ref ? `<br><span class="dim" style="font-size:12px">${esc(r.ref)} · ${fmt(r.received, 1)}</span>` : ""}</td><td>${r.status === "open" && canE ? `<button class="btn sm gold" data-act="finSettle" data-id="${r.id}">تسجيل التحويل</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="9" class="muted">لسه مفيش بيع بالتقسيط.</td></tr>`}</tbody></table></div>`;
  return h; };
async function loadFinView() { try { await loadFin(); const [rec, sales, accts] = await Promise.all([q("finance_receivables", "*", x => x.order("due_date").limit(1000)), q("sales", "id,no", x => x.limit(5000)), q("cash_accounts", "*", x => x.order("id"))]); rec.forEach(r => { r.sale_no = (sales.find(s => s.id === r.sale_id) || {}).no; }); S.finView = { rec }; S.bankAccts = accts.filter(a => a.kind === "bank"); if (S.route === "inst") render(); } catch (e) { toast(errText(e), true); } }
function finCoModal(c) {
  const x = c ? Object.assign({}, c, { plans: S.finPl.filter(p => p.company_id === c.id && p.active).map(p => Object.assign({}, p)) }) : { name: "", transfer_days: 7, phone: "", account_id: (S.bankAccts[0] || {}).id, active: true, plans: [{ name: "٦ شهور بدون فوائد", months: 6, rate: 0, payer: "store" }] };
  S._fc = x; const draw = () => modal(`<h2>${c ? "تعديل شركة تقسيط" : "شركة تقسيط جديدة"}</h2><div class="stack" style="margin-top:10px"><div class="grid g2"><div class="field"><label>اسم الشركة</label><input class="inp" id="fcN" value="${esc(x.name)}"></div><div class="field"><label>بتحوّل الفلوس بعد (يوم)</label><input class="inp num" id="fcD" type="number" min="0" value="${x.transfer_days}"></div><div class="field"><label>التليفون</label><input class="inp num" id="fcP" value="${esc(x.phone || "")}"></div><div class="field"><label>بتحوّل على حساب</label><select class="inp" id="fcA">${S.bankAccts.map(a => `<option value="${a.id}" ${x.account_id === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div></div>
   <b>الخطط</b>${x.plans.map((p, i) => `<div class="row" style="gap:6px;flex-wrap:nowrap"><input class="inp" data-fp="${i}" data-f="name" placeholder="اسم الخطة" value="${esc(p.name)}" style="flex:2"><input class="inp num" data-fp="${i}" data-f="months" type="number" min="1" value="${p.months}" title="شهور" style="width:64px"><input class="inp num" data-fp="${i}" data-f="rate" type="number" min="0" step="0.1" value="${p.rate}" title="%" style="width:64px"><select class="inp" data-fp="${i}" data-f="payer" style="flex:1.4"><option value="store" ${p.payer === "store" ? "selected" : ""}>العمولة على المحل</option><option value="customer" ${p.payer === "customer" ? "selected" : ""}>على العميل</option></select><button class="btn sm ghost" data-act="fpDel" data-i="${i}">✕</button></div>`).join("")}
   <button class="btn sm ghost" data-act="fpAdd">${ico("plus")} خطة</button>${c ? `<label class="row" style="gap:8px"><input type="checkbox" class="ck" id="fcAct" ${x.active ? "checked" : ""}> الشركة شغالة</label>` : ""}<div id="fcErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="finCoSave">حفظ</button></div></div>`);
  S._fcDraw = () => { fcRead(); draw(); }; draw();
}
function fcRead() { const x = S._fc; if (!$("#fcN")) return; x.name = $("#fcN").value; x.transfer_days = +$("#fcD").value || 0; x.phone = $("#fcP").value; x.account_id = +$("#fcA").value || null; if ($("#fcAct")) x.active = $("#fcAct").checked; document.querySelectorAll("[data-fp]").forEach(e => { const p = x.plans[+e.dataset.fp]; p[e.dataset.f] = e.dataset.f === "months" || e.dataset.f === "rate" ? +e.value : e.value; }); }
function settleModal(r) {
  modal(`<h2>تسجيل تحويل من ${esc(planName(r.plan_id).split(" · ")[0])}</h2><p class="muted" style="margin:0 0 10px">${esc(r.sale_no || "")} · المفروض يتحوّل <b class="num">${fmt(r.net, 1)}</b></p><div class="stack">
   <div class="grid g2"><div class="field"><label>المبلغ اللي وصل</label><input class="inp num" id="sAmt" type="number" min="0" value="${r.net}"></div><div class="field"><label>التاريخ</label><input class="inp" id="sDate" type="date" value="${today()}" max="${today()}"></div></div>
   <div class="field"><label>رقم التحويل</label><input class="inp" id="sRef"></div><div class="field"><label>سبب الفرق (لو المبلغ مختلف)</label><input class="inp" id="sWhy"></div><div id="sErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="finSettleGo" data-id="${r.id}">حفظ</button></div></div>`);
}
async function ops2Click(k, a) {
  const wrap = async (fn, after, errBox) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (errBox && $(errBox)) $(errBox).innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); busy(a, false); } };
  if (k === "heldSend") heldSend(a);
  else if (k === "heldList") heldList();
  else if (k === "heldTake") heldTake(a.dataset.id);
  else if (k === "heldCancel") wrap(() => rpc("held_cancel", { p_token: T(), p_id: a.dataset.id }), async () => { toast("اتلغت."); heldList(); });
  else if (k === "saleRet") returnModal(a.dataset.id);
  else if (k === "retGo") retGo(a, a.dataset.id);
  else if (k === "finCoNew") finCoModal(null);
  else if (k === "finCoEdit") finCoModal(S.finCo.find(c => c.id === +a.dataset.id));
  else if (k === "fpAdd") { fcRead(); S._fc.plans.push({ name: "", months: 12, rate: 0, payer: "customer" }); S._fcDraw(); }
  else if (k === "fpDel") { fcRead(); S._fc.plans.splice(+a.dataset.i, 1); S._fcDraw(); }
  else if (k === "finCoSave") { fcRead(); const x = S._fc; if (!x.name.trim()) return ($("#fcErr").innerHTML = `<div class="warnbox">اكتب اسم الشركة.</div>`); if (x.plans.some(p => !p.name.trim() || !(p.months > 0) || p.rate < 0)) return ($("#fcErr").innerHTML = `<div class="warnbox">كل خطة محتاجة اسم وعدد شهور ونسبة.</div>`);
    wrap(() => rpc("fin_company_save", { p_token: T(), p: { id: x.id || null, name: x.name.trim(), transfer_days: x.transfer_days, phone: x.phone, account_id: x.account_id, active: x.active !== false, plans: x.plans.map(p => ({ id: p.id || null, name: p.name, months: p.months, rate: p.rate, payer: p.payer, active: true })) } }), async () => { closeModal(); toast("اتحفظ."); S.finView = null; render(); }, "#fcErr"); }
  else if (k === "finSettle") settleModal(S.finView.rec.find(r => r.id === a.dataset.id));
  else if (k === "finSettleGo") wrap(() => rpc("fin_settle", { p_token: T(), p_id: a.dataset.id, p_amount: +$("#sAmt").value, p_date: $("#sDate").value, p_ref: $("#sRef").value.trim(), p_reason: $("#sWhy").value.trim() || null }), async () => { closeModal(); toast("اتسجّل التحويل."); S.finView = null; render(); }, "#sErr");
  else return false;
  return true;
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
  else opsClick(k, a);
});
{ const t = ls("minzo-theme"); if (t) document.documentElement.dataset.theme = t; }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
