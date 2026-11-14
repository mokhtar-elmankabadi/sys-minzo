/* SYS Minzo · offers & discounts (batch 12):
   ready buttons for the common offers and discounts, the owner's own saved formulas, targets mixing items / groups /
   departments (added by barcode, phone camera, search, or a whole department / group), the new kinds (fixed price,
   quantity tiers, any N for an amount, buy A → off B, gift over an invoice amount, invoice tiers),
   the cashier's quick discount buttons, and a fixed discount for a customer group. Built on window.MZ. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, P, $, esc, fmt, num, norm, rpc, T, can, toast, modal, closeModal, busy, render, errText, byCode, srch } = M;
const top = () => ["owner", "gm"].includes(S.sess.role.id);
const canA = () => top() || can("offers", "a");
const canE = () => top() || can("offers", "e");
const DAYS = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
const KN = { pct: "خصم نسبة %", amount: "خصم مبلغ على القطعة", fixed: "سعر ثابت للقطعة", tier: "خصم متدرّج بالكمية", bxgy: "اشتري X وخد Y ببلاش", nth: "التانية (أو التالتة) بخصم",
  mixmatch: "أي عدد قطع بمبلغ ثابت", bundle: "طقم بسعر واحد", gift: "هدية مع الصنف", cross: "اشتري من (أ) وخد خصم على (ب)", spend_gift: "هدية لما الفاتورة تعدّي مبلغ", inv_tier: "خصم فاتورة متدرّج" };
const INVOICE_ONLY = ["spend_gift", "inv_tier"];

/* ---------- the ready buttons ---------- */
const PRESETS = {
  offer: [
    ["b1g1", "اشتري ١ وخد ١ ببلاش", { kind: "bxgy", buy_qty: 1, get_qty: 1 }],
    ["b2g1", "اشتري ٢ وخد ١ ببلاش", { kind: "bxgy", buy_qty: 2, get_qty: 1 }],
    ["b3g1", "اشتري ٣ وخد ١ ببلاش", { kind: "bxgy", buy_qty: 3, get_qty: 1 }],
    ["half2", "التانية بنص التمن", { kind: "nth", buy_qty: 1, get_qty: 1, value: 50 }],
    ["third30", "التالتة بخصم ٣٠٪", { kind: "nth", buy_qty: 2, get_qty: 1, value: 30 }],
    ["mix3", "أي ٣ قطع بمبلغ ثابت", { kind: "mixmatch", buy_qty: 3, value: 0 }],
    ["bundle", "طقم بسعر واحد", { kind: "bundle", scope: "bundle" }],
    ["gift", "هدية مع الصنف", { kind: "gift", buy_qty: 1, get_qty: 1 }],
    ["spgift", "هدية لما الفاتورة تعدّي مبلغ", { kind: "spend_gift", scope: "invoice", get_qty: 1, min_total: 5000 }],
    ["cross", "اشتري من (أ) وخد خصم على (ب)", { kind: "cross", buy_qty: 1, get_qty: 1, value: 20 }],
    ["happy", "عرض بالساعة", { kind: "pct", value: 10, hour_from: "18:00", hour_to: "21:00" }],
    ["weekend", "عرض نهاية الأسبوع", { kind: "pct", value: 10, days: [4, 5] }]
  ],
  disc: [
    ["pct", "خصم ٪", { kind: "pct", value: 10 }],
    ["amt", "خصم مبلغ على القطعة", { kind: "amount", value: 100 }],
    ["fixed", "سعر ثابت للقطعة", { kind: "fixed", value: 0 }],
    ["tier", "خصم متدرّج بالكمية", { kind: "tier", tiers: [{ min: 3, pct: 10 }, { min: 5, pct: 15 }] }],
    ["invpct", "خصم ٪ على الفاتورة فوق مبلغ", { kind: "pct", scope: "invoice", value: 5, min_total: 3000 }],
    ["invamt", "خصم مبلغ على الفاتورة فوق مبلغ", { kind: "amount", scope: "invoice", value: 200, min_total: 2000 }],
    ["invtier", "خصم فاتورة متدرّج", { kind: "inv_tier", scope: "invoice", tiers: [{ min: 5000, pct: 5 }, { min: 10000, pct: 10 }] }],
    ["clear", "تصفية قسم أو مجموعة", { kind: "pct", value: 30, note: "تصفية" }]
  ]
};
const blank = () => ({ name: "", kind: "pct", scope: "mix", refs: [], refs2: [], tiers: null, value: 10, buy_qty: 2, get_qty: 1, gift_item: null, min_total: null, locs: [], starts_at: new Date().toISOString(), ends_at: null, days: [], hour_from: null, hour_to: null, priority: 1, note: "" });
function fromPreset(name, body) {
  const x = Object.assign(blank(), JSON.parse(JSON.stringify(body)));
  x.name = x.name || name; x.refs = x.refs || []; x.refs2 = x.refs2 || []; x.days = x.days || []; x.locs = x.locs || [];
  if (!x.scope) x.scope = "mix";
  x.starts_at = new Date().toISOString(); x.ends_at = null;
  return x;
}

