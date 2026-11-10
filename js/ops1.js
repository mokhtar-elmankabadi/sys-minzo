/* SYS Minzo · daily operations screens (batch 1)
   التقفيل اليومي · إدخال المصروفات · المرتجعات · العملاء والولاء · التوصيل والتركيب · الطابعات والملصقات
   Built on the internals app.js exposes as window.MZ. Every write goes through a server function. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, norm, rpc, q, T, can, has, seeCost, locName, ico, toast, modal, closeModal, busy, header, render, go, loadItems, loadDir, who, today, xlsOut, errText, myLoc, r2, PAYN, returnModal } = M;
const isOwner = () => S.sess.role.id === "owner", isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const dt = x => x ? new Date(x).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";
const dd = x => x ? new Date(x + (String(x).length === 10 ? "T12:00:00" : "")).toLocaleDateString("ar-EG", { day: "numeric", month: "short" }) : "—";
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const shows = () => S.locs.filter(l => l.kind === "showroom" && myLoc(l.id));
const myLocs = () => S.locs.filter(l => myLoc(l.id));
const defLoc = () => (S.sess.device.location_id && myLoc(S.sess.device.location_id) ? S.sess.device.location_id : (S.sess.staff.location_id || (shows()[0] || S.locs[0] || {}).id));
/* business day: before the closing time the day still belongs to yesterday */
function bday() { const n = new Date(Date.now() + 2 * 3600e3), hm = n.toISOString().slice(11, 16), ct = String((S.store && S.store.day_close_time) || "06:00").slice(0, 5);
  if (hm < ct) n.setUTCDate(n.getUTCDate() - 1); return n.toISOString().slice(0, 10); }
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const varChip = v => v == null ? "—" : +v === 0 ? chip("مطابق", "ok") : `<span class="chip ${+v < 0 ? "bad" : "warn"}">${+v < 0 ? "عجز" : "زيادة"} ${fmt(Math.abs(v), 1)}</span>`;
const empty = (n, t) => `<tr><td colspan="${n}" class="muted">${t}</td></tr>`;
const later = (fn, r) => { setTimeout(() => fn().then(() => S.route === r && render()).catch(e => toast(errText(e), true)), 0); return `<div class="spin"></div>`; };

/* =====================================================================
   BARCODES (same engine as the prototype: Code 128, EAN-13, Code 39, QR)
   ===================================================================== */
function eanCheck(d12){let s=0;for(let i=0;i<12;i++)s+=(+d12[i])*(i%2?3:1);return (10-s%10)%10;}
function eanOk(s){return /^\d{13}$/.test(s)&&eanCheck(s.slice(0,12))===+s[12];}
const C128=["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232"];
function c128mods(txt){const v=[...String(txt)].map(c=>{const k=c.charCodeAt(0)-32;return k>=0&&k<95?k:0;});let sum=104;v.forEach((x,i)=>sum+=x*(i+1));const codes=[104,...v,sum%103];let bits="";codes.forEach(c=>{const p=C128[c];for(let i=0;i<6;i++)bits+=(i%2?"0":"1").repeat(+p[i]);});bits+="11000111010"+"11";return bits;}
const EL=["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"],EG=["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"],ER=["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"],EP=["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
function eanMods(c){const d=c.split("").map(Number),par=EP[d[0]];let b="101";for(let i=1;i<=6;i++)b+=(par[i-1]==="L"?EL:EG)[d[i]];b+="01010";for(let i=7;i<=12;i++)b+=ER[d[i]];return b+"101";}
const C39={"0":"000110100","1":"100100001","2":"001100001","3":"101100000","4":"000110001","5":"100110000","6":"001110000","7":"000100101","8":"100100100","9":"001100100","A":"100001001","B":"001001001","C":"101001000","D":"000011001","E":"100011000","F":"001011000","G":"000001101","H":"100001100","I":"001001100","J":"000011100","K":"100000011","L":"001000011","M":"101000010","N":"000010011","O":"100010010","P":"001010010","Q":"000000111","R":"100000110","S":"001000110","T":"000010110","U":"110000001","V":"011000001","W":"111000000","X":"010010001","Y":"110010000","Z":"011010000","-":"010000101",".":"110000100"," ":"011000100","*":"010010100"};
function c39mods(txt){let b="";("*"+String(txt).toUpperCase().replace(/[^0-9A-Z\-. ]/g,"")+"*").split("").forEach(c=>{const p=C39[c];for(let i=0;i<9;i++)b+=(i%2?"0":"1").repeat(p[i]==="1"?3:1);b+="0";});return b;}
function barsSVG(bits,label,h){let x=0,r="";for(let i=0;i<bits.length;){if(bits[i]==="1"){let w=0;while(bits[i+w]==="1")w++;r+=`<rect x="${x+10}" y="2" width="${w}" height="${h}" fill="#111"/>`;x+=w;i+=w;}else{x++;i++;}}const W=bits.length+20;
 return `<svg viewBox="0 0 ${W} ${h+(label?14:4)}" width="100%" preserveAspectRatio="none" style="height:100%;display:block" role="img" aria-label="${esc(label||"")}"><rect width="${W}" height="${h+16}" fill="#fff"/>${r}${label?`<text x="${W/2}" y="${h+13}" text-anchor="middle" style="font:10px monospace;fill:#111">${esc(label)}</text>`:""}</svg>`;}
function qrSVG(txt){if(!window.qrcode)return "";const qq=window.qrcode(0,"M");qq.addData(String(txt));qq.make();const n=qq.getModuleCount();let r="";for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qq.isDark(y,x))r+=`M${x+2} ${y+2}h1v1h-1z`;return `<svg viewBox="0 0 ${n+4} ${n+4}" width="100%" style="height:100%;display:block" shape-rendering="crispEdges"><rect width="${n+4}" height="${n+4}" fill="#fff"/><path d="${r}" fill="#111"/></svg>`;}
function codeSVG(code,type,h){h=h||50;if(type==="qr")return qrSVG(code);if(type==="ean13"){if(!eanOk(code))return null;return barsSVG(eanMods(code),code,h);}if(type==="code39")return barsSVG(c39mods(code),code,h);return barsSVG(c128mods(code),code,h);}
window.MZQR = qrSVG;

/* =====================================================================
   التقفيل اليومي
   ===================================================================== */
async function loadClose() {
  const C = S.cl || (S.cl = { loc: (shows().find(l => l.id === defLoc()) || shows()[0] || {}).id, day: bday() });
  if (!C.loc) { C.pv = null; C.hist = []; C.loaded = true; return; }
  await loadDir();
  const [pv, hist] = await Promise.all([rpc("day_close_preview", { p_token: T(), p_loc: C.loc, p_day: C.day }), q("day_closings", "*", x => x.eq("location_id", C.loc).order("business_day", { ascending: false }).limit(40))]);
  C.pv = pv; C.hist = hist; C.loaded = C.loc + "|" + C.day;
}
V.close = () => {
  const C = S.cl;
  if (!C || C.loaded !== (C.loc + "|" + C.day)) return header() + later(loadClose, "close");
  const L = shows();
  let h = header(`<div class="tabs">${L.map(l => `<button data-act="clLoc" data-id="${l.id}" class="${C.loc === l.id ? "on" : ""}">${esc(l.name)}</button>`).join("")}</div><input class="inp" type="date" id="clDay" value="${esc(C.day)}" max="${esc(bday())}" style="width:auto">`);
  if (!L.length) return h + `<div class="card"><p class="muted">مفيش معارض في نطاقك.</p></div>`;
  const pv = C.pv, s = pv.summary, cl = pv.closing, closed = cl && cl.status === "closed", canClose = can("close", "p");
  const net = +s.total - +s.returns, steps = [["الورديات اتسلّمت", !+s.open_shifts], ["التسليم اتعتمد", !+s.handed_shifts], ["المصروفات اتراجعت", !+s.expenses_pending], ["التقفيل", closed]];
  if (closed) h += `<div class="okbox rise" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="flex:1;min-width:220px">اليوم متقفل · ${esc(cl.closed_by || "")} · ${dt(cl.closed_at)}${cl.note ? ` · ${esc(cl.note)}` : ""}</b>${isOwner() ? `<button class="btn sm" data-act="clReopen">إعادة فتح اليوم</button>` : ""}</div>`;
  else if (cl && cl.status === "reopened") h += `<div class="warnbox rise">اليوم اتفتح تاني بعد التقفيل · ${esc(cl.reopened_by || "")} · ${dt(cl.reopened_at)} · السبب: ${esc(cl.reopen_reason || "")}</div>`;
  h += `<div class="card rise" style="padding:12px 16px"><div class="row" style="gap:18px;flex-wrap:wrap">${steps.map((x, i) => `<span class="row" style="gap:6px"><span class="chip ${x[1] ? "ok" : i === 3 ? "plain" : "warn"}">${x[1] ? "✓" : i + 1}</span>${x[0]}</span>`).join("")}</div></div>`;
  h += `<div class="grid g4">${[["عدد الفواتير", s.invoices, 1], ["إجمالي المبيعات", s.gross], ["خصومات وعروض", -s.discount], ["مرتجعات", -s.returns], ["صافي المبيعات", net], ["المصروفات", -s.expenses], ["فرق الورديات", s.cash_diff], ["اتورّد للخزنة", s.deposited]].map((x, i) => `<div class="card kpi rise ${i === 4 ? "lux" : ""}" style="--d:${i % 4}"><div class="lbl">${x[0]}</div><div class="val">${x[2] ? num(x[1]) : fmt(x[1])}</div></div>`).join("")}</div>`;
  h += `<div class="grid g2"><div class="card rise"><h3>الورديات</h3><div class="tw"><table><thead><tr><th>الكاشير</th><th>من</th><th>إلى</th><th class="n">المفروض</th><th class="n">المعدود</th><th>الفرق</th><th>الحالة</th></tr></thead><tbody>${s.shifts.map(x => `<tr><td>${esc(x.cashier || "—")}</td><td class="num dim">${dt(x.opened_at)}</td><td class="num dim">${dt(x.closed_at)}</td><td class="n">${x.expected != null ? fmt(x.expected, 1) : "—"}</td><td class="n">${x.counted != null ? fmt(x.counted, 1) : "—"}</td><td>${varChip(x.diff)}${x.reason ? `<br><span class="dim" style="font-size:12px">${esc(x.reason)}</span>` : ""}</td><td>${chip({ open: "مفتوحة", handed: "مستنية اعتماد", approved: "معتمدة" }[x.status], x.status === "approved" ? "ok" : x.status === "handed" ? "warn" : "info")}</td></tr>`).join("") || empty(7, "مفيش ورديات على اليوم ده.")}</tbody></table></div>
     ${+s.open_shifts || +s.handed_shifts ? `<div class="warnbox" style="margin-top:10px">${+s.open_shifts ? `فيه ${s.open_shifts} وردية لسه مفتوحة — الكاشير يسلّمها من نقطة البيع. ` : ""}${+s.handed_shifts ? `فيه ${s.handed_shifts} تسليم مستني اعتماد.` : ""} ${can("cash") || can("close") ? `<button class="btn sm" data-go="cash">الخزنة والورديات</button>` : ""}</div>` : ""}</div>
   <div class="card rise"><h3>طرق الدفع</h3><div class="tw"><table><tbody>${Object.entries(s.pay || {}).map(([k, v]) => `<tr><td>${k === "inst" ? "تقسيط (مستحق على الشركات)" : esc(PAYN[k] || k)}</td><td class="n">${fmt(v, 1)}</td></tr>`).join("") || empty(2, "مفيش مبيعات.")}${+s.returns_cash ? `<tr><td>مرتجع نقدي من الدرج</td><td class="n" style="color:var(--bad)">−${fmt(s.returns_cash, 1)}</td></tr>` : ""}${+s.voids ? `<tr><td>فواتير ملغاة</td><td class="n">${s.voids}</td></tr>` : ""}${seeCost() && +s.total ? `<tr><td>مجمل الربح (من غير المرتجعات)</td><td class="n">${fmt(+s.total - +s.vat - +s.cost, 1)}</td></tr>` : ""}</tbody></table></div>
     <h3 style="margin-top:14px">مصروفات اليوم${can("expense", "a") && !closed ? ` <button class="btn sm" data-act="exNew" data-loc="${C.loc}" style="margin-inline-start:auto">${ico("plus")} مصروف</button>` : ""}</h3><div class="tw"><table><tbody>${s.expense_list.map(e => `<tr><td>${esc(e.cat)}<br><span class="dim" style="font-size:12px">${esc(e.note)}${e.drawer ? "" : " · مش من الدرج"}</span></td><td>${e.status === "pending" ? chip("مستني موافقة", "warn") : ""}</td><td class="n">${fmt(e.amount, 1)}</td></tr>`).join("") || empty(3, "مفيش مصروفات.")}</tbody></table></div></div></div>`;
  const warns = []; if (+s.held_open) warns.push(`${s.held_open} فاتورة معلّقة هتترحّل لليوم اللي بعده بعلامة «مُرحَّل».`); if (+s.expenses_pending) warns.push(`${s.expenses_pending} مصروف مستني موافقة — مش هيدخل في التقفيل لحد ما يتعتمد.`); if (+s.transfers_waiting) warns.push(`${s.transfers_waiting} تحويل مستني شحن أو استلام.`);
  if (!closed) h += `<div class="card rise"><h3>تقفيل اليوم</h3>${warns.length ? `<div class="warnbox" style="margin-bottom:10px">${warns.map(esc).join("<br>")}</div>` : ""}
    ${pv.early ? `<p class="muted" style="margin-top:0">التقفيل قبل ميعاده (${esc(String(pv.close_time).slice(0, 5))}) — لازم تكتب السبب. بعد التقفيل البيع على اليوم ده بيتقفل لحد ميعاد فتح اليوم الجديد.</p>` : `<p class="muted" style="margin-top:0">بعد التقفيل الحركات على اليوم ده بتتقفل، والتعديل بإعادة فتح من المالك بس.</p>`}
    <div class="row" style="gap:8px;flex-wrap:wrap"><input class="inp" id="clNote" placeholder="${pv.early ? "سبب التقفيل بدري (إجباري)" : "ملاحظة (اختياري)"}" style="flex:1;min-width:220px"><button class="btn gold" data-act="clGo" ${canClose && !+s.open_shifts && !+s.handed_shifts ? "" : "disabled"}>تقفيل اليوم</button></div>
    ${canClose ? "" : `<p class="dim" style="font-size:12.5px;margin-bottom:0">التقفيل للمدير — دورك يشوف الملخص بس.</p>`}<div id="clErr"></div></div>`;
  h += `<div class="card rise"><h3>سجل التقفيلات · ${esc(locName(C.loc))}</h3><div class="tw"><table><thead><tr><th>اليوم</th><th class="n">الفواتير</th><th class="n">صافي المبيعات</th><th class="n">المصروفات</th><th>فرق النقدية</th><th class="n">التوريد</th><th>قفله</th><th>الحالة</th></tr></thead><tbody>${C.hist.map(x => { const m = x.summary || {}; return `<tr data-act="clPick" data-day="${x.business_day}" style="cursor:pointer"><td class="num">${esc(x.business_day)}</td><td class="n">${num(m.invoices)}</td><td class="n">${fmt(+m.total - +m.returns, 1)}</td><td class="n">${fmt(m.expenses, 1)}</td><td>${varChip(m.cash_diff)}</td><td class="n">${fmt(m.deposited, 1)}</td><td>${esc(who(x.closed_by))}<br><span class="dim num" style="font-size:12px">${dt(x.closed_at)}</span></td><td>${x.status === "closed" ? chip("متقفل", "ok") : chip("اتفتح تاني", "warn")}</td></tr>`; }).join("") || empty(8, "لسه مفيش تقفيلات.")}</tbody></table></div></div>`;
  return h;
};
H.close = () => { const d = $("#clDay"); if (d) d.onchange = () => { if (d.value) { S.cl.day = d.value; render(); } }; };

