/* SYS Minzo · selling extras (batch 7): reservations with a deposit, price quotes, coupons, customer birthdays.
   Built on window.MZ. Every write goes through a server function. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, P, $, esc, fmt, num, rpc, T, can, locName, toast, modal, closeModal, busy, render, errText, header, go, loadItems, PAYN, UNITS, today } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const empty = (n, t) => `<tr><td colspan="${n}" class="muted">${t}</td></tr>`;
const dd = x => x ? new Date(x).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }) : "—";
const itemName = id => (S.items.find(i => i.id === id) || {}).name || "—";
const later = (fn, r) => { setTimeout(() => fn().then(() => S.route === r && render()).catch(e => toast(errText(e), true)), 0); return `<div class="spin"></div>`; };
const payOpts = () => Object.entries(PAYN).map(([k, n]) => `<option value="${k}">${n}</option>`).join("");
const head = (title, sub) => `<div style="text-align:center;font-weight:700;font-size:15px">${esc(S.store.name)}</div><div style="text-align:center" class="dim">${esc(locName(S.sess.device.location_id))} · ${new Date().toLocaleString("ar-EG")}</div><div style="text-align:center;font-weight:700;margin-top:4px">${esc(title)}</div>${sub ? `<div style="text-align:center" class="num">${esc(sub)}</div>` : ""}<div class="hr" style="margin:8px 0"></div>`;
const printBtns = extra => `<div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">${extra || ""}<button class="btn" data-act="rcptPrint">طباعة</button><button class="btn gold" data-act="mClose">تمام</button></div>`;

/* =====================================================================
   reservations & quotes screen
   ===================================================================== */
