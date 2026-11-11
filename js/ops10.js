/* SYS Minzo · internal chat (batch 10): a room per place, the admin room, private messages; text, photos, voice notes.
   Photos and voice go through the private «minzo-files» function. New messages are fetched every few seconds
   while the chat is open, and the unread count every 40 seconds. Built on window.MZ. */
(function () {
"use strict";
const M = window.MZ; if (!M) return;
const { S, V, H, $, esc, rpc, T, toast, modal, closeModal, busy, render, errText, sb, header } = M;
const isTop = () => ["owner", "gm"].includes(S.sess.role.id);
const sid = () => S.sess && S.sess.staff && S.sess.staff.id;
const C = () => { if (S.ch && S.ch.sid !== sid()) S.ch = null; return S.ch || (S.ch = { sid: sid(), room: null, rooms: null, others: [], msgs: [], urls: {}, last: 0, more: false, draft: {} }); };
const ar = n => Number(n).toLocaleString("ar-EG");
const hm = x => new Date(x).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" });
const dayKey = x => new Date(x).toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const dayLbl = x => { const k = dayKey(x), t = dayKey(new Date()), y = dayKey(new Date(Date.now() - 864e5)); return k === t ? "النهارده" : k === y ? "امبارح" : new Date(x).toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" }); };
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const asB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const shrink = (file, max, q) => new Promise((res, rej) => {
  const img = new Image(), u = URL.createObjectURL(file);
  img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res({ data: c.toDataURL("image/jpeg", q), mime: "image/jpeg" }); };
  img.onerror = () => { URL.revokeObjectURL(u); rej(new Error("BAD_FILE_TYPE")); }; img.src = u;
});
async function files(body) {
  const { data, error } = await sb.functions.invoke("minzo-files", { body: Object.assign({ token: T() }, body) });
  if (error) throw error; if (data && data.error) throw new Error(data.error); return data;
}

/* ---------- unread badge (sidebar + top bar) ---------- */
function badges() {
  const n = S.chatUnread || 0;
  document.querySelectorAll('[data-go="chat"]').forEach(b => { let e = b.querySelector(".nbadge"); if (!n) { if (e) e.remove(); return; } if (!e) { e = document.createElement("em"); e.className = "nbadge num"; b.appendChild(e); } e.textContent = n > 99 ? "99+" : n; });
}
async function pollUnread() {
  if (!S.sess || document.hidden || !document.getElementById("app") || document.getElementById("app").hidden) return;
  try { const n = await rpc("chat_unread", { p_token: T() }); if (n !== S.chatUnread) { S.chatUnread = n; badges(); } } catch (e) { /* quiet */ }
}
let seen = null;
setInterval(() => { const s = sid() || null; if (s !== seen) { seen = s; S.chatUnread = 0; badges(); if (s) pollUnread(); } }, 3000);
setInterval(pollUnread, 40000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { pollUnread(); if (S.route === "chat") tick(); } });

/* ---------- data ---------- */
async function loadRooms() {
  const c = C(), r = await rpc("chat_rooms", { p_token: T() });
  c.rooms = r.rooms || []; c.others = r.others || [];
}
async function openRoom(room) {
  const c = C(); c.room = room; c.msgs = []; c.last = 0; c.access = null; c.loading = true;
  render();
  try {
    const r = await rpc("chat_msgs", { p_token: T(), p_room: room, p_after: null, p_before: null });
    if (c.room !== room) return;
    c.access = r.access; c.msgs = r.msgs || []; c.more = c.msgs.length >= 80; c.last = c.msgs.length ? c.msgs[c.msgs.length - 1].id : 0;
  } catch (e) { toast(errText(e), true); c.room = null; }
  c.loading = false; c.stick = true;
  const it = (c.rooms || []).find(x => x.room === room); if (it && it.unread) { S.chatUnread = Math.max(0, (S.chatUnread || 0) - it.unread); it.unread = 0; }
  if (S.route === "chat") render();
}
let ticking = false;
async function tick() {
  const c = C(); if (S.route !== "chat" || !c.room || c.loading || ticking || document.hidden) return;
  ticking = true; const room = c.room;
  try {
    const r = await rpc("chat_msgs", { p_token: T(), p_room: room, p_after: c.last || null, p_before: null });
    if (c.room !== room || S.route !== "chat") return;
    const add = (r.msgs || []).filter(m => !c.msgs.some(x => x.id === m.id));
    if (add.length) {
      const box = $("#chMsgs"), near = box && box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      const prevMsg = c.msgs[c.msgs.length - 1];
      c.msgs.push(...add); c.last = c.msgs[c.msgs.length - 1].id;
      if (box) { box.insertAdjacentHTML("beforeend", add.map((m, i) => bubble(m, i ? add[i - 1] : prevMsg)).join("")); if (near || add.some(m => m.mine)) box.scrollTop = box.scrollHeight; loadImgs(); }
    }
  } catch (e) { /* quiet: next tick tries again */ }
  finally { ticking = false; }
}
setInterval(tick, 4000);
setInterval(async () => { const c = C(); if (S.route !== "chat" || document.hidden || !c.rooms) return; try { await loadRooms(); const l = $("#chList"); if (l) l.innerHTML = listHtml(); } catch (e) { /* quiet */ } }, 20000);

/* ---------- screen ---------- */
function roomName(room) { const c = C(); const r = (c.rooms || []).find(x => x.room === room) || (c.others || []).find(x => x.room === room); return r ? r.name : ""; }
function item(r, extra) {
  return `<button class="chRoom ${C().room === r.room ? "on" : ""}" data-act="chOpen" data-room="${esc(r.room)}"><b>${r.kind === "admin" ? "🛡️ " : r.kind === "loc" ? "🏬 " : ""}${esc(r.name || "")}</b>${r.unread ? `<em class="nbadge num">${ar(r.unread)}</em>` : extra || "<span></span>"}<small>${r.last ? esc((r.last_by && r.kind !== "dm" ? r.last_by + ": " : "") + r.last) : r.n ? ar(r.n) + " رسالة" : "مفيش رسايل لسه"}</small></button>`;
}
function listHtml() {
  const c = C(), rooms = c.rooms.filter(r => r.kind !== "dm"), dms = c.rooms.filter(r => r.kind === "dm");
  let h = `<button class="btn sm gold" data-act="chNew" style="justify-content:center">+ رسالة خاصة</button><h4>الغرف</h4>${rooms.map(r => item(r)).join("")}`;
  h += `<h4>الخاص</h4>${dms.length ? dms.map(r => item(r)).join("") : `<p class="dim" style="font-size:12.5px;margin:2px 8px">لسه مفيش. دوس «رسالة خاصة».</p>`}`;
  if (isTop() && c.others.length) h += `<h4>مراجعة الخاص بين الموظفين</h4>${c.others.map(r => item(r, `<span class="dim num" style="font-size:11px">${hm(r.last_at)}</span>`)).join("")}`;
  return h;
}
function body(m) {
  const del = m.deleted && m.body == null && !m.media;
  if (del) return `<span class="gone">🚫 الرسالة اتمسحت</span>`;
  let h = "";
  if (m.kind === "image") h += m.gone ? `<span class="gone">📷 الصورة اتمسحت تلقائيًا بعد ٤٥ يوم</span><br>` : m.media ? `<div class="chImg" data-img="${m.id}" data-act="chView" data-id="${m.id}">${C().urls[m.id] ? `<img src="${esc(C().urls[m.id])}" alt="">` : `<div class="spin"></div>`}</div>` : "";
  if (m.kind === "voice") h += m.gone ? `<span class="gone">🎤 الفويس اتمسح تلقائيًا بعد ٣٠ يوم</span><br>` : m.media ? `<span data-voice="${m.id}"><button class="btn sm" data-act="chPlay" data-id="${m.id}">▶ فويس ${mmss(m.dur || 0)}</button></span>` : "";
  if (m.body) h += esc(m.body);
  return h;
}
function bubble(m, prev) {
  const c = C(), day = !prev || dayKey(prev.at) !== dayKey(m.at);
  const canDel = m.mine && !m.deleted && Date.now() - new Date(m.at).getTime() < 5 * 60000;
  return `${day ? `<div class="chDay">${dayLbl(m.at)}</div>` : ""}<div class="chB ${m.mine ? "me" : ""} ${m.deleted ? "del" : ""}" data-mid="${m.id}">${m.mine && c.access === "rw" ? "" : `<span class="who">${esc(m.name)} <i>· ${esc(m.role)}</i></span>`}${body(m)}<span class="meta">${m.deleted && (m.body != null || m.media) ? `<span class="chip bad" style="font-size:10.5px">اتمسحت</span>` : ""}${canDel ? `<button data-act="chDel" data-id="${m.id}">مسح</button>` : ""}<span class="num">${hm(m.at)}</span></span></div>`;
}
function compHtml() {
  const c = C();
  if (c.access !== "rw") return `<div class="chNote" style="border-top:1px solid var(--line);border-bottom:0">مراجعة بس — مش بتقدر تكتب في المحادثة دي.</div>`;
  if (c.rec) return `<div class="chComp"><div class="chRec"><span class="dot"></span><b class="num" id="chRecT">${mmss((Date.now() - c.rec.t0) / 1000)}</b><span class="dim" style="font-size:12px">أقصى حد دقيقتين</span></div><button class="btn sm ghost" data-act="chRecX">إلغاء</button><button class="btn sm gold" data-act="chRecGo">إرسال</button></div>`;
  return `<div class="chComp"><label class="iconbtn" title="صورة" style="cursor:pointer">📷<input type="file" accept="image/*" id="chImgF" style="display:none"></label><button class="iconbtn" data-act="chMic" title="فويس">🎤</button><textarea class="inp" id="chTxt" rows="1" maxlength="2000" placeholder="اكتب رسالة…">${esc(c.draft[c.room] || "")}</textarea><button class="btn gold" data-act="chSend">إرسال</button></div>`;
}
function mainHtml() {
  const c = C();
  if (!c.room) return `<div class="chEmpty"><div><div style="font-size:34px">💬</div><p>اختار غرفة أو محادثة من القايمة.</p></div></div>`;
  const it = (c.rooms || []).find(x => x.room === c.room);
  const sub = c.access === "r" ? "محادثة خاصة — مراجعة" : it && it.kind === "dm" && it.other ? it.other.role + (it.other.active ? "" : " · موقوف") : it && it.kind === "admin" ? "المالك والمدير العام ومديرين الفروع والمحاسب وأمين المخازن" : "كل اللي شغالين في المكان ده";
  return `<div class="chHead"><button class="iconbtn chBack" data-act="chBack" aria-label="رجوع">→</button><div><h3>${esc(roomName(c.room))}</h3><small class="dim">${esc(sub)}</small></div></div>
    <div class="chNote">الرسايل دي بتتراجع من الإدارة. الفويس بيتمسح بعد ٣٠ يوم والصور بعد ٤٥ يوم.</div>
    <div class="chMsgs" id="chMsgs">${c.loading ? `<div class="spin"></div>` : (c.more ? `<button class="btn sm ghost" data-act="chMore" style="align-self:center">رسايل أقدم</button>` : "") + (c.msgs.length ? c.msgs.map((m, i) => bubble(m, c.msgs[i - 1])).join("") : `<div class="chEmpty">مفيش رسايل لسه — ابدأ إنت.</div>`)}</div>
    <div id="chComp">${c.loading ? "" : compHtml()}</div>`;
}
V.chat = () => {
  const c = C();
  if (!c.rooms) { setTimeout(() => loadRooms().then(() => S.route === "chat" && render()).catch(e => toast(errText(e), true)), 0); return header() + `<div class="spin"></div>`; }
  return `<div class="chatpage">` + header() + `<div class="card chat rise ${c.room ? "open" : ""}"><aside class="chList" id="chList">${listHtml()}</aside><section class="chMain" id="chMain">${mainHtml()}</section></div></div>`;
};
function bindComp() {
  const c = C(), t = $("#chTxt");
  if (t) {
    const fit = () => { t.style.height = "auto"; t.style.height = Math.min(120, t.scrollHeight) + "px"; }; fit();
    t.oninput = () => { c.draft[c.room] = t.value; fit(); };
    t.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer:fine)").matches) { e.preventDefault(); send(); } };
  }
  const f = $("#chImgF"); if (f) f.onchange = async () => { const fl = f.files[0]; f.value = ""; if (!fl) return; await sendImage(fl); };
}
H.chat = () => {
  const c = C(), box = $("#chMsgs");
  if (box && c.stick !== false) { box.scrollTop = box.scrollHeight; }
  c.stick = true; bindComp(); loadImgs();
};
function drawComp() { const el = $("#chComp"); if (el) { el.innerHTML = compHtml(); bindComp(); } }

