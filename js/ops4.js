/* SYS Minzo · staff payroll & attendance (batch 4) + loyalty points at the POS */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, rpc, q, T, can, has, locName, ico, toast, modal, closeModal, busy, header, render, loadDir, who, today, errText, myLoc } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const dt = x => x ? new Date(x).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }) : "—";
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const empty = (n, t) => `<tr><td colspan="${n}" class="muted">${t}</td></tr>`;
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const later = (fn, r) => { setTimeout(() => fn().then(() => S.route === r && render()).catch(e => toast(errText(e), true)), 0); return `<div class="spin"></div>`; };
const DOW = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
const ST = { present: ["حاضر", "ok"], leave: ["إجازة", "info"], sick: ["مرضي", "info"], absent: ["غياب", "bad"], off: ["راحة", "plain"] };
const RUN = { draft: ["مسودة", "warn"], approved: ["معتمدة — مستنية الصرف", "info"], paid: ["اتصرفت", "ok"] };
const hm = x => x ? new Date(new Date(x).getTime() + 2 * 3600e3).toISOString().slice(11, 16) : "";

/* ---------- check in / out from the top bar ---------- */
M.punchState = () => punchState();
async function punchState() { try { S.att = await rpc("attend_today", { p_token: T() }); } catch (e) { S.att = null; } paintPunch(); }
function paintPunch() { const top = $("#top"); if (!top || !S.sess) return; let b = $("#mzPunch"); if (!b) { b = document.createElement("button"); b.id = "mzPunch"; b.className = "ctl"; b.dataset.act = "punch"; const lock = top.querySelector("[data-act=lock]"); top.insertBefore(b, lock); }
  const a = S.att; b.textContent = !a || !a.check_in ? "تسجيل حضور" : !a.check_out ? `انصراف · من ${dt(a.check_in)}` : `انصرفت ${dt(a.check_out)}`; b.disabled = !!(a && a.check_out); }
new MutationObserver(() => { if (S.sess && $("#top") && !$("#mzPunch")) paintPunch(); }).observe(document.body, { childList: true, subtree: true });
setInterval(() => { if (S.sess && S._attFor !== S.sess.token) { S._attFor = S.sess.token; punchState(); } }, 1500);

/* =====================================================================
   الموظفين والمرتبات
   ===================================================================== */
async function loadStaffPay() { const W = S.sp || (S.sp = { tab: "att", month: today().slice(0, 7), day: today() }); await loadDir();
  const m = W.month, d1 = m + "-01", d2 = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
  const [att, pl, acc] = await Promise.all([q("attendance", "*", x => x.gte("day", d1).lte("day", d2)), rpc("payroll_list", { p_token: T(), p_month: m }), q("cash_accounts", "*", x => x.eq("active", true).order("id"))]);
  Object.assign(W, { att, pl, acc, d1, d2, loaded: m }); }