/* ---------- list page: the buttons on top ---------- */
async function loadTpls() { try { S.oTpl = await rpc("offer_tpls", { p_token: T() }); } catch (e) { S.oTpl = []; } }
const prevOffers = V.offers;
V.offers = () => {
  const h = prevOffers(); const D = S.ofs;
  if (!D || D.tab === "coupons" || !canA()) return h;
  if (!S.oTpl) { loadTpls().then(() => S.route === "offers" && render()); }
  const btn = (k, n, sec) => `<button class="btn sm ${sec === "disc" ? "" : "gold"}" data-act="o2Pre" data-k="${k}" data-s="${sec}">${esc(n)}</button>`;
  const mine = (S.oTpl || []);
  const box = `<div class="card rise" style="margin-bottom:14px"><div class="row between" style="flex-wrap:wrap;gap:6px"><h3 style="margin:0">ابدأ من قالب جاهز</h3><span class="dim" style="font-size:12.5px">دوس على القالب، وكمّل الأصناف والقيمة. أي عرض تظبطه تقدر تحفظه «صيغة» من جوه الشاشة.</span></div>
    <div class="dim" style="font-size:12.5px;margin:12px 0 6px">عروض</div><div class="row" style="gap:6px;flex-wrap:wrap">${PRESETS.offer.map(([k, n]) => btn(k, n, "offer")).join("")}</div>
    <div class="dim" style="font-size:12.5px;margin:12px 0 6px">خصومات</div><div class="row" style="gap:6px;flex-wrap:wrap">${PRESETS.disc.map(([k, n]) => btn(k, n, "disc")).join("")}</div>
    ${mine.length ? `<div class="dim" style="font-size:12.5px;margin:12px 0 6px">صيغك المحفوظة</div><div class="row" style="gap:6px;flex-wrap:wrap">${mine.map(t => `<span class="row" style="gap:0;flex-wrap:nowrap"><button class="btn sm" data-act="o2Tpl" data-id="${t.id}">${t.section === "disc" ? "٪ " : "★ "}${esc(t.name)}</button>${canE() ? `<button class="btn sm ghost" style="padding:0 6px" data-act="o2TplDel" data-id="${t.id}" title="حذف الصيغة">✕</button>` : ""}</span>`).join("")}</div>` : ""}</div>`;
  const i = h.indexOf('<div class="tabs rise">');
  return i > 0 ? h.slice(0, i) + box + h.slice(i) : h + box;
};

