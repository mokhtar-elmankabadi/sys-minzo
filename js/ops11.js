/* SYS Minzo · more imports from Excel (batch 11): customers, suppliers with opening balances, sale-price updates,
   and a supplier's purchase invoice (loaded into the normal purchase screen to review and save).
   Each import is tried first without saving and lists every problem row by row. Built on window.MZ. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, norm, rpc, T, can, has, toast, busy, render, errText, header, loadItems, myLoc, locName, seeCost, go } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;

/* the kinds of import: [id, name, can, fields [key, label, required, header words], example rows] */
const KINDS = [
  ["items", "الأصناف وأرصدة أول المدة", () => can("io", "i") && can("items", "a")],
  ["cust", "العملاء", () => isTop() || can("customers", "a"), [["name", "اسم العميل", 1, ["الاسم", "العميل", "name", "customer"]], ["phone", "الموبايل", 0, ["موبايل", "تليفون", "تلفون", "هاتف", "phone", "mobile", "رقم"]],
      ["area", "المنطقة", 0, ["منطقة", "الحي", "area"]], ["address", "العنوان", 0, ["عنوان", "address"]], ["birthday", "تاريخ الميلاد", 0, ["ميلاد", "birthday", "birth"]], ["notes", "ملاحظات", 0, ["ملاحظة", "notes"]]],
    [["منى حسن", "01001234567", "المعادي", "شارع ٩", "1990-05-21", ""], ["أحمد علي", "01112223334", "مدينة نصر", "", "", "عميل جملة"]],
    "العميل الموجود بنفس الموبايل بيتحدّث، والجديد بيتضاف. اللي من غير موبايل بيتضاف عميل جديد. نقاط الولاء مش بتتستورد."],
  ["sup", "الموردين وأرصدتهم", () => isTop() || can("suppliers", "a"), [["name", "اسم المورد", 1, ["المورد", "الاسم", "name", "supplier"]], ["kind", "النوع (آجل / كاش / أمانة)", 0, ["النوع", "kind", "type"]],
      ["contact", "المسؤول", 0, ["مسؤول", "contact"]], ["phone", "التليفون", 0, ["تليفون", "موبايل", "phone"]], ["terms_days", "مدة السداد (يوم)", 0, ["مدة السداد", "مدة", "terms"]],
      ["credit_limit", "حد الائتمان", 0, ["حد الائتمان", "ائتمان", "limit"]], ["opening_balance", "رصيد أول المدة (علينا له)", 0, ["رصيد", "opening", "balance"]], ["opening_date", "تاريخ الرصيد", 0, ["تاريخ", "date"]], ["bank_info", "بيانات البنك", 0, ["بنك", "bank", "حساب"]]],
    [["شركة النور للأدوات", "آجل", "أ. سامح", "01001112223", 45, 200000, 35000, "2026-01-01", ""], ["مصنع الأمل", "كاش", "", "", 0, 0, 0, "", ""]],
    "المورد الموجود بنفس الاسم بيتحدّث. رصيد أول المدة بيتسجّل للمورد الجديد بس (اللي علينا له في التاريخ ده) وبيتقيّد في الحسابات لوحده، ورصيد مورد موجود مش بيتغير من الاستيراد."],
  ["price", "تحديث الأسعار", () => isTop() || has("prices") || S.sess.role.id === "dataentry", [["code", "الكود أو الباركود", 0, ["كود", "باركود", "code", "barcode", "sku"]], ["name", "اسم الصنف", 0, ["الصنف", "الاسم", "name", "item"]],
      ["sale_price", "سعر البيع الجديد", 1, ["السعر الجديد", "سعر البيع", "السعر", "price"]], ["reason", "السبب", 0, ["سبب", "reason"]]],
    [["IT-00001", "طقم حلل جرانيت ١٠ قطع", 4400, "زيادة المورد"], ["6221234567890", "", 1250, ""]],
    "الصنف بيتعرف بالكود أو الباركود أو الكود الإضافي، ولو مفيش بالاسم بالظبط. كل تغيير سعر بيتسجّل في سجل التدقيق بالسعر القديم والجديد."],
  ["pur", "فاتورة شراء", () => isTop() || can("suppliers", "a"), [["code", "الكود أو الباركود", 0, ["كود", "باركود", "code", "barcode", "sku"]], ["name", "اسم الصنف", 0, ["الصنف", "الاسم", "name", "item", "البيان"]],
      ["qty", "الكمية", 1, ["كمية", "العدد", "qty", "quantity"]], ["unit_cost", "تكلفة الوحدة", 0, ["سعر", "تكلفة", "cost", "price"]], ["serials", "المسلسلات (مفصولة بفاصلة)", 0, ["مسلسل", "serial"]]],
    [["IT-00001", "", 10, 2850, ""], ["", "غسالة ٧ كيلو", 2, 15800, "SN-101, SN-102"]],
    "الفاتورة بتتحمّل في شاشة فاتورة الشراء العادية — بتراجعها وتعدّل فيها وبعدين «حفظ واستلام»."]
];
const kind = () => KINDS.find(k => k[0] === (S.impK || "items")) || KINDS[0];
const tabs = () => { const L = KINDS.filter(k => k[2]()); return L.length > 1 ? `<div class="tabs rise" style="margin-bottom:14px;flex-wrap:wrap">${L.map(k => `<button data-act="imK" data-k="${k[0]}" class="${kind()[0] === k[0] ? "on" : ""}">${k[1]}</button>`).join("")}</div>` : ""; };

