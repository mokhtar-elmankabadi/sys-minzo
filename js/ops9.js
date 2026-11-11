/* SYS Minzo · staff (batch 9): punching from the phone with location, alerts for the owner, place points,
   and the complete staff file (photo + papers through the private «minzo-files» function). Built on window.MZ. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, fmt, num, rpc, T, can, locName, toast, modal, closeModal, busy, render, errText, sb, today } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const canStaff = a => isTop() || can("staff", a);
const errBox = (id, e) => { const b = $(id); if (b) b.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); };
const chip = (t, c) => `<span class="chip ${c || "plain"}">${esc(t)}</span>`;
const tm = x => x ? new Date(x).toLocaleString("ar-EG", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const personal = () => S.sess && S.sess.device && S.sess.device.kind === "personal";
const mapUrl = (la, ln) => `https://www.google.com/maps?q=${la},${ln}`;

/* ---------- location ---------- */
const here = (opts) => new Promise(res => {
  if (!navigator.geolocation) return res(null);
  navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }), () => res(null),
    Object.assign({ enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }, opts || {}));
});

/* punch from a phone: the location goes with it (refused → recorded, marked outside) */
async function punchGeo(btn) {
  if (!S.ack9) { try { S.ack9 = localStorage.getItem("mz.geoAck") === "1"; } catch (e) {} }
  if (!S.ack9) {
    modal(`<h2>البصمة من الموبايل</h2><p>البصمة من موبايلك بتسجّل مكانك وقت الحضور والانصراف، وكمان كل كام دقيقة طول ما إنت حاضر والسيستم مفتوح، عشان الإدارة تعرف إنك في المكان. مفيش تتبّع بعد الانصراف أو والسيستم مقفول.</p>
      <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="geoAck">موافق — كمّل</button></div>`);
    return;
  }
  if (btn) busy(btn, true);
  toast("بنحدّد مكانك…");
  const g = await here();
  try {
    const r = await rpc("attend_punch_geo", { p_token: T(), p_lat: g ? g.lat : null, p_lng: g ? g.lng : null, p_acc: g ? g.acc : null });
    const t = new Date(r.at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
    toast((r.state === "in" ? "اتسجّل حضورك " : "اتسجّل انصرافك ") + t + (r.outside ? (g ? ` — بس إنت بره المكان (${num(r.dist)} متر)، وده هيظهر للإدارة.` : " — من غير موقع، وده هيظهر للإدارة.") : ""), !!r.outside);
    if (M.punchState) await M.punchState(); if (S.sp) S.sp.loaded = null; if (S.route === "staff") render();
  } catch (e) { toast(errText(e), true); }
  finally { if (btn) busy(btn, false); }
}
/* while checked in on a phone with the system open: report leaving / coming back */
setInterval(async () => {
  if (!S.sess || !personal() || document.hidden) return;
  const a = S.att; if (!a || !a.check_in || a.check_out) return;
  if (S._pingAt && Date.now() - S._pingAt < 4 * 60e3) return; S._pingAt = Date.now();
  const g = await here({ maximumAge: 20000 }); if (!g) return;
  try { const r = await rpc("attend_ping", { p_token: T(), p_lat: g.lat, p_lng: g.lng, p_acc: g.acc }); if (r && r.away && !S._awayShown) { S._awayShown = true; toast("إنت بره المعرض دلوقتي — اتسجّل للإدارة.", true); } if (r && r.away === false) S._awayShown = false; } catch (e) {}
}, 30000);

/* ---------- owner alerts on the staff screen ---------- */
const EV = { in_out: ["حضور من بره المكان", "bad"], out_out: ["انصراف من بره المكان", "bad"], away: ["خرج من المكان", "warn"], back: ["رجع للمكان", "ok"] };
async function loadEv() { S.attEv = await rpc("att_events_list", { p_token: T(), p_days: 14 }); }
function evCard() {
  if (!S.attEv) { setTimeout(() => loadEv().then(() => S.route === "staff" && render()).catch(() => { S.attEv = []; }), 0); return ""; }
  if (!S.attEv.length) return "";
  const unseen = S.attEv.filter(e => !e.seen).length;
  return `<div class="card rise" style="${unseen ? "border-color:var(--bad)" : ""}"><div class="row between"><h3 style="margin:0">تنبيهات الحضور بالموقع ${unseen ? chip(unseen + " جديد", "bad") : ""}</h3>${unseen ? `<button class="btn sm ghost" data-act="evSeen">علّمها اتشافت</button>` : ""}</div>
    <div class="tw" style="max-height:260px;overflow:auto;margin-top:8px"><table><tbody>${S.attEv.slice(0, 60).map(e => `<tr style="${e.seen ? "" : "font-weight:700"}"><td>${esc(e.staff)}</td><td>${chip(EV[e.kind][0], EV[e.kind][1])}</td><td class="num">${e.dist != null ? num(e.dist) + " متر" + (e.acc ? ` <span class="dim">(±${num(e.acc)})</span>` : "") : "من غير موقع"}</td><td class="dim" style="font-size:12.5px">${e.loc ? esc(locName(e.loc)) : ""}</td><td class="num dim" style="font-size:12.5px">${tm(e.at)}</td><td>${e.lat != null ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="${mapUrl(e.lat, e.lng)}">الخريطة</a>` : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="dim" style="font-size:12px;margin:6px 0 0">الموقع بيتسجّل من الموبايلات الشخصية بس، ووقت ما السيستم مفتوح والموظف حاضر.</p></div>`;
}
if (V.staff) { const prevStaff = V.staff; V.staff = () => { const h = prevStaff(); if (!canStaff("v") || !(S.sp && S.sp.tab === "att")) return h; const card = evCard(); if (!card) return h; const i = h.indexOf('<div class="tabs'); return i > 0 ? h.slice(0, i) + card + h.slice(i) : h + card; }; }

/* ---------- place points (settings, owner / GM) ---------- */
function geoCard() {
  if (!isTop()) return "";
  return `<div class="card rise"><h3>أماكن البصمة بالموبايل</h3><p class="dim" style="margin:-4px 0 10px;font-size:12.5px">حدّد نقطة كل مكان والمسافة المسموحة. أسهل طريقة: اقف جوه المكان وإنت فاتح السيستم من الموبايل ودوس «من مكاني دلوقتي».</p>
    ${S.locs.filter(l => l.active !== false).map(l => `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;padding:8px 0;border-top:1px solid var(--line)"><b style="min-width:120px">${esc(l.name)}</b>
      <div class="field" style="width:130px"><label>خط العرض</label><input class="inp num" data-glat="${l.id}" value="${l.lat ?? ""}"></div><div class="field" style="width:130px"><label>خط الطول</label><input class="inp num" data-glng="${l.id}" value="${l.lng ?? ""}"></div>
      <div class="field" style="width:100px"><label>المسافة (متر)</label><input class="inp num" type="number" min="20" max="5000" data-grad="${l.id}" value="${l.radius_m || 150}"></div>
      <button class="btn sm" data-act="geoHere" data-id="${l.id}">من مكاني دلوقتي</button><button class="btn sm gold" data-act="geoSave" data-id="${l.id}">حفظ</button>${l.lat != null ? `<a class="btn sm ghost" target="_blank" rel="noopener" href="${mapUrl(l.lat, l.lng)}">الخريطة</a>` : chip("مش متحدد", "warn")}</div>`).join("")}</div>`;
}
if (V.settings) { const prevSet = V.settings; V.settings = () => { const h = prevSet(); const c = geoCard(); return c ? h + c : h; }; }

/* ---------- the staff file ---------- */
const PHC = {};
const shrink = (file, max, q) => new Promise((res, rej) => {
  const img = new Image(), u = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res({ data: c.toDataURL("image/jpeg", q), mime: "image/jpeg" }); };
  img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("BAD_FILE_TYPE")); }; img.src = u;
});
const asB64 = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
async function files(body) {
  const { data, error } = await sb.functions.invoke("minzo-files", { body: Object.assign({ token: T() }, body) });
  if (error) throw error; if (data && data.error) throw new Error(data.error); return data;
}
async function fileModal(id) {
  let f; try { f = await rpc("staff_file_get", { p_token: T(), p_staff: id }); } catch (e) { return toast(errText(e), true); }
  const ed = canStaff("e"), x = f;
  S._sf = f;
  modal(`<h2>ملف الموظف: ${esc(x.name)}</h2>
    <div class="row" style="gap:16px;align-items:flex-start;flex-wrap:wrap"><div style="width:120px;text-align:center"><div id="sfPh" style="width:120px;height:120px;border-radius:16px;background:var(--bg2);display:grid;place-items:center;overflow:hidden;border:1px solid var(--line)">${x.photo ? `<div class="spin"></div>` : `<span class="dim">من غير صورة</span>`}</div>
      ${ed ? `<label class="btn sm" style="margin-top:6px;display:inline-block;cursor:pointer">${x.photo ? "تغيير الصورة" : "رفع صورة"}<input type="file" accept="image/*" capture="user" id="sfPhF" style="display:none"></label>` : ""}</div>
     <div class="stack" style="flex:1;min-width:260px"><div class="grid g2"><div class="field"><label>المسمّى الوظيفي</label><input class="inp" id="sfJ" value="${esc(x.job_title || "")}" ${ed ? "" : "disabled"}></div><div class="field"><label>الموبايل</label><input class="inp num" id="sfP" value="${esc(x.phone || "")}" ${ed ? "" : "disabled"}></div></div>
      <div class="grid g2"><div class="field"><label>تاريخ الميلاد</label><input class="inp" type="date" id="sfB" value="${esc(x.birth_date || "")}" ${ed ? "" : "disabled"}></div><div class="field"><label>تاريخ التعيين</label><input class="inp" type="date" id="sfH" value="${esc(x.hire_date || "")}" ${ed ? "" : "disabled"}></div></div>
      <div class="grid g2"><div class="field"><label>الرقم القومي</label><input class="inp num" id="sfN" value="${esc(x.national_id || "")}" maxlength="14" ${ed ? "" : "disabled"}></div><div class="field"><label>رقم للطوارئ</label><input class="inp" id="sfE" value="${esc(x.emergency || "")}" placeholder="الاسم والرقم" ${ed ? "" : "disabled"}></div></div>
      <div class="field"><label>العنوان</label><input class="inp" id="sfA" value="${esc(x.address || "")}" ${ed ? "" : "disabled"}></div>
      ${x.hr_notes !== undefined && ed ? `<div class="field"><label>ملاحظات الإدارة</label><textarea class="inp" id="sfR" rows="2">${esc(x.hr_notes || "")}</textarea></div>` : ""}
      ${ed ? `<div class="row" style="justify-content:flex-end"><button class="btn gold" data-act="sfSave" data-id="${x.id}">حفظ البيانات</button></div>` : ""}</div></div>
    <div class="card" style="padding:12px;margin-top:12px"><h3 style="margin-top:0">الورق والمستندات <span class="dim" style="font-size:12.5px;font-weight:400">(${x.docs.length})</span></h3>
      <div class="tw"><table><tbody>${x.docs.map(d => `<tr><td>${esc(d.title)}<br><span class="dim" style="font-size:12px">${d.mime === "application/pdf" ? "PDF" : "صورة"} · ${num(Math.round((d.bytes || 0) / 1024))} KB · ${tm(d.at)} · ${esc(d.by || "")}</span></td><td style="white-space:nowrap"><button class="btn sm" data-act="sfDoc" data-id="${d.id}">فتح</button>${ed ? `<button class="btn sm ghost" data-act="sfDocDel" data-id="${d.id}">حذف</button>` : ""}</td></tr>`).join("") || `<tr><td class="muted">لسه مفيش ورق — صوّر أو ارفع شهادة الجيش أو البطاقة أو العقد.</td></tr>`}</tbody></table></div>
      ${ed ? `<div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><input class="inp" id="sfT" placeholder="اسم الورقة — مثال: شهادة الجيش" style="flex:1;min-width:180px"><label class="btn" style="cursor:pointer">تصوير / رفع<input type="file" accept="image/*,application/pdf" id="sfDF" style="display:none"></label></div>` : ""}
      <p class="dim" style="font-size:12px;margin:6px 0 0">الملفات متخزنة بشكل خاص، وكل فتح بيكون بلينك بيشتغل ٥ دقايق بس.</p></div>
    <div id="sfErr"></div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn ghost" data-act="mClose">قفل</button></div>`);
  const pc = PHC[x.id]; const showPh = u => { const b = $("#sfPh"); if (b && u) b.innerHTML = `<img src="${esc(u)}" alt="" style="width:100%;height:100%;object-fit:cover">`; };
  if (x.photo && pc && pc.t > Date.now() - 240000) showPh(pc.u);
  else if (x.photo) files({ action: "photo_get", staff_id: x.id }).then(r => { if (r.url) PHC[x.id] = { u: r.url, t: Date.now() }; const b = $("#sfPh"); if (b && r.url) b.innerHTML = `<img src="${esc(r.url)}" alt="" style="width:100%;height:100%;object-fit:cover">`; }).catch(() => {});
  const ph = $("#sfPhF"); if (ph) ph.onchange = async () => { const fl = ph.files[0]; if (!fl) return; try { toast("بيترفع…"); const im = await shrink(fl, 640, 0.85); const r = await files({ action: "photo_up", staff_id: x.id, data: im.data, mime: im.mime }); PHC[x.id] = { u: r.url, t: Date.now() }; const b = $("#sfPh"); if (b) b.innerHTML = `<img src="${esc(r.url)}" alt="" style="width:100%;height:100%;object-fit:cover">`; toast("اتحفظت الصورة."); } catch (e) { errBox("#sfErr", e); } };
  const df = $("#sfDF"); if (df) df.onchange = async () => { const fl = df.files[0]; if (!fl) return; const title = $("#sfT").value.trim(); if (!title) { df.value = ""; return errBox("#sfErr", "NAME_REQUIRED"); }
    try { toast("بيترفع…"); let body;
      if (fl.type === "application/pdf") { if (fl.size > 5.5 * 1024 * 1024) throw new Error("FILE_TOO_BIG"); body = { data: await asB64(fl), mime: "application/pdf" }; }
      else { const im = await shrink(fl, 1800, 0.82); body = { data: im.data, mime: im.mime }; }
      await files(Object.assign({ action: "doc_up", staff_id: x.id, title }, body)); toast("اتضافت الورقة."); fileModal(x.id); }
    catch (e) { errBox("#sfErr", e); df.value = ""; } };
}