/* ---------- the editor ---------- */
function toMix(refs, scope) { return (refs || []).map(r => scope === "group" ? "g:" + r : scope === "dept" ? "d:" + r : scope === "item" ? "i:" + r : r); }
window.MZOF = (o, copy) => {
  let x;
  if (o) { x = JSON.parse(JSON.stringify(o)); x.refs = x.refs || []; x.refs2 = x.refs2 || []; x.locs = x.locs || []; x.days = x.days || [];
    if (["item", "group", "dept"].includes(x.scope)) { x.refs = toMix(x.refs, x.scope); x.scope = "mix"; } }
  else x = blank();
  if (copy) { delete x.id; x.name = "نسخة من " + x.name; x.starts_at = new Date().toISOString(); x.ends_at = null; }
  S.o2 = x; draw();
};
const dtl = v => { if (!v) return ""; const d = new Date(v), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const refLabel = r => { const t = r.slice(0, 2), v = r.slice(2);
  if (t === "g:") { const g = S.groups.find(z => String(z.id) === v); return ["مجموعة", g ? g.name : "؟"]; }
  if (t === "d:") { const d = S.depts.find(z => String(z.id) === v); return ["قسم", d ? d.name : "؟"]; }
  const id = t === "i:" ? v : r, it = S.items.find(z => z.id === id); return ["صنف", it ? it.name : "؟"]; };
const bundleMode = () => S.o2.kind === "bundle";
const invMode = () => S.o2.scope === "invoice";
function picker(key, title) {
  const x = S.o2, L = x[key] || [];
  const deps = S.depts, grps = S.groups;
  return `<div class="field"><label>${title} <span class="dim">(${num(L.length)})</span></label>
    <div class="row" style="gap:6px;flex-wrap:nowrap"><input class="inp" id="pk_${key}" placeholder="${bundleMode() ? "باركود أو كود أو اسم الصنف" : "باركود أو كود أو اسم صنف / مجموعة / قسم"}" autocomplete="off" style="flex:1"><button class="btn sm" data-act="o2Cam" data-key="${key}" title="مسح بالكاميرا">📷</button></div>
    <div id="pkL_${key}" class="stack" style="gap:2px;max-height:170px;overflow:auto;margin-top:4px"></div>
    ${bundleMode() ? "" : `<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:6px"><select class="inp" id="pkD_${key}" style="width:auto;flex:1;min-width:140px"><option value="">+ قسم كامل…</option>${deps.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select>
      <select class="inp" id="pkG_${key}" style="width:auto;flex:1;min-width:140px"><option value="">+ مجموعة كاملة…</option>${grps.map(g => `<option value="${g.id}">${esc((deps.find(d => d.id === g.department_id) || {}).name || "")} · ${esc(g.name)}</option>`).join("")}</select></div>`}
    <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:8px">${L.map(r => { const [t, n] = refLabel(r); return `<span class="chip ${t === "صنف" ? "gold" : "info"} plain">${t !== "صنف" ? `<b style="font-weight:600">${t}</b> ` : ""}${esc(n)} <button class="btn sm ghost" style="padding:0 4px" data-act="o2Rm" data-key="${key}" data-r="${esc(r)}">✕</button></span>`; }).join("")}${L.length > 1 ? `<button class="btn sm ghost" data-act="o2Clr" data-key="${key}">شيل الكل</button>` : ""}</div></div>`;
}
function tiersBox() {
  const x = S.o2, inv = x.kind === "inv_tier"; x.tiers = x.tiers && x.tiers.length ? x.tiers : [{ min: inv ? 5000 : 3, pct: 10 }];
  return `<div class="field"><label>الشرايح <span class="dim">(${inv ? "لو الفاتورة من المبلغ ده ← النسبة" : "لو عدد القطع من العدد ده ← النسبة على كل القطع"})</span></label>
    <div class="stack" style="gap:6px">${x.tiers.map((t, i) => `<div class="row" style="gap:6px;flex-wrap:nowrap"><span class="dim" style="min-width:34px">من</span><input class="inp num" type="number" min="${inv ? 1 : 1}" step="${inv ? "any" : 1}" data-tmin="${i}" value="${t.min}"><span class="dim">${inv ? "ج.م" : "قطع"} ←</span><input class="inp num" type="number" min="1" max="100" data-tpct="${i}" value="${t.pct}"><span class="dim">%</span>${x.tiers.length > 1 ? `<button class="btn sm ghost" data-act="o2TDel" data-i="${i}">✕</button>` : ""}</div>`).join("")}</div>
    ${x.tiers.length < 10 ? `<button class="btn sm ghost" style="margin-top:6px" data-act="o2TAdd">+ شريحة</button>` : ""}</div>`;
}
function valueBox() {
  const x = S.o2, k = x.kind, n = (id, lbl, v, extra) => `<div class="field"><label>${lbl}</label><input class="inp num" type="number" id="${id}" value="${v == null ? "" : v}" ${extra || ""}></div>`;
  const giftSel = () => `<div class="field"><label>الهدية</label><select class="inp" id="o2Gi"><option value="">— اختار الصنف —</option>${S.items.filter(i => !i.hidden).map(i => `<option value="${i.id}" ${x.gift_item === i.id ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select></div>`;
  if (k === "pct") return `<div class="grid g2">${n("o2V", "نسبة الخصم %", +x.value || "", 'min="0.1" max="100" step="0.5"')}${invMode() ? n("o2Min", "أقل قيمة للفاتورة", x.min_total, 'min="0" placeholder="من غير حد أدنى"') : ""}</div>`;
  if (k === "amount") return `<div class="grid g2">${n("o2V", invMode() ? "الخصم على الفاتورة (ج.م)" : "الخصم على القطعة (ج.م)", +x.value || "", 'min="1"')}${invMode() ? n("o2Min", "أقل قيمة للفاتورة", x.min_total, 'min="0"') : ""}</div>`;
  if (k === "fixed") return `<div class="grid g2">${n("o2V", "سعر القطعة في العرض (ج.م)", +x.value || "", 'min="1"')}<p class="dim" style="font-size:12.5px;margin:28px 0 0">الصنف اللي سعره أصلًا أقل من كده مش بيتأثر.</p></div>`;
  if (k === "tier" || k === "inv_tier") return tiersBox() + (k === "inv_tier" ? "" : "");
  if (k === "bxgy") return `<div class="grid g2">${n("o2B", "لما يشتري", +x.buy_qty || 1, 'min="1" step="1"')}${n("o2G", "ياخد كام ببلاش (الأرخص)", +x.get_qty || 1, 'min="1" step="1"')}</div>`;
  if (k === "nth") return `<div class="grid g3">${n("o2B", "كل ما يشتري", +x.buy_qty || 1, 'min="1" step="1"')}${n("o2G", "ياخد كام بخصم (الأرخص)", +x.get_qty || 1, 'min="1" step="1"')}${n("o2V", "نسبة الخصم عليهم %", +x.value || 50, 'min="1" max="100"')}</div>`;
  if (k === "mixmatch") return `<div class="grid g2">${n("o2B", "أي عدد قطع", +x.buy_qty || 3, 'min="2" step="1"')}${n("o2V", "بمبلغ (ج.م)", +x.value || "", 'min="1"')}</div><p class="dim" style="font-size:12.5px;margin:0">القطع الأغلى بتدخل في العرض الأول، ولو مجموع القطع أقل من المبلغ العرض مش بيتطبّق.</p>`;
  if (k === "bundle") { const tot = x.refs.reduce((a, r) => a + +((S.items.find(i => i.id === r.replace(/^i:/, "")) || {}).sale_price || 0), 0); return `<div class="grid g2">${n("o2V", "سعر الطقم كله (ج.م)", +x.value || "", 'min="1"')}<div class="field"><label>سعر الأصناف منفصلة</label><div class="num" style="padding:10px 0">${fmt(tot)}</div></div></div>`; }
  if (k === "gift") return `<div class="grid g2">${giftSel()}<div class="field"><label>كل كام قطعة ← كام هدية</label><div class="row" style="gap:4px;flex-wrap:nowrap"><input class="inp num" type="number" min="1" id="o2B" value="${+x.buy_qty || 1}"><span>←</span><input class="inp num" type="number" min="1" id="o2G" value="${+x.get_qty || 1}"></div></div></div><p class="dim" style="margin:0;font-size:12.5px">الكاشير بيضيف الهدية للفاتورة، والسيستم بيخلّي سعرها صفر لوحده.</p>`;
  if (k === "spend_gift") return `<div class="grid g3">${giftSel()}${n("o2Min", "لما الفاتورة تعدّي (ج.م)", x.min_total || "", 'min="1"')}${n("o2G", "عدد الهدايا", +x.get_qty || 1, 'min="1" step="1"')}</div><p class="dim" style="margin:0;font-size:12.5px">الفاتورة بتتحسب من غير الهدية ومن غير الأصناف اللي عليها عرض تاني. الكاشير بيضيف الهدية، والسيستم بيخلّي سعرها صفر.</p>`;
  if (k === "cross") return `<div class="grid g3">${n("o2B", "كل ما يشتري من (أ)", +x.buy_qty || 1, 'min="1" step="1"')}${n("o2G", "ياخد كام من (ب)", +x.get_qty || 1, 'min="1" step="1"')}${n("o2V", "بخصم %", +x.value || 20, 'min="1" max="100"')}</div>`;
  return "";
}
function draw(check) {
  const x = S.o2, k = x.kind;
  if (k === "bundle") { x.scope = "bundle"; x.refs = x.refs.filter(r => !/^[gd]:/.test(r)).map(r => r.replace(/^i:/, "")); }
  else if (INVOICE_ONLY.includes(k)) x.scope = "invoice";
  else if (!["pct", "amount"].includes(k) && (x.scope === "invoice" || x.scope === "bundle")) { x.scope = "mix"; x.refs = toMix(x.refs, "item"); }
  else if (x.scope === "bundle") { x.scope = "mix"; x.refs = toMix(x.refs, "item"); }
  const canInv = ["pct", "amount"].includes(k);
  modal(`<h2>${x.id ? "تعديل" : "جديد"}: ${esc(KN[k] || k)}</h2><div class="stack" style="margin-top:10px">
   <div class="grid g2"><div class="field"><label>الاسم</label><input class="inp" id="o2N" value="${esc(x.name)}" placeholder="اسم يظهر على الفاتورة"></div><div class="field"><label>النوع</label><select class="inp" id="o2K">${Object.entries(KN).map(([a, b]) => `<option value="${a}" ${k === a ? "selected" : ""}>${b}</option>`).join("")}</select></div></div>
   ${canInv ? `<div class="field"><label>على</label><div class="tabs" style="margin:0"><button data-act="o2Sc" data-k="mix" class="${!invMode() ? "on" : ""}">أصناف ومجموعات وأقسام</button><button data-act="o2Sc" data-k="invoice" class="${invMode() ? "on" : ""}">الفاتورة كلها</button></div></div>` : ""}
   ${invMode() ? "" : picker("refs", k === "cross" ? "(أ) لما يشتري من" : k === "bundle" ? "أصناف الطقم" : k === "gift" ? "الأصناف اللي معاها هدية" : "العرض على")}
   ${k === "cross" ? picker("refs2", "(ب) ياخد الخصم على") : ""}
   ${valueBox()}
   <div class="grid g2"><div class="field"><label>يبدأ</label><input class="inp" type="datetime-local" id="o2S" value="${dtl(x.starts_at)}"></div><div class="field"><label>ينتهي <span class="dim">(اختياري)</span></label><input class="inp" type="datetime-local" id="o2E" value="${dtl(x.ends_at)}"></div></div>
   <details ${x.days.length || x.hour_from || x.locs.length || +x.priority !== 1 ? "open" : ""}><summary class="dim" style="cursor:pointer">أيام وساعات ومعارض وأولوية</summary><div class="stack" style="margin-top:8px">
    <div class="field"><label>الأيام <span class="dim">(من غير اختيار = كل يوم)</span></label><div class="row" style="gap:8px;flex-wrap:wrap">${DAYS.map((d, i) => `<label class="row" style="gap:4px"><input type="checkbox" data-o2d="${i}" ${x.days.includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div></div>
    <div class="grid g2"><div class="field"><label>من الساعة</label><input class="inp" type="time" id="o2H1" value="${x.hour_from ? String(x.hour_from).slice(0, 5) : ""}"></div><div class="field"><label>لحد الساعة</label><input class="inp" type="time" id="o2H2" value="${x.hour_to ? String(x.hour_to).slice(0, 5) : ""}"></div></div>
    <div class="field"><label>المعارض <span class="dim">(من غير اختيار = الكل)</span></label><div class="row" style="gap:10px;flex-wrap:wrap">${S.locs.filter(l => l.kind === "showroom").map(l => `<label class="row" style="gap:4px"><input type="checkbox" data-o2l="${l.id}" ${x.locs.includes(l.id) ? "checked" : ""}>${esc(l.name)}</label>`).join("")}</div></div>
    <div class="grid g2"><div class="field"><label>الأولوية <span class="dim">(الأعلى بيكسب)</span></label><input class="inp num" type="number" min="1" max="99" id="o2P" value="${x.priority}"></div><div class="field"><label>ملاحظة</label><input class="inp" id="o2Nt" value="${esc(x.note || "")}"></div></div></div></details>
   ${check ? `<div class="warnbox"><b>تحذير الهامش</b> — محسوب بعد أسوأ عمولة تقسيط على المحل (${+check.worst_comm}%)، والحد الأدنى ${+check.min_margin}%:<div style="max-height:150px;overflow:auto;margin-top:6px">${check.rows.slice(0, 40).map(r => `${esc(r.item)}: صافي <span class="num">${fmt(r.net, 1)}</span> · تكلفة <span class="num">${fmt(r.cost, 1)}</span> · ${r.level === "cost" ? `<b style="color:var(--bad)">تحت التكلفة</b>` : `هامش ${r.margin}%`}`).join("<br>")}${check.rows.length > 40 ? `<br>و ${check.rows.length - 40} صنف كمان` : ""}</div>${check.rows.some(r => r.level === "cost") && !top() ? `<p style="margin:6px 0 0">البيع تحت التكلفة محتاج المالك أو المدير العام.</p>` : ""}</div>` : ""}
   <div id="o2Err"></div><div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap">${canA() ? `<button class="btn sm ghost" data-act="o2SaveTpl">حفظ كصيغة</button>` : "<span></span>"}<div class="row" style="gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button>${check ? `<button class="btn" data-act="o2Save" data-c="1">حفظ رغم التحذير</button>` : `<button class="btn gold" data-act="o2Save">حفظ</button>`}</div></div></div>`);
  $("#o2K").onchange = e => { sync(); const was = x.kind; x.kind = e.target.value; if (was !== x.kind && (was === "tier" || was === "inv_tier")) x.tiers = null; draw(); };
  ["refs", "refs2"].forEach(key => bindPicker(key));
}
function sync() {
  const x = S.o2, v = id => { const e = $(id); return e ? e.value : undefined; };
  if (!$("#o2N")) return;
  x.name = v("#o2N"); x.priority = +v("#o2P") || 1; x.note = v("#o2Nt") || "";
  if (v("#o2V") !== undefined) x.value = +v("#o2V") || 0;
  if (v("#o2B") !== undefined) x.buy_qty = +v("#o2B") || 1;
  if (v("#o2G") !== undefined) x.get_qty = +v("#o2G") || 1;
  if (v("#o2Gi") !== undefined) x.gift_item = v("#o2Gi") || null;
  if (v("#o2Min") !== undefined) x.min_total = v("#o2Min") === "" ? null : +v("#o2Min");
  if (x.tiers) document.querySelectorAll("[data-tmin]").forEach(e => { const i = +e.dataset.tmin; if (x.tiers[i]) { x.tiers[i].min = +e.value; x.tiers[i].pct = +$(`[data-tpct="${i}"]`).value; } });
  x.starts_at = v("#o2S") ? new Date(v("#o2S")).toISOString() : new Date().toISOString(); x.ends_at = v("#o2E") ? new Date(v("#o2E")).toISOString() : null;
  x.days = [...document.querySelectorAll("[data-o2d]:checked")].map(e => +e.dataset.o2d); x.locs = [...document.querySelectorAll("[data-o2l]:checked")].map(e => +e.dataset.o2l);
  x.hour_from = v("#o2H1") || null; x.hour_to = v("#o2H2") || null;
}
function addRef(key, r) {
  const x = S.o2, L = x[key] || (x[key] = []), rr = bundleMode() ? r.replace(/^i:/, "") : r;
  if (bundleMode() && /^[gd]:/.test(r)) return toast("الطقم بيتعمل من أصناف بس.", true);
  if (L.includes(rr)) { toast("موجود بالفعل."); return false; }
  L.push(rr); return true;
}
function bindPicker(key) {
  const qi = $("#pk_" + key); if (!qi) return;
  const list = $("#pkL_" + key);
  const show = () => {
    const t = norm(qi.value.trim()); if (!t) { list.innerHTML = ""; return; }
    const its = S.items.filter(i => !i.hidden && norm(srch(i)).includes(t)).slice(0, 12).map(i => [`i:${i.id}`, "صنف", i.name, i.barcode || i.code]);
    const gs = bundleMode() ? [] : S.groups.filter(g => norm(g.name).includes(t)).slice(0, 5).map(g => [`g:${g.id}`, "مجموعة", g.name, ""]);
    const ds = bundleMode() ? [] : S.depts.filter(d => norm(d.name).includes(t)).slice(0, 5).map(d => [`d:${d.id}`, "قسم", d.name, ""]);
    const all = [...ds, ...gs, ...its];
    list.innerHTML = all.map(([r, ty, n, c]) => `<button class="btn sm ghost" style="justify-content:flex-start" data-act="o2Add" data-key="${key}" data-r="${esc(r)}"><span class="chip ${ty === "صنف" ? "plain" : "info"}" style="font-size:11px">${ty}</span> ${esc(n)} ${c ? `<span class="dim num" style="font-size:11.5px">${esc(c)}</span>` : ""}</button>`).join("") || `<span class="dim">مفيش نتايج.</span>`;
  };
  qi.oninput = show;
  qi.onkeydown = e => { if (e.key !== "Enter") return; e.preventDefault(); const v = qi.value.trim(); if (!v) return;
    const it = byCode(v); if (it) { sync(); if (addRef(key, "i:" + it.id)) { draw(); const n = $("#pk_" + key); if (n) n.focus(); } else qi.select(); return; }
    const first = list.querySelector("[data-act=o2Add]"); if (first) first.click(); else toast("مفيش صنف بالكود ده.", true); };
  const dsel = $("#pkD_" + key), gsel = $("#pkG_" + key);
  if (dsel) dsel.onchange = () => { if (!dsel.value) return; sync(); addRef(key, "d:" + dsel.value); draw(); };
  if (gsel) gsel.onchange = () => { if (!gsel.value) return; sync(); addRef(key, "g:" + gsel.value); draw(); };
}

/* ---------- phone camera (an overlay, so the editor stays open) ---------- */
async function cam(onCode) {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices) return toast("الكاميرا مش مدعومة على المتصفح ده — استخدم Chrome على الموبايل، أو اكتب الكود.", true);
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); } catch (e) { return toast("مفيش إذن للكاميرا.", true); }
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px";
  ov.innerHTML = `<video playsinline muted style="width:min(520px,100%);border-radius:12px;background:#000"></video><div class="row" style="gap:8px"><span id="camN" style="color:#fff;font-size:14px">وجّه الكاميرا على الباركود — تقدر تمسح أكتر من صنف ورا بعض</span><button class="btn">تمام</button></div>`;
  document.body.appendChild(ov);
  const v = ov.querySelector("video"); v.srcObject = stream; await v.play().catch(() => {});
  const det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code", "itf"] });
  let on = true, last = "", lastAt = 0, n = 0;
  const stop = () => { on = false; stream.getTracks().forEach(t => t.stop()); ov.remove(); };
  ov.querySelector("button").onclick = stop;
  const tick = async () => { if (!on) return;
    try { const r = await det.detect(v); if (r && r.length) { const code = r[0].rawValue; if (code !== last || Date.now() - lastAt > 2500) { last = code; lastAt = Date.now(); if (navigator.vibrate) navigator.vibrate(60); if (onCode(code)) { n++; ov.querySelector("#camN").textContent = `اتضاف ${n} — كمّل أو دوس «تمام»`; } } } } catch (e) {}
    setTimeout(tick, 250); };
  tick();
}

