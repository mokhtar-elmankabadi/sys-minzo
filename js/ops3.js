/* SYS Minzo · finance & analysis screens (batch 3)
   التقارير المالية · الاستحقاق والنقدي · التدفق النقدي والسيولة · رأس مال المشروع · أرصدة أول المدة · الفواتير الضريبية · الفواتير الإلكترونية */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, norm, rpc, q, T, can, has, seeCost, locName, ico, toast, modal, closeModal, busy, header, render, go, loadDir, who, today, errText, myLoc, PAYN, UNITS } = M;
const isOwner = () => S.sess.role.id === "owner", isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const dt = x => x ? new Date(x).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }) : "—";
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const empty = (n, t) => `<tr><td colspan="${n}" class="muted">${t}</td></tr>`;
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const later = (fn, r) => { setTimeout(() => fn().then(() => S.route === r && render()).catch(e => { toast(errText(e), true); }), 0); return `<div class="spin"></div>`; };
const r2 = n => Math.round((+n || 0) * 100) / 100, pct = n => (isFinite(n) ? (Math.round(n * 10) / 10) : 0) + "%";
const AN = v => +v < 0 ? `(${fmt(-v, 1)})` : fmt(v, 1);   // accounting style: negatives in brackets
const shows = () => S.locs.filter(l => l.kind === "showroom" && myLoc(l.id));
const addD = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const bar = (v, max, col) => `<div style="height:6px;border-radius:4px;background:var(--line);overflow:hidden;min-width:60px"><div style="height:100%;width:${max > 0 ? Math.max(0, Math.min(100, v / max * 100)) : 0}%;background:var(${col || "--gold"})"></div></div>`;
const kpis = list => `<div class="grid g4">${list.map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i % 4}"><div class="lbl">${k[0]}</div><div class="val" ${k[3] ? `style="color:var(${k[3]})"` : ""}>${k[2] ? k[1] : fmt(k[1])}</div>${k[4] ? `<div class="dim" style="font-size:12px">${k[4]}</div>` : ""}</div>`).join("")}</div>`;

/* =====================================================================
   PERIOD (shared by all finance screens)
   ===================================================================== */
const PERIODS = [["today", "النهارده"], ["yday", "امبارح"], ["week", "آخر ٧ أيام"], ["month", "الشهر ده"], ["lmonth", "الشهر اللي فات"], ["quarter", "آخر ٣ شهور"], ["year", "السنة دي"], ["custom", "فترة مخصصة"]];
function perRange(k) { const t = today(), y = t.slice(0, 4), m = t.slice(0, 7);
  if (k === "today") return [t, t]; if (k === "yday") return [addD(t, -1), addD(t, -1)]; if (k === "week") return [addD(t, -6), t]; if (k === "month") return [m + "-01", t];
  if (k === "lmonth") { const f = new Date(Date.UTC(+y, +t.slice(5, 7) - 2, 1)).toISOString().slice(0, 10); return [f, addD(m + "-01", -1)]; }
  if (k === "quarter") return [addD(t, -89), t]; if (k === "year") return [y + "-01-01", t]; return [S.per.from, S.per.to]; }
S.per = S.per || { k: "month", from: today().slice(0, 7) + "-01", to: today(), loc: "all" };
function perBar(withLoc) { const P = S.per; return `<div class="row" style="gap:6px;flex-wrap:wrap"><select class="inp" id="perK" style="width:auto">${PERIODS.map(([k, n]) => `<option value="${k}" ${P.k === k ? "selected" : ""}>${n}</option>`).join("")}</select>${P.k === "custom" ? `<input class="inp" type="date" id="perF" value="${P.from}" style="width:auto"><input class="inp" type="date" id="perT" value="${P.to}" style="width:auto">` : `<span class="dim num">${P.from} ← ${P.to}</span>`}${withLoc ? `<select class="inp" id="perL" style="width:auto"><option value="all">كل الأماكن</option>${S.locs.filter(l => myLoc(l.id)).map(l => `<option value="${l.id}" ${P.loc === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` : ""}</div>`; }
function perHook() { const P = S.per, on = (id, fn) => { const el = $(id); if (el) el.onchange = fn; };
  on("#perK", e => { P.k = e.target.value; if (P.k !== "custom") [P.from, P.to] = perRange(P.k); render(); }); on("#perF", e => { if (e.target.value) { P.from = e.target.value; render(); } }); on("#perT", e => { if (e.target.value) { P.to = e.target.value; render(); } });
  on("#perL", e => { P.loc = e.target.value; render(); }); }
[S.per.from, S.per.to] = S.per.k === "custom" ? [S.per.from, S.per.to] : perRange(S.per.k);
const perKey = () => S.per.from + "|" + S.per.to;
const inLoc = l => S.per.loc === "all" || +S.per.loc === +l;

/* =====================================================================
   LEDGER HELPERS — rows: [date, src, ref, account, dr, cr, loc]
   ===================================================================== */
const CASH = ["1101", "1102", "1103"];
async function loadGLAll() { const G = S.fin || (S.fin = {}); if (G.key === perKey() && G.rows) return G; G.rows = await rpc("fin_rows", { p_token: T(), p_from: null, p_to: S.per.to }); G.key = perKey();
  G.accts = G.accts || await q("gl_accounts", "*", x => x.order("code")); return G; }
const sel = (rows, f) => rows.filter(f);
const bal = (rows, codes, upto, loc) => rows.filter(r => r[0] <= upto && codes.some(c => r[3] === c || r[3].startsWith(c)) && (loc == null || r[6] === +loc)).reduce((a, r) => a + +r[4] - +r[5], 0);
const mov = (rows, codes, from, to, loc) => rows.filter(r => r[0] >= from && r[0] <= to && codes.some(c => r[3] === c || r[3].startsWith(c)) && (loc == null || r[6] === +loc)).reduce((a, r) => a + +r[4] - +r[5], 0);
function pl(rows, from, to, loc) { const m = c => mov(rows, c, from, to, loc);
  const sales = -m(["4101"]), ret = m(["4102"]), net = sales - ret, cogs = m(["5101"]), other = -m(["4103"]);
  const opx = {}; rows.forEach(r => { if (r[0] >= from && r[0] <= to && r[3].startsWith("52") && (loc == null || r[6] === +loc)) opx[r[3]] = (opx[r[3]] || 0) + +r[4] - +r[5]; });
  const ox = Object.values(opx).reduce((a, v) => a + v, 0); return { sales, ret, net, cogs, gp: net - cogs, opx, ox, other, np: net - cogs - ox + other }; }
/* cash basis: every cash-account movement, classified by what it was paired with in the same document */
function cashBasis(rows, from, to) { const g = {}; rows.forEach(r => { if (r[0] < from || r[0] > to) return; const k = r[1] + "|" + r[2] + "|" + r[0]; (g[k] || (g[k] = [])).push(r); });
  const C = { cust: 0, fin: 0, refund: 0, sup: 0, sal: 0, rent: 0, opx: 0, other: 0, inv: 0, partners: 0, loans: 0, opening: 0 };
  Object.values(g).forEach(L => { const cash = L.filter(r => CASH.includes(r[3])).reduce((a, r) => a + +r[4] - +r[5], 0); if (!cash) return; const acc = L.filter(r => !CASH.includes(r[3])).map(r => r[3]), has_ = c => acc.some(a => a === c || a.startsWith(c));
    if (has_("3103")) C.opening += cash; else if (has_("1110")) return; else if (has_("3101") || has_("3104")) C.partners += cash; else if (has_("2105")) C.loans += cash; else if (has_("1201")) C.inv += cash;
    else if (has_("2101")) C.sup += cash; else if (has_("4102")) C.refund += cash; else if (has_("4101") || has_("2104") || has_("2103")) C.cust += cash; else if (has_("1104")) C.fin += cash;
    else if (has_("5201") || has_("2102") || has_("1105")) C.sal += cash; else if (has_("5202")) C.rent += cash; else if (has_("52")) C.opx += cash; else C.other += cash; });
  C.op = C.cust + C.fin + C.refund + C.sup + C.sal + C.rent + C.opx + C.other; return C; }
/* opening-balance documents (anything touching 3103) are not part of the period's operations */
function opsOnly(rows) { const k = r => r[1] + "|" + r[2] + "|" + r[0], bad = new Set(rows.filter(r => r[3] === "3103").map(k)); return rows.filter(r => !bad.has(k(r))); }
function bridge(rows0, from, to) { const rows = opsOnly(rows0), d = c => mov(rows, c, from, to), P = pl(rows0, from, to);
  const items = [["صافي الربح (استحقاق)", P.np], ["+ الإهلاك (مش فلوس خارجة)", -d(["1202"])], ["− الزيادة في المخزون والبضاعة في الطريق", -d(["1106", "1109"])], ["− الزيادة في مستحقات شركات التقسيط", -d(["1104"])],
    ["− الزيادة في مدينين ومقدمات ومطالبات ضمان", -d(["1105", "1107", "1108"])], ["+ الزيادة في الموردين", -d(["2101"])], ["+ الزيادة في المستحقات والضريبة وأرصدة العملاء", -d(["2102", "2103", "2104"])]];
  return { items, ocf: items.reduce((a, x) => a + x[1], 0), P }; }

/* =====================================================================
   الاستحقاق والنقدي
   ===================================================================== */
V.basis = () => {
  let h = header(perBar(false)); if (!seeCost()) return h + `<div class="warnbox">الشاشة دي فيها التكلفة والأرباح، ودورك مش بيشوفها.</div>`;
  const G = S.fin; if (!G || G.key !== perKey()) return h + later(loadGLAll, "basis");
  const { from, to } = S.per, B = bridge(G.rows, from, to), C = cashBasis(G.rows, from, to), P = B.P, qd = P.np ? C.op / P.np : 0;
  const qc = P.np <= 0 ? ["plain", "—"] : qd >= 1 ? ["ok", "قوية: الأرباح بتتحوّل نقدية"] : qd >= 0.8 ? ["warn", "مقبولة"] : ["bad", "انتبه: أرباح محبوسة في مخزون أو مستحقات"];
  h += kpis([["صافي الربح · أساس الاستحقاق", P.np, 0, null, "هامش " + pct(P.net ? P.np / P.net * 100 : 0)], ["صافي النقدية التشغيلية · الأساس النقدي", C.op, 0, null, "قبل الاستثمار وتمويل الشركاء"], ["الفرق (النقدي − الاستحقاق)", C.op - P.np, 0, C.op - P.np >= 0 ? "--ok" : "--bad", Math.abs(B.ocf - C.op) < 1 ? "متفسَّر بالكامل في الجسر تحت" : "فيه فرق تقريب " + fmt(B.ocf - C.op, 1)], ["جودة الأرباح (النقدي ÷ الاستحقاق)", (P.np > 0 ? qd.toFixed(2) + "×" : "—"), 1, null, P.np > 0 ? qc[1] : "بتتحسب لما يكون فيه ربح"]]);
  const rows = [["المبيعات", P.sales, C.cust + C.fin, "المبيعات بالتقسيط بتتحصّل لما الشركة تحوّل"], ["مردودات المبيعات", -P.ret, C.refund, ""], ["تكلفة البضاعة المباعة / المدفوع للموردين", -P.cogs, C.sup, "اللي اتباع مش لازم يكون اتدفع، واللي اتدفع ممكن يكون لسه في المخزن"],
    ["المرتبات", -(P.opx["5201"] || 0), C.sal, ""], ["الإيجارات", -(P.opx["5202"] || 0), C.rent, ""], ["باقي مصروفات التشغيل", -(P.ox - (P.opx["5201"] || 0) - (P.opx["5202"] || 0)), C.opx, "الإهلاك مصروف من غير فلوس خارجة"], ["إيرادات وتسويات أخرى", P.other, C.other, ""]];
  h += `<div class="card rise"><h3>قائمة الدخل بالأساسين</h3><div class="tw"><table><thead><tr><th>البند</th><th class="n">الاستحقاق</th><th class="n">النقدي</th><th class="n">الفرق</th><th>سبب الفرق</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="n">${AN(r[1])}</td><td class="n">${AN(r[2])}</td><td class="n" style="color:var(${r[2] - r[1] >= 0 ? "--ok" : "--bad"})">${Math.abs(r[2] - r[1]) < 0.01 ? "—" : AN(r[2] - r[1])}</td><td class="muted" style="font-size:12.5px">${Math.abs(r[2] - r[1]) < 0.01 ? "مفيش فرق" : esc(r[3])}</td></tr>`).join("")}
    <tr style="font-weight:700"><td>صافي الربح ← صافي النقدية التشغيلية</td><td class="n">${AN(P.np)}</td><td class="n">${AN(C.op)}</td><td class="n">${AN(C.op - P.np)}</td><td></td></tr></tbody></table></div><p class="dim" style="font-size:12.5px;margin-bottom:0">الأرقام بين قوسين ( ) بالسالب.</p></div>`;
  h += `<div class="card rise"><h3>الجسر من الربح للنقدية (الطريقة غير المباشرة)</h3><div class="tw"><table><tbody>${B.items.map(x => `<tr><td>${x[0]}</td><td class="n">${AN(x[1])}</td></tr>`).join("")}<tr style="font-weight:700"><td>= صافي النقدية التشغيلية</td><td class="n">${AN(B.ocf)}</td></tr></tbody></table></div></div>`;
  return h;
};
H.basis = perHook;

/* =====================================================================
   التدفق النقدي والسيولة
   ===================================================================== */
async function loadFlow() { await loadGLAll(); const F = S.fin; const [acc, pur, fr, pays] = await Promise.all([q("cash_accounts", "*", x => x.order("id")), q("purchase_invoices", "id,supplier_id,total,due_date,inv_date"), q("finance_receivables", "net,due_date,status", x => x.eq("status", "open")), q("supplier_payments", "supplier_id,amount,method")]);
  Object.assign(F, { cashAcc: acc, pur, fr, pays, flowKey: perKey() }); }
V.flow = () => {
  let h = header(perBar(false)); if (!seeCost()) return h + `<div class="warnbox">الشاشة دي فيها التكلفة والأرباح، ودورك مش بيشوفها.</div>`;
  const F = S.fin; if (!F || F.flowKey !== perKey()) return h + later(loadFlow, "flow");
  const { from, to } = S.per, R = F.rows, C = cashBasis(R, from, to), op = bal(R, CASH, addD(from, -1)) + C.opening, cl = bal(R, CASH, to), net = cl - op;
  const days = Math.max(1, (new Date(to) - new Date(from)) / 864e5 + 1), outs = -(C.sup + C.sal + C.rent + C.opx + Math.min(0, C.refund)), daily = outs / days, cover = daily > 0 ? cl / daily : Infinity;
  /* 30-day projection: average operating net per day + known dues */
  const opAvg = C.op / days, supPaid = {}; F.pays.forEach(p => { supPaid[p.supplier_id] = (supPaid[p.supplier_id] || 0) + +p.amount; });
  const dues = []; const byS = {}; F.pur.slice().sort((a, b) => a.due_date < b.due_date ? -1 : 1).forEach(p => { const paid = supPaid[p.supplier_id] || 0, used = byS[p.supplier_id] || 0, left = Math.max(0, +p.total - Math.max(0, paid - used)); byS[p.supplier_id] = used + +p.total; if (left > 0) dues.push([p.due_date, -left]); });
  F.fr.forEach(r => dues.push([r.due_date, +r.net]));
  let run = cl, low = cl, lowD = today(); const pts = []; for (let i = 1; i <= 30; i++) { const d = addD(today(), i); run += opAvg - (C.sup / days) + dues.filter(x => x[0] === d || (i === 1 && x[0] < d)).reduce((a, x) => a + x[1], 0); pts.push([d, run]); if (run < low) { low = run; lowD = d; } }
  const safety = daily * 7;
  h += kpis([["رصيد النقدية الآن", cl, 0, null, "أول المدة " + fmt(op)], ["صافي التغير في النقدية", net, 0, net >= 0 ? "--ok" : "--bad", "تشغيلي " + fmt(C.op)], ["النقدية تكفي لمدة", isFinite(cover) ? Math.round(cover) + " يوم" : "—", 1, null, "من مدفوعات التشغيل بمعدلها الحالي"], ["أقل رصيد متوقع خلال ٣٠ يوم", low, 0, low < safety ? "--bad" : null, lowD + (low < safety ? " · تحت حد الأمان" : " · فوق حد الأمان")]]);
  const row = (n, v, b) => `<tr ${b ? `style="font-weight:700"` : ""}><td>${n}</td><td class="n">${AN(v)}</td></tr>`;
  h += `<div class="grid g2"><div class="card rise"><h3>قائمة التدفقات النقدية</h3><div class="tw"><table><tbody><tr><td colspan="2" class="dim">الأنشطة التشغيلية</td></tr>${row("متحصلات من العملاء (نقدي وإلكتروني)", C.cust)}${row("متحصلات من شركات التقسيط", C.fin)}${row("مرتجعات للعملاء", C.refund)}${row("مدفوعات للموردين", C.sup)}${row("مرتبات وسلف", C.sal)}${row("إيجارات", C.rent)}${row("مصروفات تشغيل أخرى", C.opx)}${row("تسويات أخرى", C.other)}${row("صافي التدفق التشغيلي", C.op, 1)}
     <tr><td colspan="2" class="dim">الأنشطة الاستثمارية</td></tr>${row("شراء أصول ثابتة", C.inv)}${row("صافي التدفق الاستثماري", C.inv, 1)}<tr><td colspan="2" class="dim">الأنشطة التمويلية</td></tr>${row("رأس مال ومسحوبات الشركاء", C.partners)}${row("قروض", C.loans)}${row("صافي التدفق التمويلي", C.partners + C.loans, 1)}
     ${row("صافي التغير في النقدية", net, 1)}${row(C.opening ? "+ رصيد أول المدة (الأرصدة الافتتاحية)" : "+ رصيد أول المدة", op)}${row("= رصيد آخر المدة", cl, 1)}</tbody></table></div></div>
   <div class="card rise"><h3>النقدية حسب الحساب</h3><div class="tw"><table><tbody>${[["1101", "الخزنة الرئيسية"], ["1102", "أدراج الكاشير"], ["1103", "البنوك والمحافظ وتحت التسوية"]].map(([c, n]) => { const v = bal(R, [c], to); return `<tr><td>${n}</td><td class="n">${fmt(v, 1)}</td><td style="width:35%">${bar(Math.max(0, v), Math.max(cl, 1))}</td></tr>`; }).join("")}<tr style="font-weight:700"><td>الإجمالي</td><td class="n">${fmt(cl, 1)}</td><td></td></tr></tbody></table></div>
    <h3 style="margin-top:14px">التوقع لـ ٣٠ يوم</h3><div style="display:flex;align-items:flex-end;gap:2px;height:90px">${(() => { const mx = Math.max(...pts.map(p => Math.abs(p[1])), 1); return pts.map(p => `<div title="${p[0]} · ${fmt(p[1])}" style="flex:1;height:${Math.max(3, Math.abs(p[1]) / mx * 90)}px;background:var(${p[1] < safety ? "--bad" : "--gold"});opacity:.8;border-radius:2px"></div>`).join(""); })()}</div><p class="dim" style="font-size:12px;margin-bottom:0">على أساس متوسط صافي التشغيل اليومي في الفترة، ومستحقات الموردين بمواعيدها، وتحويلات شركات التقسيط المنتظرة. حد الأمان = ٧ أيام مدفوعات (${fmt(safety)}).</p></div></div>`;
  const CA = bal(R, ["1101", "1102", "1103", "1104", "1105", "1106", "1107", "1108", "1109"], to), INV = bal(R, ["1106", "1109"], to), CL = -bal(R, ["2101", "2102", "2103", "2104", "2105"], to), cash = cl;
  const ratios = [["نسبة التداول", CL > 0 ? CA / CL : null, 1.5, 1, "الأصول المتداولة ÷ الخصوم المتداولة"], ["النسبة السريعة", CL > 0 ? (CA - INV) / CL : null, 1, 0.5, "من غير المخزون"], ["نسبة النقدية", CL > 0 ? cash / CL : null, 0.5, 0.2, "النقدية الجاهزة ÷ الخصوم المتداولة"]];
  h += `<div class="card rise"><h3>مؤشرات السيولة · ${to}</h3><div class="tw"><table><thead><tr><th>المؤشر</th><th class="n">القيمة</th><th>الحكم</th><th>إزاي بيتحسب</th></tr></thead><tbody>${ratios.map(x => `<tr><td>${x[0]}</td><td class="n">${x[1] == null ? "—" : x[1].toFixed(2)}</td><td>${x[1] == null ? chip("مفيش خصوم") : x[1] >= x[2] ? chip("كويس", "ok") : x[1] >= x[3] ? chip("مقبول", "warn") : chip("ضعيف", "bad")}</td><td class="muted">${x[4]}</td></tr>`).join("")}</tbody></table></div></div>`;
  return h;
};
H.flow = perHook;

/* =====================================================================
   رأس مال المشروع
   ===================================================================== */
async function loadCap() { await loadGLAll(); const F = S.fin; const [partners, moves, assets, acc] = await Promise.all([q("partners", "*", x => x.order("id")), q("capital_moves", "*", x => x.order("move_date", { ascending: false })), q("fixed_assets", "*", x => x.order("start_date")), q("cash_accounts", "*", x => x.eq("active", true).order("id"))]);
  Object.assign(F, { partners, cmoves: moves, assets, cashAcc: acc, capKey: perKey() }); }
function assetBook(a, upto) { const sd = a.opening ? addD(String(a.start_date).slice(0, 10), 1) : a.start_date; /* opening-sheet assets are already net on the opening day */
  const m = Math.max(0, Math.min(a.life_months, (new Date(upto).getUTCFullYear() - new Date(sd).getUTCFullYear()) * 12 + new Date(upto).getUTCMonth() - new Date(sd).getUTCMonth() + (new Date(addD(upto, 1)).getUTCDate() === 1 ? 1 : 0)));  /* from the purchase month: each month counts once its last day has passed */
  const dep = r2((+a.start_value - +a.salvage) / a.life_months * Math.max(0, m)); return { dep, net: r2(+a.start_value - dep) }; }
V.capital = () => {
  let h = header(`<span class="dim num">حتى ${today()}</span>${isTop() ? `<button class="btn" data-act="cpPartner">${ico("plus")} شريك</button><button class="btn" data-act="cpAsset">${ico("plus")} أصل ثابت</button><button class="btn gold" data-act="cpMove">حركة رأس مال</button>` : ""}`);
  if (!seeCost()) return h + `<div class="warnbox">الشاشة دي فيها التكلفة، ودورك مش بيشوفها.</div>`;
  const F = S.fin; if (!F || F.capKey !== perKey()) return h + later(loadCap, "capital");
  const R = F.rows, t = today(), b = c => bal(R, c, t);
  const groups = [["النقدية", b(CASH), [["الخزنة الرئيسية", b(["1101"])], ["أدراج الكاشير", b(["1102"])], ["البنوك والمحافظ", b(["1103"])]]],
    ["البضاعة بالتكلفة", b(["1106", "1109"]), S.locs.map(l => [l.name, bal(R, ["1106"], t, l.id)]).concat([["بضاعة في الطريق", b(["1109"])]])],
    ["مستحقات لينا", b(["1104", "1105", "1107", "1108"]), [["شركات التقسيط", b(["1104"])], ["مدينين", b(["1105"])], ["مدفوع مقدمًا", b(["1107"])], ["مطالبات ضمان على الموردين", b(["1108"])]]],
    ["الأصول الثابتة (صافي)", b(["12"]), F.assets.filter(a => !a.disposed_on).map(a => [a.name, assetBook(a, t).net])]];
  const assets = groups.reduce((a, g) => a + g[1], 0), sup = -b(["2101"]), accr = -b(["2102"]), def = -b(["2103"]), vat = -b(["2104"]), loans = -b(["2105"]), liab = sup + accr + def + vat + loans, equity = assets - liab;
  const paid = -b(["3101"]), draw = b(["3104"]), retained = equity - paid + draw;
  h += kpis([["إجمالي الأصول (كل قرش في المكان)", assets], ["صافي رأس المال (حقوق الملكية)", equity, 0, null, paid ? pct(equity / paid * 100) + " من المدفوع" : ""], ["رأس المال المدفوع من الشركاء", paid, 0, null, draw ? "مسحوبات " + fmt(draw) : ""], ["أرباح متراكمة / (خسائر)", retained, 0, retained >= 0 ? "--ok" : "--bad"]]);
  S.capOpen = S.capOpen || {};
  h += `<div class="grid g2"><div class="card rise"><h3>فين كل قرش؟</h3><div class="tw"><table><thead><tr><th>البند</th><th class="n">القيمة</th><th class="n">من الأصول</th></tr></thead><tbody>${groups.map((g, i) => `<tr data-act="cpOpen" data-k="${i}" style="cursor:pointer;font-weight:600"><td>${S.capOpen[i] ? "−" : "+"} ${g[0]}</td><td class="n">${fmt(g[1], 1)}</td><td class="n">${pct(assets ? g[1] / assets * 100 : 0)}</td></tr>${S.capOpen[i] ? g[2].filter(x => Math.abs(x[1]) > 0.004).map(x => `<tr><td style="padding-inline-start:26px" class="muted">${esc(x[0])}</td><td class="n">${fmt(x[1], 1)}</td><td class="n dim">${pct(assets ? x[1] / assets * 100 : 0)}</td></tr>`).join("") : ""}`).join("")}
     <tr style="font-weight:700"><td>إجمالي الأصول</td><td class="n">${fmt(assets, 1)}</td><td class="n">100%</td></tr><tr><td>(−) اللي علينا: موردين ${fmt(sup)} · مستحقات ${fmt(accr)} · عملاء ${fmt(def)} · ضريبة ${fmt(vat)} · قروض ${fmt(loans)}</td><td class="n">(${fmt(liab, 1)})</td><td class="n">${pct(assets ? liab / assets * 100 : 0)}</td></tr><tr style="font-weight:700"><td>= صافي رأس المال</td><td class="n">${fmt(equity, 1)}</td><td></td></tr></tbody></table></div></div>
   <div class="card rise"><h3>الفلوس دي جاية منين؟</h3>${(() => { const fund = [["رأس مال الشركاء (بعد المسحوبات)", paid - draw, "--gold"], ["أرباح محتجزة", Math.max(0, retained), "--ok"], ["ائتمان الموردين", sup, "--warn"], ["مستحقات وعملاء وضريبة وقروض", accr + def + vat + loans, "--info"]], tot = fund.reduce((a, f) => a + Math.max(0, f[1]), 0) || 1;
      return `<div style="display:flex;height:18px;border-radius:9px;overflow:hidden;margin-bottom:10px">${fund.map(f => `<div style="width:${Math.max(0, f[1]) / tot * 100}%;background:var(${f[2]})"></div>`).join("")}</div><div class="tw"><table><tbody>${fund.map(f => `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(${f[2]})"></span> ${f[0]}</td><td class="n">${fmt(f[1], 1)}</td><td class="n">${pct(Math.max(0, f[1]) / tot * 100)}</td></tr>`).join("")}</tbody></table></div>${retained < 0 ? `<div class="warnbox" style="margin-top:8px">فيه خسائر متراكمة ${fmt(-retained)} بتاكل من رأس المال.</div>` : ""}`; })()}</div></div>`;
  const ytd = pl(R, t.slice(0, 4) + "-01-01", t);
  h += `<div class="card rise"><h3>الشركاء</h3><div class="tw"><table><thead><tr><th>الشريك</th><th class="n">النسبة</th><th class="n">دفع</th><th class="n">سحب</th><th class="n">نصيبه من ربح السنة</th><th class="n">صافي حسابه</th><th></th></tr></thead><tbody>${F.partners.map(p => { const pm = F.cmoves.filter(m => m.partner_id === p.id && m.status === "posted"), cin = pm.filter(m => m.kind === "contribution").reduce((a, m) => a + +m.amount, 0), cout = pm.filter(m => m.kind === "drawing").reduce((a, m) => a + +m.amount, 0), share = ytd.np * +p.share_pct / 100;
      return `<tr><td>${esc(p.name)}${p.active ? "" : " " + chip("موقوف")}</td><td class="n">${num(p.share_pct)}%</td><td class="n">${fmt(cin, 1)}</td><td class="n">${fmt(cout, 1)}</td><td class="n" style="color:var(${share >= 0 ? "--ok" : "--bad"})">${AN(share)}</td><td class="n">${fmt(cin - cout + share, 1)}</td><td>${isTop() ? `<button class="btn sm ghost" data-act="cpPartner" data-id="${p.id}">تعديل</button>` : ""}</td></tr>`; }).join("") || empty(7, "لسه مفيش شركاء متسجلين.")}</tbody></table></div><p class="dim" style="font-size:12.5px;margin-bottom:0">رأس المال المدفوع في الأرصدة الافتتاحية بيظهر في الإجمالي فوق، وحركات الشركاء بعدها بتتسجّل هنا.</p></div>`;
  h += `<div class="grid g2"><div class="card rise"><h3>حركات رأس المال</h3><div class="tw"><table><tbody>${F.cmoves.slice(0, 30).map(m => `<tr><td class="num dim">${esc(m.no)}</td><td class="num">${esc(m.move_date)}</td><td>${{ contribution: "دفع رأس مال", drawing: "مسحوبات", loan_in: "قرض", loan_repay: "سداد قرض" }[m.kind]}${m.partner_id ? " · " + esc((F.partners.find(p => p.id === m.partner_id) || {}).name || "") : ""}</td><td class="n">${fmt(m.amount, 1)}</td><td class="muted">${esc(m.note || "")}</td></tr>`).join("") || empty(5, "مفيش حركات.")}</tbody></table></div></div>
   <div class="card rise"><h3>الأصول الثابتة</h3><div class="tw"><table><thead><tr><th>الأصل</th><th>من</th><th class="n">القيمة</th><th class="n">الإهلاك لحد النهارده</th><th class="n">الصافي</th></tr></thead><tbody>${F.assets.map(a => { const k = assetBook(a, t); return `<tr><td>${esc(a.name)}${a.opening ? " " + chip("افتتاحي") : ""}${a.disposed_on ? " " + chip("اتباع/اتشطب " + a.disposed_on, "bad") : ""}<br><span class="dim" style="font-size:12px">${a.life_months} شهر${+a.salvage ? " · خردة " + fmt(a.salvage) : ""}</span></td><td class="num dim">${esc(a.start_date)}</td><td class="n">${fmt(a.start_value, 1)}</td><td class="n">${fmt(k.dep, 1)}</td><td class="n">${fmt(k.net, 1)}</td></tr>`; }).join("") || empty(5, "مفيش أصول متسجلة.")}</tbody></table></div><p class="dim" style="font-size:12px;margin-bottom:0">الإهلاك قسط ثابت، وبيتقيّد لوحده آخر كل شهر على «إهلاك» و«مجمع الإهلاك».</p></div></div>`;
  return h;
};
function cpMoveModal() { const F = S.fin; modal(`<h2>حركة رأس مال</h2><div class="stack"><div class="grid g2"><div class="field"><label>النوع</label><select class="inp" id="cmK"><option value="contribution">دفع رأس مال من شريك</option><option value="drawing">مسحوبات شريك</option><option value="loan_in">استلام قرض</option><option value="loan_repay">سداد قرض</option></select></div>
   <div class="field"><label>الشريك</label><select class="inp" id="cmP"><option value="">—</option>${F.partners.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div><div class="field"><label>المبلغ</label><input class="inp num" type="number" min="0" id="cmA"></div>
   <div class="field"><label>الخزنة / الحساب</label><select class="inp" id="cmC">${F.cashAcc.filter(a => a.kind !== "drawer").map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div><div class="field"><label>التاريخ</label><input class="inp" type="date" id="cmD" value="${today()}" max="${today()}"></div><div class="field"><label>ملاحظة</label><input class="inp" id="cmN"></div></div><div id="cmErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cpMoveGo">تسجيل</button></div></div>`); }
function cpPartnerModal(p) { const x = p || { name: "", share_pct: 0, phone: "", active: true }; modal(`<h2>${p ? "تعديل شريك" : "شريك جديد"}</h2><div class="stack"><div class="grid g2"><div class="field"><label>الاسم</label><input class="inp" id="paN" value="${esc(x.name)}"></div><div class="field"><label>النسبة %</label><input class="inp num" type="number" min="0" max="100" step="0.01" id="paS" value="${+x.share_pct}"></div><div class="field"><label>الموبايل</label><input class="inp num" id="paP" value="${esc(x.phone || "")}"></div>${p ? `<label class="row" style="gap:6px;align-self:end"><input type="checkbox" id="paOn" ${x.active ? "checked" : ""}> شريك حالي</label>` : ""}</div><div id="paErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cpPartnerGo" data-id="${p ? p.id : ""}">حفظ</button></div></div>`); }
function cpAssetModal(opening) { const F = S.fin; modal(`<h2>${opening ? "أصل ثابت موجود قبل التشغيل" : "شراء أصل ثابت"}</h2><div class="stack"><div class="grid g2"><div class="field"><label>الاسم</label><input class="inp" id="faN" placeholder="مثال: تكييفات المعرض الأول"></div><div class="field"><label>المكان</label><select class="inp" id="faL"><option value="">عام</option>${S.locs.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select></div>
   <div class="field"><label>${opening ? "صافي القيمة يوم الافتتاح" : "التكلفة"}</label><input class="inp num" type="number" min="0" id="faV"></div><div class="field"><label>${opening ? "العمر الباقي (شهور)" : "العمر الإنتاجي (شهور)"}</label><input class="inp num" type="number" min="1" id="faM" value="60"></div><div class="field"><label>قيمة الخردة في الآخر</label><input class="inp num" type="number" min="0" id="faS" value="0"></div>
   ${opening ? "" : `<div class="field"><label>تاريخ الشراء</label><input class="inp" type="date" id="faD" value="${today()}" max="${today()}"></div><div class="field"><label>اتدفع من</label><select class="inp" id="faP">${(F.cashAcc || []).filter(a => a.kind !== "drawer").map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>`}</div><div id="faErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="cpAssetGo" data-op="${opening ? 1 : ""}">حفظ</button></div></div>`); }

/* =====================================================================
   أرصدة أول المدة
   ===================================================================== */
async function loadOpen() { await loadDir(); const [acc, sup, assets, gl] = await Promise.all([q("cash_accounts", "*", x => x.order("id")), q("suppliers", "id,name,opening_balance,kind"), q("fixed_assets", "*", x => x.eq("opening", true)), rpc("fin_rows", { p_token: T(), p_from: null, p_to: null }).catch(() => [])]);
  const st = S.store || {}, o = st.opening || {};
  S.ob = { acc, sup, assets, gl, date: st.opening_date || today(), locked: !!st.opening_locked,
    v: { cash: Object.fromEntries((o.cash || []).map(c => [c.id, +c.v])), ar: +o.ar || 0, fin: +o.fin || 0, recv: +o.recv || 0, pre: +o.pre || 0, acc: +o.acc || 0, def: +o.def || 0, loans: +o.loans || 0, capital: +o.capital || 0, retained: +o.retained || 0 }, loaded: true }; }
function obTot() { const O = S.ob, v = O.v, cash = Object.values(v.cash).reduce((a, x) => a + (+x || 0), 0);
  const stockOpen = O.gl.filter(r => r[3] === "3103" && r[1] === "stock").reduce((a, r) => a + +r[5] - +r[4], 0), fixed = O.assets.reduce((a, x) => a + +x.start_value, 0), sup = O.sup.reduce((a, s) => a + +s.opening_balance, 0);
  const assets = cash + stockOpen + v.ar + v.fin + v.recv + v.pre + fixed, liab = sup + v.acc + v.def + v.loans, eq = v.capital + v.retained; return { cash, stock: stockOpen, fixed, sup, assets, liab, eq, diff: r2(assets - liab - eq) }; }
V.opening = () => {
  const O = S.ob; if (!O || !O.loaded) return header() + later(loadOpen, "opening");
  if (!seeCost()) return header() + `<div class="warnbox">الشاشة دي فيها التكلفة، ودورك مش بيشوفها.</div>`;
  const T0 = obTot(), ed = !O.locked && (isTop() || can("opening", "e")), dis = ed ? "" : "disabled", v = O.v;
  const inp = (k, val) => `<input class="inp num" type="number" step="0.01" data-ob="${k}" value="${val || 0}" ${dis} style="width:150px">`, line = (n, h, sub) => `<tr><td>${n}${sub ? `<br><span class="dim" style="font-size:12px">${sub}</span>` : ""}</td><td class="n">${h}</td></tr>`;
  let h = header(O.locked ? `${chip("معتمدة ومقفولة", "ok")}${isOwner() ? `<button class="btn" data-act="obUnlock">فتح للتعديل</button>` : ""}` : `${ed ? `<button class="btn" data-act="obSave">حفظ</button>` : ""}${isTop() || can("opening", "p") ? `<button class="btn gold" data-act="obLock">اعتماد وإقفال الأرصدة</button>` : ""}`);
  h += kpis([["إجمالي الأصول", T0.assets], ["إجمالي الخصوم", T0.liab], ["حقوق الملكية", T0.eq], [T0.diff === 0 ? "الميزانية متوازنة" : "الفرق", T0.diff === 0 ? "✓" : fmt(T0.diff), 1, T0.diff === 0 ? "--ok" : "--bad", T0.diff === 0 ? "الأصول = الخصوم + حقوق الملكية" : "الأصول − (الخصوم + حقوق الملكية)"]]);
  if (T0.diff !== 0 && ed) h += `<div class="warnbox rise">الميزانية مش متوازنة بفرق ${fmt(T0.diff)}. <button class="btn sm" data-act="obPlug">ترحيل الفرق للأرباح المرحّلة</button></div>`;
  h += `<div class="card rise"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:end"><div class="field"><label>تاريخ الأرصدة الافتتاحية (بداية التشغيل على السيستم)</label><input class="inp" type="date" id="obD" value="${esc(O.date)}" ${dis}></div><p class="dim" style="flex:1;min-width:240px;font-size:12.5px;margin:0">الأرصدة دي نقطة البداية للخزنة والحسابات العامة والتدفق النقدي ورأس المال. المخزون بييجي من «استيراد الأصناف والأرصدة»، وأرصدة الموردين من شاشة الموردين، والأصول الثابتة من هنا.</p></div></div>`;
  h += `<div class="grid g2"><div class="card rise"><h3>الأصول · ${fmt(T0.assets)}</h3><div class="tw"><table><tbody><tr><td colspan="2" class="dim">النقدية · ${fmt(T0.cash)}</td></tr>${O.acc.map(a => line(esc(a.name), `<input class="inp num" type="number" step="0.01" data-obc="${a.id}" value="${v.cash[a.id] || 0}" ${dis} style="width:150px">`)).join("")}
     <tr><td colspan="2" class="dim">أصول متداولة أخرى</td></tr>${line("المخزون بالتكلفة (كل الأماكن)", fmt(T0.stock, 1), "من استيراد الأرصدة")}${line("مبيعات فيزا وإنستاباي تحت التسوية", inp("ar", v.ar))}${line("مستحق على شركات التقسيط", inp("fin", v.fin))}${line("مدينين آخرين", inp("recv", v.recv))}${line("مصروفات مدفوعة مقدمًا", inp("pre", v.pre))}
     <tr><td colspan="2" class="dim">أصول ثابتة · ${fmt(T0.fixed)}</td></tr>${O.assets.map(a => line(esc(a.name), fmt(a.start_value, 1), a.life_months + " شهر باقي")).join("")}${ed ? `<tr><td colspan="2"><button class="btn sm ghost" data-act="obAsset">${ico("plus")} أصل ثابت</button></td></tr>` : ""}</tbody></table></div></div>
   <div class="card rise"><h3>الخصوم وحقوق الملكية · ${fmt(T0.liab + T0.eq)}</h3><div class="tw"><table><tbody><tr><td colspan="2" class="dim">أرصدة الموردين · ${fmt(T0.sup)}</td></tr>${O.sup.filter(s => +s.opening_balance).map(s => line(esc(s.name), fmt(s.opening_balance, 1))).join("") || line("مفيش أرصدة", "—", "من شاشة الموردين")}
     <tr><td colspan="2" class="dim">خصوم متداولة أخرى</td></tr>${line("مصروفات مستحقة (مرتبات، كهرباء…)", inp("acc", v.acc))}${line("مقدمات من عملاء لسه ما استلموش", inp("def", v.def))}${line("قروض", inp("loans", v.loans))}
     <tr><td colspan="2" class="dim">حقوق الملكية</td></tr>${line("رأس المال", inp("capital", v.capital))}${line("الأرباح المرحّلة", inp("retained", v.retained))}</tbody></table></div></div></div><div id="obErr"></div>`;
  return h;
};
H.opening = () => { const O = S.ob; if (!O || !O.loaded) return; document.querySelectorAll("[data-ob]").forEach(el => el.onchange = () => { O.v[el.dataset.ob] = +el.value || 0; render(); });
  document.querySelectorAll("[data-obc]").forEach(el => el.onchange = () => { O.v.cash[el.dataset.obc] = +el.value || 0; render(); }); const d = $("#obD"); if (d) d.onchange = () => { O.date = d.value; }; };
const obPayload = () => { const O = S.ob, v = O.v; return { date: O.date, cash: Object.entries(v.cash).filter(([, x]) => +x).map(([id, x]) => ({ id: +id, v: +x })), ar: v.ar, fin: v.fin, recv: v.recv, pre: v.pre, acc: v.acc, def: v.def, loans: v.loans, capital: v.capital, retained: v.retained }; };

/* =====================================================================
   REPORT DATA (period + location), loaded once per period
   ===================================================================== */
async function inChunks(table, col, ids, sel) { const out = []; for (let i = 0; i < ids.length; i += 150) out.push(...await q(table, sel || "*", x => x.in(col, ids.slice(i, i + 150)))); return out; }
async function loadRep() { const D = S.rd || (S.rd = {}); if (D.key === perKey()) return D; const { from, to } = S.per, f0 = from + "T00:00:00+02:00", t0 = to + "T23:59:59+02:00";
  await loadDir();
  const [sales, rets, exps, cats, pur, sups, spay, moves, trs, dcl, shifts, dlv, offers, fr] = await Promise.all([
    q("sales", "*", x => x.gte("business_day", from).lte("business_day", to).limit(20000)), q("returns", "*", x => x.gte("created_at", f0).lte("created_at", t0)), q("expenses", "*", x => x.gte("exp_date", from).lte("exp_date", to)), q("expense_categories", "*"),
    q("purchase_invoices", "*"), q("suppliers", "*"), q("supplier_payments", "*"), q("stock_moves", "item_id,location_id,qty,cost,kind,created_at,ref_type", x => x.gte("created_at", addD(from, -90) + "T00:00:00+02:00").lte("created_at", t0).limit(50000)),
    q("transfers", "*", x => x.gte("created_at", f0).lte("created_at", t0)), q("day_closings", "*", x => x.gte("business_day", from).lte("business_day", to)), q("shifts", "*", x => x.gte("opened_at", f0).lte("opened_at", t0)),
    q("deliveries", "*", x => x.gte("created_at", f0).lte("created_at", t0)), q("offers", "id,name"), q("finance_receivables", "*", x => x.gte("created_at", f0).lte("created_at", t0))]);
  const ids = sales.map(s => s.id), [lines, pays, rlines] = ids.length ? await Promise.all([inChunks("sale_lines", "sale_id", ids), inChunks("sale_payments", "sale_id", ids), rets.length ? inChunks("return_lines", "return_id", rets.map(r => r.id)) : []]) : [[], [], []];
  Object.assign(D, { sales, lines, pays, rets, rlines, exps, cats, pur, sups, spay, moves, trs, dcl, shifts, dlv, offers, fr, key: perKey() }); return D; }
const itm = id => S.items.find(i => i.id === id) || { name: "—", unit: "piece" }, dep = id => (S.depts.find(d => d.id === id) || {}).name || "من غير قسم", grp = id => (S.groups.find(g => g.id === id) || {}).name || "من غير مجموعة";
const posted = D => D.sales.filter(s => s.status === "posted" && inLoc(s.location_id));
const lineNet = l => +l.qty * +l.unit_price - +l.discount - +(l.offer_disc || 0) - +l.vat;
const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
function groupBy(a, k) { const m = new Map(); a.forEach(x => { const key = k(x); if (!m.has(key)) m.set(key, []); m.get(key).push(x); }); return m; }

/* Hijri months for seasonality (Ramadan = 9, Shawwal = 10, Dhu al-Hijjah = 12) */
const hijriM = d => { try { return +new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "numeric" }).format(new Date(d + "T12:00:00Z")); } catch (e) { return 0; } };

/* the 37 reports: [id, group, name, needsCost, run(D) → {k, head, rows, note} | link] */
const REPORTS = [
  ["daily", "المبيعات", "المبيعات اليومية حسب المعرض", 0, D => { const g = groupBy(posted(D), s => s.business_day + "|" + s.location_id); const rows = [...g].map(([k, a]) => [k.split("|")[0], locName(+k.split("|")[1]), a.length, r2(sum(a, s => s.gross)), r2(sum(a, s => +s.discount + +(s.offer_disc || 0))), r2(sum(a, s => s.total)), r2(sum(a, s => s.total) / a.length)]).sort((a, b) => a[0] < b[0] ? 1 : -1);
    return { k: [["الفواتير", sum(rows, r => r[2]), 1], ["صافي المبيعات", sum(rows, r => r[5])], ["متوسط الفاتورة", rows.length ? sum(rows, r => r[5]) / Math.max(1, sum(rows, r => r[2])) : 0]], head: ["اليوم", "المعرض", "الفواتير", "الإجمالي", "الخصومات", "الصافي", "متوسط الفاتورة"], rows, bar: 5 }; }],
  ["bycat", "المبيعات", "المبيعات حسب القسم والمجموعة", 0, D => { const P = new Set(posted(D).map(s => s.id)), g = groupBy(D.lines.filter(l => P.has(l.sale_id)), l => { const i = itm(l.item_id); return dep(i.department_id) + "|" + grp(i.group_id); });
    const rows = [...g].map(([k, a]) => [k.split("|")[0], k.split("|")[1], r2(sum(a, l => l.qty)), r2(sum(a, lineNet))]).sort((a, b) => b[3] - a[3]), tot = sum(rows, r => r[3]); rows.forEach(r => r.push(pct(tot ? r[3] / tot * 100 : 0))); return { head: ["القسم", "المجموعة", "الكمية", "صافي المبيعات", "النسبة"], rows, bar: 3 }; }],
  ["byitem", "المبيعات", "المبيعات والربح حسب الصنف", 1, D => { const P = new Set(posted(D).map(s => s.id)), g = groupBy(D.lines.filter(l => P.has(l.sale_id)), l => l.item_id);
    const rows = [...g].map(([k, a]) => { const n = sum(a, lineNet), c = sum(a, l => l.cost); return [itm(k).name, r2(sum(a, l => l.qty)), r2(n), r2(c), r2(n - c), pct(n ? (n - c) / n * 100 : 0)]; }).sort((a, b) => b[4] - a[4]); return { head: ["الصنف", "الكمية", "صافي المبيعات", "التكلفة", "الربح", "الهامش"], rows, bar: 4 }; }],
  ["byseller", "المبيعات", "المبيعات حسب البائع", 0, D => { const g = groupBy(posted(D), s => s.seller_id || s.cashier_id); const rows = [...g].map(([k, a]) => [who(k), a.length, r2(sum(a, s => s.total)), r2(sum(a, s => s.total) / a.length)]).sort((a, b) => b[2] - a[2]); return { head: ["البائع", "الفواتير", "الصافي", "متوسط الفاتورة"], rows, bar: 2 }; }],
  ["bypay", "المبيعات", "التحصيل حسب طريقة الدفع", 0, D => { const P = new Set(posted(D).map(s => s.id)), g = groupBy(D.pays.filter(p => P.has(p.sale_id)), p => p.method), tot = sum(D.pays.filter(p => P.has(p.sale_id)), p => p.amount);
    return { head: ["الطريقة", "عدد المرات", "المبلغ", "النسبة"], rows: [...g].map(([k, a]) => [k === "inst" ? "تقسيط" : PAYN[k] || k, a.length, r2(sum(a, p => p.amount)), pct(tot ? sum(a, p => p.amount) / tot * 100 : 0)]).sort((a, b) => b[2] - a[2]), bar: 2 }; }],
  ["hourly", "المبيعات", "المبيعات حسب ساعات اليوم", 0, D => { const g = groupBy(posted(D), s => new Date(new Date(s.created_at).getTime() + 2 * 3600e3).getUTCHours()); return { head: ["الساعة", "الفواتير", "الصافي"], rows: [...Array(24).keys()].filter(hh => g.has(hh)).map(hh => [String(hh).padStart(2, "0") + ":00", g.get(hh).length, r2(sum(g.get(hh), s => s.total))]), bar: 2 }; }],
  ["invoices", "المبيعات", "سجل الفواتير", 0, D => ({ head: ["الفاتورة", "الوقت", "المعرض", "الكاشير", "البائع", "الإجمالي", "الخصم", "الصافي", "الحالة"], rows: D.sales.filter(s => inLoc(s.location_id)).sort((a, b) => a.created_at < b.created_at ? 1 : -1).map(s => [s.no, dt(s.created_at), locName(s.location_id), who(s.cashier_id), s.seller_id ? who(s.seller_id) : "", +s.gross, r2(+s.discount + +(s.offer_disc || 0)), +s.total, s.status === "void" ? "ملغاة" : "سارية"]) })],
  ["lnk_basis", "الأرباح", "الربح بأساس الاستحقاق مقابل الأساس النقدي", 1, "basis"],
  ["pl", "الأرباح", "قائمة الدخل لكل معرض", 1, async () => { const G = await loadGLAll(), { from, to } = S.per, L = [null, ...S.locs.filter(l => myLoc(l.id)).map(l => l.id)], P = L.map(l => pl(G.rows, from, to, l));
    const lines = [["المبيعات", "sales"], ["(−) المردودات", "ret"], ["صافي المبيعات", "net"], ["(−) تكلفة البضاعة", "cogs"], ["مجمل الربح", "gp"], ["(−) مصروفات التشغيل", "ox"], ["(+) إيرادات أخرى", "other"], ["صافي الربح", "np"]];
    return { head: ["البند", ...L.map(l => l == null ? "الإجمالي" : locName(l))], rows: lines.map(([n, k]) => [n, ...P.map(p => r2(p[k]))]), note: "مصروفات الإدارة العامة (من غير مكان) بتظهر في الإجمالي بس." }; }],
  ["prof", "الأرباح", "ربحية الأقسام والبائعين والعروض", 1, D => { const P = new Set(posted(D).map(s => s.id)), L = D.lines.filter(l => P.has(l.sale_id)), sale = id => D.sales.find(s => s.id === id) || {};
    const rows = []; groupBy(L, l => dep(itm(l.item_id).department_id)).forEach((a, k) => rows.push(["قسم", k, r2(sum(a, lineNet)), r2(sum(a, lineNet) - sum(a, l => l.cost))]));
    groupBy(L, l => who(sale(l.sale_id).seller_id || sale(l.sale_id).cashier_id)).forEach((a, k) => rows.push(["بائع", k, r2(sum(a, lineNet)), r2(sum(a, lineNet) - sum(a, l => l.cost))]));
    groupBy(L.filter(l => l.offer_id), l => (D.offers.find(o => o.id === l.offer_id) || {}).name || "عرض").forEach((a, k) => rows.push(["عرض", k, r2(sum(a, lineNet)), r2(sum(a, lineNet) - sum(a, l => l.cost))]));
    rows.forEach(r => r.push(pct(r[2] ? r[3] / r[2] * 100 : 0))); return { head: ["النوع", "الاسم", "صافي المبيعات", "الربح", "الهامش"], rows, bar: 3 }; }],
  ["val", "المخزون", "قيمة المخزون بالتكلفة وسعر البيع", 1, async () => { const L = await q("stock_layers", "item_id,location_id,qty_left,unit_cost", x => x.gt("qty_left", 0).limit(50000)), g = groupBy(L.filter(l => inLoc(l.location_id)), l => l.item_id);
    const rows = [...g].map(([k, a]) => { const qn = sum(a, l => l.qty_left), c = sum(a, l => +l.qty_left * +l.unit_cost), i = itm(k); return [i.name, dep(i.department_id), r2(qn), r2(c), r2(qn * +i.sale_price), r2(qn * +i.sale_price - c)]; }).sort((a, b) => b[3] - a[3]);
    return { k: [["القيمة بالتكلفة", sum(rows, r => r[3])], ["القيمة بسعر البيع", sum(rows, r => r[4])], ["الربح المتوقع", sum(rows, r => r[5])]], head: ["الصنف", "القسم", "الكمية", "بالتكلفة (FIFO)", "بسعر البيع", "الربح المتوقع"], rows, bar: 3 }; }],
  ["move", "المخزون", "حركة البضاعة: نشطة وبطيئة وراكدة", 0, D => { const days = Math.max(1, (new Date(S.per.to) - new Date(S.per.from)) / 864e5 + 1), sold = {}; D.moves.filter(m => m.kind === "sale" && m.created_at.slice(0, 10) >= S.per.from && inLoc(m.location_id)).forEach(m => { sold[m.item_id] = (sold[m.item_id] || 0) - +m.qty; });
    const rows = S.items.map(i => { const st = S.stock.filter(s => s.item_id === i.id && inLoc(s.location_id)).reduce((a, s) => a + +s.qty, 0), sp = (sold[i.id] || 0) / days, cover = sp > 0 ? st / sp : Infinity; return [i.name, r2(st), r2(sold[i.id] || 0), isFinite(cover) ? Math.round(cover) + " يوم" : "—", !sold[i.id] ? (st > 0 ? "راكد" : "—") : cover > 90 ? "بطيء" : "نشط"]; }).filter(r => r[1] || r[2]).sort((a, b) => b[2] - a[2]);
    return { k: [["نشط", rows.filter(r => r[4] === "نشط").length, 1], ["بطيء", rows.filter(r => r[4] === "بطيء").length, 1], ["راكد", rows.filter(r => r[4] === "راكد").length, 1]], head: ["الصنف", "الرصيد", "اتباع في الفترة", "يكفي لمدة", "الحالة"], rows }; }],
  ["low", "المخزون", "النواقص وأصناف تحت الحد الأدنى", 0, () => ({ head: ["الصنف", "المكان", "الرصيد", "الحد الأدنى", "الناقص"], rows: S.items.filter(i => +i.min_qty > 0).flatMap(i => S.locs.filter(l => inLoc(l.id) && l.kind === "showroom").map(l => { const st = S.stock.filter(s => s.item_id === i.id && s.location_id === l.id).reduce((a, s) => a + +s.qty, 0); return [i.name, l.name, r2(st), +i.min_qty, r2(Math.max(0, +i.min_qty - st))]; })).filter(r => r[2] <= r[3]).sort((a, b) => b[4] - a[4]) })],
  ["fifo", "المخزون", "طبقات تكلفة FIFO لكل صنف", 1, async () => { const L = await q("stock_layers", "*", x => x.gt("qty_left", 0).order("id").limit(50000)); return { head: ["الصنف", "المكان", "تاريخ الطبقة", "الكمية الأصلية", "الباقي", "تكلفة الوحدة", "القيمة", "المرجع"], rows: L.filter(l => inLoc(l.location_id)).map(l => [itm(l.item_id).name, locName(l.location_id), l.created_at.slice(0, 10), +l.qty_in, +l.qty_left, +l.unit_cost, r2(+l.qty_left * +l.unit_cost), l.ref || ""]) }; }],
  ["transfers", "المخزون", "سجل التحويلات بين الأماكن", 0, D => ({ head: ["رقم التحويل", "التاريخ", "من", "إلى", "الحالة", "ملاحظة"], rows: D.trs.filter(t => inLoc(t.from_location) || inLoc(t.to_location)).map(t => [t.no, t.created_at.slice(0, 10), locName(t.from_location), locName(t.to_location), { requested: "مطلوب", approved: "معتمد", shipped: "في الطريق", received: "اتستلم", cancelled: "ملغي" }[t.status], t.note || ""]) })],
  ["serials", "المخزون", "سجل المسلسلات والأجهزة", 0, async () => { const L = await q("serials", "*", x => x.order("created_at", { ascending: false }).limit(5000)); return { head: ["المسلسل", "الصنف", "المكان", "الحالة", "اتسجّل"], rows: L.filter(s => s.location_id == null || inLoc(s.location_id)).map(s => [s.serial, itm(s.item_id).name, s.location_id ? locName(s.location_id) : "—", { in_stock: "في المخزون", sold: "اتباع", returned_to_supplier: "رجع للمورد", in_transit: "في الطريق" }[s.status], s.created_at.slice(0, 10)]) }; }],
  ["damage", "المخزون", "التالف والهالك وفروق الجرد", 1, D => ({ head: ["التاريخ", "الصنف", "المكان", "النوع", "الكمية", "التكلفة"], rows: D.moves.filter(m => ["waste", "adjust"].includes(m.kind) && m.created_at.slice(0, 10) >= S.per.from && inLoc(m.location_id)).map(m => [m.created_at.slice(0, 10), itm(m.item_id).name, locName(m.location_id), m.kind === "waste" ? (m.ref_type === "cut" ? "فاقد قص" : "تالف / فضلة") : "تسوية جرد", +m.qty, +m.cost]) })],
  ["supbal", "الموردين والمشتريات", "أرصدة الموردين", 0, D => { const rows = D.sups.map(s => { const inv = sum(D.pur.filter(p => p.supplier_id === s.id), p => p.total), paid = sum(D.spay.filter(p => p.supplier_id === s.id), p => p.amount); return [s.name, { credit: "آجل", cash: "كاش", consignment: "أمانة" }[s.kind], +s.opening_balance, r2(inv), r2(paid), r2(+s.opening_balance + inv - paid), +s.credit_limit || ""]; }).filter(r => r[2] || r[3] || r[4]).sort((a, b) => b[5] - a[5]);
    return { k: [["إجمالي المستحق للموردين", sum(rows, r => r[5])]], head: ["المورد", "النوع", "أول المدة", "فواتير", "مدفوع", "الرصيد", "حد الائتمان"], rows, bar: 5 }; }],
  ["aging", "الموردين والمشتريات", "أعمار ديون الموردين", 0, D => { const t = today(), rows = []; D.sups.forEach(s => { let paid = sum(D.spay.filter(p => p.supplier_id === s.id), p => p.amount) - +s.opening_balance; const b = [0, 0, 0, 0, 0];
      D.pur.filter(p => p.supplier_id === s.id).sort((a, c) => a.inv_date < c.inv_date ? -1 : 1).forEach(p => { const take = Math.max(0, Math.min(+p.total, paid)); paid -= take; const left = +p.total - take; if (left <= 0) return; const late = Math.round((new Date(t) - new Date(p.due_date)) / 864e5); b[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += left; });
      if (paid < 0) b[0] += -paid; if (sum(b, x => x)) rows.push([s.name, ...b.map(r2), r2(sum(b, x => x))]); }); return { head: ["المورد", "لسه ما استحقش", "متأخر ١–٣٠", "٣١–٦٠", "٦١–٩٠", "أكتر من ٩٠", "الإجمالي"], rows }; }],
  ["purch", "الموردين والمشتريات", "المشتريات حسب المورد", 0, D => { const P = D.pur.filter(p => p.inv_date >= S.per.from && p.inv_date <= S.per.to && inLoc(p.location_id)), g = groupBy(P, p => p.supplier_id);
    return { head: ["المورد", "الفواتير", "قبل الخصم", "الخصم", "الصافي"], rows: [...g].map(([k, a]) => [(D.sups.find(s => s.id === k) || {}).name || "—", a.length, r2(sum(a, p => p.gross)), r2(sum(a, p => p.discount)), r2(sum(a, p => p.total))]).sort((a, b) => b[4] - a[4]), bar: 4 }; }],
  ["pricechg", "الموردين والمشتريات", "تغير أسعار الشراء", 1, async D => { const P = D.pur.filter(p => p.inv_date >= S.per.from && p.inv_date <= S.per.to), L = P.length ? await inChunks("purchase_lines", "invoice_id", P.map(p => p.id)) : [];
    return { head: ["الصنف", "الفاتورة", "التاريخ", "السعر السابق", "السعر الجديد", "التغير", "السبب"], rows: L.filter(l => l.prev_cost != null && +l.prev_cost !== +l.unit_cost).map(l => { const p = P.find(x => x.id === l.invoice_id) || {}; return [itm(l.item_id).name, p.no, p.inv_date, +l.prev_cost, +l.unit_cost, pct((+l.unit_cost - +l.prev_cost) / +l.prev_cost * 100), l.diff_reason || ""]; }) }; }],
  ["closings", "الخزنة", "التقفيلات اليومية", 0, D => ({ head: ["اليوم", "المعرض", "الفواتير", "صافي المبيعات", "المصروفات", "فرق النقدية", "التوريد", "قفله", "الحالة"], rows: D.dcl.filter(c => inLoc(c.location_id)).sort((a, b) => a.business_day < b.business_day ? 1 : -1).map(c => { const m = c.summary || {}; return [c.business_day, locName(c.location_id), +m.invoices || 0, r2(+m.total - +m.returns), +m.expenses || 0, +m.cash_diff || 0, +m.deposited || 0, who(c.closed_by), c.status === "closed" ? "متقفل" : "اتفتح تاني"]; }) })],
  ["cashvar", "الخزنة", "العجز والزيادة لكل كاشير", 0, D => { const g = groupBy(D.shifts.filter(s => s.diff != null && inLoc(s.location_id)), s => s.cashier_id); return { head: ["الكاشير", "الورديات", "ورديات فيها فرق", "إجمالي العجز", "إجمالي الزيادة", "الصافي"], rows: [...g].map(([k, a]) => [who(k), a.length, a.filter(s => +s.diff).length, r2(sum(a.filter(s => +s.diff < 0), s => s.diff)), r2(sum(a.filter(s => +s.diff > 0), s => s.diff)), r2(sum(a, s => s.diff))]) }; }],
  ["lnk_flow", "الخزنة", "قائمة التدفقات النقدية والسيولة", 1, "flow"],
  ["lnk_open", "الخزنة", "الميزانية الافتتاحية (أرصدة أول المدة)", 1, "opening"],
  ["expcat", "المصروفات", "المصروفات حسب البند مقابل الميزانية", 0, D => { const months = Math.max(1, Math.round((new Date(S.per.to) - new Date(S.per.from)) / (30.4 * 864e5))), E = D.exps.filter(e => e.status === "approved" && (S.per.loc === "all" || e.location_id === +S.per.loc));
    return { head: ["البند", "المجموعة", "الفعلي", "الميزانية للفترة", "النسبة"], rows: D.cats.map(c => { const a = sum(E.filter(e => e.category_id === c.id), e => e.amount), b = +c.budget * months; return [c.name, c.grp, r2(a), b || "", b ? pct(a / b * 100) : "—"]; }).filter(r => r[2] || r[3]).sort((a, b) => b[2] - a[2]), bar: 2 }; }],
  ["expled", "المصروفات", "دفتر المصروفات التفصيلي", 0, D => ({ head: ["الرقم", "التاريخ", "البند", "المكان", "البيان", "المستفيد", "المبلغ", "الحالة"], rows: D.exps.filter(e => S.per.loc === "all" || e.location_id === +S.per.loc).map(e => [e.no, e.exp_date, (D.cats.find(c => c.id === e.category_id) || {}).name || "", e.location_id ? locName(e.location_id) : "عام", e.note, e.payee || "", +e.amount, { pending: "مستني موافقة", approved: "معتمد", rejected: "مرفوض", void: "ملغي" }[e.status]]) })],
  ["topcust", "العملاء", "أفضل العملاء ونقاط الولاء", 0, async () => { const L = await rpc("customers_list", { p_token: T() }); return { head: ["العميل", "الموبايل", "الفواتير", "المشتريات", "النقاط", "آخر زيارة"], rows: L.sort((a, b) => b.spent - a.spent).slice(0, 100).map(c => [c.name, c.phone || "", +c.invoices, +c.spent, +c.points, c.last ? c.last.slice(0, 10) : ""]), bar: 3, sens: [1] }; }],
  ["warranty", "العملاء", "الضمانات السارية والمنتهية قريبًا", 0, async () => { const L = await q("serials", "serial,item_id,sale_id,status", x => x.eq("status", "sold").limit(10000)), S2 = L.length ? await inChunks("sales", "id", [...new Set(L.map(s => s.sale_id).filter(Boolean))], "id,no,created_at,customer_id") : [];
    const rows = L.map(s => { const i = itm(s.item_id), sa = S2.find(x => x.id === s.sale_id); if (!sa || !+i.warranty_months) return null; const u = new Date(sa.created_at); u.setMonth(u.getMonth() + +i.warranty_months); const until = u.toISOString().slice(0, 10), left = Math.round((u - Date.now()) / 864e5); return [s.serial, i.name, sa.no, sa.created_at.slice(0, 10), until, left < 0 ? "انتهى" : left <= 30 ? "بينتهي خلال شهر" : "ساري"]; }).filter(Boolean).sort((a, b) => a[4] < b[4] ? -1 : 1);
    return { k: [["سارية", rows.filter(r => r[5] !== "انتهى").length, 1], ["بتنتهي خلال شهر", rows.filter(r => r[5] === "بينتهي خلال شهر").length, 1]], head: ["المسلسل", "الصنف", "الفاتورة", "اتباع", "الضمان لحد", "الحالة"], rows }; }],
  ["offers", "العروض والمرتجعات", "أداء العروض والعائد على الخصم", 1, D => { const P = new Set(posted(D).map(s => s.id)), g = groupBy(D.lines.filter(l => P.has(l.sale_id) && l.offer_id), l => l.offer_id);
    return { head: ["العرض", "عدد السطور", "قيمة الخصم", "صافي المبيعات", "الربح", "العائد على كل جنيه خصم"], rows: [...g].map(([k, a]) => { const d = sum(a, l => l.offer_disc), n = sum(a, lineNet), p = n - sum(a, l => l.cost); return [(D.offers.find(o => o.id === k) || {}).name || "عرض", a.length, r2(d), r2(n), r2(p), d ? (p / d).toFixed(2) : "—"]; }).sort((a, b) => b[3] - a[3]) }; }],
  ["returns", "العروض والمرتجعات", "المرتجعات وأسبابها وقراراتها", 0, D => { const g = groupBy(D.rets.filter(r => inLoc(r.location_id)), r => r.reason); return { head: ["السبب", "عدد المرتجعات", "القيمة", "منها تالف (سطور)", "رد نقدي"], rows: [...g].map(([k, a]) => [k, a.length, r2(sum(a, r => r.amount)), D.rlines.filter(l => a.some(r => r.id === l.return_id) && l.condition === "damaged").length, r2(sum(a.filter(r => r.refund_method === "cash"), r => r.amount))]).sort((a, b) => b[2] - a[2]) }; }],
  ["payroll", "الموظفين", "المرتبات والعمولات والسلف", 0, async () => { const m = S.per.to.slice(0, 7), r = await rpc("payroll_list", { p_token: T(), p_month: m }); if (!r.see_salary) return { head: ["ملاحظة"], rows: [["دورك مش بيشوف المرتبات."]] };
    return { head: ["الموظف", "الأساسي", "بدلات", "عمولة", "حافز", "خصم تأخير", "خصم غياب", "خصومات أخرى", "سلف", "الصافي"], rows: (r.lines || []).map(l => [l.name, +l.base, +l.allowances, +l.commission, +l.bonus, +l.late_deduct, +l.absent_deduct, +l.other_deduct, +l.advances, +l.net]), bar: 9, note: "مرتبات شهر " + m + (r.run ? " · " + ({ draft: "مسودة", approved: "معتمدة", paid: "اتصرفت" })[r.run.status] : " · لسه ما اتحسبتش من «الموظفين والمرتبات»") }; }],
  ["attend", "الموظفين", "الحضور والانصراف والتأخير", 0, async () => { await loadDir(); const L = await q("attendance", "*", x => x.gte("day", S.per.from).lte("day", S.per.to)), P = await rpc("payroll_list", { p_token: T(), p_month: S.per.to.slice(0, 7) }).catch(() => ({})), pay = id => ((P.pay || []).find(p => p.staff_id === id) || {});
    const g = new Map(); L.forEach(a => { if (!g.has(a.staff_id)) g.set(a.staff_id, []); g.get(a.staff_id).push(a); });
    return { head: ["الموظف", "أيام حضور", "إجازة / مرضي", "غياب مسجّل", "دقايق تأخير", "متوسط ساعات اليوم"], rows: [...g].map(([k, a]) => { const ss = String(pay(k).shift_start || "10:00").slice(0, 5), gr = pay(k).grace_min != null ? +pay(k).grace_min : 15, inn = a.filter(x => x.check_in);
      const late = inn.reduce((s2, x) => { const t = new Date(new Date(x.check_in).getTime() + 2 * 3600e3).toISOString().slice(11, 16), d = (+t.slice(0, 2) * 60 + +t.slice(3)) - (+ss.slice(0, 2) * 60 + +ss.slice(3)); return s2 + Math.max(0, d - gr); }, 0), hrs = inn.filter(x => x.check_out).map(x => (new Date(x.check_out) - new Date(x.check_in)) / 36e5);
      return [who(k), inn.length, a.filter(x => ["leave", "sick"].includes(x.status)).length, a.filter(x => x.status === "absent").length, late, hrs.length ? (hrs.reduce((s2, v) => s2 + v, 0) / hrs.length).toFixed(1) : "—"]; }) }; }],
  ["deliv", "التوصيل والضرائب", "طلبات التوصيل والتركيب", 0, D => ({ k: [["الطلبات", D.dlv.length, 1], ["اتسلّمت", D.dlv.filter(d => ["delivered", "closed"].includes(d.status)).length, 1], ["بتركيب", D.dlv.filter(d => d.install).length, 1]], head: ["الطلب", "التاريخ", "المعرض", "العميل", "المنطقة", "تركيب", "المندوب", "الحالة"], rows: D.dlv.filter(d => inLoc(d.location_id)).map(d => [d.no, d.created_at.slice(0, 10), locName(d.location_id), d.customer_name, d.area || "", d.install ? "نعم" : "", d.driver || "", { new: "جديد", prep: "قيد التجهيز", way: "في الطريق", delivered: "اتسلّم", closed: "اتقفل", cancelled: "ملغي" }[d.status]]), sens: [3] })],
  ["tax", "التوصيل والضرائب", "الملخص الضريبي", 0, D => { const P = posted(D), g = groupBy(D.lines.filter(l => P.some(s => s.id === l.sale_id)), l => { const i = itm(l.item_id); return i.vat_rate != null ? +i.vat_rate : +((S.store || {}).vat_rate || 14); });
    return { head: ["النسبة", "المبيعات قبل الضريبة", "الضريبة"], rows: [...g].map(([k, a]) => [k + "%", r2(sum(a, lineNet)), r2(sum(a, l => l.vat))]), note: (S.store || {}).vat_registered ? "الضريبة المستحقة في الفترة على حساب «ضريبة القيمة المضافة المستحقة»." : "المحل مش مسجّل في الضريبة — الملخص هيبقى فيه أرقام بعد التفعيل." }; }],
  ["resv", "الحجوزات وعروض الأسعار", "الحجوزات والعرابين", 0, async () => { const { from, to } = S.per, L = await q("reservations", "*", x => x.order("created_at", { ascending: false }).limit(5000)), inP = r => r.created_at.slice(0, 10) >= from && r.created_at.slice(0, 10) <= to;
    const custs = await q("customers", "id,name,phone", x => x.in("id", [...new Set(L.map(r => r.customer_id).filter(Boolean))].slice(0, 900))).catch(() => []), cn = id => (custs.find(c => c.id === id) || {}).name || "—";
    const P = L.filter(r => inP(r) && inLoc(r.location_id)), open = L.filter(r => r.status === "open" && inLoc(r.location_id)), late = open.filter(r => r.due_date && r.due_date < today()), st = { open: "مفتوح", done: "اتسلّم", cancelled: "اتلغى" };
    return { k: [["عرابين في الخزنة دلوقتي", sum(open, r => r.deposit)], ["حجوزات مفتوحة", open.length, 1], ["فات ميعادها", late.length, 1], ["اتسلّمت من حجوزات الفترة", P.length ? pct(P.filter(r => r.status === "done").length / P.length * 100) : "—", 1]],
      head: ["الحجز", "التاريخ", "المعرض", "العميل", "القيمة", "العربون", "الباقي", "الميعاد", "الحالة"], rows: P.map(r => [r.no, r.created_at.slice(0, 10), locName(r.location_id), cn(r.customer_id), r2(r.total), r2(r.deposit), r.status === "open" ? r2(+r.total - +r.deposit) : 0, r.due_date || "—", (st[r.status] || r.status) + (r.status === "open" && r.due_date && r.due_date < today() ? " · فات ميعاده" : "")]), bar: 4 }; }],
  ["quotes", "الحجوزات وعروض الأسعار", "عروض الأسعار ونسبة تحويلها لفواتير", 0, async () => { const { from, to } = S.per, L = (await q("quotes", "id,no,location_id,customer_name,customer_phone,total,valid_until,staff_id,created_at,sale_id,converted_at", x => x.gte("created_at", from + "T00:00:00+02:00").lte("created_at", to + "T23:59:59+02:00").limit(5000))).filter(r => inLoc(r.location_id));
    await loadDir(); const conv = L.filter(r => r.sale_id), g = groupBy(L, r => r.staff_id);
    return { k: [["عروض الأسعار", L.length, 1], ["اتحوّلت لفواتير", conv.length, 1], ["نسبة التحويل", L.length ? pct(conv.length / L.length * 100) : "—", 1], ["قيمة اللي اتحوّل", sum(conv, r => r.total)]],
      head: ["الموظف", "عروض", "اتحوّلت", "النسبة", "قيمة العروض", "قيمة اللي اتحوّل"], rows: [...g].map(([k, a]) => { const c = a.filter(r => r.sale_id); return [who(k), a.length, c.length, pct(a.length ? c.length / a.length * 100 : 0), r2(sum(a, r => r.total)), r2(sum(c, r => r.total))]; }).sort((a, b) => b[5] - a[5]), bar: 5,
      note: "التحويل بيتحسب للعروض اللي اتعملت لها فاتورة بزرار «فاتورة» من عرض السعر — من نسخة 1.18.0 وطالع." }; }],
  ["coupons", "العروض والمرتجعات", "أداء الكوبونات", 0, async D => { const { from, to } = S.per, U = await q("coupon_uses", "*", x => x.gte("created_at", from + "T00:00:00+02:00").lte("created_at", to + "T23:59:59+02:00").limit(20000)), C = await q("coupons", "id,code,kind,value,status,uses,max_uses,ends_at");
    const P = new Map(posted(D).map(s => [s.id, s])), g = groupBy(U.filter(u => P.has(u.sale_id)), u => u.coupon_id);
    const rows = C.map(c => { const a = g.get(c.id) || []; return [c.code, c.kind === "pct" ? num(c.value) + "٪" : fmt(c.value), a.length, new Set(a.map(u => u.customer_phone).filter(Boolean)).size, r2(sum(a, u => u.amount)), r2(sum(a, u => (P.get(u.sale_id) || {}).total)), c.status === "active" ? (c.ends_at && c.ends_at < today() ? "انتهى" : "شغال") : "موقوف"]; }).filter(r => r[2] > 0 || r[6] === "شغال").sort((a, b) => b[5] - a[5]);
    return { k: [["مرات الاستخدام", sum(rows, r => r[2]), 1], ["إجمالي الخصم", sum(rows, r => r[4])], ["مبيعات بالكوبونات", sum(rows, r => r[5])], ["كل جنيه خصم جاب", sum(rows, r => r[4]) ? num(r2(sum(rows, r => r[5]) / sum(rows, r => r[4]))) + " جنيه" : "—", 1]],
      head: ["الكوبون", "القيمة", "مرات الاستخدام", "عملاء مختلفين", "الخصم", "صافي الفواتير", "الحالة"], rows, bar: 5 }; }],
  ["swaps", "العروض والمرتجعات", "التبديل والمرتجع على العروض", 0, async D => { const R = D.rets.filter(r => inLoc(r.location_id)), sw = R.filter(r => r.exchange_sale), ob = R.filter(r => +r.offer_back > 0), sale = id => D.sales.find(s => s.id === id);
    const extra = sw.length ? await inChunks("sales", "id", sw.map(r => r.exchange_sale)).catch(() => []) : [], ns = id => (extra.find(s => s.id === id) || sale(id) || {});
    return { k: [["عمليات تبديل", sw.length, 1], ["قيمة المرتجع في التبديل", sum(sw, r => r.amount)], ["فواتير التبديل الجديدة", sum(sw, r => +(ns(r.exchange_sale).total || 0))], ["مخصوم بسبب كسر عرض", sum(ob, r => r.offer_back)]],
      head: ["التاريخ", "المعرض", "الفاتورة الأصلية", "المرتجع", "الفاتورة الجديدة", "قيمتها", "الفرق", "مخصوم عرض"], rows: R.filter(r => r.exchange_sale || +r.offer_back > 0).map(r => { const n = ns(r.exchange_sale), o = sale(r.sale_id) || {}; return [r.created_at.slice(0, 10), locName(r.location_id), o.no || "—", r2(r.amount), n.no || "—", r2(+(n.total || 0)), r2(+(n.total || 0) - +r.amount), r2(+r.offer_back || 0)]; }),
      note: "الفرق بالموجب = العميل دفع زيادة، وبالسالب = اترد له. «مخصوم عرض» = اللي اتخصم من المرتجع لأن القطعة كانت جزء من عرض." }; }],
  ["kits", "المخزون", "الأطقم: تجميع وفك وبيع", 0, async () => { const K = await rpc("kit_stats", { p_token: T() }), P = await q("kit_parts", "*");
    return { head: ["الطقم", "عدد الأجزاء", "متجمّع في الكرتونة دلوقتي", "اتجمّع", "اتعمل طقم مفتوح", "اتفك", "اتباع"], rows: (K || []).map(k => [itm(k.kit_id).name, P.filter(p => p.kit_id === k.kit_id).length, r2(k.packed), r2(k.built), r2(k.open), r2(k.apart), r2(k.sold)]).sort((a, b) => b[6] - a[6]), bar: 6,
      note: "الأرقام من أول تشغيل الأطقم، لكل الأماكن." }; }],
  ["stktk", "المخزون", "نتايج الجرد وفروقه", 1, async () => { const { from, to } = S.per, L = (await rpc("stocktakes_list", { p_token: T() })).filter(t => t.status === "posted" && inLoc(t.loc) && (t.posted_at || "").slice(0, 10) >= from && (t.posted_at || "").slice(0, 10) <= to);
    return { k: [["جرد اتعتمد", L.length, 1], ["قيمة العجز", -sum(L, t => t.short_value), 0, "--bad"], ["قيمة الزيادة", sum(L, t => t.over_value)], ["الصافي", sum(L, t => +t.short_value + +t.over_value)]],
      head: ["الجرد", "المكان", "بدأ", "اتعتمد", "العجز", "الزيادة", "الصافي"], rows: L.map(t => [t.no, locName(t.loc), (t.started_at || "").slice(0, 10), (t.posted_at || "").slice(0, 10), r2(-t.short_value), r2(t.over_value), r2(+t.short_value + +t.over_value)]) }; }],
  ["stkstaff", "المخزون", "الجرد لكل موظف", 0, async () => { const { from, to } = S.per, L = await rpc("stocktake_staff_stats", { p_token: T(), p_from: from, p_to: to });
    return { head: ["الموظف", "عدد مرات الجرد", "أصناف عدّها", "مرات التسجيل", "أصناف اتعادت", "نسبة اللي اتعاد"], rows: (L || []).map(r => [r.staff, r.counts, r.items, r.entries, r.redone, pct(r.items ? r.redone / r.items * 100 : 0)]),
      note: "«اتعادت» = الصنف اللي عدّه وبعدين اتطلب له عدّ تاني بسبب فرق. نسبة عالية معناها محتاج يركّز أكتر أو يتدرّب. الجرد المعتمد في الفترة بس." }; }],
  ["attgeo", "الموظفين", "البصمة بالموبايل من بره المكان", 0, async () => { const { from, to } = S.per, days = Math.max(1, Math.ceil((new Date(today()) - new Date(from)) / 864e5) + 1), L = (await rpc("att_events_list", { p_token: T(), p_days: Math.min(400, days) })).filter(e => e.at.slice(0, 10) >= from && e.at.slice(0, 10) <= to && (e.loc == null || inLoc(e.loc)));
    const KN = { in_out: "حضور من بره", out_out: "انصراف من بره", away: "خرج", back: "رجع" }, g = groupBy(L, e => e.staff);
    return { k: [["حضور من بره المكان", L.filter(e => e.kind === "in_out").length, 1], ["انصراف من بره المكان", L.filter(e => e.kind === "out_out").length, 1], ["مرات الخروج أثناء الشغل", L.filter(e => e.kind === "away").length, 1]],
      head: ["الموظف", "حضور من بره", "انصراف من بره", "خرج من المكان", "رجع", "أبعد مسافة (متر)", "آخر مرة"], rows: [...g].map(([k, a]) => [k, a.filter(e => e.kind === "in_out").length, a.filter(e => e.kind === "out_out").length, a.filter(e => e.kind === "away").length, a.filter(e => e.kind === "back").length, Math.max(0, ...a.map(e => +e.dist || 0)), dt(a[0].at)]).sort((a, b) => b[1] + b[2] + b[3] - a[1] - a[2] - a[3]),
      note: "التفاصيل والخريطة في شاشة «الموظفين والمرتبات» ← الحضور اليومي." }; }],
  ["bdays", "العملاء", "أعياد ميلاد العملاء", 0, async () => { const L = (await rpc("customers_list", { p_token: T() })).filter(c => c.birthday), t = today(), md = d => d.slice(5);
    const next = c => { let y = +t.slice(0, 4), d = y + "-" + md(c.birthday); if (d < t) d = (y + 1) + "-" + md(c.birthday); return d; };
    const rows = L.map(c => { const n = next(c), inD = Math.round((new Date(n) - new Date(t)) / 864e5); return [c.name || "—", c.phone || "", c.birthday, n, inD, r2(c.spent || c.total || 0)]; }).filter(r => r[4] <= 31).sort((a, b) => a[4] - b[4]);
    return { k: [["النهارده", rows.filter(r => r[4] === 0).length, 1], ["الأسبوع ده", rows.filter(r => r[4] <= 7).length, 1], ["خلال شهر", rows.length, 1]], head: ["العميل", "الموبايل", "تاريخ الميلاد", "عيد الميلاد الجاي", "بعد كام يوم", "مشترياته"], rows, sens: [1],
      note: "التهنئة من غير خصم، زي ما اتفقنا. الموبايل بيظهر حسب صلاحيتك." }; }],
  ["custnew", "العملاء", "العملاء الجداد والمتكررين", 0, async D => { const P = posted(D), withC = P.filter(s => s.customer_id), g = groupBy(withC, s => s.customer_id), ids = [...g.keys()];
    const C = ids.length ? await inChunks("customers", "id", ids) : [], cust = id => C.find(c => c.id === id) || {}, { from } = S.per;
    const prev = ids.length ? await inChunks("sales", "customer_id", ids).catch(() => []) : [], before = new Set(prev.filter(s => s.status === "posted" && s.business_day < from).map(s => s.customer_id));
    const rows = [...g].map(([k, a]) => { const c = cust(k), isNew = !before.has(k); return [c.name || "—", c.phone || "", isNew ? "جديد" : "متكرر", a.length, r2(sum(a, s => s.total)), a.map(s => s.business_day).sort().pop()]; }).sort((a, b) => b[4] - a[4]);
    const nw = rows.filter(r => r[2] === "جديد");
    return { k: [["عملاء اشتروا", rows.length, 1], ["جداد", nw.length, 1], ["رجعوا اشتروا تاني", rows.length - nw.length, 1], ["فواتير عليها عميل", P.length ? pct(withC.length / P.length * 100) : "—", 1]],
      head: ["العميل", "الموبايل", "النوع", "فواتير الفترة", "مشتريات الفترة", "آخر شراء"], rows, sens: [1], bar: 4 }; }],
  ["forecast", "التحليل والتنبؤ", "التنبؤ بالمبيعات والاقتراحات", 1, "forecast"],
  ["final", "التقارير النهائية", "التقارير النهائية (Final Reports)", 0, "final"]
];
async function runReport(r) { if (typeof r[4] === "string") return { link: r[4] }; const D = await loadRep(); return await r[4](D); }
V.reports = () => {
  const R = S.rp || (S.rp = { id: "daily", q: "" }), qq = norm(R.q), vis = REPORTS.filter(r => !qq || norm(r[1] + " " + r[2]).includes(qq)), r = REPORTS.find(x => x[0] === R.id) || REPORTS[0], locked = r[3] && !seeCost();
  let h = header(`${REPORTS.length} تقرير في ${new Set(REPORTS.map(x => x[1])).size} مجموعة`);
  h += `<div class="grid" style="grid-template-columns:minmax(220px,280px) 1fr;align-items:start"><div class="card rise"><input class="inp" id="rpQ" placeholder="بحث في التقارير" value="${esc(R.q)}" style="margin-bottom:8px">${[...new Set(vis.map(x => x[1]))].map(g => `<div class="navlbl" style="margin-top:8px">${g}</div>${vis.filter(x => x[1] === g).map(x => `<button class="btn sm ${x[0] === r[0] ? "gold" : "ghost"}" style="width:100%;justify-content:flex-start;margin-top:2px" data-act="rpSel" data-id="${x[0]}">${esc(x[2])}${x[3] && !seeCost() ? " 🔒" : ""}</button>`).join("")}`).join("") || `<p class="muted">مفيش تقرير بالاسم ده.</p>`}</div>
   <div class="card rise"><div class="row between" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div><div class="eyebrow">${esc(r[1])}</div><h3 style="margin:2px 0">${esc(r[2])}</h3></div>${typeof r[4] === "string" ? "" : `<div class="row" style="gap:6px;flex-wrap:wrap">${perBar(true)}<button class="btn" data-act="rpExp">تصدير</button></div>`}</div><div id="rpBody">${locked ? `<div class="warnbox">التقرير ده فيه التكلفة والأرباح، ودورك مش بيشوفها.</div>` : `<div class="spin"></div>`}</div></div></div>`;
  return h;
};
H.reports = async () => { perHook(); const R = S.rp, qi = $("#rpQ"); if (qi) qi.oninput = () => { R.q = qi.value; const p = qi.selectionStart; render(); const n = $("#rpQ"); n.focus(); n.setSelectionRange(p, p); };
  const r = REPORTS.find(x => x[0] === R.id) || REPORTS[0]; if (r[3] && !seeCost()) return; const body = $("#rpBody"), key = r[0] + perKey() + S.per.loc;
  try { if (r[4] === "forecast") { const fh = await forecastHTML(); if (!$("#rpBody") || S.rp.id !== r[0]) return; body.innerHTML = fh; const fl = $("#fcLoc"); if (fl) fl.onchange = () => { S.fc.loc = fl.value; render(); }; return; } if (r[4] === "final") { body.innerHTML = finalHTML(); return; }
    const out = await runReport(r); if (!$("#rpBody") || S.route !== "reports" || (S.rp.id !== r[0])) return;
    if (out.link) { body.innerHTML = `<p class="muted">التقرير ده شاشة كاملة.</p><button class="btn gold" data-go="${out.link}">فتح «${esc(M.NAME[out.link])}»</button>`; return; }
    R.last = { title: r[2], head: out.head, rows: out.rows, sens: out.sens || [] };
    const bi = out.bar, mx = bi != null ? Math.max(...out.rows.map(x => Math.abs(+x[bi]) || 0), 1) : 0;
    body.innerHTML = (out.k ? kpis(out.k.map(x => [x[0], typeof x[1] === "string" ? x[1] : x[2] ? num(x[1]) : x[1], typeof x[1] === "string" || x[2] ? 1 : 0, x[3]])) : "") + `<div class="tw"><table><thead><tr>${out.head.map((x, i) => `<th class="${i && typeof (out.rows[0] || [])[i] === "number" ? "n" : ""}">${esc(x)}</th>`).join("")}${bi != null ? "<th></th>" : ""}</tr></thead><tbody>${out.rows.slice(0, 500).map(row => `<tr>${row.map((v, i) => `<td class="${typeof v === "number" ? "n" : ""}">${typeof v === "number" ? (/^(الفواتير|عدد|الكمية|الرصيد|الورديات|ورديات|منها|اتباع في|الكمية الأصلية|الباقي|النقاط)/.test(out.head[i]) ? num(v) : fmt(v, 1)) : esc(v)}</td>`).join("")}${bi != null ? `<td style="width:16%">${bar(Math.abs(+row[bi]) || 0, mx)}</td>` : ""}</tr>`).join("") || empty(out.head.length + 1, "مفيش بيانات في الفترة دي.")}</tbody></table></div>${out.rows.length > 500 ? `<p class="dim">ظاهر أول ٥٠٠ من ${num(out.rows.length)} — صدّر عشان تشوف الكل.</p>` : ""}${out.note ? `<p class="dim" style="font-size:12.5px">${esc(out.note)}</p>` : ""}`;
  } catch (e) { if ($("#rpBody")) $("#rpBody").innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; } };

/* ---------- forecast & suggestions ---------- */
const SEAS = { 9: 1.25, 10: 1.35, 12: 1.15 };   // Ramadan, Shawwal (Eid), Dhu al-Hijjah
const dowOf = d => new Date(d + "T12:00:00Z").getUTCDay();
/* the forecast: uses only days before asOf; forecasts n days starting asOf + start */
function fcCalc(byDay, asOf, n, start) {
  const days = Object.keys(byDay).filter(d => d < asOf).sort(); if (!days.length) return null;
  const span = (new Date(asOf) - new Date(days[0])) / 864e5; if (days.length < 30 || span < 30) return null;
  const last = k => { let s = 0; for (let i = 1; i <= k; i++) s += byDay[addD(asOf, -i)] || 0; return s / k; };
  const base = 0.6 * last(28) + 0.4 * last(Math.min(90, Math.floor(span))), all = days.map(d => byDay[d]), avg = sum(all, x => x) / all.length;
  const dowF = [0, 1, 2, 3, 4, 5, 6].map(w => { const v = days.filter(d => dowOf(d) === w).map(d => byDay[d]); return v.length >= 3 && avg ? (sum(v, x => x) / v.length) / avg : 1; });
  const vol = (() => { const v = days.slice(-60).map(d => byDay[d]), m = sum(v, x => x) / v.length; return Math.sqrt(sum(v, x => (x - m) ** 2) / v.length) / (m || 1); })();
  let tot = 0, ram = 0; const daily = [];
  for (let i = start; i < start + n; i++) { const d = addD(asOf, i), s = SEAS[hijriM(d)] || 1; if (s > 1) ram++; const v = base * (dowF[dowOf(d)] || 1) * s; daily.push([d, v]); tot += v; }
  const w = Math.min(0.35, vol / Math.sqrt(n / 7));
  return { tot, lo: tot * Math.max(0.5, 1 - w), hi: tot * (1 + w), base, daily, ram, vol };
}
const HZ = { month: 30, quarter: 91, half: 182, year: 365 };
/* line chart: series [{name, vals, color, dash}] over labels; band = [lo[], hi[]] for one series */
function lineChart(id, labels, series, band) {
  const W = 720, Hh = 230, L = 58, R = 92, T = 12, B = 26, all = series.flatMap(s => s.vals.filter(v => v != null)).concat(band ? band[1].filter(v => v != null) : []);
  const mx = Math.max(1, ...all), step = (() => { const r = mx / 4, p = 10 ** Math.floor(Math.log10(r)), m = r / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; })(), top = step * Math.ceil(mx / step);
  const X = i => L + (labels.length < 2 ? 0 : i * (W - L - R) / (labels.length - 1)), Y = v => T + (Hh - T - B) * (1 - v / top);
  const path = vals => { let d = "", on = false; vals.forEach((v, i) => { if (v == null) { on = false; return; } d += (on ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); on = true; }); return d; };
  let g = ""; for (let v = 0; v <= top + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--vgrid)"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${fmtK(v)}</text>`;
  const every = Math.max(1, Math.ceil(labels.length / 8)); labels.forEach((l, i) => { if (i % every === 0 || (i === labels.length - 1 && i % every >= every / 2)) g += `<text x="${X(i)}" y="${Hh - 6}" text-anchor="middle">${esc(l)}</text>`; });
  if (band) { const idx = band[0].map((v, i) => v == null ? -1 : i).filter(i => i >= 0); if (idx.length > 1) g += `<path d="M${idx.map(i => X(i) + " " + Y(band[1][i])).join("L")}L${idx.slice().reverse().map(i => X(i) + " " + Y(band[0][i])).join("L")}Z" fill="${band[2]}" opacity=".13"/>`; }
  const ends = []; series.forEach(s => { g += `<path d="${path(s.vals)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 5"' : ""}/>`;
    let li = -1; s.vals.forEach((v, i) => { if (v != null) li = i; }); if (li >= 0 && s.label !== false) ends.push({ y: Y(s.vals[li]), x: X(li), t: s.name, c: s.color }); });
  ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
  ends.forEach(e => { g += `<circle cx="${e.x}" cy="${e.y}" r="0"/><text class="lbl" x="${W - R + 8}" y="${e.y + 4}">${esc(e.t)}</text>`; });
  g += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${Hh - B}"/>`;
  const cw = labels.length > 1 ? (W - L - R) / (labels.length - 1) : W - L - R;
  labels.forEach((l, i) => { const tip = `<b>${esc(l)}</b>` + series.filter(s => s.vals[i] != null).map(s => `<br><i style="background:${s.color}"></i>${esc(s.name)}: ${fmt(s.vals[i])}`).join("") + (band && band[0][i] != null ? `<br><span class="dim">المدى ${fmt(band[0][i])} – ${fmt(band[1][i])}</span>` : "");
    g += `<rect class="hit" x="${X(i) - cw / 2}" y="${T}" width="${cw}" height="${Hh - T - B}" data-x="${X(i)}" data-tip="${esc(tip)}"/>`; });
  return `<div class="viz" id="${id}"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="رسم بياني">${g}</svg><div class="vtip"></div></div>`;
}
const fmtK = v => v >= 1e6 ? (v / 1e6).toLocaleString("ar-EG", { maximumFractionDigits: 1 }) + " مليون" : v >= 1e3 ? (v / 1e3).toLocaleString("ar-EG", { maximumFractionDigits: 1 }) + " ألف" : num(v);
const legend = list => `<div class="vleg">${list.map(([n, c, d]) => `<span><i class="${d ? "dash" : ""}" style="${d ? "color" : "background"}:${c}"></i>${esc(n)}</span>`).join("")}</div>`;
/* chart hover: one listener for every chart */
if (!window.__mzViz) { window.__mzViz = 1;
  const show = (e, r) => { const v = r.closest(".viz"), tip = v.querySelector(".vtip"), cr = v.querySelector(".cross"), svg = v.querySelector("svg"), k = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, x = +r.dataset.x;
    cr.setAttribute("x1", x); cr.setAttribute("x2", x); cr.style.display = "block"; tip.innerHTML = r.dataset.tip; tip.style.display = "block";
    const px = x * k, w = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(v.clientWidth - w, px + (px > v.clientWidth / 2 ? -w - 12 : 12))) + "px"; tip.style.top = "8px"; };
  document.addEventListener("mouseover", e => { const r = e.target.closest && e.target.closest(".viz .hit"); if (r) show(e, r); });
  document.addEventListener("touchstart", e => { const r = e.target.closest && e.target.closest(".viz .hit"); if (r) show(e, r); }, { passive: true });
  document.addEventListener("mouseout", e => { const v = e.target.closest && e.target.closest(".viz"); if (v && !(e.relatedTarget && v.contains(e.relatedTarget))) { v.querySelector(".vtip").style.display = "none"; v.querySelector(".cross").style.display = "none"; } });
}
const weekLbl = d => new Date(d + "T12:00:00Z").toLocaleDateString("ar-EG", { day: "numeric", month: "short" });

async function forecastHTML() {
  const F = S.fc || (S.fc = { h: "month", tab: "total", loc: "all" }); F.tab = F.tab || "total"; F.loc = F.loc || "all";
  const hist = F.hist && F.histDay === today() ? F.hist : (F.hist = await q("sales", "business_day,total,status,location_id", x => x.gte("business_day", addD(today(), -400)).eq("status", "posted").limit(50000)), F.histDay = today(), F.hist);
  const inL = l => F.loc === "all" ? myLoc(l) : +F.loc === +l;
  const dayMap = pred => { const m = {}; hist.filter(s => pred(s.location_id)).forEach(s => { m[s.business_day] = (m[s.business_day] || 0) + +s.total; }); return m; };
  const byDay = dayMap(inL), n = HZ[F.h], t = today();
  let h = `<div class="row between" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="tabs">${[["total", "المبيعات"], ["branches", "الفروع"], ["items", "الأصناف"], ["acc", "دقة التوقع"], ["sug", "الاقتراحات"]].map(([k, nm]) => `<button data-act="fcT" data-k="${k}" class="${F.tab === k ? "on" : ""}">${nm}</button>`).join("")}</div>
    <div class="row" style="gap:6px;flex-wrap:wrap">${F.tab === "total" || F.tab === "branches" ? `<div class="tabs">${[["month", "شهر"], ["quarter", "ربع سنة"], ["half", "نص سنة"], ["year", "سنة"]].map(([k, nm]) => `<button data-act="fcH" data-k="${k}" class="${F.h === k ? "on" : ""}">${nm}</button>`).join("")}</div>` : ""}
    ${F.tab !== "branches" ? `<select class="inp" id="fcLoc" style="width:auto"><option value="all">كل الأماكن</option>${S.locs.filter(l => myLoc(l.id) && l.kind === "showroom").map(l => `<option value="${l.id}" ${F.loc === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>` : ""}</div></div>`;
  const notEnough = d => `<div class="warnbox">بيانات غير كافية للتنبؤ — محتاجين ٣٠ يوم مبيعات على الأقل (موجود ${Object.keys(d).length} يوم). التنبؤ بيظهر لوحده أول ما البيانات تكفي، بدل ما يطلع رقم مضلل.</div>`;

  if (F.tab === "total") {
    const f = fcCalc(byDay, t, n, 1);
    if (!f) return h + notEnough(byDay);
    const G = await loadGLAll().catch(() => null), m = G ? pl(G.rows, addD(t, -89), t) : null, margin = m && m.net ? m.np / m.net : null;
    const mtd = Object.keys(byDay).filter(d => d >= t.slice(0, 7) + "-01").reduce((a, d) => a + byDay[d], 0);
    h += kpis([["المبيعات المتوقعة", f.tot, 0, null, `من ${fmt(f.lo)} لـ ${fmt(f.hi)}`], ["متوسط يومي مرجعي", f.base], ["الربح المتوقع", margin != null ? f.tot * margin : "—", margin == null ? 1 : 0, null, margin != null ? "بهامش آخر ٣ شهور " + pct(margin * 100) : ""], ["الفعلي من أول الشهر", mtd, 0, null, "مقابل المتوقع للشهر " + fmt(f.base * 30)]]);
    if (f.ram) h += `<div class="okbox">الفترة فيها ${f.ram} يوم من مواسم رمضان والأعياد (بالتقويم الهجري) — اتحسبوا بزيادة متوقعة في البيع.</div>`;
    // weekly chart: 16 weeks back + up to 13 weeks ahead
    const wkEnd = t, back = 16, ahead = Math.min(13, Math.floor(n / 7)), labels = [], act = [], fc = [], lo = [], hi = [], w = Math.min(0.35, f.vol);
    for (let k = back - 1; k >= 0; k--) { const e = addD(wkEnd, -7 * k), s0 = addD(e, -6); let v = 0; for (let d = s0; d <= e; d = addD(d, 1)) v += byDay[d] || 0; labels.push(weekLbl(s0)); act.push(v); fc.push(null); lo.push(null); hi.push(null); }
    fc[fc.length - 1] = act[act.length - 1]; lo[lo.length - 1] = act[act.length - 1]; hi[hi.length - 1] = act[act.length - 1];
    for (let k = 0; k < ahead; k++) { const part = f.daily.slice(k * 7, k * 7 + 7); if (part.length < 7) break; const v = sum(part, x => x[1]); labels.push(weekLbl(part[0][0])); act.push(null); fc.push(v); lo.push(v * (1 - w)); hi.push(v * (1 + w)); }
    h += `<div class="card" style="margin-top:12px"><h3 style="margin:0 0 2px">المبيعات كل أسبوع: اللي فات والمتوقع</h3>${legend([["الفعلي", "var(--v1)"], ["المتوقع", "var(--v1)", 1], ["مدى التوقع", "rgba(127,127,127,.5)"]])}${lineChart("fcTot", labels, [{ name: "الفعلي", vals: act, color: "var(--v1)" }, { name: "المتوقع", vals: fc, color: "var(--v1)", dash: 1 }], [lo, hi, "var(--v1)"])}
      <p class="dim" style="font-size:12px;margin:6px 0 0">${ahead * 7 < n ? `الرسم بيوري أول ${ahead} أسبوع كامل من الفترة؛ الإجمالي فوق للفترة كلها.` : ""} الأرقام بالجنيه، ومن غير الضريبة لو مسجّل.</p></div>`;
    return h;
  }
  if (F.tab === "branches") {
    const B = S.locs.filter(l => l.kind === "showroom" && myLoc(l.id)); if (!B.length) return h + `<p class="muted">مفيش معارض.</p>`;
    const cols = ["var(--v1)", "var(--v2)", "var(--v3)", "var(--v4)"], rows = [], ser = [], labels = [];
    const groups = B.length <= 4 ? B.map(l => ({ name: l.name, ids: [l.id] })) : B.slice(0, 3).map(l => ({ name: l.name, ids: [l.id] })).concat([{ name: "باقي المعارض", ids: B.slice(3).map(l => l.id) }]);
    for (let k = 15; k >= 0; k--) labels.push(weekLbl(addD(t, -7 * k - 6)));
    groups.forEach((g, gi) => { const bd = dayMap(l => g.ids.includes(+l)), f = fcCalc(bd, t, n, 1); let prev = 0; for (let i = 0; i < n; i++) prev += bd[addD(t, -i)] || 0;
      rows.push([g.name, f ? r2(f.tot) : "—", f ? fmt(f.lo) + " – " + fmt(f.hi) : "بيانات غير كافية", r2(prev), f && prev ? (f.tot > prev ? "+" : "") + pct((f.tot - prev) / prev * 100) : "—"]);
      const vals = []; for (let k = 15; k >= 0; k--) { const e = addD(t, -7 * k); let v = 0; for (let d = addD(e, -6); d <= e; d = addD(d, 1)) v += bd[d] || 0; vals.push(v); }
      ser.push({ name: g.name, vals, color: cols[gi] }); });
    h += `<div class="tw"><table><thead><tr><th>المعرض</th><th class="n">المتوقع (${({ month: "شهر", quarter: "ربع سنة", half: "نص سنة", year: "سنة" })[F.h]})</th><th>المدى</th><th class="n">الفعلي في نفس المدة اللي فاتت</th><th class="n">التغير</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r[0])}</td><td class="n">${typeof r[1] === "number" ? fmt(r[1]) : r[1]}</td><td class="dim">${r[2]}</td><td class="n">${fmt(r[3])}</td><td class="n"><span dir="ltr">${r[4]}</span></td></tr>`).join("")}</tbody></table></div>`;
    h += `<div class="card" style="margin-top:12px"><h3 style="margin:0 0 2px">مبيعات كل معرض في آخر ١٦ أسبوع</h3>${legend(ser.map(s => [s.name, s.color]))}${lineChart("fcBr", labels, ser)}</div>`;
    return h;
  }
  if (F.tab === "items") {
    if (!seeCost() && !isTop() && !can("reports")) return h;
    const raw = F.items && F.itemsDay === today() ? F.items : (F.items = await rpc("fc_item_hist", { p_token: T(), p_weeks: 26 }), F.itemsDay = today(), F.items);
    const first = Object.keys(byDay).sort()[0], Hw = first ? Math.max(1, Math.min(26, Math.ceil(((new Date(t) - new Date(first)) / 864e5 + 1) / 7))) : 0;
    if (Hw < 4) return h + `<div class="warnbox">محتاجين ٤ أسابيع مبيعات على الأقل عشان نتوقع لكل صنف (موجود ${Hw}).</div>`;
    const per = {}; raw.filter(r => inL(r.loc)).forEach(r => { const a = per[r.item_id] || (per[r.item_id] = new Array(27).fill(0)); Object.entries(r.w).forEach(([k, v]) => { a[+k] += +v; }); });
    const avgW = (a, k) => { const m = Math.min(k, Hw); let s = 0; for (let i = 1; i <= m; i++) s += a[i]; return s / m; };
    let seas = 0; for (let i = 1; i <= 30; i++) seas += SEAS[hijriM(addD(t, i))] || 1; seas /= 30;
    const wh = S.locs.filter(l => l.kind === "warehouse").map(l => l.id), stockAt = (id, pred) => S.stock.filter(s => s.item_id === id && pred(s.location_id)).reduce((a, s) => a + +s.qty, 0);
    const rows = Object.entries(per).map(([id, a]) => { const i = itm(id), rate = Math.max(0, 0.5 * avgW(a, 4) + 0.3 * avgW(a, 13) + 0.2 * avgW(a, 26)), exp = rate / 7 * 30 * seas;
      const st = stockAt(id, l => F.loc === "all" ? myLoc(l) : +F.loc === +l), last30 = a[1] + a[2] + a[3] + a[4] + a[5] * 2 / 7, cover = rate > 0 ? st / (rate / 7) : Infinity, need = Math.ceil(exp - st);
      const whSt = F.loc !== "all" ? stockAt(id, l => wh.includes(+l)) : 0;
      const act = need > 0 ? (F.loc !== "all" && whSt >= need ? `حوّل ${num(need)} من المخزن` : `اشتري حوالي ${num(need)}`) : "كفاية";
      return [i.name, r2(last30), r2(exp), r2(st), isFinite(cover) ? Math.round(cover) : "—", act, need]; }).filter(r => r[2] > 0.05).sort((x, y) => y[6] - x[6] || y[2] - x[2]);
    const short = rows.filter(r => r[6] > 0);
    h += kpis([["أصناف متوقع بيعها", rows.length, 1], ["هتخلص قبل ٣٠ يوم", short.length, 1, short.length ? "--bad" : null], ["قطع محتاجها الشهر الجاي", sum(rows, r => r[2]), 1]].map(k => [k[0], num(Math.round(k[1])), 1, k[3]]));
    S.rp.last = { title: "توقع الأصناف للـ٣٠ يوم الجايين", head: ["الصنف", "اتباع آخر ٣٠ يوم", "المتوقع الـ٣٠ يوم الجايين", "الرصيد", "يكفي كام يوم", "المطلوب"], rows: rows.map(r => r.slice(0, 6)), sens: [] };
    h += `<div class="row between" style="margin:10px 0 6px"><p class="dim" style="font-size:12.5px;margin:0">المتوقع = متوسط البيع الأسبوعي (آخر ٤ أسابيع بوزن أكبر، وبعدها ١٣ و٢٦ أسبوع) × ٣٠ يوم${seas > 1.001 ? "، ومعاه زيادة موسم رمضان والأعياد" : ""}. المرتجعات مخصومة.</p><button class="btn sm" data-act="rpExp">تصدير</button></div>`;
    h += `<div class="tw"><table><thead><tr><th>الصنف</th><th class="n">اتباع آخر ٣٠ يوم</th><th class="n">المتوقع الـ٣٠ يوم الجايين</th><th class="n">الرصيد</th><th class="n">يكفي كام يوم</th><th>المطلوب</th></tr></thead><tbody>${rows.slice(0, 300).map(r => `<tr><td>${esc(r[0])}</td><td class="n">${num(r[1])}</td><td class="n"><b>${num(r[2])}</b></td><td class="n">${num(r[3])}</td><td class="n">${r[4] === "—" ? "—" : `<span style="color:var(${r[4] < 30 ? "--bad" : "--muted"})">${num(r[4])}</span>`}</td><td>${r[6] > 0 ? chip(r[5], "warn") : `<span class="dim">${r[5]}</span>`}</td></tr>`).join("") || empty(6, "مفيش مبيعات أصناف في آخر ٢٦ أسبوع.")}</tbody></table></div>`;
    return h;
  }
  if (F.tab === "acc") {
    const rows = [], M0 = t.slice(0, 7) + "-01";
    for (let k = 6; k >= 1; k--) { const ms = new Date(Date.UTC(+M0.slice(0, 4), +M0.slice(5, 7) - 1 - k, 1)).toISOString().slice(0, 10), me = addD(new Date(Date.UTC(+ms.slice(0, 4), +ms.slice(5, 7), 1)).toISOString().slice(0, 10), -1), len = Math.round((new Date(me) - new Date(ms)) / 864e5) + 1;
      const f = fcCalc(byDay, ms, len, 0); if (!f) continue; let a = 0; for (let d = ms; d <= me; d = addD(d, 1)) a += byDay[d] || 0;
      rows.push({ m: new Date(ms + "T12:00:00Z").toLocaleDateString("ar-EG", { month: "long", year: "numeric" }), f: f.tot, lo: f.lo, hi: f.hi, a, err: a ? (a - f.tot) / a * 100 : null }); }
    if (!rows.length) return h + `<div class="warnbox">لسه مفيش شهر كامل قبله ٣٠ يوم مبيعات عشان نقيس عليه. القياس بيظهر لوحده بعد أول شهر كامل.</div>`;
    const ok = rows.filter(r => r.err != null), mape = ok.length ? sum(ok, r => Math.abs(r.err)) / ok.length : null, inside = rows.filter(r => r.a >= r.lo && r.a <= r.hi).length;
    h += kpis([["متوسط الدقة", mape != null ? pct(Math.max(0, 100 - mape)) : "—", 1, mape != null && mape > 25 ? "--bad" : null, "١٠٠٪ ناقص متوسط الفرق"], ["شهور الفعلي جوه المدى", `${num(inside)} من ${num(rows.length)}`, 1], ["متوسط الفرق", mape != null ? pct(mape) : "—", 1]]);
    h += `<div class="okbox" style="margin-top:8px">في أول كل شهر من الشهور دي، حسبنا التوقع بنفس الطريقة بالمبيعات اللي كانت موجودة قبله بس، وقارنّاه باللي اتباع فعلًا. كده تعرف تثق في رقم التوقع قد إيه.</div>`;
    h += `<div class="tw" style="margin-top:8px"><table><thead><tr><th>الشهر</th><th class="n">المتوقع</th><th>المدى</th><th class="n">الفعلي</th><th class="n">الفرق</th><th></th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.m)}</td><td class="n">${fmt(r.f)}</td><td class="dim">${fmt(r.lo)} – ${fmt(r.hi)}</td><td class="n">${fmt(r.a)}</td><td class="n"><span dir="ltr">${r.err == null ? "—" : (r.err > 0 ? "+" : "") + pct(r.err)}</span></td><td>${r.a >= r.lo && r.a <= r.hi ? chip("جوه المدى", "ok") : chip(r.a > r.hi ? "أعلى من المتوقع" : "أقل من المتوقع", "warn")}</td></tr>`).join("")}</tbody></table></div>`;
    h += `<div class="card" style="margin-top:12px"><h3 style="margin:0 0 2px">المتوقع مقابل الفعلي</h3>${legend([["الفعلي", "var(--v1)"], ["المتوقع", "var(--v2)", 1]])}${lineChart("fcAcc", rows.map(r => r.m), [{ name: "الفعلي", vals: rows.map(r => r.a), color: "var(--v1)" }, { name: "المتوقع", vals: rows.map(r => r.f), color: "var(--v2)", dash: 1 }], [rows.map(r => r.lo), rows.map(r => r.hi), "var(--v2)"])}</div>`;
    return h;
  }
  /* suggestions: local rules, each with its reason */
  const D = await loadRep(), sug = [], inS = l => F.loc === "all" ? myLoc(l) : +F.loc === +l;
  S.items.forEach(i => { const st = S.stock.filter(s => s.item_id === i.id && inS(s.location_id)).reduce((a, s) => a + +s.qty, 0); if (+i.min_qty > 0 && st <= +i.min_qty) sug.push(["warn", "اطلب تاني: " + i.name, `الرصيد ${num(st)} وصل للحد الأدنى ${num(i.min_qty)}.`]); });
  const sold = {}; D.moves.filter(mv => mv.kind === "sale").forEach(mv => { sold[mv.item_id] = 1; }); const stale = S.items.filter(i => !sold[i.id] && S.stock.some(s => s.item_id === i.id && +s.qty > 0));
  if (stale.length) sug.push(["info", `${stale.length} صنف ما اتباعش في آخر ٣ شهور`, "فكّر في عرض تصريف أو نقلهم لمعرض تاني — التفاصيل في «ظهور الأصناف»."]);
  const mo = D.cats.map(c => [c, sum(D.exps.filter(e => e.status === "approved" && e.category_id === c.id && e.exp_date >= t.slice(0, 7) + "-01"), e => e.amount)]).filter(([c, a]) => +c.budget && a > +c.budget);
  mo.forEach(([c, a]) => sug.push(["bad", "مصروف فوق الميزانية: " + c.name, `اتصرف ${fmt(a)} من ميزانية ${fmt(c.budget)} الشهر ده.`]));
  const soon = D.pur.filter(p => p.due_date >= t && p.due_date <= addD(t, 7)); if (soon.length) sug.push(["warn", `${soon.length} فاتورة مورد مستحقة خلال أسبوع`, "جهّز السيولة — الإجمالي " + fmt(sum(soon, p => p.total)) + "."]);
  h += `${sug.length ? `<div class="stack" style="gap:6px">${sug.slice(0, 20).map(s => `<div class="${s[0] === "bad" ? "warnbox" : "okbox"}"><b>${esc(s[1])}</b><br><span class="dim">${esc(s[2])}</span></div>`).join("")}</div>` : `<p class="muted">مفيش اقتراحات دلوقتي.</p>`}<p class="dim" style="font-size:12px">الاقتراحات بقواعد ثابتة جوه السيستم، وكل اقتراح معاه سببه. توقع كل صنف وإيه اللي محتاج يتشترى في تبويب «الأصناف».</p>`;
  return h;
}
/* ---------- final reports ---------- */
function finalHTML() { const canP = isOwner() || has("finalReports"), canA = isOwner() || has("finalAudit");
  return `<p class="muted" style="margin-top:0">ملف شامل للفترة المختارة فوق: غلاف وفهرس، وملخص تنفيذي بمقارنة بالفترة اللي قبلها، وقائمة الدخل لكل معرض، والتدفق النقدي، والمخزون، والموردين، والمصروفات، والتوقعات. لو الفترة فيها أيام لسه ما اتقفلتش بيتعلّم عليه «مبدئي». كل نسخة بتتحفظ في الأرشيف ببصمتها، والأرشيف مبيتعدّلش.</p>
   <div class="row" style="gap:8px;flex-wrap:wrap">${perBar(true)}<button class="btn gold" data-act="frMake" data-ed="partners" ${canP ? "" : "disabled"}>نسخة الشركاء</button><button class="btn" data-act="frMake" data-ed="audit" ${canA ? "" : "disabled"}>نسخة المراجعة</button><button class="btn ghost" data-act="frArch">الأرشيف</button></div>${canP || canA ? "" : `<p class="dim">التقارير النهائية صلاحية مستقلة.</p>`}<div id="frBox" style="margin-top:10px"></div>`; }
async function makeFinal(ed) { const { from, to } = S.per, G = await loadGLAll(), D = await loadRep(), len = Math.round((new Date(to) - new Date(from)) / 864e5) + 1, pf = addD(from, -len), pt = addD(from, -1);
  const cur = pl(G.rows, from, to), prv = pl(G.rows, pf, pt), C = cashBasis(G.rows, from, to), closedDays = new Set(D.dcl.filter(c => c.status === "closed").map(c => c.business_day + "|" + c.location_id));
  let open = 0; for (let d = from; d <= to && d <= today(); d = addD(d, 1)) shows().forEach(l => { if (!closedDays.has(d + "|" + l.id)) open++; });
  const prov = open > 0, chg = (a, b) => b ? pct((a - b) / Math.abs(b) * 100) : "—", st = S.store || {};
  const sec = (n, title, body) => `<section style="page-break-before:always"><h2>${n}. ${title}</h2>${body}</section>`, tb = (head, rows) => `<table><thead><tr>${head.map(x => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${typeof v === "number" ? fmt(v, 1) : esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const plRows = [["صافي المبيعات", cur.net, prv.net], ["تكلفة البضاعة", cur.cogs, prv.cogs], ["مجمل الربح", cur.gp, prv.gp], ["مصروفات التشغيل", cur.ox, prv.ox], ["صافي الربح", cur.np, prv.np]].map(r => [r[0], r[1], r[2], chg(r[1], r[2])]);
  const byLoc = shows().map(l => { const p = pl(G.rows, from, to, l.id); return [l.name, p.net, p.gp, p.ox, p.np]; });
  const sup = (await runReport(REPORTS.find(r => r[0] === "supbal"))).rows.slice(0, 15), exp = (await runReport(REPORTS.find(r => r[0] === "expcat"))).rows, val = await REPORTS.find(r => r[0] === "val")[4](D);
  const parts = [["الملخص التنفيذي", `<p>صافي المبيعات ${fmt(cur.net)} (${chg(cur.net, prv.net)} عن الفترة اللي قبلها)، وصافي الربح ${fmt(cur.np)} بهامش ${pct(cur.net ? cur.np / cur.net * 100 : 0)}، وصافي النقدية التشغيلية ${fmt(C.op)}.</p>${tb(["البند", "الفترة", "الفترة السابقة", "التغير"], plRows)}`],
    ["قائمة الدخل لكل معرض", tb(["المعرض", "صافي المبيعات", "مجمل الربح", "المصروفات", "صافي الربح"], byLoc)], ["التدفق النقدي", tb(["البند", "المبلغ"], [["تشغيلي", C.op], ["استثماري", C.inv], ["تمويلي (الشركاء والقروض)", C.partners + C.loans]])],
    ["المخزون", `<p>القيمة بالتكلفة ${fmt(sum(val.rows, r => r[3]))} وبسعر البيع ${fmt(sum(val.rows, r => r[4]))}.</p>${tb(val.head, val.rows.slice(0, 20))}`], ["الموردين", tb(["المورد", "النوع", "أول المدة", "فواتير", "مدفوع", "الرصيد", "حد الائتمان"], sup)], ["المصروفات مقابل الميزانية", tb(["البند", "المجموعة", "الفعلي", "الميزانية", "النسبة"], exp)]];
  if (ed === "audit") { const jr = G.rows.filter(r => r[0] >= from && r[0] <= to); parts.push(["ميزان المراجعة", tb(["الحساب", "مدين", "دائن"], [...groupBy(jr, r => r[3])].map(([k, a]) => [k + " · " + ((G.accts.find(x => x.code === k) || {}).name || ""), r2(sum(a, r => r[4])), r2(sum(a, r => r[5]))]))]); }
  parts.push(["التوقعات", (await (async () => { const k = S.fc && S.fc.tab; S.fc = Object.assign(S.fc || { h: "month" }, { tab: "total" }); const x = await forecastHTML(); S.fc.tab = k || "total"; return x; })()).replace(/<button[^>]*>.*?<\/button>/g, "").replace(/<div class="tabs"[^>]*>.*?<\/div>/g, "").replace(/<select[\s\S]*?<\/select>/g, "")]);
  const html = `<div class="cover" style="text-align:center;padding:40mm 0">${M.LOGO() ? `<div style="margin-bottom:10mm">${M.logoImg("30mm", "max-width:90mm")}</div>` : ""}<h1 style="font-size:28px">${esc(st.name || "")}</h1><h2>التقرير النهائي · ${ed === "audit" ? "نسخة المراجعة" : "نسخة الشركاء"}</h2><p>${from} ← ${to}</p>${prov ? `<p style="color:#b00;font-size:20px;font-weight:700">مبدئي — ${open} يوم/معرض لسه ما اتقفلش</p>` : ""}<p style="color:#666">اتعمل ${new Date().toLocaleString("ar-EG")} بواسطة ${esc(S.sess.staff.name)}</p></div>
   <section><h2>الفهرس</h2><ol>${parts.map(p => `<li>${p[0]}</li>`).join("")}</ol></section>${parts.map((p, i) => sec(i + 1, p[0], p[1])).join("")}`;
  const id = await rpc("final_report_save", { p_token: T(), p: { from, to, edition: ed, provisional: prov, html } });
  const arch = await q("final_reports", "id,hash", x => x.eq("id", id));
  return { html, hash: (arch[0] || {}).hash || "", prov, id }; }
const FCSS = `body,div{font-family:Tahoma,Arial;color:#111;font-size:12px}h1{font-size:28px}h2{font-size:18px;margin:0 0 8px}table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #bbb;padding:4px 6px;text-align:right}th{background:#eee}.okbox,.warnbox{border:1px solid #ccc;padding:6px;margin:4px 0}.grid{display:flex;gap:8px;flex-wrap:wrap}.card{border:1px solid #ddd;padding:6px;flex:1}.lbl{color:#666}.val{font-size:16px;font-weight:700}section{page-break-before:auto}`;
function pdfModal(id) { modal(`<h2>PDF بباسورد</h2><p class="muted">الملف مش هيتفتح غير بالباسورد ده. الطباعة مسموحة، والتعديل والنسخ لأ. السيستم مش بيحفظ الباسورد، فلو نسيته اعمل ملف جديد من الأرشيف.</p>
  <div class="stack"><div class="grid g2"><div class="field"><label>الباسورد (6 حروف أو أكتر)</label><input class="inp" type="password" id="pdP" autocomplete="new-password"></div><div class="field"><label>اكتبه تاني</label><input class="inp" type="password" id="pdP2" autocomplete="new-password"></div></div><div id="pdErr"></div>
  <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="frPdfGo" data-id="${id}">تنزيل الملف</button></div></div>`); }
function printFinal(html, hash, prov) { const w = window.open("", "_blank"); if (!w) return toast("المتصفح منع نافذة الطباعة.", true);
  w.document.write(`<html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>التقرير النهائي</title><style>@page{size:A4;margin:14mm}body{font-family:Tahoma,Arial;color:#111;font-size:12px}h1,h2{font-family:Tahoma}table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #bbb;padding:4px 6px;text-align:right}th{background:#eee}.foot{position:fixed;bottom:0;left:0;right:0;font-size:9px;color:#777;text-align:center}${prov ? `body::before{content:"مبدئي";position:fixed;top:40%;left:20%;font-size:120px;color:rgba(200,0,0,.08);transform:rotate(-30deg)}` : ""}.okbox,.warnbox{border:1px solid #ccc;padding:6px;margin:4px 0}.grid{display:flex;gap:8px;flex-wrap:wrap}.card{border:1px solid #ddd;padding:6px;flex:1}.lbl{color:#666}.val{font-size:16px;font-weight:700}</style></head><body>${html}<div class="foot">بصمة الملف SHA-256: ${esc(hash)}</div><script>setTimeout(()=>print(),400)<\/script></body></html>`); w.document.close(); }

/* =====================================================================
   الفواتير الضريبية
   ===================================================================== */
async function loadTax() { const D = await loadRep(); const [ti, ei] = await Promise.all([q("tax_invoices", "*", x => x.order("id", { ascending: false }).limit(2000)), q("einv_docs", "*")]); Object.assign(D, { ti, ei, taxKey: perKey() }); }
const vatOff = () => !(S.store || {}).vat_registered;
const notReg = () => vatOff() ? `<div class="warnbox rise">المحل مش مسجّل في ضريبة القيمة المضافة. الشاشة دي بتشتغل بعد تفعيل الضريبة من «الإعدادات والضريبة» (للمالك بس).</div>` : "";
V.taxinv = () => {
  let h = header(perBar(true)) + notReg(); const D = S.rd; if (!D || D.taxKey !== perKey()) return h + later(loadTax, "taxinv");
  const L = D.sales.filter(s => s.status === "posted" && inLoc(s.location_id)).sort((a, b) => a.created_at < b.created_at ? 1 : -1), ti = id => D.ti.find(t => t.sale_id === id), canP = isTop() || can("taxinv", "r");
  h += kpis([["فواتير البيع في الفترة", L.length, 1], ["فواتير ضريبية اتطبعت", L.filter(s => ti(s.id)).length, 1], ["إجمالي الضريبة", sum(L, s => s.vat)], ["قبل الضريبة", sum(L, s => +s.total - +s.vat)]]);
  h += `<div class="card rise"><div class="tw"><table><thead><tr><th>فاتورة البيع</th><th>الوقت</th><th>المعرض</th><th class="n">قبل الضريبة</th><th class="n">الضريبة</th><th class="n">الإجمالي</th><th>الفاتورة الضريبية</th><th></th></tr></thead><tbody>${L.slice(0, 400).map(s => { const t = ti(s.id); return `<tr><td class="num">${esc(s.no)}</td><td class="num dim">${dt(s.created_at)}</td><td>${esc(locName(s.location_id))}</td><td class="n">${fmt(+s.total - +s.vat, 1)}</td><td class="n">${fmt(s.vat, 1)}</td><td class="n">${fmt(s.total, 1)}</td><td>${t ? `${chip(t.no, "ok")}${t.prints > 1 ? ` <span class="dim">نسخ ${t.prints}</span>` : ""}${t.buyer_name ? `<br><span class="dim" style="font-size:12px">${esc(t.buyer_name)}${t.buyer_tin ? " · " + esc(t.buyer_tin) : ""}</span>` : ""}` : chip("لسه")}</td><td>${canP && !vatOff() ? `<button class="btn sm" data-act="tiOpen" data-id="${s.id}">${t ? "إعادة طباعة" : "فاتورة ضريبية"}</button>` : ""}</td></tr>`; }).join("") || empty(8, "مفيش فواتير في الفترة دي.")}</tbody></table></div></div>`;
  return h;
};
H.taxinv = perHook; H.einv = perHook;
function tiModal(saleId) { const t = S.rd.ti.find(x => x.sale_id === saleId);
  if (t) return tiPrint(saleId, { name: t.buyer_name, tin: t.buyer_tin, address: t.buyer_address });
  modal(`<h2>فاتورة ضريبية</h2><p class="muted">لو المشتري شركة اكتب بياناتها ورقمها الضريبي — الفاتورة بتبقى B2B في المنظومة الإلكترونية. ولو فرد سيبها فاضية.</p><div class="stack"><div class="field"><label>اسم المشتري</label><input class="inp" id="tbN"></div><div class="grid g2"><div class="field"><label>الرقم الضريبي (٩ أرقام)</label><input class="inp num" id="tbT" maxlength="9" inputmode="numeric"></div><div class="field"><label>العنوان</label><input class="inp" id="tbA"></div></div><div id="tbErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="tiGo" data-id="${saleId}">إصدار وطباعة</button></div></div>`); }
async function tiPrint(saleId, buyer) { const r = await rpc("tax_invoice_issue", { p_token: T(), p_sale: saleId, p_buyer: buyer || {} }), s = S.rd.sales.find(x => x.id === saleId), L = S.rd.lines.filter(l => l.sale_id === saleId), st = S.store || {}, tx = st.tax || {};
  const rate = l => { const i = itm(l.item_id); return i.vat_rate != null ? +i.vat_rate : +st.vat_rate; }, rates = [...new Set(L.map(rate))];
  const w = window.open("", "_blank"); if (!w) return toast("المتصفح منع نافذة الطباعة.", true);
  w.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>${esc(r.no)}</title><style>@page{size:A4;margin:14mm}body{font-family:Tahoma;font-size:12px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px;text-align:right}th{background:#eee}.h{display:flex;justify-content:space-between;gap:20px}.copy{color:#b00;font-weight:700;border:2px solid #b00;padding:2px 8px;display:inline-block}</style></head><body>
   <div class="h"><div>${M.LOGO() ? M.logoImg("60px", "display:block;margin-bottom:6px") : ""}<h2 style="margin:0">${esc(st.name)}</h2><div>${esc(tx.addr || "")}</div><div>رقم التسجيل الضريبي: ${esc(st.vat_rin || "")}${tx.cr ? " · سجل تجاري " + esc(tx.cr) : ""}</div></div><div style="text-align:left"><h2 style="margin:0">فاتورة ضريبية</h2><div>${esc(r.no)}</div><div>${new Date(r.issued_at).toLocaleDateString("ar-EG")}</div><div>فاتورة البيع ${esc(s.no)}</div>${r.prints > 1 ? `<div class="copy">نسخة ${r.prints}</div>` : ""}</div></div><hr>
   <p><b>المشتري:</b> ${esc(r.buyer_name || "عميل نقدي")}${r.buyer_tin ? " · رقم ضريبي " + esc(r.buyer_tin) : ""}${r.buyer_address ? " · " + esc(r.buyer_address) : ""}</p>
   <table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>القيمة قبل الضريبة</th>${rates.length > 1 ? "<th>النسبة</th>" : ""}<th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>${L.map(l => `<tr><td>${esc(itm(l.item_id).name)}${l.serial ? "<br><small>SN " + esc(l.serial) + "</small>" : ""}</td><td>${num(l.qty)}</td><td>${fmt(l.unit_price, 1)}</td><td>${fmt(+l.discount + +(l.offer_disc || 0), 1)}</td><td>${fmt(lineNet(l), 1)}</td>${rates.length > 1 ? `<td>${rate(l)}%</td>` : ""}<td>${fmt(l.vat, 1)}</td><td>${fmt(lineNet(l) + +l.vat, 1)}</td></tr>`).join("")}</tbody>
   <tfoot><tr><th colspan="${rates.length > 1 ? 4 : 4}">الإجمالي</th><th>${fmt(+s.total - +s.vat, 1)}</th>${rates.length > 1 ? `<th>${rates.join("% / ")}%</th>` : ""}<th>${fmt(s.vat, 1)}</th><th>${fmt(s.total, 1)}</th></tr></tfoot></table>
   <p style="margin-top:30px;color:#666">ضريبة القيمة المضافة ${rates.join("% / ")}% · ${st.prices_include_vat ? "الأسعار شاملة الضريبة" : "الضريبة مضافة على الأسعار"}</p><script>setTimeout(()=>print(),300)<\/script></body></html>`); w.document.close();
  await loadTax(); render(); }

/* =====================================================================
   الفواتير الإلكترونية (منظومة مصلحة الضرائب المصرية)
   ===================================================================== */
const EI = { ready: ["جاهزة", "plain"], queued: ["في الانتظار", "info"], valid: ["مقبولة", "ok"], invalid: ["مرفوضة", "bad"], cancelled: ["ملغاة", "plain"] };
V.einv = () => {
  let h = header(perBar(true)) + notReg(); const D = S.rd; if (!D || D.taxKey !== perKey()) return h + later(loadTax, "einv");
  const tx = (S.store || {}).tax || {}, E = S.ei || (S.ei = { st: "all", sel: {} }), L = D.sales.filter(s => s.status === "posted" && inLoc(s.location_id)), doc = id => D.ei.find(e => e.sale_id === id), stt = s => (doc(s.id) || {}).status || "ready";
  const F = L.filter(s => E.st === "all" || stt(s) === E.st), ed = isTop() || can("einv", "e"), kind = s => { const t = D.ti.find(x => x.sale_id === s.id); return t && t.buyer_tin ? "B2B" : "B2C"; };
  h += kpis(Object.keys(EI).filter(k => k !== "cancelled").map(k => [EI[k][0], L.filter(s => stt(s) === k).length, 1]));
  h += `<div class="card rise"><div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:10px"><div class="tabs">${[["all", "الكل"], ...Object.entries(EI).map(([k, v]) => [k, v[0]])].map(([k, n]) => `<button data-act="eiSt" data-k="${k}" class="${E.st === k ? "on" : ""}">${n}</button>`).join("")}</div>
     ${ed && !vatOff() ? `<button class="btn" data-act="eiJson">تنزيل المستندات (JSON)</button><button class="btn" data-act="eiMark" data-s="queued">تحديد: اتبعتت</button><button class="btn" data-act="eiMark" data-s="valid">تحديد: اتقبلت</button><button class="btn ghost" data-act="eiMark" data-s="invalid">تحديد: اترفضت</button>` : ""}</div>
   <div class="tw"><table><thead><tr><th><input type="checkbox" id="eiAll"></th><th>الفاتورة</th><th>النوع</th><th>المعرض</th><th class="n">الضريبة</th><th class="n">الإجمالي</th><th>الحالة</th><th>UUID</th></tr></thead><tbody>${F.slice(0, 400).map(s => { const d = doc(s.id) || {}; return `<tr><td><input type="checkbox" data-ei="${s.id}" ${E.sel[s.id] ? "checked" : ""}></td><td class="num">${esc(s.no)}<br><span class="dim" style="font-size:11.5px">${dt(s.created_at)}</span></td><td>${kind(s) === "B2B" ? "فاتورة إلكترونية B2B" : "إيصال إلكتروني B2C"}</td><td>${esc(locName(s.location_id))}</td><td class="n">${fmt(s.vat, 1)}</td><td class="n">${fmt(s.total, 1)}</td><td>${chip(EI[stt(s)][0], EI[stt(s)][1])}${d.errors ? `<br><span class="dim" style="font-size:12px">${esc(d.errors)}</span>` : ""}</td><td class="num dim" style="font-size:11px">${esc((d.uuid || "—").slice(0, 18))}</td></tr>`; }).join("") || empty(8, "مفيش فواتير بالفلتر ده.")}</tbody></table></div></div>`;
  h += `<div class="card rise"><h3>بيانات التسجيل في المنظومة</h3><div class="grid g3">${[["rin", "رقم التسجيل الضريبي", (S.store || {}).vat_rin || "", 1], ["cr", "السجل التجاري", tx.cr], ["act", "كود النشاط", tx.act], ["branch", "كود الفرع", tx.branch], ["addr", "العنوان", tx.addr]].map(([k, n, v, ro]) => `<div class="field"><label>${n}</label><input class="inp" data-tx="${k}" value="${esc(v || "")}" ${ro || !ed ? "disabled" : ""}></div>`).join("")}
     <div class="field"><label>البيئة</label><select class="inp" data-tx="env" ${ed ? "" : "disabled"}><option value="preprod" ${tx.env !== "prod" ? "selected" : ""}>تجريبية</option><option value="prod" ${tx.env === "prod" ? "selected" : ""}>فعلية</option></select></div></div>
     <label class="row" style="gap:8px;margin-top:6px"><input type="checkbox" data-tx="token" ${tx.token ? "checked" : ""} ${ed ? "" : "disabled"}> شهادة التوقيع الإلكتروني (Token) متركّبة على جهاز الإرسال</label>${ed ? `<button class="btn gold" data-act="txSave" style="margin-top:8px">حفظ</button>` : ""}<div id="txErr"></div>
     <p class="dim" style="font-size:12.5px;margin-bottom:0">السيستم بيجهّز كل إيصال وفاتورة بصيغة المنظومة ويتابع حالتها. الإرسال الفعلي والتوقيع بالـ Token بيتعملوا من جهاز عليه الشهادة — وده هيتربط مباشرة مع مرحلة السيرفر المحلي. لحد كده نزّل المستندات وارفعها، وحدّث الحالة هنا.</p></div>`;
  return h;
};
function etaDoc(s) { const st = S.store || {}, tx = st.tax || {}, L = S.rd.lines.filter(l => l.sale_id === s.id), t = S.rd.ti.find(x => x.sale_id === s.id), b2b = t && t.buyer_tin;
  const issuer = { type: "B", id: st.vat_rin || "", name: st.name, address: { branchID: tx.branch || "0", country: "EG", governate: "", regionCity: "", street: tx.addr || "", buildingNumber: "" } };
  const items = L.map(l => { const i = itm(l.item_id); return { description: i.name, itemType: "EGS", itemCode: "EG-" + (st.vat_rin || "") + "-" + (i.code || ""), unitType: i.unit === "meter" ? "MTR" : "EA", quantity: +l.qty, unitValue: { currencySold: "EGP", amountEGP: +l.unit_price }, salesTotal: r2(+l.qty * +l.unit_price), discount: { amount: r2(+l.discount + +(l.offer_disc || 0)) }, netTotal: r2(lineNet(l)), taxableItems: [{ taxType: "T1", amount: +l.vat, subType: +l.vat ? "V009" : "V003", rate: i.vat_rate != null ? +i.vat_rate : +st.vat_rate }], total: r2(lineNet(l) + +l.vat) }; });
  const base = { dateTimeIssued: new Date(s.created_at).toISOString().replace(/\.\d+Z$/, "Z"), taxpayerActivityCode: tx.act || "", internalID: s.no, totalSales: r2(sum(L, l => +l.qty * +l.unit_price)), totalDiscountAmount: r2(+s.discount + +(s.offer_disc || 0)), netAmount: r2(+s.total - +s.vat), taxTotals: [{ taxType: "T1", amount: +s.vat }], totalAmount: +s.total };
  return b2b ? Object.assign({ issuer, receiver: { type: "B", id: t.buyer_tin, name: t.buyer_name || "", address: { country: "EG", street: t.buyer_address || "" } }, documentType: "I", documentTypeVersion: "1.0", invoiceLines: items }, base)
             : Object.assign({ header: { dateTimeIssued: base.dateTimeIssued, receiptNumber: s.no, uuid: "", currency: "EGP" }, documentType: { receiptType: "S", typeVersion: "1.2" }, seller: { rin: st.vat_rin || "", companyTradeName: st.name, branchCode: tx.branch || "0", branchAddress: issuer.address, activityCode: tx.act || "" }, buyer: { type: "P" }, itemData: items }, base); }

/* =====================================================================
   ACTIONS
   ===================================================================== */
const prev = window.MZX;
window.MZX = async function (k, a) {
  const wrap = async (fn, after, box) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (box && $(box)) errBox(box, e); else toast(errText(e), true); busy(a, false); } };
  const id = a.dataset.id, inval = () => { if (S.fin) S.fin.key = null; if (S.rd) S.rd.key = null; };
  if (k === "rpSel") { S.rp.id = id; render(); }
  else if (k === "rpExp") { const L = S.rp.last; if (!L) return toast("استنى التقرير يحمّل.", true), true; window.MZEXP ? window.MZEXP(L.title, L.head, L.rows, L.sens) : M.xlsOut(L.title + ".xlsx", L.title.slice(0, 30), [L.head, ...L.rows]); }
  else if (k === "fcH") { S.fc.h = a.dataset.k; render(); }
  else if (k === "fcT") { S.fc.tab = a.dataset.k; render(); }
  else if (k === "frMake") wrap(async () => { const r = await makeFinal(a.dataset.ed); busy(a, false); $("#frBox").innerHTML = `<div class="okbox">اتحفظت النسخة #${r.id} في الأرشيف${r.prov ? " — مبدئية" : ""} · البصمة <span class="num">${esc(r.hash.slice(0, 24))}…</span></div>`; printFinal(r.html, r.hash, r.prov); $("#frBox").insertAdjacentHTML("beforeend", `<button class="btn sm" data-act="frPdf" data-id="${r.id}" style="margin-top:8px">PDF بباسورد</button>`); }, null, "#frBox");
  else if (k === "frArch") wrap(async () => { const L = await q("final_reports", "id,period_from,period_to,edition,provisional,hash,created_by,created_at", x => x.order("id", { ascending: false }).limit(100)); busy(a, false); await loadDir();
    $("#frBox").innerHTML = `<div class="tw"><table><thead><tr><th>#</th><th>الفترة</th><th>النسخة</th><th>اتعمل</th><th>البصمة</th><th></th></tr></thead><tbody>${L.map(r => `<tr><td class="num">${r.id}</td><td class="num">${r.period_from} ← ${r.period_to}</td><td>${r.edition === "audit" ? "المراجعة" : "الشركاء"}${r.provisional ? " " + chip("مبدئي", "warn") : ""}</td><td>${esc(who(r.created_by))}<br><span class="dim num" style="font-size:12px">${dt(r.created_at)}</span></td><td class="num dim" style="font-size:11px">${esc(r.hash.slice(0, 16))}</td><td class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-act="frOpen" data-id="${r.id}">فتح</button><button class="btn sm ghost" data-act="frPdf" data-id="${r.id}">PDF بباسورد</button></td></tr>`).join("") || empty(6, "الأرشيف فاضي.")}</tbody></table></div>`; });
  else if (k === "frPdf") pdfModal(id);
  else if (k === "frPdfGo") { const pw = $("#pdP").value, eb = t => { $("#pdErr").innerHTML = `<div class="warnbox">${t}</div>`; };
    if (pw.length < 6) return eb("الباسورد لازم يبقى 6 حروف أو أكتر."), true; if (pw !== $("#pdP2").value) return eb("الباسورد مش زي بعضه في الخانتين."), true;
    if (!window.MZPDF || !window.MZPA) return eb("حدّث الصفحة وجرّب تاني."), true;
    busy(a, true); eb("بيتعمل الملف… ممكن ياخد كام ثانية.");
    (async () => { const r = (await q("final_reports", "*", x => x.eq("id", +id)))[0];
      const blob = await MZPDF.report(r.html, FCSS, pw, `التقرير النهائي #${r.id} · بصمة SHA-256: ${r.hash.slice(0, 32)}`, r.provisional ? "مبدئي" : "");
      const u = URL.createObjectURL(blob), el = document.createElement("a"); el.href = u; el.download = `Minzo-Final-Report-${r.id}-${String(r.period_from).slice(0, 10)}_${String(r.period_to).slice(0, 10)}.pdf`; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000);
      closeModal(); toast("اتنزل الملف — افتحه بالباسورد."); })().catch(e => { busy(a, false); eb(esc(errText(e))); }); }
  else if (k === "frOpen") wrap(async () => { const r = (await q("final_reports", "*", x => x.eq("id", +id)))[0]; busy(a, false); printFinal(r.html, r.hash, r.provisional); });
  /* capital */
  else if (k === "cpOpen") { S.capOpen[a.dataset.k] = !S.capOpen[a.dataset.k]; render(); }
  else if (k === "cpMove") cpMoveModal();
  else if (k === "cpMoveGo") wrap(() => rpc("capital_move", { p_token: T(), p: { kind: $("#cmK").value, partner_id: $("#cmP").value || null, amount: +$("#cmA").value, account_id: +$("#cmC").value, move_date: $("#cmD").value, note: $("#cmN").value } }), async () => { closeModal(); toast("اتسجّلت الحركة."); inval(); render(); }, "#cmErr");
  else if (k === "cpPartner") cpPartnerModal(id ? S.fin.partners.find(p => p.id === +id) : null);
  else if (k === "cpPartnerGo") wrap(() => rpc("partner_save", { p_token: T(), p: { id: id ? +id : null, name: $("#paN").value, share_pct: +$("#paS").value, phone: $("#paP").value, active: $("#paOn") ? $("#paOn").checked : true } }), async () => { closeModal(); inval(); render(); }, "#paErr");
  else if (k === "cpAsset" || k === "obAsset") { if (!S.fin || !S.fin.cashAcc) S.fin = Object.assign(S.fin || {}, { cashAcc: await q("cash_accounts", "*", x => x.eq("active", true)) }); cpAssetModal(k === "obAsset"); }
  else if (k === "cpAssetGo") { const op = !!a.dataset.op, p = { name: $("#faN").value, location_id: $("#faL").value || null, start_value: +$("#faV").value, life_months: +$("#faM").value, salvage: +$("#faS").value || 0, opening: op, start_date: op ? null : $("#faD").value, paid_from: op ? null : +$("#faP").value };
    wrap(async () => { await rpc("asset_save", { p_token: T(), p }); if (op && S.ob) { await rpc("opening_save", { p_token: T(), p: Object.assign(obPayload()) }); } }, async () => { closeModal(); inval(); if (S.ob) S.ob.loaded = false; await M.loadCore(); render(); }, "#faErr"); }
  /* opening */
  else if (k === "obPlug") { const d = obTot().diff; S.ob.v.retained = r2(S.ob.v.retained + d); render(); }
  else if (k === "obSave") wrap(async () => { const r = await rpc("opening_save", { p_token: T(), p: obPayload() }); await M.loadCore(); S.ob.loaded = false; inval(); toast(Math.abs(r.diff) < 0.01 ? "اتحفظت الأرصدة — الميزانية متوازنة." : "اتحفظت الأرصدة — لسه فيه فرق " + fmt(r.diff)); }, async () => render(), "#obErr");
  else if (k === "obLock") { if (!confirm("اعتماد الأرصدة الافتتاحية وقفلها؟ بعد الاعتماد التعديل بفتح من المالك بس.")) return true;
    wrap(async () => { await rpc("opening_save", { p_token: T(), p: obPayload() }); await rpc("opening_lock", { p_token: T(), p_lock: true }); await M.loadCore(); S.ob.loaded = false; inval(); toast("اتعتمدت الأرصدة واتقفلت."); }, async () => render(), "#obErr"); }
  else if (k === "obUnlock") wrap(async () => { await rpc("opening_lock", { p_token: T(), p_lock: false }); await M.loadCore(); S.ob.loaded = false; }, async () => render(), "#obErr");
  /* tax */
  else if (k === "tiOpen") tiModal(id);
  else if (k === "tiGo") { const b = { name: $("#tbN").value, tin: $("#tbT").value.trim(), address: $("#tbA").value }; if (b.tin && !/^\d{9}$/.test(b.tin)) return errBox("#tbErr", "الرقم الضريبي ٩ أرقام."), true; wrap(async () => { closeModal(); await tiPrint(id, b); }, null, "#tbErr"); }
  else if (k === "eiSt") { S.ei.st = a.dataset.k; render(); }
  else if (k === "eiJson" || k === "eiMark") { const ids = [...document.querySelectorAll("[data-ei]")].filter(c => c.checked).map(c => c.dataset.ei); if (!ids.length) return toast("اختار فواتير الأول.", true), true;
    if (k === "eiJson") { const docs = ids.map(i => etaDoc(S.rd.sales.find(s => s.id === i))); const blob = new Blob([JSON.stringify({ documents: docs }, null, 2)], { type: "application/json" }), x = document.createElement("a"); x.href = URL.createObjectURL(blob); x.download = `eta-${today()}.json`; x.click(); return true; }
    let err = null; if (a.dataset.s === "invalid") { err = prompt("سبب الرفض من المنظومة"); if (!err) return true; }
    const uuid = a.dataset.s === "valid" && ids.length === 1 ? prompt("UUID من المنظومة (اختياري)") : null;
    wrap(() => rpc("einv_set", { p_token: T(), p_sales: ids, p_status: a.dataset.s, p_uuid: uuid, p_error: err }), async () => { S.ei.sel = {}; await loadTax(); render(); }); }
  else if (k === "txSave") { const p = Object.assign({}, (S.store || {}).tax || {}); document.querySelectorAll("[data-tx]").forEach(el => { if (el.dataset.tx !== "rin") p[el.dataset.tx] = el.type === "checkbox" ? el.checked : el.value.trim(); });
    wrap(() => rpc("tax_settings_save", { p_token: T(), p }), async () => { S.store.tax = p; toast("اتحفظت البيانات."); render(); }, "#txErr"); }
  else return prev ? prev(k, a) : false;
  return true;
};
document.addEventListener("change", e => { if (e.target.id === "eiAll") document.querySelectorAll("[data-ei]").forEach(c => { c.checked = e.target.checked; if (S.ei) S.ei.sel[c.dataset.ei] = c.checked; }); else if (e.target.dataset && e.target.dataset.ei && S.ei) S.ei.sel[e.target.dataset.ei] = e.target.checked; });
})();