/* ---------- actions ---------- */
const prev = window.MZX;
window.MZX = async function (k, a) {
  if (k === "punch" && personal()) { punchGeo(a); return true; }
  if (k === "geoAck") { S.ack9 = true; try { localStorage.setItem("mz.geoAck", "1"); } catch (e) {} closeModal(); punchGeo(null); return true; }
  if (k === "evSeen") { try { await rpc("att_events_seen", { p_token: T() }); S.attEv = null; render(); } catch (e) { toast(errText(e), true); } return true; }
  if (k === "geoHere") { busy(a, true); const g = await here({ maximumAge: 0 }); busy(a, false);
    if (!g) return toast("الموبايل ما ادّاش الموقع — اسمح للمتصفح بالموقع وجرّب تاني.", true), true;
    const id = a.dataset.id; document.querySelector(`[data-glat="${id}"]`).value = g.lat.toFixed(6); document.querySelector(`[data-glng="${id}"]`).value = g.lng.toFixed(6);
    toast(`اتحدد (دقة ±${Math.round(g.acc)} متر) — دوس «حفظ».`); return true; }
  if (k === "geoSave") { const id = +a.dataset.id, la = document.querySelector(`[data-glat="${id}"]`).value.trim(), ln = document.querySelector(`[data-glng="${id}"]`).value.trim();
    busy(a, true);
    try { await rpc("location_geo_set", { p_token: T(), p_loc: id, p_lat: la === "" ? null : +la, p_lng: ln === "" ? null : +ln, p_radius: +document.querySelector(`[data-grad="${id}"]`).value || 150 });
      const l = S.locs.find(x => x.id === id); Object.assign(l, { lat: la === "" ? null : +la, lng: ln === "" ? null : +ln, radius_m: +document.querySelector(`[data-grad="${id}"]`).value || 150 }); toast("اتحفظ."); render(); }
    catch (e) { toast(errText(e), true); busy(a, false); }
    return true; }
  if (k === "sfOpen") { fileModal(a.dataset.id); return true; }
  if (k === "sfSave") { busy(a, true);
    try { await rpc("staff_file_save", { p_token: T(), p_staff: a.dataset.id, p: { job_title: $("#sfJ").value, phone: $("#sfP").value, birth_date: $("#sfB").value || null, hire_date: $("#sfH").value || null, national_id: $("#sfN").value, emergency: $("#sfE").value, address: $("#sfA").value, hr_notes: $("#sfR") ? $("#sfR").value : null } });
      toast("اتحفظ الملف."); busy(a, false); }
    catch (e) { errBox("#sfErr", e); busy(a, false); }
    return true; }
  if (k === "sfDoc") { busy(a, true); const w = window.open("", "_blank");
    try { const r = await files({ action: "doc_open", staff_id: S._sf.id, doc_id: +a.dataset.id }); if (w) w.location = r.url; else location.href = r.url; }
    catch (e) { if (w) w.close(); errBox("#sfErr", e); } finally { busy(a, false); }
    return true; }
  if (k === "sfDocDel") { if (!confirm("حذف الورقة دي من ملف الموظف؟")) return true; busy(a, true);
    try { await files({ action: "doc_del", staff_id: S._sf.id, doc_id: +a.dataset.id }); toast("اتحذفت."); fileModal(S._sf.id); } catch (e) { errBox("#sfErr", e); busy(a, false); }
    return true; }
  return prev ? prev(k, a) : false;
};
})();