/* ---------- POS: quick discount buttons + customer group discount ---------- */
const prevPos = V.pos;
V.pos = () => {
  let h = prevPos();
  if (!P.cart.length) return h;
  const qd = (S.store && S.store.quick_disc) || [];
  const i = h.indexOf('id="posDisc"'); if (i < 0) return h;
  const j = h.indexOf("</div>", i) + 6;
  const extra = (qd.length ? `<div class="row" style="gap:4px;flex-wrap:wrap;justify-content:flex-end;margin:2px 0 4px">${qd.map(v => `<button class="btn sm ${+P.disc === +v ? "gold" : "ghost"}" data-act="qdisc" data-v="${+v}">${num(+v)}%</button>`).join("")}${P.disc ? `<button class="btn sm ghost" data-act="qdisc" data-v="0">بدون</button>` : ""}</div>` : "")
    + (P.gd ? `<div class="okbox" style="font-size:12.5px;padding:6px 10px">العميل في مجموعة «${esc(P.gd.group)}» ليها خصم ثابت ${num(+P.gd.pct)}% — اتحط لوحده، ومش محتاج اعتماد لحد النسبة دي.</div>` : "");
  return h.slice(0, j) + extra + h.slice(j);
};
let gdSeq = 0;
async function groupDisc() {
  const ph = (P.cust.phone || "").replace(/[^0-9+]/g, "");
  if (P.gd && P.gd.phone === ph) return;
  if (ph.length < 7) { if (P.gd) { if (+P.disc === +P.gd.pct) P.disc = 0; P.gd = null; render(); } return; }
  const my = ++gdSeq;
  try { const r = await rpc("cust_group_disc", { p_token: T(), p_phone: ph }); if (my !== gdSeq) return;
    const had = P.gd; P.gd = +r.pct > 0 ? { pct: +r.pct, group: r.group, phone: ph } : null;
    if (P.gd && +P.disc < P.gd.pct) P.disc = P.gd.pct;
    if (!P.gd && had && +P.disc === +had.pct) P.disc = 0;
    if (P.gd || had) render();
  } catch (e) { /* offline or no right: the cashier can still type the discount */ }
}
const prevHPos = H.pos;
H.pos = () => { if (prevHPos) prevHPos(); const cp = $("#cPhone"); if (cp) { cp.addEventListener("change", groupDisc); cp.addEventListener("blur", groupDisc); } };

