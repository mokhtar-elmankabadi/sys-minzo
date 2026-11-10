/* SYS Minzo · items & sets (batch 6): set pieces, assemble / take apart, and swapping a piece from an invoice.
   Built on window.MZ. Every write goes through a server function. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, $, esc, fmt, num, norm, rpc, T, can, has, locName, toast, modal, closeModal, busy, render, errText, loadItems, PAYN, UNITS } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const itemBy = id => S.items.find(i => i.id === id);
const myLocs = () => S.locs.filter(l => l.active !== false && (S.sess.role.scope_all_locations || l.id === S.sess.device.location_id || ["owner", "gm"].includes(S.sess.role.id)));
/* pick an item by typing its name or any of its codes */
const pickList = (id, excl) => `<datalist id="${id}">${S.items.filter(i => !excl || !excl(i)).slice(0, 3000).map(i => `<option value="${esc(i.code)} · ${esc(i.name)}"></option>`).join("")}</datalist>`;
const pickRead = v => { v = String(v || "").trim(); if (!v) return null; const code = v.split(" · ")[0].trim();
  return M.byCode(code) || S.items.find(i => i.name === v) || S.items.find(i => norm(M.srch(i)).includes(norm(v))) || null; };

/* ---------- set: pieces, packed stock, assemble / take apart ---------- */
async function kitModal(kitId) {
  const k = itemBy(kitId); if (!k) return;
  const parts = ((S.kits || {})[kitId] || []).map(p => ({ part_id: p.part_id, qty: p.qty }));
  let stats = null; try { stats = ((await rpc("kit_stats", { p_token: T() })) || []).find(x => x.kit_id === kitId) || null; } catch (e) {}
  const K = (S._kit = { id: kitId, parts });
  const draw = () => {
    const rows = K.parts.map((p, n) => { const it = itemBy(p.part_id) || { name: "—", code: "" }; return `<tr><td>${esc(it.name)}<br><span class="dim num" style="font-size:12px">${esc(it.code)}</span></td><td style="width:110px"><input class="inp num" type="number" min="1" step="1" data-kq="${n}" value="${p.qty}"></td><td class="n">${num(M.ownStock(p.part_id))}</td><td><button class="btn sm ghost" data-act="kitDel" data-k="${n}">شيل</button></td></tr>`; }).join("");
    const locs = myLocs(), has1 = K.parts.length > 0;
    modal(`<h2>الطقم: ${esc(k.name)}</h2><p class="muted" style="margin:0 0 10px">الطقم صنف عادي ليه سعره وكوده، ومكوّن من قطع. <b>مفتوح</b>: لما يتباع القطع بتتخصم ساعتها. <b>مقفول في كرتونة</b>: «تجميع» يخصم القطع ويزوّد رصيد الطقم، و«فك» يرجّعها. البيع بياخد من الكراتين الأول، والباقي من القطع.</p>
      <div class="card" style="padding:12px"><h3 style="margin-top:0">القطع اللي جوه الطقم الواحد</h3>
        <div class="tw"><table><thead><tr><th>القطعة</th><th>العدد في الطقم</th><th class="n">رصيدها</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="4" class="muted">لسه مفيش قطع — ضيف قطعة تحت.</td></tr>`}</tbody></table></div>
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:nowrap"><input class="inp" id="kAdd" list="kList" placeholder="اكتب اسم القطعة أو كودها" style="flex:1">${pickList("kList", i => i.id === kitId || (S.kits || {})[i.id] || i.serial_required)}<input class="inp num" id="kAddQ" type="number" min="1" value="1" style="width:80px"><button class="btn" data-act="kitAdd">إضافة</button></div>
        <div id="kErr"></div>
        <div class="row" style="justify-content:space-between;margin-top:10px">${(S.kits || {})[kitId] ? `<button class="btn sm danger" data-act="kitClear">مش طقم تاني</button>` : "<span></span>"}<button class="btn gold" data-act="kitSave">حفظ القطع</button></div></div>
      ${(S.kits || {})[kitId] ? `<div class="card" style="padding:12px;margin-top:10px"><h3 style="margin-top:0">الرصيد والحركة</h3>
        <div class="grid g4">${[["كراتين مقفولة", M.ownStock(kitId)], ["ممكن يتعمل من القطع", M.kitBuild(kitId)], ["اتجمّع", stats ? stats.built : "—"], ["اتفك", stats ? stats.apart : "—"]].map(x => `<div class="card kpi"><div class="lbl">${x[0]}</div><div class="val">${typeof x[1] === "number" || /^[\d.]+$/.test(x[1]) ? num(x[1]) : x[1]}</div></div>`).join("")}</div>
        ${stats ? `<p class="dim" style="font-size:12.5px;margin:6px 0">اتباع ${num(stats.sold)} طقم، منهم ${num(stats.open)} اتعملوا من القطع وقت البيع.</p>` : ""}
        ${locs.map(l => `<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)"><span>${esc(l.name)} <span class="dim num">· كراتين ${num(M.ownStock(kitId, l.id))} · من القطع ${num(M.kitBuild(kitId, l.id))}</span></span></div>`).join("")}
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap;align-items:flex-end"><div class="field" style="min-width:150px"><label>المكان</label><select class="inp" id="kLoc">${locs.map(l => `<option value="${l.id}" ${l.id === S.sess.device.location_id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
          <div class="field" style="width:100px"><label>عدد الأطقم</label><input class="inp num" id="kQ" type="number" min="1" step="1" value="1"></div>
          <div class="field" style="flex:1;min-width:150px"><label>ملاحظة</label><input class="inp" id="kNote"></div>
          <button class="btn gold" data-act="kitBuild">تجميع وتقفيل</button><button class="btn" data-act="kitApart">فك</button></div><div id="kOpErr"></div></div>` : ""}
      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn ghost" data-act="mClose">قفل</button></div>`);
    document.querySelectorAll("[data-kq]").forEach(x => { x.onchange = () => { K.parts[+x.dataset.kq].qty = +x.value || 1; }; });
    const ad = $("#kAdd"); if (ad) ad.onkeydown = e => { if (e.key === "Enter") document.querySelector("[data-act=kitAdd]").click(); };
  };
  K.draw = draw; draw();
}