async function loadRes() { const R = S.rs || (S.rs = { tab: "res" }); const [r, q] = await Promise.all([rpc("reservations_list", { p_token: T() }), rpc("quotes_list", { p_token: T() })]); R.list = r || []; R.quotes = q || []; R.loaded = true; }
V.reserve = () => {
  const R = S.rs; if (!R || !R.loaded) return header() + later(loadRes, "reserve");
  const open = R.list.filter(r => r.status === "open"), late = open.filter(r => r.due && r.due < today());
  let h = header(`<button class="btn gold" data-go="pos">${M.ico ? M.ico("pos") : ""} من شاشة البيع</button>`);
  h += `<div class="grid g4">${[["حجوزات مفتوحة", num(open.length)], ["عرابين في الخزنة", fmt(open.reduce((a, r) => a + +r.deposit, 0))], ["فات ميعادها", num(late.length)], ["عروض أسعار آخر ٤ شهور", num(R.quotes.length)]].map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div></div>`).join("")}</div>`;
  h += `<div class="tabs rise">${[["res", "الحجوزات"], ["qt", "عروض الأسعار"]].map(([k, n]) => `<button data-act="rsTab" data-k="${k}" class="${R.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  if (R.tab === "qt") {
    h += `<div class="tw rise"><table><thead><tr><th>العرض</th><th>العميل</th><th>الأصناف</th><th class="n">الإجمالي</th><th>ساري لحد</th><th></th></tr></thead><tbody>${R.quotes.map(q => `<tr><td class="num">${esc(q.no)}<br><span class="dim" style="font-size:12px">${dd(q.created_at)} · ${esc(q.staff || "")}</span></td><td>${esc(q.customer_name || "—")}${q.customer_phone ? `<br><span class="dim num">${esc(q.customer_phone)}</span>` : ""}</td><td style="font-size:12.5px">${(q.lines || []).map(l => `${esc(l.name)} × ${num(l.qty)}`).join("<br>")}</td><td class="n">${fmt(q.total, 1)}</td><td>${q.valid_until < today() ? chip("انتهى " + q.valid_until, "plain") : chip(q.valid_until, "ok")}</td>
      <td style="white-space:nowrap"><button class="btn sm ghost" data-act="qtShow" data-id="${q.id}">عرض وطباعة</button>${can("pos", "a") ? `<button class="btn sm" data-act="qtToPos" data-id="${q.id}">فاتورة</button>` : ""}</td></tr>`).join("") || empty(6, "لسه مفيش عروض أسعار — اعمل واحد من شاشة البيع.")}</tbody></table></div>`;
    return h;
  }
  const st = r => r.status === "done" ? chip("اتسلّم · " + (r.sale_no || ""), "ok") : r.status === "cancelled" ? chip("اتلغى", "plain") : r.due && r.due < today() ? chip("فات ميعاده", "bad") : chip("مفتوح", "info");
  h += `<div class="tw rise"><table><thead><tr><th>الحجز</th><th>العميل</th><th>الأصناف</th><th class="n">القيمة</th><th class="n">العربون</th><th class="n">الباقي</th><th>الميعاد</th><th>الحالة</th><th></th></tr></thead><tbody>${R.list.map(r => `<tr><td class="num">${esc(r.no)}<br><span class="dim" style="font-size:12px">${esc(locName(r.loc))} · ${dd(r.at)}</span></td><td>${esc(r.customer)}<br><span class="dim num">${esc(r.phone || "")}</span></td><td style="font-size:12.5px">${(r.lines || []).map(l => `${esc(itemName(l.item_id))} × ${num(l.qty)}`).join("<br>")}${r.note ? `<br><span class="dim">${esc(r.note)}</span>` : ""}</td>
     <td class="n">${fmt(r.total, 1)}</td><td class="n">${fmt(r.deposit, 1)}</td><td class="n">${r.status === "open" ? fmt(+r.total - +r.deposit, 1) : "—"}</td><td class="num">${esc(r.due || "—")}</td><td>${st(r)}${r.cancel_reason ? `<br><span class="dim" style="font-size:12px">${esc(r.cancel_reason)}</span>` : ""}</td>
     <td style="white-space:nowrap">${r.status === "open" && can("pos", "a") ? `<button class="btn sm gold" data-act="resGo" data-id="${r.id}">تكميل البيع</button><button class="btn sm ghost" data-act="resPay" data-id="${r.id}">دفعة</button><button class="btn sm ghost" data-act="resCancel" data-id="${r.id}">إلغاء</button>` : ""}</td></tr>`).join("") || empty(9, "مفيش حجوزات. الحجز بيتعمل من شاشة البيع: ضيف الأصناف ودوس «حجز بعربون».")}</tbody></table></div>
   <p class="dim rise" style="font-size:12.5px">الأصناف المحجوزة محدش يقدر يبيعها أو يحوّلها غير لما الحجز يتكمّل أو يتلغي. لو الحجز اتلغى، العربون بيرجع كله للعميل.</p>`;
  return h;
};

/* ---------- reservation from the cart ---------- */
function resNewModal() {
  if (!P.cart.length) return toast("ضيف الأصناف الأول.", true);
  const tot = P.cart.reduce((a, l) => { const it = S.items.find(i => i.id === l.id); return a + (it ? +it.sale_price * l.qty : 0); }, 0);
  const due = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  modal(`<h2>حجز بعربون</h2><p class="muted" style="margin:0 0 10px">الأصناف هتتحجز للعميل لحد ما يكمّل، والعربون يتخصم من الفاتورة ساعتها. لو اتلغى، العربون بيرجع كله.</p>
    <div class="card" style="padding:10px;margin-bottom:10px">${P.cart.map(l => `<div class="row between"><span>${esc(itemName(l.id))} × ${num(l.qty)}</span><span class="num">${fmt((S.items.find(i => i.id === l.id) || {}).sale_price * l.qty, 1)}</span></div>`).join("")}<div class="row between" style="border-top:1px dashed var(--line2);margin-top:4px;padding-top:4px"><b>القيمة بالسعر الحالي</b><b class="num">${fmt(tot, 1)}</b></div></div>
    <div class="stack"><div class="grid g2"><div class="field"><label>اسم العميل</label><input class="inp" id="rsN" value="${esc(P.cust.name || "")}"></div><div class="field"><label>الموبايل</label><input class="inp num" id="rsP" value="${esc(P.cust.phone || "")}" inputmode="tel" placeholder="01xxxxxxxxx"></div></div>
     <div class="grid g2"><div class="field"><label>العربون</label><input class="inp num" type="number" min="1" id="rsD"></div><div class="field"><label>اتدفع</label><select class="inp" id="rsM">${payOpts()}</select></div></div>
     <div class="grid g2"><div class="field"><label>هيكمّل لحد</label><input class="inp" type="date" id="rsDue" value="${due}"></div><div class="field"><label>ملاحظة</label><input class="inp" id="rsNote" placeholder="مثال: هيستلم بعد القبض"></div></div>
     <div id="rsErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="resSave">تسجيل الحجز</button></div></div>`);
}
async function resSave(btn) {
  const ph = $("#rsP").value.trim(), dep = +$("#rsD").value, nm = $("#rsN").value.trim();
  if (!$("#rsN").value.trim() || !/^01\d{9}$/.test(ph)) return errBox("#rsErr", "CUSTOMER_REQUIRED");
  if (!(dep > 0)) return errBox("#rsErr", "DEPOSIT_REQUIRED");
  busy(btn, true);
  try { const lines = P.cart.map(l => ({ item_id: l.id, qty: l.qty })), names = P.cart.map(l => [itemName(l.id), l.qty]);
    const r = await rpc("reservation_create", { p_token: T(), p: { customer: { name: $("#rsN").value.trim(), phone: ph }, lines, deposit: dep, method: $("#rsM").value, due_date: $("#rsDue").value || null, note: $("#rsNote").value.trim() } });
    P.cart = []; P.disc = 0; P.coupon = null; P.cust = { name: "", phone: "" }; P.shift = undefined; if (S.rs) S.rs.loaded = false;
    modal(`<h2>اتسجّل الحجز</h2><div class="receipt" id="rcpt">${head("إيصال حجز بعربون", r.no)}<div class="r"><span>العميل</span><span>${esc(nm)} · ${esc(ph)}</span></div>
      ${names.map(([n, q]) => `<div class="r"><span>${esc(n)} × ${num(q)}</span><span></span></div>`).join("")}<div class="hr" style="margin:8px 0"></div>
      <div class="r"><span>القيمة</span><span>${fmt(r.total, 1)}</span></div><div class="r"><b>العربون المدفوع</b><b>${fmt(r.deposit, 1)}</b></div><div class="r"><span>الباقي</span><span>${fmt(+r.total - +r.deposit, 1)}</span></div>
      <div style="text-align:center;margin-top:8px;font-size:11px">الأسعار النهائية بتتحسب يوم الاستلام. لو الحجز اتلغى العربون بيرجع كامل.</div></div>${printBtns()}`);
    render();
  } catch (e) { errBox("#rsErr", e); busy(btn, false); }
}
function resPayModal(r) {
  modal(`<h2>دفعة على الحجز ${esc(r.no)}</h2><p class="muted" style="margin:0 0 10px">${esc(r.customer)} · المدفوع ${fmt(r.deposit, 1)} من ${fmt(r.total, 1)}</p><div class="stack"><div class="grid g2"><div class="field"><label>المبلغ</label><input class="inp num" type="number" min="1" max="${+r.total - +r.deposit}" id="rpA"></div><div class="field"><label>اتدفع</label><select class="inp" id="rpM">${payOpts()}</select></div></div><div id="rpErr"></div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="resPayGo" data-id="${r.id}">تسجيل</button></div></div>`);
}
function resCancelModal(r) {
  modal(`<h2>إلغاء الحجز ${esc(r.no)}</h2><div class="warnbox">العربون كله (${fmt(r.deposit, 1)}) هيرجع للعميل من الدرج، والأصناف هترجع متاحة للبيع.</div><div class="stack"><div class="grid g2"><div class="field"><label>السبب</label><input class="inp" id="rcW"></div><div class="field"><label>الرد</label><select class="inp" id="rcM">${payOpts()}</select></div></div><div id="rcErr"></div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn danger" data-act="resCancelGo" data-id="${r.id}">إلغاء ورد العربون</button></div></div>`);
}
function resToPos(r) {
  if (+r.loc !== +S.sess.device.location_id) return toast(`الحجز ده في ${locName(r.loc)} — كمّله من جهاز هناك.`, true);
  P.cart = (r.lines || []).map(l => ({ id: l.item_id, qty: +l.qty, ...(((S.items.find(i => i.id === l.item_id) || {}).serial_required) ? { serial: "" } : {}) }));
  P.cust = { name: r.customer || "", phone: r.phone || "" }; P.quote = null; P.res = { id: r.id, no: r.no, deposit: +r.deposit, customer: r.customer };
  P.pay = { cash: "", card: "", insta: "", wallet: "", inst: "" }; P.coupon = null; go("pos");
}

/* ---------- quote from the cart ---------- */
function qtNewModal() {
  if (!P.cart.length) return toast("ضيف الأصناف الأول.", true);
  modal(`<h2>عرض سعر</h2><p class="muted" style="margin:0 0 10px">بيتطبع للعميل بالأسعار والعروض الحالية، من غير ما يتحرك مخزون أو فلوس.</p><div class="stack">
    <div class="grid g2"><div class="field"><label>اسم العميل</label><input class="inp" id="qtN" value="${esc(P.cust.name || "")}"></div><div class="field"><label>الموبايل <span class="dim">(اختياري)</span></label><input class="inp num" id="qtP" value="${esc(P.cust.phone || "")}"></div></div>
    <div class="grid g2"><div class="field"><label>ساري كام يوم</label><input class="inp num" type="number" min="1" max="90" id="qtV" value="7"></div><div class="field"><label>ملاحظة</label><input class="inp" id="qtNote" placeholder="مثال: التوصيل مجاني"></div></div>
    <div id="qtErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="qtSave">إنشاء العرض</button></div></div>`);
}
function qtShow(q) {
  const lines = q.lines || [];
  modal(`<h2>عرض سعر ${esc(q.no)}</h2><div class="receipt" id="rcpt">${head("عرض سعر", q.no)}${q.customer_name ? `<div class="r"><span>السادة</span><span>${esc(q.customer_name)}</span></div>` : ""}
    ${lines.map(l => `<div class="r"><span>${esc(l.name)} × ${num(l.qty)}${+l.od > 0 ? `<br><span class="dim">${esc(l.offer || "عرض")} −${fmt(l.od, 1)}</span>` : ""}</span><span>${fmt(l.price * l.qty, 1)}</span></div>`).join("")}
    <div class="hr" style="margin:8px 0"></div>${+q.offer_disc ? `<div class="r"><span>خصم العروض</span><span>−${fmt(q.offer_disc, 1)}</span></div>` : ""}<div class="r"><b>الإجمالي</b><b>${fmt(q.total, 1)}</b></div>
    <div style="text-align:center;margin-top:8px">العرض ساري لحد ${esc(q.valid_until)}</div>${q.note ? `<div style="text-align:center" class="dim">${esc(q.note)}</div>` : ""}<div style="text-align:center;margin-top:4px;font-size:11px">الأسعار قابلة للتغيير بعد انتهاء مدة العرض والكميات حسب المتاح.</div></div>
    ${printBtns(can("pos", "a") ? `<button class="btn ghost" data-act="qtToPos" data-id="${q.id}">تحويل لفاتورة</button>` : "")}`);
}

/* =====================================================================
   coupons (a tab of the offers screen)
   ===================================================================== */
async function loadCp() { S.cps = await rpc("coupons_list", { p_token: T() }); }
const cpVal = c => c.kind === "pct" ? `${+c.value}%${c.max_disc ? ` (لحد ${fmt(c.max_disc)})` : ""}` : fmt(c.value);
function couponsView() {
  if (!S.cps) return later(loadCp, "offers");
  const canA = isTop() || can("offers", "a"), canE = isTop() || can("offers", "e"), now = new Date().toISOString();
  return `<div class="card rise"><div class="row between" style="flex-wrap:wrap;gap:8px"><div><h3 style="margin:0">الكوبونات</h3><p class="dim" style="margin:4px 0 0;font-size:12.5px">كود العميل بيكتبه الكاشير في الفاتورة، والخصم بيتحسب بعد العروض والخصم اليدوي.</p></div>${canA ? `<button class="btn gold" data-act="cpNew">كوبون جديد</button>` : ""}</div></div>
   <div class="tw rise"><table><thead><tr><th>الكود</th><th>الخصم</th><th>الشروط</th><th>المدة</th><th class="n">اتستخدم</th><th class="n">إجمالي الخصم</th><th>الحالة</th><th></th></tr></thead><tbody>${S.cps.map(c => { const exp = c.ends_at && c.ends_at <= now; const stt = exp ? ["انتهت مدته", "plain"] : { active: ["شغّال", "ok"], paused: ["متوقف", "warn"], ended: ["انتهى", "plain"] }[c.status];
     return `<tr><td class="num"><b>${esc(c.code)}</b>${c.note ? `<br><span class="dim" style="font-size:12px">${esc(c.note)}</span>` : ""}</td><td>${cpVal(c)}</td><td style="font-size:12.5px">${[+c.min_total ? "فاتورة من " + fmt(c.min_total) : "", c.max_uses ? "لحد " + c.max_uses + " مرة" : "", c.once_per_customer ? "مرة لكل عميل" : ""].filter(Boolean).join("<br>") || "—"}</td><td style="font-size:12.5px">${dd(c.starts_at)}${c.ends_at ? " ← " + dd(c.ends_at) : " · مفتوح"}</td><td class="n">${num(c.uses)}</td><td class="n">${fmt(c.disc_total, 1)}</td><td>${chip(stt[0], stt[1])}</td>
       <td style="white-space:nowrap">${canE && c.status !== "ended" ? `<button class="btn sm ghost" data-act="cpEdit" data-id="${c.id}">تعديل</button>${c.status === "active" ? `<button class="btn sm ghost" data-act="cpSt" data-id="${c.id}" data-s="paused">إيقاف</button>` : `<button class="btn sm" data-act="cpSt" data-id="${c.id}" data-s="active">تشغيل</button>`}<button class="btn sm ghost" data-act="cpSt" data-id="${c.id}" data-s="ended">إنهاء</button>` : ""}</td></tr>`; }).join("") || empty(8, "لسه مفيش كوبونات.")}</tbody></table></div>`;
}
function cpModal(c) {
  const x = c || { code: "", kind: "pct", value: 10, max_disc: "", min_total: "", max_uses: "", once_per_customer: false, starts_at: new Date().toISOString(), ends_at: null, note: "" };
  const dtl = v => v ? new Date(v).toISOString().slice(0, 16) : "";
  modal(`<h2>${c ? "تعديل كوبون" : "كوبون جديد"}</h2><div class="stack" style="margin-top:10px">
    <div class="grid g2"><div class="field"><label>الكود <span class="dim">(إنجليزي وأرقام)</span></label><input class="inp num" id="cpC" value="${esc(x.code)}" placeholder="مثال: EID2026" style="text-transform:uppercase"></div><div class="field"><label>النوع</label><select class="inp" id="cpK"><option value="pct" ${x.kind === "pct" ? "selected" : ""}>نسبة %</option><option value="amount" ${x.kind === "amount" ? "selected" : ""}>مبلغ</option></select></div></div>
    <div class="grid g2"><div class="field"><label>القيمة</label><input class="inp num" type="number" min="1" id="cpV" value="${+x.value || ""}"></div><div class="field"><label>أقصى خصم <span class="dim">(للنسبة — اختياري)</span></label><input class="inp num" type="number" min="1" id="cpX" value="${x.max_disc || ""}"></div></div>
    <div class="grid g2"><div class="field"><label>أقل فاتورة <span class="dim">(اختياري)</span></label><input class="inp num" type="number" min="0" id="cpMin" value="${x.min_total || ""}"></div><div class="field"><label>عدد مرات الاستخدام <span class="dim">(فاضي = مفتوح)</span></label><input class="inp num" type="number" min="1" id="cpU" value="${x.max_uses || ""}"></div></div>
    <label class="row" style="gap:8px"><input type="checkbox" id="cpO" ${x.once_per_customer ? "checked" : ""}> مرة واحدة لكل عميل (محتاج موبايل العميل)</label>
    <div class="grid g2"><div class="field"><label>يبدأ</label><input class="inp" type="datetime-local" id="cpS" value="${dtl(x.starts_at)}"></div><div class="field"><label>ينتهي <span class="dim">(اختياري)</span></label><input class="inp" type="datetime-local" id="cpE" value="${dtl(x.ends_at)}"></div></div>
    <div class="field"><label>ملاحظة</label><input class="inp" id="cpN" value="${esc(x.note || "")}" placeholder="مثال: لعملاء مجموعة الجملة"></div><div id="cpErr"></div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cpSave" data-id="${c ? c.id : ""}">حفظ</button></div></div>`);
}
const prevOffers = V.offers;
V.offers = () => { const D = S.ofs; if (D && D.tab === "coupons") { const h = prevOffers(); const cut = h.indexOf('<div class="tw rise">'); return (cut > 0 ? h.slice(0, cut) : h) + couponsView(); } return prevOffers(); };

/* =====================================================================
   birthdays (card on the customers screen)
   ===================================================================== */
const waNum = p => { let d = String(p || "").replace(/[^0-9]/g, ""); if (/^01\d{9}$/.test(d)) d = "2" + d; return d; };
function nextBday(b) { if (!b) return null; const t = new Date(); t.setHours(0, 0, 0, 0); const [, m, d] = b.split("-").map(Number); let n = new Date(t.getFullYear(), m - 1, d); if (n < t) n = new Date(t.getFullYear() + 1, m - 1, d); return Math.round((n - t) / 864e5); }
M.bday = { card(list) {
  const up = (list || []).map(c => ({ c, n: nextBday(c.birthday) })).filter(x => x.n != null && x.n <= 30).sort((a, b) => a.n - b.n);
  if (!up.length) return "";
  const msg = c => `كل سنة وإنت طيب يا ${c.name} 🎂\nعيد ميلاد سعيد من ${S.store.name} — نتمنالك سنة حلوة.`;
  return `<div class="card rise"><h3>أعياد ميلاد في الـ ٣٠ يوم الجاية <span class="dim" style="font-size:12.5px;font-weight:400">(${up.length})</span></h3><div class="tw"><table><tbody>${up.map(({ c, n }) => `<tr><td>${esc(c.name)}<br><span class="dim num">${esc(c.phone || "")}</span></td><td class="num">${esc(c.birthday.slice(5).split("-").reverse().join("/"))}</td><td>${n === 0 ? chip("النهارده 🎂", "gold") : n === 1 ? chip("بكرة", "warn") : chip("بعد " + n + " يوم", "info")}</td><td>${c.phone ? `<a class="btn sm" target="_blank" rel="noopener" href="https://wa.me/${waNum(c.phone)}?text=${encodeURIComponent(msg(c))}">تهنئة واتساب</a>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
} };

/* =====================================================================
   actions
   ===================================================================== */
const prev = window.MZX;
window.MZX = async function (k, a) {
  const R = S.rs || {}, byId = id => (R.list || []).find(r => r.id === id), qById = id => (R.quotes || []).find(q => q.id === id) || S._qt;
  if (k === "rsTab") { S.rs.tab = a.dataset.k; render(); return true; }
  if (k === "resNew") { resNewModal(); return true; }
  if (k === "resSave") { resSave(a); return true; }
  if (k === "resGo") { resToPos(byId(a.dataset.id)); return true; }
  if (k === "resLeave") { P.res = null; P.cart = []; P.cust = { name: "", phone: "" }; render(); return true; }
  if (k === "resPay") { resPayModal(byId(a.dataset.id)); return true; }
  if (k === "resCancel") { resCancelModal(byId(a.dataset.id)); return true; }
  if (k === "resPayGo" || k === "resCancelGo") { busy(a, true);
    try { if (k === "resPayGo") await rpc("reservation_pay", { p_token: T(), p_id: a.dataset.id, p_amount: +$("#rpA").value, p_method: $("#rpM").value });
      else await rpc("reservation_cancel", { p_token: T(), p_id: a.dataset.id, p_reason: $("#rcW").value.trim(), p_method: $("#rcM").value });
      closeModal(); toast(k === "resPayGo" ? "اتسجّلت الدفعة." : "الحجز اتلغى والعربون رجع."); S.rs.loaded = false; P.shift = undefined; render(); }
    catch (e) { errBox(k === "resPayGo" ? "#rpErr" : "#rcErr", e); busy(a, false); }
    return true; }
  if (k === "qtNew") { qtNewModal(); return true; }
  if (k === "qtSave") { busy(a, true);
    try { const q = await rpc("quote_save", { p_token: T(), p: { customer: { name: $("#qtN").value.trim(), phone: $("#qtP").value.trim() }, lines: P.cart.map(l => ({ item_id: l.id, qty: l.qty })), valid_days: +$("#qtV").value || 7, note: $("#qtNote").value.trim() } });
      S._qt = q; if (S.rs) S.rs.loaded = false; qtShow(q); }
    catch (e) { errBox("#qtErr", e); busy(a, false); }
    return true; }
  if (k === "qtShow") { qtShow(qById(a.dataset.id)); return true; }
  if (k === "qtToPos") { const q = qById(a.dataset.id); if (!q) return true; closeModal();
    P.cart = (q.lines || []).filter(l => S.items.some(i => i.id === l.item_id)).map(l => ({ id: l.item_id, qty: +l.qty, ...(((S.items.find(i => i.id === l.item_id) || {}).serial_required) ? { serial: "" } : {}) }));
    P.cust = { name: q.customer_name || "", phone: q.customer_phone || "" }; P.res = null; P.quote = q.id; go("pos"); toast(`اتحمّل عرض السعر ${q.no} — الأسعار والعروض هتتحسب على النهارده.`); return true; }
  if (k === "cpOn") { const v = ($("#posCp").value || "").trim(); if (!v) return true; busy(a, true);
    try { P.coupon = await rpc("coupon_check", { p_token: T(), p_code: v, p_phone: (P.cust.phone || "").trim() }); render(); }
    catch (e) { toast(errText(e), true); busy(a, false); }
    return true; }
  if (k === "cpOff") { P.coupon = null; render(); return true; }
  if (k === "cpNew") { cpModal(null); return true; }
  if (k === "cpEdit") { cpModal((S.cps || []).find(c => c.id === +a.dataset.id)); return true; }
  if (k === "cpSave") { const p = { id: a.dataset.id ? +a.dataset.id : null, code: $("#cpC").value.trim(), kind: $("#cpK").value, value: +$("#cpV").value || 0, max_disc: $("#cpX").value || null, min_total: $("#cpMin").value || null, max_uses: $("#cpU").value || null,
      once_per_customer: $("#cpO").checked, starts_at: $("#cpS").value ? new Date($("#cpS").value).toISOString() : null, ends_at: $("#cpE").value ? new Date($("#cpE").value).toISOString() : null, note: $("#cpN").value.trim() };
    busy(a, true);
    try { await rpc("coupon_save", { p_token: T(), p }); closeModal(); toast("اتحفظ الكوبون."); S.cps = null; render(); }
    catch (e) { errBox("#cpErr", e); busy(a, false); }
    return true; }
  if (k === "cpSt") { const s = a.dataset.s; if (s === "ended" && !confirm("إنهاء الكوبون؟ مش هيرجع يشتغل تاني.")) return true;
    try { await rpc("coupon_set_status", { p_token: T(), p_id: +a.dataset.id, p_status: s }); S.cps = null; render(); } catch (e) { toast(errText(e), true); }
    return true; }
  return prev ? prev(k, a) : false;
};
})();
