// SYS Minzo · backup-export — called every morning by the owner's Google Apps Script («Minzo Backup»).
// Header x-backup-key must match a sha256 stored in backup_keys (the key itself is never stored).
// Returns {dump, xlsx_b64}: dump = everything (for restoring), xlsx_b64 = Arabic sheets (for reading).
// The service-role key lives only here.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import * as XLSX from "npm:xlsx@0.18.5";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

type Sheet = { name: string; cols: string[]; rows: unknown[][] };

function buildXlsx(sheets: Sheet[]): string {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] } as any;
  const used = new Set<string>();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.cols, ...s.rows]);
    (ws as any)["!views"] = [{ RTL: true }];
    ws["!cols"] = s.cols.map((c, i) => {
      let w = String(c).length;
      for (const r of s.rows.slice(0, 500)) w = Math.max(w, String(r[i] ?? "").length);
      return { wch: Math.min(Math.max(w + 2, 10), 45) };
    });
    if (s.rows.length) ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length, c: s.cols.length - 1 } }) };
    let name = String(s.name).replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Sheet";
    for (let k = 2; used.has(name); k++) name = (String(s.name).slice(0, 28) + " " + k).slice(0, 31);
    used.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "base64", bookType: "xlsx", compression: true });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST_ONLY" });
  const db = createClient(URL_, SVC, { auth: { persistSession: false, autoRefreshToken: false } });

  const key = req.headers.get("x-backup-key") ?? "";
  const { data: ok } = key.length >= 20
    ? await db.from("backup_keys").select("id").eq("key_hash", await sha256(key)).maybeSingle()
    : { data: null };
  if (!ok) { await new Promise((r) => setTimeout(r, 1200)); return json(401, { error: "BAD_KEY" }); }

  let source = "apps-script";
  try { const b = await req.json(); if (b && typeof b.source === "string") source = b.source.slice(0, 40); } catch { /* no body */ }

  const [{ data: dump, error: e1 }, { data: readable, error: e2 }] = await Promise.all([db.rpc("backup_dump"), db.rpc("backup_readable")]);
  if (e1 || e2 || !dump || !readable) {
    await db.from("backup_log").insert({ kind: "error", bytes: 0, note: `${source}: ${(e1 || e2)?.message ?? "empty"}`.slice(0, 300) });
    return json(500, { error: "DUMP_FAILED" });
  }
  const xlsx_b64 = buildXlsx((readable as { sheets: Sheet[] }).sheets);
  const dumpBytes = new TextEncoder().encode(JSON.stringify(dump)).length;
  const xlsxBytes = Math.floor(xlsx_b64.length * 3 / 4);
  await db.from("backup_log").insert({ kind: "drive", bytes: dumpBytes + xlsxBytes, note: `${source} · json ${dumpBytes} · xlsx ${xlsxBytes}` });
  return json(200, { dump, xlsx_b64 });
});
