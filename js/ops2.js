/* SYS Minzo · control screens (batch 2)
   ظهور الأصناف · الأدوار والصلاحيات (+ المعاينة) · سجل التدقيق · النسخ الاحتياطي والتصفير · التصدير */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, norm, rpc, q, T, can, has, seeCost, locName, ico, toast, modal, closeModal, busy, header, render, go, loadItems, loadDir, who, today, xlsOut, errText, myLoc, PAYN, UNITS } = M;
const isOwner = () => S.sess.role.id === "owner", isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const dt = x => x ? new Date(x).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const empty = (n, t) => `<tr><td colspan="${n}" class="muted">${t}</td></tr>`;
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const later = (fn, r) => { setTimeout(() => fn().then(() => S.route === r && render()).catch(e => toast(errText(e), true)), 0); return `<div class="spin"></div>`; };
const shows = () => S.locs.filter(l => l.kind === "showroom" && myLoc(l.id));

/* =====================================================================
   ITEM AVAILABILITY (shared with the POS through window.MZAV)
   ===================================================================== */
const cairo = () => { const d = new Date(Date.now() + 2 * 3600e3); return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), dow: d.getUTCDay() }; };
const sched = r => !!(r.date_from || r.date_to || (r.days && r.days.length) || r.hour_from);
function ruleLive(r, c) { if (!r.active) return false; if (r.date_from && c.date < r.date_from) return false; if (r.date_to && c.date > r.date_to) return false;
  if (r.days && r.days.length && !r.days.includes(c.dow)) return false;
  if (r.hour_from && r.hour_to) { const a = String(r.hour_from).slice(0, 5), b = String(r.hour_to).slice(0, 5); if (a <= b ? (c.time < a || c.time > b) : (c.time < a && c.time > b)) return false; }
  return true; }
function stateOf(it, loc, rules, c) { c = c || cairo(); const R = (rules || S.avRules || []).filter(r => ruleLive(r, c) && (r.location_id == null || r.location_id === +loc) &&
    ((r.scope === "item" && r.ref === it.id) || (r.scope === "group" && r.ref === String(it.group_id)) || (r.scope === "dept" && r.ref === String(it.department_id))));
  if (!R.length) return "on";
  const rank = r => ({ item: 0, group: 1, dept: 2 })[r.scope] * 100 + (r.location_id == null ? 10 : 0) + (sched(r) ? 0 : 1);
  R.sort((a, b) => rank(a) - rank(b) || b.id - a.id); return R[0].state; }
async function loadRules() { S.avRules = await q("item_rules", "*", x => x.eq("active", true).order("id")); try { localStorage.setItem("minzo-rules", JSON.stringify(S.avRules)); } catch (e) {} }
try { S.avRules = JSON.parse(localStorage.getItem("minzo-rules") || "[]"); } catch (e) { S.avRules = []; }
window.MZAV = (it, loc) => stateOf(it, loc);
setInterval(() => { if (S.sess) loadRules().catch(() => {}); }, 5 * 60 * 1000);
setInterval(() => { if (S.sess && S._rulesFor !== S.sess.token) { S._rulesFor = S.sess.token; loadRules().then(() => { if (S.route === "pos") render(); }).catch(() => {}); } }, 1500);

const STN = { on: ["ظاهر", "ok"], locked: ["مقفول", "warn"], hidden: ["مخفي", "bad"] };
const DOW = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
async function loadAvail() { const A = S.av || (S.av = { scope: "all", q: "", days: 30, open: {} }); await loadRules(); await loadDir();
  A.stale = await rpc("items_stale", { p_token: T(), p_days: A.days }).catch(() => []); A.loaded = A.days; }