const staffOf = () => (S.dir || []).filter(x => x.active && myLoc(x.location_id || S.sess.staff.location_id));
V.staff = () => {
  const W = S.sp; if (!W || W.loaded !== W.month) return header() + later(loadStaffPay, "staff");
  const sal = W.pl.see_salary, run = W.pl.run || { status: "draft" }, ed = isTop() || can("staff", "e"), ap = isTop() || can("staff", "p");
  const tabs = [["att", "الحضور اليومي"], ["month", "حضور الشهر"], ...(sal ? [["pay", "المرتبات"], ["adv", "السلف"], ["set", "بيانات المرتبات"]] : [])];
  let h = header(`<div class="tabs">${tabs.map(([k, n]) => `<button data-act="spTab" data-k="${k}" class="${W.tab === k ? "on" : ""}">${n}</button>`).join("")}</div><input class="inp" type="month" id="spM" value="${W.month}" style="width:auto">`);
  const people = staffOf();
  if (W.tab === "att") {
    const rows = people.map(p => ({ p, a: W.att.find(a => a.staff_id === p.id && a.day === W.day) }));
    h += `<div class="card rise"><div class="row" style="gap:8px;margin-bottom:10px"><input class="inp" type="date" id="spD" value="${W.day}" max="${today()}" style="width:auto"><span class="dim">${rows.filter(r => r.a && r.a.check_in).length} حاضر من ${rows.length}</span></div>
     <div class="tw"><table><thead><tr><th>الموظف</th><th>المكان</th><th>حضور</th><th>انصراف</th><th>الحالة</th><th>ملاحظة</th><th></th></tr></thead><tbody>${rows.map(({ p, a }) => `<tr><td>${esc(p.name)}</td><td class="muted">${p.location_id ? esc(locName(p.location_id)) : "كل الأماكن"}</td><td class="num">${a ? dt(a.check_in) : "—"}</td><td class="num">${a ? dt(a.check_out) : "—"}</td><td>${a ? chip(ST[a.status][0], ST[a.status][1]) + (a.source === "manual" ? " " + chip("يدوي") : "") + (a.source === "gps" ? " " + chip(a.outside ? "📍 بره المكان" : "📍 موبايل", a.outside ? "bad" : "plain") : "") : chip("ما سجّلش", "warn")}</td><td class="muted" style="font-size:12.5px">${esc((a && a.note) || "")}</td><td>${ed || ["mgr", "asstmgr"].includes(S.sess.role.id) ? `<button class="btn sm ghost" data-act="attEdit" data-id="${p.id}">تعديل</button>` : ""}</td></tr>`).join("") || empty(7, "مفيش موظفين.")}</tbody></table></div>
     <p class="dim" style="font-size:12.5px;margin-bottom:0">كل موظف بيسجّل حضوره وانصرافه برمزه من زرار «تسجيل حضور» فوق. التعديل اليدوي محتاج سبب وبيتسجّل في سجل التدقيق.</p></div>`;
  }
  if (W.tab === "month") {
    const days = []; for (let d = W.d1; d <= W.d2; d = new Date(new Date(d + "T12:00:00Z").getTime() + 864e5).toISOString().slice(0, 10)) days.push(d);
    h += `<div class="card rise"><div class="tw"><table style="font-size:12px"><thead><tr><th>الموظف</th>${days.map(d => `<th class="num" style="padding:4px 3px;text-align:center">${+d.slice(8)}</th>`).join("")}</tr></thead><tbody>${people.map(p => `<tr><td style="white-space:nowrap">${esc(p.name)}</td>${days.map(d => { const a = W.att.find(x => x.staff_id === p.id && x.day === d), fut = d > today();
      return `<td style="text-align:center;padding:4px 2px" title="${a ? hm(a.check_in) + "–" + hm(a.check_out) : ""}">${fut ? "" : a ? (a.check_in ? `<span style="color:var(--ok)">●</span>` : `<span style="color:var(--${a.status === "absent" ? "bad" : "info"})">${ST[a.status][0][0]}</span>`) : `<span class="dim">·</span>`}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>
     <p class="dim" style="font-size:12px;margin-bottom:0">● حاضر · إ إجازة · م مرضي · غ غياب · ر راحة · نقطة = ما سجّلش</p></div>`;
  }
  if (W.tab === "pay") {
    const L = W.pl.lines || [], tot = k => L.reduce((a, l) => a + +l[k], 0);
    h += `<div class="card rise"><div class="row between" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div>${chip("مرتبات " + W.month + " · " + RUN[run.status][0], RUN[run.status][1])}</div><div class="row" style="gap:6px">${run.status === "draft" && ed ? `<button class="btn" data-act="prCalc">${L.length ? "إعادة الحساب" : "حساب المرتبات"}</button>` : ""}${run.status === "draft" && ap && L.length ? `<button class="btn gold" data-act="prAppr">اعتماد وقيد المرتبات</button>` : ""}${run.status === "approved" && ap ? `<button class="btn gold" data-act="prPay">صرف المرتبات</button>` : ""}</div></div>
     <div class="tw"><table><thead><tr><th>الموظف</th><th class="n">الأساسي</th><th class="n">بدلات</th><th class="n">عمولة</th><th class="n">حافز</th><th class="n">أيام عمل / حضور / غياب</th><th class="n">تأخير (دقيقة)</th><th class="n">خصم تأخير</th><th class="n">خصم غياب</th><th class="n">خصومات أخرى</th><th class="n">سلف</th><th class="n">الصافي</th><th></th></tr></thead><tbody>${L.map(l => `<tr><td>${esc(l.name)}${l.note ? `<br><span class="dim" style="font-size:12px">${esc(l.note)}</span>` : ""}</td><td class="n">${fmt(l.base)}</td><td class="n">${fmt(l.allowances)}</td><td class="n">${fmt(l.commission, 1)}</td><td class="n">${fmt(l.bonus)}</td><td class="n num">${l.work_days} / ${l.present_days} / ${l.absent_days}</td><td class="n">${num(l.late_min)}</td><td class="n">${fmt(l.late_deduct, 1)}</td><td class="n">${fmt(l.absent_deduct, 1)}</td><td class="n">${fmt(l.other_deduct)}</td><td class="n">${fmt(l.advances)}</td><td class="n" style="font-weight:700;color:var(${+l.net < 0 ? "--bad" : "--fg"})">${fmt(l.net, 1)}</td><td>${run.status === "draft" && ed ? `<button class="btn sm ghost" data-act="prLine" data-id="${l.staff_id}">تعديل</button>` : ""}</td></tr>`).join("") || empty(13, "لسه ما اتحسبتش — اضغط «حساب المرتبات». الموظفين اللي ليهم أساسي أو عمولة بيدخلوا لوحدهم.")}
     ${L.length ? `<tr style="font-weight:700"><td>الإجمالي</td><td class="n">${fmt(tot("base"))}</td><td class="n">${fmt(tot("allowances"))}</td><td class="n">${fmt(tot("commission"), 1)}</td><td class="n">${fmt(tot("bonus"))}</td><td></td><td></td><td class="n">${fmt(tot("late_deduct"), 1)}</td><td class="n">${fmt(tot("absent_deduct"), 1)}</td><td class="n">${fmt(tot("other_deduct"))}</td><td class="n">${fmt(tot("advances"))}</td><td class="n">${fmt(tot("net"), 1)}</td><td></td></tr>` : ""}</tbody></table></div>
     <p class="dim" style="font-size:12.5px;margin-bottom:0">العمولة من «عمولات البائعين». خصم التأخير بالدقيقة بعد فترة السماح، وخصم الغياب باليوم، والاتنين بيتحسبوا من الأساسي. الاعتماد بيعمل قيد المرتبات (مصروف المرتبات، والسلف المخصومة، والمرتبات المستحقة)، والصرف بيخرج الصافي من الخزنة. سجّل المرتبات من هنا بس — مش من شاشة المصروفات — عشان ما تتحسبش مرتين.</p><div id="prErr"></div></div>`;
  }
  if (W.tab === "adv") {
    const A = W.pl.advances || [];
    h += `<div class="card rise"><h3>السلف${isTop() || can("staff", "a") ? `<button class="btn sm gold" data-act="advNew" style="margin-inline-start:auto">${ico("plus")} سلفة</button>` : ""}</h3><div class="tw"><table><thead><tr><th>الرقم</th><th>الموظف</th><th>التاريخ</th><th class="n">المبلغ</th><th>من</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>${A.map(a => `<tr><td class="num dim">${esc(a.no)}</td><td>${esc(who(a.staff_id))}</td><td class="num">${esc(a.adv_date)}</td><td class="n">${fmt(a.amount)}</td><td class="muted">${esc((W.acc.find(c => c.id === a.account_id) || {}).name || "")}</td><td>${a.status === "open" ? chip("هتتخصم من المرتب", "warn") : chip("اتخصمت " + (a.payroll_month || ""), "ok")}</td><td class="muted">${esc(a.note || "")}</td></tr>`).join("") || empty(7, "مفيش سلف مفتوحة.")}</tbody></table></div><p class="dim" style="font-size:12.5px;margin-bottom:0">السلفة بتخرج من الخزنة أو الدرج على حساب «عملاء ومدينون»، وبتتخصم لوحدها في مرتب الشهر.</p></div>`;
  }
  if (W.tab === "set") {
    const P = W.pl.pay || [];
    h += `<div class="card rise"><div class="tw"><table><thead><tr><th>الموظف</th><th class="n">الأساسي</th><th class="n">بدلات</th><th>بداية الشيفت</th><th class="n">ساعات اليوم</th><th class="n">سماح (دقيقة)</th><th>أيام العمل</th><th>خصم تأخير / غياب</th><th></th></tr></thead><tbody>${people.map(p => { const x = P.find(y => y.staff_id === p.id) || {}; return `<tr><td>${esc(p.name)}</td><td class="n">${x.base_salary != null ? fmt(x.base_salary) : "—"}</td><td class="n">${x.allowances != null ? fmt(x.allowances) : "—"}</td><td class="num">${esc(String(x.shift_start || "10:00").slice(0, 5))}</td><td class="n">${x.day_hours || 8}</td><td class="n">${x.grace_min != null ? x.grace_min : 15}</td><td class="muted" style="font-size:12px">${(x.work_days || [6, 0, 1, 2, 3, 4]).map(d => DOW[d]).join("، ")}</td><td>${x.deduct_late === false ? "لا" : "نعم"} / ${x.deduct_absence === false ? "لا" : "نعم"}</td><td>${ed ? `<button class="btn sm ghost" data-act="spSet" data-id="${p.id}">تعديل</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  }
  return h;
};
H.staff = () => { const W = S.sp; if (!W) return; const m = $("#spM"); if (m) m.onchange = () => { if (m.value) { W.month = m.value; W.day = m.value === today().slice(0, 7) ? today() : m.value + "-01"; render(); } };
  const d = $("#spD"); if (d) d.onchange = () => { if (d.value) { W.day = d.value; if (d.value.slice(0, 7) !== W.month) W.month = d.value.slice(0, 7); render(); } }; };
function attModal(sid) { const W = S.sp, a = W.att.find(x => x.staff_id === sid && x.day === W.day) || {};
  modal(`<h2>حضور ${esc(who(sid))} · ${W.day}</h2><div class="stack"><div class="grid g3"><div class="field"><label>الحالة</label><select class="inp" id="atS">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${(a.status || "present") === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select></div><div class="field"><label>حضور</label><input class="inp" type="time" id="atI" value="${hm(a.check_in)}"></div><div class="field"><label>انصراف</label><input class="inp" type="time" id="atO" value="${hm(a.check_out)}"></div></div>
   <div class="field"><label>السبب</label><input class="inp" id="atN" value="${esc(a.note || "")}" placeholder="مثال: نسي يسجّل · إجازة بإذن المدير"></div><div id="atErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="attGo" data-id="${sid}">حفظ</button></div></div>`); }
function spSetModal(sid) { const x = (S.sp.pl.pay || []).find(y => y.staff_id === sid) || {}, wd = x.work_days || [6, 0, 1, 2, 3, 4];
  modal(`<h2>بيانات مرتب ${esc(who(sid))}</h2><div class="stack"><div class="grid g3"><div class="field"><label>الأساسي الشهري</label><input class="inp num" type="number" min="0" id="psB" value="${+x.base_salary || 0}"></div><div class="field"><label>بدلات ثابتة</label><input class="inp num" type="number" min="0" id="psA" value="${+x.allowances || 0}"></div><div class="field"><label>بداية الشيفت</label><input class="inp" type="time" id="psS" value="${String(x.shift_start || "10:00").slice(0, 5)}"></div>
   <div class="field"><label>ساعات اليوم</label><input class="inp num" type="number" min="1" max="16" step="0.5" id="psH" value="${x.day_hours || 8}"></div><div class="field"><label>فترة سماح التأخير (دقيقة)</label><input class="inp num" type="number" min="0" id="psG" value="${x.grace_min != null ? x.grace_min : 15}"></div></div>
   <div class="row" style="gap:10px;flex-wrap:wrap">${DOW.map((d, i) => `<label class="row" style="gap:4px"><input type="checkbox" data-wd="${i}" ${wd.includes(i) ? "checked" : ""}> ${d}</label>`).join("")}</div>
   <label class="row" style="gap:8px"><input type="checkbox" id="psL" ${x.deduct_late === false ? "" : "checked"}> خصم التأخير</label><label class="row" style="gap:8px"><input type="checkbox" id="psX" ${x.deduct_absence === false ? "" : "checked"}> خصم الغياب</label><div id="psErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="spSetGo" data-id="${sid}">حفظ</button></div></div>`); }
function prLineModal(sid) { const l = S.sp.pl.lines.find(x => x.staff_id === sid);
  modal(`<h2>${esc(l.name)} · ${S.sp.month}</h2><div class="stack"><div class="grid g2"><div class="field"><label>حافز / مكافأة</label><input class="inp num" type="number" min="0" id="plB" value="${+l.bonus}"></div><div class="field"><label>خصومات أخرى (جزاءات…)</label><input class="inp num" type="number" min="0" id="plD" value="${+l.other_deduct}"></div></div><div class="field"><label>السبب</label><input class="inp" id="plN" value="${esc(l.note || "")}"></div><div id="plErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="prLineGo" data-id="${sid}">حفظ</button></div></div>`); }
function payModal(kind) { const W = S.sp, net = (W.pl.lines || []).reduce((a, l) => a + +l.net, 0);
  modal(kind === "adv" ? `<h2>سلفة</h2><div class="stack"><div class="grid g3"><div class="field"><label>الموظف</label><select class="inp" id="avS">${staffOf().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div><div class="field"><label>المبلغ</label><input class="inp num" type="number" min="0" id="avA"></div><div class="field"><label>من</label><select class="inp" id="avC">${W.acc.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div></div><div class="field"><label>ملاحظة</label><input class="inp" id="avN"></div><div id="avErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="advGo">تسجيل</button></div></div>`
   : `<h2>صرف مرتبات ${W.month}</h2><p class="muted">الصافي ${fmt(net, 1)} هيخرج من الحساب ده ويقفل المرتبات المستحقة.</p><div class="stack"><select class="inp" id="ppC">${W.acc.filter(a => a.kind !== "drawer").map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select><div id="ppErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="prPayGo">صرف</button></div></div>`); }

/* =====================================================================
   POS: pay with loyalty points (adds a row under the payment methods)
   ===================================================================== */
async function ptsLookup(phone) { if (!/^01\d{9}$/.test(phone || "")) { S._pts = null; return; } if (S._pts && S._pts.phone === phone) return; try { const r = await rpc("customer_points", { p_token: T(), p_phone: phone }); S._pts = r && r.on ? Object.assign(r, { phone }) : null; } catch (e) { S._pts = null; } }
const _vpos = V.pos;
V.pos = () => { let h = _vpos(); const ph = ((document.querySelector("#cPhone") || {}).value || "").trim();
  const P = S._pts, cust = (h.match(/id="cPhone"[^>]*value="([^"]*)"/) || [])[1] || ph;
  if (P && P.phone === cust && +P.points > 0) { const max = Math.floor(+P.points * +P.value * 100) / 100;
    h = h.replace(/(<div class="grid g2" style="gap:6px">.*?<\/div>)/s, `$1<div class="row" style="gap:6px;flex-wrap:nowrap;margin-top:6px"><span class="dim" style="width:64px;font-size:12.5px">نقاط</span><input class="inp num" type="number" min="0" max="${max}" data-pay="points" value="${esc(M.P.pay.points || "")}" style="flex:1"><span class="dim" style="font-size:12px">${esc(P.name)}: ${num(P.points)} نقطة = ${fmt(max, 1)}</span></div>`); }
  return h; };
document.addEventListener("input", e => { if (e.target.id === "cPhone") { const v = e.target.value.trim(); clearTimeout(S._ptT); S._ptT = setTimeout(() => ptsLookup(v).then(() => { if (S.route === "pos" && S._pts && S._pts.phone === v) { const p = e.target.selectionStart; render(); const n = $("#cPhone"); if (n) { n.focus(); n.setSelectionRange(p, p); } } }), 500); } });

/* =====================================================================
   ACTIONS
   ===================================================================== */
const prev = window.MZX;
window.MZX = async function (k, a) {
  const wrap = async (fn, after, box) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (box && $(box)) errBox(box, e); else toast(errText(e), true); busy(a, false); } };
  const id = a.dataset.id, re = async () => { S.sp.loaded = null; render(); };
  if (k === "punch") wrap(async () => { const r = await rpc("attend_punch", { p_token: T() }); toast(r.state === "in" ? "اتسجّل حضورك " + dt(r.at) : "اتسجّل انصرافك " + dt(r.at)); await punchState(); if (S.sp) S.sp.loaded = null; if (S.route === "staff") render(); });
  else if (k === "spTab") { S.sp.tab = a.dataset.k; render(); }
  else if (k === "attEdit") attModal(id);
  else if (k === "attGo") wrap(() => rpc("attend_edit", { p_token: T(), p: { staff_id: id, day: S.sp.day, in: $("#atI").value || null, out: $("#atO").value || null, status: $("#atS").value, note: $("#atN").value } }), async () => { closeModal(); await re(); }, "#atErr");
  else if (k === "spSet") spSetModal(id);
  else if (k === "spSetGo") wrap(() => rpc("staff_pay_save", { p_token: T(), p: { staff_id: id, base_salary: +$("#psB").value || 0, allowances: +$("#psA").value || 0, shift_start: $("#psS").value, day_hours: +$("#psH").value || 8, grace_min: +$("#psG").value || 0, work_days: [...document.querySelectorAll("[data-wd]")].filter(c => c.checked).map(c => +c.dataset.wd), deduct_late: $("#psL").checked, deduct_absence: $("#psX").checked } }), async () => { closeModal(); await re(); }, "#psErr");
  else if (k === "prCalc") wrap(() => rpc("payroll_calc", { p_token: T(), p_month: S.sp.month }), re, "#prErr");
  else if (k === "prLine") prLineModal(id);
  else if (k === "prLineGo") wrap(() => rpc("payroll_line_set", { p_token: T(), p_month: S.sp.month, p_staff: id, p_bonus: +$("#plB").value || 0, p_other: +$("#plD").value || 0, p_note: $("#plN").value }), async () => { closeModal(); await re(); }, "#plErr");
  else if (k === "prAppr") { if (!confirm("اعتماد مرتبات " + S.sp.month + "؟ بعد الاعتماد الحضور والمرتبات للشهر ده بيتقفلوا، وبيتعمل قيد المرتبات.")) return true; wrap(() => rpc("payroll_approve", { p_token: T(), p_month: S.sp.month }), re, "#prErr"); }
  else if (k === "prPay") payModal("pay");
  else if (k === "prPayGo") wrap(() => rpc("payroll_pay", { p_token: T(), p_month: S.sp.month, p_account: +$("#ppC").value }), async () => { closeModal(); toast("اتصرفت المرتبات."); await re(); }, "#ppErr");
  else if (k === "advNew") payModal("adv");
  else if (k === "advGo") wrap(() => rpc("advance_save", { p_token: T(), p: { staff_id: $("#avS").value, amount: +$("#avA").value, account_id: +$("#avC").value, note: $("#avN").value } }), async () => { closeModal(); toast("اتسجّلت السلفة."); await re(); }, "#avErr");
  else return prev ? prev(k, a) : false;
  return true;
};
})();
