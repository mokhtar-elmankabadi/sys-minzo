/* SYS Minzo · customers (batch 5): groups, WhatsApp messages prepared for each customer (sent by hand),
   invoice details from the customer card, welcome message per visit + store page QR + return policy on the receipt.
   Built on window.MZ. Every write goes through a server function. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, rpc, T, has, locName, ico, toast, modal, closeModal, busy, render, errText } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const cxOk = () => isTop() || has("custMsg");
const dt = x => x ? new Date(x).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const empty = (n, t) => `<tr><td colspan="${n}" class="muted">${t}</td></tr>`;
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const CX = () => (S.store && S.store.cx) || {};

/* ---------- WhatsApp ---------- */
const waNum = p => { let d = String(p || "").replace(/[^0-9]/g, ""); if (/^01\d{9}$/.test(d)) d = "2" + d; else if (/^1\d{9}$/.test(d)) d = "20" + d; return d; };
const fill = (t, c) => String(t || "").replace(/\{الاسم\}/g, (c && c.name) || "").replace(/\{المحل\}/g, (S.store && S.store.name) || "");
const waLink = (phone, text) => `https://wa.me/${waNum(phone)}?text=${encodeURIComponent(text)}`;
const OCCASIONS = [
  ["رمضان", "رمضان كريم يا {الاسم} 🌙\nكل سنة وإنت طيب، ومستنيينك في {المحل}."],
  ["العيد", "كل سنة وإنت طيب يا {الاسم} 🎉\nعيد سعيد عليك وعلى أسرتك — {المحل}."],
  ["رأس السنة", "سنة جديدة سعيدة يا {الاسم} ✨\nشكرًا إنك معانا — {المحل}."],
  ["عرض جديد", "أهلًا يا {الاسم} 👋\nعندنا عرض جديد في {المحل}: …\nالعرض لحد …"],
  ["شكر", "شكرًا يا {الاسم} إنك اخترت {المحل} 🙏\nلو احتجت أي حاجة إحنا موجودين."]];

/* ---------- data ---------- */
async function loadCx() { const X = S.cx || (S.cx = {}); const [g, c] = await Promise.all([rpc("cust_groups", { p_token: T() }), rpc("wa_campaigns", { p_token: T() })]); X.groups = g; X.camps = c; X.loaded = true; }
const custById = id => ((S.cu && S.cu.list) || []).find(c => c.id === id);
const later = (fn, r) => { setTimeout(() => fn().then(() => S.route === r && render()).catch(e => toast(errText(e), true)), 0); return `<div class="spin"></div>`; };