V.avail = () => {
  const A = S.av; if (!A || A.loaded !== A.days) return header() + later(loadAvail, "avail");
  const ed = isTop() || has("itemAvail"), locs = A.scope === "all" ? shows() : shows().filter(l => String(l.id) === A.scope), qq = norm(A.q);
  const grpName = id => (S.groups.find(g => g.id === id) || {}).name || "من غير مجموعة";
  let h = header(`<div class="tabs">${[["all", "كل المعارض"], ...shows().map(l => [String(l.id), l.name])].map(([k, n]) => `<button data-act="avScope" data-k="${k}" class="${A.scope === k ? "on" : ""}">${esc(n)}</button>`).join("")}</div>`);
  h += `<div class="card rise"><div class="row" style="gap:8px;flex-wrap:wrap"><input class="inp" id="avQ" placeholder="بحث بالصنف أو المجموعة" value="${esc(A.q)}" style="flex:1;min-width:200px"></div><p class="dim" style="font-size:12.5px;margin-bottom:0">الأجهزة بتحتفظ بالقواعد، فالصنف بيظهر ويختفي في ميعاده حتى من غير إنترنت. الصنف المقفول بيفضل ظاهر في الإدارة والتقارير والحركات القديمة، والسيرفر بيرفض بيعه إلا لصاحب صلاحية «بيع صنف مقفول استثنائيًا».</p></div>`;
  const st = A.stale.filter(x => locs.some(l => l.id === x.loc)).map(x => ({ ...x, it: S.items.find(i => i.id === x.item_id) })).filter(x => x.it && stateOf(x.it, x.loc) === "on");
  h += `<div class="card rise"><h3>أصناف ما اتباعتش من <input class="inp num" type="number" min="1" max="365" id="avD" value="${A.days}" style="width:70px;display:inline-block"> يوم <span class="dim" style="font-size:12px;font-weight:400">اقتراح بس — الإيقاف مش بيتم لوحده</span></h3>${st.length ? `<div class="tw"><table><tbody>${st.slice(0, 40).map(x => `<tr><td>${esc(x.it.name)}</td><td>${esc(locName(x.loc))}</td><td class="muted">${x.last ? "آخر بيع " + dt(x.last) : "ما اتباعش خالص"}</td><td class="n">الرصيد ${num(x.qty)}</td><td>${ed ? `<button class="btn sm" data-act="avSet" data-scope="item" data-ref="${x.it.id}" data-loc="${x.loc}" data-st="locked" data-ask="1">اقتراح إيقاف</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">مفيش أصناف راكدة بالمدة دي.</p>`}</div>`;
  const seg = (scope, ref, cur, loc) => `<span class="row" style="gap:2px;flex-wrap:nowrap">${["on", "locked", "hidden"].map(k => `<button class="btn sm ${cur === k ? "gold" : "ghost"}" ${ed ? "" : "disabled"} data-act="avSet" data-scope="${scope}" data-ref="${ref}" data-loc="${loc == null ? "" : loc}" data-st="${k}">${STN[k][0]}</button>`).join("")}</span>`;
  const locArg = A.scope === "all" ? null : +A.scope;
  const allState = (fn) => { const v = locs.map(fn); return v.every(x => x === v[0]) ? v[0] : ""; };
  S.depts.forEach(d => {
    const items = S.items.filter(i => i.department_id === d.id && (!qq || norm(i.name + " " + grpName(i.group_id)).includes(qq)));
    if (!items.length && qq) return;
    const dRule = it => it; const groups = [...new Set(items.map(i => i.group_id))];
    const dState = allState(l => { const r = S.avRules.filter(r => r.scope === "dept" && r.ref === String(d.id) && !sched(r) && (r.location_id == null || r.location_id === l.id)); return r.length ? r[r.length - 1].state : "on"; });
    h += `<div class="card rise"><h3>${esc(d.name)} <span class="dim" style="font-size:12px;font-weight:400">${items.length} صنف</span><span style="margin-inline-start:auto">${seg("dept", d.id, dState, locArg)}</span></h3><div class="tw"><table><thead><tr><th>المجموعة / الصنف</th>${locs.map(l => `<th>${esc(l.name)}</th>`).join("")}<th>تغيير</th><th></th></tr></thead><tbody>`;
    groups.forEach(g => {
      const gi = items.filter(i => i.group_id === g), open = A.open[g + "|" + d.id] || qq;
      const gState = g ? allState(l => { const r = S.avRules.filter(r => r.scope === "group" && r.ref === String(g) && !sched(r) && (r.location_id == null || r.location_id === l.id)); return r.length ? r[r.length - 1].state : "on"; }) : "";
      h += `<tr style="background:var(--surf)"><td><button class="btn sm ghost" data-act="avOpen" data-k="${g}|${d.id}">${open ? "−" : "+"}</button> <b>${esc(grpName(g))}</b> <span class="dim">· ${gi.length} صنف</span></td>${locs.map(() => "<td></td>").join("")}<td>${g ? seg("group", g, gState, locArg) : ""}</td><td>${g && ed ? `<button class="btn sm ghost" data-act="avSch" data-scope="group" data-ref="${g}">جدول</button>` : ""}</td></tr>`;
      if (open) gi.slice(0, 200).forEach(i => { h += `<tr><td style="padding-inline-start:28px">${esc(i.name)}</td>${locs.map(l => { const s = stateOf(i, l.id); return `<td>${chip(STN[s][0], STN[s][1])}</td>`; }).join("")}<td>${seg("item", i.id, allState(l => stateOf(i, l.id)), locArg)}</td><td>${ed ? `<button class="btn sm ghost" data-act="avSch" data-scope="item" data-ref="${i.id}">جدول</button>` : ""}</td></tr>`; });
    });
    h += `</tbody></table></div></div>`;
  });
  const sch = S.avRules.filter(r => sched(r));
  h += `<div class="card rise"><h3>الجداول الشغّالة</h3><div class="tw"><table><thead><tr><th>على</th><th>المكان</th><th>الحالة</th><th>الميعاد</th><th>السبب</th><th></th></tr></thead><tbody>${sch.map(r => `<tr><td>${esc(ruleTarget(r))}</td><td>${r.location_id ? esc(locName(r.location_id)) : "كل المعارض"}</td><td>${chip(STN[r.state][0], STN[r.state][1])}</td><td class="muted">${esc(schedText(r))}</td><td>${esc(r.reason || "")}</td><td>${ed ? `<button class="btn sm ghost" data-act="avEnd" data-id="${r.id}">إنهاء</button>` : ""}</td></tr>`).join("") || empty(6, "مفيش جداول.")}</tbody></table></div></div>`;
  return h;
};
function ruleTarget(r) { return r.scope === "item" ? ((S.items.find(i => i.id === r.ref) || {}).name || "صنف") : r.scope === "group" ? "مجموعة " + ((S.groups.find(g => String(g.id) === r.ref) || {}).name || "") : "قسم " + ((S.depts.find(d => String(d.id) === r.ref) || {}).name || ""); }
function schedText(r) { return [r.date_from || r.date_to ? `${r.date_from || "…"} ← ${r.date_to || "…"}` : "", r.days && r.days.length ? r.days.map(d => DOW[d]).join("، ") : "", r.hour_from ? `${String(r.hour_from).slice(0, 5)}–${String(r.hour_to).slice(0, 5)}` : ""].filter(Boolean).join(" · "); }
H.avail = () => { const qi = $("#avQ"); if (qi) qi.oninput = () => { S.av.q = qi.value; const p = qi.selectionStart; render(); const n = $("#avQ"); n.focus(); n.setSelectionRange(p, p); };
  const d = $("#avD"); if (d) d.onchange = () => { S.av.days = Math.max(1, Math.min(365, +d.value || 30)); render(); }; };
function avSchModal(scope, ref) { const canS = isTop() || has("itemSched");
  modal(`<h2>جدول ظهور · ${esc(ruleTarget({ scope, ref }))}</h2>${canS ? "" : `<div class="warnbox">جدولة الأصناف صلاحية مستقلة — دورك ميقدرش يحفظ جدول.</div>`}<div class="stack"><div class="grid g2">
   <div class="field"><label>المكان</label><select class="inp" id="sL">${S.sess.role.scope_all_locations ? `<option value="">كل المعارض</option>` : ""}${shows().map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
   <div class="field"><label>الحالة في الميعاد</label><select class="inp" id="sS"><option value="hidden">مخفي</option><option value="locked">مقفول</option><option value="on">ظاهر</option></select></div>
   <div class="field"><label>من تاريخ</label><input class="inp" type="date" id="sF"></div><div class="field"><label>لحد تاريخ</label><input class="inp" type="date" id="sT"></div>
   <div class="field"><label>من الساعة</label><input class="inp" type="time" id="sH1"></div><div class="field"><label>لحد الساعة</label><input class="inp" type="time" id="sH2"></div></div>
   <div class="row" style="gap:10px;flex-wrap:wrap">${DOW.map((d, i) => `<label class="row" style="gap:4px"><input type="checkbox" data-dow="${i}"> ${d}</label>`).join("")}</div>
   <div class="field"><label>السبب</label><input class="inp" id="sR" placeholder="مثال: صنف موسمي — رمضان بس"></div><div id="sErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="avSchGo" data-scope="${scope}" data-ref="${ref}" ${canS ? "" : "disabled"}>حفظ الجدول</button></div></div>`); }

/* =====================================================================
   ROLES & PERMISSIONS
   ===================================================================== */
const MODS = [["dash", "لوحة التحكم"], ["pos", "نقطة البيع"], ["items", "الأصناف"], ["entry", "إدخال المنتجات"], ["io", "الاستيراد"], ["avail", "ظهور الأصناف"], ["stock", "المخزون"], ["transfers", "التحويلات"],
  ["delivery", "التوصيل والتركيب"], ["svc", "الضمان والصيانة"], ["returns", "المرتجعات"], ["customers", "العملاء"], ["offers", "العروض"], ["suppliers", "الموردين"], ["close", "التقفيل اليومي"], ["expense", "المصروفات"],
  ["cash", "الخزنة والورديات"], ["inst", "شركات التقسيط"], ["gl", "الحسابات العامة"], ["reports", "التقارير المالية"], ["basis", "الاستحقاق والنقدي"], ["flow", "التدفق النقدي"], ["capital", "رأس المال"], ["opening", "أرصدة أول المدة"], ["taxinv", "الفواتير الضريبية"], ["einv", "الفواتير الإلكترونية"], ["staff", "الموظفين والمرتبات"], ["commission", "العمولات"], ["print", "الطباعة"], ["audit", "سجل التدقيق"], ["users", "الموظفين"], ["devices", "الأجهزة"]];
const ACTS = [["v", "عرض"], ["a", "إضافة"], ["e", "تعديل"], ["d", "إخفاء"], ["p", "اعتماد"], ["x", "تصدير"], ["r", "طباعة"], ["i", "استيراد"]];
const SENS = [["prices", "تعديل الأسعار"], ["voidInvoice", "إلغاء فاتورة مباشرة"], ["voidRequest", "طلب إلغاء فاتورة"], ["manualClose", "التقفيل اليدوي"], ["openDay", "فتح اليوم قبل ميعاده"], ["closeTimes", "تغيير مواعيد التقفيل"],
  ["editAfterClose", "تعديل بعد التقفيل"], ["itemAvail", "إيقاف وإظهار الأصناف"], ["itemSched", "جدولة الأصناف"], ["overrideLocked", "بيع صنف مقفول استثنائيًا"], ["layout", "تعديل شكل شاشة البيع"], ["printerSetup", "إعداد الطابعات"],
  ["labels", "طباعة الملصقات"], ["reprint", "إعادة طباعة فاتورة"], ["drawer", "فتح الدرج يدويًا"], ["users", "إدارة الموظفين والأدوار"], ["devices", "إدارة الأجهزة"], ["adminMode", "وضع الإدارة على جهاز الكاشير"],
  ["exportSensitive", "تصدير البيانات الحساسة"], ["backup", "النسخ الاحتياطي"], ["finalReports", "التقارير النهائية"], ["finalAudit", "نسخة المراجعة من التقارير"]];
async function loadRoles() { const R = S.rl || (S.rl = {}); const [roles, staff] = await Promise.all([q("roles", "*", x => x.order("created_at")), has("users") || isOwner() ? rpc("staff_list", { p_token: T() }) : Promise.resolve([])]);
  const ORD = ["owner", "gm", "mgr", "asstmgr", "shiftmgr", "seller", "cashier", "acct", "asstacct", "dataentry", "keeper", "asstkeeper", "promo"], o = id => { const i = ORD.indexOf(id); return i < 0 ? 99 : i; };
  R.roles = roles.sort((a, b) => o(a.id) - o(b.id) || String(a.created_at).localeCompare(String(b.created_at))); R.staff = staff; if (!R.sel || !roles.some(r => r.id === R.sel)) R.sel = (roles.find(r => r.id !== "owner") || roles[0]).id; R.draft = null; R.loaded = true; }
const permOf = (r, m) => (r.perms || {})[m] != null ? r.perms[m] : ((r.perms || {})["*"] || "");
V.roles = () => {
  const R = S.rl; if (!R || !R.loaded) return header() + later(loadRoles, "roles");
  const base = R.roles.find(r => r.id === R.sel), r = R.draft || JSON.parse(JSON.stringify(base)), lockd = r.id === "owner", me = S.sess.role, ed = !lockd && (isOwner() || has("users"));
  const sensOf = x => Array.isArray(x.sens) ? x.sens : [];
  let h = header(`<button class="btn" data-act="rlPrev" ${lockd ? "disabled" : ""}>${ico("avail")} معاينة بعيون الدور</button>${ed || isOwner() ? `<button class="btn" data-act="rlCopy">نسخ الدور</button><button class="btn gold" data-act="rlNew">${ico("plus")} دور جديد</button>` : ""}`);
  h += `<div class="grid" style="grid-template-columns:minmax(200px,260px) 1fr;align-items:start"><div class="card rise"><h3>الأدوار</h3><div class="stack" style="gap:4px">${R.roles.map(x => `<button class="btn ${x.id === R.sel ? "gold" : "ghost"}" style="justify-content:space-between" data-act="rlSel" data-id="${esc(x.id)}"><span>${esc(x.name)}</span><span class="num dim">${R.staff.filter(s => s.role_id === x.id).length}</span></button>`).join("")}</div></div>
   <div class="card rise"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><input class="inp" id="rlN" value="${esc(r.name)}" ${ed ? "" : "disabled"} style="flex:1;min-width:200px;font-weight:600">${lockd ? chip("دور المالك · كل الصلاحيات — مبيتعدّلش", "gold") : r.is_base ? chip("دور أساسي") : chip("دور مخصص", "info")}</div>
   <div class="tw"><table><thead><tr><th>الشاشة</th>${ACTS.map(a => `<th style="text-align:center">${a[1]}</th>`).join("")}</tr></thead><tbody>${MODS.map(([m, n]) => { const p = permOf(r, m), mine = isOwner() ? "vaedpxri" : permOf(me, m);
      return `<tr><td>${n}</td>${ACTS.map(([a]) => `<td style="text-align:center"><input type="checkbox" data-pm="${m}" data-pa="${a}" ${p.includes(a) ? "checked" : ""} ${ed && mine.includes(a) ? "" : "disabled"}></td>`).join("")}</tr>`; }).join("")}</tbody></table></div>
   <h3 style="margin-top:14px">الصلاحيات الحساسة</h3><div class="grid g3" style="gap:6px">${SENS.map(([k, n]) => `<label class="row" style="gap:6px;font-size:13px"><input type="checkbox" data-sn="${k}" ${sensOf(r).includes(k) || sensOf(r).includes("*") ? "checked" : ""} ${ed && (isOwner() || has(k)) ? "" : "disabled"}> ${n}</label>`).join("")}</div>
   <h3 style="margin-top:14px">النطاق والحدود</h3><div class="grid g3"><label class="row" style="gap:6px"><input type="checkbox" id="rlAll" ${r.scope_all_locations ? "checked" : ""} ${ed && (isOwner() || me.scope_all_locations) ? "" : "disabled"}> كل الأماكن (مش فرعه بس)</label>
    <div class="field"><label>يشوف آخر كام يوم (0 = من غير حد)</label><input class="inp num" type="number" min="0" id="rlDays" value="${+r.scope_days || 0}" ${ed ? "" : "disabled"}></div>
    <div class="field"><label>أقصى خصم يدوي %</label><input class="inp num" type="number" min="0" max="100" id="rlDisc" value="${+r.max_discount_pct || 0}" ${ed ? "" : "disabled"}></div>
    <div class="field"><label>أقصى مبلغ من غير موافقة (0 = من غير حد)</label><input class="inp num" type="number" min="0" id="rlAmt" value="${+r.max_amount || 0}" ${ed ? "" : "disabled"}></div>
    <label class="row" style="gap:6px"><input type="checkbox" id="rlCost" ${!r.hide_cost ? "checked" : ""} ${ed && (isOwner() || !me.hide_cost) ? "" : "disabled"}> يشوف التكلفة</label>
    <label class="row" style="gap:6px"><input type="checkbox" id="rlMargin" ${!r.hide_margin ? "checked" : ""} ${ed && (isOwner() || !me.hide_margin) ? "" : "disabled"}> يشوف الأرباح</label>
    <label class="row" style="gap:6px"><input type="checkbox" id="rlSal" ${!r.hide_salary ? "checked" : ""} ${ed && (isOwner() || !me.hide_salary) ? "" : "disabled"}> يشوف المرتبات</label></div>
   ${ed ? `<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">${isOwner() ? "" : `<input class="inp num" type="password" id="rlPin" placeholder="رمز المالك للتأكيد" style="max-width:200px">`}<input class="inp" id="rlWhy" placeholder="سبب التغيير (اختياري)" style="flex:1;min-width:180px"><button class="btn gold" data-act="rlSave">حفظ الصلاحيات</button>${!r.is_base && r.id ? `<button class="btn danger" data-act="rlDel">حذف الدور</button>` : ""}</div>
   <p class="dim" style="font-size:12.5px;margin-bottom:0">مفيش حد يقدر يدّي صلاحية أكبر من اللي معاه، وأي تغيير ${isOwner() ? "" : "محتاج رمز المالك و"}بيتسجّل في سجل التدقيق بالقيمة قبل وبعد. الموظف بياخد الصلاحيات الجديدة أول ما يدخل تاني.</p>` : ""}<div id="rlErr"></div></div></div>`;
  return h;
};
function rlRead() { const R = S.rl, base = R.roles.find(r => r.id === R.sel), r = R.draft || JSON.parse(JSON.stringify(base)); if (!$("#rlN")) return r;
  r.name = $("#rlN").value; const perms = {}; document.querySelectorAll("[data-pm]").forEach(c => { if (c.checked) perms[c.dataset.pm] = (perms[c.dataset.pm] || "") + c.dataset.pa; }); r.perms = perms;
  r.sens = [...document.querySelectorAll("[data-sn]")].filter(c => c.checked).map(c => c.dataset.sn);
  r.scope_all_locations = $("#rlAll").checked; r.scope_days = +$("#rlDays").value || 0; r.max_discount_pct = +$("#rlDisc").value || 0; r.max_amount = +$("#rlAmt").value || 0;
  r.hide_cost = !$("#rlCost").checked; r.hide_margin = !$("#rlMargin").checked; r.hide_salary = !$("#rlSal").checked; return r; }
H.roles = () => { const R = S.rl; if (!R || !R.loaded) return; document.querySelectorAll("#view input").forEach(el => { if (el.id !== "rlPin" && el.id !== "rlWhy") el.addEventListener("change", () => { R.draft = rlRead(); }); }); };

/* ---------- preview the system through another role (read-only) ---------- */
const READS = /^(\w+_v|email_session|email_accounts|setup_status|staff_directory|staff_list|customers_list|customer_history|serial_lookup|day_close_preview|gl_journal|commission_report|offers_preview|items_stale|shift_current|audit_verify|backups_list|staff_logout)$/;
const _rpc = M.sb.rpc.bind(M.sb);
M.sb.rpc = function (fn, args, opts) { if (S.preview && !READS.test(fn)) return Promise.resolve({ data: null, error: { message: "PREVIEW_MODE" } }); return _rpc(fn, args, opts); };
function previewStart(role) { S.preview = { real: S.sess.role, route: S.route }; S.sess.role = Object.assign({}, role, { perms: role.perms || {}, sens: role.sens || [] }); banner(); S.route = M.NAV.flatMap(g => g[1]).find(k => { try { return M.allowed(k); } catch (e) { return false; } }) || "dash"; render(); toast(`معاينة بعيون «${role.name}» — مفيش حفظ لحد ما تخرج.`); }
function previewEnd() { if (!S.preview) return; S.sess.role = S.preview.real; const r = S.preview.route; S.preview = null; banner(); S.route = r; render(); }
function banner() { let b = $("#mzPrev"); if (!S.preview) { if (b) b.remove(); return; } if (!b) { b = document.createElement("div"); b.id = "mzPrev"; b.style.cssText = "position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:60;background:var(--gold);color:#111;padding:8px 14px;border-radius:12px;display:flex;gap:10px;align-items:center;box-shadow:0 8px 30px rgba(0,0,0,.3);font-size:13.5px"; document.body.appendChild(b); }
  b.innerHTML = `<b>معاينة بعيون: ${esc(S.sess.role.name)}</b><span>القوايم والأزرار زي ما الدور ده هيشوفها · مفيش حفظ</span><button class="btn sm" data-act="rlPrevEnd" style="background:#111;color:#fff">خروج من المعاينة</button>`; }

/* =====================================================================
   AUDIT LOG
   ===================================================================== */
async function loadAudit() { const A = S.au || (S.au = { from: new Date(Date.now() - 30 * 864e5 + 2 * 3600e3).toISOString().slice(0, 10), to: today(), who: "all", act: "all", loc: "all", q: "" });
  A.rows = await q("audit_log", "n,at,staff_name,device_id,action,entity,before,after,reason,location_id,hash", x => x.gte("at", A.from + "T00:00:00+02:00").lte("at", A.to + "T23:59:59+02:00").order("n", { ascending: false }).limit(3000));
  A.devs = await q("devices", "id,name").catch(() => []); A.loaded = A.from + A.to; }
const short = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; };
V.audit = () => {
  const A = S.au; if (!A || A.loaded !== A.from + A.to) return header() + later(loadAudit, "audit");
  const users = [...new Set(A.rows.map(r => r.staff_name).filter(Boolean))], acts = [...new Set(A.rows.map(r => r.action))].sort(), qq = norm(A.q);
  const L = A.rows.filter(r => (A.who === "all" || r.staff_name === A.who) && (A.act === "all" || r.action === A.act) && (A.loc === "all" || String(r.location_id) === A.loc) && (!qq || norm([r.action, r.entity, r.before, r.after, r.reason].join(" ")).includes(qq)));
  const dev = id => (A.devs.find(d => d.id === id) || {}).name || "—";
  let h = header(`<button class="btn" data-act="auVerify">${ico("audit")} تحقق من السلسلة</button>${can("audit", "x") || isTop() ? `<button class="btn" data-act="auXls">تصدير</button>` : ""}`);
  h += `<div class="okbox rise"><b>سجل للقراءة بس.</b> مفيش حد يقدر يعدّل أو يمسح أي سطر، حتى المالك. كل سطر مربوط ببصمة السطر اللي قبله، فأي عبث بيكسر السلسلة ويبان هنا.<div id="auRes" style="margin-top:6px"></div></div>`;
  h += `<div class="card rise"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><input class="inp" type="date" id="auF" value="${A.from}" style="width:auto"><input class="inp" type="date" id="auT" value="${A.to}" style="width:auto">
    <select class="inp" id="auW" style="width:auto"><option value="all">كل الموظفين</option>${users.map(u => `<option ${A.who === u ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
    <select class="inp" id="auA" style="width:auto"><option value="all">كل الإجراءات</option>${acts.map(u => `<option ${A.act === u ? "selected" : ""}>${esc(u)}</option>`).join("")}</select>
    <select class="inp" id="auL" style="width:auto"><option value="all">كل الأماكن</option>${S.locs.map(l => `<option value="${l.id}" ${A.loc === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
    <input class="inp" id="auQ" placeholder="بحث" value="${esc(A.q)}" style="flex:1;min-width:160px"></div>
   <div class="tw"><table><thead><tr><th>#</th><th>التوقيت</th><th>الموظف</th><th>الجهاز</th><th>الإجراء</th><th>قبل</th><th>بعد</th><th>السبب</th><th>البصمة</th></tr></thead><tbody>${L.slice(0, 400).map(r => `<tr><td class="num dim">${r.n}</td><td class="num dim">${dt(r.at)}</td><td>${esc(r.staff_name || "النظام")}</td><td class="muted">${esc(dev(r.device_id))}</td><td><b>${esc(r.action)}</b>${r.entity ? `<br><span class="dim" style="font-size:12px">${esc(short(r.entity, 60))}</span>` : ""}</td><td class="muted" title="${esc(r.before || "")}">${esc(short(r.before, 40))}</td><td title="${esc(r.after || "")}">${esc(short(r.after, 40))}</td><td>${esc(short(r.reason, 50))}</td><td class="num dim" style="font-size:11px">${esc((r.hash || "").slice(0, 10))}</td></tr>`).join("") || empty(9, "مفيش حركات بالفلتر ده.")}</tbody></table></div>${L.length > 400 ? `<p class="dim">ظاهر أحدث ٤٠٠ من ${num(L.length)} — دقّق الفلتر أو صدّر.</p>` : ""}</div>`;
  const RULES = [["بيانات أساسية (أصناف، موردين، عملاء، أسعار، موظفين)", "إضافة وتعديل حسب الصلاحية، وكل تعديل بيتسجّل بالقيمة قبل وبعد", "ok"], ["المصروفات بعد تقفيل اليوم", "بصلاحية «تعديل بعد التقفيل» أو المالك، ومع سبب", "warn"],
    ["المشتريات والمخزون والمرتجعات والتحويلات", "التصحيح بحركة عكسية أو تسوية بسبب", "warn"], ["فواتير البيع", "مبتتعدّلش أبدًا — التصحيح بإلغاء أو مرتجع", "bad"], ["سجل التدقيق والشهور المقفولة", "مفيش تعديل مباشر — قيد عكسي والأصل بيفضل ظاهر", "bad"], ["أي بيان ليه حركات قبل كده", "إخفاء بدل الحذف", "info"], ["سجل اتفتح وحد تاني عدّله", "تحذير بدل ما يكتب فوقه", "info"]];
  h += `<div class="card rise"><h3>قواعد الإضافة والتعديل</h3><div class="tw"><table><tbody>${RULES.map(x => `<tr><td>${x[0]}</td><td>${chip(x[1], x[2])}</td></tr>`).join("")}</tbody></table></div></div>`;
  return h;
};
H.audit = () => { const A = S.au; if (!A || !$("#auF")) return; const on = (id, k, fn) => { const el = $(id); if (el) el[k] = fn; };
  on("#auF", "onchange", e => { if (e.target.value) { A.from = e.target.value; render(); } }); on("#auT", "onchange", e => { if (e.target.value) { A.to = e.target.value; render(); } });
  on("#auW", "onchange", e => { A.who = e.target.value; render(); }); on("#auA", "onchange", e => { A.act = e.target.value; render(); }); on("#auL", "onchange", e => { A.loc = e.target.value; render(); });
  on("#auQ", "oninput", e => { A.q = e.target.value; const p = e.target.selectionStart; render(); const n = $("#auQ"); n.focus(); n.setSelectionRange(p, p); }); };

/* =====================================================================
   BACKUP, RESTORE & RESET
   ===================================================================== */
const KIND = { hourly: ["كل ساعة", "plain"], daily: ["يومية", "info"], manual: ["يدوية", "gold"], before: ["قبل تغيير كبير", "warn"] };
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
async function loadBk() { const B = S.bk || (S.bk = {}); B.list = await rpc("backups_list", { p_token: T() }); B.loaded = true; }
V.backup = () => {
  const B = S.bk; if (!B || !B.loaded) return header() + later(loadBk, "backup");
  let h = header(`<button class="btn gold" data-act="bkNow">${ico("backup")} نسخة احتياطية دلوقتي</button>`);
  const last = B.list[0];
  h += `<div class="grid g3"><div class="card kpi lux rise"><div class="lbl">آخر نسخة</div><div class="val" style="font-size:20px">${last ? dt(last.at) : "لسه"}</div><div class="dim" style="font-size:12px">${last ? KIND[last.kind][0] + " · " + num(last.rows) + " سطر" : ""}</div></div>
   <div class="card kpi rise" style="--d:1"><div class="lbl">النسخ المحفوظة على السيرفر</div><div class="val">${B.list.length}</div><div class="dim" style="font-size:12px">آخر ٢٤ ساعة كل ساعة · آخر ٣٠ يوم يومي</div></div>
   <div class="card kpi rise" style="--d:2"><div class="lbl">النسخة على جهازك</div><div class="val" style="font-size:18px">ملف مشفّر</div><div class="dim" style="font-size:12px">بكلمة سر إنت اللي بتختارها</div></div></div>`;
  h += `<div class="card rise"><h3>النسخ</h3><div class="tw"><table><thead><tr><th>#</th><th>الوقت</th><th>النوع</th><th>بواسطة</th><th class="n">الجداول</th><th class="n">السطور</th><th class="n">الحجم</th><th>ملاحظة</th><th></th></tr></thead><tbody>${B.list.map(b => `<tr><td class="num dim">${b.id}</td><td class="num">${dt(b.at)}</td><td>${chip(KIND[b.kind][0], KIND[b.kind][1])}</td><td>${esc(b.by || "تلقائي")}</td><td class="n">${b.tables}</td><td class="n">${num(b.rows)}</td><td class="n">${kb(b.bytes)}</td><td class="muted">${esc(b.note || "")}</td><td><button class="btn sm" data-act="bkDl" data-id="${b.id}">تنزيل مشفّر</button></td></tr>`).join("") || empty(9, "لسه مفيش نسخ — أول نسخة تلقائية بتتعمل خلال ساعة.")}</tbody></table></div>
   <p class="dim" style="font-size:12.5px;margin-bottom:0">النسخة بتشمل كل البيانات: الأصناف والمخزون والفواتير والحسابات والموظفين والإعدادات. احتفظ بنسخة مشفّرة على فلاشة أو درايف بره الجهاز.</p></div>`;
  if (isOwner()) h += `<div class="grid g2"><div class="card rise"><h3>استعادة نسخة</h3><p class="muted" style="margin-top:0">بتمسح البيانات الحالية وترجّع اللي في الملف. قبلها السيرفر بياخد نسخة «قبل تغيير كبير» لوحده، وتسجيل الأجهزة وسجل التدقيق مش بيتلمسوا.</p>
     <div class="stack"><input type="file" class="inp" id="rsFile" accept=".minzo,application/json"><input class="inp" type="password" id="rsPw" placeholder="كلمة سر الملف"><button class="btn" data-act="rsOpen">فتح الملف</button><div id="rsBox"></div></div></div>
    <div class="card rise" style="border-color:var(--bad)"><h3 style="color:var(--bad)">تصفير النظام</h3><p class="muted" style="margin-top:0">للبدء من جديد بعد التجربة. السيرفر بياخد نسخة قبل التصفير، والموظفين والأدوار والأجهزة والإعدادات وسجل التدقيق بيفضلوا.</p>
     <div class="stack"><label class="row" style="gap:8px"><input type="radio" name="rsL" value="moves" checked> تصفير الحركات بس — الفواتير والمخزون والخزنة والقيود والمصروفات (الأصناف والعملاء والموردين بيفضلوا)</label>
      <label class="row" style="gap:8px"><input type="radio" name="rsL" value="all"> تصفير كامل — كمان الأصناف والعملاء والموردين والعروض وشركات التقسيط</label>
      <div class="grid g2"><input class="inp num" type="password" id="zrPin" placeholder="رمزك"><input class="inp" id="zrTxt" placeholder="اكتب: تصفير"></div><button class="btn danger" data-act="zrGo">تصفير</button><div id="zrErr"></div></div></div></div>`;
  return h;
};
/* AES-GCM with a key from the password (PBKDF2, 200k rounds); gzip when the browser has it */
const b64 = u => { let s = ""; const c = 0x8000; for (let i = 0; i < u.length; i += c) s += String.fromCharCode.apply(null, u.subarray(i, i + c)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function keyFrom(pw, salt) { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveKey"]); return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200000, hash: "SHA-256" }, k, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
async function gz(u, back) { if (!window.CompressionStream) return u; const s = new Blob([u]).stream().pipeThrough(back ? new DecompressionStream("gzip") : new CompressionStream("gzip")); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function seal(obj, pw) { const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), z = !!window.CompressionStream;
  const data = await gz(new TextEncoder().encode(JSON.stringify(obj))), ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFrom(pw, salt), data));
  return JSON.stringify({ app: "SYS Minzo", v: 1, enc: "AES-GCM/PBKDF2-SHA256-200000", gzip: z, salt: b64(salt), iv: b64(iv), at: obj.at, store: obj.store, data: b64(ct) }); }
async function unseal(txt, pw) { const f = JSON.parse(txt); if (f.app !== "SYS Minzo" || !f.data) throw new Error("BAD_BACKUP");
  let pt; try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.iv) }, await keyFrom(pw, unb64(f.salt)), unb64(f.data))); } catch (e) { throw new Error("كلمة السر غلط أو الملف متغيّر."); }
  if (f.gzip) pt = await gz(pt, true); return JSON.parse(new TextDecoder().decode(pt)); }