/* cell → text the server understands: Excel date serials and d/m/yyyy to yyyy-mm-dd, Arabic digits to Latin */
const latin = v => String(v).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d));
const toDate = v => {
  if (v === "" || v == null) return "";
  if (typeof v === "number" && v > 1000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
  const s = latin(v).trim(); let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;   // day first, as in Egypt
  return s;
};
const DATES = ["birthday", "opening_date"], NUMS = ["terms_days", "credit_limit", "opening_balance", "sale_price", "qty", "unit_cost"];
function rows() {
  const I = S.im, F = kind()[3];
  return I.rows.map(r => { const o = {}; F.forEach(([k]) => { const i = I.map[k]; let v = i >= 0 ? r[i] : ""; if (v == null) v = "";
    if (DATES.includes(k)) v = toDate(v); else if (NUMS.includes(k)) v = latin(v).replace(/[٬\s]/g, "").replace(/٫/g, "."); else v = latin(String(v)).trim();
    if (k === "code" || k === "phone") v = String(v).replace(/\.0$/, "");
    if (v !== "") o[k] = String(v); }); return o; });
}

/* ---------- screen ---------- */
if (V.io) {
  const prevIo = V.io;
  V.io = () => {
    const K = kind();
    if (!K[2]()) { const first = KINDS.find(k => k[2]()); if (first) S.impK = first[0]; }
    if (kind()[0] === "items") { const h = prevIo(), i = h.indexOf('<div class="card'); return i > 0 ? h.slice(0, i) + tabs() + h.slice(i) : h + tabs(); }
    return own();
  };
}
function own() {
  const K = kind(), I = S.im && S.im.k === K[0] ? S.im : null;
  let h = header(`<button class="btn sm" data-act="imTpl">تنزيل قالب Excel</button>`) + tabs();
  h += `<div class="card lux rise"><h3>١ · اختار ملف ${esc(K[1])}</h3><p class="muted" style="margin-top:0">Excel أو CSV، بأي ترتيب أعمدة. أول صف لازم يكون عناوين الأعمدة.</p><input type="file" id="imFile" class="inp" accept=".xlsx,.xls,.csv">${I ? `<div class="dim" style="margin-top:6px">${esc(I.file)} · ${num(I.rows.length)} صف</div>` : ""}<p class="dim" style="font-size:12.5px;margin-bottom:0">${esc(K[5])}</p></div>`;
  if (!I) return h;
  h += `<div class="card rise"><h3>٢ · اربط أعمدة الملف بالحقول</h3>${K[3].map(([k, n, req]) => `<div class="maprow"><b>${n}${req ? ` <span class="req">*</span>` : ""}</b><select class="inp" data-imap="${k}"><option value="-1">— مش موجود —</option>${I.heads.map((x, i) => `<option value="${i}" ${I.map[k] === i ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>`).join("")}
    ${K[0] === "pur" ? purHead() : ""}
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn" data-act="imDry">٣ · تجربة من غير حفظ</button></div></div>`;
  if (I.res) h += resCard(K, I.res);
  return h;
}
function purHead() {
  const P = S.im.pur || (S.im.pur = { supplier_id: "", location_id: S.sess.staff.location_id || (S.locs.find(l => l.kind === "warehouse") || S.locs[0]).id, supplier_ref: "", inv_date: M.today() }), sups = (S.sup && S.sup.sups || []).filter(s => s.active);
  return `<div class="grid g2" style="margin-top:12px"><div class="field"><label>المورد</label><select class="inp" id="imSup"><option value="">— اختار —</option>${sups.map(s => `<option value="${s.id}" ${+P.supplier_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
    <div class="field"><label>المكان اللي استلم</label><select class="inp" id="imLoc">${S.locs.filter(l => myLoc(l.id)).map(l => `<option value="${l.id}" ${+P.location_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
    <div class="field"><label>رقم فاتورة المورد</label><input class="inp" id="imRef" value="${esc(P.supplier_ref)}"></div><div class="field"><label>التاريخ</label><input class="inp" type="date" id="imDate" value="${P.inv_date}" max="${M.today()}"></div></div>`;
}
function errTable(errs) {
  return `<div class="tw" style="margin-top:10px"><table><thead><tr><th class="n">الصف في الملف</th><th>الاسم</th><th>المشكلة</th></tr></thead><tbody>${errs.slice(0, 300).map(e => `<tr><td class="n">${num(e.row + 1)}</td><td>${esc(e.name || "—")}</td><td><ul class="errlist" style="margin:0;padding-inline-start:16px">${e.errs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></td></tr>`).join("")}</tbody></table></div>${errs.length > 300 ? `<p class="dim">وفيه ${num(errs.length - 300)} صف تاني فيهم مشاكل.</p>` : ""}`;
}
function resCard(K, r) {
  const bad = r.errors.length;
  let h = `<div class="card rise ${bad ? "" : "lux"}"><h3>نتيجة التجربة</h3><div class="row" style="gap:8px;flex-wrap:wrap">`;
  if (K[0] === "price") h += chip(num(r.changed) + " سعر هيتغير", "ok") + chip(num(r.same) + " نفس السعر", "plain");
  else if (K[0] === "pur") h += chip(num(r.lines.length) + " سطر جاهز", "ok");
  else h += chip(num(r.new) + " جديد", "ok") + chip(num(r.updated) + " تحديث", "info");
  h += chip(num(bad) + " صف فيه مشكلة", bad ? "bad" : "plain") + `</div>`;
  if (K[0] === "sup" && +r.opening_total) h += `<p class="muted" style="margin:8px 0 0">إجمالي أرصدة أول المدة للموردين الجداد: <b class="num">${fmt(r.opening_total)}</b> — بتتقيّد في الحسابات لوحدها.</p>`;
  if (K[0] === "price" && r.below_cost && r.below_cost.length) h += `<div class="warnbox" style="margin-top:10px"><b>${num(r.below_cost.length)} صنف السعر الجديد بتاعهم أقل من آخر تكلفة</b> — اتأكد إن ده مقصود:<br>${r.below_cost.slice(0, 15).map(w => `${esc(w.name)}: ${fmt(w.new)} والتكلفة ${fmt(w.cost)}`).join("<br>")}</div>`;
  if (K[0] === "pur" && r.total != null && seeCost()) h += `<p class="muted" style="margin:8px 0 0">إجمالي الفاتورة: <b class="num">${fmt(r.total)}</b></p>`;
  if (bad) h += `<div class="warnbox" style="margin-top:10px">صلّح الصفوف دي في الملف وارفعه تاني، أو شيلها. الحفظ بيحصل بس لما الملف كله يبقى سليم — مفيش حاجة بتتحفظ نص نص.</div>` + errTable(r.errors);
  else h += `<div class="okbox" style="margin-top:10px">مفيش مشاكل.</div><button class="btn gold" style="margin-top:10px" data-act="imGo">${K[0] === "pur" ? "٤ · فتح الفاتورة للمراجعة والحفظ" : "٤ · حفظ"}</button>`;
  return h + `</div>`;
}

/* ---------- purchase invoice: checked here, then handed to the normal purchase screen ---------- */
function purCheck() {
  const out = { lines: [], errors: [], total: 0 }, seen = new Set(), sc = seeCost();
  rows().forEach((o, i) => { const e = []; let it = null;
    if (o.code) it = M.byCode(o.code);
    if (!it && o.name) { const L = S.items.filter(x => norm(x.name) === norm(o.name)); if (L.length === 1) it = L[0]; else if (L.length > 1) e.push("فيه أكتر من صنف بنفس الاسم — استخدم الكود"); }
    if (!it && !e.length) e.push(o.code || o.name ? "الصنف مش موجود — ضيفه الأول من شاشة الأصناف" : "الكود والاسم فاضيين");
    const qy = +o.qty; if (!(qy > 0)) e.push("الكمية لازم تكون أكبر من صفر");
    let uc = o.unit_cost !== undefined ? +o.unit_cost : null; if (uc != null && !(uc >= 0)) e.push("تكلفة الوحدة لازم تكون رقم");
    if (sc && uc == null && it) uc = +it.last_cost;
    if (it && seen.has(it.id)) e.push("الصنف ده متكرر في الملف — اجمع الكمية في سطر واحد"); if (it) seen.add(it.id);
    const sn = o.serials ? o.serials.split(/[,،;\n]/).map(x => x.trim()).filter(Boolean) : [];
    if (it && it.serial_required) { if (qy % 1) e.push("صنف بمسلسل — الكمية لازم تكون عدد صحيح"); else if (sn.length && sn.length !== qy) e.push(`عدد المسلسلات (${sn.length}) مش قد الكمية (${qy})`); }
    if (e.length) return out.errors.push({ row: i + 1, name: it ? it.name : o.name || o.code, errs: e });
    const l = { item_id: it.id, qty: qy, unit_cost: sc ? uc : +it.last_cost }; if (it.serial_required) l.serials = sn; out.lines.push(l); out.total += l.qty * l.unit_cost; });
  return out;
}

H.io = (prevH => () => {
  if (kind()[0] === "items") { if (prevH) prevH(); return; }
  const f = $("#imFile");
  if (f) f.onchange = async e => {
    const fl = e.target.files[0]; if (!fl) return;
    try {
      const wb = XLSX.read(await fl.arrayBuffer(), { type: "array" }), ws = wb.Sheets[wb.SheetNames[0]], aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).filter(r => r.some(c => String(c).trim() !== ""));
      if (aoa.length < 2) return toast("الملف فاضي أو مفيهوش غير العناوين.", true);
      const heads = aoa[0].map(x => String(x).trim()), map = {}, used = new Set();
      kind()[3].forEach(([k, n, , keys]) => { let i = heads.findIndex((hh, j) => !used.has(j) && [n, ...keys].some(w => norm(hh) === norm(w))); if (i < 0) i = heads.findIndex((hh, j) => !used.has(j) && keys.some(w => norm(hh).includes(norm(w)))); map[k] = i; if (i >= 0) used.add(i); });
      S.im = { k: kind()[0], file: fl.name, heads, rows: aoa.slice(1), map, res: null };
      if (kind()[0] === "pur" && !S.sup) { try { await M.loadSup(); } catch (er) { /* the list stays empty; the error shows on the screen */ } }
      render();
    } catch (er) { toast("مش قادر يقرا الملف: " + er.message, true); }
  };
  document.querySelectorAll("[data-imap]").forEach(s => s.onchange = () => { S.im.map[s.dataset.imap] = +s.value; S.im.res = null; render(); });
  const P = S.im && S.im.pur, bind = (id, k) => { const el = $(id); if (el && P) el.onchange = () => { P[k] = el.value; }; };
  bind("#imSup", "supplier_id"); bind("#imLoc", "location_id"); bind("#imRef", "supplier_ref"); bind("#imDate", "inv_date");
})(H.io);

async function run(commit, btn) {
  const K = kind(), I = S.im;
  const miss = K[3].filter(([k, , req]) => req && !(I.map[k] >= 0)); if (miss.length) return toast("اربط الأعمدة الإلزامية: " + miss.map(x => x[1]).join("، "), true);
  if ((K[0] === "price" || K[0] === "pur") && !(I.map.code >= 0) && !(I.map.name >= 0)) return toast("اربط عمود الكود أو الباركود أو اسم الصنف.", true);
  if (K[0] === "pur") {
    if (commit) return openPurchase();
    I.res = purCheck(); render(); return;
  }
  busy(btn, true);
  try {
    const fn = { cust: "customers_import", sup: "suppliers_import", price: "prices_import" }[K[0]];
    const r = await rpc(fn, { p_token: T(), p_rows: rows(), p_commit: commit });
    if (commit) {
      toast(K[0] === "price" ? `اتغير سعر ${num(r.changed)} صنف.` : `اتحفظ: ${num(r.new)} جديد · ${num(r.updated)} تحديث.`);
      S.im = null;
      if (K[0] === "price") { await loadItems(); go("items"); } else if (K[0] === "sup") { S.sup = null; go("suppliers"); } else { go("customers"); }
      return;
    }
    I.res = r; render();
  } catch (er) { toast(errText(er), true); busy(btn, false); }
}
async function openPurchase() {
  const I = S.im, P = I.pur, r = purCheck();
  if (r.errors.length) { I.res = r; render(); return; }
  if (!P.supplier_id) return toast("اختار المورد.", true);
  if (!S.sup) await M.loadSup();
  S.pur = { supplier_id: +P.supplier_id, location_id: +P.location_id, supplier_ref: P.supplier_ref || "", inv_date: P.inv_date || M.today(), discount: 0, lines: r.lines };
  S.im = null; go("suppliers"); setTimeout(() => M.purDraw(), 60);
  toast("الفاتورة اتحمّلت — راجعها ودوس «حفظ واستلام».");
}

const prev = window.MZX;
window.MZX = async function (k, a) {
  if (k === "imK") { S.impK = a.dataset.k; S.im = null; render(); return true; }
  if (k === "imDry") { run(false, a); return true; }
  if (k === "imGo") { run(true, a); return true; }
  if (k === "imTpl") {
    const K = kind(), H0 = K[3].map(f => f[1]), ws = XLSX.utils.aoa_to_sheet([H0, ...K[4]]); ws["!views"] = [{ RTL: true }]; ws["!cols"] = H0.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, K[1].slice(0, 30)); XLSX.writeFile(wb, `قالب-استيراد-${K[1].replace(/\s+/g, "-")}.xlsx`); return true;
  }
  return prev ? prev(k, a) : false;
};
})();