/* ---------- settings: the quick discount buttons ---------- */
const prevSet = V.settings;
if (prevSet) V.settings = () => {
  const h = prevSet(); if (!top()) return h;
  const qd = ((S.store && S.store.quick_disc) || []).map(Number);
  return h + `<div class="card rise"><h3>أزرار الخصم السريع للكاشير</h3><p class="muted" style="margin-top:0">النسب اللي بتظهر أزرار في نقطة البيع. لحد ٨ نسب. حدود الخصم لكل دور زي ما هي، واللي فوق الحد محتاج اعتماد.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><input class="inp" id="qdV" style="max-width:280px" value="${esc(qd.join("، "))}" placeholder="مثال: 5، 10، 15"><button class="btn gold" data-act="qdSave">حفظ</button></div></div>`;
};

/* ---------- actions ---------- */
const prev = window.MZX;
window.MZX = async function (k, a) {
  const x = S.o2;
  if (k === "o2Pre") { const L = PRESETS[a.dataset.s].find(p => p[0] === a.dataset.k); if (L) { S.o2 = fromPreset(L[1], L[2]); draw(); } return true; }
  if (k === "o2Tpl") { const t = (S.oTpl || []).find(z => z.id === +a.dataset.id); if (t) { S.o2 = fromPreset(t.name, t.body); delete S.o2.id; draw(); } return true; }
  if (k === "o2TplDel") { const t = (S.oTpl || []).find(z => z.id === +a.dataset.id); if (!t || !confirm(`حذف الصيغة «${t.name}»؟ العروض اللي اتعملت بيها مش هتتأثر.`)) return true;
    try { await rpc("offer_tpl_del", { p_token: T(), p_id: t.id }); await loadTpls(); render(); } catch (e) { toast(errText(e), true); } return true; }
  if (k === "o2Sc") { sync(); x.scope = a.dataset.k; if (x.scope === "invoice") { x.refs = []; } draw(); return true; }
  if (k === "o2Add") { sync(); addRef(a.dataset.key, a.dataset.r); draw(); const n = $("#pk_" + a.dataset.key); if (n) n.focus(); return true; }
  if (k === "o2Rm") { sync(); const L = x[a.dataset.key], i = L.indexOf(a.dataset.r); if (i >= 0) L.splice(i, 1); draw(); return true; }
  if (k === "o2Clr") { sync(); x[a.dataset.key] = []; draw(); return true; }
  if (k === "o2Cam") { sync(); const key = a.dataset.key;
    cam(code => { const it = byCode(code); if (!it) { toast("مفيش صنف بالكود " + code, true); return false; } const ok = addRef(key, "i:" + it.id); if (ok) { draw(); toast("اتضاف: " + it.name); } return ok; }); return true; }
  if (k === "o2TAdd") { sync(); const L = x.tiers || []; const lastT = L[L.length - 1] || { min: 0, pct: 0 }; L.push({ min: x.kind === "inv_tier" ? +lastT.min * 2 || 5000 : +lastT.min + 2, pct: Math.min(100, +lastT.pct + 5) }); x.tiers = L; draw(); return true; }
  if (k === "o2TDel") { sync(); x.tiers.splice(+a.dataset.i, 1); draw(); return true; }
  if (k === "o2SaveTpl") { sync(); const nm = (prompt("اسم الصيغة (هيظهر زرار ثابت في صفحة العروض):", x.name || KN[x.kind]) || "").trim(); if (!nm) return true;
    const sec = ["pct", "amount", "fixed", "tier", "inv_tier"].includes(x.kind) ? "disc" : "offer";
    try { await rpc("offer_tpl_save", { p_token: T(), p_name: nm, p_section: sec, p_body: body(x) }); await loadTpls(); toast("اتحفظت الصيغة — هتلاقيها زرار في صفحة العروض."); } catch (e) { $("#o2Err").innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; } return true; }
  if (k === "o2Save") { sync(); const p = Object.assign(body(x), { confirm: a.dataset.c === "1" });
    if (p.scope !== "invoice" && !p.refs.length) { $("#o2Err").innerHTML = `<div class="warnbox">ضيف صنف أو مجموعة أو قسم على الأقل.</div>`; return true; }
    busy(a, true);
    try { const r = await rpc("offer_save", { p_token: T(), p }); if (!r.ok) { draw(r.check); return true; } closeModal(); toast("اتحفظ."); S.ofs = null; S.o2 = null; render(); }
    catch (e) { $("#o2Err").innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; busy(a, false); }
    return true; }
  if (k === "qdisc") { P.disc = +a.dataset.v; render(); return true; }
  if (k === "qdSave") { const vals = String($("#qdV").value).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).split(/[,،\s]+/).filter(Boolean).map(Number);
    if (vals.some(v => !(v > 0 && v <= 100))) return toast("كل نسبة لازم تكون من ١ لـ ١٠٠.", true), true;
    busy(a, true); try { await rpc("store_quick_disc_save", { p_token: T(), p_vals: vals }); await M.loadCore(); toast("اتحفظت أزرار الخصم."); render(); } catch (e) { toast(errText(e), true); busy(a, false); } return true; }
  if (k === "cxGrpDisc") { const g = (S.cx && S.cx.groups || []).find(z => z.id === +a.dataset.id); if (!g) return true;
    modal(`<h2>خصم ثابت لمجموعة «${esc(g.name)}»</h2><p class="muted">أول ما الكاشير يكتب موبايل عميل من المجموعة دي، الخصم بيتحط لوحده على الفاتورة كلها بعد العروض، ومش محتاج اعتماد لحد النسبة دي. صفر = من غير خصم.</p>
      <div class="field"><label>نسبة الخصم %</label><input class="inp num" type="number" min="0" max="100" step="0.5" id="gdP" value="${+g.discount_pct || 0}"></div><div id="gdErr"></div>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cxGrpDiscSave" data-id="${g.id}">حفظ</button></div>`); return true; }
  if (k === "cxGrpDiscSave") { const v = +$("#gdP").value; busy(a, true);
    try { await rpc("cust_group_disc_set", { p_token: T(), p_group: +a.dataset.id, p_pct: v }); const g = S.cx.groups.find(z => z.id === +a.dataset.id); if (g) g.discount_pct = v; closeModal(); toast("اتحفظ خصم المجموعة."); render(); }
    catch (e) { $("#gdErr").innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; busy(a, false); } return true; }
  return prev ? prev(k, a) : false;
};
function body(x) {
  const p = JSON.parse(JSON.stringify(x)); delete p.status; delete p.created_by; delete p.created_at; delete p.updated_at;
  const k = p.kind;
  if (!["gift", "spend_gift"].includes(k)) p.gift_item = null;
  if (!["bxgy", "gift", "nth", "mixmatch", "cross", "spend_gift"].includes(k)) { p.buy_qty = null; p.get_qty = null; }
  if (k === "spend_gift") p.buy_qty = null;
  if (k === "mixmatch") p.get_qty = null;
  if (!(p.scope === "invoice" && ["pct", "amount", "spend_gift"].includes(k))) p.min_total = null;
  if (!["tier", "inv_tier"].includes(k)) p.tiers = null; else p.tiers = (p.tiers || []).map(t => ({ min: +t.min, pct: +t.pct })).sort((a, b) => a.min - b.min);
  if (k !== "cross") p.refs2 = null;
  if (p.scope === "invoice") p.refs = [];
  if (!p.locs || !p.locs.length) p.locs = null; if (!p.days || !p.days.length) p.days = null; if (!p.hour_from || !p.hour_to) { p.hour_from = null; p.hour_to = null; }
  return p;
}
})();
