/* SYS Minzo · password-protected PDF (AES-256, PDF standard security revision 6)
   Pages are pictures of the rendered report, so Arabic shows exactly as on screen.
   The file opens only with the password; printing is allowed, editing and copying are not. */
(function () {
"use strict";
const te = new TextEncoder(), C = crypto.subtle;
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let k = 0; a.forEach(x => { o.set(x, k); k += x.length; }); return o; };
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const hex = u => Array.from(u, b => b.toString(16).padStart(2, "0")).join("");
async function aesCbc(key, iv, data, pad) { const k = await C.importKey("raw", key, "AES-CBC", false, ["encrypt"]); const o = new Uint8Array(await C.encrypt({ name: "AES-CBC", iv }, k, data)); return pad ? o : o.subarray(0, data.length); }
const sha = async (alg, d) => new Uint8Array(await C.digest(alg, d));
/* ISO 32000-2, algorithm 2.B */
async function hash2B(pw, salt, udata) {
  let K = await sha("SHA-256", cat(pw, salt, udata)), round = 0, E;
  for (;;) {
    const one = cat(pw, K, udata), K1 = new Uint8Array(one.length * 64); for (let i = 0; i < 64; i++) K1.set(one, i * one.length);
    E = await aesCbc(K.subarray(0, 16), K.subarray(16, 32), K1, false);
    let m = 0; for (let i = 0; i < 16; i++) m += E[i]; m %= 3;
    K = await sha(["SHA-256", "SHA-384", "SHA-512"][m], E); round++;
    if (round >= 64 && E[E.length - 1] <= round - 32) break;
  }
  return K.subarray(0, 32);
}
const pwBytes = s => te.encode(String(s).normalize("NFKC")).subarray(0, 127);
async function security(userPw, ownerPw, P) {
  const key = rnd(32), up = pwBytes(userPw), op = pwBytes(ownerPw), z = new Uint8Array(16);
  const uv = rnd(8), uk = rnd(8), U = cat(await hash2B(up, uv, new Uint8Array(0)), uv, uk), UE = await aesCbc(await hash2B(up, uk, new Uint8Array(0)), z, key, false);
  const ov = rnd(8), ok = rnd(8), O = cat(await hash2B(op, ov, U), ov, ok), OE = await aesCbc(await hash2B(op, ok, U), z, key, false);
  const pb = new Uint8Array(16); new DataView(pb.buffer).setInt32(0, P, true); pb.set([255, 255, 255, 255, 84, 97, 100, 98], 4); pb.set(rnd(4), 12);
  const Perms = await aesCbc(key, z, pb, false);
  return { key, U, UE, O, OE, Perms, P };
}
/* pages: [{ jpeg: Uint8Array, w, h }] in pixels; drawn full-bleed on A4 */
async function build(pages, password) {
  const P = -1852; /* print + high-quality print only */
  const s = await security(password, hex(rnd(16)), P), parts = [], offs = [];
  let len = 0; const put = x => { const b = typeof x === "string" ? te.encode(x) : x; parts.push(b); len += b.length; };
  const enc = async d => { const iv = rnd(16); return cat(iv, await aesCbc(s.key, iv, d, true)); };
  const obj = (n, body) => { offs[n] = len; put(`${n} 0 obj\n`); body.forEach(put); put("\nendobj\n"); };
  put("%PDF-2.0\n%\xE2\xE3\xCF\xD3\n");
  const W = 595.28, H = 841.89, n = pages.length, kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, [`<< /Type /Pages /Count ${n} /Kids [${kids}] >>`]);
  for (let i = 0; i < n; i++) {
    const p = pages[i], a = 3 + i * 3, img = await enc(p.jpeg), cs = await enc(te.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`));
    obj(a, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${a + 1} 0 R >> >> /Contents ${a + 2} 0 R >>`]);
    obj(a + 1, [`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`, img, "\nendstream"]);
    obj(a + 2, [`<< /Length ${cs.length} >>\nstream\n`, cs, "\nendstream"]);
  }
  const en = 3 + n * 3;
  obj(en, [`<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF /EncryptMetadata true /O <${hex(s.O)}> /U <${hex(s.U)}> /OE <${hex(s.OE)}> /UE <${hex(s.UE)}> /P ${P} /Perms <${hex(s.Perms)}> >>`]);
  const xref = len, id = hex(rnd(16));
  put(`xref\n0 ${en + 1}\n0000000000 65535 f \n`); for (let i = 1; i <= en; i++) put(String(offs[i]).padStart(10, "0") + " 00000 n \n");
  put(`trailer\n<< /Size ${en + 1} /Root 1 0 R /Encrypt ${en} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

/* report HTML → A4 page pictures. Each top-level block is drawn on its own, then laid onto pages;
   a block taller than the room left is cut at the lightest line near the page bottom (between text rows). */
const DPMM = 6, PW = 210, PH = 297, MG = 14;
function cutAt(cv, from, max) { const g = cv.getContext("2d"), lo = Math.max(from + 1, from + Math.floor(max * 0.8)), hi = Math.min(cv.height, from + max), d = g.getImageData(0, lo, cv.width, hi - lo).data;
  let best = hi, bestDark = Infinity; for (let y = hi - lo - 1; y >= 0; y--) { let dark = 0; for (let x = 0; x < cv.width; x += 2) if (d[(y * cv.width + x) * 4] < 200) dark++; if (dark < bestDark) { bestDark = dark; best = lo + y; if (!dark) break; } }
  return best; }
async function paginate(html, css, foot, mark) {
  const holder = document.createElement("div"); holder.innerHTML = html;
  const blocks = [...holder.children].map(e => e.outerHTML), cw = PW - 2 * MG, ch = (PH - 2 * MG - 6) * DPMM, pages = [];
  let page = null, y = 0;
  const newPage = () => { page = document.createElement("canvas"); page.width = PW * DPMM; page.height = PH * DPMM; const g = page.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, page.width, page.height); pages.push(page); y = 0; };
  for (let bi = 0; bi < blocks.length; bi++) {
    const cv = await window.MZPA.toCanvas(blocks[bi], cw, { css, dpmm: DPMM }); let from = 0;
    const end = (() => { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; for (let yy = cv.height - 1; yy > 0; yy--) for (let x = 0; x < cv.width; x += 2) if (d[(yy * cv.width + x) * 4] < 230) return yy + 2; return 1; })(); /* ignore the blank tail */
    newPage(); /* cover, index and every section start on a fresh page, same as the printed copy */
    while (from < end) {
      const room = ch - y; if (room < 40) { newPage(); continue; }
      const take = end - from <= room ? end - from : cutAt(cv, from, room) - from;
      page.getContext("2d").drawImage(cv, 0, from, cv.width, take, MG * DPMM, MG * DPMM + y, cv.width, take);
      from += take; y += take + 4 * DPMM; if (from < end) newPage();
    }
  }
  return pages.map((p, i) => { const g = p.getContext("2d");
    if (mark) { g.save(); g.translate(p.width / 2, p.height / 2); g.rotate(-Math.PI / 6); g.fillStyle = "rgba(200,0,0,.09)"; g.font = `bold ${60 * DPMM / 2.2}px Tahoma, Arial`; g.textAlign = "center"; g.fillText(mark, 0, 0); g.restore(); }
    g.fillStyle = "#777"; g.font = `${2.6 * DPMM}px Tahoma, Arial`; g.textAlign = "center"; g.direction = "rtl"; g.fillText(`${foot} · صفحة ${i + 1} من ${pages.length}`, p.width / 2, p.height - 7 * DPMM);
    return p; });
}
async function jpeg(cv) { const b = await new Promise(ok => cv.toBlob(ok, "image/jpeg", 0.86)); return new Uint8Array(await b.arrayBuffer()); }

window.MZPDF = {
  build, security, hash2B,
  async report(html, css, password, foot, mark) {
    const cvs = await paginate(html, css, foot, mark), pages = [];
    for (const c of cvs) pages.push({ jpeg: await jpeg(c), w: c.width, h: c.height });
    return build(pages, password);
  },
};
})();