/* ---------- photos ---------- */
async function loadImgs() {
  const c = C(), room = c.room; if (!room) return;
  const ids = [...document.querySelectorAll("[data-img]")].map(e => +e.dataset.img).filter(id => !c.urls[id] && !(c.asked || {})[id]).slice(0, 60);
  if (!ids.length) return;
  c.asked = c.asked || {}; ids.forEach(id => { c.asked[id] = 1; });
  try {
    const r = await files({ action: "chat_urls", room, ids });
    Object.entries(r.urls || {}).forEach(([id, u]) => { c.urls[id] = u; const b = document.querySelector(`[data-img="${id}"]`); if (b) b.innerHTML = `<img src="${esc(u)}" alt="">`; });
    setTimeout(() => ids.forEach(id => { delete c.asked[id]; delete c.urls[id]; }), 9 * 60000); // links last 10 minutes
  } catch (e) { ids.forEach(id => { delete c.asked[id]; }); }
}
async function sendImage(fl) {
  const c = C(), room = c.room;
  try { toast("بتترفع الصورة…"); const im = await shrink(fl, 1280, 0.8); await files({ action: "chat_up", room, kind: "image", data: im.data, mime: im.mime }); await tick(); }
  catch (e) { toast(errText(e), true); }
}

/* ---------- voice ---------- */
async function recStart() {
  const c = C();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return toast("الجهاز أو المتصفح ده مش بيدعم تسجيل الفويس.", true);
  let st; try { st = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return toast(errText(new Error("MIC_DENIED")), true); }
  const mt = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  let rec; try { rec = new MediaRecorder(st, Object.assign({ audioBitsPerSecond: 32000 }, mt ? { mimeType: mt } : {})); } catch (e) { rec = new MediaRecorder(st); }
  const R = c.rec = { rec, st, chunks: [], t0: Date.now(), send: false, room: c.room };
  rec.ondataavailable = e => { if (e.data && e.data.size) R.chunks.push(e.data); };
  rec.onstop = async () => {
    st.getTracks().forEach(t => t.stop()); clearInterval(R.tick); clearTimeout(R.cap);
    const dur = Math.min(120, (Date.now() - R.t0) / 1000); if (c.rec === R) c.rec = null; drawComp();
    if (!R.send) return; if (dur < 1) return toast("الفويس قصير قوي.", true);
    const blob = new Blob(R.chunks, { type: (rec.mimeType || mt || "audio/webm") });
    try { toast("بيترفع الفويس…"); await files({ action: "chat_up", room: R.room, kind: "voice", data: await asB64(blob), mime: blob.type, dur: Math.max(1, Math.round(dur)) }); await tick(); }
    catch (e) { toast(errText(e), true); }
  };
  rec.start(1000);
  R.tick = setInterval(() => { const el = $("#chRecT"); if (el) el.textContent = mmss((Date.now() - R.t0) / 1000); }, 500);
  R.cap = setTimeout(() => { R.send = true; try { rec.stop(); } catch (e) {} toast("وصلت لدقيقتين — الفويس اتبعت."); }, 120000);
  drawComp();
}