function pwModal(id) { modal(`<h2>تنزيل نسخة مشفّرة #${id}</h2><p class="muted">اختار كلمة سر للملف. من غيرها الملف مينفعش يتفتح — احفظها في مكان آمن.</p><div class="stack"><input class="inp" type="password" id="pw1" placeholder="كلمة السر (٨ حروف على الأقل)" autocomplete="new-password"><input class="inp" type="password" id="pw2" placeholder="تأكيد كلمة السر" autocomplete="new-password"><div id="pwErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="bkDlGo" data-id="${id}">تنزيل</button></div></div>`); }

/* =====================================================================
   EXPORT (9 formats) — shared: window.MZEXP(title, head, rows, sensCols)
   ===================================================================== */
const FMTS = [["xlsx", "Excel (.xlsx)"], ["xls", "Excel 97 (.xls)"], ["ods", "OpenDocument (.ods)"], ["csv", "CSV (UTF-8)"], ["tsv", "نص بفواصل (.txt)"], ["json", "JSON"], ["xml", "XML"], ["html", "صفحة HTML"], ["pdf", "PDF (طباعة)"]];
const mask = v => { const s = String(v == null ? "" : v); return /^0?1\d{9}$/.test(s) ? s.slice(0, 3) + "*****" + s.slice(-3) : s ? "***" : ""; };
const xmlEsc = s => String(s == null ? "" : s).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
function fileOut(name, mime, content) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([content], { type: mime })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
function writeOut(fmt, title, head, rows) {
  const base = title.replace(/[\\/:*?"<>|]/g, "-") + "-" + today();
  if (["xlsx", "xls", "ods"].includes(fmt)) { const ws = XLSX.utils.aoa_to_sheet([head, ...rows]); ws["!views"] = [{ RTL: true }]; ws["!cols"] = head.map(() => ({ wch: 16 })); const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 30)); XLSX.writeFile(wb, `${base}.${fmt}`, { bookType: fmt === "xls" ? "biff8" : fmt }); return; }
  if (fmt === "csv" || fmt === "tsv") { const sep = fmt === "csv" ? "," : "\t", cell = v => { const s = String(v == null ? "" : v); return fmt === "csv" && /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s.replace(/\t/g, " "); };
    return fileOut(`${base}.${fmt === "csv" ? "csv" : "txt"}`, "text/plain;charset=utf-8", "﻿" + [head, ...rows].map(r => r.map(cell).join(sep)).join("\r\n")); }
  if (fmt === "json") return fileOut(`${base}.json`, "application/json", JSON.stringify(rows.map(r => Object.fromEntries(head.map((k, i) => [k, r[i]]))), null, 2));
  if (fmt === "xml") return fileOut(`${base}.xml`, "application/xml", `<?xml version="1.0" encoding="UTF-8"?>\n<rows title="${xmlEsc(title)}">\n${rows.map(r => `  <row>${head.map((k, i) => `<c n="${xmlEsc(k)}">${xmlEsc(r[i])}</c>`).join("")}</row>`).join("\n")}\n</rows>`);
  const tbl = `<h2 style="font-family:Tahoma">${esc(title)}</h2><p style="color:#666;font-family:Tahoma">${esc((S.store && S.store.name) || "")} · ${new Date().toLocaleString("ar-EG")}</p><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:Tahoma;font-size:12px"><thead><tr>${head.map(x => `<th style="background:#eee">${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  if (fmt === "html") return fileOut(`${base}.html`, "text/html;charset=utf-8", `<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8"><title>${esc(title)}</title><body>${tbl}</body></html>`);
  const w = window.open("", "_blank"); if (!w) return toast("المتصفح منع نافذة الطباعة.", true);
  w.document.write(`<html dir="rtl"><head><title>${esc(title)}</title><style>@page{size:A4 landscape;margin:10mm}</style></head><body>${tbl}<script>setTimeout(()=>print(),300)<\/script></body></html>`); w.document.close();
}
function expModal(title, head, rows, sens) {
  S._exp = { title, head, rows, sens: sens || [] }; const canS = isOwner() || has("exportSensitive");
  modal(`<h2>تصدير · ${esc(title)}</h2><p class="muted" style="margin-top:0">${num(rows.length)} سطر.</p><div class="stack"><div class="grid g3">${FMTS.map(([k, n], i) => `<label class="row" style="gap:6px"><input type="radio" name="exF" value="${k}" ${i ? "" : "checked"}> ${n}</label>`).join("")}</div>
   ${S._exp.sens.length ? `<label class="row" style="gap:8px"><input type="checkbox" id="exS" ${canS ? "" : "disabled"}> بالبيانات الحساسة (${esc(S._exp.sens.map(i => head[i]).join("، "))})</label>${canS ? `<input class="inp num" type="password" id="exPin" placeholder="رمزك — مطلوب للبيانات الحساسة" style="display:none">` : `<p class="dim" style="margin:0;font-size:12.5px">البيانات الحساسة بتطلع مقنّعة — تصديرها صلاحية مستقلة.</p>`}` : ""}<div id="exErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="exGo">تصدير</button></div></div>`);
  const c = $("#exS"); if (c && $("#exPin")) c.onchange = () => { $("#exPin").style.display = c.checked ? "" : "none"; };
}
window.MZEXP = expModal;
const DS = [
  ["items", "الأصناف", () => isTop() || can("items", "x"), async () => { const st = id => S.stock.filter(s => s.item_id === id).reduce((a, s) => a + +s.qty, 0);
    return [["الكود", "الباركود", "الاسم", "القسم", "الوحدة", "سعر البيع", "آخر تكلفة", "الرصيد الكلي", "حد أدنى", "مسلسل", "ضمان (شهر)"], S.items.map(i => [i.code, i.barcode || "", i.name, (S.depts.find(d => d.id === i.department_id) || {}).name || "", UNITS[i.unit], +i.sale_price, +i.last_cost, st(i.id), +i.min_qty, i.serial_required ? "نعم" : "لا", i.warranty_months]), [6]]; }],
  ["stock", "المخزون", () => isTop() || can("stock", "x"), async () => [["الصنف", "الكود", "المكان", "الكمية", "التكلفة", "القيمة"], S.stock.filter(s => +s.qty !== 0).map(s => { const i = S.items.find(x => x.id === s.item_id) || {}; return [i.name, i.code, locName(s.location_id), +s.qty, +i.last_cost, Math.round(+s.qty * +i.last_cost * 100) / 100]; }), [4, 5]]],
  ["customers", "العملاء", () => isTop() || can("customers", "x"), async () => { const L = await rpc("customers_list", { p_token: T() }); return [["الاسم", "الموبايل", "المنطقة", "العنوان", "الفواتير", "المشتريات", "النقاط"], L.map(c => [c.name, c.phone || "", c.area || "", c.address || "", +c.invoices, +c.spent, +c.points]), [1, 3]]; }],
  ["suppliers", "الموردين", () => isTop() || can("suppliers", "x"), async () => { const L = await q("suppliers", "*", x => x.order("name")); return [["المورد", "النوع", "المسؤول", "التليفون", "مدة السداد", "حد الائتمان", "رصيد أول المدة"], L.map(s => [s.name, s.kind, s.contact || "", s.phone || "", s.terms_days, +s.credit_limit, +s.opening_balance]), [3]]; }],
  ["sales", "فواتير البيع", () => isTop() || can("cash", "x") || can("close", "x"), async (f, t) => { await loadDir(); const L = await q("sales", "*", x => x.gte("business_day", f).lte("business_day", t).order("created_at").limit(20000));
    return [["الفاتورة", "اليوم", "المكان", "الكاشير", "الإجمالي قبل الخصم", "الخصم", "الضريبة", "الصافي", "الحالة", "التكلفة", "الربح"], L.map(s => [s.no, s.business_day, locName(s.location_id), who(s.cashier_id), +s.gross, +s.discount, +s.vat, +s.total, s.status === "void" ? "ملغاة" : "سارية", +s.cost, Math.round((s.total - s.vat - s.cost) * 100) / 100]), [9, 10]]; }],
  ["expenses", "المصروفات", () => isTop() || can("expense", "x"), async (f, t) => { await loadDir(); const [L, C] = await Promise.all([q("expenses", "*", x => x.gte("exp_date", f).lte("exp_date", t).order("exp_date")), q("expense_categories", "id,name")]);
    return [["الرقم", "التاريخ", "البند", "المكان", "البيان", "المستفيد", "المبلغ", "الحالة"], L.map(x => [x.no, x.exp_date, (C.find(c => c.id === x.category_id) || {}).name || "", x.location_id ? locName(x.location_id) : "عام", x.note, x.payee || "", +x.amount, x.status]), [5]]; }],
  ["returns", "المرتجعات", () => isTop() || can("returns", "x"), async (f, t) => { await loadDir(); const L = await q("returns", "*", x => x.gte("created_at", f + "T00:00:00+02:00").lte("created_at", t + "T23:59:59+02:00").order("created_at"));
    return [["المرتجع", "التاريخ", "المكان", "السبب", "رد الفلوس", "القيمة", "سجّله"], L.map(r => [r.no, r.created_at.slice(0, 10), locName(r.location_id), r.reason, PAYN[r.refund_method] || r.refund_method, +r.amount, who(r.staff_id)]), []]; }],
  ["audit", "سجل التدقيق", () => isTop() || can("audit", "x"), async (f, t) => { const L = await q("audit_log", "n,at,staff_name,action,entity,before,after,reason,hash", x => x.gte("at", f + "T00:00:00+02:00").lte("at", t + "T23:59:59+02:00").order("n").limit(50000));
    return [["#", "التوقيت", "الموظف", "الإجراء", "على", "قبل", "بعد", "السبب", "البصمة"], L.map(r => [r.n, new Date(r.at).toLocaleString("ar-EG"), r.staff_name || "", r.action, r.entity || "", r.before || "", r.after || "", r.reason || "", r.hash]), []]; }],
  ["gl", "دفتر اليومية", () => isTop() || can("gl", "x"), async (f, t) => { const L = await rpc("gl_journal", { p_token: T(), p_from: f, p_to: t }); return [["التاريخ", "المصدر", "المرجع", "البيان", "الحساب", "مدين", "دائن"], L.map(r => [r[0], r[1], r[2], r[3], r[4], +r[5], +r[6]]), []]; }]
];
V.export = () => {
  const E = S.xp || (S.xp = { ds: (DS.find(d => d[2]()) || DS[0])[0], from: new Date(Date.now() - 30 * 864e5 + 2 * 3600e3).toISOString().slice(0, 10), to: today() });
  const L = DS.filter(d => d[2]()), cur = L.find(d => d[0] === E.ds) || L[0], dated = ["sales", "expenses", "returns", "audit", "gl"].includes(cur && cur[0]);
  let h = header();
  h += `<div class="card rise"><div class="stack"><div class="grid g3"><div class="field"><label>البيانات</label><select class="inp" id="xpD">${L.map(d => `<option value="${d[0]}" ${cur && cur[0] === d[0] ? "selected" : ""}>${d[1]}</option>`).join("")}</select></div>
    ${dated ? `<div class="field"><label>من</label><input class="inp" type="date" id="xpF" value="${E.from}"></div><div class="field"><label>إلى</label><input class="inp" type="date" id="xpT" value="${E.to}"></div>` : ""}</div>
    <button class="btn gold" data-act="xpGo" style="align-self:flex-start" ${cur ? "" : "disabled"}>${ico("export")} اختيار الصيغة والتصدير</button></div>
    <p class="dim" style="font-size:12.5px;margin-bottom:0">الصيغ: Excel (xlsx و xls)، OpenDocument، CSV بترميز UTF-8 عشان العربي يظهر صح في Excel، نص، JSON، XML، HTML، وPDF من نافذة الطباعة. التكلفة والأرباح والتليفونات بتطلع مقنّعة إلا بصلاحية «تصدير البيانات الحساسة» ورمزك، وكل تصدير بيتسجّل في سجل التدقيق.</p></div>`;
  return h;
};
H.export = () => { const on = (id, fn) => { const el = $(id); if (el) el.onchange = fn; }; on("#xpD", e => { S.xp.ds = e.target.value; render(); }); on("#xpF", e => { S.xp.from = e.target.value; }); on("#xpT", e => { S.xp.to = e.target.value; }); };

/* =====================================================================
   ACTIONS (chained after batch 1's handler)
   ===================================================================== */
const prev = window.MZX;
window.MZX = async function (k, a) {
  const wrap = async (fn, after, box) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (box && $(box)) errBox(box, e); else toast(errText(e), true); busy(a, false); } };
  const id = a.dataset.id;
  if (k === "avScope") { S.av.scope = a.dataset.k; render(); }
  else if (k === "avOpen") { S.av.open[a.dataset.k] = !S.av.open[a.dataset.k]; render(); }
  else if (k === "avSet") { const p = { scope: a.dataset.scope, ref: a.dataset.ref, location_id: a.dataset.loc || null, state: a.dataset.st, reason: null };
    if (a.dataset.ask) { if (!confirm("إيقاف الصنف ده في المعرض؟ هيفضل ظاهر في الإدارة والتقارير.")) return true; p.reason = "راكد — مفيش بيع"; }
    if (p.scope !== "item" && p.state !== "on" && !confirm(`تطبيق «${STN[p.state][0]}» على ${p.scope === "group" ? "المجموعة" : "القسم"} كله${p.location_id ? " في " + locName(+p.location_id) : " في كل المعارض"}؟`)) return true;
    wrap(() => rpc("item_rule_save", { p_token: T(), p }), async () => { await loadRules(); render(); }); }
  else if (k === "avSch") avSchModal(a.dataset.scope, a.dataset.ref);
  else if (k === "avSchGo") { const days = [...document.querySelectorAll("[data-dow]")].filter(c => c.checked).map(c => +c.dataset.dow);
    const p = { scope: a.dataset.scope, ref: a.dataset.ref, location_id: $("#sL").value || null, state: $("#sS").value, date_from: $("#sF").value || null, date_to: $("#sT").value || null, days, hour_from: $("#sH1").value || null, hour_to: $("#sH2").value || null, reason: $("#sR").value };
    if (!p.date_from && !p.date_to && !days.length && !p.hour_from) { errBox("#sErr", "حدد التاريخ أو الأيام أو الساعات."); return true; }
    if (p.hour_from && !p.hour_to) { errBox("#sErr", "حدد ساعة النهاية."); return true; }
    wrap(() => rpc("item_rule_save", { p_token: T(), p }), async () => { closeModal(); await loadRules(); toast("اتحفظ الجدول."); render(); }, "#sErr"); }
  else if (k === "avEnd") wrap(() => rpc("item_rule_end", { p_token: T(), p_id: +id }), async () => { await loadRules(); render(); });
  /* roles */
  else if (k === "rlSel") { S.rl.sel = id; S.rl.draft = null; render(); }
  else if (k === "rlNew" || k === "rlCopy") { const src = k === "rlCopy" ? rlRead() : { perms: {}, sens: [], scope_days: 0, max_discount_pct: 0, max_amount: 0, hide_cost: true, hide_margin: true, hide_salary: true, scope_all_locations: false };
    const nm = prompt("اسم الدور الجديد", k === "rlCopy" ? src.name + " (نسخة)" : ""); if (!nm) return true;
    const p = Object.assign({}, src, { id: null, name: nm }); const pin = isOwner() ? null : prompt("رمز المالك للتأكيد"); if (!isOwner() && !pin) return true;
    wrap(async () => { const rid = await rpc("role_save", { p_token: T(), p, p_owner_pin: pin }); await loadRoles(); S.rl.sel = rid; }, async () => { toast("اتضاف الدور."); render(); }); }
  else if (k === "rlSave") { const r = rlRead(), p = { id: r.id, name: r.name, perms: r.perms, sens: r.sens, scope_all_locations: r.scope_all_locations, scope_days: r.scope_days, max_discount_pct: r.max_discount_pct, max_amount: r.max_amount, hide_cost: r.hide_cost, hide_margin: r.hide_margin, hide_salary: r.hide_salary, reason: $("#rlWhy").value };
    wrap(() => rpc("role_save", { p_token: T(), p, p_owner_pin: ($("#rlPin") || {}).value || null }), async () => { toast("اتحفظت الصلاحيات."); const keep = S.rl.sel; await loadRoles(); S.rl.sel = keep; render(); }, "#rlErr"); }
  else if (k === "rlDel") { if (!confirm("حذف الدور ده؟")) return true; wrap(() => rpc("role_delete", { p_token: T(), p_id: S.rl.sel, p_owner_pin: ($("#rlPin") || {}).value || null }), async () => { S.rl.sel = null; await loadRoles(); render(); }, "#rlErr"); }
  else if (k === "rlPrev") previewStart(rlRead());
  else if (k === "rlPrevEnd") previewEnd();
  /* audit */
  else if (k === "auVerify") wrap(async () => { const r = await rpc("audit_verify", { p_token: T() }); busy(a, false);
    $("#auRes").innerHTML = r.ok ? `<span class="chip ok">السلسلة سليمة · اتراجع ${num(r.checked)} سطر</span>` : `<span class="chip bad">السلسلة مكسورة عند السطر #${r.at} — حد عدّل في البيانات من بره النظام</span>`; });
  else if (k === "auXls") { const A = S.au; expModal("سجل التدقيق", ["#", "التوقيت", "الموظف", "الإجراء", "على", "قبل", "بعد", "السبب", "البصمة"], A.rows.map(r => [r.n, new Date(r.at).toLocaleString("ar-EG"), r.staff_name || "", r.action, r.entity || "", r.before || "", r.after || "", r.reason || "", r.hash]), []); }
  /* backup */
  else if (k === "bkNow") wrap(() => rpc("backup_now", { p_token: T(), p_note: null }), async () => { toast("اتعملت نسخة احتياطية."); await loadBk(); render(); });
  else if (k === "bkDl") pwModal(id);
  else if (k === "bkDlGo") { const p1 = $("#pw1").value, p2 = $("#pw2").value; if (p1.length < 8) return errBox("#pwErr", "كلمة السر ٨ حروف على الأقل."), true; if (p1 !== p2) return errBox("#pwErr", "الكلمتين مش زي بعض."), true;
    wrap(async () => { const d = await rpc("backup_get", { p_token: T(), p_id: +id }); const f = await seal(d, p1); fileOut(`SYS-Minzo-backup-${String(d.at).slice(0, 16).replace(/[:T]/g, "-")}.minzo`, "application/octet-stream", f); closeModal(); toast("اتنزّلت النسخة المشفّرة."); }, null, "#pwErr"); }
  else if (k === "rsOpen") { const f = $("#rsFile").files[0]; if (!f) return toast("اختار الملف.", true), true;
    wrap(async () => { const d = await unseal(await f.text(), $("#rsPw").value); S._rs = d; busy(a, false); const t = d.tables || {}, cnt = n => (t[n] || []).length;
      $("#rsBox").innerHTML = `<div class="okbox">نسخة «${esc(d.store || "")}» بتاريخ ${dt(d.at)}<br>${num(cnt("items"))} صنف · ${num(cnt("sales"))} فاتورة · ${num(cnt("customers"))} عميل · ${num(cnt("staff"))} موظف</div><div class="grid g2" style="margin-top:8px"><input class="inp num" type="password" id="rsPin" placeholder="رمزك"><input class="inp" id="rsTxt" placeholder="اكتب: استعادة"></div><button class="btn danger" data-act="rsGo" style="margin-top:8px">استعادة النسخة دي</button><div id="rsErr"></div>`; }, null, "#rsBox"); }
  else if (k === "rsGo") { if (!S._rs) return true; if (!confirm("البيانات الحالية هتتمسح وترجع اللي في النسخة. متأكد؟")) return true;
    wrap(async () => { const r = await rpc("backup_restore", { p_token: T(), p_data: S._rs, p_pin: $("#rsPin").value, p_confirm: $("#rsTxt").value.trim() }); S._rs = null; toast(`اتعملت الاستعادة: ${num(r.rows)} سطر.`); await M.loadCore(); await M.loadItems(); await loadBk(); render(); }, null, "#rsErr"); }
  else if (k === "zrGo") { const lv = (document.querySelector("[name=rsL]:checked") || {}).value || "moves"; if (!confirm(lv === "all" ? "تصفير كامل؟ الأصناف والعملاء والموردين والحركات كلها هتتمسح." : "تصفير كل الحركات؟")) return true;
    wrap(async () => { const r = await rpc("system_reset", { p_token: T(), p_level: lv, p_pin: $("#zrPin").value, p_confirm: $("#zrTxt").value.trim() }); toast(`اتصفّر النظام — اتعملت نسخة #${r.backup} قبلها.`); S.cash = null; S.cl = null; S.ex = null; await M.loadItems(); await loadBk(); render(); }, null, "#zrErr"); }
  /* export */
  else if (k === "xpGo") { const E = S.xp, d = DS.find(x => x[0] === E.ds); wrap(async () => { const [head, rows, sens] = await d[3](E.from, E.to); busy(a, false); expModal(d[1], head, rows, sens); }); }
  else if (k === "exGo") { const X = S._exp, fmtK = (document.querySelector("[name=exF]:checked") || {}).value || "xlsx", sens = !!($("#exS") && $("#exS").checked);
    wrap(async () => { await rpc("export_log", { p_token: T(), p_dataset: X.title, p_format: fmtK, p_rows: X.rows.length, p_sensitive: sens, p_pin: sens ? ($("#exPin") || {}).value : null });
      const rows = sens ? X.rows : X.rows.map(r => r.map((v, i) => X.sens.includes(i) ? mask(v) : v)); writeOut(fmtK, X.title, X.head, rows); closeModal(); }, null, "#exErr"); }
  else return prev ? prev(k, a) : false;
  return true;
};
})();