/* ---------- views inside the customers screen ---------- */
function view(tab) {
  const X = S.cx; if (!X || !X.loaded) return later(loadCx, "customers");
  if (tab === "groups") return groupsView(X);
  if (tab === "wa") return X.open ? campView(X) : waView(X);
  return "";
}
function groupsView(X) {
  let h = `<div class="card rise"><div class="row between" style="flex-wrap:wrap;gap:8px"><div><h3 style="margin:0">مجموعات العملاء</h3><p class="dim" style="margin:4px 0 0;font-size:12.5px">مجموعة لعرض معيّن أو لعملاء مميزين. ضيف العملاء من تبويب «العملاء»: اختارهم بالعلامة ✓ (وتقدر تفلتر الأول بعدد الفواتير أو المشتريات)، وبعدين «إضافة لمجموعة».</p></div><button class="btn gold" data-act="cxGrpNew">${ico("plus")} مجموعة جديدة</button></div></div>`;
  h += `<div class="grid g3">${X.groups.map(g => { const mem = g.members.map(custById).filter(Boolean), spent = mem.reduce((a, c) => a + +c.spent, 0);
    return `<div class="card rise"><h3 style="margin-bottom:4px">${esc(g.name)}</h3>${g.note ? `<p class="dim" style="margin:0 0 8px;font-size:12.5px">${esc(g.note)}</p>` : ""}
      <div class="row" style="gap:16px;margin:6px 0 10px"><div><div class="dim" style="font-size:12px">عملاء</div><b class="num">${num(g.members.length)}</b></div><div><div class="dim" style="font-size:12px">مشترياتهم</div><b class="num">${fmt(spent)}</b></div><div><div class="dim" style="font-size:12px">خصم ثابت</div><b class="num">${+g.discount_pct ? num(+g.discount_pct) + "%" : "—"}</b></div></div>
      <div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn sm" data-act="cxGrpOpen" data-id="${g.id}">الأعضاء</button><button class="btn sm gold" data-act="cxWaNew" data-g="${g.id}">رسالة واتساب</button><button class="btn sm ghost" data-act="cxGrpEdit" data-id="${g.id}">تعديل</button>${["owner", "gm"].includes(S.sess.role.id) ? `<button class="btn sm ghost" data-act="cxGrpDisc" data-id="${g.id}">الخصم</button>` : ""}<button class="btn sm ghost" data-act="cxGrpDel" data-id="${g.id}">حذف</button></div></div>`; }).join("") || `<div class="card"><p class="muted" style="margin:0">لسه مفيش مجموعات.</p></div>`}</div>`;
  return h;
}
function waView(X) {
  let h = `<div class="card rise"><div class="row between" style="flex-wrap:wrap;gap:8px"><div><h3 style="margin:0">رسائل واتساب للعملاء</h3><p class="dim" style="margin:4px 0 0;font-size:12.5px">بتكتب الرسالة مرة واحدة، والسيستم بيجهّزها باسم كل عميل. تدوس «إرسال» قدام العميل، فيفتح الواتساب والرسالة جاهزة، وإنت تدوس إرسال. من غير أي تكلفة.</p></div><button class="btn gold" data-act="cxWaNew">${ico("plus")} رسالة جديدة</button></div></div>`;
  h += `<div class="card rise"><div class="tw"><table><thead><tr><th>الرسالة</th><th>لمين</th><th>اتعملت</th><th class="n">اتبعتت</th><th></th></tr></thead><tbody>${X.camps.map(c => `<tr data-act="cxCamp" data-id="${c.id}" style="cursor:pointer"><td class="pname">${esc(c.title)}</td><td>${esc(c.audience)}</td><td class="dim">${dt(c.at)} · ${esc(c.by || "")}</td><td class="n">${c.sent >= c.total ? chip(`${num(c.sent)} / ${num(c.total)}`, "ok") : `${num(c.sent)} / ${num(c.total)}`}</td><td><button class="btn sm">فتح</button></td></tr>`).join("") || empty(5, "لسه مفيش رسائل.")}</tbody></table></div></div>`;
  return h;
}
function campView(X) {
  const C = X.open; if (!C.rows) return later(async () => { X.open = await rpc("wa_campaign_get", { p_token: T(), p_id: C.id }); }, "customers");
  const sent = C.rows.filter(r => r.sent).length, next = C.rows.find(r => !r.sent);
  let h = `<div class="card rise"><div class="row between" style="flex-wrap:wrap;gap:8px"><div><h3 style="margin:0">${esc(C.title)}</h3><p class="dim" style="margin:4px 0 0">${esc(C.audience)} · اتبعت ${num(sent)} من ${num(C.rows.length)}</p></div><div class="row" style="gap:6px">${next ? `<a class="btn gold" href="${esc(waLink(next.phone, fill(C.body, next)))}" target="_blank" rel="noopener" data-act="cxWaSend" data-id="${next.id}">إرسال للي عليه الدور: ${esc(next.name)}</a>` : chip("اتبعتت للكل", "ok")}<button class="btn ghost" data-act="cxCampBack">رجوع</button></div></div>
    <div style="height:6px;background:var(--line);border-radius:4px;margin-top:12px;overflow:hidden"><div style="height:100%;width:${C.rows.length ? Math.round(sent / C.rows.length * 100) : 0}%;background:var(--gold)"></div></div>
    <div class="okbox" style="margin-top:12px;white-space:pre-wrap">${esc(fill(C.body, { name: "‹اسم العميل›" }))}</div></div>`;
  h += `<div class="card rise"><div class="tw"><table><thead><tr><th>العميل</th><th>الموبايل</th><th>الحالة</th><th></th></tr></thead><tbody>${C.rows.map(r => `<tr><td class="pname">${esc(r.name)}</td><td class="num">${esc(r.phone)}</td><td>${r.sent ? chip("اتبعتت " + dt(r.sent), "ok") : chip("لسه")}</td><td class="row" style="gap:6px;justify-content:flex-end"><a class="btn sm ${r.sent ? "ghost" : "gold"}" href="${esc(waLink(r.phone, fill(C.body, r)))}" target="_blank" rel="noopener" data-act="cxWaSend" data-id="${r.id}">${r.sent ? "إرسال تاني" : "إرسال"}</a>${r.sent ? `<button class="btn sm ghost" data-act="cxWaUnsend" data-id="${r.id}" title="رجّعها «لسه»">↺</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  return h;
}

/* ---------- modals ---------- */
function grpModal(g) {
  modal(`<h2>${g ? "تعديل المجموعة" : "مجموعة جديدة"}</h2><div class="stack"><div class="field"><label>اسم المجموعة</label><input class="inp" id="gN" value="${esc(g ? g.name : "")}" placeholder="مثلًا: عملاء VIP · عرض الأطقم · عملاء الأجهزة"></div>
   <div class="field"><label>ملاحظة (اختياري)</label><input class="inp" id="gO" value="${esc(g && g.note || "")}"></div><div id="gErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cxGrpSave" data-id="${g ? g.id : ""}">حفظ</button></div></div>`);
}
function grpMembers(g) {
  const mem = g.members.map(custById).filter(Boolean).sort((a, b) => b.spent - a.spent);
  modal(`<h2>${esc(g.name)} <span class="dim" style="font-size:14px">${num(mem.length)} عميل</span></h2>
   <div class="tw" style="max-height:420px;overflow:auto"><table><thead><tr><th>العميل</th><th>الموبايل</th><th class="n">الفواتير</th><th class="n">المشتريات</th><th></th></tr></thead><tbody>${mem.map(c => `<tr><td class="pname">${esc(c.name)}</td><td class="num">${esc(c.phone || "—")}</td><td class="n">${num(c.invoices)}</td><td class="n">${fmt(c.spent)}</td><td><button class="btn sm ghost" data-act="cxGrpRm" data-id="${c.id}" data-g="${g.id}">شيل</button></td></tr>`).join("") || empty(5, "المجموعة فاضية — ضيف عملاء من تبويب «العملاء».")}</tbody></table></div>
   <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn gold" data-act="cxWaNew" data-g="${g.id}">رسالة واتساب للمجموعة</button><button class="btn ghost" data-act="mClose">قفل</button></div>`);
}
function toGroupModal() {
  const X = S.cx; if (!X || !X.loaded) { loadCx().then(toGroupModal).catch(e => toast(errText(e), true)); return; }
  modal(`<h2>إضافة ${num(S.cu.sel.length)} عميل لمجموعة</h2><div class="stack"><div class="field"><label>المجموعة</label><select class="inp" id="tgG">${X.groups.map(g => `<option value="${g.id}">${esc(g.name)} (${num(g.members.length)})</option>`).join("")}<option value="">+ مجموعة جديدة…</option></select></div>
   <div class="field" id="tgNw" style="${X.groups.length ? "display:none" : ""}"><label>اسم المجموعة الجديدة</label><input class="inp" id="tgN"></div><div id="tgErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cxToGroupGo">إضافة</button></div></div>`);
  const sel = $("#tgG"); if (!X.groups.length) sel.value = ""; sel.onchange = () => { $("#tgNw").style.display = sel.value ? "none" : ""; };
}
function waNewModal(opts) {
  const X = S.cx || {}, groups = X.groups || [], selN = (S.cu && S.cu.sel || []).length;
  const aud = opts.sel ? "sel" : opts.g ? "g" + opts.g : "all";
  modal(`<h2>رسالة واتساب جديدة</h2><div class="stack">
   <div class="field"><label>عنوان (ليك إنت بس، علشان تلاقيها بعدين)</label><input class="inp" id="wT" placeholder="مثلًا: تهنئة العيد · عرض الأطقم"></div>
   <div class="field"><label>لمين</label><select class="inp" id="wA"><option value="all" ${aud === "all" ? "selected" : ""}>كل العملاء اللي ليهم موبايل</option>${groups.map(g => `<option value="g${g.id}" ${aud === "g" + g.id ? "selected" : ""}>مجموعة: ${esc(g.name)} (${num(g.members.length)})</option>`).join("")}${selN ? `<option value="sel" ${aud === "sel" ? "selected" : ""}>العملاء المختارين (${num(selN)})</option>` : ""}</select></div>
   <div class="field"><label>الرسالة</label><textarea class="inp" id="wB" rows="5" placeholder="اكتب الرسالة… واستخدم {الاسم} مكان اسم العميل"></textarea>
     <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><button class="btn sm ghost" data-act="cxIns" data-v="{الاسم}">+ اسم العميل</button><button class="btn sm ghost" data-act="cxIns" data-v="{المحل}">+ اسم المحل</button><span class="dim" style="font-size:12px;align-self:center">قوالب جاهزة:</span>${OCCASIONS.map(([n], i) => `<button class="btn sm ghost" data-act="cxOcc" data-i="${i}">${n}</button>`).join("")}</div></div>
   <div><div class="dim" style="font-size:12px;margin-bottom:4px">معاينة</div><div class="okbox" id="wP" style="white-space:pre-wrap;min-height:40px"></div></div><div id="wErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cxWaCreate">جهّز الرسائل</button></div></div>`);
  const pv = () => { $("#wP").textContent = fill($("#wB").value, { name: "أحمد" }) || "…"; }; $("#wB").oninput = pv; pv();
}
async function saleModal(id, cust) {
  try {
    const s = await rpc("customer_sale", { p_token: T(), p_sale: id }); if (!s) throw new Error("NOT_FOUND");
    const PN = { cash: "كاش", card: "فيزا", insta: "إنستاباي", wallet: "محفظة", inst: "تقسيط", points: "نقاط ولاء", credit: "رصيد", exchange: "استبدال" };
    modal(`<h2>فاتورة <span class="num">${esc(s.no)}</span> ${s.status === "void" ? chip("ملغاة", "bad") : ""}</h2><p class="muted" style="margin:0 0 10px">${esc(locName(s.loc))} · ${dt(s.at)}${s.seller ? " · البائع " + esc(s.seller) : ""}${s.cashier ? " · الكاشير " + esc(s.cashier) : ""}</p>
     <div class="tw"><table><thead><tr><th>الصنف</th><th class="n">الكمية</th><th class="n">السعر</th><th class="n">الخصم</th><th class="n">الصافي</th></tr></thead><tbody>${s.lines.map(l => { const d = +l.disc, net = l.qty * l.price - d;
       return `<tr><td class="pname">${esc(l.item)}${l.code ? ` <span class="dim num" style="font-size:12px">${esc(l.code)}</span>` : ""}${l.serial ? `<br><span class="dim num" style="font-size:12px">SN ${esc(l.serial)}</span>` : ""}${l.offer ? `<br>${chip("★ ضمن عرض: " + l.offer, "warn")} <span class="dim" style="font-size:12px">سعره في العرض ${fmt(net / (+l.qty || 1), 1)} للوحدة</span>` : ""}</td><td class="n">${num(l.qty)}</td><td class="n">${fmt(l.price, 1)}</td><td class="n">${d ? "−" + fmt(d, 1) : "—"}</td><td class="n">${fmt(net, 1)}</td></tr>`; }).join("")}</tbody></table></div>
     <div class="grid g3" style="margin-top:10px"><div class="card kpi"><div class="lbl">قبل الخصم</div><div class="val">${fmt(s.gross, 1)}</div></div><div class="card kpi"><div class="lbl">الخصم</div><div class="val">${fmt(s.discount, 1)}</div></div><div class="card kpi lux"><div class="lbl">الإجمالي</div><div class="val">${fmt(s.total, 1)}</div></div></div>
     <p class="dim" style="margin:8px 0 0">الدفع: ${s.payments.map(p => `${esc(PN[p.method] || p.method)} ${fmt(p.amount, 1)}`).join(" + ") || "—"}${s.returns.length ? ` · مرتجعات: ${s.returns.map(r => `${esc(r.no)} (${fmt(r.amount, 1)})`).join("، ")}` : ""}</p>
     <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">${cust ? `<button class="btn" data-act="cuOpen" data-id="${esc(cust)}">رجوع للعميل</button>` : ""}<button class="btn ghost" data-act="mClose">قفل</button></div>`);
  } catch (e) { toast(errText(e), true); }
}

/* ---------- receipt: welcome by visit, store page QR, return policy ---------- */
function welcome(visit, name) {
  const w = (CX().welcome || []).filter(Boolean), sl = CX().slogan || "";
  if (visit && visit <= w.length) return fill(w[visit - 1], { name });
  return sl ? fill(sl, { name }) : "";
}
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function pageUrl(lk) {
  lk = lk || CX().links || {}; const d = { n: (S.store && S.store.name) || "" };
  const strip = u => String(u).replace(/^https:\/\//i, "").replace(/^www\./i, "");
  if (lk.fb) d.f = strip(lk.fb); if (lk.ig) d.i = strip(lk.ig); if (lk.maps) d.m = strip(lk.maps); if (lk.web) d.w = strip(lk.web); if (lk.phone) d.p = lk.phone; if (lk.wa) d.a = lk.wa;
  if (Object.keys(d).length < 2) return null;
  return new URL("links.html", location.href).href.split("#")[0].split("?")[0] + "#" + b64u(JSON.stringify(d));
}
function rcptExtra(visit, name, preview) {
  const rc = (S.store && S.store.receipt) || {}, cx = CX(), wl = preview ? welcome(1, "أحمد") || "أهلًا بيك في أول زيارة 🌟" : welcome(visit, name), url = pageUrl();
  let h = "";
  if (wl) h += `<div style="text-align:center;margin-top:8px;font-weight:700;white-space:pre-wrap">${esc(wl)}</div>`;
  if (rc.qr !== false && url && window.MZQR) h += `<div style="width:26mm;height:26mm;margin:8px auto 0">${window.MZQR(url)}</div><div style="text-align:center;font-size:11px" class="dim">امسح الكود: صفحاتنا وأرقام التواصل</div>`;
  if (cx.policy_on !== false && cx.policy) h += `<div style="text-align:center;margin-top:6px;font-size:11px;border-top:1px dashed #000;padding-top:4px">${esc(cx.policy)}</div>`;
  return h;
}

/* ---------- settings card (owner / general manager) ---------- */
const prevSettings = V.settings;
V.settings = () => {
  let h = prevSettings();
  if (!isTop()) return h;
  const cx = CX(), w = (cx.welcome || []).concat([""]), lk = cx.links || {}, url = pageUrl();
  h += `<div class="card rise" id="cxCard"><h3>رسائل الإيصال وصفحة المحل</h3>
   <div class="grid g2"><div class="stack">
     <div class="field"><label>رسالة الترحيب حسب الزيارة <span class="dim" style="font-weight:400">— استخدم {الاسم} مكان اسم العميل</span></label>
       <div class="stack" id="cxW" style="gap:6px">${w.map((t, i) => `<div class="row" style="gap:6px"><span class="chip plain" style="min-width:74px;text-align:center">الزيارة ${i + 1}</span><input class="inp" data-cxw value="${esc(t)}" placeholder="${i ? "" : "مثلًا: أهلًا يا {الاسم}، نورتنا لأول مرة 🌟"}"></div>`).join("")}</div>
       <span class="dim" style="font-size:12px">فيه دايمًا خانة فاضية في الآخر لو عايز تضيف رسالة جديدة. بعد آخر رسالة بيظهر السطر الثابت.</span></div>
     <div class="field"><label>السطر الثابت (السلوجان) — بيظهر بعد آخر رسالة، وللعميل اللي مالوش موبايل</label><input class="inp" id="cxS" value="${esc(cx.slogan || "")}" placeholder="مثلًا: منزلك يبدأ من عندنا ✨"></div>
     <div class="field"><label class="row" style="gap:8px"><input type="checkbox" id="cxPOn" ${cx.policy_on !== false ? "checked" : ""}> سياسة الاسترجاع على الإيصال</label><textarea class="inp" id="cxP" rows="2">${esc(cx.policy || "")}</textarea></div>
   </div><div class="stack">
     <div class="dim" style="font-size:12.5px">اللينكات دي بتظهر في صفحة صغيرة باسم المحل، والـ QR اللي في آخر الإيصال بيفتحها.</div>
     ${[["fb", "فيسبوك", "https://facebook.com/…"], ["ig", "إنستجرام", "https://instagram.com/…"], ["maps", "الموقع على جوجل ماب", "https://maps.app.goo.gl/…"], ["web", "موقع إلكتروني (اختياري)", "https://…"], ["phone", "تليفون للاتصال", "01…"], ["wa", "واتساب", "01…"]].map(([k, n, ph]) => `<div class="field"><label>${n}</label><input class="inp" dir="ltr" data-cxl="${k}" value="${esc(lk[k] || "")}" placeholder="${ph}"></div>`).join("")}
     <span class="dim" style="font-size:12px">نصيحة: استخدم اللينك القصير (زي زرار «مشاركة» في جوجل ماب) عشان الكود يبقى أوضح في الطباعة.</span>
   </div></div>
   <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap;margin-top:12px"><button class="btn gold" data-act="cxSave">حفظ</button>${url ? `<a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">افتح صفحة المحل</a><div style="width:90px;height:90px;background:#fff;padding:4px;border-radius:6px">${window.MZQR ? window.MZQR(url) : ""}</div>` : `<span class="dim">حط لينك واحد على الأقل علشان الـ QR يظهر في الإيصال.</span>`}</div><div id="cxErr"></div></div>`;
  return h;
};
const prevHS = H.settings;
H.settings = () => { if (prevHS) prevHS(); const box = $("#cxW"); if (!box) return;
  box.oninput = e => { const ins = [...box.querySelectorAll("[data-cxw]")]; if (e.target === ins[ins.length - 1] && e.target.value.trim()) {
    const d = document.createElement("div"); d.className = "row"; d.style.gap = "6px"; d.innerHTML = `<span class="chip plain" style="min-width:74px;text-align:center">الزيارة ${ins.length + 1}</span><input class="inp" data-cxw>`; box.appendChild(d); } }; };

/* ---------- actions ---------- */
const prev = window.MZX;
window.MZX = async function (k, a) {
  const wrap = async (fn, after, box) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (box && $(box)) errBox(box, e); else toast(errText(e), true); busy(a, false); } };
  const id = a.dataset.id, X = S.cx || {};
  const reload = async () => { S.cx.loaded = false; if (S.cu) S.cu.loaded = false; render(); };
  if (k === "cuSale") saleModal(id, a.dataset.c);
  else if (k === "cxGrpNew") grpModal(null);
  else if (k === "cxGrpEdit") grpModal(X.groups.find(g => g.id === +id));
  else if (k === "cxGrpSave") wrap(() => rpc("cust_group_save", { p_token: T(), p: { id: id ? +id : null, name: $("#gN").value, note: $("#gO").value } }), async () => { closeModal(); toast("اتحفظت المجموعة."); await reload(); }, "#gErr");
  else if (k === "cxGrpDel") { const g = X.groups.find(x => x.id === +id); if (!confirm(`حذف مجموعة «${g.name}»؟ العملاء نفسهم مش هيتمسحوا.`)) return true; wrap(() => rpc("cust_group_delete", { p_token: T(), p_id: +id }), async () => { toast("اتحذفت المجموعة."); await reload(); }); }
  else if (k === "cxGrpOpen") grpMembers(X.groups.find(g => g.id === +id));
  else if (k === "cxGrpRm") wrap(() => rpc("cust_group_set", { p_token: T(), p_id: +a.dataset.g, p_add: [], p_remove: [id] }), async () => { await loadCx(); render(); grpMembers(S.cx.groups.find(g => g.id === +a.dataset.g)); });
  else if (k === "cxToGroup") toGroupModal();
  else if (k === "cxToGroupGo") wrap(async () => { let gid = +$("#tgG").value;
      if (!gid) gid = await rpc("cust_group_save", { p_token: T(), p: { name: $("#tgN").value } });
      const n = await rpc("cust_group_set", { p_token: T(), p_id: gid, p_add: S.cu.sel, p_remove: [] }); toast(`المجموعة فيها دلوقتي ${num(n)} عميل.`); },
    async () => { closeModal(); S.cu.sel = []; S.cx.loaded = false; await loadCx(); render(); }, "#tgErr");
  else if (k === "cxWaSel") { if (!X.loaded) await loadCx(); waNewModal({ sel: true }); }
  else if (k === "cxWaNew") { if (!X.loaded) await loadCx(); waNewModal({ g: a.dataset.g ? +a.dataset.g : null }); }
  else if (k === "cxIns") { const t = $("#wB"), p = t.selectionStart || t.value.length; t.value = t.value.slice(0, p) + a.dataset.v + t.value.slice(p); t.focus(); t.dispatchEvent(new Event("input")); }
  else if (k === "cxOcc") { const [n, b] = OCCASIONS[+a.dataset.i]; $("#wB").value = b; if (!$("#wT").value) $("#wT").value = n; $("#wB").dispatchEvent(new Event("input")); }
  else if (k === "cxWaCreate") { const au = $("#wA").value, p = { title: $("#wT").value, body: $("#wB").value };
    if (au === "sel") p.customers = S.cu.sel; else if (au.startsWith("g")) p.group_id = +au.slice(1);
    let nid; wrap(async () => { nid = await rpc("wa_campaign_create", { p_token: T(), p }); }, async () => { closeModal(); if (au === "sel") S.cu.sel = []; S.cu.tab = "wa"; S.cx.loaded = false; await loadCx(); S.cx.open = { id: nid }; render(); }, "#wErr"); }
  else if (k === "cxCamp") { S.cx.open = { id: +id }; render(); }
  else if (k === "cxCampBack") { S.cx.open = null; S.cx.loaded = false; render(); }
  else if (k === "cxWaSend" || k === "cxWaUnsend") { const C = S.cx.open, r = C && C.rows && C.rows.find(x => x.id === id); if (!r) return true; const on = k === "cxWaSend";
    rpc("wa_mark", { p_token: T(), p_id: C.id, p_customer: id, p_sent: on }).then(() => { r.sent = on ? new Date().toISOString() : null; render(); }).catch(e => toast(errText(e), true)); return false; }
  else if (k === "cxSave") { const p = { welcome: [...document.querySelectorAll("[data-cxw]")].map(x => x.value.trim()).filter(Boolean), slogan: $("#cxS").value, policy: $("#cxP").value, policy_on: $("#cxPOn").checked, links: {} };
    document.querySelectorAll("[data-cxl]").forEach(x => { p.links[x.dataset.cxl] = x.value.trim(); });
    wrap(async () => { S.store.cx = await rpc("store_cx_save", { p_token: T(), p }); }, async () => { toast("اتحفظت رسائل الإيصال وصفحة المحل."); render(); }, "#cxErr"); }
  else return prev ? prev(k, a) : false;
  return true;
};

M.cx = { view, welcome, pageUrl, rcptExtra, bind: null };
})();