/* =====================================================================
   إدخال المصروفات
   ===================================================================== */
async function loadEx() {
  const E = S.ex || (S.ex = { month: today().slice(0, 7), loc: "all", cat: "all" });
  const from = E.month + "-01", to = new Date(Date.UTC(+E.month.slice(0, 4), +E.month.slice(5, 7), 0)).toISOString().slice(0, 10);
  await loadDir();
  const [cats, list, accts] = await Promise.all([q("expense_categories", "*", x => x.order("sort")), q("expenses", "*", x => x.gte("exp_date", from).lte("exp_date", to).order("created_at", { ascending: false }).limit(3000)), q("cash_accounts", "*", x => x.eq("active", true).order("id"))]);
  Object.assign(E, { cats, list, accts, loaded: E.month });
}
const catName = id => ((S.ex && S.ex.cats || []).find(c => c.id === id) || {}).name || "—";
V.expense = () => {
  const E = S.ex; if (!E || E.loaded !== E.month) return header() + later(loadEx, "expense");
  const ok = E.list.filter(x => x.status === "approved"), lim = +S.sess.role.max_amount || 0, td = bday();
  let h = header(`<input class="inp" type="month" id="exM" value="${esc(E.month)}" style="width:auto">${can("expense", "x") || isTop() ? `<button class="btn" data-act="exXls">Excel</button>` : ""}${can("expense", "a") ? `<button class="btn gold" data-act="exNew">${ico("plus")} مصروف جديد</button>` : ""}`);
  const mA = ok.reduce((a, x) => a + +x.amount, 0), mB = E.cats.reduce((a, c) => a + +c.budget, 0), pend = E.list.filter(x => x.status === "pending");
  h += `<div class="grid g4">${myLocs().map((l, i) => `<div class="card kpi rise" style="--d:${i}"><div class="lbl">مصروفات اليوم · ${esc(l.name)}</div><div class="val">${fmt(ok.filter(x => x.location_id === l.id && x.exp_date === td).reduce((a, x) => a + +x.amount, 0))}</div></div>`).join("")}
   <div class="card kpi lux rise"><div class="lbl">المصروف الفعلي للشهر</div><div class="val">${fmt(mA)}</div>${mB ? `<div class="dim" style="font-size:12px">${Math.round(mA / mB * 100)}% من الميزانية ${fmt(mB)}</div>` : ""}</div></div>`;
  if (pend.length) h += `<div class="warnbox rise">${pend.length} مصروف مستني موافقة${can("expense", "p") ? " — راجعهم من الدفتر تحت." : " من المدير."}</div>`;
  h += `<div class="card rise"><h3>الفعلي مقابل الميزانية${can("expense", "e") || isTop() || S.sess.role.id === "acct" ? `<button class="btn sm" data-act="exCat" style="margin-inline-start:auto">${ico("plus")} بند جديد</button>` : ""}</h3><div class="tw"><table><thead><tr><th>البند</th><th>المجموعة</th><th class="n">الفعلي</th><th class="n">الميزانية الشهرية</th><th style="min-width:140px">النسبة</th><th></th></tr></thead><tbody>${E.cats.filter(c => c.active || ok.some(x => x.category_id === c.id)).map(c => { const a = ok.filter(x => x.category_id === c.id).reduce((s, x) => s + +x.amount, 0), r = c.budget > 0 ? a / c.budget * 100 : 0;
    return `<tr><td>${esc(c.name)}${c.active ? "" : " " + chip("موقوف")}</td><td class="muted">${esc(c.grp)}</td><td class="n">${fmt(a, 1)}</td><td class="n">${+c.budget ? fmt(c.budget) : "—"}</td><td>${+c.budget ? `<div style="height:6px;border-radius:4px;background:var(--line);overflow:hidden"><div style="height:100%;width:${Math.min(100, r)}%;background:var(${r > 100 ? "--bad" : r > 85 ? "--warn" : "--gold"})"></div></div><span class="dim num" style="font-size:12px">${Math.round(r)}%</span>` : `<span class="dim">بدون ميزانية</span>`}</td><td>${can("expense", "e") || isTop() || S.sess.role.id === "acct" ? `<button class="btn sm ghost" data-act="exCat" data-id="${c.id}">تعديل</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  const L = E.list.filter(x => (E.loc === "all" || String(x.location_id) === E.loc) && (E.cat === "all" || String(x.category_id) === E.cat));
  h += `<div class="card rise"><h3>دفتر المصروفات</h3><div class="row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap"><select class="inp" id="exL" style="width:auto"><option value="all">كل الأماكن</option>${myLocs().map(l => `<option value="${l.id}" ${E.loc === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}<option value="null" ${E.loc === "null" ? "selected" : ""}>عام / إدارة</option></select><select class="inp" id="exC" style="width:auto"><option value="all">كل البنود</option>${E.cats.map(c => `<option value="${c.id}" ${E.cat === String(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select><span class="dim" style="margin-inline-start:auto">${L.length} مصروف · ${fmt(L.filter(x => x.status === "approved").reduce((a, x) => a + +x.amount, 0))}</span></div>
   <div class="tw"><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>البند</th><th>المكان</th><th>البيان والمستفيد</th><th>المصدر</th><th class="n">المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>${L.map(x => `<tr><td class="num dim">${esc(x.no)}</td><td class="num">${esc(x.exp_date)}</td><td>${esc(catName(x.category_id))}${x.recurring ? " " + chip("شهري", "info") : ""}</td><td>${x.location_id ? esc(locName(x.location_id)) : "عام"}</td><td>${esc(x.note)}${x.payee ? `<br><span class="dim" style="font-size:12px">${esc(x.payee)}</span>` : ""}</td><td class="muted">${esc(((E.accts.find(a => a.id === x.source_account)) || {}).name || "—")}</td><td class="n">${fmt(x.amount, 1)}</td>
     <td>${x.status === "pending" ? chip("مستني موافقة", "warn") : x.status === "approved" ? chip("معتمد", "ok") : x.status === "rejected" ? chip("مرفوض", "bad") : chip("ملغي")}${x.status !== "approved" && (x.decision_note || x.void_reason) ? `<br><span class="dim" style="font-size:12px">${esc(x.void_reason || x.decision_note)}</span>` : ""}<br><span class="dim" style="font-size:11.5px">${esc(who(x.created_by))}</span></td>
     <td class="row" style="gap:4px;flex-wrap:nowrap">${x.status === "pending" && can("expense", "p") ? `<button class="btn sm gold" data-act="exOk" data-id="${x.id}">موافقة</button><button class="btn sm ghost" data-act="exNo" data-id="${x.id}">رفض</button>` : ""}${["approved", "pending"].includes(x.status) && (can("expense", "d") || can("expense", "p")) ? `<button class="btn sm ghost" data-act="exVoid" data-id="${x.id}">إلغاء</button>` : ""}</td></tr>`).join("") || empty(9, "مفيش مصروفات بالفلتر ده.")}</tbody></table></div>
   <p class="dim" style="font-size:12px;margin-bottom:0">${lim ? `أي مصروف فوق ${fmt(lim)} من دورك بيتسجّل مستني موافقة المدير قبل ما يأثر على الخزنة. ` : ""}المصروف المعتمد ما بيتعدّلش — التصحيح بإلغائه بسبب وتسجيله من جديد.</p></div>`;
  return h;
};
H.expense = () => { const m = $("#exM"); if (m) m.onchange = () => { if (m.value) { S.ex.month = m.value; render(); } };
  const l = $("#exL"); if (l) l.onchange = () => { S.ex.loc = l.value; render(); }; const c = $("#exC"); if (c) c.onchange = () => { S.ex.cat = c.value; render(); }; };
async function exNewModal(loc) {
  if (!S.ex || !S.ex.cats) await loadEx();
  const E = S.ex, lim = +S.sess.role.max_amount || 0, L = myLocs(), l0 = loc ? +loc : defLoc();
  const srcs = lc => E.accts.filter(a => a.kind !== "drawer" || a.location_id === lc);
  modal(`<h2>مصروف جديد</h2><div class="stack"><div class="grid g2"><div class="field"><label>التاريخ</label><input class="inp" type="date" id="eD" value="${esc(bday())}" max="${esc(today())}"></div>
   <div class="field"><label>المكان</label><select class="inp" id="eL">${L.map(l => `<option value="${l.id}" ${l.id === l0 ? "selected" : ""}>${esc(l.name)}</option>`).join("")}${S.sess.role.scope_all_locations ? `<option value="">عام / إدارة</option>` : ""}</select></div>
   <div class="field"><label>البند</label><select class="inp" id="eC">${E.cats.filter(c => c.active).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
   <div class="field"><label>المبلغ</label><input class="inp num" type="number" min="0" step="0.01" id="eA"></div>
   <div class="field"><label>مصدر الصرف</label><select class="inp" id="eS"></select></div><div class="field"><label>المستفيد</label><input class="inp" id="eP" placeholder="اختياري"></div></div>
   <div class="field"><label>البيان</label><input class="inp" id="eN" placeholder="مثال: صيانة تكييف المعرض"></div>
   <label class="row" style="gap:8px"><input type="checkbox" id="eR"> مصروف متكرر شهريًا</label><div id="eHint" class="dim" style="font-size:12.5px"></div><div id="eErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="exSave">تسجيل المصروف</button></div></div>`);
  const fill = () => { const lc = $("#eL").value ? +$("#eL").value : null; $("#eS").innerHTML = srcs(lc).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join(""); hint(); };
  const hint = () => { const a = +$("#eA").value || 0, acc = E.accts.find(x => x.id === +$("#eS").value) || {}; $("#eHint").innerHTML = [acc.kind === "drawer" ? "هيتخصم من الدرج ويظهر في تسليم الوردية والتقفيل اليومي (لازم تكون فيه وردية مفتوحة)." : "", lim && a > lim ? `<b style="color:var(--warn)">فوق حدّك (${fmt(lim)}) — هيتسجّل مستني موافقة المدير.</b>` : ""].filter(Boolean).join("<br>"); };
  $("#eL").onchange = fill; $("#eA").oninput = hint; $("#eS").onchange = hint; fill();
}
function exCatModal(c) {
  const x = c || { name: "", grp: "تشغيلية", account: "5207", budget: 0, active: true }, accts = S.gl && S.gl.accts;
  const opts = [["5201", "مرتبات وأجور"], ["5202", "إيجارات"], ["5203", "كهرباء ومرافق"], ["5204", "نقل وشحن"], ["5205", "دعاية وتسويق"], ["5206", "تالف وفاقد"], ["5207", "مصروفات متنوعة"], ["5208", "إهلاك"], ["5210", "صيانة"]];
  const list = accts ? accts.filter(a => a.kind === "X" && !accts.some(b => b.parent === a.code) && a.code !== "5101").map(a => [a.code, a.name]) : opts;
  if (!list.some(o => o[0] === x.account)) list.push([x.account, x.account]);
  modal(`<h2>${c ? "تعديل بند" : "بند مصروفات جديد"}</h2><div class="stack"><div class="field"><label>اسم البند</label><input class="inp" id="kN" value="${esc(x.name)}"></div>
   <div class="grid g2"><div class="field"><label>المجموعة</label><select class="inp" id="kG">${["إدارية", "تشغيلية", "بيعية"].map(g => `<option ${x.grp === g ? "selected" : ""}>${g}</option>`).join("")}</select></div><div class="field"><label>الحساب في الحسابات العامة</label><select class="inp" id="kA">${list.map(o => `<option value="${o[0]}" ${o[0] === x.account ? "selected" : ""}>${esc(o[0] + " · " + o[1])}</option>`).join("")}</select></div>
   <div class="field"><label>الميزانية الشهرية (0 = من غير ميزانية)</label><input class="inp num" type="number" min="0" id="kB" value="${+x.budget || 0}"></div>${c ? `<label class="row" style="gap:8px;align-self:end"><input type="checkbox" id="kOn" ${x.active ? "checked" : ""}> البند شغّال</label>` : ""}</div><div id="kErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="exCatSave" data-id="${c ? c.id : ""}">حفظ</button></div></div>`);
}
function exReasonModal(id, kind) {
  modal(`<h2>${kind === "void" ? "إلغاء المصروف" : "رفض المصروف"}</h2><p class="muted">${kind === "void" ? "لو المصروف اتصرف، المبلغ بيرجع لنفس الخزنة أو الدرج بقيد عكسي، والأصل بيفضل في الدفتر كملغي." : "المصروف مش هيأثر على الخزنة."}</p><div class="stack"><div class="field"><label>السبب</label><input class="inp" id="xR"></div><div id="xErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn danger" data-act="${kind === "void" ? "exVoidGo" : "exNoGo"}" data-id="${id}">${kind === "void" ? "إلغاء المصروف" : "رفض"}</button></div></div>`);
}

/* =====================================================================
   المرتجعات
   ===================================================================== */
async function loadRet() {
  const R = S.rt || (S.rt = { loc: "all", q: "" });
  const since = new Date(Date.now() - 120 * 864e5).toISOString();
  await loadDir();
  const rets = await q("returns", "*", x => x.gte("created_at", since).order("created_at", { ascending: false }).limit(1000));
  const ids = rets.map(r => r.id), sids = [...new Set(rets.map(r => r.sale_id))];
  const [lines, sales] = ids.length ? await Promise.all([q("return_lines", "*", x => x.in("return_id", ids)), q("sales", "id,no,customer_id,created_at", x => x.in("id", sids))]) : [[], []];
  Object.assign(R, { rets, lines, sales, loaded: true });
}
V.returns = () => {
  const R = S.rt; if (!R || !R.loaded) return header() + later(loadRet, "returns");
  const sale = id => R.sales.find(s => s.id === id) || {}, itn = id => (S.items.find(i => i.id === id) || {}).name || "—";
  const mo = today().slice(0, 7), qq = norm(R.q);
  const L = R.rets.filter(r => (R.loc === "all" || r.location_id === +R.loc) && myLoc(r.location_id) && (!qq || norm(r.no + " " + (sale(r.sale_id).no || "") + " " + r.reason).includes(qq)));
  const m = R.rets.filter(r => (r.created_at || "").slice(0, 7) === mo && myLoc(r.location_id)), dmg = R.lines.filter(l => l.condition === "damaged" && m.some(r => r.id === l.return_id));
  let h = header(`${can("returns", "a") ? `<button class="btn gold" data-act="rtNew">${ico("plus")} تسجيل مرتجع</button>` : ""}`);
  h += `<div class="grid g4">${[["مرتجعات الشهر", m.length, 1], ["قيمتها", m.reduce((a, r) => a + +r.amount, 0)], ["رد نقدي", m.filter(r => r.refund_method === "cash").reduce((a, r) => a + +r.amount, 0)], ["أصناف تالفة (بالتكلفة)", seeCost() ? dmg.reduce((a, l) => a + +l.cost, 0) : dmg.length, !seeCost()]].map((x, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${x[0]}</div><div class="val">${x[2] ? num(x[1]) : fmt(x[1])}</div></div>`).join("")}</div>`;
  h += `<div class="card rise"><div class="row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap"><input class="inp" id="rtQ" placeholder="بحث برقم المرتجع أو الفاتورة أو السبب" value="${esc(R.q)}" style="flex:1;min-width:200px"><select class="inp" id="rtL" style="width:auto"><option value="all">كل المعارض</option>${shows().map(l => `<option value="${l.id}" ${R.loc === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
   <div class="tw"><table><thead><tr><th>المرتجع</th><th>الفاتورة</th><th>الأصناف</th><th>السبب</th><th class="n">منذ الشراء</th><th>رد الفلوس</th><th class="n">القيمة</th><th>سجّله / وافق</th></tr></thead><tbody>${L.map(r => { const s = sale(r.sale_id), ls = R.lines.filter(l => l.return_id === r.id), days = s.created_at ? Math.max(0, Math.round((new Date(r.created_at) - new Date(s.created_at)) / 864e5)) : 0;
     return `<tr><td class="num">${esc(r.no)}<br><span class="dim" style="font-size:12px">${esc(locName(r.location_id))} · ${dt(r.created_at)}</span></td><td class="num">${esc(s.no || "—")}</td><td>${ls.map(l => `${esc(itn(l.item_id))} <span class="num dim">×${num(l.qty)}</span> ${l.condition === "damaged" ? chip("تالف", "bad") : chip("سليم", "ok")}${l.serial ? ` <span class="dim num" style="font-size:12px">SN ${esc(l.serial)}</span>` : ""}`).join("<br>")}</td><td>${esc(r.reason)}</td><td class="n" style="${days > 14 ? "color:var(--warn)" : ""}">${days} يوم</td><td>${r.refund_method === "credit" ? "استبدال / رصيد" : esc(PAYN[r.refund_method] || r.refund_method)}</td><td class="n">${fmt(r.amount, 1)}</td><td>${esc(who(r.staff_id))}${r.approved_by && r.approved_by !== r.staff_id ? `<br><span class="dim" style="font-size:12px">وافق: ${esc(who(r.approved_by))}</span>` : ""}</td></tr>`; }).join("") || empty(8, "مفيش مرتجعات في آخر ٤ شهور.")}</tbody></table></div>
   <p class="dim" style="font-size:12px;margin-bottom:0">المرتجع اللي عدّى ١٤ يوم من الشراء بيظهر بلون تحذيري. الكاشير محتاج رمز المدير للموافقة، والسليم بيرجع المخزون بتكلفته والتالف بيتشطب.</p></div>`;
  return h;
};
H.returns = () => { const qi = $("#rtQ"); if (qi) qi.oninput = () => { S.rt.q = qi.value; const p = qi.selectionStart; render(); const n = $("#rtQ"); n.focus(); n.setSelectionRange(p, p); };
  const l = $("#rtL"); if (l) l.onchange = () => { S.rt.loc = l.value; render(); }; };
function rtNewModal() {
  modal(`<h2>تسجيل مرتجع</h2><div class="stack"><div class="field"><label>رقم الفاتورة</label><input class="inp num" id="rtNo" placeholder="INV-000123"></div><div id="rtErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="rtFind">فتح الفاتورة</button></div></div>`);
  $("#rtNo").onkeydown = e => { if (e.key === "Enter") document.querySelector("[data-act=rtFind]").click(); };
}

/* =====================================================================
   العملاء والولاء
   ===================================================================== */
async function loadCust() { const C = S.cu || (S.cu = { q: "" }); C.list = await rpc("customers_list", { p_token: T() }); C.loaded = true; }
const tier = s => s >= 100000 ? ["بلاتيني", "gold"] : s >= 50000 ? ["ذهبي", "warn"] : s >= 20000 ? ["فضي", "info"] : ["عادي", "plain"];
const cxOk = () => isTop() || has("custMsg");
const cuSorts = { last: ["آخر زيارة", c => c.last || ""], invoices: ["عدد الفواتير", c => +c.invoices], spent: ["إجمالي المشتريات", c => +c.spent], points: ["النقاط", c => +c.points], name: ["الاسم", c => c.name] };
function cuFiltered() {
  const C = S.cu, qq = norm(C.q), f = C.f, now = Date.now();
  let F = C.list.filter(c => (!qq || norm(c.name + " " + (c.phone || "") + " " + (c.area || "")).includes(qq))
    && (!f.minInv || +c.invoices >= +f.minInv) && (!f.minSpent || +c.spent >= +f.minSpent)
    && (!f.away || (c.last ? now - new Date(c.last).getTime() >= +f.away * 864e5 : +c.invoices === 0))
    && (!f.phone || /^01\d{9}$/.test(String(c.phone || ""))));
  const [, key] = cuSorts[C.sort] || cuSorts.last, dir = C.sort === "name" ? 1 : -1;
  return F.slice().sort((x, y) => { const p = key(x), q2 = key(y); return (p > q2 ? 1 : p < q2 ? -1 : 0) * dir; });
}
V.customers = () => {
  const C = S.cu; if (!C || !C.loaded) return header() + later(loadCust, "customers");
  C.tab = C.tab || "list"; C.sort = C.sort || "last"; C.f = C.f || {}; C.sel = C.sel || [];
  const st = S.store || {}, L = C.list, cx = cxOk();
  const pts = L.reduce((a, c) => a + Math.max(0, +c.points), 0), rep = L.length ? Math.round(L.filter(c => +c.invoices > 1).length / L.length * 100) : 0;
  let h = header(`${isTop() ? `<button class="btn" data-act="cuLoy">إعدادات الولاء</button>` : ""}${can("customers", "x") || isTop() ? `<button class="btn" data-act="cuXls">Excel</button>` : ""}${can("customers", "a") ? `<button class="btn gold" data-act="cuNew">${ico("plus")} عميل جديد</button>` : ""}`);
  if (cx) h += `<div class="tabs" style="margin-bottom:14px">${[["list", "العملاء"], ["groups", "المجموعات"], ["wa", "رسائل واتساب"]].map(([k, n]) => `<button data-act="cuTab" data-k="${k}" class="${C.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  if (cx && C.tab !== "list" && M.cx) return h + M.cx.view(C.tab);
  h += `<div class="grid g4"><div class="card kpi lux rise"><div class="lbl">عملاء متسجلين</div><div class="val">${num(L.length)}</div></div>
   <div class="card kpi rise" style="--d:1"><div class="lbl">نقاط ولاء قائمة</div><div class="val">${num(pts)}</div><div class="dim" style="font-size:12px">${st.loyalty_on ? `كل ${fmt(st.loyalty_per)} = نقطة · النقطة = ${fmt(st.loyalty_value, 1)} · القيمة ${fmt(pts * +st.loyalty_value)}` : "برنامج الولاء متوقف"}</div></div>
   <div class="card kpi rise" style="--d:2"><div class="lbl">ضمانات أجهزة سارية</div><div class="val">${num(L.reduce((a, c) => a + +c.warranties, 0))}</div><div class="dim" style="font-size:12px">مرتبطة بالمسلسل والعميل</div></div>
   <div class="card kpi rise" style="--d:3"><div class="lbl">عملاء متكررين</div><div class="val">${rep}%</div><div class="dim" style="font-size:12px">اشتروا أكتر من مرة</div></div></div>`;
  h += `<div class="card rise"><h3>البحث عن ضمان بالمسلسل</h3><div class="row" style="gap:8px"><input class="inp num" style="max-width:300px" id="snQ" placeholder="الرقم التسلسلي"><button class="btn gold" data-act="snLook">بحث</button></div><div id="snRes" style="margin-top:10px"></div></div>`;
  const F = cuFiltered(), sel = new Set(C.sel), allSel = F.length > 0 && F.every(c => sel.has(c.id)), f = C.f;
  h += `<div class="card rise"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
     <div class="field" style="flex:1;min-width:200px"><label>بحث</label><input class="inp" id="cuQ" placeholder="الاسم أو الموبايل أو المنطقة" value="${esc(C.q)}"></div>
     <div class="field" style="min-width:150px"><label>الترتيب</label><select class="inp" id="cuSort">${Object.entries(cuSorts).map(([k, [n]]) => `<option value="${k}" ${C.sort === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
     <div class="field" style="width:110px"><label>فواتير على الأقل</label><input class="inp num" type="number" min="0" data-cf="minInv" value="${esc(f.minInv || "")}"></div>
     <div class="field" style="width:130px"><label>مشتريات على الأقل</label><input class="inp num" type="number" min="0" data-cf="minSpent" value="${esc(f.minSpent || "")}"></div>
     <div class="field" style="width:120px"><label>مجاش من (يوم)</label><input class="inp num" type="number" min="0" data-cf="away" value="${esc(f.away || "")}"></div>
     ${cx ? `<label class="row" style="gap:6px;padding-bottom:10px"><input type="checkbox" data-cf="phone" ${f.phone ? "checked" : ""}> ليه موبايل</label>` : ""}
     ${Object.values(f).some(Boolean) ? `<button class="btn sm ghost" data-act="cuClear" style="margin-bottom:6px">مسح الفلاتر</button>` : ""}</div>
   ${cx && sel.size ? `<div class="okbox row" style="gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px"><b>${num(sel.size)} عميل مختار</b><button class="btn sm gold" data-act="cxToGroup">إضافة لمجموعة</button><button class="btn sm" data-act="cxWaSel">رسالة واتساب للمختارين</button><button class="btn sm ghost" data-act="cuSelNone">إلغاء الاختيار</button></div>` : ""}
   <div class="tw"><table><thead><tr>${cx ? `<th style="width:28px"><input type="checkbox" data-act="cuSelAll" ${allSel ? "checked" : ""} title="اختيار الكل"></th>` : ""}<th class="n" style="width:36px">#</th><th>العميل</th><th>الموبايل</th><th>الفئة</th><th class="n">الفواتير</th><th class="n">إجمالي المشتريات</th><th class="n">النقاط</th><th class="n">ضمانات</th><th>آخر زيارة</th></tr></thead><tbody>${F.slice(0, 400).map((c, i) => { const tr = tier(+c.spent); return `<tr data-act="cuOpen" data-id="${c.id}" style="cursor:pointer">${cx ? `<td><input type="checkbox" data-act="cuSel" data-id="${c.id}" ${sel.has(c.id) ? "checked" : ""}></td>` : ""}<td class="n dim">${i + 1}</td><td class="pname">${esc(c.name)}${c.area ? `<br><span class="dim" style="font-size:12px">${esc(c.area)}</span>` : ""}</td><td class="num">${esc(c.phone || "—")}</td><td>${chip(tr[0], tr[1])}</td><td class="n">${num(c.invoices)}</td><td class="n">${fmt(c.spent)}</td><td class="n" style="color:var(--gold)">${num(c.points)}</td><td class="n">${num(c.warranties)}</td><td class="muted">${c.last ? dt(c.last) : "—"}</td></tr>`; }).join("") || empty(cx ? 10 : 9, L.length ? "مفيش نتيجة." : "لسه مفيش عملاء — العميل بيتسجّل لوحده لما الكاشير يكتب موبايله في الفاتورة.")}</tbody></table></div>${F.length > 400 ? `<p class="dim">ظاهر أول ٤٠٠ من ${num(F.length)} — دقّق البحث.</p>` : `<p class="dim" style="margin-bottom:0">${num(F.length)} عميل</p>`}</div>`;
  return h;
};
H.customers = () => { const qi = $("#cuQ"); if (qi) qi.oninput = () => { S.cu.q = qi.value; const p = qi.selectionStart; render(); const n = $("#cuQ"); n.focus(); n.setSelectionRange(p, p); };
  const so = $("#cuSort"); if (so) so.onchange = () => { S.cu.sort = so.value; render(); };
  document.querySelectorAll("[data-cf]").forEach(x => { x.onchange = () => { S.cu.f[x.dataset.cf] = x.type === "checkbox" ? x.checked : x.value; render(); }; });
  if (M.cx && M.cx.bind) M.cx.bind();
  const sn = $("#snQ"); if (sn) sn.onkeydown = e => { if (e.key === "Enter") document.querySelector("[data-act=snLook]").click(); }; };
function cuEditModal(c) {
  const x = c || { name: "", phone: "", area: "", address: "", notes: "" };
  modal(`<h2>${c ? "تعديل بيانات العميل" : "عميل جديد"}</h2><div class="stack"><div class="grid g2"><div class="field"><label>الاسم</label><input class="inp" id="cN" value="${esc(x.name)}"></div><div class="field"><label>الموبايل</label><input class="inp num" id="cP" value="${esc(x.phone || "")}" inputmode="tel"></div>
   <div class="field"><label>المنطقة</label><input class="inp" id="cA" value="${esc(x.area || "")}"></div><div class="field"><label>العنوان</label><input class="inp" id="cD" value="${esc(x.address || "")}"></div></div>
   <div class="field"><label>ملاحظات</label><input class="inp" id="cO" value="${esc(x.notes || "")}"></div><div id="cErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cuSave" data-id="${c ? c.id : ""}">حفظ</button></div></div>`);
}
async function cuOpen(id) {
  const c = S.cu.list.find(x => x.id === id); if (!c) return;
  try { const hs = await rpc("customer_history", { p_token: T(), p_customer: id }), st = S.store || {}, tr = tier(+hs.spent), wa = String(c.phone || "").replace(/^0/, "20");
    modal(`<h2>${esc(c.name)} ${chip(tr[0], tr[1])}</h2><p class="muted" style="margin:0 0 10px">${esc(c.phone || "")}${c.area ? " · " + esc(c.area) : ""}${c.address ? " · " + esc(c.address) : ""}</p>
     <div class="grid g3"><div class="card kpi"><div class="lbl">المشتريات</div><div class="val">${fmt(hs.spent)}</div></div><div class="card kpi"><div class="lbl">النقاط</div><div class="val" style="color:var(--gold)">${num(hs.points)}</div><div class="dim" style="font-size:12px">= ${fmt(hs.points * +st.loyalty_value, 1)}</div></div><div class="card kpi"><div class="lbl">الفواتير</div><div class="val">${num(hs.sales.filter(s => s.status === "posted").length)}</div></div></div>
     <div class="row" style="gap:8px;margin:10px 0;flex-wrap:wrap">${can("customers", "e") ? `<button class="btn sm" data-act="cuEdit" data-id="${id}">تعديل البيانات</button><button class="btn sm" data-act="cuPts" data-id="${id}" data-k="redeem">استبدال نقاط</button>` : ""}${isTop() ? `<button class="btn sm ghost" data-act="cuPts" data-id="${id}" data-k="adjust">تسوية نقاط</button>` : ""}${c.phone ? `<a class="btn sm ghost" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">واتساب</a>` : ""}</div>
     ${hs.serials.length ? `<h3>الأجهزة والضمان</h3><div class="tw"><table><tbody>${hs.serials.map(s => `<tr><td>${esc(s.item)}<br><span class="dim num" style="font-size:12px">SN ${esc(s.serial)}</span></td><td class="num dim">${dd(s.sold)}</td><td>${+s.months ? (s.until >= today() ? chip("ساري لحد " + s.until, "ok") : chip("انتهى " + s.until, "bad")) : chip("من غير ضمان")}</td></tr>`).join("")}</tbody></table></div>` : ""}
     <h3>الفواتير <span class="dim" style="font-size:12px;font-weight:400">اضغط على الفاتورة لتفاصيلها</span></h3><div class="tw" style="max-height:260px;overflow:auto"><table><tbody>${hs.sales.map(s => `<tr data-act="cuSale" data-id="${s.id}" data-c="${id}" style="cursor:pointer" title="تفاصيل الفاتورة"><td class="num">${esc(s.no)}</td><td class="dim">${esc(locName(s.loc))} · ${dt(s.at)}</td><td class="n">${fmt(s.total, 1)}</td><td>${s.status === "void" ? chip("ملغاة", "bad") : ""}</td></tr>`).join("") || empty(4, "مفيش فواتير.")}</tbody></table></div>
     ${hs.loyalty.length ? `<h3>حركات النقاط</h3><div class="tw"><table><tbody>${hs.loyalty.map(l => `<tr><td class="num dim">${dt(l.at)}</td><td>${l.kind === "redeem" ? "استبدال" : "تسوية"} · ${esc(l.note)}</td><td class="n" style="color:${l.points < 0 ? "var(--bad)" : "var(--ok)"}">${l.points > 0 ? "+" : ""}${num(l.points)}</td></tr>`).join("")}</tbody></table></div>` : ""}
     ${c.notes ? `<p class="dim">${esc(c.notes)}</p>` : ""}<div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn ghost" data-act="mClose">قفل</button></div>`);
  } catch (e) { toast(errText(e), true); }
}
function cuPtsModal(id, k) {
  const c = S.cu.list.find(x => x.id === id), st = S.store || {};
  modal(`<h2>${k === "redeem" ? "استبدال نقاط" : "تسوية نقاط"} · ${esc(c.name)}</h2><p class="muted">الرصيد الحالي ${num(c.points)} نقطة${k === "redeem" ? ` = ${fmt(c.points * +st.loyalty_value, 1)}. الاستبدال بيتسجّل هنا، وقيمته بتتعمل خصم للعميل على الفاتورة أو هدية حسب سياسة المحل.` : ". التسوية للمالك والمدير العام (موجب يزوّد وسالب ينقّص)."}</p>
   <div class="stack"><div class="grid g2"><div class="field"><label>عدد النقاط</label><input class="inp num" type="number" id="lpN" ${k === "redeem" ? `min="1" max="${Math.max(0, c.points)}"` : ""}></div><div class="field"><label>${k === "redeem" ? "اتستبدلت بإيه" : "السبب"}</label><input class="inp" id="lpR"></div></div><div id="lpV" class="dim"></div><div id="lpErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="cuPtsGo" data-id="${id}" data-k="${k}">تسجيل</button></div></div>`);
  $("#lpN").oninput = () => { $("#lpV").textContent = "القيمة: " + fmt((+$("#lpN").value || 0) * +st.loyalty_value, 1); };
}
function cuLoyModal() { const st = S.store || {};
  modal(`<h2>إعدادات الولاء</h2><div class="stack"><label class="row" style="gap:8px"><input type="checkbox" id="lyOn" ${st.loyalty_on ? "checked" : ""}> برنامج الولاء شغّال</label>
   <div class="grid g2"><div class="field"><label>كل كام جنيه مشتريات = نقطة</label><input class="inp num" type="number" min="1" id="lyPer" value="${+st.loyalty_per || 100}"></div><div class="field"><label>قيمة النقطة الواحدة (جنيه)</label><input class="inp num" type="number" min="0" step="0.05" id="lyVal" value="${+st.loyalty_value || 0.5}"></div></div>
   <p class="dim" style="margin:0;font-size:12.5px">النقاط بتتحسب من صافي مشتريات العميل (بعد المرتجعات) لما الكاشير يكتب موبايله في الفاتورة. تغيير النسبة بيعيد حساب النقاط على كل المشتريات.</p><div id="lyErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cuLoySave">حفظ</button></div></div>`); }

/* =====================================================================
   التوصيل والتركيب
   ===================================================================== */
const DST = [["new", "جديد", "بدء التجهيز"], ["prep", "قيد التجهيز", "خرج للتوصيل"], ["way", "في الطريق", "تأكيد التسليم"], ["delivered", "اتسلّم", "إغلاق الطلب"], ["closed", "اتركّب / اتقفل", ""]];
async function loadDlv() { const D = S.dl || (S.dl = { loc: "all" }); const since = new Date(Date.now() - 45 * 864e5).toISOString();
  D.list = await q("deliveries", "*", x => x.or(`status.in.(new,prep,way,delivered),updated_at.gte.${since}`).order("scheduled", { ascending: true, nullsFirst: false }).order("created_at").limit(600)); D.loaded = true; }
V.delivery = () => {
  const D = S.dl; if (!D || !D.loaded) return header() + later(loadDlv, "delivery");
  const L = D.list.filter(d => myLoc(d.location_id) && (D.loc === "all" || d.location_id === +D.loc)), open = L.filter(d => ["new", "prep", "way"].includes(d.status)), ed = can("delivery", "e");
  let h = header(`<select class="inp" id="dlL" style="width:auto"><option value="all">كل المعارض</option>${shows().map(l => `<option value="${l.id}" ${D.loc === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>${can("delivery", "a") ? `<button class="btn gold" data-act="dlNew">${ico("plus")} طلب توصيل</button>` : ""}`);
  h += `<p class="muted rise" style="margin:0">${open.length} طلب مفتوح · ${L.filter(d => d.status !== "cancelled" && d.scheduled === today()).length} النهارده${L.some(d => d.status === "cancelled") ? ` · ${L.filter(d => d.status === "cancelled").length} ملغي` : ""}</p>`;
  h += `<div class="kan rise">${DST.map(([k, n, nx]) => { const its = L.filter(d => d.status === k); return `<div class="kcol"><h4>${n}<span class="num dim">${its.length}</span></h4>${its.map((d, i) => `<div class="kcard" style="animation-delay:${i * 60}ms;cursor:pointer" data-act="dlOpen" data-id="${d.id}"><div class="row between"><span class="num dim">${esc(d.no)}</span>${d.install ? chip("تركيب", "gold") : ""}</div><b>${esc(d.customer_name)}</b>${d.items ? `<span>${esc(d.items)}</span>` : ""}<span class="dim">${esc(d.area || d.address)} · ${d.scheduled ? dd(d.scheduled) : "من غير ميعاد"}${d.slot ? " · " + esc(d.slot) : ""}</span>${d.driver ? `<span class="dim">المندوب: ${esc(d.driver)}${d.installer ? " · الفني: " + esc(d.installer) : ""}</span>` : ""}${d.scheduled && d.scheduled < today() && ["new", "prep", "way"].includes(k) ? chip("متأخر", "bad") : ""}
       ${nx && ed ? `<button class="btn sm" data-act="dlNext" data-id="${d.id}" style="margin-top:4px">${k === "delivered" && d.install ? "تم التركيب وإغلاق" : nx}</button>` : ""}</div>`).join("")}</div>`; }).join("")}</div>`;
  return h;
};
H.delivery = () => { const l = $("#dlL"); if (l) l.onchange = () => { S.dl.loc = l.value; render(); }; };
async function dlModal(d, saleId) {
  let x = d || { customer_name: "", phone: "", address: "", area: "", scheduled: today(), slot: "", install: false, items: "", driver: "", installer: "", note: "", location_id: defLoc() }, sale = null;
  if (saleId) { try { const s = (await q("sales", "*", y => y.eq("id", saleId)))[0], c = s.customer_id ? (await q("customers", "*", y => y.eq("id", s.customer_id)))[0] : null; sale = s;
      Object.assign(x, { customer_name: c ? c.name : "", phone: c ? c.phone : "", address: c && c.address || "", area: c && c.area || "", location_id: s.location_id }); } catch (e) { return toast(errText(e), true); } }
  const ro = d && ["closed", "cancelled"].includes(d.status);
  modal(`<h2>${d ? `طلب ${esc(d.no)}` : "طلب توصيل جديد"}${sale ? ` · فاتورة ${esc(sale.no)}` : ""}</h2><div class="stack">
   ${!d && !saleId ? `<div class="field"><label>رقم الفاتورة (اختياري — بيجيب الأصناف والعميل لوحده)</label><input class="inp num" id="dIv" placeholder="INV-000123"></div>` : ""}
   <div class="grid g2"><div class="field"><label>اسم العميل</label><input class="inp" id="dN" value="${esc(x.customer_name)}"></div><div class="field"><label>الموبايل</label><input class="inp num" id="dP" value="${esc(x.phone || "")}"></div>
   <div class="field"><label>العنوان</label><input class="inp" id="dA" value="${esc(x.address || "")}"></div><div class="field"><label>المنطقة</label><input class="inp" id="dR" value="${esc(x.area || "")}"></div>
   <div class="field"><label>ميعاد التوصيل</label><input class="inp" type="date" id="dS" value="${esc(x.scheduled || "")}"></div><div class="field"><label>الفترة</label><select class="inp" id="dT">${["", "الصبح", "الضهر", "بالليل"].map(v => `<option ${x.slot === v ? "selected" : ""} value="${v}">${v || "أي وقت"}</option>`).join("")}</select></div>
   <div class="field"><label>المندوب</label><input class="inp" id="dDr" value="${esc(x.driver || "")}"></div><div class="field"><label>فني التركيب</label><input class="inp" id="dIn" value="${esc(x.installer || "")}"></div>
   ${!d && !saleId ? `<div class="field"><label>المعرض</label><select class="inp" id="dL">${shows().map(l => `<option value="${l.id}" ${l.id === x.location_id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>` : ""}</div>
   ${saleId ? "" : `<div class="field"><label>الأصناف</label><input class="inp" id="dI" value="${esc(x.items || "")}" placeholder="${d ? "" : "لو فيه رقم فاتورة بتتملى لوحدها"}"></div>`}
   <label class="row" style="gap:8px"><input type="checkbox" id="dX" ${x.install ? "checked" : ""}> محتاج تركيب</label><div class="field"><label>ملاحظات</label><input class="inp" id="dO" value="${esc(x.note || "")}"></div>
   ${d && d.log && d.log.length ? `<div class="tw"><table><tbody>${d.log.map(l => `<tr><td class="num dim">${dt(l.at)}</td><td>${esc((DST.find(s => s[0] === l.to) || [0, l.to === "cancelled" ? "ملغي" : l.to])[1])}</td><td>${esc(l.by || "")}${l.note ? " · " + esc(l.note) : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}<div id="dErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">${d && !ro && can("delivery", "e") ? `<button class="btn danger" data-act="dlCancel" data-id="${d.id}" style="margin-inline-end:auto">إلغاء الطلب</button>${d.status === "way" ? `<button class="btn ghost" data-act="dlBack" data-id="${d.id}">رجع المعرض</button>` : ""}` : ""}<button class="btn ghost" data-act="mClose">قفل</button>${!ro && (d ? can("delivery", "e") : can("delivery", "a")) ? `<button class="btn gold" data-act="dlSave" data-id="${d ? d.id : ""}" data-sale="${saleId || ""}">حفظ</button>` : ""}</div></div>`);
}
function dlNoteModal(id, to, title, label) {
  modal(`<h2>${esc(title)}</h2><div class="stack"><div class="field"><label>${esc(label)}</label><input class="inp" id="dnN"></div><div id="dnErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="dlMove" data-id="${id}" data-to="${to}">تأكيد</button></div></div>`);
}

/* =====================================================================
   الطابعات والملصقات
   ===================================================================== */
const PKIND = { thermal: "حرارية (إيصالات)", laser: "ليزر / إنك جيت", label: "طابعة باركود" }, PLANG = { escpos: "ESC/POS", windows: "تعريف ويندوز", zpl: "ZPL", tspl: "TSPL", epl: "EPL" }, PCONN = { usb: "USB", ip: "شبكة IP", bt: "بلوتوث", shared: "طابعة ويندوز مشتركة" };
const PDOCS = [["sale", "فاتورة البيع"], ["reports", "التقارير"], ["labels", "الملصقات"], ["docs", "مستندات المخزن"]], PSIZES = ["58", "80", "A4", "A5", "40x30", "50x30", "58x40", "100x50"];
const LSIZES = { "40x30": [40, 30], "50x30": [50, 30], "58x40": [58, 40], "100x50": [100, 50] };
const LEL = [["store", "اسم المحل"], ["name", "اسم الصنف"], ["bc", "الباركود"], ["price", "السعر"], ["var", "المقاس / اللون"], ["sn", "الرقم التسلسلي (أجهزة)"]];
const setup = () => isTop() || has("printerSetup"), lblRight = () => isTop() || has("labels") || has("printerSetup");
async function loadPrint() {
  const P = S.pr || (S.pr = { tab: "printers", loc: defLoc(), dev: "", bloc: defLoc(), sel: {}, bq: "" });
  const [printers, map, tpls, devs, prints] = await Promise.all([q("printers", "*", x => x.order("id")), q("print_map", "*"), q("label_templates", "*", x => x.order("id")), q("devices", "id,name,location_id,kind,active", x => x.order("name")), q("label_prints", "item_id", x => x.limit(20000))]);
  Object.assign(P, { printers, map, tpls, devs, printed: new Set(prints.map(p => p.item_id)), loaded: true });
  if (!P.lbl) { const t = tpls.find(t => t.is_default) || tpls[0]; P.lbl = t ? lblFrom(t) : lblFrom({ name: "ملصق", w: 50, h: 30, code: "code128", els: {} }); }
}
function lblFrom(t) { const base = { store: { on: 1, x: 2, y: 1.5, fs: 2.2 }, name: { on: 1, x: 2, y: 5, fs: 2.6 }, bc: { on: 1, x: 2, y: 9.5, w: 46, h: 12 }, var: { on: 0, x: 2, y: 23, fs: 2.2 }, sn: { on: 0, x: 26, y: 23, fs: 2 }, price: { on: 1, x: 30, y: 23.5, fs: 3.6 } };
  const els = JSON.parse(JSON.stringify(base)); Object.entries(t.els || {}).forEach(([k, v]) => { els[k] = Object.assign(els[k] || {}, v); });
  const sz = Object.keys(LSIZES).find(k => LSIZES[k][0] === +t.w && LSIZES[k][1] === +t.h) || "custom";
  return { id: t.id || null, name: t.name, w: +t.w, h: +t.h, code: t.code || "code128", size: sz, els }; }
const itCode = (it, type) => type === "ean13" ? (eanOk(it.barcode || "") ? it.barcode : null) : (it.barcode || it.code);
function lblHTML(L0, it, mm) { const u = mm ? "mm" : "px", k = mm ? 1 : 6, e = L0.els, parts = [];
  const pos = (key, o) => `style="position:absolute;left:${o.x * k}${u};top:${o.y * k}${u};${o.fs ? `font-size:${o.fs * k}${u};line-height:1.1;white-space:nowrap;` : ""}${o.w ? `width:${o.w * k}${u};height:${o.h * k}${u};` : ""}" data-el="${key}"`;
  let type = L0.code, code = itCode(it, type); if (!code && type === "ean13") { type = "code128"; code = it.barcode || it.code; }
  if (e.store.on) parts.push(`<div class="lel" ${pos("store", e.store)}>${esc((S.store && S.store.name) || "")}</div>`);
  if (e.name.on) parts.push(`<div class="lel b" ${pos("name", e.name)}><b>${esc(String(it.name).split("—")[0].trim())}</b></div>`);
  if (e.bc.on) parts.push(`<div class="lel" ${pos("bc", e.bc)}>${codeSVG(code, type, 40) || ""}</div>`);
  if (e.var.on && it.variants) parts.push(`<div class="lel" ${pos("var", e.var)}>${esc(String(it.variants).split(/[·,]/)[0])}</div>`);
  if (e.sn.on && it.sn) parts.push(`<div class="lel" ${pos("sn", e.sn)}>SN ${esc(it.sn)}</div>`);
  if (e.price.on) parts.push(`<div class="lel b" ${pos("price", e.price)}><b>${fmt(it.sale_price)}</b></div>`);
  return `<div class="lblcanvas" ${mm ? "" : `id="lblCanvas"`} style="position:relative;overflow:hidden;background:#fff;color:#111;width:${L0.w * k}${u};height:${L0.h * k}${u}">${parts.join("")}</div>`; }
const sample = () => S.items[0] || { name: "طقم حلل جرانيت ١٠ قطع", code: "IT-00001", barcode: "6223001234567", sale_price: 4200, variants: "رمادي" };
V.print = () => {
  const P = S.pr; if (!P || !P.loaded) return header() + later(loadPrint, "print");
  const tabs = [["printers", "الطابعات"], ["map", "جدول الربط"], ["rtpl", "قالب الإيصال"], ["lbl", "محرر الملصقات"], ["batch", "طباعة ملصقات"], ["agent", "برنامج الطباعة"]];
  let h = header(`<div class="tabs">${tabs.map(([k, n]) => `<button data-act="prTab" data-k="${k}" class="${P.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`);
  const pn = id => (P.printers.find(p => p.id === id) || {}).name || "—";
  if (P.tab === "printers") {
    h += `<div class="card rise"><h3>الطابعات${setup() ? `<button class="btn sm gold" data-act="prNew" style="margin-inline-start:auto">${ico("plus")} طابعة</button>` : ""}</h3><div class="tw"><table><thead><tr><th>الطابعة</th><th>النوع واللغة</th><th>الاتصال</th><th>المكان</th><th>الورق</th><th>الحالة</th><th></th></tr></thead><tbody>${P.printers.map(p => `<tr><td class="pname">${esc(p.name)}</td><td>${esc(PKIND[p.kind])} · ${esc(PLANG[p.lang] || p.lang)}</td><td>${esc(PCONN[p.conn] || p.conn)}${p.addr ? `<br><span class="dim num" style="font-size:12px">${esc(p.addr)}</span>` : ""}</td><td>${p.location_id ? esc(locName(p.location_id)) : "كل الأماكن"}</td><td class="num">${esc(p.paper)}</td><td>${p.active ? chip("شغّالة", "ok") : chip("موقوفة")}${window.MZPA && MZPA.st.ok ? (MZPA.usable(p) ? `<br>${chip("صامتة ✓", "ok")}` : `<br>${chip(p.addr ? "مش لاقيها على الجهاز ده" : "من غير اسم ويندوز", "warn")}`) : ""}</td><td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-act="prTest" data-id="${p.id}">طباعة تجريبية</button>${setup() ? `<button class="btn sm ghost" data-act="prEdit" data-id="${p.id}">تعديل</button>` : ""}</td></tr>`).join("") || empty(7, "لسه مفيش طابعات متسجلة.")}</tbody></table></div>
     <p class="dim" style="font-size:12.5px;margin-bottom:0">الطباعة من المتصفح بتفتح نافذة الطباعة بمقاس الورق المضبوط هنا — اختار الطابعة المربوطة مرة واحدة على كل جهاز. طابعات الباركود (ZPL / TSPL) ليها كمان ملف أوامر مباشر من «طباعة ملصقات». للطباعة على طول من غير نافذة: نزّل «برنامج الطباعة» على جهاز الكاشير، واكتب في كل طابعة اسمها في ويندوز (أو الـ IP لطابعات الشبكة).</p></div>`;
  }
  if (P.tab === "map") {
    const rows = PDOCS.map(([k]) => P.map.find(m => m.location_id === +P.loc && (m.device_id || "") === P.dev && m.doc === k) || { doc: k, printer_id: null, size: k === "sale" ? "80" : k === "labels" ? "50x30" : "A4", copies: 1, fallback_id: null, locked: false });
    const locked = rows.some(r => r.id) && rows.every(r => !r.id || r.locked), dis = locked || !setup() ? "disabled" : "";
    h += `<div class="card rise"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="field" style="min-width:160px"><label>المكان</label><select class="inp" id="pmL">${myLocs().map(l => `<option value="${l.id}" ${+P.loc === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
     <div class="field" style="min-width:200px"><label>الجهاز</label><select class="inp" id="pmD"><option value="">كل أجهزة المكان</option>${P.devs.filter(d => d.location_id === +P.loc || !d.location_id).map(d => `<option value="${d.id}" ${P.dev === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
     <div style="margin-inline-start:auto;align-self:end">${setup() ? (locked ? `<button class="btn" data-act="pmUnlock">فتح القفل للتعديل</button>` : `<button class="btn gold" data-act="pmSave">حفظ وقفل</button>`) : `<span class="dim">التعديل لصاحب صلاحية «إعداد الطابعات»</span>`}</div></div>
     <div class="tw"><table><thead><tr><th>نوع الطباعة</th><th>الطابعة</th><th>المقاس</th><th class="n">النسخ</th><th>بديل لو اتفصلت</th></tr></thead><tbody>${rows.map(r => `<tr data-pm="${r.doc}"><td>${esc(PDOCS.find(d => d[0] === r.doc)[1])}</td><td><select class="inp" data-f="printer_id" ${dis}><option value="">—</option>${P.printers.filter(p => p.active).map(p => `<option value="${p.id}" ${r.printer_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></td><td><select class="inp" data-f="size" ${dis}>${PSIZES.map(s => `<option ${r.size === s ? "selected" : ""}>${s}</option>`).join("")}</select></td><td><input class="inp num" type="number" min="1" max="5" data-f="copies" value="${r.copies || 1}" ${dis} style="width:70px"></td><td><select class="inp" data-f="fallback_id" ${dis}><option value="">من غير بديل</option>${P.printers.filter(p => p.active).map(p => `<option value="${p.id}" ${r.fallback_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>
     <p class="dim" style="font-size:12.5px;margin-bottom:0">${locked ? "الربط مقفول. أي تغيير محتاج فتح القفل وبيتسجّل في سجل التدقيق." : "بتعدّل دلوقتي — احفظ واقفل لما تخلص."} الربط الخاص بجهاز معيّن بيتقدّم على ربط «كل أجهزة المكان».</p><div id="pmErr"></div></div>`;
  }
  if (P.tab === "rtpl") {
    const r = Object.assign({ size: "80", logo: true, name: true, savings: true, qr: true, addr: "", phone: "", footer: "" }, S.store.receipt || {}), ed = setup() ? "" : "disabled", w = { "58": 220, "80": 300, "A5": 420, "A4": 520 }[r.size] || 300;
    h += `<div class="grid g2"><div class="card rise"><h3>قالب الإيصال</h3><div class="stack"><div class="field"><label>مقاس الورق</label><select class="inp" id="rtS" ${ed}>${["58", "80", "A5", "A4"].map(s => `<option value="${s}" ${r.size === s ? "selected" : ""}>${/\d/.test(s[0]) ? s + " مم" : s}</option>`).join("")}</select></div>
      ${[["logo", "الشعار" + (M.LOGO() ? "" : " (ارفعه من الإعدادات والضريبة)")], ["name", "اسم المحل"], ["savings", "سطر «وفّرت»"], ["qr", "QR صفحة المحل (اللينكات من الإعدادات)"]].map(([k, n]) => `<label class="row" style="gap:8px"><input type="checkbox" data-rt="${k}" ${r[k] !== false ? "checked" : ""} ${ed}> ${n}</label>`).join("")}
      ${[["addr", "العنوان"], ["phone", "التليفون"], ["footer", "نص أسفل الفاتورة"]].map(([k, n]) => `<div class="field"><label>${n}</label><input class="inp" data-rt="${k}" value="${esc(r[k] || "")}" ${ed}></div>`).join("")}
      ${setup() ? `<button class="btn gold" data-act="rtSave" style="align-self:flex-start">حفظ القالب</button>` : ""}<div id="rtErr"></div></div></div>
     <div class="card rise"><h3>المعاينة</h3><div class="receipt" style="width:${w}px;max-width:100%;margin:0 auto;background:#fff;color:#111;padding:12px;border-radius:6px;font-size:12px">${r.logo !== false && M.LOGO() ? `<div style="text-align:center;margin-bottom:4px">${M.logoImg("54px", "max-width:160px")}</div>` : ""}${r.name !== false ? `<div style="text-align:center;font-weight:700;font-size:15px">${esc(S.store.name)}</div>` : ""}${r.addr || r.phone ? `<div style="text-align:center;color:#555">${esc([r.addr, r.phone].filter(Boolean).join(" · "))}</div>` : ""}<div style="text-align:center;color:#555">INV-000123 · ${new Date().toLocaleDateString("ar-EG")}</div><div style="border-top:1px dashed #000;margin:6px 0"></div>
      <div class="row between"><span>طقم حلل جرانيت × 1</span><span>4,200</span></div><div class="row between"><span>فوطة × 3</span><span>2,250</span></div><div class="row between"><span>خصم العروض</span><span>−630</span></div><div style="border-top:1px dashed #000;margin:6px 0"></div><div class="row between"><b>الإجمالي</b><b>5,820 ج.م</b></div>
      ${r.savings !== false ? `<div style="text-align:center;margin-top:6px">وفّرت 630 ج.م</div>` : ""}${M.cx ? M.cx.rcptExtra(1, "أحمد", true) : ""}${r.footer ? `<div style="text-align:center;margin-top:6px;color:#555">${esc(r.footer)}</div>` : ""}</div></div></div>`;
  }
  if (P.tab === "lbl") {
    const Lb = P.lbl, ed = lblRight(), it = S.items.find(i => i.id === P.pid) || sample();
    h += `<div class="grid g2"><div class="card rise"><h3>محرر الملصقات <span class="dim" style="font-size:12px;font-weight:400">اسحب العناصر جوه الملصق</span></h3><div class="stack">
      <div class="grid g2"><div class="field"><label>القالب</label><select class="inp" id="lbT"><option value="">قالب جديد</option>${P.tpls.map(t => `<option value="${t.id}" ${Lb.id === t.id ? "selected" : ""}>${esc(t.name)}${t.is_default ? " (الافتراضي)" : ""}</option>`).join("")}</select></div><div class="field"><label>اسم القالب</label><input class="inp" id="lbN" value="${esc(Lb.name)}"></div>
      <div class="field"><label>المقاس (مم)</label><select class="inp" id="lbS">${Object.keys(LSIZES).map(s => `<option value="${s}" ${Lb.size === s ? "selected" : ""}>${s.replace("x", "×")}</option>`).join("")}<option value="custom" ${Lb.size === "custom" ? "selected" : ""}>مخصص</option></select></div>
      <div class="field"><label>نوع الباركود</label><select class="inp" id="lbC">${[["code128", "Code 128"], ["ean13", "EAN-13"], ["code39", "Code 39"], ["qr", "QR"]].map(([k, n]) => `<option value="${k}" ${Lb.code === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      ${Lb.size === "custom" ? `<div class="field"><label>العرض</label><input class="inp num" type="number" id="lbW" value="${Lb.w}" min="20" max="120"></div><div class="field"><label>الطول</label><input class="inp num" type="number" id="lbH" value="${Lb.h}" min="15" max="100"></div>` : ""}
      <div class="field" style="grid-column:1/-1"><label>الصنف للمعاينة</label><select class="inp" id="lbP">${S.items.slice(0, 500).map(x => `<option value="${x.id}" ${x.id === it.id ? "selected" : ""}>${esc(x.name)}</option>`).join("") || `<option>صنف تجريبي</option>`}</select></div></div>
      ${LEL.map(([k, n]) => `<div class="row between" style="gap:8px"><label class="row" style="gap:8px"><input type="checkbox" data-le="${k}" ${Lb.els[k].on ? "checked" : ""}> ${n}</label>${Lb.els[k].fs ? `<span class="row" style="gap:4px"><button class="btn sm ghost" data-act="lbFs" data-k="${k}" data-d="-0.2">−</button><button class="btn sm ghost" data-act="lbFs" data-k="${k}" data-d="0.2">+</button></span>` : ""}</div>`).join("")}
      <label class="row" style="gap:8px"><input type="checkbox" id="lbDef" ${Lb.id && (P.tpls.find(t => t.id === Lb.id) || {}).is_default ? "checked" : ""}> القالب الافتراضي للطباعة</label>
      ${ed ? `<div class="row" style="gap:8px"><button class="btn gold" data-act="lbSave">حفظ القالب</button>${Lb.id ? `<button class="btn ghost" data-act="lbCopy">حفظ كقالب جديد</button>` : ""}</div>` : `<p class="dim">حفظ القوالب لصاحب صلاحية الملصقات.</p>`}<div id="lbErr"></div></div></div>
     <div class="card rise"><h3>المعاينة <span class="dim num" style="font-size:12px;font-weight:400">${Lb.w}×${Lb.h} مم</span></h3><div style="display:flex;justify-content:center;padding:16px;background:var(--surf);border-radius:10px;overflow:auto">${lblHTML(Lb, it)}</div>
      ${Lb.code === "ean13" && !eanOk(it.barcode || "") ? `<div class="warnbox" style="margin-top:10px">الصنف ده ملوش باركود EAN-13 صالح — هيتطبع Code 128 بدل منه.</div>` : ""}<p class="dim" style="font-size:12.5px">EAN-13 بيتأكد من رقم الفحص، والأصناف اللي من غير باركود بتطلع بكودها الداخلي Code 128.</p><button class="btn" data-act="lbTest">طباعة تجريبية</button></div></div>`;
  }
  if (P.tab === "batch") {
    const ed = has("labels") || isTop(), tpl = P.tpls.find(t => t.id === +P.btpl) || P.tpls.find(t => t.is_default) || P.tpls[0], qq = norm(P.bq);
    const L = S.items.filter(i => !qq || norm(i.name + " " + i.code + " " + (i.barcode || "")).includes(qq)).slice(0, 300), stk = id => M.S.stock.filter(s => s.item_id === id && s.location_id === +P.bloc).reduce((a, s) => a + +s.qty, 0);
    const lp = P.printers.find(p => p.id === ((P.map.find(m => m.location_id === +P.bloc && m.doc === "labels" && !m.device_id) || {}).printer_id));
    const nSel = Object.values(P.sel).reduce((a, v) => a + (+v || 0), 0);
    h += `<div class="card rise"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><select class="inp" id="bL" style="width:auto">${myLocs().map(l => `<option value="${l.id}" ${+P.bloc === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select><select class="inp" id="bT" style="width:auto">${P.tpls.map(t => `<option value="${t.id}" ${tpl && tpl.id === t.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select><input class="inp" id="bQ" placeholder="بحث" value="${esc(P.bq)}" style="flex:1;min-width:160px">
      <span class="dim">${lp ? "الطابعة: " + esc(lp.name) : "مفيش طابعة ملصقات مربوطة للمكان"}</span></div>
      <div class="row" style="gap:8px;margin-bottom:10px;flex-wrap:wrap"><button class="btn gold" data-act="bPrint" ${ed && nSel ? "" : "disabled"}>طباعة المحدد (${num(nSel)} ملصق)</button>${lp && ["zpl", "tspl"].includes(lp.lang) ? `<button class="btn" data-act="bRaw" ${ed && nSel ? "" : "disabled"}>ملف ${esc(PLANG[lp.lang])} للطابعة</button>` : ""}<button class="btn ghost" data-act="bAll">عدد الملصقات = الرصيد</button><button class="btn ghost" data-act="bNone">مسح الاختيار</button>${ed ? "" : `<span class="dim">طباعة الملصقات صلاحية مستقلة.</span>`}</div>
      <div class="tw"><table><thead><tr><th>الصنف</th><th>الباركود</th><th class="n">الرصيد</th><th class="n">عدد الملصقات</th></tr></thead><tbody>${L.map(i => `<tr><td>${esc(i.name)}${P.printed.has(i.id) ? `<br>${chip("اتطبع قبل كده — إعادة الطباعة بتتسجّل", "warn")}` : ""}</td><td class="num">${esc(i.barcode || i.code)} ${eanOk(i.barcode || "") ? chip("EAN-13 ✓", "ok") : chip("Code 128")}</td><td class="n">${num(stk(i.id))}</td><td class="n"><input class="inp num" type="number" min="0" max="999" data-bq="${i.id}" value="${P.sel[i.id] || ""}" style="width:80px"></td></tr>`).join("") || empty(4, S.items.length ? "مفيش نتيجة." : "لسه مفيش أصناف.")}</tbody></table></div></div>`;
  }
  if (P.tab === "agent") { const A = window.MZPA, ag = P.ag;
    if (!ag) { setTimeout(() => agLoad().then(() => S.route === "print" && S.pr.tab === "agent" && render()), 0); return h + `<div class="spin"></div>`; }
    const stc = { waiting: chip("مستني", "warn"), printing: chip("بيطبع", "warn"), done: chip("اتطبع", "ok"), failed: chip("فشل", "bad"), cancelled: chip("اتلغى") };
    const ERRP = { PRINTER_OFFLINE: "الطابعة مقفولة أو مفصولة", PRINTER_NOT_FOUND: "الطابعة مش متعرّفة على الجهاز", PRINTER_UNREACHABLE: "مش قادر يوصل للطابعة على الشبكة", PRINTER_REFUSED: "الطابعة رفضت المهمة", PRINTER_WRITE_FAILED: "الطابعة وقفت في النص" };
    if (!A || !A.st.ok) h += `<div class="card rise"><h3>برنامج الطباعة ${chip("مش شغّال على الجهاز ده", "warn")}</h3>
      <p>البرنامج ده بيخلّي السيستم يطبع الإيصالات والملصقات على طول من غير نافذة الطباعة. بيتنزل مرة واحدة على كل جهاز كاشير وبيشتغل لوحده مع الويندوز.</p>
      <ol style="line-height:2;margin:0 0 12px;padding-inline-start:20px"><li>نزّل الملف وفك الضغط عنه.</li><li>دبل كليك على <b>install.cmd</b> (لو ويندوز حذّرك: More info ← Run anyway).</li><li>ارجع هنا ودوس «تحديث». لو المتصفح سأل «السماح بالوصول للأجهزة على الشبكة المحلية» اختار سماح.</li></ol>
      <div class="row" style="gap:8px"><a class="btn gold" href="agent/MinzoPrint.zip" download>${ico("export")} تنزيل برنامج الطباعة</a><button class="btn" data-act="agRefresh">تحديث</button></div>
      <p class="dim" style="font-size:12.5px;margin:10px 0 0">من غير البرنامج كل حاجة شغّالة عادي، بس الطباعة بتفتح نافذة الطباعة.</p></div>`;
    else {
      const jobs = ag.jobs || [], wp = A.st.printers;
      h += `<div class="grid g2 rise"><div class="card"><h3>برنامج الطباعة ${chip("شغّال", "ok")}<button class="btn sm ghost" data-act="agRefresh" style="margin-inline-start:auto">تحديث</button></h3>
        <div class="row" style="justify-content:space-between;margin:6px 0"><span class="dim">الجهاز</span><b>${esc(A.st.computer || "—")}</b></div><div class="row" style="justify-content:space-between;margin:6px 0"><span class="dim">نسخة البرنامج</span><b class="num">${esc(A.st.version)}</b></div>
        <label class="row" style="gap:8px;margin-top:10px"><input type="checkbox" id="agAuto" ${A.auto() ? "checked" : ""}> اطبع الإيصال لوحده بعد كل فاتورة (على الجهاز ده)</label>
        <div class="row" style="gap:8px;margin-top:12px"><a class="btn sm ghost" href="agent/MinzoPrint.zip" download>${ico("export")} تنزيل البرنامج تاني</a></div></div>
        <div class="card"><h3>الطابعات المتعرّفة على الجهاز</h3><div class="tw"><table><thead><tr><th>الاسم في ويندوز</th><th>الحالة</th><th>مربوطة بـ</th></tr></thead><tbody>${wp.map(w => { const mine = P.printers.filter(p => p.conn !== "ip" && p.addr === w.name); return `<tr><td>${esc(w.name)}${w.default ? " " + chip("الافتراضية") : ""}</td><td>${w.offline ? chip("مفصولة", "bad") : chip("متوصلة", "ok")}</td><td>${mine.length ? mine.map(p => esc(p.name)).join("، ") : `<span class="dim">—</span>`}</td></tr>`; }).join("") || empty(3, "مفيش طابعات متعرّفة على الويندوز.")}</tbody></table></div>
        <p class="dim" style="font-size:12.5px;margin-bottom:0">علشان طابعة تطبع صامت: افتحها من «الطابعات» واختار اسمها في ويندوز.</p></div></div>
        <div class="card rise"><h3>قائمة انتظار الطباعة ${ag.jobs.some(j => j.status === "failed") ? chip(ag.jobs.filter(j => j.status === "failed").length + " فشل", "bad") : ""}<button class="btn sm ghost" data-act="agClear" style="margin-inline-start:auto">مسح اللي خلص</button></h3>
        <div class="tw"><table><thead><tr><th>الوقت</th><th>المستند</th><th>الطابعة</th><th>الحالة</th><th class="n">محاولات</th><th></th></tr></thead><tbody>${jobs.map(j => `<tr><td class="num">${esc(dt(j.created))}</td><td>${esc(j.title)}${j.pages > 1 ? ` <span class="dim">(${j.pages})</span>` : ""}</td><td>${esc(j.target || j.printer)}${j.target && j.target !== j.printer ? `<br><span class="dim" style="font-size:12px">بديل عن ${esc(j.printer)}</span>` : ""}</td><td>${stc[j.status] || esc(j.status)}${j.error && j.status !== "done" ? `<br><span class="dim" style="font-size:12px">${esc(ERRP[j.error] || j.error)}</span>` : ""}</td><td class="n">${num(j.attempts)}</td><td class="row" style="gap:4px;flex-wrap:nowrap">${j.status === "failed" ? `<button class="btn sm" data-act="agRetry" data-id="${esc(j.id)}">إعادة</button>` : ""}${["waiting", "failed"].includes(j.status) ? `<button class="btn sm ghost" data-act="agCancel" data-id="${esc(j.id)}">إلغاء</button>` : ""}</td></tr>`).join("") || empty(6, "مفيش مهام طباعة لسه.")}</tbody></table></div>
        <p class="dim" style="font-size:12.5px;margin-bottom:0">لو الطابعة مفصولة، البرنامج بيحاول تاني لوحده 3 مرات، وبعدين بيحوّل على الطابعة البديلة من «جدول الربط» لو فيه واحدة. المهام بتفضل محفوظة لو الجهاز اتقفل.</p></div>`;
    }
  }
  return h;
};
async function agLoad() { const A = window.MZPA, P = S.pr; if (!A) { P.ag = { jobs: [] }; return; } await A.check(); let jobs = [];
  if (A.st.ok) { try { jobs = (await A.call("/jobs")).jobs || []; } catch (e) {} } P.ag = { jobs, at: Date.now() };
  clearTimeout(P.agT); if (A.st.ok && jobs.some(j => ["waiting", "printing"].includes(j.status))) P.agT = setTimeout(() => { if (S.route === "print" && S.pr.tab === "agent") agLoad().then(render); }, 2500); }
H.print = () => {
  const P = S.pr; if (!P || !P.loaded) return;
  const on = (id, ev, fn) => { const el = $(id); if (el) el[ev] = fn; };
  on("#pmL", "onchange", e => { P.loc = e.target.value; P.dev = ""; render(); }); on("#pmD", "onchange", e => { P.dev = e.target.value; render(); });
  if (P.tab === "lbl") { const Lb = P.lbl;
    on("#lbT", "onchange", e => { const t = P.tpls.find(x => x.id === +e.target.value); P.lbl = t ? lblFrom(t) : lblFrom({ name: "قالب جديد", w: Lb.w, h: Lb.h, code: Lb.code, els: Lb.els }); if (!t) P.lbl.id = null; render(); });
    on("#lbN", "oninput", e => { Lb.name = e.target.value; });
    on("#lbS", "onchange", e => { Lb.size = e.target.value; if (LSIZES[Lb.size]) [Lb.w, Lb.h] = LSIZES[Lb.size]; render(); });
    on("#lbC", "onchange", e => { Lb.code = e.target.value; render(); }); on("#lbP", "onchange", e => { P.pid = e.target.value; render(); });
    on("#lbW", "onchange", e => { Lb.w = Math.max(20, Math.min(120, +e.target.value || 50)); render(); }); on("#lbH", "onchange", e => { Lb.h = Math.max(15, Math.min(100, +e.target.value || 30)); render(); });
    document.querySelectorAll("[data-le]").forEach(el => el.onchange = () => { Lb.els[el.dataset.le].on = el.checked ? 1 : 0; render(); });
    const cv = $("#lblCanvas"); if (cv) cv.onpointerdown = e => { const el = e.target.closest("[data-el]"); if (!el) return; e.preventDefault(); const k = el.dataset.el, o = Lb.els[k], sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
      const mv = ev => { o.x = Math.max(0, Math.min(Lb.w - 2, Math.round((ox + (ev.clientX - sx) / 6) * 10) / 10)); o.y = Math.max(0, Math.min(Lb.h - 2, Math.round((oy + (ev.clientY - sy) / 6) * 10) / 10)); el.style.left = o.x * 6 + "px"; el.style.top = o.y * 6 + "px"; };
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); }; addEventListener("pointermove", mv); addEventListener("pointerup", up); };
  }
  if (P.tab === "agent") on("#agAuto", "onchange", e => { window.MZPA && MZPA.setAuto(e.target.checked); toast(e.target.checked ? "الإيصال هيطبع لوحده." : "الإيصال هيطبع لما تدوس «طباعة» بس."); });
  if (P.tab === "batch") {
    on("#bL", "onchange", e => { P.bloc = e.target.value; render(); }); on("#bT", "onchange", e => { P.btpl = e.target.value; });
    on("#bQ", "oninput", e => { P.bq = e.target.value; const p = e.target.selectionStart; render(); const n = $("#bQ"); n.focus(); n.setSelectionRange(p, p); });
    document.querySelectorAll("[data-bq]").forEach(el => el.onchange = () => { const v = Math.max(0, Math.min(999, Math.round(+el.value || 0))); if (v) P.sel[el.dataset.bq] = v; else delete P.sel[el.dataset.bq]; render(); });
  }
};
function prModal(p) { const x = p || { name: "", kind: "thermal", lang: "escpos", conn: "usb", addr: "", location_id: defLoc(), paper: "80", active: true };
  const sel = (id, obj, v) => `<select class="inp" id="${id}">${Object.entries(obj).map(([k, n]) => `<option value="${k}" ${v === k ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
  modal(`<h2>${p ? "تعديل طابعة" : "طابعة جديدة"}</h2><div class="stack"><div class="field"><label>الاسم</label><input class="inp" id="pN" value="${esc(x.name)}" placeholder="مثال: Xprinter 80 — كاشير المعرض الأول"></div>
   <div class="grid g2"><div class="field"><label>النوع</label>${sel("pK", PKIND, x.kind)}</div><div class="field"><label>اللغة</label>${sel("pL", PLANG, x.lang)}</div><div class="field"><label>الاتصال</label>${sel("pC", PCONN, x.conn)}</div><div class="field"><label>اسم الطابعة في ويندوز (أو الـ IP لطابعة الشبكة)</label><input class="inp" id="pA" list="winPr" value="${esc(x.addr || "")}" placeholder="${window.MZPA && MZPA.st.ok ? "اختار من القايمة" : "مثال: XP-80C"}"><datalist id="winPr">${(window.MZPA ? MZPA.st.printers : []).map(w => `<option value="${esc(w.name)}">`).join("")}</datalist></div>
   <div class="field"><label>المكان</label><select class="inp" id="pLoc"><option value="">كل الأماكن</option>${myLocs().map(l => `<option value="${l.id}" ${x.location_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div><div class="field"><label>الورق</label><select class="inp" id="pP">${PSIZES.map(s => `<option ${x.paper === s ? "selected" : ""}>${s}</option>`).join("")}</select></div></div>
   ${p ? `<label class="row" style="gap:8px"><input type="checkbox" id="pOn" ${x.active ? "checked" : ""}> الطابعة شغّالة</label>` : ""}<div id="pErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="prSave" data-id="${p ? p.id : ""}">حفظ</button></div></div>`); }
function printWin(html, pageCss) { const w = window.open("", "_blank", "width=480,height=640"); if (!w) return toast("المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة للموقع.", true);
  w.document.write(`<html dir="rtl"><head><title>طباعة</title><style>${pageCss}body{margin:0;font-family:Tahoma,Arial;color:#111}.lbl{page-break-after:always;overflow:hidden}.lbl:last-child{page-break-after:auto}</style></head><body>${html}<script>setTimeout(()=>{print();setTimeout(()=>close(),600)},250)<\/script></body></html>`); w.document.close(); }
function labelsWin(tpl, rows) { const L0 = lblFrom(tpl); printWin(rows.map(({ it, n }) => Array.from({ length: n }, () => `<div class="lbl" style="width:${L0.w}mm;height:${L0.h}mm">${lblHTML(L0, it, true)}</div>`).join("")).join(""), `@page{size:${L0.w}mm ${L0.h}mm;margin:0}`); }
function rawLabels(tpl, rows, lang) { const L0 = lblFrom(tpl), e = L0.els, D = 8, out = [];
  rows.forEach(({ it, n }) => { let type = L0.code, code = itCode(it, type); if (!code) { type = "code128"; code = it.barcode || it.code; }
    if (lang === "zpl") { let z = `^XA^CI28^PW${Math.round(L0.w * D)}^LL${Math.round(L0.h * D)}`; const tx = (o, t) => { z += `^FO${Math.round(o.x * D)},${Math.round(o.y * D)}^A0N,${Math.round(o.fs * D)},${Math.round(o.fs * D)}^FD${t}^FS`; };
      if (e.store.on) tx(e.store, (S.store && S.store.name) || ""); if (e.name.on) tx(e.name, it.name); if (e.price.on) tx(e.price, (+it.sale_price).toLocaleString("en-US") + " EGP");
      if (e.bc.on) { const o = e.bc; z += `^FO${Math.round(o.x * D)},${Math.round(o.y * D)}` + (type === "qr" ? `^BQN,2,4^FDQA,${code}^FS` : type === "ean13" ? `^BEN,${Math.round(o.h * D * 0.75)},Y,N^FD${code.slice(0, 12)}^FS` : type === "code39" ? `^B3N,N,${Math.round(o.h * D * 0.75)},Y,N^FD${code}^FS` : `^BCN,${Math.round(o.h * D * 0.75)},Y,N,N^FD${code}^FS`); }
      z += `^PQ${n}^XZ`; out.push(z);
    } else { let t = `SIZE ${L0.w} mm,${L0.h} mm\r\nGAP 2 mm,0\r\nCODEPAGE UTF-8\r\nCLS\r\n`; const tx = (o, s) => { t += `TEXT ${Math.round(o.x * D)},${Math.round(o.y * D)},"3",0,1,1,"${String(s).replace(/"/g, "'")}"\r\n`; };
      if (e.store.on) tx(e.store, (S.store && S.store.name) || ""); if (e.name.on) tx(e.name, it.name); if (e.price.on) tx(e.price, (+it.sale_price).toLocaleString("en-US") + " EGP");
      if (e.bc.on) { const o = e.bc; t += type === "qr" ? `QRCODE ${Math.round(o.x * D)},${Math.round(o.y * D)},M,4,A,0,"${code}"\r\n` : `BARCODE ${Math.round(o.x * D)},${Math.round(o.y * D)},"${type === "ean13" ? "EAN13" : type === "code39" ? "39" : "128"}",${Math.round(o.h * D * 0.75)},1,0,2,2,"${type === "ean13" ? code.slice(0, 12) : code}"\r\n`; }
      t += `PRINT ${n}\r\n`; out.push(t); } });
  const blob = new Blob([out.join(lang === "zpl" ? "\n" : "")], { type: "text/plain" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `labels-${today()}.${lang === "zpl" ? "zpl" : "prn"}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

/* =====================================================================
   ACTIONS
   ===================================================================== */
window.MZX = async function (k, a) {
  const wrap = async (fn, after, box) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (box && $(box)) errBox(box, e); else toast(errText(e), true); busy(a, false); } };
  const id = a.dataset.id;
  /* day closing */
  if (k === "clLoc") { S.cl.loc = +id; render(); }
  else if (k === "clPick") { S.cl.day = a.dataset.day; render(); scrollTo({ top: 0 }); }
  else if (k === "clGo") { const C = S.cl, note = $("#clNote").value.trim();
    if (!confirm(`تقفيل يوم ${C.day} لـ ${locName(C.loc)}؟ بعد التقفيل مفيش بيع ولا مصروفات على اليوم ده.`)) return true;
    wrap(() => rpc("day_close", { p_token: T(), p_loc: C.loc, p_day: C.day, p_note: note || null }), async () => { toast("اتقفل اليوم."); S.cl.loaded = null; render(); }, "#clErr"); }
  else if (k === "clReopen") modal(`<h2>إعادة فتح اليوم</h2><p class="muted">${esc(locName(S.cl.loc))} · ${esc(S.cl.day)} — البيع والمصروفات على اليوم ده هيرجعوا مسموحين لحد ما يتقفل تاني، وده بيتسجّل في سجل التدقيق.</p><div class="stack"><div class="field"><label>السبب</label><input class="inp" id="roR"></div><div id="roErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn danger" data-act="clReopenGo">إعادة فتح</button></div></div>`);
  else if (k === "clReopenGo") wrap(() => rpc("day_reopen", { p_token: T(), p_loc: S.cl.loc, p_day: S.cl.day, p_reason: $("#roR").value.trim() }), async () => { closeModal(); toast("اتفتح اليوم تاني."); S.cl.loaded = null; render(); }, "#roErr");
  /* expenses */
  else if (k === "exNew") exNewModal(a.dataset.loc);
  else if (k === "exSave") { const p = { exp_date: $("#eD").value, location_id: $("#eL").value || null, category_id: +$("#eC").value, amount: +$("#eA").value, source_account: +$("#eS").value, payee: $("#eP").value, note: $("#eN").value, recurring: $("#eR").checked };
    wrap(() => rpc("expense_save", { p_token: T(), p }).then(r => { closeModal(); toast(r.status === "pending" ? `اتسجّل ${r.no} — مستني موافقة المدير.` : `اتسجّل المصروف ${r.no}.`); }), async () => { if (S.ex) S.ex.loaded = null; if (S.cl) S.cl.loaded = null; S.cash = null; render(); }, "#eErr"); }
  else if (k === "exOk") wrap(() => rpc("expense_decide", { p_token: T(), p_id: id, p_approve: true, p_note: null }), async () => { toast("اتعتمد المصروف."); S.ex.loaded = null; render(); });
  else if (k === "exNo") exReasonModal(id, "no");
  else if (k === "exNoGo") wrap(() => rpc("expense_decide", { p_token: T(), p_id: id, p_approve: false, p_note: $("#xR").value.trim() }), async () => { closeModal(); S.ex.loaded = null; render(); }, "#xErr");
  else if (k === "exVoid") exReasonModal(id, "void");
  else if (k === "exVoidGo") wrap(() => rpc("expense_void", { p_token: T(), p_id: id, p_reason: $("#xR").value.trim() }), async () => { closeModal(); toast("اتلغى المصروف."); S.ex.loaded = null; render(); }, "#xErr");
  else if (k === "exCat") exCatModal(id ? S.ex.cats.find(c => c.id === +id) : null);
  else if (k === "exCatSave") { const p = { id: id ? +id : null, name: $("#kN").value, grp: $("#kG").value, account: $("#kA").value, budget: +$("#kB").value || 0, active: $("#kOn") ? $("#kOn").checked : true };
    wrap(() => rpc("expense_category_save", { p_token: T(), p }), async () => { closeModal(); S.ex.loaded = null; render(); }, "#kErr"); }
  else if (k === "exXls") { const E = S.ex; xlsOut(`مصروفات-${E.month}.xlsx`, "المصروفات", [["الرقم", "التاريخ", "البند", "المكان", "البيان", "المستفيد", "المصدر", "المبلغ", "الحالة"], ...E.list.map(x => [x.no, x.exp_date, catName(x.category_id), x.location_id ? locName(x.location_id) : "عام", x.note, x.payee || "", ((E.accts.find(c => c.id === x.source_account)) || {}).name || "", +x.amount, { pending: "مستني موافقة", approved: "معتمد", rejected: "مرفوض", void: "ملغي" }[x.status]])], [10, 11, 16, 14, 30, 16, 18, 12, 12]); }
  /* returns */
  else if (k === "rtNew") rtNewModal();
  else if (k === "rtFind") { const no = $("#rtNo").value.trim().toUpperCase(); if (!no) return true;
    wrap(async () => { const s = await q("sales", "id,status,location_id", x => x.eq("no", no.startsWith("INV-") ? no : "INV-" + no.padStart(6, "0"))); if (!s.length) throw new Error("NOT_FOUND"); if (s[0].status !== "posted") throw new Error("الفاتورة ملغاة."); closeModal(); await returnModal(s[0].id); }, null, "#rtErr"); }
  /* customers */
  else if (k === "cuNew") cuEditModal(null);
  else if (k === "cuEdit") cuEditModal(S.cu.list.find(c => c.id === id));
  else if (k === "cuOpen") cuOpen(id);
  else if (k === "cuTab") { S.cu.tab = a.dataset.k; render(); }
  else if (k === "cuSort") { S.cu.sort = a.dataset.k; render(); }
  else if (k === "cuClear") { S.cu.f = {}; render(); }
  else if (k === "cuSel") { const set = new Set(S.cu.sel); a.checked ? set.add(id) : set.delete(id); S.cu.sel = [...set]; render(); }
  else if (k === "cuSelAll") { const set = new Set(S.cu.sel), F = cuFiltered(); if (a.checked) F.forEach(c => set.add(c.id)); else F.forEach(c => set.delete(c.id)); S.cu.sel = [...set]; render(); }
  else if (k === "cuSelNone") { S.cu.sel = []; render(); }
  else if (k === "cuSave") { const p = { id: id || null, name: $("#cN").value, phone: $("#cP").value, area: $("#cA").value, address: $("#cD").value, notes: $("#cO").value };
    if (p.phone && !/^01\d{9}$/.test(p.phone.trim())) { errBox("#cErr", "رقم الموبايل غلط."); return true; }
    wrap(() => rpc("customer_save", { p_token: T(), p }), async () => { closeModal(); toast("اتحفظ."); S.cu.loaded = false; render(); }, "#cErr"); }
  else if (k === "cuPts") cuPtsModal(id, a.dataset.k);
  else if (k === "cuPtsGo") wrap(() => rpc("loyalty_move", { p_token: T(), p_customer: id, p_points: Math.round(+$("#lpN").value || 0), p_kind: a.dataset.k, p_note: $("#lpR").value.trim() }), async () => { await loadCust(); toast("اتسجّلت حركة النقاط."); render(); cuOpen(id); }, "#lpErr");
  else if (k === "cuLoy") cuLoyModal();
  else if (k === "cuLoySave") wrap(() => rpc("loyalty_save", { p_token: T(), p_on: $("#lyOn").checked, p_per: +$("#lyPer").value, p_value: +$("#lyVal").value }), async () => { closeModal(); await M.loadCore(); S.cu.loaded = false; render(); }, "#lyErr");
  else if (k === "cuXls") xlsOut(`العملاء-${today()}.xlsx`, "العملاء", [["الاسم", "الموبايل", "المنطقة", "العنوان", "الفواتير", "إجمالي المشتريات", "النقاط", "ضمانات سارية", "آخر زيارة"], ...S.cu.list.map(c => [c.name, c.phone || "", c.area || "", c.address || "", +c.invoices, +c.spent, +c.points, +c.warranties, c.last ? c.last.slice(0, 10) : ""])], [22, 14, 14, 26, 9, 14, 9, 11, 12]);
  else if (k === "snLook") { const v = $("#snQ").value.trim(); if (!v) return true;
    wrap(async () => { const r = await rpc("serial_lookup", { p_token: T(), p_serial: v }); busy(a, false);
      $("#snRes").innerHTML = !r ? `<div class="warnbox">المسلسل ده مش متسجّل في النظام.</div>` : `<div class="${r.sale_no ? (r.until >= today() ? "okbox" : "warnbox") : "okbox"}"><b>${esc(r.item)}</b> · SN ${esc(r.serial)}<br>${r.sale_no ? `اتباع في ${dd(r.sold)} بفاتورة ${esc(r.sale_no)}${r.customer ? ` لـ ${esc(r.customer)} (${esc(r.phone || "")})` : ""}<br>${+r.months ? (r.until >= today() ? `الضمان ساري لحد ${esc(r.until)}` : `الضمان انتهى في ${esc(r.until)}`) : "الصنف ملوش ضمان"}${+r.tickets ? ` · ${r.tickets} تذكرة صيانة قبل كده` : ""}` : `لسه في المخزون · ${esc(locName(r.location))}`}${r.sale_no && can("svc", "a") ? `<div style="margin-top:8px"><button class="btn sm" data-go="svc">تذكرة ضمان</button></div>` : ""}</div>`; }); }
  /* delivery */
  else if (k === "dlNew") dlModal(null);
  else if (k === "dlFromSale") dlModal(null, id);
  else if (k === "dlOpen") dlModal(S.dl.list.find(d => d.id === id));
  else if (k === "dlSave") { const v = s => { const el = $(s); return el ? el.value : undefined; };
    const p = { id: id || null, sale_id: a.dataset.sale || null, customer_name: v("#dN"), phone: v("#dP"), address: v("#dA"), area: v("#dR"), scheduled: v("#dS"), slot: v("#dT"), driver: v("#dDr"), installer: v("#dIn"), items: v("#dI"), install: $("#dX").checked, note: v("#dO"), location_id: v("#dL") || null };
    wrap(async () => { const inv = v("#dIv"); if (inv && inv.trim()) { const no = inv.trim().toUpperCase(), s = await q("sales", "id", x => x.eq("no", no.startsWith("INV-") ? no : "INV-" + no.padStart(6, "0"))); if (!s.length) throw new Error("NOT_FOUND"); p.sale_id = s[0].id; ["items", "customer_name", "phone"].forEach(f => { if (!String(p[f] || "").trim()) delete p[f]; }); }
      const r = await rpc("delivery_save", { p_token: T(), p }); closeModal(); toast(`اتحفظ طلب التوصيل ${r.no}.`); }, async () => { if (S.dl) S.dl.loaded = false; if (S.route === "delivery") render(); }, "#dErr"); }
  else if (k === "dlNext") { const d = S.dl.list.find(x => x.id === id), nx = { new: "prep", prep: "way", way: "delivered", delivered: "closed" }[d.status];
    if (nx === "way" && !d.driver) return dlNoteModal(id, "way", "خرج للتوصيل", "اسم المندوب"), true;
    wrap(() => rpc("delivery_advance", { p_token: T(), p_id: id, p_to: nx, p_note: null }), async () => { S.dl.loaded = false; render(); }); }
  else if (k === "dlCancel") dlNoteModal(id, "cancelled", "إلغاء طلب التوصيل", "السبب");
  else if (k === "dlBack") dlNoteModal(id, "prep", "الطلب رجع المعرض", "السبب (مثلًا: العميل مش موجود)");
  else if (k === "dlMove") wrap(() => rpc("delivery_advance", { p_token: T(), p_id: id, p_to: a.dataset.to, p_note: $("#dnN").value.trim() }), async () => { closeModal(); S.dl.loaded = false; render(); }, "#dnErr");
  /* printers & labels */
  else if (k === "prTab") { S.pr.tab = a.dataset.k; if (a.dataset.k === "agent") S.pr.ag = null; render(); }
  else if (k === "prNew") prModal(null);
  else if (k === "prEdit") prModal(S.pr.printers.find(p => p.id === +id));
  else if (k === "prSave") { const p = { id: id ? +id : null, name: $("#pN").value, kind: $("#pK").value, lang: $("#pL").value, conn: $("#pC").value, addr: $("#pA").value, location_id: $("#pLoc").value || null, paper: $("#pP").value, active: $("#pOn") ? $("#pOn").checked : true };
    wrap(() => rpc("printer_save", { p_token: T(), p }), async () => { closeModal(); S.pr.loaded = false; if (window.MZPA) MZPA.loadCfg(true); render(); }, "#pErr"); }
  else if (k === "prTest") { const p = S.pr.printers.find(x => x.id === +id), lab = LSIZES[p.paper], w = lab ? lab[0] + "mm" : { "58": "50mm", "80": "72mm", "A5": "130mm", "A4": "190mm" }[p.paper] || "72mm";
    const body = `<div style="width:${w};padding:2mm;box-sizing:border-box;text-align:center;border:1px dashed #000"><b>${esc(S.store.name)}</b><br>طباعة تجريبية<br>${esc(p.name)}<br>${esc(p.paper)} · ${new Date().toLocaleString("ar-EG")}<div style="height:10mm;width:46mm;max-width:100%;margin:2mm auto 0">${barsSVG(c128mods("TEST-" + p.id), "TEST-" + p.id, 40)}</div></div>`;
    if (window.MZPA && MZPA.usable(p)) { MZPA.test(p, body, parseFloat(w), lab ? lab[1] : 0).then(() => toast("اتبعتت للطابعة من غير نافذة.")).catch(e => toast("الطباعة الصامتة فشلت: " + errText(e), true)); return true; }
    printWin(body, lab ? `@page{size:${lab[0]}mm ${lab[1]}mm;margin:0}` : `@page{margin:4mm}`); }
  else if (k === "agRefresh") { S.pr.ag = null; if (window.MZPA) MZPA.loadCfg(true); render(); }
  else if (k === "agRetry" || k === "agCancel" || k === "agClear") { const A = window.MZPA; busy(a, true);
    A.call(k === "agRetry" ? "/jobs/retry" : k === "agCancel" ? "/jobs/cancel" : "/jobs/clear", { id: id || "" }).then(() => agLoad()).then(render).catch(e => { busy(a, false); toast(errText(e), true); }); }
  else if (k === "pmUnlock" || k === "pmSave") { const P = S.pr, rows = [...document.querySelectorAll("[data-pm]")].map(tr => { const g = f => tr.querySelector(`[data-f=${f}]`).value; return { doc: tr.dataset.pm, printer_id: g("printer_id") || null, size: g("size"), copies: +g("copies") || 1, fallback_id: g("fallback_id") || null }; });
    wrap(() => rpc("print_map_save", { p_token: T(), p_loc: +P.loc, p_device: P.dev || null, p_rows: rows, p_lock: k === "pmSave" }), async () => { toast(k === "pmSave" ? "اتحفظ الربط واتقفل." : "اتفتح القفل — عدّل واحفظ."); P.loaded = false; if (window.MZPA) MZPA.loadCfg(true); render(); }, "#pmErr"); }
  else if (k === "rtSave") { const r = Object.assign({}, S.store.receipt || {}); document.querySelectorAll("[data-rt]").forEach(x => { r[x.dataset.rt] = x.type === "checkbox" ? x.checked : x.value.trim(); }); r.size = $("#rtS").value;
    wrap(() => rpc("receipt_save", { p_token: T(), p: r }), async () => { S.store.receipt = r; toast("اتحفظ قالب الإيصال."); render(); }, "#rtErr"); }
  else if (k === "lbFs") { const o = S.pr.lbl.els[a.dataset.k]; o.fs = Math.max(1.2, Math.min(8, Math.round((o.fs + +a.dataset.d) * 10) / 10)); render(); }
  else if (k === "lbSave" || k === "lbCopy") { const Lb = S.pr.lbl, p = { id: k === "lbSave" ? Lb.id : null, name: ($("#lbN").value || "").trim() || "قالب ملصق", w: Lb.w, h: Lb.h, code: Lb.code, els: Lb.els, is_default: $("#lbDef").checked };
    wrap(() => rpc("label_tpl_save", { p_token: T(), p }).then(nid => { Lb.id = nid; Lb.name = p.name; }), async () => { toast("اتحفظ القالب."); S.pr.loaded = false; const keep = S.pr.lbl; await loadPrint(); S.pr.lbl = keep; render(); }, "#lbErr"); }
  else if (k === "lbTest") { const it = S.items.find(i => i.id === S.pr.pid) || sample(); labelsWin(S.pr.lbl, [{ it, n: 1 }]); }
  else if (k === "bAll") { const P = S.pr; S.items.forEach(i => { const n = Math.round(M.S.stock.filter(s => s.item_id === i.id && s.location_id === +P.bloc).reduce((a, s) => a + +s.qty, 0)); if (n > 0 && i.unit !== "meter") P.sel[i.id] = Math.min(999, n); }); render(); }
  else if (k === "bNone") { S.pr.sel = {}; render(); }
  else if (k === "bPrint" || k === "bRaw") { const P = S.pr, tpl = P.tpls.find(t => t.id === +P.btpl) || P.tpls.find(t => t.is_default) || P.tpls[0]; if (!tpl) return toast("احفظ قالب ملصق الأول.", true), true;
    const rows = Object.entries(P.sel).map(([iid, n]) => ({ it: S.items.find(i => i.id === iid), n })).filter(r => r.it && r.n > 0);
    const again = rows.filter(r => P.printed.has(r.it.id)); if (again.length && !confirm(`${again.length} صنف اتطبع قبل كده — إعادة الطباعة هتتسجّل. تكمّل؟`)) return true;
    const lp = P.printers.find(p => p.id === ((P.map.find(m => m.location_id === +P.bloc && m.doc === "labels" && !m.device_id) || {}).printer_id));
    wrap(() => rpc("label_print_log", { p_token: T(), p_rows: rows.map(r => ({ item_id: r.it.id, qty: r.n })), p_template: tpl.id, p_loc: +P.bloc }), async () => { if (k === "bRaw") rawLabels(tpl, rows, lp.lang); else if (window.MZPA && MZPA.can("labels", +P.bloc)) { try { await MZPA.labels(rows, lblFrom(tpl), lblHTML, +P.bloc); toast("الملصقات اتبعتت للطابعة."); } catch (e) { toast("الطباعة الصامتة فشلت — هتفتح نافذة الطباعة.", true); labelsWin(tpl, rows); } } else labelsWin(tpl, rows); rows.forEach(r => P.printed.add(r.it.id)); P.sel = {}; render(); }); }
  else return false;
  return true;
};
})();
