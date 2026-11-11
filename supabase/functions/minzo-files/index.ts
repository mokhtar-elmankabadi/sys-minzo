// SYS Minzo · private files (staff photo and papers; the chat's photos and voice notes).
// Files live in the private bucket «minzo-files»; nothing is public. Every request is checked first by the
// database (staff_file_check) with the caller's own sign-in and staff session, then this function — which alone
// holds the master key — uploads, deletes, or hands back a link that works for 5 minutes only.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORIGINS = ["https://mokhtar-elmankabadi.github.io", "http://localhost:8787"];
const BUCKET = "minzo-files";
const MAX = 6 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
// chat: photos are made smaller on the phone first; voice notes are at most 2 minutes
const CHAT_IMG: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const CHAT_VOICE: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/aac": "aac", "audio/x-m4a": "m4a" };
const CHAT_MAX = 3 * 1024 * 1024;
const ROOM = /^(admin|loc:[0-9]+|dm:[0-9a-f-]{36}:[0-9a-f-]{36})$/;

const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ORIGINS.includes(o) ? o : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const b64bytes = (s: string) => { const bin = atob(s.replace(/^data:[^,]*,/, "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { ...cors(origin), "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "BAD_REQUEST" });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply({ error: "BAD_REQUEST" }); }
  const asCaller = createClient(URL_, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const admin = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = String(b.token ?? "");
  const staffId = String(b.staff_id ?? "");

  const check = async (action: string, doc: unknown) => {
    const { data, error } = await asCaller.rpc("staff_file_check", { p_token: token, p_staff: staffId, p_action: action, p_doc: doc ?? null });
    if (error) throw new Error(error.message.split("\n")[0]);
    return data as { actor: string; actor_name: string; staff_name: string; photo_path: string | null; doc_path: string | null; doc_title: string | null };
  };
  const audit = (c: { actor: string; actor_name: string }, action: string, entity: string, after: string | null) =>
    admin.from("audit_log").insert({ staff_id: c.actor, staff_name: c.actor_name, action, entity, after });
  const link = async (path: string) => {
    const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error || !data) throw new Error("NOT_FOUND");
    return data.signedUrl;
  };
  const readFile = (types = TYPES, max = MAX) => {
    const mime = String(b.mime ?? "").split(";")[0].trim().toLowerCase();
    if (!types[mime]) throw new Error("BAD_FILE_TYPE");
    const bytes = b64bytes(String(b.data ?? ""));
    if (!bytes.length) throw new Error("BAD_REQUEST");
    if (bytes.length > max) throw new Error("FILE_TOO_BIG");
    return { mime, bytes, ext: types[mime] };
  };
  // remove chat files past their time (voice 30 days, photos 45 days); the message text stays
  const purge = async () => {
    const { data } = await admin.rpc("_chat_expired", { p_limit: 50 });
    const rows = (data ?? []) as { id: number; path: string }[];
    if (!rows.length) return;
    await admin.storage.from(BUCKET).remove(rows.map((r) => r.path));
    await admin.from("chat_msgs").update({ media_gone_at: new Date().toISOString() }).in("id", rows.map((r) => r.id));
  };

  try {
    switch (b.action) {
      case "photo_up": {
        const c = await check("photo", null);
        const f = readFile();
        if (!f.mime.startsWith("image/")) return reply({ error: "BAD_FILE_TYPE" });
        const path = `staff/${staffId}/photo-${Date.now()}.${f.ext}`;
        const { error } = await admin.storage.from(BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false });
        if (error) return reply({ error: "UPLOAD_FAILED" });
        await admin.from("staff").update({ photo_path: path }).eq("id", staffId);
        if (c.photo_path) await admin.storage.from(BUCKET).remove([c.photo_path]);
        await audit(c, "صورة موظف", c.staff_name, null);
        return reply({ ok: true, url: await link(path) });
      }
      case "photo_get": {
        const c = await check("photo_get", null);
        return reply({ ok: true, url: c.photo_path ? await link(c.photo_path) : null });
      }
      case "doc_up": {
        const c = await check("doc", null);
        const f = readFile();
        const title = String(b.title ?? "").trim().slice(0, 80);
        if (!title) return reply({ error: "NAME_REQUIRED" });
        const path = `staff/${staffId}/doc-${crypto.randomUUID()}.${f.ext}`;
        const { error } = await admin.storage.from(BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false });
        if (error) return reply({ error: "UPLOAD_FAILED" });
        const { data: row, error: e2 } = await admin.from("staff_docs").insert({ staff_id: staffId, title, path, mime: f.mime, bytes: f.bytes.length, uploaded_by: c.actor }).select("id").single();
        if (e2) { await admin.storage.from(BUCKET).remove([path]); return reply({ error: "UPLOAD_FAILED" }); }
        await audit(c, "إضافة ورقة لملف موظف", c.staff_name, title);
        return reply({ ok: true, id: row.id });
      }
      case "doc_open": {
        const c = await check("open", b.doc_id);
        return reply({ ok: true, url: await link(c.doc_path!) });
      }
      case "doc_del": {
        const c = await check("del", b.doc_id);
        await admin.storage.from(BUCKET).remove([c.doc_path!]);
        await admin.from("staff_docs").delete().eq("id", Number(b.doc_id));
        await audit(c, "حذف ورقة من ملف موظف", c.staff_name, c.doc_title);
        return reply({ ok: true });
      }
      case "chat_up": {
        const room = String(b.room ?? "");
        if (!ROOM.test(room)) return reply({ error: "BAD_REQUEST" });
        const kind = b.kind === "voice" ? "voice" : b.kind === "image" ? "image" : "";
        if (!kind) return reply({ error: "BAD_REQUEST" });
        const { data: c, error: ce } = await asCaller.rpc("chat_file_check", { p_token: token, p_room: room, p_ids: null });
        if (ce) throw new Error(ce.message.split("\n")[0]);
        const f = readFile(kind === "voice" ? CHAT_VOICE : CHAT_IMG, CHAT_MAX);
        const dur = kind === "voice" ? Math.round(Number(b.dur ?? 0)) : null;
        if (kind === "voice" && !(dur! >= 1 && dur! <= 121)) return reply({ error: "VOICE_TOO_LONG" });
        const path = `chat/${room.replace(/:/g, "_")}/${crypto.randomUUID()}.${f.ext}`;
        const { error } = await admin.storage.from(BUCKET).upload(path, f.bytes, { contentType: f.mime, upsert: false });
        if (error) return reply({ error: "UPLOAD_FAILED" });
        const body = typeof b.body === "string" && b.body.trim() ? b.body.trim().slice(0, 2000) : null;
        const { data: row, error: e2 } = await admin.from("chat_msgs").insert({ room, sender: (c as { actor: string }).actor, kind, path, mime: f.mime, bytes: f.bytes.length, dur_s: dur, body }).select("id").single();
        if (e2) { await admin.storage.from(BUCKET).remove([path]); return reply({ error: "UPLOAD_FAILED" }); }
        try { await purge(); } catch { /* never block the message */ }
        return reply({ ok: true, id: row.id });
      }
      case "chat_urls": {
        const room = String(b.room ?? "");
        const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 60) : [];
        if (!ROOM.test(room) || !ids.length) return reply({ ok: true, urls: {} });
        const { data: c, error: ce } = await asCaller.rpc("chat_file_check", { p_token: token, p_room: room, p_ids: ids });
        if (ce) throw new Error(ce.message.split("\n")[0]);
        const paths = (c as { paths: Record<string, string> }).paths ?? {};
        const keys = Object.keys(paths);
        if (!keys.length) return reply({ ok: true, urls: {} });
        const { data: signed } = await admin.storage.from(BUCKET).createSignedUrls(keys.map((k) => paths[k]), 600);
        const urls: Record<string, string> = {};
        (signed ?? []).forEach((x, i) => { if (x.signedUrl) urls[keys[i]] = x.signedUrl; });
        return reply({ ok: true, urls });
      }
      default:
        return reply({ error: "BAD_REQUEST" });
    }
  } catch (e) {
    const m = String((e as Error).message || e);
    return reply({ error: /^[A-Z_:a-z]+$/.test(m) ? m : "SERVER_ERROR" });
  }
});