/* ---------- send / delete ---------- */
async function send() {
  const c = C(), t = $("#chTxt"); if (!t) return; const v = t.value.trim(); if (!v || c.sending) return;
  c.sending = true;
  try { await rpc("chat_send", { p_token: T(), p_room: c.room, p_body: v }); t.value = ""; c.draft[c.room] = ""; t.style.height = "auto"; await tick(); }
  catch (e) { toast(errText(e), true); }
  c.sending = false; t.focus();
}
function peopleModal(list) {
  const draw = q => list.filter(p => !q || p.name.includes(q) || p.role.includes(q)).map(p => `<button class="chRoom" data-act="chPick" data-room="${esc(p.room)}"><b>${esc(p.name)}</b><span></span><small>${esc(p.role)}</small></button>`).join("") || `<p class="dim">مفيش نتايج.</p>`;
  modal(`<h2>رسالة خاصة لمين؟</h2><input class="inp" id="chQ" placeholder="دوّر بالاسم أو الوظيفة"><div id="chPeople" style="display:flex;flex-direction:column;gap:2px;margin-top:10px;max-height:55vh;overflow:auto">${draw("")}</div>`);
  const q = $("#chQ"); q.oninput = () => { $("#chPeople").innerHTML = draw(q.value.trim()); }; q.focus();
}