/* ---------- swap a piece from an invoice ---------- */
async function swapModal(saleId, lineId) {
  try {
    const [sl] = await M.q("sale_lines", "*", x => x.eq("id", lineId)); if (!sl) throw new Error("NOT_FOUND");
    const old = itemBy(sl.item_id) || { name: "—", unit: "piece" };
    const of = sl.offer_id ? ((await M.q("offers", "id,name", x => x.eq("id", sl.offer_id)).catch(() => []))[0] || null) : null;
    const approve = can("returns", "p");
    S._sw = { sale: saleId, line: lineId, max: +sl.qty };
    modal(`<h2>تبديل صنف</h2><div class="card" style="padding:10px;margin-bottom:10px"><div class="row between"><b>${esc(old.name)}</b><span class="dim num">× ${num(sl.qty)}</span></div>${of ? `<span class="chip warn">★ ضمن عرض: ${esc(of.name)}</span>` : ""}</div>
      <div class="stack">
       <div class="field"><label>الصنف الجديد</label><input class="inp" id="swItem" list="swList" placeholder="اكتب الاسم أو الكود (المصري أو الصيني)">${pickList("swList", i => i.id === sl.item_id || i.serial_required)}</div>
       <div class="grid g2"><div class="field"><label>الكمية</label><input class="inp num" id="swQ" type="number" min="1" max="${+sl.qty}" step="${old.unit === "meter" ? "0.1" : "1"}" value="${Math.min(1, +sl.qty) || 1}"></div>
        <div class="field"><label>القطعة القديمة</label><select class="inp" id="swCond"><option value="resell">سليمة — ترجع للبيع</option><option value="damaged">تالفة — ما ترجعش للمخزون</option></select></div></div>
       <div class="field"><label>السعر</label><div class="row" style="gap:16px;flex-wrap:wrap"><label class="row" style="gap:6px"><input type="radio" name="swM" value="keep" checked> يفضل زي العرض</label><label class="row" style="gap:6px"><input type="radio" name="swM" value="diff"> العميل يدفع الفرق (أو ياخده لو الجديد أرخص)</label></div></div>
       <div class="grid g2"><div class="field"><label>طريقة دفع / رد الفرق</label><select class="inp" id="swPay">${Object.entries(PAYN).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div><div class="field"><label>السبب</label><input class="inp" id="swWhy" placeholder="مثال: العميل عايز لون تاني"></div></div>
       ${approve ? "" : `<div class="field"><label>رمز المدير للموافقة</label><input class="inp num" type="password" id="swPin"></div>`}
       <div id="swPrev"></div><div id="swErr"></div>
       <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="swapBack" data-id="${saleId}">رجوع</button><button class="btn gold" data-act="swapGo" disabled>تبديل</button></div></div>`);
    const upd = () => swapPreview();
    ["#swItem", "#swQ"].forEach(sel => { $(sel).oninput = $(sel).onchange = upd; });
    document.querySelectorAll("[name=swM]").forEach(x => { x.onchange = upd; });
  } catch (e) { toast(errText(e), true); }
}
const swRead = () => { const it = pickRead($("#swItem").value), m = (document.querySelector("[name=swM]:checked") || {}).value || "keep"; return { it, q: +$("#swQ").value || 0, m }; };
async function swapPreview() {
  const W = S._sw, { it, q, m } = swRead(), box = $("#swPrev"), go = document.querySelector("[data-act=swapGo]"), tag = (W.tag = (W.tag || 0) + 1);
  if (!box) return; go.disabled = true;
  if (!it) { box.innerHTML = $("#swItem").value.trim() ? `<div class="warnbox">مش لاقي الصنف ده.</div>` : ""; return; }
  if (q <= 0 || q > W.max) { box.innerHTML = `<div class="warnbox">الكمية من 1 لـ ${num(W.max)}.</div>`; return; }
  try { const r = await rpc("sale_swap_preview", { p_token: T(), p_sale: W.sale, p_line: W.line, p_item: it.id, p_qty: q, p_mode: m }); if (tag !== W.tag || !$("#swPrev")) return;
    const d = +r.diff, st = M.stockOf(it.id, S.sess.device.location_id);
    box.innerHTML = `<div class="${d > 0 ? "warnbox" : "okbox"}" style="margin:0"><div class="row between"><span>القديم بسعره في الفاتورة</span><b class="num">${fmt(r.back, 1)}</b></div>
      <div class="row between"><span>${esc(r.new_name)} — سعره ${fmt(r.new_price, 1)}</span><b class="num">${fmt(r.new_total, 1)}</b></div>
      <div class="row between" style="border-top:1px dashed var(--line2);margin-top:4px;padding-top:4px"><b>${d > 0 ? "العميل يدفع" : d < 0 ? "يرجع للعميل" : "من غير فلوس"}</b><b class="num">${fmt(Math.abs(d), 1)}</b></div>
      ${st < q ? `<div style="margin-top:4px;color:var(--bad)">رصيد الصنف الجديد هنا ${num(st)} بس.</div>` : ""}</div>`;
    go.disabled = st < q; W.ok = { it, q, m, d };
  } catch (e) { if (tag === W.tag && $("#swPrev")) box.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; }
}
async function swapGo(btn) {
  const W = S._sw, o = W.ok; if (!o) return;
  busy(btn, true);
  try {
    const r = await rpc("sale_swap", { p_token: T(), p: { sale_id: W.sale, line_id: W.line, item_id: o.it.id, qty: o.q, mode: o.m, method: $("#swPay").value, condition: $("#swCond").value, reason: $("#swWhy").value.trim(), approver_pin: ($("#swPin") || {}).value || null } });
    const [old] = await M.q("sale_lines", "item_id", x => x.eq("id", W.line)).catch(() => [{}]);
    const sn = ((await M.q("sales", "no", x => x.eq("id", W.sale)).catch(() => []))[0] || {}).no || "";
    await loadItems(); S.cash = null;
    const d = +r.diff, oldN = (itemBy(old && old.item_id) || {}).name || "";
    modal(`<h2>تم التبديل</h2><div class="receipt" id="rcpt"><div style="text-align:center;font-weight:700">${esc(S.store.name)}</div><div style="text-align:center" class="dim">${esc(locName(S.sess.device.location_id))} · ${new Date().toLocaleString("ar-EG")}</div>
      <div style="text-align:center" class="num">${esc(r.no)}</div><div style="text-align:center" class="dim">استبدال من فاتورة ${esc(sn)} · ${esc(r.return_no)}</div><div class="hr" style="margin:8px 0"></div>
      <div class="r"><span>رجع: ${esc(oldN)} × ${num(o.q)}</span><span>−${fmt(r.back, 1)}</span></div><div class="r"><span>خد: ${esc(o.it.name)} × ${num(o.q)}</span><span>${fmt(r.total, 1)}</span></div>
      <div class="hr" style="margin:8px 0"></div><div class="r"><b>${d > 0 ? "دفع الفرق" : d < 0 ? "رجعله الفرق" : "من غير فرق"}</b><b>${fmt(Math.abs(d), 1)}</b></div></div>
      <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" data-act="rcptPrint">طباعة</button><button class="btn gold" data-act="mClose">تمام</button></div>`);
    render();
  } catch (e) { errBox("#swErr", e); busy(btn, false); }
}

