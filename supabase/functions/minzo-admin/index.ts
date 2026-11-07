// SYS Minzo · email accounts. The master (service-role) key lives only here, never in the browser.
// create        — owner / users-admin makes an email account with a temporary password for a staff member
// reset         — owner / users-admin sets a new temporary password (no email service needed)
// signup        — a person makes their own account from the sign-in screen; it waits, with no access, until linked
// drop_pending  — owner / users-admin deletes an account that is waiting
// Every admin action is first checked by the database (email_admin_check) using the caller's own sign-in and
// staff session, so the same role rules as the rest of the system apply.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORIGINS = ["https://mokhtar-elmankabadi.github.io", "http://localhost:8787"];

const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && ORIGINS.includes(o) ? o : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { ...cors(origin), "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply({ error: "BAD_REQUEST" });

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return reply({ error: "BAD_REQUEST" }); }
  const auth = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } });

  const check = async (staff: unknown) => {
    const { data, error } = await asCaller.rpc("email_admin_check", { p_token: String(b.token ?? ""), p_staff: staff ?? null });
    if (error) throw new Error(error.message.split("\n")[0]);
    return data as { actor: string; actor_name: string; staff_id?: string; staff_name?: string; auth_user_id?: string | null; active?: boolean };
  };
  const audit = (actor: string | null, actorName: string | null, action: string, entity: string, after: string | null) =>
    admin.from("audit_log").insert({ staff_id: actor, staff_name: actorName, action, entity, after });
  const email = String(b.email ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const pwOk = password.length >= 8 && password.length <= 72;

  try {
    switch (b.action) {
      case "create": {
        if (!EMAIL.test(email)) return reply({ error: "BAD_EMAIL" });
        if (!pwOk) return reply({ error: "WEAK_PASSWORD" });
        const c = await check(b.staff_id);
        if (c.auth_user_id) return reply({ error: "ALREADY_LINKED" });
        if (!c.active) return reply({ error: "STAFF_INACTIVE" });
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: c.staff_name } });
        if (error) return reply({ error: /already|registered|exists/i.test(error.message) ? "EMAIL_TAKEN" : "AUTH_ERROR" });
        const uid = data.user.id;
        const { data: up, error: e2 } = await admin.from("staff").update({ auth_user_id: uid, email_login: true, pw_must_change: true, pw_reset_at: null })
          .eq("id", c.staff_id!).is("auth_user_id", null).select("id");
        if (e2 || !up?.length) { await admin.auth.admin.deleteUser(uid); return reply({ error: "ALREADY_LINKED" }); }
        await audit(c.actor, c.actor_name, "عمل حساب إيميل", c.staff_name!, email);
        return reply({ ok: true });
      }
      case "reset": {
        if (!pwOk) return reply({ error: "WEAK_PASSWORD" });
        const c = await check(b.staff_id);
        if (!c.auth_user_id) return reply({ error: "NOT_LINKED" });
        const { error } = await admin.auth.admin.updateUserById(c.auth_user_id, { password });
        if (error) return reply({ error: "AUTH_ERROR" });
        await admin.from("staff").update({ pw_must_change: true, pw_reset_at: new Date().toISOString() }).eq("id", c.staff_id!);
        // end the email-device sessions; the person signs in again with the new password
        const { data: devs } = await admin.from("devices").select("id").eq("auth_uid", c.auth_user_id);
        if (devs?.length) await admin.from("staff_sessions").delete().in("device_id", devs.map((d) => d.id));
        await audit(c.actor, c.actor_name, "تغيير باسورد الإيميل", c.staff_name!, null);
        return reply({ ok: true });
      }
      case "signup": {
        const name = String(b.name ?? "").trim().slice(0, 80);
        if (!name) return reply({ error: "NAME_REQUIRED" });
        if (!EMAIL.test(email)) return reply({ error: "BAD_EMAIL" });
        if (!pwOk) return reply({ error: "WEAK_PASSWORD" });
        const hourAgo = new Date(Date.now() - 3600e3).toISOString();
        const [{ count: recent }, { count: total }] = await Promise.all([
          admin.from("pending_accounts").select("*", { count: "exact", head: true }).gte("created_at", hourAgo),
          admin.from("pending_accounts").select("*", { count: "exact", head: true }),
        ]);
        if ((recent ?? 0) >= 10 || (total ?? 0) >= 50) return reply({ error: "TOO_MANY" });
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
        if (error) return reply({ error: /already|registered|exists/i.test(error.message) ? "EMAIL_TAKEN" : "AUTH_ERROR" });
        const { error: e2 } = await admin.from("pending_accounts").insert({ auth_user_id: data.user.id, email, name });
        if (e2) { await admin.auth.admin.deleteUser(data.user.id); return reply({ error: "AUTH_ERROR" }); }
        await audit(null, name, "طلب حساب إيميل", name, email);
        return reply({ ok: true });
      }
      case "drop_pending": {
        const c = await check(null);
        const uid = String(b.auth_user_id ?? "");
        const { data: p } = await admin.from("pending_accounts").select("email").eq("auth_user_id", uid).maybeSingle();
        if (!p) return reply({ error: "NOT_FOUND" });
        const { count } = await admin.from("staff").select("id", { count: "exact", head: true }).eq("auth_user_id", uid);
        if (count) return reply({ error: "ALREADY_LINKED" });
        await admin.auth.admin.deleteUser(uid);
        await audit(c.actor, c.actor_name, "حذف طلب حساب إيميل", p.email, null);
        return reply({ ok: true });
      }
      default:
        return reply({ error: "BAD_REQUEST" });
    }
  } catch (e) {
    const m = String((e as Error).message || e);
    return reply({ error: /^[A-Z_:a-z]+$/.test(m) ? m : "SERVER_ERROR" });
  }
});