const prev = window.MZX;
window.MZX = async function (k, a) {
  const c = C();
  if (k === "chOpen" || k === "chPick") {
    if (k === "chPick") { closeModal(); if (!c.rooms.some(r => r.room === a.dataset.room)) { const p = (c.people || []).find(x => x.room === a.dataset.room); c.rooms.push({ room: a.dataset.room, name: p ? p.name : "", kind: "dm", other: p ? { role: p.role, active: true } : null, unread: 0 }); } }
    if (c.rec) { c.rec.send = false; try { c.rec.rec.stop(); } catch (e) {} }
    openRoom(a.dataset.room); return true;
  }
  if (k === "chBack") { c.room = null; render(); return true; }
  if (k === "chNew") { busy(a, true); try { c.people = await rpc("chat_people", { p_token: T() }); peopleModal(c.people); } catch (e) { toast(errText(e), true); } busy(a, false); return true; }
  if (k === "chSend") { send(); return true; }
  if (k === "chMic") { recStart(); return true; }
  if (k === "chRecX" || k === "chRecGo") { if (c.rec) { c.rec.send = k === "chRecGo"; try { c.rec.rec.stop(); } catch (e) {} } return true; }
  if (k === "chMore") {
    busy(a, true);
    try { const r = await rpc("chat_msgs", { p_token: T(), p_room: c.room, p_after: null, p_before: c.msgs.length ? c.msgs[0].id : null });
      const box = $("#chMsgs"), h0 = box ? box.scrollHeight : 0;
      c.msgs = (r.msgs || []).concat(c.msgs); c.more = (r.msgs || []).length >= 80; c.stick = false; render();
      const b2 = $("#chMsgs"); if (b2) b2.scrollTop = b2.scrollHeight - h0;
    } catch (e) { toast(errText(e), true); busy(a, false); }
    return true;
  }
  if (k === "chDel") {
    if (!confirm("تمسح الرسالة دي؟ الإدارة هتفضل شايفة إنها اتمسحت.")) return true;
    try { await rpc("chat_delete", { p_token: T(), p_id: +a.dataset.id }); const m = c.msgs.find(x => x.id === +a.dataset.id); if (m) { m.deleted = true; if (!isTop()) { m.body = null; m.media = false; } }
      const el = document.querySelector(`[data-mid="${a.dataset.id}"]`); if (el && m) { const i = c.msgs.indexOf(m); el.outerHTML = bubble(m, c.msgs[i - 1]).replace(/^<div class="chDay">[^<]*<\/div>/, ""); } }
    catch (e) { toast(errText(e), true); }
    return true;
  }
  if (k === "chPlay") {
    busy(a, true);
    try { const id = a.dataset.id, r = await files({ action: "chat_urls", room: c.room, ids: [+id] }); const u = (r.urls || {})[id]; if (!u) throw new Error("NOT_FOUND");
      const w = document.querySelector(`[data-voice="${id}"]`); if (w) { w.innerHTML = `<audio controls autoplay preload="auto" src="${esc(u)}"></audio>`; } }
    catch (e) { toast(errText(e), true); busy(a, false); }
    return true;
  }
  if (k === "chView") { const u = c.urls[a.dataset.id]; if (u) modal(`<img src="${esc(u)}" alt="" style="width:100%;border-radius:12px;display:block">`); return true; }
  return prev ? prev(k, a) : false;
};
})();