const prev = window.MZX;
window.MZX = async function (k, a) {
  const K = S._kit;
  if (k === "kitEdit") { kitModal(a.dataset.id); return true; }
  if (k === "kitAdd") { const it = pickRead($("#kAdd").value), q = Math.max(1, +$("#kAddQ").value || 1);
    if (!it) { errBox("#kErr", "مش لاقي القطعة دي."); return true; }
    if (it.id === K.id || (S.kits || {})[it.id] || it.serial_required) { errBox("#kErr", it.serial_required ? "KIT_SERIAL" : "KIT_NESTED"); return true; }
    const ex = K.parts.find(p => p.part_id === it.id); if (ex) ex.qty += q; else K.parts.push({ part_id: it.id, qty: q }); K.draw(); return true; }
  if (k === "kitDel") { K.parts.splice(+a.dataset.k, 1); K.draw(); return true; }
  if (k === "kitSave" || k === "kitClear") {
    if (k === "kitClear" && !confirm("الصنف ده هيبطل يبقى طقم (رصيده المقفول هيفضل زي ما هو). متأكد؟")) return true;
    if (k === "kitSave" && !K.parts.length) { errBox("#kErr", "ضيف قطعة واحدة على الأقل."); return true; }
    busy(a, true);
    try { await rpc("kit_save", { p_token: T(), p_kit: K.id, p_parts: k === "kitClear" ? [] : K.parts }); await loadItems(); toast("اتحفظ."); if (k === "kitClear") { closeModal(); render(); } else kitModal(K.id); }
    catch (e) { errBox("#kErr", e); busy(a, false); }
    return true; }
  if (k === "kitBuild" || k === "kitApart") { const q = +$("#kQ").value;
    if (!(q >= 1) || q !== Math.floor(q)) { errBox("#kOpErr", "BAD_QTY"); return true; }
    busy(a, true);
    try { const r = await rpc(k === "kitBuild" ? "kit_assemble" : "kit_disassemble", { p_token: T(), p_kit: K.id, p_loc: +$("#kLoc").value, p_qty: q, p_note: $("#kNote").value.trim() || null });
      await loadItems(); toast(`${k === "kitBuild" ? "اتجمّع" : "اتفك"} ${num(q)} طقم — ${r.no}`); kitModal(K.id); }
    catch (e) { errBox("#kOpErr", e); busy(a, false); }
    return true; }
  if (k === "swapOpen") { swapModal(a.dataset.id, +a.dataset.l); return true; }
  if (k === "swapBack") { M.returnModal(a.dataset.id); return true; }
  if (k === "swapGo") { swapGo(a); return true; }
  return prev ? prev(k, a) : false;
};
})();
