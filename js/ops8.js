/* SYS Minzo · stock count & purchase suggestions (batch 8).
   Counting is blind: the counting screen never shows the system quantity. Built on window.MZ; every write goes through a server function. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, norm, rpc, T, can, locName, toast, modal, closeModal, busy, render, errText, header, loadItems, loadDir, UNITS, xlsOut } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const isMgr = () => isTop() || can("stock", "a");
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const tm = x => x ? new Date(x).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const itemBy = id => S.items.find(i => i.id === id);
const later = (fn, r) => { setTimeout(() => fn().then(() => S.route === r && render()).catch(e => toast(errText(e), true)), 0); return `<div class="spin"></div>`; };

/* =====================================================================
   screen
   ===================================================================== */
async function loadSt() {
  const C = S.st || (S.st = {});
  const [mine, list] = await Promise.all([rpc("stocktake_my", { p_token: T() }), isMgr() ? rpc("stocktakes_list", { p_token: T() }) : Promise.resolve([])]);
  S.stkMine = mine || []; C.list = list || []; C.loaded = true;
  C.cur = C.cur && S.stkMine.find(x => x.id === C.cur.id) ? S.stkMine.find(x => x.id === C.cur.id) : S.stkMine[0] || null;
  if (C.cur) C.mine = await rpc("stocktake_my_entries", { p_token: T(), p_st: C.cur.id });
}
V.count = () => {
  const C = S.st; if (!C || !C.loaded) return header() + later(loadSt, "count");
  if (C.review) return reviewView(C.review);
  let h = header(isMgr() ? `<button class="btn gold" data-act="stNew">بدء جرد</button>` : "");
  // ---- counting panel (staff in the count, owner, GM)
  if (S.stkMine.length) {
    const cur = C.cur, pend = C.pick;
    h += `${S.stkMine.length > 1 ? `<div class="tabs rise">${S.stkMine.map(x => `<button data-act="stPick" data-id="${x.id}" class="${cur && cur.id === x.id ? "on" : ""}">${esc(x.no)} · ${esc(locName(x.loc))}</button>`).join("")}</div>` : ""}
      <div class="card lux rise" style="max-width:640px"><h3 style="margin-top:0">جرد ${esc(cur.no)} · ${esc(locName(cur.loc))}${cur.round > 1 ? ` ${chip("إعادة عدّ — جولة " + cur.round, "warn")}` : ""}</h3>
       <p class="dim" style="margin:-4px 0 10px;font-size:12.5px">امسح كود الصنف أو اكتبه، وبعدين اكتب العدد اللي قدامك في المكان ده بس. ${cur.round > 1 ? "المطلوب تعدّ الأصناف اللي تحت بس." : ""}</p>
       <div class="row" style="gap:8px;flex-wrap:nowrap"><input class="inp num" id="stCode" placeholder="الباركود أو الكود (مصري / صيني)" autocomplete="off" style="flex:1;font-size:17px;padding:12px"><button class="btn" data-act="stCam" title="امسح بالكاميرا">📷</button></div>
       ${pend ? `<div class="card" style="margin-top:10px;padding:12px;border-color:var(--gold)"><div style="font-size:17px;font-weight:700">${esc(pend.name)}</div><div class="dim num" style="font-size:12.5px">${esc(pend.code)} · ${esc(UNITS[pend.unit] || "")}</div>
         <div class="row" style="gap:8px;margin-top:10px;flex-wrap:nowrap;align-items:center"><button class="btn" data-act="stDec" style="font-size:20px;width:52px">−</button><input class="inp num" id="stQty" type="number" min="0" step="${pend.unit === "meter" ? "0.1" : "1"}" value="${pend.qty}" style="text-align:center;font-size:22px;flex:1"><button class="btn" data-act="stInc" style="font-size:20px;width:52px">+</button></div>
         <div class="row" style="gap:8px;margin-top:10px"><button class="btn ghost" data-act="stDrop">إلغاء</button><button class="btn gold" style="flex:1;font-size:16px" data-act="stkSave">تسجيل العدد</button></div></div>` : ""}
       <div id="stErr"></div>
       ${cur.round > 1 && cur.recount ? `<div style="margin-top:12px"><b>الأصناف المطلوب إعادة عدّها (${cur.recount.length})</b><div class="row" style="gap:4px;flex-wrap:wrap;margin-top:6px">${cur.recount.map(id => { const it = itemBy(id) || { name: "—" }; const done = (C.mine || []).some(e => e.item_id === id); return chip((done ? "✓ " : "") + it.name, done ? "ok" : "plain"); }).join("")}</div></div>` : ""}
       <h3 style="margin:16px 0 6px">اللي سجّلته <span class="dim" style="font-size:12.5px;font-weight:400">(${(C.mine || []).length})</span></h3>
       <div class="tw" style="max-height:340px;overflow:auto"><table><tbody>${(C.mine || []).map(e => { const it = itemBy(e.item_id) || { name: "—", code: "" }; return `<tr><td>${esc(it.name)}<br><span class="dim num" style="font-size:12px">${esc(it.code)}</span></td><td class="n" style="font-size:16px"><b>${num(e.qty)}</b></td><td class="dim" style="font-size:12px">${tm(e.at)}</td><td><button class="btn sm ghost" data-act="stDel" data-id="${e.id}">مسح</button></td></tr>`; }).join("") || `<tr><td class="muted">لسه ما سجّلتش حاجة.</td></tr>`}</tbody></table></div></div>`;
  } else if (!isMgr()) h += `<div class="card rise"><p class="muted" style="margin:0">مفيش جرد مفتوح ليك دلوقتي.</p></div>`;
  // ---- manager list
  if (isMgr()) {
    const ST = { open: ["العدّ شغّال", "info"], review: ["مستني المراجعة", "warn"], posted: ["اتسوّى", "ok"], cancelled: ["اتلغى", "plain"] };
    h += `<div class="tw rise"><table><thead><tr><th>الجرد</th><th>المكان</th><th>اللي بيعدّوا</th><th class="n">تسجيلات</th><th class="n">أصناف</th><th>الحالة</th><th class="n">عجز</th><th class="n">زيادة</th><th></th></tr></thead><tbody>${C.list.map(t => `<tr><td class="num">${esc(t.no)}<br><span class="dim" style="font-size:12px">${tm(t.started_at)} · ${esc(t.by || "")}</span></td><td>${esc(locName(t.loc))}</td><td style="font-size:12.5px">${esc((t.counters || []).join("، "))}</td><td class="n">${num(t.entries)}</td><td class="n">${num(t.items)}</td><td>${chip(ST[t.status][0], ST[t.status][1])}${t.round > 1 && t.status !== "posted" ? `<br><span class="dim" style="font-size:12px">جولة ${t.round}</span>` : ""}</td>
       <td class="n" style="color:var(--bad)">${t.status === "posted" ? fmt(-t.short_value, 1) : "—"}</td><td class="n" style="color:var(--ok)">${t.status === "posted" ? fmt(t.over_value, 1) : "—"}</td>
       <td style="white-space:nowrap">${t.status === "open" ? `<button class="btn sm gold" data-act="stEnd" data-id="${t.id}">إنهاء العدّ</button>` : ""}${t.status !== "cancelled" ? `<button class="btn sm ${t.status === "review" ? "gold" : "ghost"}" data-act="stRev" data-id="${t.id}">${t.status === "posted" ? "النتيجة" : "مراجعة"}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">لسه مفيش جرد. دوس «بدء جرد» واختار المكان والموظفين.</td></tr>`}</tbody></table></div>
      <p class="dim rise" style="font-size:12.5px">الموظفين اللي بتختارهم بس هم اللي بتظهرلهم شاشة الجرد لحد ما تنهيه. البيع والتحويلات شغّالين عادي، والسيستم بيحسب الفرق على وقت عدّ كل صنف.</p>`;
  }
  return h;
};
H.count = () => {
  const ci = $("#stCode"); if (!ci) return;
  if (!$("#stQty")) ci.focus();
  ci.onkeydown = e => { if (e.key !== "Enter") return; const v = ci.value.trim(); if (!v) return; stFind(v); };
  const q = $("#stQty"); if (q) { q.focus(); q.select(); q.onkeydown = e => { if (e.key === "Enter") document.querySelector("[data-act=stkSave]").click(); }; }
};
function stFind(v) {
  const it = M.byCode(v); const C = S.st;
  if (!it) { errBox("#stErr", "مفيش صنف بالكود ده: " + v); return; }
  if (C.cur.round > 1 && C.cur.recount && !C.cur.recount.includes(it.id)) { errBox("#stErr", "NOT_IN_RECOUNT"); return; }
  C.pick = { id: it.id, name: it.name, code: it.code, unit: it.unit, qty: 1 }; render();
}

/* ---------- camera scanning (phones with Chrome) ---------- */
async function camScan() {
  if (!("BarcodeDetector" in window) || !navigator.mediaDevices) return toast("الكاميرا مش مدعومة على المتصفح ده — استخدم Chrome على الموبايل، أو اكتب الكود.", true);
  let stream; try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); } catch (e) { return toast("مفيش إذن للكاميرا.", true); }
  modal(`<h2>امسح الباركود</h2><video id="camV" playsinline muted style="width:100%;border-radius:10px;background:#000"></video><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn ghost" data-act="camStop">قفل</button></div>`);
  const v = $("#camV"); v.srcObject = stream; await v.play().catch(() => {});
  const det = new BarcodeDetector({ formats: ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code", "itf"] });
  S._cam = { stream, on: true };
  const stop = () => { S._cam.on = false; stream.getTracks().forEach(t => t.stop()); };
  S._cam.stop = stop;
  const tick = async () => { if (!S._cam.on || !$("#camV")) { stop(); return; }
    try { const r = await det.detect(v); if (r && r.length) { const code = r[0].rawValue; stop(); closeModal(); if (navigator.vibrate) navigator.vibrate(80); stFind(code); return; } } catch (e) {}
    setTimeout(tick, 250); };
  tick();
}

/* ---------- start ---------- */
async function stNewModal() {
  const dir = await loadDir().catch(() => []);
  const locs = S.locs.filter(l => l.active !== false);
  const drawStaff = loc => (dir || []).filter(x => x.active && (!x.location_id || !loc || x.location_id === +loc));
  modal(`<h2>بدء جرد</h2><p class="muted" style="margin:0 0 10px">اختار المكان والموظفين اللي هيعدّوا. شاشة الجرد هتظهرلهم هم بس لحد ما تدوس «إنهاء العدّ».</p><div class="stack">
    <div class="field"><label>المكان</label><select class="inp" id="snL">${locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
    <div class="field"><label>الموظفين</label><div id="snS" class="stack" style="gap:4px;max-height:240px;overflow:auto"></div></div>
    <div class="field"><label>ملاحظة</label><input class="inp" id="snN" placeholder="مثال: جرد نص السنة"></div><div id="snErr"></div>
    <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="stStart">ابدأ الجرد</button></div></div>`);
  const fill = () => { $("#snS").innerHTML = drawStaff($("#snL").value).map(x => `<label class="row" style="gap:8px"><input type="checkbox" data-sn="${x.id}" ${x.id === S.sess.staff.id ? "checked" : ""}> ${esc(x.name)} <span class="dim" style="font-size:12px">${esc((x.role_name || x.role_id || ""))}</span></label>`).join("") || `<span class="muted">مفيش موظفين في المكان ده.</span>`; };
  $("#snL").onchange = fill; fill();
}

/* =====================================================================
   review
   ===================================================================== */
const decOf = (R, l) => R.dec[l.item_id] || (l.counted == null ? "skip" : +l.staff_n > 1 ? "" : "sum");
const usedOf = (l, d) => d === "sum" ? +l.counted : d === "max" ? Math.max(...(l.by_staff || []).map(x => +x.qty)) : d === "zero" ? 0 : null;
function calc(R, l) {
  if (l.decision) return { exp: +l.expected, used: l.used == null ? null : +l.used, v: +l.variance, val: +l.value };
  const d = decOf(R, l), used = d ? usedOf(l, d) : null, exp = +l.now - +l.after, v = used == null || l.serial ? 0 : used - exp;
  return { exp, used, v, val: Math.round(v * +l.cost * 100) / 100, d };
}
async function openReview(id) { const r = await rpc("stocktake_review", { p_token: T(), p_st: id }); S.st.review = { id, data: r, tab: "diff", dec: {} }; render(); }
function reviewView(R) {
  const t = R.data.stocktake, posted = t.status === "posted", L = R.data.lines || [];
  const rows = L.map(l => ({ l, c: calc(R, l) }));
  const multi = rows.filter(x => +x.l.staff_n > 1), unc = rows.filter(x => x.l.counted == null), diff = rows.filter(x => x.c.v !== 0 || (!posted && +x.l.staff_n > 1 && !R.dec[x.l.item_id]));
  const short = rows.reduce((a, x) => a + Math.min(0, x.c.val), 0), over = rows.reduce((a, x) => a + Math.max(0, x.c.val), 0);
  const tabs = [["diff", `الفروق (${diff.length})`], ["multi", `اتعدّ من أكتر من موظف (${multi.length})`], ["unc", `ما اتعدّش (${unc.length})`], ["all", `الكل (${rows.length})`]];
  const show = R.tab === "multi" ? multi : R.tab === "unc" ? unc : R.tab === "all" ? rows : diff;
  let h = `<div class="ph"><div><div class="eyebrow">${esc(locName(t.location_id))} · ${esc(t.no)}</div><h1>${posted ? "نتيجة الجرد" : "مراجعة الجرد"}</h1></div><div class="acts"><button class="btn" data-act="stXls">Excel</button><button class="btn ghost" data-act="stBack">رجوع</button></div></div>`;
  h += `<div class="grid g4">${[["أصناف اتعدّت", num(rows.filter(x => x.l.counted != null).length), "lux"], ["ليها رصيد وما اتعدّتش", num(unc.length)], ["قيمة العجز", fmt(-short, 1), "", "var(--bad)"], ["قيمة الزيادة", fmt(over, 1), "", "var(--ok)"]].map((k, i) => `<div class="card kpi rise ${k[2] || ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val" style="${k[3] ? "color:" + k[3] : ""}">${k[1]}</div></div>`).join("")}</div>`;
  if (!posted && t.status === "open") h += `<div class="warnbox rise">العدّ لسه شغّال (جولة ${t.round}) — الأرقام دي لحد دلوقتي. <button class="btn sm gold" data-act="stEnd" data-id="${t.id}">إنهاء العدّ</button></div>`;
  h += `<div class="tabs rise">${tabs.map(([k, n]) => `<button data-act="stTab" data-k="${k}" class="${R.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الصنف</th><th class="n">السيستم وقت العدّ</th><th class="n">اتعدّ</th><th>مين عدّ</th>${posted ? "" : "<th>هيتحسب</th>"}<th class="n">الفرق</th><th class="n">القيمة</th></tr></thead><tbody>${show.map(({ l, c }) => `<tr>
     <td>${esc(l.name)}<br><span class="dim num" style="font-size:12px">${esc(l.code)}${+l.after ? ` · اتحرك بعد العدّ ${num(l.after)}` : ""}${l.serial ? " · بمسلسل: سوّيه يدوي" : ""}</span></td>
     <td class="n">${num(c.exp)}</td><td class="n"><b>${l.counted == null ? "—" : num(l.counted)}</b></td>
     <td style="font-size:12px">${(l.entries || []).map(e => `${esc(e.staff || "—")}: <b class="num">${num(e.qty)}</b> <span class="dim">${tm(e.at)}</span>`).join("<br>") || "—"}</td>
     ${posted ? "" : `<td>${l.counted == null ? `<select class="inp" style="padding:4px 6px;font-size:12.5px" data-dec="${l.item_id}"><option value="skip" ${c.d === "skip" ? "selected" : ""}>سيبه زي ما هو</option><option value="zero" ${c.d === "zero" ? "selected" : ""}>رصيده صفر</option></select>`
        : +l.staff_n > 1 ? `<select class="inp" style="padding:4px 6px;font-size:12.5px;${c.d ? "" : "border-color:var(--bad)"}" data-dec="${l.item_id}"><option value="">— اختار —</option><option value="sum" ${c.d === "sum" ? "selected" : ""}>اجمعهم (${num(l.counted)})</option><option value="max" ${c.d === "max" ? "selected" : ""}>مكرر — خد الأكبر</option><option value="skip" ${c.d === "skip" ? "selected" : ""}>سيبه</option></select>`
        : `<select class="inp" style="padding:4px 6px;font-size:12.5px" data-dec="${l.item_id}"><option value="sum" ${c.d === "sum" ? "selected" : ""}>العدد ده</option><option value="skip" ${c.d === "skip" ? "selected" : ""}>سيبه</option></select>`}</td>`}
     <td class="n" style="color:${c.v < 0 ? "var(--bad)" : c.v > 0 ? "var(--ok)" : "inherit"}">${c.used == null && !posted ? "—" : (c.v > 0 ? "+" : "") + num(c.v)}</td><td class="n">${c.val ? fmt(c.val, 1) : "—"}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">مفيش أصناف هنا.</td></tr>`}</tbody></table></div>`;
  if (!posted) h += `<div id="srErr"></div><div class="row rise" style="gap:8px;flex-wrap:wrap;justify-content:flex-end">
      <button class="btn ghost danger" data-act="stCancel">إلغاء الجرد</button>${t.status === "review" ? `<button class="btn" data-act="stReopen">رجوع للعدّ</button><button class="btn" data-act="stRecount">إعادة عدّ الفروق (${rows.filter(x => x.c.v !== 0 || (+x.l.staff_n > 1 && !R.dec[x.l.item_id])).filter(x => x.l.counted != null).length})</button><button class="btn gold" data-act="stPost">اعتماد وتسوية الرصيد</button>` : ""}</div>
      <p class="dim" style="font-size:12.5px">«السيستم وقت العدّ» = الرصيد دلوقتي بعد ما نشيل أي بيع أو تحويل حصل بعد عدّ الصنف. المخزون مش هيتغير غير لما تدوس «اعتماد وتسوية». الأصناف اللي بمسلسل بتظهر فروقها بس، وتتسوّى من شاشة المخزون بالمسلسل.</p>`;
  return h;
}
H.count_review = null;

/* =====================================================================
   purchase suggestions (a button on the suppliers screen)
   ===================================================================== */
async function suggestModal(cover, win, loc) {
  S._sg = { cover: cover || 30, win: win || 60, loc: loc || "" };
  modal(`<h2>اقتراح طلبات الشراء</h2><div class="spin"></div>`);
  try {
    const rows = await rpc("purchase_suggest", { p_token: T(), p_cover: S._sg.cover, p_window: S._sg.win, p_loc: S._sg.loc ? +S._sg.loc : null });
    S._sg.rows = rows || [];
    const groups = {}; S._sg.rows.forEach(r => { const k = r.supplier || "من غير مورد"; (groups[k] = groups[k] || []).push(r); });
    const tot = rs => rs.reduce((a, r) => a + +r.suggest * (+r.last_cost || 0), 0);
    modal(`<h2>اقتراح طلبات الشراء</h2><p class="muted" style="margin:0 0 10px">على حسب البيع في آخر ${S._sg.win} يوم: يكفّي ${S._sg.cover} يوم + الحد الأدنى، ناقص اللي في المخزون.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px"><div class="field" style="width:120px"><label>يكفّي كام يوم</label><input class="inp num" type="number" min="1" id="sgC" value="${S._sg.cover}"></div><div class="field" style="width:130px"><label>البيع في آخر (يوم)</label><input class="inp num" type="number" min="7" id="sgW" value="${S._sg.win}"></div>
        <div class="field" style="min-width:150px"><label>المكان</label><select class="inp" id="sgL"><option value="">كل الأماكن</option>${S.locs.map(l => `<option value="${l.id}" ${String(S._sg.loc) === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div><button class="btn" data-act="sgGo">احسب</button><button class="btn" data-act="sgXls">Excel</button></div>
      ${Object.keys(groups).length ? Object.entries(groups).map(([sup, rs]) => `<div class="card" style="padding:10px;margin-bottom:10px"><div class="row between"><b>${esc(sup)}</b><span class="dim">${rs.length} صنف${tot(rs) ? " · حوالي " + fmt(tot(rs)) : ""}</span></div>
        <div class="tw"><table><thead><tr><th>الصنف</th><th class="n">الرصيد</th><th class="n">بيع/يوم</th><th class="n">يكفّي</th><th class="n">اطلب</th><th class="n">آخر سعر</th></tr></thead><tbody>${rs.map(r => `<tr><td>${esc(r.name)}<br><span class="dim num" style="font-size:12px">${esc(r.code)}</span></td><td class="n">${num(r.stock)}</td><td class="n">${num(r.per_day)}</td><td class="n" style="${r.days_left != null && r.days_left < 7 ? "color:var(--bad)" : ""}">${r.days_left == null ? "—" : num(r.days_left) + " يوم"}</td><td class="n"><b>${num(r.suggest)}</b></td><td class="n">${r.last_cost ? fmt(r.last_cost, 1) : "—"}</td></tr>`).join("")}</tbody></table></div></div>`).join("")
        : `<div class="okbox">مفيش أصناف محتاجة تتطلب دلوقتي على حسب البيع والحد الأدنى.</div>`}
      <div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn ghost" data-act="mClose">قفل</button></div>`);
  } catch (e) { modal(`<h2>اقتراح طلبات الشراء</h2><div class="warnbox">${esc(errText(e))}</div><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="mClose">قفل</button></div>`); }
}
const prevSup = V.suppliers;
V.suppliers = () => { const h = prevSup(); const btn = `<div class="row rise" style="justify-content:flex-end;margin-bottom:10px"><button class="btn" data-act="sgOpen">اقتراح طلبات الشراء</button></div>`; const cut = h.indexOf('<div class="grid'); return cut > 0 ? h.slice(0, cut) + btn + h.slice(cut) : h + btn; };

/* =====================================================================
   actions
   ===================================================================== */
const prev = window.MZX;
window.MZX = async function (k, a) {
  const C = S.st || {};
  if (k === "stPick") { C.cur = S.stkMine.find(x => x.id === a.dataset.id); C.pick = null; C.mine = await rpc("stocktake_my_entries", { p_token: T(), p_st: C.cur.id }).catch(() => []); render(); return true; }
  if (k === "stCam") { camScan(); return true; }
  if (k === "camStop") { if (S._cam && S._cam.stop) S._cam.stop(); closeModal(); return true; }
  if (k === "stInc" || k === "stDec") { const q = $("#stQty"), step = C.pick.unit === "meter" ? 0.1 : 1; C.pick.qty = Math.max(0, Math.round(((+q.value || 0) + (k === "stInc" ? step : -step)) * 10) / 10); q.value = C.pick.qty; return true; }
  if (k === "stDrop") { C.pick = null; render(); return true; }
  if (k === "stkSave") { const q = +$("#stQty").value; if (!(q >= 0)) { errBox("#stErr", "BAD_QTY"); return true; }
    busy(a, true);
    try { const r = await rpc("stocktake_count", { p_token: T(), p_st: C.cur.id, p_item: C.pick.id, p_qty: q }); toast(`اتسجّل: ${r.item} — ${num(q)}${+r.mine !== q ? ` (إجمالي عدّك ${num(r.mine)})` : ""}`);
      C.pick = null; C.mine = await rpc("stocktake_my_entries", { p_token: T(), p_st: C.cur.id }); render(); }
    catch (e) { errBox("#stErr", e); busy(a, false); }
    return true; }
  if (k === "stDel") { if (!confirm("تمسح التسجيل ده؟")) return true; try { await rpc("stocktake_entry_delete", { p_token: T(), p_id: +a.dataset.id }); C.mine = await rpc("stocktake_my_entries", { p_token: T(), p_st: C.cur.id }); render(); } catch (e) { toast(errText(e), true); } return true; }
  if (k === "stNew") { stNewModal(); return true; }
  if (k === "stStart") { const staff = [...document.querySelectorAll("[data-sn]:checked")].map(x => x.dataset.sn); busy(a, true);
    try { const r = await rpc("stocktake_start", { p_token: T(), p_loc: +$("#snL").value, p_staff_j: staff, p_note: $("#snN").value.trim() }); closeModal(); toast(`بدأ الجرد ${r.no}.`); S.st.loaded = false; render(); }
    catch (e) { errBox("#snErr", e); busy(a, false); }
    return true; }
  if (k === "stEnd") { if (!confirm("إنهاء العدّ؟ شاشة الجرد هتتقفل عند الموظفين وتقدر تراجع الفروق.")) return true;
    try { await rpc("stocktake_set", { p_token: T(), p_st: a.dataset.id, p_action: "end", p_items_j: null }); if (C.review) await openReview(a.dataset.id); else { S.st.loaded = false; render(); } } catch (e) { toast(errText(e), true); } return true; }
  if (k === "stRev") { busy(a, true); try { await openReview(a.dataset.id); } catch (e) { toast(errText(e), true); busy(a, false); } return true; }
  if (k === "stBack") { C.review = null; C.loaded = false; render(); return true; }
  if (k === "stTab") { C.review.tab = a.dataset.k; render(); return true; }
  if (k === "stReopen" || k === "stCancel" || k === "stRecount") { const R = C.review;
    let items = null;
    if (k === "stRecount") items = (R.data.lines || []).filter(l => l.counted != null && (calc(R, l).v !== 0 || (+l.staff_n > 1 && !R.dec[l.item_id]))).map(l => l.item_id);
    if (!confirm(k === "stCancel" ? "إلغاء الجرد؟ مش هيتغير أي رصيد." : k === "stRecount" ? `هتتفتح جولة عدّ جديدة لـ ${items.length} صنف بس عند نفس الموظفين. موافق؟` : "ترجع العدّ تاني لنفس الجولة؟")) return true;
    try { await rpc("stocktake_set", { p_token: T(), p_st: R.id, p_action: k === "stCancel" ? "cancel" : k === "stRecount" ? "recount" : "reopen", p_items_j: items }); C.review = null; C.loaded = false; toast("تمام."); render(); }
    catch (e) { errBox("#srErr", e); }
    return true; }
  if (k === "stPost") { const R = C.review, need = (R.data.lines || []).filter(l => +l.staff_n > 1 && !R.dec[l.item_id]);
    if (need.length) { errBox("#srErr", `حدّد هتحسب إزاي ${need.length} صنف اتعدّوا من أكتر من موظف (تبويب «اتعدّ من أكتر من موظف»).`); return true; }
    if (!confirm("اعتماد الجرد؟ الرصيد هيتظبط على العدد والفرق هيتسجّل بالتكلفة. الخطوة دي مش بترجع.")) return true;
    busy(a, true);
    try { const r = await rpc("stocktake_post", { p_token: T(), p_st: R.id, p_dec: R.dec }); toast(`اتسوّى ${r.no}: ${num(r.adjusted)} صنف · عجز ${fmt(-r.short, 1)} · زيادة ${fmt(r.over, 1)}`); await loadItems(); await openReview(R.id); }
    catch (e) { errBox("#srErr", e); busy(a, false); }
    return true; }
  if (k === "stXls") { const R = C.review, t = R.data.stocktake;
    xlsOut(`جرد-${t.no}`, "الجرد", [["الصنف", "الكود", "السيستم وقت العدّ", "اتعدّ", "مين عدّ", "الفرق", "القيمة"], ...(R.data.lines || []).map(l => { const c = calc(R, l); return [l.name, l.code, c.exp, l.counted == null ? "" : +l.counted, (l.entries || []).map(e => `${e.staff}: ${e.qty}`).join(" | "), c.v, c.val]; })], [28, 14, 14, 10, 40, 10, 12]);
    return true; }
  if (k === "sgOpen") { suggestModal(); return true; }
  if (k === "sgGo") { suggestModal(+$("#sgC").value, +$("#sgW").value, $("#sgL").value); return true; }
  if (k === "sgXls") { xlsOut("اقتراح-طلبات-الشراء", "طلبات الشراء", [["المورد", "الصنف", "الكود", "الرصيد", "بيع في اليوم", "يكفّي (يوم)", "الكمية المقترحة", "آخر سعر"], ...(S._sg.rows || []).map(r => [r.supplier || "", r.name, r.code, +r.stock, +r.per_day, r.days_left == null ? "" : +r.days_left, +r.suggest, +r.last_cost || ""])], [22, 28, 14, 10, 12, 12, 14, 12]); return true; }
  return prev ? prev(k, a) : false;
};
/* the decision dropdowns in the review */
const prevH = H.count;
H.count = () => { if (prevH) prevH(); document.querySelectorAll("[data-dec]").forEach(x => { x.onchange = () => { if (x.value) S.st.review.dec[x.dataset.dec] = x.value; else delete S.st.review.dec[x.dataset.dec]; render(); }; }); };
})();
