/* SYS Minzo · live app · phase 1
   Flow: device signs in (anonymous Supabase account kept on this device) → first run / device approval →
   staff unlock with their PIN → screens allowed by their role. Every write goes through a server function. */
(function () {
"use strict";
const CFG = window.MINZO_CONFIG;
/* the staff session rides on every table read, so the database can apply the role's read rules */
const withTok = (u, o) => { o = o || {}; const t = window.__mzTok; if (t && String(u).includes("/rest/v1/")) { const h = new Headers(o.headers || {}); h.set("x-mz-token", t); o = Object.assign({}, o, { headers: h }); } return fetch(u, o); };
/* devC: this browser as a showroom device (anonymous account kept on the device).
   mailC: a person signed in by email; kept apart so a showroom PC never loses its device identity. */
const devC = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "minzo-device" }, global: { fetch: withTok } });
const mailC = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "minzo-email" }, global: { fetch: withTok } });
let MODE = "device";
const cur = () => MODE === "email" ? mailC : devC;
const sb = { rpc: (f, a, o) => cur().rpc(f, a, o), from: t => cur().from(t), get auth() { return cur().auth; }, functions: { invoke: (n, o) => cur().functions.invoke(n, o) } };
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d) => (Math.round((+n || 0) * (d ? 100 : 1)) / (d ? 100 : 1)).toLocaleString("en-US", { maximumFractionDigits: d ? 2 : 0 }) + " ج.م";
const num = n => (+n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } };
const norm = s => String(s || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآا]/g, "ا").replace(/ة/g, "ه").replace(/[ىي]/g, "ي").replace(/\s+/g, " ").trim();
const UNITS = { piece: "قطعة", set: "طقم", meter: "متر", dozen: "دستة" };
const KINDS = { admin: "إدارة", cashier: "كاشير", warehouse: "جهاز المخزن", custom: "مخصص" };

/* ---------- server error codes → Arabic ---------- */
const ERR = {
  COUNT_RUNNING: "فيه جرد شغّال في المكان ده خلاص.", COUNT_CLOSED: "الجرد ده مش مفتوح للعدّ دلوقتي.", STAFF_REQUIRED: "اختار الموظفين اللي هيجردوا.", NOT_IN_RECOUNT: "الصنف ده مش في قايمة إعادة العدّ.", COUNT_NOT_ENDED: "أنهِ العدّ الأول.", DECISION_REQUIRED: "حدّد هتحسب إزاي الصنف اللي اتعدّ من أكتر من موظف", NOTHING_TO_RECOUNT: "مفيش فروق تتعدّ تاني.",
  RESERVED_STOCK: "الصنف ده محجوز لعميل", DEPOSIT_REQUIRED: "اكتب العربون.", DEPOSIT_MORE_THAN_TOTAL: "العربون أكبر من قيمة الحجز.", DEPOSIT_MISMATCH: "العربون لازم يتخصم كله", RESERVATION_CLOSED: "الحجز ده اتقفل قبل كده.", CUSTOMER_REQUIRED: "اكتب اسم العميل وموبايل صحيح.",
  COUPON_NOT_FOUND: "الكوبون ده مش موجود.", COUPON_NOT_ACTIVE: "الكوبون ده مش شغّال دلوقتي.", COUPON_USED_UP: "الكوبون ده خلص عدد مرات استخدامه.", COUPON_NEEDS_CUSTOMER: "الكوبون ده لعميل واحد مرة واحدة — اكتب موبايل العميل الأول.", COUPON_ALREADY_USED: "العميل ده استخدم الكوبون قبل كده.", COUPON_MIN: "الكوبون محتاج فاتورة أكبر — أقل قيمة", BAD_COUPON_CODE: "كود الكوبون من 3 لـ 20 حرف إنجليزي أو رقم.",
  CODE_TAKEN: "الكود ده مستخدم على صنف تاني", KIT_SERIAL: "الأصناف اللي بمسلسل ما تدخلش في طقم.", KIT_IS_PART: "الصنف ده قطعة في طقم تاني — مينفعش يبقى طقم.", KIT_SELF: "الطقم مينفعش يكون قطعة في نفسه.", KIT_NESTED: "مينفعش تحط طقم جوه طقم", KIT_NO_PARTS: "الطقم ده مالوش قطع.", SAME_ITEM: "اختار صنف غير الصنف القديم.", OFFER_ALREADY_CANCELLED: "العرض على الصنف ده اتلغى في مرتجع قبل كده — اعمل مرتجع عادي.",
  OFFER_RETURN_BLOCKED: "المرتجع ده من عرض على مجموعة: لو رجع القطعة دي لوحدها الخصم هيتلغي على الباقي والعميل هيبقى عليه فلوس. خلّيه يرجّع العرض كله أو يبدّل القطعة بقطعة تانية.", BAD_LINK: "فيه لينك مش مظبوط — اتأكد إنه بيبدأ بـ https:// والأرقام صح.", NO_RECIPIENTS: "مفيش عملاء ليهم موبايل في الاختيار ده.", MESSAGE_REQUIRED: "اكتب الرسالة.", NAME_TAKEN: "الاسم ده مستخدم قبل كده.",
  WRONG_PIN: "الرمز غلط.", USE_EMAIL: "الجهاز ده جهاز شخصي — ادخل بالإيميل والباسورد.", NEED_PASSWORD: "ادخل بالإيميل والباسورد تاني.", EMAIL_DISABLED: "الدخول بالإيميل مقفول لحسابك — كلّم المالك.", PENDING: "حسابك لسه مستني المالك يفعّله.",
  BAD_EMAIL: "الإيميل مش مظبوط.", WEAK_PASSWORD: "الباسورد لازم يكون 8 حروف أو أكتر.", EMAIL_TAKEN: "الإيميل ده عليه حساب قبل كده.", ALREADY_LINKED: "الموظف ده مربوط بإيميل خلاص.", NOT_LINKED: "الموظف ده مش مربوط بإيميل.",
  STAFF_INACTIVE: "الموظف موقوف.", TOO_MANY: "طلبات كتير — جرّب بعد ساعة.", AUTH_ERROR: "حصلت مشكلة في عمل الحساب — جرّب تاني.", NAME_REQUIRED: "اكتب الاسم.", BAD_VALUE: "القيمة مش مظبوطة.",
  "Invalid login credentials": "الإيميل أو الباسورد غلط.", LOCKED: "الجهاز اتقفل بعد 5 محاولات غلط. جرّب بعد 5 دقايق.", WRONG_LOCATION: "الرمز ده لموظف في فرع تاني.",
  SESSION_EXPIRED: "انتهت الجلسة — ادخل برمزك تاني.", DEVICE_NOT_APPROVED: "الجهاز لسه مستني الاعتماد.", DEVICE_NOT_REGISTERED: "الجهاز مش متسجّل.",
  PIN_LENGTH: "الرمز الرقمي من ٤ لـ ٨ أرقام.", PIN_REPEATED: "مينفعش كل الأرقام تبقى زي بعض.", PIN_SEQUENCE: "مينفعش أرقام متسلسلة زي ١٢٣٤.",
  PASSWORD_WEAK: "كلمة السر ٦ حروف على الأقل وفيها حروف وأرقام.", PIN_TAKEN: "الرمز ده مستخدم عند موظف تاني — اختار غيره.",
  ESCALATION: "مينفعش تدّي دور أعلى من صلاحيتك.", OUT_OF_SCOPE: "ده خارج الفرع بتاعك.", LAST_OWNER: "مينفعش تلغي آخر حساب مالك.",
  ONLY_OWNER_CREATES_OWNER: "المالك بس اللي يضيف مالك.", ONLY_OWNER_EDITS_OWNER: "المالك بس اللي يعدّل حساب المالك.", ALREADY_SET_UP: "النظام متهيّأ قبل كده.",
  NAME_REQUIRED: "الاسم مطلوب.", BAD_EAN13: "رقم الفحص في باركود EAN-13 غلط.", IMPORT_HAS_ERRORS: "الملف فيه أخطاء — صلّحها الأول.",
  OPENING_AFTER_MOVES: "مينفعش تستورد أرصدة أول المدة لمكان اتعمل فيه حركات.", EDITED_BY_SOMEONE_ELSE: "حد تاني عدّل الصنف ده بعد ما فتحته — افتحه تاني.",
  NO_OPEN_SHIFT: "مفيش وردية مفتوحة على درج الجهاز ده.", PLAN_REQUIRED: "اختار خطة التقسيط.", CUSTOMER_REQUIRED: "لازم اسم العميل وموبايله.", APPROVER_NOT_VALID: "رمز الموافقة غلط أو صلاحيته مش كفاية.",
  RETURN_MORE_THAN_SOLD: "الكمية أكتر من اللي اتباع (أو رجع قبل كده).", HAS_RETURNS: "الفاتورة عليها مرتجع — مينفعش تتلغي كلها.", INSTALMENT_SETTLED: "شركة التقسيط حوّلت فلوس الفاتورة دي — مينفعش تتلغي.",
  REASON_REQUIRED: "اكتب السبب.", REF_REQUIRED: "اكتب رقم التحويل.", HELD_ALREADY_TAKEN: "الفاتورة دي اتسترجعت قبل كده.", SELLER_CANNOT_COLLECT: "البائع بيبعت الفاتورة للكاشير — مش بيقبض.",
  INSUFFICIENT_STOCK: "الرصيد مش كفاية", SERIAL_NOT_AVAILABLE: "المسلسل ده مش متاح في المعرض", DAY_CLOSING_WINDOW: "اليوم في وقت التقفيل — البيع مقفول لحد ميعاد الفتح.", UNDERPAID: "المدفوع أقل من المطلوب.",
  PRICE_DIFF: "السعر مختلف كتير عن آخر سعر — اختار السبب", SERIALS_REQUIRED: "عدد المسلسلات لازم يساوي الكمية", SERIAL_EXISTS: "المسلسل ده متسجّل قبل كده", SUPPLIER_REQUIRED: "اختار المورد.",
  MORE_THAN_BALANCE: "المبلغ أكتر من رصيد المورد", NEEDS_OWNER: "المبلغ فوق حدّك — محتاج رمز المالك", CHEQUE_DETAILS: "الشيك محتاج رقم وتاريخ.", NO_REPLACEMENT_IN_STOCK: "مفيش جهاز بديل في المخزون — اختار «نستلم ونبعته».",
  SOLD_DATE_REQUIRED: "اكتب تاريخ البيع.", PROBLEM_REQUIRED: "اكتب العطل.", BAD_STATUS: "الحالة مش مسموح تتغيّر كده.", EMPTY_INVOICE: "ضيف صنف.", BAD_AMOUNT: "المبلغ غلط.",
  OFFER_OVERLAP: "فيه عرض تاني شغّال بنفس الأولوية على نفس الأصناف في نفس الوقت", BELOW_COST_NEEDS_OWNER: "العرض بيبيع تحت التكلفة — محتاج المالك أو المدير العام.", OFFER_TARGET_REQUIRED: "اختار الأصناف أو المجموعات أو الأقسام اللي عليها العرض.", BUNDLE_NEEDS_ITEMS: "الطقم محتاج صنفين على الأقل وسعر.", GIFT_REQUIRED: "اختار الهدية.", BAD_DATES: "المواعيد غلط — النهاية لازم بعد البداية.", BAD_OFFER: "نوع العرض مش مناسب للاختيار ده.",
  NOT_BALANCED: "القيد مش متوازن — المدين لازم يساوي الدائن.", BAD_IMAGE: "الملف لازم يكون صورة PNG أو JPG أو WebP.", IMAGE_TOO_BIG: "الصورة كبيرة — جرّب صورة أصغر.", LINE_BOTH_SIDES: "السطر الواحد يا مدين يا دائن.", NOT_LEAF_ACCOUNT: "اختار حساب فرعي مش مجموعة.", PERIOD_CLOSED: "الشهر ده مقفول.", MEMO_REQUIRED: "اكتب البيان.", CANNOT_APPROVE_OWN: "مينفعش تعتمد قيد إنت اللي كتبته.", ONLY_OWNER: "المالك بس اللي يعمل ده.", YEAR_CLOSED: "السنة دي مقفولة.", BAD_RIN: "رقم التسجيل الضريبي ٩ أرقام.", VAT_FROM_REQUIRED: "حدد تاريخ بداية الضريبة.",
  BAD_QTY: "الكمية غلط.", DISCOUNT_NEEDS_APPROVAL: "الخصم فوق حدّك — محتاج رمز مدير.", OVERPAID_NON_CASH: "الفيزا والمحافظ أكتر من المطلوب.", BAD_DISCOUNT: "الخصم غلط.", NOT_FOUND: "مش موجود.",
  CANNOT_DISABLE_OWN_DEVICE: "مينفعش توقف الجهاز اللي شغال عليه.", NOT_SET_UP: "النظام لسه ما اتهيّأش.",
  ITEM_LOCKED: "الصنف مقفول للبيع دلوقتي", PAYROLL_CLOSED: "مرتبات الشهر ده اتعتمدت — الحضور والمرتبات اتقفلوا.", ALREADY_OUT: "إنت سجّلت انصرافك النهارده.", EMPTY_PAYROLL: "مفيش مرتبات تتعتمد — احسبها الأول.", NEGATIVE_NET: "فيه موظف صافي مرتبه بالسالب — راجع الخصومات والسلف.",
  LOYALTY_OFF: "برنامج الولاء متوقف.", TREASURY_OR_BANK: "اختار الخزنة الرئيسية أو حساب بنك — مش درج كاشير.", PARTNER_REQUIRED: "اختار الشريك.", SHARES_OVER_100: "مجموع نسب الشركاء أكتر من ١٠٠٪.", OPENING_LOCKED: "الأرصدة الافتتاحية معتمدة ومقفولة.", VAT_OFF: "الضريبة مش متفعّلة.", NEEDS_OWNER_PIN: "محتاج رمز المالك.", BASE_ROLE: "الأدوار الأساسية مبتتحذفش — ممكن تعدّلها.", ROLE_IN_USE: "فيه موظفين على الدور ده — انقلهم لدور تاني الأول.",
  CONFIRM_REQUIRED: "اكتب كلمة التأكيد زي ما هي.", BAD_BACKUP: "الملف ده مش نسخة احتياطية من SYS Minzo.", PREVIEW_MODE: "إنت في وضع المعاينة — مفيش حفظ. اخرج من المعاينة الأول.",
  DAY_CLOSED: "اليوم ده اتقفل للمعرض — مفيش بيع ولا مصروفات عليه إلا لو المالك فتحه تاني.", ALREADY_CLOSED: "اليوم ده متقفل قبل كده.", SHIFT_STILL_OPEN: "فيه وردية لسه مفتوحة — لازم تتسلّم الأول.",
  SHIFTS_NOT_APPROVED: "فيه تسليم وردية مستني اعتماد — اعتمده الأول من «الخزنة والورديات».", DRAWER_OTHER_LOCATION: "الدرج ده تبع معرض تاني.", PHONE_TAKEN: "الموبايل ده متسجّل لعميل تاني.",
  MORE_THAN_POINTS: "النقاط أكتر من رصيد العميل.", ADDRESS_REQUIRED: "اكتب العنوان.", DRIVER_REQUIRED: "اكتب اسم المندوب.", NOT_HANDED: "الوردية لسه ما اتسلّمتش.", CANNOT_APPROVE_OWN_SHIFT: "مينفعش تعتمد ورديتك."
};
function errText(e) {
  const m = String((e && (e.message || e.error_description || e.error)) || e || "");
  if (/duplicate key.*barcode/.test(m)) return "الباركود ده موجود على صنف تاني.";
  if (/duplicate key.*code/.test(m)) return "الكود ده موجود على صنف تاني.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "مفيش اتصال بالإنترنت.";
  if (/Anonymous sign-ins are disabled/i.test(m)) return "تسجيل الأجهزة مقفول في Supabase — لازم يتفعّل «Anonymous sign-ins».";
  const k = m.split(":")[0].trim();
  if (k.startsWith("NOT_ALLOWED")) return "مش مسموح لدورك.";
  if (ERR[k] && m.includes(":") && ["OFFER_OVERLAP", "ITEM_LOCKED", "INSUFFICIENT_STOCK", "SERIAL_NOT_AVAILABLE", "PRICE_DIFF", "SERIALS_REQUIRED", "SERIAL_EXISTS", "MORE_THAN_BALANCE", "NEEDS_OWNER"].includes(k)) return ERR[k] + ": " + m.split(":").slice(1).join(":");
  return ERR[k] || m;
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) {
    if (/SESSION_EXPIRED/.test(error.message)) { lockNow(); }
    throw error;
  }
  return data;
}
const T = () => S.sess && S.sess.token;

/* ---------- state ---------- */
const S = { sess: null, route: ls("minzo-route") || "dash", locs: [], depts: [], groups: [], items: [], stock: [], store: null, idle: 0,
  q: "", dep: "all", stockLoc: "all", imp: null };
const role = () => (S.sess && S.sess.role) || {};
const can = (mod, act) => { const p = role().perms || {}; const s = p[mod] != null ? p[mod] : (p["*"] || ""); return s.includes(act || "v"); };
const has = k => { const s = role().sens || []; return s.includes("*") || s.includes(k); };
const seeCost = () => !role().hide_cost;
const locName = id => (S.locs.find(l => l.id === id) || {}).name || "—";

/* ---------- icons ---------- */
const IC = {
  count: "M4 4h16v16H4zM8 8h3M8 12h8M8 16h5M15 7l1.5 1.5L19 6",
  reserve: "M6 3h12v18l-6-4-6 4zM9 8h6M9 12h4",
  dash: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z", items: "M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10",
  io: "M7 3v14M3 7l4-4 4 4M17 21V7M21 17l-4 4-4-4", stock: "M3 21V8l9-5 9 5v13M7 21v-8h10v8M7 17h10",
  users: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6zM9 12l2 2 4-4", devices: "M3 4h13v10H3zM7 18h5M9.5 14v4M18 8h3v12h-5v-3",
  pos: "M3 4h18v12H3zM8 20h8M12 16v4M7 8h4M7 12h6", lock: "M6 11h12v10H6zM8 11V7a4 4 0 018 0v4", plus: "M12 5v14M5 12h14",
  transfers: "M4 7h13l-3-3M20 17H7l3 3", cash: "M2 6h20v12H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 12h.01M18 12h.01",
  inst: "M3 6h18v12H3zM3 10h18M7 15h3M14 15h3", suppliers: "M1 4h14v12H1zM15 8h4l3 3v5h-7M5.5 19a2 2 0 100-.01M18.5 19a2 2 0 100-.01", svc: "M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  gl: "M4 4h16v16H4zM4 9h16M9 9v11M14 13h3M14 16h3", commission: "M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6", offers: "M20 12l-8 8-9-9V3h8zM7.5 7.5h.01", settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  close: "M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9", expense: "M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2zM8 8h8M8 12h8M8 16h5",
  returns: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3", customers: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8",
  delivery: "M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", print: "M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z",
  staff: "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0M18 3v4M16 5h4", reports: "M3 3v18h18M7 15l4-4 3 3 5-6", basis: "M12 3v18M5 8h14M5 8l-2 6h4zM19 8l-2 6h4z", flow: "M3 12h4l3-8 4 16 3-8h4", capital: "M3 21h18M5 21V10l7-6 7 6v11M9 21v-6h6v6", opening: "M4 4h16v16H4zM4 10h16M10 10v10",
  taxinv: "M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6", einv: "M4 4h16v12H4zM8 20h8M12 16v4M8 9l3 3 5-5", avail: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z", roles: "M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6zM9 11h6M9 15h4", audit: "M9 11l3 3L22 4M3 5h4M3 12h4M3 19h18",
  backup: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3", export: "M12 3v12M7 8l5-5 5 5M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4",
  menu: "M3 6h18M3 12h18M3 18h18", moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z", out: "M15 3h5v18h-5M10 17l5-5-5-5M15 12H3"
};
const ico = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[k]}"/></svg>`;
const MARK = `<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M34 104V58a26 26 0 0 1 52 0v46M18 104h84M46 104V84a14 14 0 0 1 28 0v20"/></svg>`;

/* ---------- toasts & modal ---------- */
function toast(m, bad) { const d = document.createElement("div"); d.className = "toast"; if (bad) d.style.borderColor = "var(--bad)"; d.textContent = m; $("#toasts").appendChild(d); setTimeout(() => { d.style.transition = "opacity .4s"; d.style.opacity = "0"; setTimeout(() => d.remove(), 400); }, 3600); }
function modal(html) { closeModal(); const m = document.createElement("div"); m.id = "modal"; m.innerHTML = `<div class="box" role="dialog" aria-modal="true">${html}</div>`; m.addEventListener("click", e => { if (e.target === m) closeModal(); }); document.body.appendChild(m); const f = m.querySelector("input,select"); if (f) f.focus(); }
function closeModal() { const m = $("#modal"); if (m) m.remove(); }
const busy = (el, on) => { if (!el) return; el.disabled = on; el.dataset.t = el.dataset.t || el.innerHTML; el.innerHTML = on ? "…" : el.dataset.t; };

/* =====================================================================
   GATE: device account → first run / registration / approval → PIN
   ===================================================================== */
const LOGO = () => (S.store && S.store.logo_url) || "";
const logoImg = (h, extra) => LOGO() ? `<img src="${LOGO()}" alt="" style="height:${h};max-width:100%;object-fit:contain;${extra || ""}">` : "";
let gateLogo = ""; try { gateLogo = localStorage.getItem("mz.logo") || ""; } catch (e) {}
function gate(html) { $("#app").hidden = true; const g = $("#gate"); g.hidden = false; g.innerHTML = `<div class="gbox"><div class="mark">${gateLogo ? `<img src="${gateLogo}" alt="" style="width:100%;height:100%;object-fit:contain">` : MARK}</div>${html}</div>`; const f = g.querySelector("input"); if (f) f.focus(); }

async function boot() {
  gate(`<h1>SYS Minzo</h1><p class="sub">جاري التحميل…</p><div class="spin"></div>`);
  try {
    const { data: { session: ms } } = await mailC.auth.getSession();
    if (ms && ms.user && !ms.user.is_anonymous) { MODE = "email"; return emailFlow(); }
    MODE = "device";
    let { data: { session } } = await sb.auth.getSession();
    if (!session) { const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; }
    const st = await rpc("setup_status");
    if (!st.setup_done) return firstRun();
    if (!st.device) return registerDevice();
    if (!st.device.active) return pendingDevice(st.device);
    S.storeName = st.store;
    lockScreen();
  } catch (e) {
    gate(`<h1>SYS Minzo</h1><p class="sub">مش قادر يوصل للسيرفر</p><div class="gerr">${esc(errText(e))}</div><button class="btn gold" style="width:100%;margin-top:12px" id="retry">حاول تاني</button>`);
    $("#retry").onclick = boot;
  }
}

function firstRun() {
  gate(`<h1>أهلًا بيك</h1><p class="sub">أول تشغيل للنظام: هنسجّل المحل وحساب المالك، والجهاز ده هيبقى جهاز الإدارة.</p>
  <div class="stack">
   <div class="field"><label>اسم المحل</label><input class="inp" id="fStore" placeholder="مثال: معرض المنزل الحديث"></div>
   <div class="field"><label>اسم الجهاز ده</label><input class="inp" id="fDev" value="كمبيوتر الإدارة"></div>
   <div class="field"><label>اسم المالك</label><input class="inp" id="fOwner"></div>
   <div class="field"><label>رمز المالك (٤–٨ أرقام، أو كلمة سر فيها حروف وأرقام)</label><input class="inp num" id="fPin" type="password" autocomplete="new-password"></div>
   <div class="field"><label>تأكيد الرمز</label><input class="inp num" id="fPin2" type="password" autocomplete="new-password"></div>
   <button class="btn gold" id="fGo">تهيئة النظام</button><div class="gerr" id="fErr"></div>
  </div><p class="gnote">الرمز ده هو مفتاح المالك لكل الموافقات. احفظه في مكان آمن.</p>`);
  $("#fGo").onclick = async e => {
    const store = $("#fStore").value.trim(), dev = $("#fDev").value.trim(), owner = $("#fOwner").value.trim(), p = $("#fPin").value, p2 = $("#fPin2").value;
    if (!store || !dev || !owner) return ($("#fErr").textContent = "املا كل الخانات.");
    if (p !== p2) return ($("#fErr").textContent = "الرمزين مش زي بعض.");
    busy(e.target, true);
    try { await rpc("setup_first_run", { p_store_name: store, p_device_name: dev, p_owner_name: owner, p_owner_pin: p }); toast("النظام اتهيّأ. ادخل برمز المالك."); S.storeName = store; lockScreen(); }
    catch (er) { $("#fErr").textContent = errText(er); busy(e.target, false); }
  };
}

function registerDevice() {
  gate(`<h1>تسجيل جهاز جديد</h1><p class="sub">اكتب اسم الجهاز، وبعدها المالك أو المدير العام يعتمده من شاشة «الأجهزة».</p>
  <div class="stack"><div class="field"><label>اسم الجهاز</label><input class="inp" id="dName" placeholder="مثال: كاشير المعرض الأول"></div>
  <button class="btn gold" id="dGo">إرسال طلب التسجيل</button><div class="gerr" id="dErr"></div></div><button class="btn ghost" style="width:100%;margin-top:10px" id="toMail">دخول الإدارة بالإيميل</button>`);
  $("#toMail").onclick = () => emailForm();
  $("#dGo").onclick = async e => {
    const n = $("#dName").value.trim(); if (!n) return ($("#dErr").textContent = "اكتب اسم الجهاز.");
    busy(e.target, true);
    try { const d = await rpc("device_register", { p_name: n }); pendingDevice({ name: n, id: d.id }); } catch (er) { $("#dErr").textContent = errText(er); busy(e.target, false); }
  };
}

function pendingDevice(d) {
  gate(`<h1>في انتظار الاعتماد</h1><p class="sub">الجهاز «${esc(d.name)}» اتسجّل. اطلب من المالك أو المدير العام يعتمده من شاشة «الأجهزة» ويحدد مكانه.</p>
  <div class="okbox" style="text-align:center">رقم الجهاز: <b class="num">${esc(String(d.id || "").slice(0, 8))}</b></div>
  <button class="btn gold" style="width:100%;margin-top:14px" id="pChk">اتعتمد؟ تحقق تاني</button><button class="btn ghost" style="width:100%;margin-top:10px" id="toMail">دخول الإدارة بالإيميل</button>`);
  $("#pChk").onclick = boot; $("#toMail").onclick = () => emailForm();
}

let pinBuf = "";
function lockScreen(msg) {
  S.sess = null; window.__mzTok = null; pinBuf = "";
  if (MODE === "email" && !(S.mail && S.mail.status === "link")) return mailLock(msg);
  const em = MODE === "email", sub = em ? (S.mail && S.mail.status === "link" ? `أول مرة بالإيميل: اكتب رمزك في مينزو علشان نربط الحساب ده بيك` : `${esc((S.mail && S.mail.name) || "")} — اكتب رمزك`) : "اكتب رمزك عشان تدخل";
  gate(`<h1>${esc(S.storeName || "SYS Minzo")}</h1><p class="sub">${sub}</p>${em ? `<p class="gnote" style="margin-top:-6px">${esc(S.mail && S.mail.email || "")} · جهاز شخصي</p>` : ""}
  <div class="pinrow" id="pinDots">${"<i></i>".repeat(4)}</div>
  <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join("")}<button class="fn" data-k="pw">كلمة سر</button><button data-k="0">0</button><button class="fn" data-k="del">مسح</button></div>
  <div class="gerr" id="pErr">${esc(msg || "")}</div>${em ? `<button class="btn ghost" style="width:100%;margin-top:10px" id="mailOut">خروج من الإيميل</button>` : `<button class="btn ghost" style="width:100%;margin-top:10px" id="toMail">دخول الإدارة بالإيميل</button>`}`);
  if (em) $("#mailOut").onclick = mailSignOut; else $("#toMail").onclick = () => emailForm();
  $("#gate .pad").onclick = e => { const b = e.target.closest("button"); if (!b) return; const k = b.dataset.k;
    if (k === "del") pinBuf = pinBuf.slice(0, -1); else if (k === "pw") return passwordLogin(); else if (pinBuf.length < 8) pinBuf += k;
    drawDots(); if (pinBuf.length >= 4) clearTimeout(S._pt), S._pt = setTimeout(() => tryLogin(pinBuf), pinBuf.length >= 6 ? 50 : 700); };
}
function drawDots() { const n = Math.max(4, pinBuf.length); $("#pinDots").innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pinBuf.length ? "f" : ""}"></i>`).join(""); }
document.addEventListener("keydown", e => { if ($("#gate").hidden || !$("#pinDots")) return; if (/^\d$/.test(e.key) && pinBuf.length < 8) { pinBuf += e.key; drawDots(); } else if (e.key === "Backspace") { pinBuf = pinBuf.slice(0, -1); drawDots(); } else if (e.key === "Enter" && pinBuf.length >= 4) tryLogin(pinBuf); });
function passwordLogin() { gate(`<h1>الدخول بكلمة السر</h1><div class="stack"><input class="inp" id="pw" type="password" autocomplete="current-password"><button class="btn gold" id="pwGo">دخول</button><button class="btn ghost" id="pwBack">رجوع للأرقام</button><div class="gerr" id="pErr"></div></div>`);
  $("#pwGo").onclick = () => tryLogin($("#pw").value); $("#pwBack").onclick = () => lockScreen(); $("#pw").onkeydown = e => { if (e.key === "Enter") tryLogin($("#pw").value); }; }
async function tryLogin(p) {
  if (S._logging) return; S._logging = true;
  try {
    const r = await rpc(MODE === "email" ? "email_pin_login" : "staff_login", { p_pin: p });
    if (r.error && MODE === "email" && ["NEED_PASSWORD", "EMAIL_DISABLED", "NO_EMAIL"].includes(r.error)) { await mailC.auth.signOut().catch(() => {}); MODE = "device"; return emailForm(errText(r.error)); }
    if (r.error) { pinBuf = ""; if ($("#pinDots")) drawDots();
      const t = r.error === "WRONG_PIN" ? `الرمز غلط — فاضل ${r.left} محاولات قبل القفل.` : r.error === "LOCKED" ? `الجهاز مقفول لحد ${new Date(r.until).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}.` : errText(r.error);
      $("#pErr").textContent = t; return; }
    await afterLogin(r);
  } catch (e) { $("#pErr").textContent = errText(e); pinBuf = ""; if ($("#pinDots")) drawDots(); }
  finally { S._logging = false; }
}
async function afterLogin(r) {
  S.sess = r; window.__mzTok = r.token; S.idle = Date.now(); S.dir = null; S.cash = null; S.tr = null; P.shift = undefined; setTimeout(qFlush, 1500);
  if (r.staff.must_change) return changePin(true);
  if (MODE === "email") S.mail = Object.assign(S.mail || {}, { status: "ready", name: r.staff.name });
  if (MODE === "email" && r.staff.must_change_pw) return changePassword(true);
  await enterApp();
}
/* email device: the password alone opens the system (no PIN). Locked or reopened → type the password again */
async function pwEnter(msg) {
  const r = await rpc("email_password_login");
  if (r.error === "NEED_PASSWORD") return mailLock(msg);
  if (r.error === "NOT_LINKED") return emailFlow();
  if (r.error) { await mailC.auth.signOut().catch(() => {}); MODE = "device"; return emailForm(errText(r.error)); }
  await afterLogin(r);
}
function mailLock(msg) {
  S.sess = null; window.__mzTok = null;
  const em = (S.mail && S.mail.email) || "";
  gate(`<h1>${esc(S.storeName || "SYS Minzo")}</h1><p class="sub">${esc((S.mail && S.mail.name) || "")} — اكتب الباسورد</p><p class="gnote" style="margin-top:-6px" dir="ltr">${esc(em)}</p>
  <div class="stack"><input class="inp" id="lPw" type="password" autocomplete="current-password" dir="ltr" placeholder="الباسورد"><button class="btn gold" id="lGo">دخول</button><div class="gerr" id="pErr">${esc(msg || "")}</div>
  <button class="btn ghost" id="mailOut">خروج من الإيميل</button></div>`);
  $("#mailOut").onclick = mailSignOut;
  const go = async () => { const password = $("#lPw").value; if (!password) return ($("#pErr").textContent = "اكتب الباسورد.");
    if (S._logging) return; S._logging = true; busy($("#lGo"), true);
    try { const { error } = await mailC.auth.signInWithPassword({ email: em, password });
      if (error) { busy($("#lGo"), false); $("#lPw").value = ""; return ($("#pErr").textContent = errText(error)); }
      S._logging = false; await pwEnter(); }
    catch (e) { busy($("#lGo"), false); $("#pErr").textContent = errText(e); }
    finally { S._logging = false; } };
  $("#lGo").onclick = go; $("#lPw").onkeydown = e => { if (e.key === "Enter") go(); }; setTimeout(() => { const i = $("#lPw"); if (i) i.focus(); }, 50);
}
function changePin(forced) {
  const h = `<h1>${forced ? "اختار رمزك الخاص" : "تغيير الرمز"}</h1><p class="sub">${forced ? "الرمز ده مؤقت — لازم تختار رمز جديد قبل ما تكمّل." : ""}</p><div class="stack">
   <div class="field"><label>الرمز الحالي</label><input class="inp num" id="cOld" type="password"></div>
   <div class="field"><label>الرمز الجديد</label><input class="inp num" id="cNew" type="password" autocomplete="new-password"></div>
   <div class="field"><label>تأكيد الرمز الجديد</label><input class="inp num" id="cNew2" type="password" autocomplete="new-password"></div>
   <button class="btn gold" id="cGo">حفظ</button>${forced ? "" : `<button class="btn ghost" id="cCancel">إلغاء</button>`}<div class="gerr" id="cErr"></div></div>`;
  if (forced) gate(h); else modal(h.replace("<h1>", "<h2>").replace("</h1>", "</h2>").replace('class="gerr"', 'class="gerr" style="color:var(--bad)"'));
  const root = forced ? $("#gate") : $("#modal");
  root.querySelector("#cGo").onclick = async e => {
    const o = root.querySelector("#cOld").value, n = root.querySelector("#cNew").value, n2 = root.querySelector("#cNew2").value;
    if (n !== n2) return (root.querySelector("#cErr").textContent = "الرمزين الجداد مش زي بعض.");
    busy(e.target, true);
    try { await rpc("staff_change_pin", { p_token: T(), p_old: o, p_new: n }); toast("اتغيّر الرمز."); if (forced) { S.sess.staff.must_change = false; await enterApp(); } else closeModal(); }
    catch (er) { root.querySelector("#cErr").textContent = errText(er); busy(e.target, false); }
  };
  const c = root.querySelector("#cCancel"); if (c) c.onclick = closeModal;
}
function lockNow(msg) { if (MODE === "email") rpc("email_lock").catch(() => {}); else if (T()) rpc("staff_logout", { p_token: T() }).catch(() => {}); S.sess = null; window.__mzTok = null; closeModal(); lockScreen(msg); }
const lockMin = () => { const m = S.store && S.store.auto_lock_min; return m == null ? 10 : +m; };
setInterval(() => { const m = lockMin(); if (S.sess && m > 0 && Date.now() - S.idle > m * 60 * 1000) lockNow(`اتقفل تلقائي بعد ${m} دقيقة من غير استخدام.`); }, 20000);

/* ---------- email sign-in (a personal phone or laptop, no device approval) ---------- */
async function emailFlow(msg) {
  try {
    const { data: { session } } = await mailC.auth.getSession(); S.mail = { email: session && session.user && session.user.email };
    const r = await rpc("email_session"); Object.assign(S.mail, r);
    if (r.status === "ready" || r.status === "link") { const st = await devC.rpc("setup_status").then(x => x.data).catch(() => null); if (st && st.store) S.storeName = st.store; return r.status === "ready" ? pwEnter(msg) : lockScreen(msg); }
    if (r.status === "pending") return gate(`<h1>حسابك مستني التفعيل</h1><p class="sub">الحساب ${esc(S.mail.email || "")} اتعمل. المالك أو المدير العام لازم يربطه باسمك ويفعّله من شاشة المستخدمين.</p><button class="btn gold" style="width:100%" id="mChk">اتفعّل؟ تحقق تاني</button><button class="btn ghost" style="width:100%;margin-top:10px" id="mOwn">أنا المالك أو المدير العام — اربط برمزي</button><button class="btn ghost" style="width:100%;margin-top:10px" id="mailOut">خروج</button>`), $("#mChk").onclick = () => emailFlow(), $("#mOwn").onclick = () => { S.mail.status = "link"; lockScreen(); }, $("#mailOut").onclick = mailSignOut;
    if (r.status === "disabled") return gate(`<h1>الدخول بالإيميل مقفول</h1><p class="sub">الدخول بالإيميل مقفول لحسابك. كلّم المالك أو المدير العام.</p><button class="btn ghost" style="width:100%" id="mailOut">خروج</button>`), $("#mailOut").onclick = mailSignOut;
    if (r.status === "need_password") return mailLock(msg);
    await mailC.auth.signOut().catch(() => {}); MODE = "device"; return emailForm("");
  } catch (e) { gate(`<h1>SYS Minzo</h1><p class="sub">مش قادر يوصل للسيرفر</p><div class="gerr">${esc(errText(e))}</div><button class="btn gold" style="width:100%;margin-top:12px" id="retry">حاول تاني</button>`); $("#retry").onclick = boot; }
}
async function mailSignOut() { if (T()) await rpc("staff_logout", { p_token: T() }).catch(() => {}); S.sess = null; window.__mzTok = null; await mailC.auth.signOut().catch(() => {}); MODE = "device"; S.mail = null; boot(); }
function emailForm(msg) {
  gate(`<h1>دخول الإدارة بالإيميل</h1><p class="sub">من أي موبايل أو لابتوب. بالإيميل والباسورد بس — من غير رمز.</p>
  <div class="stack"><div class="field"><label>الإيميل</label><input class="inp" id="mEmail" type="email" autocomplete="username" dir="ltr"></div>
  <div class="field"><label>الباسورد</label><input class="inp" id="mPw" type="password" autocomplete="current-password" dir="ltr"></div>
  <button class="btn gold" id="mGo">دخول</button><div class="gerr" id="mErr">${esc(msg || "")}</div>
  <button class="btn ghost" id="mForgot">نسيت الباسورد؟</button><button class="btn ghost" id="mNew">عمل حساب جديد</button><button class="btn ghost" id="mBack">رجوع</button></div>`);
  const go = async () => { const email = $("#mEmail").value.trim(), password = $("#mPw").value; if (!email || !password) return ($("#mErr").textContent = "اكتب الإيميل والباسورد.");
    busy($("#mGo"), true);
    const { error } = await mailC.auth.signInWithPassword({ email, password });
    if (error) { busy($("#mGo"), false); return ($("#mErr").textContent = errText(error)); }
    MODE = "email"; emailFlow(); };
  $("#mGo").onclick = go; $("#mPw").onkeydown = e => { if (e.key === "Enter") go(); };
  $("#mForgot").onclick = () => { $("#mErr").textContent = "كلّم المالك أو المدير العام — بيعملك باسورد مؤقت جديد من شاشة المستخدمين."; };
  $("#mNew").onclick = signupForm; $("#mBack").onclick = boot;
}
function signupForm() {
  gate(`<h1>عمل حساب جديد</h1><p class="sub">الحساب هيفضل مستني لحد ما المالك أو المدير العام يربطه باسمك ويفعّله.</p>
  <div class="stack"><div class="field"><label>اسمك</label><input class="inp" id="nName"></div>
  <div class="field"><label>الإيميل</label><input class="inp" id="nEmail" type="email" autocomplete="username" dir="ltr"></div>
  <div class="field"><label>الباسورد (8 حروف أو أكتر)</label><input class="inp" id="nPw" type="password" autocomplete="new-password" dir="ltr"></div>
  <div class="field"><label>تأكيد الباسورد</label><input class="inp" id="nPw2" type="password" autocomplete="new-password" dir="ltr"></div>
  <button class="btn gold" id="nGo">عمل الحساب</button><div class="gerr" id="nErr"></div><button class="btn ghost" id="nBack">رجوع</button></div>`);
  $("#nBack").onclick = () => emailForm();
  $("#nGo").onclick = async e => { const name = $("#nName").value.trim(), email = $("#nEmail").value.trim(), pw = $("#nPw").value;
    if (!name || !email || !pw) return ($("#nErr").textContent = "املا كل الخانات."); if (pw !== $("#nPw2").value) return ($("#nErr").textContent = "الباسوردين مش زي بعض.");
    busy(e.target, true);
    try { await adminFn({ action: "signup", name, email, password: pw }); gate(`<h1>اتعمل الحساب</h1><p class="sub">الحساب ${esc(email)} مستني المالك أو المدير العام يفعّله. بعد التفعيل ادخل بالإيميل والباسورد.</p><button class="btn gold" style="width:100%" id="nOk">تمام</button>`); $("#nOk").onclick = () => emailForm(); }
    catch (er) { $("#nErr").textContent = errText(er); busy(e.target, false); } };
}
function changePassword(forced) {
  gate(`<h1>اختار باسورد جديد</h1><p class="sub">${forced ? "الباسورد ده مؤقت — لازم تختار باسورد جديد قبل ما تكمّل." : ""}</p><div class="stack">
   <div class="field"><label>الباسورد الجديد (8 حروف أو أكتر)</label><input class="inp" id="wNew" type="password" autocomplete="new-password" dir="ltr"></div>
   <div class="field"><label>تأكيد الباسورد</label><input class="inp" id="wNew2" type="password" autocomplete="new-password" dir="ltr"></div>
   <button class="btn gold" id="wGo">حفظ</button><div class="gerr" id="wErr"></div></div>`);
  $("#wGo").onclick = async e => { const n = $("#wNew").value; if (n.length < 8) return ($("#wErr").textContent = errText("WEAK_PASSWORD")); if (n !== $("#wNew2").value) return ($("#wErr").textContent = "الباسوردين مش زي بعض.");
    busy(e.target, true);
    const { error } = await mailC.auth.updateUser({ password: n });
    if (error) { busy(e.target, false); return ($("#wErr").textContent = errText(error)); }
    await rpc("email_pw_changed").catch(() => {}); S.sess.staff.must_change_pw = false; toast("اتغيّر الباسورد."); await enterApp(); };
}
/* account changes that need the master key go through the server function */
async function adminFn(body) { const { data, error } = await sb.functions.invoke("minzo-admin", { body: Object.assign({ token: T() }, body) }); if (error) throw error; if (data && data.error) throw new Error(data.error); return data; }
["click", "keydown", "touchstart"].forEach(ev => document.addEventListener(ev, () => { if (S.sess) S.idle = Date.now(); }, { passive: true }));

/* =====================================================================
   DATA
   ===================================================================== */
const MASKED = new Set(["items", "sale_lines", "return_lines", "stock_layers", "stock_moves", "purchase_lines"]);
async function q(table, sel, mod) { let x = MASKED.has(table) ? sb.rpc(table + "_v", {}, { get: true }).select(sel || "*") : sb.from(table).select(sel || "*"); if (mod) x = mod(x); const { data, error } = await x; if (error) throw error; return data; }
async function loadCore() {
  const [locs, depts, groups, store] = await Promise.all([q("locations", "*", x => x.order("id")), q("departments", "*", x => x.order("sort")), q("item_groups", "*", x => x.order("name")), q("store")]);
  S.locs = locs; S.depts = depts; S.groups = groups; S.store = store[0];
  gateLogo = (S.store && S.store.logo_url) || ""; try { if (gateLogo) localStorage.setItem("mz.logo", gateLogo); else localStorage.removeItem("mz.logo"); } catch (e) {}
}
async function loadItems() {
  const [items, stock, codes, parts] = await Promise.all([q("items", "*", x => x.eq("hidden", false).order("name").limit(5000)), q("stock", "*", x => x.limit(20000)),
    q("item_codes", "code,item_id", x => x.limit(20000)).catch(() => []), q("kit_parts", "kit_id,part_id,qty", x => x.limit(20000)).catch(() => [])]);
  S.items = items; S.stock = stock; S.codes = codes; S.kits = {};
  parts.forEach(k => (S.kits[k.kit_id] = S.kits[k.kit_id] || []).push({ part_id: k.part_id, qty: +k.qty }));
}
/* extra codes (Chinese / supplier) find the item too */
const codesOf = id => (S.codes || []).filter(c => c.item_id === id).map(c => c.code);
const srch = i => i.name + " " + (i.barcode || "") + " " + i.code + " " + codesOf(i.id).join(" ");
const byCode = v => S.items.find(i => i.barcode === v || i.code === v) || S.items.find(i => (S.codes || []).some(c => c.item_id === i.id && c.code.toLowerCase() === v.toLowerCase()));
const ownStock = (id, loc) => S.stock.filter(s => s.item_id === id && (loc == null || loc === "all" || s.location_id === +loc)).reduce((a, s) => a + (+s.qty || 0), 0);
/* a set's stock = packed sets + sets that can still be built from its pieces (per place) */
const kitBuild = (id, loc) => { const P2 = (S.kits || {})[id]; if (!P2 || !P2.length) return 0;
  const one = l => Math.max(0, Math.floor(Math.min(...P2.map(p => ownStock(p.part_id, l) / p.qty))));
  return loc == null || loc === "all" ? [...new Set(S.stock.map(s => s.location_id))].reduce((a, l) => a + one(l), 0) : one(loc); };
const stockOf = (id, loc) => ownStock(id, loc) + kitBuild(id, loc);

/* =====================================================================
   SHELL
   ===================================================================== */
const NAV = [["التشغيل", ["dash", "pos", "reserve", "count", "stock", "transfers", "delivery", "svc"]], ["المال", ["close", "expense", "cash", "inst", "gl", "reports", "basis", "flow", "capital", "opening", "taxinv", "einv", "staff", "commission"]], ["التجارة", ["items", "io", "avail", "suppliers", "offers", "returns", "customers"]], ["النظام", ["users", "roles", "devices", "print", "audit", "backup", "export", "settings"]]];
const NAME = { count: "الجرد", reserve: "الحجوزات وعروض الأسعار", staff: "الموظفين والمرتبات", reports: "التقارير المالية", basis: "الاستحقاق والنقدي", flow: "التدفق النقدي والسيولة", capital: "رأس مال المشروع", opening: "أرصدة أول المدة", taxinv: "الفواتير الضريبية", einv: "الفواتير الإلكترونية", avail: "ظهور الأصناف", roles: "الأدوار والصلاحيات", audit: "سجل التدقيق", backup: "النسخ الاحتياطي والتصفير", export: "التصدير", close: "التقفيل اليومي", expense: "إدخال المصروفات", returns: "المرتجعات", customers: "العملاء والولاء", delivery: "التوصيل والتركيب", print: "الطابعات والملصقات", gl: "الحسابات العامة", commission: "عمولات البائعين", offers: "العروض والخصومات", settings: "الإعدادات والضريبة", suppliers: "الموردين والمشتريات", svc: "الضمان والصيانة", inst: "شركات التقسيط", pos: "نقطة البيع", cash: "الخزنة والورديات", transfers: "التحويلات", dash: "لوحة التحكم", items: "الأصناف", io: "استيراد الأصناف والأرصدة", stock: "المخزون", users: "الموظفين والرموز", devices: "الأجهزة" };
const SUB = { count: "جرد كامل بالموبايل والباركود: كل موظف يعدّ مكانه من غير ما يشوف رصيد السيستم، والفروق تتراجع وتتسوّى بعد موافقتك.", reserve: "حجز أصناف للعميل بعربون لحد ما يكمّل، وعروض أسعار تتطبع وتتحوّل لفاتورة بعدين.", staff: "الحضور والانصراف بالرمز، والسلف، وحساب المرتبات بالعمولات وخصم التأخير والغياب، والاعتماد والصرف بقيودهم.", reports: "37 تقرير للمبيعات والأرباح والمخزون والموردين والخزنة والمصروفات والعملاء، والتنبؤ، والتقارير النهائية.", basis: "صافي الربح بأساس الاستحقاق مقابل النقدية الفعلية، وجسر بيشرح الفرق بند بند.", flow: "قائمة التدفقات النقدية، والنقدية في كل حساب، ومؤشرات السيولة، وتوقع ٣٠ يوم.", capital: "كل قرش في المكان: النقدية والبضاعة والمستحقات والأصول، ومصادر التمويل، والشركاء، والأصول الثابتة وإهلاكها.", opening: "الميزانية الافتتاحية يوم بداية التشغيل على السيستم — لازم تتوازن قبل الاعتماد.", taxinv: "فاتورة ضريبية A4 لأي فاتورة بيع، ببيانات المشتري ورقمه الضريبي.", einv: "الإيصال الإلكتروني (B2C) والفاتورة الإلكترونية (B2B) لمنظومة مصلحة الضرائب المصرية.", avail: "ظاهر أو مقفول أو مخفي — لكل صنف أو مجموعة أو قسم، لمعرض أو للكل، وبجدول بالتاريخ أو الأيام والساعات.", roles: "صلاحيات كل دور على كل شاشة وإجراء، والصلاحيات الحساسة والحدود، ومعاينة السيستم بعيون أي دور.", audit: "كل حركة في النظام بالقيمة قبل وبعد. السجل للقراءة بس، وكل سطر مربوط ببصمة اللي قبله.", backup: "نسخ احتياطي تلقائي كل ساعة وكل يوم، ونسخة يدوية مشفّرة تتنزّل على الجهاز، والاستعادة والتصفير للمالك بس.", export: "تصدير أي بيانات بالصيغة اللي تحتاجها، والبيانات الحساسة مقنّعة إلا بصلاحية ورمزك.", close: "تقفيل اليوم لكل معرض: ملخص المبيعات والمرتجعات، والورديات والفروق، والمصروفات والتوريد — وبعد التقفيل البيع على اليوم ده بيتقفل.", expense: "كل مصروف ببنده ومكانه ومصدر صرفه، وبيتقيّد لوحده في الحسابات. اللي فوق حدّك بيستنى موافقة المدير.", returns: "كل المرتجعات على الفواتير بالسبب والحالة وطريقة رد الفلوس، وتسجيل مرتجع جديد برقم الفاتورة.", customers: "العملاء ومشترياتهم ونقاط الولاء، والضمانات السارية، والبحث عن ضمان بالمسلسل.", delivery: "طلبات التوصيل والتركيب من الفاتورة لحد التسليم والتركيب، بمراحل واضحة.", print: "الطابعات وربطها بكل معرض وجهاز، وقالب الإيصال، ومحرر الملصقات وطباعتها.", gl: "القيود بتتعمل لوحدها من كل بيع وشراء وحركة خزنة ومخزون — ومعاها ميزان المراجعة وقائمة الدخل والمركز المالي.", commission: "عمولة كل بائع على صافي مبيعاته حسب القسم أو المجموعة أو الصنف، وشرايح التارجت الشهري.", offers: "خصومات وعروض بتتطبّق لوحدها على الكاشير، بأولوية ومن غير تجميع، ومع فحص الهامش قبل الحفظ.", settings: "بيانات المحل ومواعيد اليوم وتنبيهات الأسعار، وضريبة القيمة المضافة.", suppliers: "الموردين وكشوف حساباتهم، وفواتير الشراء اللي بتدخل البضاعة للمخزون بتكلفتها، والسداد.", svc: "تذاكر الضمان بالمسلسل: توجيه للتوكيل، أو استلام ومتابعة، أو استبدال فوري ومطالبة المورد — حسب قواعد كل ماركة.", inst: "البيع بالتقسيط عن طريق ValU وأمان وكونتكت وغيرهم: الخطط، ومين بيشيل العمولة، والمستحق عند كل شركة لحد ما تحوّل.", pos: "", cash: "رصيد الأدراج والخزنة، واعتماد تسليم الورديات، وفواتير الأيام الأخيرة وإلغاؤها.", transfers: "نقل البضاعة بين المعرضين والمخزن بطلب واعتماد وشحن واستلام.", dash: "نظرة سريعة على الأصناف والمخزون في كل مكان.", items: "كل صنف بباركوده ووحدته وسعره، ومسلسل وضمان للأجهزة.", io: "استورد الأصناف من Excel أو CSV بأي شكل أعمدة، ومعاها أرصدة أول المدة.", stock: "رصيد كل صنف في المعرضين والمخزن.", users: "ضيف موظفين وحدد دورهم وفرعهم، وادّيهم رمز مؤقت يغيّروه أول دخول.", devices: "اعتمد الأجهزة الجديدة وحدد نوع كل جهاز ومكانه." };
const allowed = r => ({ count: ["owner", "gm"].includes(S.sess.role.id) || can("stock", "a") || !!(S.stkMine && S.stkMine.length), reserve: can("pos"), staff: ["owner", "gm"].includes(S.sess.role.id) || can("staff"), reports: ["owner", "gm"].includes(S.sess.role.id) || can("reports"), basis: ["owner", "gm"].includes(S.sess.role.id) || can("basis") || can("gl"), flow: ["owner", "gm"].includes(S.sess.role.id) || can("flow") || can("gl"), capital: ["owner", "gm"].includes(S.sess.role.id) || can("capital"), opening: ["owner", "gm"].includes(S.sess.role.id) || can("opening"),
  taxinv: !!(S.store && S.store.vat_registered) && (["owner", "gm"].includes(S.sess.role.id) || can("taxinv")), einv: !!(S.store && S.store.vat_registered) && (["owner", "gm"].includes(S.sess.role.id) || can("einv")), avail: ["owner", "gm"].includes(S.sess.role.id) || has("itemAvail") || can("avail"), roles: S.sess.role.id === "owner" || has("users"), audit: ["owner", "gm"].includes(S.sess.role.id) || can("audit"), backup: S.sess.role.id === "owner" || has("backup"), export: ["owner", "gm"].includes(S.sess.role.id) || Object.values(S.sess.role.perms || {}).some(v => String(v).includes("x")), close: can("close"), expense: can("expense"), returns: can("returns"), customers: can("customers"), delivery: can("delivery"), print: ["owner", "gm"].includes(S.sess.role.id) || has("labels") || has("printerSetup") || can("print"), gl: ["owner", "gm"].includes(S.sess.role.id) || can("gl"), commission: ["owner", "gm", "acct", "mgr", "seller"].includes(S.sess.role.id), offers: ["owner", "gm"].includes(S.sess.role.id) || can("offers"), settings: ["owner", "gm"].includes(S.sess.role.id), suppliers: can("suppliers") || can("stock", "a"), svc: can("svc"), inst: can("inst") || ["owner", "gm"].includes(S.sess.role.id), pos: can("pos", "a"), cash: can("cash") || can("close"), transfers: can("transfers"), dash: can("dash") || can("items"), items: can("items"), io: can("io", "i") && can("items", "a"), stock: can("stock") || can("items"), users: has("users"), devices: has("devices") })[r];

async function enterApp() {
  $("#gate").hidden = true; $("#app").hidden = false;
  try { await loadCore(); await loadItems(); } catch (e) { toast(errText(e), true); }
  try { S.stkMine = await rpc("stocktake_my", { p_token: T() }); } catch (e) { S.stkMine = []; }
  if (!allowed(S.route)) S.route = Object.keys(NAME).find(allowed) || "dash";
  render();
}
function renderSide() {
  let h = `<div class="brand"><div class="mono">${LOGO() ? logoImg("30px", "width:30px") : MARK.replace("<svg", '<svg width="30" height="30" fill="none" style="stroke:var(--gold)" stroke-width="5" stroke-linecap="round"')}</div><div><b>${esc((S.store && S.store.name) || S.storeName || "")}</b><small>أدوات منزلية · أجهزة · مفروشات</small></div></div>`;
  NAV.forEach(([g, ids]) => { const v = ids.filter(allowed); if (!v.length) return; h += `<div class="navlbl">${g}</div><nav class="nav">${v.map(id => `<button data-go="${id}" class="${S.route === id ? "on" : ""}">${ico(id)}<span>${NAME[id]}</span></button>`).join("")}</nav>`; });
  h += `<div class="foot">SYS Minzo<br><span class="num">${esc(CFG.version)}</span></div>`;
  $("#side").innerHTML = h;
}
function renderTop() {
  const s = S.sess; $("#top").innerHTML = `<button class="iconbtn menu-btn" data-act="menu" aria-label="القائمة">${ico("menu")}</button>
  <div class="crumb"><span>${esc((S.store && S.store.name) || "")}</span><span class="dim">/</span><b>${NAME[S.route]}</b></div>
  <span class="ctl">${esc(s.device.name)}${s.device.location_id ? " · " + esc(locName(s.device.location_id)) : ""}</span>
  <button class="ctl" data-act="me" title="تغيير الرمز">${esc(s.staff.name)} · ${esc(s.role.name)}</button>
  <button class="iconbtn" data-act="theme" aria-label="الوضع الليلي">${ico("moon")}</button>
  <button class="iconbtn" data-act="lock" aria-label="قفل" title="قفل">${ico("lock")}</button>`;
}
function header(acts) { return `<div class="ph"><div><div class="eyebrow">${esc((S.store && S.store.name) || "")}</div><h1>${NAME[S.route]}</h1><p>${SUB[S.route]}</p></div>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`; }
function render() { renderSide(); renderTop(); $("#view").innerHTML = V[S.route](); $("#side").classList.remove("open"); if (H[S.route]) H[S.route](); }
function go(r) { if (!allowed(r)) return; S.route = r; ls("minzo-route", r); render(); scrollTo({ top: 0 }); }

/* =====================================================================
   SCREENS
   ===================================================================== */
const V = {}, H = {};
/* the daily copy on Google Drive (owner only): read the last line of backup_log, at most every 10 minutes */
function bkLast(route) {
  if (S.sess.role.id !== "owner") return null;
  const B = S.bkLast;
  if ((!B || Date.now() - B.t > 600000) && !S._bkLoading) {
    S._bkLoading = true;
    q("backup_log", "at,bytes", x => x.eq("kind", "drive").order("at", { ascending: false }).limit(1))
      .then(r => { S.bkLast = { at: r[0] ? r[0].at : null, bytes: r[0] ? +r[0].bytes : 0, t: Date.now() }; if (S.route === route) render(); })
      .catch(() => {}).finally(() => { S._bkLoading = false; });
  }
  return B || null;
}
const bkSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const bkWhen = x => new Date(x).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
V.dash = () => {
  const sc = seeCost(), byLoc = S.locs.map(l => { const rows = S.stock.filter(s => s.location_id === l.id); const val = rows.reduce((a, s) => { const it = S.items.find(i => i.id === s.item_id); return a + (+s.qty || 0) * (it ? +it.last_cost : 0); }, 0); return { l, n: rows.filter(r => +r.qty > 0).length, val }; });
  const low = S.items.filter(i => +i.min_qty > 0 && stockOf(i.id) <= +i.min_qty);
  let h = header();
  const bk = bkLast("dash");
  if (bk && (!bk.at || Date.now() - new Date(bk.at).getTime() > 36 * 3600e3))
    h += `<div class="card rise" style="border-color:var(--bad);background:var(--badsoft)"><h3 style="color:var(--bad)">${bk.at ? "النسخة الاحتياطية على Google Drive متأخرة" : "لسه مفيش نسخة احتياطية على Google Drive"}</h3><p style="margin:0">${bk.at ? `آخر نسخة كانت ${esc(bkWhen(bk.at))} — يعني من أكتر من ٣٦ ساعة. اتأكد إن سكريبت «Minzo Backup» شغال وشوف إيميلك.` : "شغّل setup في سكريبت «Minzo Backup» على Google عشان النسخة اليومية تبدأ."}</p></div>`;
  h += `<div class="grid g4">${[["الأصناف", S.items.length], ["أصناف ليها رصيد", new Set(S.stock.filter(s => +s.qty > 0).map(s => s.item_id)).size], ["وصلت للحد الأدنى", low.length], [sc ? "قيمة المخزون (آخر تكلفة)" : "الأماكن", sc ? fmt(byLoc.reduce((a, x) => a + x.val, 0)) : S.locs.length]].map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div></div>`).join("")}</div>`;
  h += `<div class="grid g2"><div class="card rise"><h3>المخزون في كل مكان</h3><div class="tw"><table><thead><tr><th>المكان</th><th class="n">أصناف ليها رصيد</th>${sc ? `<th class="n">القيمة</th>` : ""}</tr></thead><tbody>${byLoc.map(x => `<tr><td>${esc(x.l.name)}</td><td class="n">${x.n}</td>${sc ? `<td class="n">${fmt(x.val)}</td>` : ""}</tr>`).join("")}</tbody></table></div></div>
  <div class="card rise"><h3>أصناف وصلت للحد الأدنى</h3>${low.length ? `<div class="tw"><table><tbody>${low.slice(0, 12).map(i => `<tr><td>${esc(i.name)}</td><td class="n">${num(stockOf(i.id))} / ${num(i.min_qty)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">مفيش أصناف تحت الحد الأدنى.</p>`}</div></div>`;
  if (!S.items.length) h += `<div class="card lux rise" style="text-align:center"><h3 style="justify-content:center">النظام فاضي ولسه بيبدأ</h3><p class="muted">ابدأ بإضافة الأصناف واحد واحد، أو استوردها من Excel مع أرصدة أول المدة.</p><div class="row" style="justify-content:center;gap:8px">${allowed("items") && can("items", "a") ? `<button class="btn" data-go="items">إضافة صنف</button>` : ""}${allowed("io") ? `<button class="btn gold" data-go="io">استيراد من Excel</button>` : ""}</div></div>`;
  return h;
};

/* ---------- items ---------- */
V.items = () => {
  const list = S.items.filter(i => (S.dep === "all" || i.department_id === +S.dep) && (!S.q || norm(srch(i)).includes(norm(S.q))));
  let h = header(can("items", "a") ? `<button class="btn gold" data-act="itemNew">${ico("plus")} صنف جديد</button>` : "");
  h += `<div class="row rise" style="gap:8px"><input class="inp" id="iq" placeholder="ابحث بالاسم أو الباركود أو الكود" value="${esc(S.q)}" style="flex:1;min-width:200px"><select class="inp" id="idep" style="width:auto"><option value="all">كل الأقسام</option>${S.depts.map(d => `<option value="${d.id}" ${+S.dep === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الصنف</th><th>القسم / المجموعة</th><th>الوحدة</th><th class="n">سعر البيع</th>${seeCost() ? `<th class="n">آخر تكلفة</th>` : ""}<th class="n">الرصيد</th><th></th></tr></thead><tbody>${list.slice(0, 400).map(i => `<tr><td class="pname">${esc(i.name)}${(S.kits || {})[i.id] ? ` <span class="chip gold plain" style="font-size:11px">طقم</span>` : ""}<small>${esc(i.code)}${codesOf(i.id).length ? ` · <span title="الكود الصيني">${esc(codesOf(i.id).join("، "))}</span>` : ""}${i.barcode ? " · " + esc(i.barcode) : ""}${i.serial_required ? " · مسلسل" : ""}</small></td><td>${esc((S.depts.find(d => d.id === i.department_id) || {}).name || "—")}${i.group_id ? `<br><span class="dim" style="font-size:12px">${esc((S.groups.find(g => g.id === i.group_id) || {}).name || "")}</span>` : ""}</td><td>${UNITS[i.unit]}</td><td class="n">${fmt(i.sale_price, 1)}</td>${seeCost() ? `<td class="n">${fmt(i.last_cost, 1)}</td>` : ""}<td class="n">${num(ownStock(i.id))}${kitBuild(i.id) ? `<br><span class="dim" style="font-size:11.5px">+${num(kitBuild(i.id))} من القطع</span>` : ""}</td><td style="white-space:nowrap">${can("items", "e") ? `<button class="btn sm ghost" data-act="itemEdit" data-id="${i.id}">تعديل</button>` : ""}${(can("items", "e") || can("items", "a")) && !i.serial_required ? `<button class="btn sm ghost" data-act="kitEdit" data-id="${i.id}">${(S.kits || {})[i.id] ? "الطقم" : "طقم؟"}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">${S.items.length ? "مفيش نتايج." : "لسه مفيش أصناف."}</td></tr>`}</tbody></table></div>`;
  if (list.length > 400) h += `<p class="dim">بيظهر أول 400 — استخدم البحث.</p>`;
  return h;
};
H.items = () => { const qi = $("#iq"); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; render(); const n = $("#iq"); n.focus(); n.setSelectionRange(p, p); }; $("#idep").onchange = e => { S.dep = e.target.value; render(); }; };
function ean13() { let b = "200" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"); let s = 0; for (let i = 0; i < 12; i++) s += +b[i] * (i % 2 ? 3 : 1); return b + ((10 - s % 10) % 10); }
function itemModal(it) {
  const x = it || { unit: "piece", sale_price: "", min_qty: 0, warranty_months: 0, serial_required: false, department_id: S.depts[0] && S.depts[0].id };
  const groupsOf = d => S.groups.filter(g => g.department_id === +d);
  modal(`<h2>${it ? "تعديل صنف" : "صنف جديد"}</h2><div class="stack" style="margin-top:10px">
   <div class="field"><label>اسم الصنف</label><input class="inp" id="mName" value="${esc(x.name || "")}"></div>
   <div class="grid g2"><div class="field"><label>الباركود</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="inp num" id="mBc" value="${esc(x.barcode || "")}" placeholder="امسحه بالسكانر"><button class="btn sm" id="mGen" title="للأصناف اللي من غير باركود">توليد</button></div></div>
   <div class="field"><label>الكود ${it ? "" : `<span class="dim">(سيبه فاضي ويتعمل لوحده حسب المجموعة)</span>`}</label><input class="inp num" id="mCode" value="${esc(x.code || "")}" ${it ? "disabled" : `placeholder="تلقائي"`}></div>
   <div class="field"><label>الكود الصيني / كود المورد <span class="dim">(لو أكتر من كود افصل بفاصلة)</span></label><input class="inp num" id="mCn" value="${esc(it ? codesOf(it.id).join("، ") : "")}" placeholder="مثال: YW-88231"></div>
   <div class="field"><label>الماركة <span class="dim">(لقواعد الضمان)</span></label><input class="inp" id="mBrand" value="${esc(x.brand || "")}" placeholder="مثال: فريش، توشيبا"></div>
   <div class="field"><label>الوحدة</label><select class="inp" id="mUnit">${Object.entries(UNITS).map(([k, v]) => `<option value="${k}" ${x.unit === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
   <div class="field"><label>القسم</label><select class="inp" id="mDep">${S.depts.map(d => `<option value="${d.id}" ${x.department_id === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>
   <div class="field"><label>المجموعة</label><div class="row" style="flex-wrap:nowrap;gap:6px"><select class="inp" id="mGrp"><option value="">— بدون —</option>${groupsOf(x.department_id).map(g => `<option value="${g.id}" ${x.group_id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select><button class="btn sm" id="mGrpNew" title="مجموعة جديدة">${ico("plus")}</button></div></div>
   <div class="field"><label>سعر البيع</label><input class="inp num" id="mPrice" type="number" min="0" step="0.01" value="${x.sale_price}"></div>
   <div class="field"><label>الحد الأدنى للرصيد</label><input class="inp num" id="mMin" type="number" min="0" value="${x.min_qty}"></div>
   <div class="field"><label>مدة الضمان (شهر)</label><input class="inp num" id="mWar" type="number" min="0" value="${x.warranty_months}"></div>
   <div class="field" id="mLenF"><label>أقل طول يتباع (متر)</label><input class="inp num" id="mLen" type="number" min="0" step="0.1" value="${x.min_length || ""}"></div></div>
   <label class="row" style="gap:8px"><input type="checkbox" class="ck" id="mSer" ${x.serial_required ? "checked" : ""}> بيتباع بمسلسل (أجهزة كهربائية)</label>
   ${it ? `<div class="field"><label>سبب التعديل (إجباري لو غيّرت السعر)</label><input class="inp" id="mRsn"></div>` : ""}
   <div id="mErr"></div>
   <div class="row" style="justify-content:space-between">${it && can("items", "d") ? `<button class="btn sm danger" id="mHide">إخفاء الصنف</button>` : "<span></span>"}<span class="row" style="gap:8px"><button class="btn ghost" id="mCancel">إلغاء</button><button class="btn gold" id="mSave">حفظ</button></span></div></div>`);
  const lenF = () => { $("#mLenF").style.display = $("#mUnit").value === "meter" ? "" : "none"; }; lenF();
  $("#mUnit").onchange = lenF; $("#mCancel").onclick = closeModal; $("#mGen").onclick = e => { e.preventDefault(); $("#mBc").value = ean13(); };
  const nextCode = () => { if (it || $("#mCode").value.trim() && !$("#mCode").dataset.auto) return; rpc("item_next_code", { p_token: T(), p_department: +$("#mDep").value || null, p_group: +$("#mGrp").value || null }).then(c => { const f = $("#mCode"); if (f && (!f.value || f.dataset.auto)) { f.placeholder = "تلقائي: " + c; } }).catch(() => {}); };
  if (!it) { nextCode(); $("#mGrp").addEventListener("change", nextCode); $("#mDep").addEventListener("change", () => setTimeout(nextCode, 0)); }
  $("#mDep").onchange = () => { $("#mGrp").innerHTML = `<option value="">— بدون —</option>` + groupsOf($("#mDep").value).map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join(""); };
  $("#mGrpNew").onclick = async e => { e.preventDefault(); const n = prompt("اسم المجموعة الجديدة"); if (!n) return; try { const id = await rpc("group_save", { p_token: T(), p_department: +$("#mDep").value, p_parent: null, p_name: n }); S.groups.push({ id, department_id: +$("#mDep").value, name: n }); $("#mDep").onchange(); $("#mGrp").value = id; } catch (er) { toast(errText(er), true); } };
  const save = async (extra, btn) => {
    const price = $("#mPrice").value, p = Object.assign({ code: it ? undefined : ($("#mCode").value.trim() || null), name: $("#mName").value.trim(), barcode: $("#mBc").value.trim() || null, unit: $("#mUnit").value, department_id: $("#mDep").value, group_id: $("#mGrp").value || null, sale_price: price === "" ? null : +price, min_qty: +$("#mMin").value || 0, warranty_months: +$("#mWar").value || 0, min_length: $("#mUnit").value === "meter" ? ($("#mLen").value || null) : null, serial_required: $("#mSer").checked }, it ? { id: it.id, updated_at: it.updated_at, reason: ($("#mRsn") || {}).value || null } : {}, extra || {});
    if (!p.name) return ($("#mErr").innerHTML = `<div class="warnbox">اكتب اسم الصنف.</div>`);
    if (p.sale_price == null || p.sale_price < 0) return ($("#mErr").innerHTML = `<div class="warnbox">اكتب سعر البيع.</div>`);
    if (it && +it.sale_price !== +p.sale_price && (!p.reason || p.reason.trim().length < 3)) return ($("#mErr").innerHTML = `<div class="warnbox">غيّرت السعر — اكتب السبب.</div>`);
    busy(btn, true);
    try { const nid = await rpc("item_save", { p_token: T(), p }); const br = $("#mBrand").value.trim(); if (br !== ((it && it.brand) || "")) await rpc("item_brand_set", { p_token: T(), p_item: nid, p_brand: br });
      const cn = $("#mCn").value.split(/[,،\n]/).map(x => x.trim()).filter(Boolean); if (cn.join("|") !== (it ? codesOf(it.id).join("|") : "")) await rpc("item_codes_set", { p_token: T(), p_item: nid, p_codes: cn }); closeModal(); toast("اتحفظ."); await loadItems(); render(); }
    catch (er) { $("#mErr").innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; busy(btn, false); }
  };
  $("#mSave").onclick = e => save(null, e.target);
  const hb = $("#mHide"); if (hb) hb.onclick = e => { if (confirm("الصنف هيتخفى من البيع والقوائم، ويفضل في التقارير. متأكد؟")) save({ hidden: true }, e.target); };
}

/* ---------- import ---------- */
const IFIELDS = [["name", "اسم الصنف", 1, ["اسم", "الصنف", "name", "item", "description", "البيان"]], ["barcode", "الباركود", 0, ["باركود", "barcode", "ean", "upc"]], ["code", "الكود الداخلي", 0, ["كود", "code", "sku", "رقم الصنف"]],
  ["department", "القسم", 1, ["قسم", "department", "category", "الفئة"]], ["group", "المجموعة", 0, ["مجموعة", "group", "sub", "النوع"]], ["unit", "الوحدة", 0, ["وحدة", "unit", "uom"]],
  ["sale_price", "سعر البيع", 1, ["سعر البيع", "سعر", "price", "sale"]], ["cost", "التكلفة", 0, ["تكلفة", "cost", "سعر الشراء", "purchase"]], ["qty", "الرصيد", 0, ["رصيد", "كمية", "qty", "quantity", "stock"]],
  ["min_qty", "الحد الأدنى", 0, ["حد أدنى", "الحد الادنى", "min"]], ["serial_required", "بمسلسل؟", 0, ["مسلسل", "serial"]], ["warranty_months", "الضمان (شهر)", 0, ["ضمان", "warranty"]], ["serials", "المسلسلات (مفصولة بفاصلة)", 0, ["المسلسلات", "serials", "serial numbers"]]];
V.io = () => {
  const I = S.imp;
  let h = header(`<button class="btn sm" data-act="impTpl">تنزيل قالب Excel</button>`);
  h += `<div class="card lux rise"><h3>١ · اختار الملف</h3><p class="muted" style="margin-top:0">Excel أو CSV، بأي ترتيب أعمدة. أول صف لازم يكون عناوين الأعمدة.</p><input type="file" id="impFile" class="inp" accept=".xlsx,.xls,.csv">${I ? `<div class="okbox" style="margin-top:10px">${esc(I.file)} · ${I.rows.length} صف</div>` : ""}</div>`;
  if (!I) return h;
  h += `<div class="card rise"><h3>٢ · اربط أعمدة الملف بالحقول</h3>${IFIELDS.map(([k, n, req]) => `<div class="maprow"><b>${n}${req ? ` <span class="req">*</span>` : ""}</b><select class="inp" data-map="${k}"><option value="-1">— مش موجود —</option>${I.heads.map((x, i) => `<option value="${i}" ${I.map[k] === i ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>`).join("")}
   <div class="field" style="margin-top:12px"><label>الرصيد ده رصيد أول المدة في</label><select class="inp" id="impLoc"><option value="">— الملف من غير أرصدة —</option>${S.locs.map(l => `<option value="${l.id}" ${+I.loc === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
   <p class="dim" style="font-size:12.5px">القسم لازم يكون واحد من: ${S.depts.map(d => esc(d.name)).join("، ")}. الوحدة: قطعة، طقم، متر، دستة، جهاز. المجموعات الجديدة بتتعمل لوحدها.</p>
   <div class="row" style="gap:8px"><button class="btn" data-act="impDry">٣ · تجربة من غير حفظ</button></div></div>`;
  if (I.res) {
    const r = I.res;
    h += `<div class="card rise ${r.errors.length ? "" : "lux"}"><h3>نتيجة التجربة</h3><div class="row" style="gap:8px"><span class="chip ok">${r.new} جديد</span><span class="chip info">${r.updated} تحديث</span><span class="chip ${r.errors.length ? "bad" : "plain"}">${r.errors.length} صف فيه أخطاء</span></div>
     ${r.errors.length ? `<div class="tw" style="margin-top:10px"><table><thead><tr><th class="n">الصف</th><th>الصنف</th><th>الأخطاء</th></tr></thead><tbody>${r.errors.slice(0, 200).map(e => `<tr><td class="n">${e.row + 1}</td><td>${esc(e.name || "—")}</td><td><ul class="errlist" style="margin:0;padding-inline-start:18px">${e.errors.map(x => `<li>${esc(x)}</li>`).join("")}</ul></td></tr>`).join("")}</tbody></table></div><p class="muted">صلّح الأخطاء في الملف وارفعه تاني. مفيش حاجة اتحفظت.</p>`
      : `<div class="okbox" style="margin-top:10px">مفيش أخطاء. ${I.loc ? "الأرصدة هتتسجّل رصيد أول المدة في " + esc(locName(+I.loc)) + " بتكلفتها." : "الملف من غير أرصدة."}</div><button class="btn gold" style="margin-top:10px" data-act="impGo">٤ · حفظ فعلي</button>`}</div>`;
  }
  return h;
};
H.io = () => {
  $("#impFile").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" }), sn = wb.SheetNames.find(n => (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" })[0] || []).some(h => norm(String(h)) === norm("اسم الصنف"))) || wb.SheetNames[0], ws = wb.Sheets[sn], aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" }).filter(r => r.some(c => String(c).trim() !== ""));
      if (aoa.length < 2) return toast("الملف فاضي أو مفيهوش غير العناوين.", true);
      const heads = aoa[0].map(x => String(x).trim()), map = {};
      const used = new Set();   /* exact header match first, then "contains"; each column is used once */
      IFIELDS.forEach(([k, n, , keys]) => { let i = heads.findIndex((hh, j) => !used.has(j) && [n, ...keys].some(w => norm(hh) === norm(w))); if (i < 0) i = heads.findIndex((hh, j) => !used.has(j) && keys.some(w => norm(hh).includes(norm(w)))); map[k] = i; if (i >= 0) used.add(i); });
      S.imp = { file: f.name, heads, rows: aoa.slice(1), map, loc: "", res: null }; render();
    } catch (er) { toast("مش قادر يقرا الملف: " + er.message, true); }
  };
  document.querySelectorAll("[data-map]").forEach(s => s.onchange = () => { S.imp.map[s.dataset.map] = +s.value; S.imp.res = null; });
  const l = $("#impLoc"); if (l) l.onchange = () => { S.imp.loc = l.value; S.imp.res = null; render(); };
};
function impRows() {
  const I = S.imp, g = (r, k) => I.map[k] >= 0 ? r[I.map[k]] : "";
  return I.rows.map(r => { const o = {}; IFIELDS.forEach(([k]) => { let v = g(r, k); if (v === undefined || v === null) v = ""; if (typeof v === "string") v = v.trim(); if (v !== "") o[k] = v; });
    ["sale_price", "cost", "qty", "min_qty"].forEach(k => { if (o[k] !== undefined) { const n = +String(o[k]).replace(/[,٬\s]/g, "").replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)); o[k] = isNaN(n) ? -1 : n; } });
    if (o.barcode !== undefined) o.barcode = String(o.barcode).replace(/\.0$/, "");
    if (o.serials) o.serials = String(o.serials).split(/[,،;\n]/).map(x => x.trim()).filter(Boolean); else delete o.serials;
    return o; });
}
async function impRun(commit, btn) {
  const miss = IFIELDS.filter(([k, , req]) => req && !(S.imp.map[k] >= 0)); if (miss.length) return toast("اربط الأعمدة الإلزامية: " + miss.map(x => x[1]).join("، "), true);
  busy(btn, true);
  try { const r = await rpc("items_import", { p_token: T(), p_rows: impRows(), p_location: S.imp.loc ? +S.imp.loc : null, p_commit: commit });
    if (commit) { toast(`اتحفظ: ${r.new} جديد · ${r.updated} تحديث.`); S.imp = null; await loadItems(); go("items"); return; }
    S.imp.res = r; render(); }
  catch (er) { toast(errText(er), true); busy(btn, false); }
}

/* ---------- stock ---------- */
V.stock = () => {
  const sc = seeCost(), locs = S.locs, list = S.items.filter(i => !S.q || norm(i.name + " " + (i.barcode || "")).includes(norm(S.q)));
  let h = header();
  h += `<div class="row rise" style="gap:8px"><input class="inp" id="sq" placeholder="ابحث بالاسم أو الباركود" value="${esc(S.q)}" style="flex:1;min-width:200px"></div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الصنف</th>${locs.map(l => `<th class="n">${esc(l.name)}</th>`).join("")}<th class="n">الإجمالي</th>${sc ? `<th class="n">القيمة</th>` : ""}</tr></thead><tbody>${list.slice(0, 500).map(i => { const tot = stockOf(i.id), low = +i.min_qty > 0 && tot <= +i.min_qty;
    return `<tr><td class="pname">${esc(i.name)}<small>${UNITS[i.unit]}${low ? ` · <span style="color:var(--warn)">تحت الحد الأدنى</span>` : ""}</small></td>${locs.map(l => `<td class="n">${num(stockOf(i.id, l.id)) || "—"}</td>`).join("")}<td class="n"><b>${num(tot)}</b></td>${sc ? `<td class="n">${fmt(tot * i.last_cost)}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="${locs.length + 3}" class="muted">لسه مفيش أصناف.</td></tr>`}</tbody></table></div>`;
  return h;
};
H.stock = () => { const qi = $("#sq"); qi.oninput = () => { S.q = qi.value; const p = qi.selectionStart; render(); const n = $("#sq"); n.focus(); n.setSelectionRange(p, p); }; };

/* ---------- staff ---------- */
V.users = () => { const L = S.staffList; let h = header(`<button class="btn gold" data-act="staffNew">${ico("plus")} موظف جديد</button>`);
  if (!L) { setTimeout(loadStaff, 0); return h + `<div class="spin"></div>`; }
  const pend = (S.mailAcc && S.mailAcc.pending) || [];
  if (pend.length) h += `<div class="card rise"><h3>حسابات إيميل مستنية التفعيل <span class="chip warn">${pend.length}</span></h3><div class="tw"><table><thead><tr><th>الاسم اللي كتبه</th><th>الإيميل</th><th>من إمتى</th><th></th></tr></thead><tbody>${pend.map(p => `<tr><td>${esc(p.name)}</td><td dir="ltr" style="text-align:right">${esc(p.email)}</td><td class="num">${esc(new Date(p.at).toLocaleString("ar-EG"))}</td><td class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm gold" data-act="pendLink" data-id="${p.auth_user_id}">ربط بموظف</button><button class="btn sm ghost" data-act="pendDrop" data-id="${p.auth_user_id}">حذف</button></td></tr>`).join("")}</tbody></table></div>
    <p class="dim" style="font-size:12.5px;margin-bottom:0">الحساب ده مش بيشوف أي حاجة لحد ما تربطه باسم موظف. بعد الربط بيدخل بالإيميل وبعدين برمز الموظف.</p></div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الاسم</th><th>الدور</th><th>المكان</th><th>الرمز</th><th>الإيميل</th><th>الحالة</th><th></th></tr></thead><tbody>${L.map(u => `<tr><td>${esc(u.name)}</td><td>${esc((S.roles.find(r => r.id === u.role_id) || {}).name || u.role_id)}</td><td>${u.location_id ? esc(locName(u.location_id)) : "كل الأماكن"}</td><td>${u.has_pin ? (u.must_change ? `<span class="chip warn">مؤقت</span>` : `<span class="chip ok">متغيّر</span>`) : `<span class="chip bad">مفيش</span>`}</td><td>${u.email_login ? (u.email ? `<span class="chip ok" dir="ltr">${esc(u.email)}</span>${u.pw_must_change ? ` <span class="chip warn">باسورد مؤقت</span>` : ""}` : `<span class="chip warn">مفتوح — مش مربوط</span>`) : (u.email ? `<span class="chip plain" dir="ltr">${esc(u.email)} · مقفول</span>` : `<span class="dim">—</span>`)}</td><td>${u.active ? `<span class="chip ok">شغال</span>` : `<span class="chip plain">موقوف</span>`}</td><td><button class="btn sm ghost" data-act="staffEdit" data-id="${u.id}">تعديل</button></td></tr>`).join("")}</tbody></table></div>`;
  return h; };
async function loadStaff() { try { const [l, roles, acc] = await Promise.all([rpc("staff_list", { p_token: T() }), q("roles", "id,name,max_discount_pct,max_amount", x => x.order("created_at")), rpc("email_accounts", { p_token: T() }).catch(() => null)]); S.staffList = l; S.roles = roles; S.mailAcc = acc; if (S.route === "users") render(); } catch (e) { toast(errText(e), true); } }
function genPw() { const a = "abcdefghjkmnpqrstuvwxyz23456789", r = crypto.getRandomValues(new Uint8Array(10)); return Array.from(r, v => a[v % a.length]).join(""); }
function genPin() { for (;;) { const p = String(Math.floor(100000 + Math.random() * 900000)); const d = [...p].map(Number); if (/^(\d)\1+$/.test(p) || d.every((x, i) => !i || x === d[i - 1] + 1) || d.every((x, i) => !i || x === d[i - 1] - 1)) continue; return p; } }
function staffModal(u) {
  const own = S.sess.role.id === "owner", top = own || S.sess.role.id === "gm", roles = S.roles.filter(r => own || (r.id !== "owner" && (top || !["gm", "mgr", "acct"].includes(r.id))));
  const x = u || { name: "", role_id: "cashier", location_id: S.sess.staff.location_id, active: true };
  modal(`<h2>${u ? "تعديل موظف" : "موظف جديد"}</h2><div class="stack" style="margin-top:10px">
   <div class="field"><label>الاسم</label><input class="inp" id="uName" value="${esc(x.name)}"></div>
   <div class="grid g2"><div class="field"><label>الدور</label><select class="inp" id="uRole">${roles.map(r => `<option value="${r.id}" ${x.role_id === r.id ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div>
   <div class="field"><label>المكان</label><select class="inp" id="uLoc" ${top ? "" : "disabled"}><option value="">كل الأماكن</option>${S.locs.map(l => `<option value="${l.id}" ${x.location_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div></div>
   <div class="field"><label>${u ? "رمز مؤقت جديد (اختياري)" : "رمز مؤقت"} — الموظف لازم يغيّره أول دخول</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="inp num" id="uPin" value="${u ? "" : genPin()}"><button class="btn sm" id="uGen">توليد</button></div></div>
   ${u ? `<label class="row" style="gap:8px"><input type="checkbox" class="ck" id="uAct" ${x.active ? "checked" : ""}> الحساب شغال</label>` : ""}
   ${u ? `<div class="card" style="margin:4px 0;padding:14px"><h3 style="margin:0 0 8px">الدخول بالإيميل من أي جهاز</h3>
     <label class="row" style="gap:8px"><input type="checkbox" class="ck" id="uMail" ${x.email_login ? "checked" : ""}> يدخل بالإيميل من أي جهاز (موبايل أو لابتوب)</label>
     <div id="uMailWarn" style="margin-top:6px"></div>
     ${x.email ? `<div class="row" style="gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center"><span class="chip ok" dir="ltr">${esc(x.email)}</span><button class="btn sm" id="uPwReset">باسورد مؤقت جديد</button><button class="btn sm ghost" id="uUnlink">فك الربط</button></div>`
       : `<div class="stack" style="margin-top:10px;gap:8px"><span class="dim" style="font-size:12.5px">اعمله حساب إيميل بباسورد مؤقت (بيغيّره أول ما يدخل)${((S.mailAcc && S.mailAcc.pending) || []).length ? "، أو اربطه بحساب عمله بنفسه من جدول «مستنية التفعيل»" : ""}:</span>
         <div class="grid g2"><input class="inp" id="uEmail" type="email" placeholder="الإيميل" dir="ltr"><input class="inp" id="uTmpPw" placeholder="باسورد مؤقت (8 أو أكتر)" dir="ltr" value="${genPw()}"></div>
         <button class="btn sm" id="uMkMail" style="align-self:flex-start">عمل حساب الإيميل</button></div>`}
     <div id="uMailErr"></div></div>` : ""}
   <div id="uErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" id="uCancel">إلغاء</button><button class="btn gold" id="uSave">حفظ</button></div></div>`);
  $("#uCancel").onclick = closeModal; $("#uGen").onclick = () => { $("#uPin").value = genPin(); };
  if (u) {
    const warn = () => { const on = $("#uMail").checked, r = $("#uRole").value; $("#uMailWarn").innerHTML = on && !["owner", "gm", "mgr", "acct"].includes(r) ? `<div class="warnbox">الدور ده مش إداري. الدخول بالإيميل هيخلّيه يفتح السيستم من موبايله برّه المعرض. هيشوف بس اللي دوره يسمح بيه.</div>` : ""; };
    $("#uMail").onchange = warn; $("#uRole").addEventListener("change", warn); warn();
    const mErr = t => { $("#uMailErr").innerHTML = t ? `<div class="warnbox" style="margin-top:8px">${esc(t)}</div>` : ""; };
    const done = (t, extra) => { closeModal(); S.staffList = null; render(); if (extra) modal(extra); else toast(t); };
    if ($("#uMkMail")) $("#uMkMail").onclick = async e => { const email = $("#uEmail").value.trim(), pw = $("#uTmpPw").value.trim(); busy(e.target, true);
      try { await adminFn({ action: "create", staff_id: u.id, email, password: pw }); done("", `<h2>حساب الإيميل جاهز</h2><p class="muted">ادّي البيانات دي لـ ${esc(u.name)}. هيطلب منه يغيّر الباسورد أول ما يدخل، وبعد كده الجهاز بيفتح برمزه.</p><div class="okbox" dir="ltr" style="text-align:center;font-size:18px;line-height:1.9">${esc(email)}<br><b class="num" style="font-size:24px;letter-spacing:2px">${esc(pw)}</b></div><button class="btn gold" style="width:100%;margin-top:12px" onclick="document.getElementById('modal').remove()">تمام</button>`); }
      catch (er) { mErr(errText(er)); busy(e.target, false); } };
    if ($("#uPwReset")) $("#uPwReset").onclick = async e => { const pw = genPw(); if (!confirm(`هيتعمل باسورد مؤقت جديد لـ ${u.name}، وأجهزته الشخصية هتطلب الإيميل والباسورد تاني. تكمّل؟`)) return; busy(e.target, true);
      try { await adminFn({ action: "reset", staff_id: u.id, password: pw }); done("", `<h2>الباسورد المؤقت الجديد</h2><p class="muted">ادّيه لـ ${esc(u.name)}. هيطلب منه يغيّره أول ما يدخل.</p><div class="okbox" dir="ltr" style="text-align:center;font-size:18px;line-height:1.9">${esc(x.email)}<br><b class="num" style="font-size:24px;letter-spacing:2px">${esc(pw)}</b></div><button class="btn gold" style="width:100%;margin-top:12px" onclick="document.getElementById('modal').remove()">تمام</button>`); }
      catch (er) { mErr(errText(er)); busy(e.target, false); } };
    if ($("#uUnlink")) $("#uUnlink").onclick = async e => { if (!confirm(`فك ربط الإيميل من ${u.name}؟ كل جلساته هتتقفل.`)) return; busy(e.target, true);
      try { await rpc("staff_unlink", { p_token: T(), p_staff: u.id }); done("اتفك الربط."); } catch (er) { mErr(errText(er)); busy(e.target, false); } };
  }
  $("#uSave").onclick = async e => {
    const name = $("#uName").value.trim(), pin = $("#uPin").value.trim(); if (!name) return ($("#uErr").innerHTML = `<div class="warnbox">اكتب الاسم.</div>`);
    if (!u && !pin) return ($("#uErr").innerHTML = `<div class="warnbox">اكتب رمز مؤقت.</div>`);
    busy(e.target, true);
    try { await rpc("staff_save", { p_token: T(), p_id: u ? u.id : null, p_name: name, p_role: $("#uRole").value, p_location: $("#uLoc").value ? +$("#uLoc").value : null, p_active: u ? $("#uAct").checked : true, p_temp_pin: pin || null });
      if (u && $("#uMail") && $("#uMail").checked !== !!x.email_login) await rpc("staff_email_set", { p_token: T(), p_staff: u.id, p_on: $("#uMail").checked });
      closeModal(); if (pin) modal(`<h2>الرمز المؤقت</h2><p class="muted">ادّي الرمز ده لـ ${esc(name)}. هيطلب منه يغيّره أول ما يدخل.</p><div class="okbox" style="text-align:center;font-size:28px;letter-spacing:6px" class="num">${esc(pin)}</div><button class="btn gold" style="width:100%;margin-top:12px" onclick="document.getElementById('modal').remove()">تمام</button>`);
      S.staffList = null; render(); }
    catch (er) { $("#uErr").innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; busy(e.target, false); }
  };
}

/* ---------- devices ---------- */
V.devices = () => { const D = S.devList; let h = header();
  if (!D) { setTimeout(loadDevices, 0); return h + `<div class="spin"></div>`; }
  const pend = D.filter(d => !d.active && !d.disabled_once), act = D.filter(d => d.active);
  if (pend.length) h += `<div class="card lux rise"><h3>أجهزة مستنية الاعتماد</h3>${pend.map(d => `<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)"><span><b>${esc(d.name)}</b><br><span class="dim num" style="font-size:12px">${esc(d.id.slice(0, 8))} · ${new Date(d.created_at).toLocaleString("ar-EG")}</span></span><button class="btn sm gold" data-act="devEdit" data-id="${d.id}">اعتماد</button></div>`).join("")}</div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الجهاز</th><th>النوع</th><th>المكان</th><th>آخر ظهور</th><th>الحالة</th><th></th></tr></thead><tbody>${D.map(d => `<tr><td>${esc(d.name)}${d.id === S.sess.device.id ? ` <span class="chip gold plain">الجهاز ده</span>` : ""}</td><td>${KINDS[d.kind] || d.kind}</td><td>${d.location_id ? esc(locName(d.location_id)) : "—"}</td><td class="num dim">${d.last_seen ? new Date(d.last_seen).toLocaleString("ar-EG") : "—"}</td><td>${d.active ? `<span class="chip ok">شغال</span>` : `<span class="chip warn">مستني / موقوف</span>`}</td><td><button class="btn sm ghost" data-act="devEdit" data-id="${d.id}">تعديل</button></td></tr>`).join("")}</tbody></table></div>
  <div class="okbox rise">لتسجيل جهاز جديد: افتح رابط النظام على الجهاز ده، واكتب اسمه، وبعدها اعتمده من هنا وحدد نوعه ومكانه. جهاز الكاشير لازم يبقى ليه مكان (معرض) عشان الوردية والدرج.</div>`;
  return h; };
async function loadDevices() { try { S.devList = await q("devices", "*", x => x.order("created_at")); if (S.route === "devices") render(); } catch (e) { toast(errText(e), true); } }
function devModal(d) {
  modal(`<h2>${d.active ? "تعديل جهاز" : "اعتماد جهاز"}</h2><div class="stack" style="margin-top:10px">
   <div class="field"><label>الاسم</label><input class="inp" id="vName" value="${esc(d.name)}"></div>
   <div class="grid g2"><div class="field"><label>النوع</label><select class="inp" id="vKind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${d.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
   <div class="field"><label>المكان</label><select class="inp" id="vLoc"><option value="">— بدون —</option>${S.locs.map(l => `<option value="${l.id}" ${d.location_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div></div>
   <label class="row" style="gap:8px"><input type="checkbox" class="ck" id="vAct" ${d.active || !d.active ? "checked" : ""}> الجهاز شغال</label>
   <div id="vErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" id="vCancel">إلغاء</button><button class="btn gold" id="vSave">حفظ</button></div></div>`);
  $("#vCancel").onclick = closeModal;
  $("#vSave").onclick = async e => { busy(e.target, true);
    try { await rpc("device_set", { p_token: T(), p_device: d.id, p_name: $("#vName").value.trim(), p_kind: $("#vKind").value, p_location: $("#vLoc").value ? +$("#vLoc").value : null, p_active: $("#vAct").checked });
      closeModal(); toast("اتحفظ."); S.devList = null; if (d.id === S.sess.device.id) { S.sess.device.location_id = $("#vLoc").value ? +$("#vLoc").value : null; } render(); }
    catch (er) { $("#vErr").innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; busy(e.target, false); } };
}


/* =====================================================================
   POINT OF SALE · SHIFTS · CASH · TRANSFERS
   ===================================================================== */
const RC = () => (S.store && S.store.receipt) || {};
const PAYN = { cash: "نقدي", card: "فيزا", insta: "إنستاباي", wallet: "محفظة" };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const P = { cart: [], disc: 0, pin: "", cust: { name: "", phone: "" }, seller: "", plan: "", heldId: null, pay: { cash: "", card: "", insta: "", wallet: "", inst: "" }, dep: "all", q: "", shift: undefined, serials: [] };
const today = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
async function loadDir() { if (!S.dir) S.dir = await rpc("staff_directory", { p_token: T() }); return S.dir; }
const who = id => ((S.dir || []).find(x => x.id === id) || {}).name || "—";

/* ---------- offline queue: sales are kept on this device and re-sent (the server ignores duplicates) ---------- */
const QK = "minzo-sale-queue";
const qGet = () => { try { return JSON.parse(ls(QK) || "[]"); } catch (e) { return []; } };
const qSet = a => ls(QK, JSON.stringify(a));
async function qFlush() {
  if (!T()) return; const a = qGet(); if (!a.length) return; const left = [];
  for (const x of a) { try { await rpc("sale_post", { p_token: T(), p: x }); } catch (e) { if (/fetch|network/i.test(e.message || "")) left.push(x); else { x._err = errText(e); left.push(x); } } }
  qSet(left); if (left.length < a.length) { toast(`اتبعت ${a.length - left.length} فاتورة كانت محفوظة على الجهاز.`); await loadItems().catch(() => {}); if (S.route === "pos" || S.route === "cash") render(); }
}
addEventListener("online", qFlush); setInterval(qFlush, 30000);

/* ---------- pricing preview (the server re-prices; this is for the screen only) ---------- */
const cartSig = () => JSON.stringify(P.cart.map(l => [l.id, l.qty]));
async function ofrFetch(sig) {
  P.ofrReq = sig;
  try { const r = await rpc("offers_preview", { p_token: T(), p: { lines: P.cart.map(l => ({ item_id: l.id, qty: l.qty })) } }); if (P.ofrReq !== sig) return; P.ofr = r; }
  catch (e) { if (P.ofrReq !== sig) return; P.ofr = { error: true }; }
  P.ofrSig = sig; P.ofrReq = null;
  if (S.route === "pos" && cartSig() === sig && !$("#modal")) render();
}
function cartCalc() {
  const st = S.store || {}, vatOn = st.vat_registered && st.vat_from && today() >= st.vat_from, O = P.ofrSig === cartSig() && P.ofr && !P.ofr.error ? P.ofr : null;
  let gross = 0, odisc = 0, mdisc = 0, vat = 0;
  P.cart.forEach((l, n) => { const it = S.items.find(i => i.id === l.id); l.it = it; const g = it.sale_price * l.qty, ol = O && O.lines && O.lines[n], od = ol ? +ol.d || 0 : 0, md = Math.round((g - od) * P.disc) / 100;
    l.od = od; l.on = ol && ol.n ? ol.n : ""; l.net = g - od - md; gross += g; odisc += od; mdisc += md; });
  odisc = Math.round(odisc * 100) / 100; mdisc = Math.round(mdisc * 100) / 100;
  let cdisc = 0; const cp = P.coupon, base = P.cart.reduce((a, l) => a + l.net, 0);
  if (cp && base >= (+cp.min_total || 0)) { cdisc = Math.round((cp.kind === "pct" ? base * Math.min(+cp.value, 100) / 100 : Math.min(+cp.value, base)) * 100) / 100; if (cp.max_disc != null) cdisc = Math.min(cdisc, +cp.max_disc);
    P.cart.forEach(l => { l.net -= base ? cdisc * l.net / base : 0; }); }
  const disc = odisc + mdisc + cdisc; let total = gross - disc;
  if (vatOn) { P.cart.forEach(l => { const r = (l.it.vat_rate != null ? +l.it.vat_rate : +st.vat_rate) / 100, sh = l.net; vat += st.prices_include_vat ? sh - sh / (1 + r) : sh * r; }); vat = Math.round(vat * 100) / 100; if (!st.prices_include_vat) total += vat; }
  const dep = P.res ? +P.res.deposit : 0, paid = Object.values(P.pay).reduce((a, v) => a + (+v || 0), 0) + dep;
  return { cdisc, cpLow: !!(cp && base < (+cp.min_total || 0)), dep, gross, disc, odisc, mdisc, vat, total: Math.round(total * 100) / 100, paid, change: paid - total, vatOn, incl: st.prices_include_vat, ofrOk: !!O, ofrWait: P.cart.length && P.ofrSig !== cartSig() };
}

V.pos = () => {
  const d = S.sess.device, loc = d.location_id;
  let h = header();
  if (!loc || (S.locs.find(l => l.id === loc) || {}).kind !== "showroom") return h + `<div class="card lux rise" style="text-align:center"><h3 style="justify-content:center">الجهاز ده مش مربوط بمعرض</h3><p class="muted">البيع بيتم من جهاز مربوط بمعرض عشان الدرج والوردية. المالك أو المدير العام يحدد مكان الجهاز من شاشة «الأجهزة».</p>${has("devices") ? `<button class="btn gold" data-go="devices">شاشة الأجهزة</button>` : ""}</div>`;
  if (P.shift === undefined) { setTimeout(posShift, 0); return h + `<div class="spin"></div>`; }
  const isSeller = S.sess.role.id === "seller";
  if (!P.shift && !isSeller) return h + `<div class="card lux rise" style="max-width:480px"><h3>مفيش وردية مفتوحة على درج ${esc(locName(loc))}</h3><div class="field"><label>رصيد الدرج في أول الوردية (الفكّة)</label><input class="inp num" id="shFloat" type="number" min="0" value="0"></div><button class="btn gold" style="margin-top:10px" data-act="shOpen">فتح وردية</button></div>`;
  const q = qGet(), c = cartCalc(), max = +S.sess.role.max_discount_pct || 0;
  const av = i => (window.MZAV ? window.MZAV(i, S.sess.device.location_id) : "on");
  const items = S.items.filter(i => av(i) !== "hidden" && (P.dep === "all" || i.department_id === +P.dep) && (!P.q || norm(srch(i)).includes(norm(P.q))));
  h = `<div class="ph"><div><div class="eyebrow">${esc(locName(loc))}${P.shift ? ` · وردية ${esc(P.shift.cashier_name)} من ${new Date(P.shift.opened_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}` : " · البائع بيجهّز الفاتورة للكاشير"}${P.heldNo ? ` · <b>${esc(P.heldNo)}</b>` : ""}</div><h1>${NAME.pos}</h1></div><div class="acts">${q.length ? `<span class="chip warn">${q.length} فاتورة محفوظة على الجهاز</span>` : ""}${isSeller ? "" : `<button class="btn sm" data-act="heldList">المعلّقة</button><button class="btn sm" data-act="shHand">تسليم الوردية</button>`}</div></div>`;
  h += `<div class="pos"><div class="stack" style="gap:12px;min-width:0">
   <div class="scan">${ico("items")}<input id="posQ" placeholder="امسح الباركود أو اكتب اسم الصنف" value="${esc(P.q)}" autocomplete="off"></div>
   <div class="tabs">${[["all", "الكل"], ...S.depts.map(x => [String(x.id), x.name])].map(([k, n]) => `<button data-act="posDep" data-k="${k}" class="${String(P.dep) === k ? "on" : ""}">${esc(n)}</button>`).join("")}</div>
   <div class="pgrid">${items.slice(0, 120).map(i => { const st = stockOf(i.id, loc); return `<button class="pcard ${st <= 0 || av(i) === "locked" ? "out" : ""}" data-act="posAdd" data-id="${i.id}"><b>${esc(i.name)}</b>${av(i) === "locked" ? `<span class="chip warn" style="font-size:11px">مقفول</span>` : ""}<span class="dim num" style="font-size:11.5px">${esc(i.barcode || i.code)}</span><div class="pr"><span class="num">${fmt(i.sale_price)}</span><span class="chip plain">${num(st)} ${UNITS[i.unit]}</span></div></button>`; }).join("") || `<p class="muted">${S.items.length ? "مفيش نتايج." : "لسه مفيش أصناف."}</p>`}</div></div>
  <div class="card cart stick"><h3>الفاتورة</h3>${P.cart.length ? P.cart.map((l, n) => { const it = l.it; const sers = P.serials.filter(s => s.item_id === it.id && !P.cart.some((o, m) => m !== n && o.serial === s.serial));
     return `<div class="cline"><div><div class="nm">${esc(it.name)}</div><span class="dim num" style="font-size:12px">${fmt(it.sale_price, 1)} × ${num(l.qty)} ${UNITS[it.unit]}</span>${l.od > 0 ? `<br><span class="chip gold plain" style="font-size:11.5px">${esc(l.on)} · −${fmt(l.od, 1)}</span>` : ""}</div><div class="stack" style="gap:6px;align-items:flex-end"><span class="num">${fmt(it.sale_price * l.qty, 1)}</span>${it.serial_required ? `<button class="btn sm ghost" data-act="posDel" data-n="${n}">حذف</button>` : it.unit === "meter" ? `<span class="row" style="gap:4px"><input class="inp num" style="width:80px;padding:4px 8px" type="number" min="0.1" step="0.1" data-mqty="${n}" value="${l.qty}"><button class="btn sm ghost" data-act="posDel" data-n="${n}">✕</button></span>` : `<span class="qty"><button data-act="posQty" data-n="${n}" data-d="-1">−</button><span>${l.qty}</span><button data-act="posQty" data-n="${n}" data-d="1">+</button></span>`}</div>
     ${it.serial_required ? `<div style="grid-column:1/-1" class="row"><span class="dim" style="font-size:12px">المسلسل</span><select class="inp" style="padding:5px 8px;font-size:12.5px;flex:1" data-ser="${n}"><option value="">— اختار —</option>${sers.map(s => `<option ${l.serial === s.serial ? "selected" : ""}>${esc(s.serial)}</option>`).join("")}</select>${it.warranty_months ? `<span class="chip gold plain">${it.warranty_months} شهر ضمان</span>` : ""}</div>` : ""}
     ${it.unit === "meter" ? `<div style="grid-column:1/-1" class="row"><span class="dim" style="font-size:12px">فاقد قص (سم) — اختياري</span><input class="inp num" type="number" min="0" style="width:90px;padding:4px 8px" data-waste="${n}" value="${l.waste || ""}"></div>` : ""}</div>`; }).join("") : `<div class="muted" style="padding:24px 0;text-align:center">امسح أول صنف</div>`}
   ${P.cart.length ? `<div class="stack" style="gap:2px;margin-top:8px"><div class="tot"><span class="muted">الإجمالي</span><span class="num">${fmt(c.gross, 1)}</span></div>
    <div class="tot"><span class="muted">خصم % <span class="dim">(حدّك ${max}%)</span></span><input class="inp num" style="width:70px;padding:4px 8px" type="number" min="0" max="100" id="posDisc" value="${P.disc}"></div>
    ${P.disc > max ? `<div class="warnbox">فوق حدّك — اكتب رمز مدير حدّه أعلى: <input class="inp num" type="password" id="posPin" style="margin-top:6px" value="${esc(P.pin)}"></div>` : ""}
    ${!isSeller ? `<div class="tot"><span class="muted">كوبون</span>${P.coupon ? `<span class="row" style="gap:6px"><span class="chip gold plain">${esc(P.coupon.code)}</span><button class="btn sm ghost" data-act="cpOff">✕</button></span>` : `<span class="row" style="gap:4px;flex-wrap:nowrap"><input class="inp num" id="posCp" style="width:110px;padding:4px 8px;text-transform:uppercase" placeholder="الكود"><button class="btn sm" data-act="cpOn">تطبيق</button></span>`}</div>${c.cpLow ? `<div class="warnbox" style="font-size:12.5px">الكوبون محتاج فاتورة ${fmt(P.coupon.min_total)} على الأقل.</div>` : ""}` : ""}
    ${c.cdisc ? `<div class="tot up"><span>خصم الكوبون</span><span class="num">−${fmt(c.cdisc, 1)}</span></div>` : ""}
    ${c.odisc ? `<div class="tot up"><span>خصم العروض</span><span class="num">−${fmt(c.odisc, 1)}</span></div>` : ""}${c.mdisc ? `<div class="tot up"><span>الخصم اليدوي</span><span class="num">−${fmt(c.mdisc, 1)}</span></div>` : ""}${c.ofrWait ? `<div class="tot dim"><span>بيحسب العروض…</span><span></span></div>` : ""}
    ${c.vatOn ? `<div class="tot dim"><span>${c.incl ? "منها ضريبة القيمة المضافة" : "ضريبة القيمة المضافة"}</span><span class="num">${fmt(c.vat, 1)}</span></div>` : ""}
    <div class="tot big"><span>المطلوب</span><span class="num">${fmt(c.total, 1)}</span></div>${c.dep ? `<div class="tot up"><span>العربون المدفوع (${esc(P.res.no)})</span><span class="num">−${fmt(c.dep, 1)}</span></div><div class="tot"><b>الباقي على العميل</b><b class="num">${fmt(Math.max(0, c.total - c.dep), 1)}</b></div>` : ""}</div>
   <div class="field"><label>العميل ${P.cart.some(l => l.it.serial_required) || +P.pay.inst > 0 ? `<b style="color:var(--warn)">— إجباري للأجهزة</b>` : `<span class="dim">(اختياري)</span>`}</label><div class="row" style="flex-wrap:nowrap"><input class="inp" id="cName" placeholder="الاسم" value="${esc(P.cust.name)}"><input class="inp num" id="cPhone" placeholder="01xxxxxxxxx" value="${esc(P.cust.phone)}" inputmode="tel"></div></div>
   <div class="field"><label>البائع <span class="dim">(للعمولة)</span></label><select class="inp" id="posSeller"><option value="">— بدون —</option>${(S.dir || []).filter(x => x.active && x.role_id === "seller" && (!x.location_id || x.location_id === loc)).map(x => `<option value="${x.id}" ${P.seller === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
   ${isSeller ? `<div id="posErr"></div><div class="row" style="flex-wrap:nowrap"><button class="btn ghost" data-act="posClear">تفريغ</button><button class="btn gold" style="flex:1" data-act="heldSend">إرسال للكاشير · <span class="num">${fmt(c.total, 1)}</span></button></div>` : `<div class="field"><label>الدفع <button class="btn sm ghost" data-act="payAll" style="margin-inline-start:6px">الكل نقدي</button></label><div class="grid g2" style="gap:6px">${Object.entries(PAYN).map(([k, n]) => `<label class="row" style="gap:6px;flex-wrap:nowrap"><span class="dim" style="width:64px;font-size:12.5px">${n}</span><input class="inp num" type="number" min="0" data-pay="${k}" value="${esc(P.pay[k])}"></label>`).join("")}</div>
    ${(S.finPl || []).some(p => p.active) ? `<div class="row" style="gap:6px;flex-wrap:nowrap;margin-top:6px"><span class="dim" style="width:64px;font-size:12.5px">تقسيط</span><select class="inp" id="posPlan" style="flex:2;font-size:12.5px"><option value="">— الشركة والخطة —</option>${S.finPl.filter(p => p.active && (S.finCo.find(c0 => c0.id === p.company_id) || {}).active).map(p => `<option value="${p.id}" ${+P.plan === p.id ? "selected" : ""}>${esc(planName(p.id))} — ${p.payer === "store" ? "على المحل " + (+p.rate) + "%" : "على العميل"}</option>`).join("")}</select><input class="inp num" type="number" min="0" data-pay="inst" value="${esc(P.pay.inst)}" style="flex:1"></div>${P.plan && +P.pay.inst > 0 ? (() => { const pl = S.finPl.find(x => x.id === +P.plan), co = S.finCo.find(x => x.id === pl.company_id), cm = pl.payer === "store" ? +P.pay.inst * pl.rate / 100 : 0; return `<div class="${cm ? "warnbox" : "okbox"}" style="font-size:12.5px;margin-top:6px">الشركة هتحوّل ${fmt(+P.pay.inst - cm, 1)} بعد ${co.transfer_days} يوم${cm ? " · عمولة على المحل " + fmt(cm, 1) : ""}</div>`; })() : ""}` : ""}
    ${c.paid ? `<div class="tot" style="margin-top:6px"><span class="muted">${c.change >= 0 ? "الباقي للعميل" : "ناقص"}</span><span class="num" style="color:${c.change >= 0 ? "var(--ok)" : "var(--bad)"}">${fmt(Math.abs(c.change), 1)}</span></div>` : ""}</div>
   <div id="posErr"></div>
   ${P.res ? `<div class="okbox" style="font-size:12.5px">بتكمّل الحجز <b>${esc(P.res.no)}</b> لـ ${esc(P.res.customer)} — الأصناف المحجوزة متاحة للفاتورة دي بس. <button class="btn sm ghost" data-act="resLeave">إلغاء التكميل</button></div>` : `<div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" style="flex:1" data-act="resNew">حجز بعربون</button><button class="btn sm" style="flex:1" data-act="qtNew">عرض سعر</button></div>`}
   <div class="row" style="flex-wrap:nowrap"><button class="btn ghost" data-act="posClear">تفريغ</button><button class="btn gold" style="flex:1" data-act="posPay">إتمام البيع · <span class="num">${fmt(Math.max(0, c.total - c.dep), 1)}</span></button></div>`}` : ""}</div></div>`;
  return h;
};
H.pos = () => {
  const qi = $("#posQ"); if (!qi) return;
  { const sig = cartSig(); if (P.cart.length && P.ofrSig !== sig && P.ofrReq !== sig) ofrFetch(sig); }
  qi.focus();
  qi.oninput = () => { P.q = qi.value; const p = qi.selectionStart; render(); const n = $("#posQ"); n.focus(); n.setSelectionRange(p, p); };
  qi.onkeydown = e => { if (e.key !== "Enter") return; const v = qi.value.trim(); const it = byCode(v); if (it) { posAdd(it.id); P.q = ""; render(); } else if (v) toast("مفيش صنف بالباركود ده.", true); };
  const dsc = $("#posDisc"); if (dsc) dsc.onchange = () => { P.disc = Math.max(0, Math.min(100, +dsc.value || 0)); render(); };
  const pin = $("#posPin"); if (pin) pin.oninput = () => { P.pin = pin.value; };
  const cn = $("#cName"), cp = $("#cPhone"); if (cn) { cn.oninput = () => { P.cust.name = cn.value; }; cp.oninput = () => { P.cust.phone = cp.value; }; }
  const sl = $("#posSeller"); if (sl) sl.onchange = () => { P.seller = sl.value; };
  const pp = $("#posPlan"); if (pp) pp.onchange = () => { P.plan = pp.value; if (P.plan && !(+P.pay.inst > 0)) { const c = cartCalc(); P.pay = { cash: "", card: "", insta: "", wallet: "", inst: String(c.total) }; } render(); };
  document.querySelectorAll("[data-pay]").forEach(x => x.onchange = () => { P.pay[x.dataset.pay] = x.value; render(); });
  document.querySelectorAll("[data-ser]").forEach(x => x.onchange = () => { P.cart[+x.dataset.ser].serial = x.value; });
  document.querySelectorAll("[data-mqty]").forEach(x => x.onchange = () => { P.cart[+x.dataset.mqty].qty = Math.max(0.1, +x.value || 0.1); render(); });
  document.querySelectorAll("[data-waste]").forEach(x => x.onchange = () => { P.cart[+x.dataset.waste].waste = Math.max(0, +x.value || 0); });
};
async function posShift() {
  try { const [sh, ser] = await Promise.all([rpc("shift_current", { p_token: T() }), q("serials", "serial,item_id", x => x.eq("location_id", S.sess.device.location_id).eq("status", "in_stock").limit(5000)), loadDir(), loadFin()]);
    P.shift = sh; P.serials = ser; } catch (e) { P.shift = null; toast(errText(e), true); }
  if (S.route === "pos") render();
}
function posAdd(id) {
  const it = S.items.find(i => i.id === id); if (!it) return;
  const st = window.MZAV ? window.MZAV(it, S.sess.device.location_id) : "on";
  if (st !== "on" && !(S.sess.role.id === "owner" || has("overrideLocked"))) return toast(st === "hidden" ? "الصنف ده مخفي في المعرض ده." : "الصنف ده مقفول للبيع دلوقتي.", true);
  if (it.serial_required) { P.cart.push({ id, qty: 1, serial: "" }); return; }
  const l = P.cart.find(x => x.id === id && !x.serial); if (l) l.qty = +(l.qty + 1).toFixed(3); else P.cart.push({ id, qty: 1 });
}
async function posPay(btn) {
  if (P.ofrSig !== cartSig()) { busy(btn, true); await ofrFetch(cartSig()); render(); return toast("اتحسبت العروض — راجع المبلغ واضغط إتمام البيع تاني."); }
  const c = cartCalc(), err = m => ($("#posErr").innerHTML = `<div class="warnbox">${esc(m)}</div>`);
  if (P.cart.some(l => l.it.serial_required && !l.serial)) return err("اختار المسلسل لكل جهاز.");
  if (P.cart.some(l => l.it.serial_required) && (!P.cust.name.trim() || !/^01\d{9}$/.test(P.cust.phone.trim()))) return err("الأجهزة محتاجة اسم العميل وموبايل صحيح.");
  if (+P.pay.inst > 0 && !P.plan) return err("اختار شركة التقسيط والخطة.");
  if (+P.pay.inst > 0 && (!P.cust.name.trim() || !/^01\d{9}$/.test(P.cust.phone.trim()))) return err("التقسيط محتاج اسم العميل وموبايل صحيح.");
  if (P.cust.phone && !/^01\d{9}$/.test(P.cust.phone.trim())) return err("رقم الموبايل غلط.");
  if (c.paid < c.total - 0.004) return err("المدفوع أقل من المطلوب.");
  const nonCash = c.paid - (+P.pay.cash || 0); if (nonCash > c.total + 0.004) return err(c.dep > c.total ? "العربون أكبر من الفاتورة — ألغي الحجز ورجّع العربون بدل كده." : "الفيزا والمحافظ أكتر من المطلوب — الباقي بيرجع من النقدي بس.");
  if (P.res && !navigator.onLine) return err("تكميل الحجز محتاج إنترنت.");
  const p = { client_uuid: uuid(), lines: P.cart.map(l => ({ item_id: l.id, qty: l.qty, serial: l.serial || null, cut_waste_m: l.waste || null })), discount_pct: P.disc, offers_seen: c.ofrOk, approver_pin: P.disc > (+S.sess.role.max_discount_pct || 0) ? P.pin : null,
    customer: P.cust.phone ? { name: P.cust.name.trim(), phone: P.cust.phone.trim() } : null, seller_id: P.seller || null,
    payments: Object.entries(P.pay).filter(([, v]) => +v > 0).map(([m, v]) => m === "inst" ? { method: m, amount: +v, plan_id: +P.plan } : { method: m, amount: +v }).concat(P.res ? [{ method: "deposit", amount: +P.res.deposit }] : []), held_id: P.heldId || null,
    coupon: P.coupon && !c.cpLow ? P.coupon.code : null, reservation_id: P.res ? P.res.id : null };
  busy(btn, true);
  try { const r = await rpc("sale_post", { p_token: T(), p }); posDone(r, c); }
  catch (e) {
    if (/fetch|network/i.test(e.message || "")) { const a = qGet(); a.push(p); qSet(a); posDone({ no: "محفوظة على الجهاز", total: c.total, change: c.change, offline: true }, c); }
    else { err(errText(e)); busy(btn, false); }
  }
}
/* receipt lines: items of the same offer sit together in a box with the offer name, its discount and the offer price,
   so a later return is easy to recognise */
function rcptLines(lines, offers) {
  const one = x => `<div class="r"><span>${esc(x.n)} × ${num(x.q)}${x.sn ? `<br><span class="dim">SN ${esc(x.sn)}</span>` : ""}</span><span>${fmt(x.p * x.q, 1)}</span></div>`;
  if (!offers) return lines.map(one).join("");
  const groups = {}, order = [];
  lines.forEach(x => { const k = x.on || ""; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(x); });
  return order.map(k => { const g = groups[k]; if (!k) return g.map(one).join("");
    const od = g.reduce((a, x) => a + (+x.od || 0), 0), gross = g.reduce((a, x) => a + x.p * x.q, 0);
    return `<div style="border:1.5px solid #000;border-radius:5px;padding:4px 6px;margin:5px 0"><div style="font-weight:700;font-size:11.5px;margin-bottom:2px">★ عرض: ${esc(k)}</div>${g.map(one).join("")}${od > 0 ? `<div class="r"><span>خصم العرض</span><span>−${fmt(od, 1)}</span></div>` : ""}<div class="r" style="border-top:1px dotted #000;padding-top:2px"><b>سعر العرض</b><b>${fmt(gross - od, 1)}</b></div></div>`; }).join("");
}
async function posDone(r, c) {
  const lines = P.cart.map(l => ({ n: l.it.name, q: l.qty, u: UNITS[l.it.unit], p: l.it.sale_price, sn: l.serial, od: l.od, on: l.on }));
  const pays = Object.entries(P.pay).filter(([, v]) => +v > 0).concat(P.res ? [["deposit", P.res.deposit]] : []), cpDone = P.coupon && +r.coupon_disc > 0 ? P.coupon.code : null; P.planDone = P.plan; P.coupon = null; P.res = null;
  const custName = P.cust.phone ? P.cust.name.trim() : "", hasCust = !!P.cust.phone;
  P.cart = []; P.disc = 0; P.pin = ""; P.cust = { name: "", phone: "" }; P.seller = ""; P.plan = ""; P.heldId = null; P.heldNo = null; P.pay = { cash: "", card: "", insta: "", wallet: "", inst: "" };
  // which visit is this for the customer → the welcome line on the receipt (never holds the receipt more than 2.5 s)
  let visit = null;
  if (hasCust && !r.offline && r.id) visit = await Promise.race([rpc("sale_visit", { p_token: T(), p_sale: r.id }).catch(() => null), new Promise(res => setTimeout(() => res(null), 2500))]);
  const extra = window.MZ.cx ? window.MZ.cx.rcptExtra(visit, custName) : "";
  modal(`<h2>${r.offline ? "اتحفظت على الجهاز" : "تم البيع"}</h2>${r.offline ? `<div class="warnbox">مفيش نت — الفاتورة اتحفظت على الجهاز وهتتبعت لوحدها أول ما النت يرجع.</div>` : ""}
   <div class="receipt" id="rcpt">${RC().logo !== false && LOGO() ? `<div style="text-align:center;margin-bottom:4px">${logoImg("16mm", "max-width:44mm")}</div>` : ""}${RC().name !== false ? `<div style="text-align:center;font-family:var(--f-display);font-size:16px">${esc(S.store.name)}</div>` : ""}${RC().addr || RC().phone ? `<div style="text-align:center" class="dim">${esc([RC().addr, RC().phone].filter(Boolean).join(" · "))}</div>` : ""}<div style="text-align:center" class="dim">${esc(locName(S.sess.device.location_id))} · ${new Date().toLocaleString("ar-EG")}</div><div style="text-align:center" class="num">${esc(r.no)}</div><div class="hr" style="margin:8px 0"></div>
   ${rcptLines(lines, !r.offline)}
   ${c.mdisc ? `<div class="r"><span>خصم</span><span>−${fmt(c.mdisc, 1)}</span></div>` : ""}${cpDone ? `<div class="r"><span>كوبون ${esc(cpDone)}</span><span>−${fmt(r.coupon_disc, 1)}</span></div>` : ""}${c.vatOn ? `<div class="r"><span>ض.ق.م</span><span>${fmt(r.vat != null ? r.vat : c.vat, 1)}</span></div>` : ""}
   <div class="hr" style="margin:8px 0"></div><div class="r"><b>الإجمالي</b><b>${fmt(r.total, 1)}</b></div>${pays.map(([k, v]) => `<div class="r"><span>${k === "inst" ? "تقسيط · " + esc(planName(P.planDone)) : k === "points" ? "نقاط ولاء" : k === "deposit" ? "العربون" : PAYN[k]}</span><span>${fmt(v, 1)}</span></div>`).join("")}${(r.change || 0) > 0 ? `<div class="r"><span>الباقي</span><span>${fmt(r.change, 1)}</span></div>` : ""}${RC().savings !== false && (c.odisc + c.mdisc + (+r.coupon_disc || 0)) > 0 && !r.offline ? `<div style="text-align:center;margin-top:6px">وفّرت ${fmt(c.odisc + c.mdisc + (+r.coupon_disc || 0), 1)}</div>` : ""}${extra}${RC().footer ? `<div style="text-align:center;margin-top:6px" class="dim">${esc(RC().footer)}</div>` : ""}</div>
   <div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px">${!r.offline && r.id && can("delivery", "a") ? `<button class="btn ghost" data-act="dlvFromSale" data-id="${r.id}">${ico("delivery")} طلب توصيل</button>` : ""}<button class="btn" data-act="rcptPrint">طباعة</button><button class="btn gold" data-act="rcptOk">فاتورة جديدة</button></div>`);
  if (window.MZPA && MZPA.auto() && MZPA.can("sale") && $("#rcpt")) MZPA.receipt($("#rcpt").innerHTML).catch(() => toast("الإيصال ما اتطبعش لوحده — دوس «طباعة».", true));
  loadItems().then(() => { P.shift = undefined; }).catch(() => {});
}
function handModal() {
  const den = [200, 100, 50, 20, 10, 5, 1];
  modal(`<h2>تسليم الوردية</h2><p class="muted" style="margin:0 0 10px">عدّ الدرج بالفئات واكتب إجمالي الفيزا والإنستاباي والمحافظ من الأجهزة. الفرق بيظهر بعد التسليم.</p><div class="stack">
   <div class="grid g2" style="gap:6px">${den.map(d => `<label class="row" style="gap:6px;flex-wrap:nowrap"><span class="num" style="width:44px">${d}</span>×<input class="inp num" type="number" min="0" data-den="${d}" value="0"></label>`).join("")}</div>
   <div class="row between"><span class="muted">إجمالي النقدي المعدود</span><b class="num" id="hTot">0</b></div>
   <div class="grid g2" style="gap:6px">${["card", "insta", "wallet"].map(k => `<div class="field"><label>${PAYN[k]}</label><input class="inp num" type="number" min="0" data-hp="${k}" value="0"></div>`).join("")}</div>
   <div class="field"><label>سبب الفرق (إجباري لو فيه فرق)</label><input class="inp" id="hRsn"></div><div id="hErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="shHandGo">تسليم</button></div></div>`);
  document.querySelectorAll("[data-den]").forEach(x => x.oninput = () => { $("#hTot").textContent = num([...document.querySelectorAll("[data-den]")].reduce((a, y) => a + (+y.dataset.den) * (+y.value || 0), 0)); });
}
async function handGo(btn) {
  const counted = { den: {}, card: 0, insta: 0, wallet: 0 }; document.querySelectorAll("[data-den]").forEach(x => { counted.den[x.dataset.den] = +x.value || 0; }); document.querySelectorAll("[data-hp]").forEach(x => { counted[x.dataset.hp] = +x.value || 0; });
  busy(btn, true);
  try { const r = await rpc("shift_handover", { p_token: T(), p_counted: counted, p_reason: $("#hRsn").value.trim() || null });
    modal(`<h2>اتسلّمت الوردية</h2><div class="stack"><div class="row between"><span>النقدي المفروض</span><b class="num">${fmt(r.expected, 1)}</b></div><div class="row between"><span>المعدود</span><b class="num">${fmt(r.counted, 1)}</b></div><div class="row between"><span>الفرق</span><b class="num" style="color:${+r.diff < 0 ? "var(--bad)" : +r.diff > 0 ? "var(--warn)" : "var(--ok)"}">${fmt(r.diff, 1)}</b></div><p class="muted">التسليم مستني اعتماد مدير الفرع أو مدير الشيفت من شاشة «الخزنة والورديات».</p><button class="btn gold" data-act="mClose">تمام</button></div>`);
    P.shift = undefined; render(); }
  catch (e) { $("#hErr").innerHTML = `<div class="warnbox">${esc(errText(e))}${/REASON/.test(e.message) ? " فيه فرق بين المعدود والمسجّل." : ""}</div>`; busy(btn, false); }
}

/* ---------- cash & shifts (approvals, today's invoices, balances) ---------- */
V.cash = () => { let h = header(); const C = S.cash; if (!C) { setTimeout(loadCash, 0); return h + `<div class="spin"></div>`; }
  const pend = C.shifts.filter(s => s.status === "handed"), canAp = can("close", "p");
  h += `<div class="grid g4">${C.accts.map((a, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${esc(a.name)}</div><div class="val">${fmt(a.bal)}</div><div class="dim" style="font-size:12px">${a.kind === "bank" ? "رصيد الحساب" : "نقدي"}</div></div>`).join("")}${Math.abs(C.elec || 0) >= 0.01 ? `<div class="card kpi rise"><div class="lbl">فيزا وإنستاباي ومحافظ</div><div class="val">${fmt(C.elec)}</div><div class="dim" style="font-size:12px">اتحصّلت في المعارض — بتتحسب مع البنوك في الحسابات</div></div>` : ""}</div>`;
  h += `<div class="card rise"><h3>الورديات</h3><div class="tw"><table><thead><tr><th>المكان</th><th>الكاشير</th><th>من</th><th>إلى</th><th class="n">المفروض</th><th class="n">المعدود</th><th class="n">الفرق</th><th>الحالة</th><th></th></tr></thead><tbody>${C.shifts.map(s => `<tr><td>${esc(locName(s.location_id))}</td><td>${esc(who(s.cashier_id))}</td><td class="num dim">${new Date(s.opened_at).toLocaleString("ar-EG")}</td><td class="num dim">${s.closed_at ? new Date(s.closed_at).toLocaleString("ar-EG") : "—"}</td><td class="n">${s.expected_cash != null ? fmt(s.expected_cash, 1) : "—"}</td><td class="n">${s.counted_cash != null ? fmt(s.counted_cash, 1) : "—"}</td><td class="n" style="color:${+s.diff < 0 ? "var(--bad)" : +s.diff > 0 ? "var(--warn)" : ""}">${s.diff != null ? fmt(s.diff, 1) : "—"}${s.diff_reason ? `<br><span class="dim" style="font-size:12px">${esc(s.diff_reason)}</span>` : ""}</td><td><span class="chip ${s.status === "open" ? "info" : s.status === "handed" ? "warn" : "ok"}">${{ open: "مفتوحة", handed: "مستنية اعتماد", approved: "معتمدة" }[s.status]}</span></td><td>${s.status === "handed" && canAp ? `<button class="btn sm gold" data-act="shAppr" data-id="${s.id}">اعتماد</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9" class="muted">لسه مفيش ورديات.</td></tr>`}</tbody></table></div>${pend.length && !canAp ? `<p class="dim">في ${pend.length} تسليم مستني اعتماد مدير.</p>` : ""}</div>`;
  h += `<div class="card rise"><h3>فواتير آخر ٣ أيام</h3><div class="tw"><table><thead><tr><th>الفاتورة</th><th>المكان</th><th>الكاشير</th><th>الوقت</th><th class="n">الإجمالي</th>${seeCost() ? `<th class="n">الربح</th>` : ""}<th>الحالة</th><th></th></tr></thead><tbody>${C.sales.map(x => `<tr><td class="num">${esc(x.no)}</td><td>${esc(locName(x.location_id))}</td><td>${esc(who(x.cashier_id))}</td><td class="num dim">${new Date(x.created_at).toLocaleString("ar-EG")}</td><td class="n">${fmt(x.total, 1)}</td>${seeCost() ? `<td class="n">${fmt(x.total - x.vat - x.cost, 1)}</td>` : ""}<td>${x.status === "void" ? `<span class="chip bad">ملغاة</span><br><span class="dim" style="font-size:12px">${esc(x.void_reason || "")}</span>` : `<span class="chip ok">سارية</span>`}</td><td class="row" style="gap:4px;flex-wrap:nowrap">${x.status === "posted" && can("returns", "a") ? `<button class="btn sm ghost" data-act="saleRet" data-id="${x.id}">مرتجع</button>` : ""}${x.status === "posted" && (["owner", "gm"].includes(S.sess.role.id) || has("voidInvoice") || has("voidRequest")) ? `<button class="btn sm ghost" data-act="saleVoid" data-id="${x.id}" data-no="${esc(x.no)}">إلغاء</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="muted">لسه مفيش فواتير.</td></tr>`}</tbody></table></div></div>`;
  return h; };
async function loadCash() {
  try { await loadDir(); const since = new Date(Date.now() - 3 * 864e5).toISOString();
    const [accts, moves, shifts, sales] = await Promise.all([q("cash_accounts", "*", x => x.order("id")), q("cash_moves", "account_id,amount,method", x => x.limit(100000)), q("shifts", "*", x => x.order("opened_at", { ascending: false }).limit(60)), q("sales", "*", x => x.gte("created_at", since).order("created_at", { ascending: false }).limit(300))]);
    /* drawers hold only the cash; card / InstaPay / wallet money taken at the till belongs with the bank, the same as in the ledger */
    accts.forEach(a => { a.bal = moves.filter(m => m.account_id === a.id && (a.kind !== "drawer" || m.method === "cash")).reduce((s, m) => s + +m.amount, 0); });
    const dr = new Set(accts.filter(a => a.kind === "drawer").map(a => a.id)), elec = moves.filter(m => dr.has(m.account_id) && m.method !== "cash").reduce((s, m) => s + +m.amount, 0);
    S.cash = { accts, shifts, sales, elec }; if (S.route === "cash") render(); } catch (e) { toast(errText(e), true); }
}
function apprModal(s) {
  modal(`<h2>اعتماد تسليم الوردية</h2><div class="stack"><div class="row between"><span>الكاشير</span><b>${esc(who(s.cashier_id))}</b></div><div class="row between"><span>المعدود</span><b class="num">${fmt(s.counted_cash, 1)}</b></div><div class="row between"><span>الفرق</span><b class="num">${fmt(s.diff, 1)}</b></div>
   <div class="field"><label>توريد للخزنة الرئيسية من الدرج (والباقي يفضل فكّة)</label><input class="inp num" id="aTr" type="number" min="0" max="${s.counted_cash}" value="${Math.max(0, (+s.counted_cash || 0) - (+s.opening_float || 0))}"></div><div id="aErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="shApprGo" data-id="${s.id}">اعتماد</button></div></div>`);
}
function voidModal(id, no) {
  const direct = ["owner", "gm"].includes(S.sess.role.id) || has("voidInvoice");
  modal(`<h2>إلغاء الفاتورة ${esc(no)}</h2><p class="muted">البضاعة هترجع المخزون بتكلفتها، والمسلسلات ترجع متاحة، والمبلغ يتسجّل مرتجع على الدرج. الفاتورة الأصلية بتفضل ظاهرة كملغاة.</p><div class="stack">
   <div class="field"><label>السبب</label><input class="inp" id="vRsn"></div>${direct ? "" : `<div class="field"><label>رمز المدير العام أو المالك للموافقة</label><input class="inp num" type="password" id="vPin"></div>`}<div id="vErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn danger" data-act="saleVoidGo" data-id="${id}">إلغاء الفاتورة</button></div></div>`);
}

/* ---------- transfers ---------- */
const TST = { requested: ["مطلوب", "info"], approved: ["معتمد", "gold"], shipped: ["في الطريق", "warn"], received: ["اتستلم", "ok"], cancelled: ["ملغي", "plain"] };
const myLoc = l => S.sess.role.scope_all_locations || !S.sess.staff.location_id || S.sess.staff.location_id === l;
V.transfers = () => { let h = header(can("transfers", "a") ? `<button class="btn gold" data-act="trNew">${ico("plus")} طلب تحويل</button>` : ""); const L = S.tr; if (!L) { setTimeout(loadTr, 0); return h + `<div class="spin"></div>`; }
  h += `<div class="tw rise"><table><thead><tr><th>الرقم</th><th>من</th><th>إلى</th><th>الأصناف</th><th>الحالة</th><th>بواسطة</th><th></th></tr></thead><tbody>${L.map(t => { const st = TST[t.status]; let act = "";
    if (t.status === "requested" && can("transfers", "p") && myLoc(t.from_location)) act = `<button class="btn sm gold" data-act="trAppr" data-id="${t.id}">اعتماد</button>`;
    else if (t.status === "approved" && can("transfers", "a") && myLoc(t.from_location)) act = `<button class="btn sm gold" data-act="trShip" data-id="${t.id}">شحن</button>`;
    else if (t.status === "shipped" && can("transfers", "a") && myLoc(t.to_location)) act = `<button class="btn sm gold" data-act="trRecv" data-id="${t.id}">استلام</button>`;
    return `<tr><td class="num">${esc(t.no)}<br><span class="dim" style="font-size:12px">${new Date(t.created_at).toLocaleString("ar-EG")}</span></td><td>${esc(locName(t.from_location))}</td><td>${esc(locName(t.to_location))}</td><td>${t.lines.map(l => `${esc((S.items.find(i => i.id === l.item_id) || {}).name || "—")} × ${num(l.qty)}${l.qty_received != null && +l.qty_received !== +l.qty ? ` <span style="color:var(--bad)">(وصل ${num(l.qty_received)})</span>` : ""}`).join("<br>")}${t.note ? `<br><span class="dim" style="font-size:12px">${esc(t.note)}</span>` : ""}</td><td><span class="chip ${st[1]}">${st[0]}</span></td><td>${esc(who(t.requested_by))}</td><td>${act}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">لسه مفيش تحويلات.</td></tr>`}</tbody></table></div>
  <div class="okbox rise">التحويل بيمشي: طلب ← اعتماد من مكان الإرسال ← شحن (البضاعة بتخرج بتكلفتها) ← استلام في المكان التاني (بنفس التكلفة). لو وصل أقل، العجز بيتسجّل بسبب.</div>`;
  return h; };
async function loadTr() { try { await loadDir(); const [t, l] = await Promise.all([q("transfers", "*", x => x.order("created_at", { ascending: false }).limit(200)), q("transfer_lines", "*", x => x.limit(5000))]); t.forEach(x => x.lines = l.filter(y => y.transfer_id === x.id)); S.tr = t; if (S.route === "transfers") render(); } catch (e) { toast(errText(e), true); } }
function trNewModal() {
  S.trd = { from: S.locs.find(l => l.kind === "warehouse") ? S.locs.find(l => l.kind === "warehouse").id : S.locs[0].id, to: S.sess.staff.location_id || S.locs[0].id, lines: [], note: "" }; trDraw();
}
async function trDraw() {
  const d = S.trd; if (!d.ser || d.serFrom !== d.from) { d.ser = await q("serials", "serial,item_id", x => x.eq("location_id", d.from).eq("status", "in_stock").limit(5000)).catch(() => []); d.serFrom = d.from; }
  modal(`<h2>طلب تحويل</h2><div class="stack" style="margin-top:10px"><div class="grid g2"><div class="field"><label>من</label><select class="inp" id="tFrom">${S.locs.map(l => `<option value="${l.id}" ${d.from === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div><div class="field"><label>إلى</label><select class="inp" id="tTo">${S.locs.map(l => `<option value="${l.id}" ${d.to === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div></div>
   <div class="row" style="gap:6px;flex-wrap:nowrap"><select class="inp" id="tItem" style="flex:2">${S.items.filter(i => stockOf(i.id, d.from) > 0).map(i => `<option value="${i.id}">${esc(i.name)} — متاح ${num(stockOf(i.id, d.from))}</option>`).join("")}</select><input class="inp num" id="tQty" type="number" min="0.1" step="any" value="1" style="width:80px"><button class="btn sm" data-act="trAddLine">${ico("plus")}</button></div>
   ${d.lines.map((l, n) => { const it = S.items.find(i => i.id === l.item_id); return `<div class="row between" style="border-bottom:1px solid var(--line);padding:6px 0"><span>${esc(it.name)} × <b class="num">${num(l.qty)}</b>${it.serial_required ? `<br><select class="inp" multiple size="3" data-trser="${n}" style="margin-top:4px">${d.ser.filter(s => s.item_id === it.id).map(s => `<option ${(l.serials || []).includes(s.serial) ? "selected" : ""}>${esc(s.serial)}</option>`).join("")}</select><span class="dim" style="font-size:12px">اختار ${num(l.qty)} مسلسل (Ctrl للاختيار المتعدد)</span>` : ""}</span><button class="btn sm ghost" data-act="trDelLine" data-n="${n}">✕</button></div>`; }).join("")}
   <div class="field"><label>ملاحظة</label><input class="inp" id="tNote" value="${esc(d.note)}"></div><div id="tErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="trSave">إرسال الطلب</button></div></div>`);
  $("#tFrom").onchange = e => { d.from = +e.target.value; d.lines = []; trDraw(); }; $("#tTo").onchange = e => { d.to = +e.target.value; }; $("#tNote").oninput = e => { d.note = e.target.value; };
  document.querySelectorAll("[data-trser]").forEach(x => x.onchange = () => { d.lines[+x.dataset.trser].serials = [...x.selectedOptions].map(o => o.value); });
}
function trRecvModal(t) {
  modal(`<h2>استلام ${esc(t.no)}</h2><p class="muted">اكتب الكمية اللي وصلت فعلًا لكل صنف.</p><div class="stack">${t.lines.map(l => `<div class="row between"><span>${esc((S.items.find(i => i.id === l.item_id) || {}).name || "—")} <span class="dim">(اتشحن ${num(l.qty)})</span></span><input class="inp num" type="number" min="0" max="${l.qty}" step="any" data-rcv="${l.item_id}" value="${l.qty}" style="width:90px"></div>`).join("")}
   <div class="field"><label>سبب العجز (لو فيه)</label><input class="inp" id="rRsn"></div><div id="rErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="trRecvGo" data-id="${t.id}">تأكيد الاستلام</button></div></div>`);
}
async function opsClick(k, a) {
  const wrap = async (fn, after) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { toast(errText(e), true); busy(a, false); } };
  if (k === "posDep") { P.dep = a.dataset.k; render(); }
  else if (k === "posAdd") { posAdd(a.dataset.id); render(); }
  else if (k === "posQty") { const l = P.cart[+a.dataset.n]; l.qty += +a.dataset.d; if (l.qty <= 0) P.cart.splice(+a.dataset.n, 1); render(); }
  else if (k === "posDel") { P.cart.splice(+a.dataset.n, 1); render(); }
  else if (k === "posClear") { P.cart = []; P.disc = 0; P.plan = ""; P.coupon = null; P.res = null; P.heldId = null; P.heldNo = null; P.pay = { cash: "", card: "", insta: "", wallet: "", inst: "" }; render(); }
  else if (k === "payAll") { const c = cartCalc(); P.pay = { cash: String(Math.max(0, Math.round((c.total - c.dep) * 100) / 100)), card: "", insta: "", wallet: "", inst: "" }; P.plan = ""; render(); }
  else if (k === "posPay") posPay(a);
  else if (k === "rcptPrint") { if (window.MZPA && MZPA.can("sale")) { MZPA.receipt($("#rcpt").innerHTML).then(() => toast("اتبعت للطابعة.")).catch(e => { MZPA.st.ok = false; toast("الطباعة الصامتة فشلت — دوس «طباعة» تاني وهتفتح نافذة الطباعة.", true); }); return; } const w = window.open("", "_blank", "width=380,height=600"); if (!w) return toast("المتصفح منع نافذة الطباعة.", true); w.document.write(`<html dir="rtl"><head><title>إيصال</title><style>body{font-family:Tahoma,Arial;font-size:12px;width:${{ "58": "50mm", "80": "72mm", "A5": "130mm", "A4": "190mm" }[RC().size] || "72mm"};margin:0 auto}.r{display:flex;justify-content:space-between;gap:8px;margin:3px 0}.dim{color:#666}.hr{border-top:1px dashed #000}</style></head><body>${$("#rcpt").innerHTML}<script>print();setTimeout(()=>close(),500)<\/script></body></html>`); w.document.close(); }
  else if (k === "rcptOk") { closeModal(); render(); }
  else if (k === "shOpen") wrap(() => rpc("shift_open", { p_token: T(), p_float: +$("#shFloat").value || 0 }), async () => { P.shift = undefined; toast("الوردية اتفتحت."); render(); });
  else if (k === "shHand") handModal();
  else if (k === "shHandGo") handGo(a);
  else if (k === "shAppr") apprModal(S.cash.shifts.find(s => s.id === a.dataset.id));
  else if (k === "shApprGo") wrap(() => rpc("shift_approve", { p_token: T(), p_shift: a.dataset.id, p_to_treasury: +$("#aTr").value || 0 }), async () => { closeModal(); toast("اتعتمد."); S.cash = null; render(); });
  else if (k === "saleVoid") voidModal(a.dataset.id, a.dataset.no);
  else if (k === "saleVoidGo") wrap(() => rpc("sale_void", { p_token: T(), p_sale: a.dataset.id, p_reason: $("#vRsn").value.trim(), p_approver_pin: ($("#vPin") || {}).value || null }), async () => { closeModal(); toast("الفاتورة اتلغت."); S.cash = null; await loadItems(); render(); });
  else if (k === "trNew") trNewModal();
  else if (k === "trAddLine") { const id = $("#tItem").value, qy = +$("#tQty").value; if (!id || !(qy > 0)) return; if (qy > stockOf(id, S.trd.from)) return toast("الكمية أكتر من المتاح.", true); const it = S.items.find(i => i.id === id); if (it.serial_required && qy % 1) return toast("الأجهزة بالعدد.", true); const ex = S.trd.lines.find(l => l.item_id === id); if (ex) ex.qty += qy; else S.trd.lines.push({ item_id: id, qty: qy, serials: [] }); trDraw(); }
  else if (k === "trDelLine") { S.trd.lines.splice(+a.dataset.n, 1); trDraw(); }
  else if (k === "trSave") { const d = S.trd; if (d.from === d.to) return ($("#tErr").innerHTML = `<div class="warnbox">اختار مكانين مختلفين.</div>`); if (!d.lines.length) return ($("#tErr").innerHTML = `<div class="warnbox">ضيف صنف.</div>`);
    for (const l of d.lines) { const it = S.items.find(i => i.id === l.item_id); if (it.serial_required && (l.serials || []).length !== l.qty) return ($("#tErr").innerHTML = `<div class="warnbox">اختار ${num(l.qty)} مسلسل لـ ${esc(it.name)}.</div>`); }
    wrap(() => rpc("transfer_create", { p_token: T(), p_from: d.from, p_to: d.to, p_lines: d.lines.map(l => { const it = S.items.find(i => i.id === l.item_id); return it.serial_required ? { item_id: l.item_id, qty: l.qty, serials: l.serials } : { item_id: l.item_id, qty: l.qty }; }), p_note: d.note || null }), async () => { closeModal(); toast("الطلب اتبعت."); S.tr = null; render(); }); }
  else if (k === "trAppr") wrap(() => rpc("transfer_approve", { p_token: T(), p_id: a.dataset.id }), async () => { toast("اتعتمد."); S.tr = null; render(); });
  else if (k === "trShip") wrap(() => rpc("transfer_ship", { p_token: T(), p_id: a.dataset.id }), async () => { toast("اتشحن — البضاعة خرجت من المكان."); S.tr = null; await loadItems(); render(); });
  else if (k === "trRecv") trRecvModal(S.tr.find(t => t.id === a.dataset.id));
  else if (k === "trRecvGo") { const rec = {}; document.querySelectorAll("[data-rcv]").forEach(x => { rec[x.dataset.rcv] = +x.value; }); wrap(() => rpc("transfer_receive", { p_token: T(), p_id: a.dataset.id, p_received: rec, p_reason: $("#rRsn").value.trim() || null }), async () => { closeModal(); toast("اتستلم."); S.tr = null; await loadItems(); render(); }); }
  else if (k === "mClose") closeModal();
  else return ops2Click(k, a);
  return true;
}


/* =====================================================================
   PHASE 2a · held invoices, instalment companies, partial returns
   ===================================================================== */
async function loadFin() { const [co, pl] = await Promise.all([q("finance_companies", "*", x => x.order("name")), q("finance_plans", "*", x => x.order("months"))]); S.finCo = co; S.finPl = pl; return S.finPl; }
const planName = id => { const p = (S.finPl || []).find(x => x.id === +id); if (!p) return "—"; const c = (S.finCo || []).find(x => x.id === p.company_id) || {}; return `${c.name} · ${p.name}`; };

/* ---------- seller sends, cashier picks up ---------- */
async function heldSend(btn) {
  if (!P.cart.length) return;
  const p = { lines: P.cart.map(l => ({ item_id: l.id, qty: l.qty, serial: l.serial || null, cut_waste_m: l.waste || null })), customer: P.cust.phone ? { name: P.cust.name.trim(), phone: P.cust.phone.trim() } : null, discount_pct: P.disc, seller_id: P.seller || null };
  busy(btn, true);
  try { const r = await rpc("held_create", { p_token: T(), p }); toast(`الفاتورة ${r.no} اتبعتت للكاشير.`); P.cart = []; P.disc = 0; P.cust = { name: "", phone: "" }; render(); }
  catch (e) { toast(errText(e), true); busy(btn, false); }
}
async function heldList() {
  try { await loadDir(); const L = await q("held_sales", "*", x => x.eq("status", "open").eq("location_id", S.sess.device.location_id).order("created_at"));
    modal(`<h2>الفواتير المعلّقة</h2><div class="stack" style="margin-top:10px">${L.map(h => { const n = (h.payload.lines || []).length, tot = (h.payload.lines || []).reduce((a, l) => { const it = S.items.find(i => i.id === l.item_id); return a + (it ? it.sale_price * l.qty : 0); }, 0);
      return `<div class="row between card" style="padding:12px"><span><b class="num">${esc(h.no)}</b> · ${new Date(h.created_at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}${h.seller_id ? ` · <span class="chip gold plain">من ${esc(who(h.seller_id))}</span>` : ""}<br><span class="dim" style="font-size:12.5px">${n} صنف · ${fmt(tot)}${h.payload.customer ? " · " + esc(h.payload.customer.name || "") : ""}</span></span><span class="row" style="gap:6px"><button class="btn sm gold" data-act="heldTake" data-id="${h.id}">استرجاع</button><button class="btn sm ghost" data-act="heldCancel" data-id="${h.id}">إلغاء</button></span></div>`; }).join("") || `<p class="muted">مفيش فواتير معلّقة.</p>`}<button class="btn ghost" data-act="mClose">إغلاق</button></div>`); }
  catch (e) { toast(errText(e), true); }
}
async function heldTake(id) {
  if (P.cart.length) return toast("فضّي الفاتورة الحالية الأول.", true);
  try { const h = await rpc("held_take", { p_token: T(), p_id: id });
    P.cart = (h.lines || []).filter(l => S.items.some(i => i.id === l.item_id)).map(l => ({ id: l.item_id, qty: +l.qty, serial: l.serial || "", waste: l.cut_waste_m || 0 }));
    P.cust = h.customer ? { name: h.customer.name || "", phone: h.customer.phone || "" } : { name: "", phone: "" }; P.seller = h.seller_id || ""; P.disc = +h.discount_pct || 0; P.heldId = id; P.heldNo = h.held_no;
    closeModal(); toast(`اتسترجعت ${h.held_no}.`); render(); }
  catch (e) { toast(errText(e), true); }
}

/* ---------- returns ---------- */
async function returnModal(saleId) {
  try { const [sale, lines] = await Promise.all([q("sales", "*", x => x.eq("id", saleId)), q("sale_lines", "*", x => x.eq("sale_id", saleId))]);
    const done = await q("return_lines", "sale_line_id,qty,returns!inner(sale_id)", x => x.eq("returns.sale_id", saleId)).catch(() => []);
    const oids = [...new Set(lines.map(l => l.offer_id).filter(Boolean))];
    const [ofs, voids] = await Promise.all([oids.length ? q("offers", "id,name,kind,scope", x => x.in("id", oids)).catch(() => []) : [], q("offer_voids", "sale_line_id", x => x.in("sale_line_id", lines.map(l => l.id))).catch(() => [])]);
    const ofOf = id => ofs.find(o => o.id === id), isVoid = id => voids.some(v => v.sale_line_id === id), ratio = +s0(sale).gross - +s0(sale).discount > 0 ? +s0(sale).total / (+s0(sale).gross - +s0(sale).discount) : 1;
    const s = sale[0], dq = id => done.filter(d => d.sale_line_id === id).reduce((a, d) => a + +d.qty, 0), approve = can("returns", "p");
    S._ret = { sale: s, lines };
    modal(`<h2>مرتجع على ${esc(s.no)}</h2><p class="muted" style="margin:0 0 10px">${new Date(s.created_at).toLocaleString("ar-EG")} · ${fmt(s.total, 1)}</p><div class="stack">
     ${lines.map(l => { const it = S.items.find(i => i.id === l.item_id) || { name: "—", unit: "piece" }, left = +l.qty - dq(l.id); const o = l.offer_id && ofOf(l.offer_id), grp = o && (["bxgy", "bundle", "gift", "nth"].includes(o.kind) || o.scope === "invoice"), unit = (+l.unit_price * +l.qty - +l.discount) / +l.qty * ratio;
       return `<div class="card" style="padding:10px;${o ? "border:1.5px solid var(--gold)" : ""}"><div class="row between"><b>${esc(it.name)}</b><span class="dim num">اتباع ${num(l.qty)} · رجع قبل كده ${num(dq(l.id))}</span></div>${l.serial ? `<div class="dim num" style="font-size:12px">SN ${esc(l.serial)}</div>` : ""}
       ${o ? `<div style="margin-top:4px"><span class="chip warn">★ ضمن عرض: ${esc(o.name)}</span> <span class="dim" style="font-size:12.5px">${isVoid(l.id) ? "العرض اتلغى في مرتجع قبل كده — بيرجع بسعره العادي" : `سعره في العرض ${fmt(unit, 1)} للوحدة${grp ? " · عرض على مجموعة: لو رجع جزء منه الخصم بيتلغي على الباقي" : ""}`}</span></div>` : ""}
       ${left > 0 ? `<div class="row" style="gap:8px;margin-top:6px;flex-wrap:nowrap">${!l.serial ? `<button class="btn sm" data-act="swapOpen" data-id="${s.id}" data-l="${l.id}" title="تبديل الصنف ده بصنف تاني">تبديل</button>` : ""}<label class="row" style="gap:6px">الكمية <input class="inp num" type="number" min="0" max="${left}" step="${it.unit === "meter" ? "0.1" : "1"}" data-rq="${l.id}" value="0" style="width:80px"></label><select class="inp" data-rc="${l.id}" style="flex:1"><option value="resell">سليم — يرجع للبيع</option><option value="damaged">تالف — ما يرجعش للمخزون</option></select></div>` : `<div class="dim">رجع بالكامل</div>`}</div>`; }).join("")}
     <div class="grid g2"><div class="field"><label>طريقة رد الفلوس</label><select class="inp" id="rRef">${Object.entries(PAYN).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}<option value="credit">من غير رد فلوس (استبدال)</option></select></div><div class="field"><label>السبب</label><input class="inp" id="rWhy"></div></div>
     <div id="rPrev"></div>${approve ? "" : `<div class="field"><label>رمز المدير للموافقة</label><input class="inp num" type="password" id="rPin"></div>`}<div id="rErr"></div>
     <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">رجوع</button><button class="btn gold" data-act="retGo" data-id="${s.id}">تسجيل المرتجع</button></div></div>`);
    document.querySelectorAll("[data-rq],[data-rc]").forEach(x => { x.oninput = x.onchange = () => retPreview(s.id); }); }
  catch (e) { toast(errText(e), true); }
}
const s0 = a => a[0] || {};
const retPick = () => [...document.querySelectorAll("[data-rq]")].map(x => ({ sale_line_id: +x.dataset.rq, qty: +x.value || 0, condition: document.querySelector(`[data-rc="${x.dataset.rq}"]`).value })).filter(l => l.qty > 0);
/* what the customer gets back, before posting (offer on a group → its discount comes off the refund) */
async function retPreview(saleId) {
  const box = $("#rPrev"), go = document.querySelector("[data-act=retGo]"), lines = retPick(), tag = (S._retTag = (S._retTag || 0) + 1);
  if (!box) return; if (!lines.length) { box.innerHTML = ""; if (go) go.disabled = false; return; }
  try { const r = await rpc("return_preview", { p_token: T(), p_sale: saleId, p_lines: lines }); if (tag !== S._retTag || !$("#rPrev")) return;
    const back = +r.offer_back;
    box.innerHTML = `<div class="${r.blocked ? "warnbox" : "okbox"}" style="margin:0">${back > 0 ? `<div class="row between"><span>قيمة الأصناف بسعر العرض</span><b class="num">${fmt(r.amount, 1)}</b></div>${(r.offers || []).filter(o => +o.back > 0).map(o => `<div class="row between"><span>اتلغى خصم عرض «${esc(o.name)}» على الباقي</span><b class="num">−${fmt(o.back, 1)}</b></div>`).join("")}` : ""}
      <div class="row between"><b>${r.blocked ? "العميل هيبقى عليه" : "هيرجع للعميل"}</b><b class="num">${fmt(Math.abs(+r.net), 1)}</b></div>${r.blocked ? `<div style="margin-top:6px">${esc(ERR.OFFER_RETURN_BLOCKED)}</div>` : ""}</div>`;
    if (go) go.disabled = !!r.blocked; }
  catch (e) { if (tag === S._retTag && $("#rPrev")) box.innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; }
}
async function retGo(btn, saleId) {
  const lines = [...document.querySelectorAll("[data-rq]")].map(x => ({ sale_line_id: +x.dataset.rq, qty: +x.value || 0, condition: document.querySelector(`[data-rc="${x.dataset.rq}"]`).value })).filter(l => l.qty > 0);
  if (!lines.length) return ($("#rErr").innerHTML = `<div class="warnbox">اكتب كمية المرتجع.</div>`);
  busy(btn, true);
  try { const r = await rpc("return_post", { p_token: T(), p_sale: saleId, p_lines: lines, p_reason: $("#rWhy").value.trim(), p_refund: $("#rRef").value, p_approver_pin: ($("#rPin") || {}).value || null });
    closeModal(); toast(`اتسجّل المرتجع ${r.no} بقيمة ${fmt(r.amount, 1)}${+r.offer_back > 0 ? ` (بعد إلغاء خصم عرض ${fmt(r.offer_back, 1)})` : ""}.`); S.cash = null; await loadItems(); render(); }
  catch (e) { $("#rErr").innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; busy(btn, false); }
}

/* ---------- instalment companies screen ---------- */
V.inst = () => { let h = header(can("inst", "e") || ["owner", "gm"].includes(S.sess.role.id) ? `<button class="btn gold" data-act="finCoNew">${ico("plus")} شركة تقسيط</button>` : ""); const F = S.finView; if (!F) { setTimeout(loadFinView, 0); return h + `<div class="spin"></div>`; }
  const open = F.rec.filter(r => r.status === "open"), late = open.filter(r => r.due_date < today()), canE = can("inst", "e") || ["owner", "gm"].includes(S.sess.role.id);
  h += `<div class="grid g4">${[["مستحق عند الشركات", fmt(open.reduce((a, r) => a + +r.net, 0)), open.length + " فاتورة"], ["متأخر عن ميعاده", fmt(late.reduce((a, r) => a + +r.net, 0)), late.length + " فاتورة"], ["عمولات على المحل", fmt(F.rec.filter(r => r.status !== "cancelled").reduce((a, r) => a + +r.commission, 0))], ["اتحصّل", fmt(F.rec.filter(r => r.status === "settled").reduce((a, r) => a + +r.received, 0))]].map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div>${k[2] ? `<div class="dim" style="font-size:12px">${k[2]}</div>` : ""}</div>`).join("")}</div>`;
  h += `<div class="grid g3">${S.finCo.map(c => `<div class="card rise"><h3>${esc(c.name)}${c.active ? "" : ` <span class="chip plain">موقوفة</span>`}${canE ? `<button class="btn sm ghost" data-act="finCoEdit" data-id="${c.id}">تعديل</button>` : ""}</h3><div class="stack" style="gap:5px;font-size:13px"><div class="row between"><span class="muted">بتحوّل بعد</span><b class="num">${c.transfer_days} يوم</b></div>${S.finPl.filter(p => p.company_id === c.id && p.active).map(p => `<div class="row between"><span>${esc(p.name)} <span class="dim">(${p.months} شهر)</span></span><span class="chip ${p.payer === "store" ? "warn" : "plain"}">${p.payer === "store" ? "على المحل " + (+p.rate) + "%" : "على العميل"}</span></div>`).join("")}</div></div>`).join("") || `<div class="card"><p class="muted">لسه مفيش شركات تقسيط. ضيف ValU أو أمان أو كونتكت وخططهم.</p></div>`}</div>`;
  h += `<div class="tw rise"><table><thead><tr><th>الفاتورة</th><th>الشركة والخطة</th><th>المكان</th><th class="n">البيع</th><th class="n">عمولة على المحل</th><th class="n">صافي هيتحوّل</th><th>الميعاد</th><th>الحالة</th><th></th></tr></thead><tbody>${F.rec.map(r => { const st = r.status === "settled" ? ["اتحصّلت", "ok"] : r.status === "cancelled" ? ["ملغاة", "plain"] : r.due_date < today() ? ["متأخرة", "bad"] : ["مفتوحة", "info"];
    return `<tr><td class="num">${esc(r.sale_no || "")}<br><span class="dim" style="font-size:12px">${new Date(r.created_at).toLocaleDateString("ar-EG")}</span></td><td>${esc(planName(r.plan_id))}</td><td>${esc(locName(r.location_id))}</td><td class="n">${fmt(r.amount, 1)}</td><td class="n">${+r.commission ? fmt(r.commission, 1) : "—"}</td><td class="n"><b>${fmt(r.net, 1)}</b></td><td class="num">${esc(r.due_date)}</td><td><span class="chip ${st[1]}">${st[0]}</span>${r.ref ? `<br><span class="dim" style="font-size:12px">${esc(r.ref)} · ${fmt(r.received, 1)}</span>` : ""}</td><td>${r.status === "open" && canE ? `<button class="btn sm gold" data-act="finSettle" data-id="${r.id}">تسجيل التحويل</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="9" class="muted">لسه مفيش بيع بالتقسيط.</td></tr>`}</tbody></table></div>`;
  return h; };
async function loadFinView() { try { await loadFin(); const [rec, sales, accts] = await Promise.all([q("finance_receivables", "*", x => x.order("due_date").limit(1000)), q("sales", "id,no", x => x.limit(5000)), q("cash_accounts", "*", x => x.order("id"))]); rec.forEach(r => { r.sale_no = (sales.find(s => s.id === r.sale_id) || {}).no; }); S.finView = { rec }; S.bankAccts = accts.filter(a => a.kind === "bank"); if (S.route === "inst") render(); } catch (e) { toast(errText(e), true); } }
function finCoModal(c) {
  const x = c ? Object.assign({}, c, { plans: S.finPl.filter(p => p.company_id === c.id && p.active).map(p => Object.assign({}, p)) }) : { name: "", transfer_days: 7, phone: "", account_id: (S.bankAccts[0] || {}).id, active: true, plans: [{ name: "٦ شهور بدون فوائد", months: 6, rate: 0, payer: "store" }] };
  S._fc = x; const draw = () => modal(`<h2>${c ? "تعديل شركة تقسيط" : "شركة تقسيط جديدة"}</h2><div class="stack" style="margin-top:10px"><div class="grid g2"><div class="field"><label>اسم الشركة</label><input class="inp" id="fcN" value="${esc(x.name)}"></div><div class="field"><label>بتحوّل الفلوس بعد (يوم)</label><input class="inp num" id="fcD" type="number" min="0" value="${x.transfer_days}"></div><div class="field"><label>التليفون</label><input class="inp num" id="fcP" value="${esc(x.phone || "")}"></div><div class="field"><label>بتحوّل على حساب</label><select class="inp" id="fcA">${S.bankAccts.map(a => `<option value="${a.id}" ${x.account_id === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div></div>
   <b>الخطط</b>${x.plans.map((p, i) => `<div class="row" style="gap:6px;flex-wrap:nowrap"><input class="inp" data-fp="${i}" data-f="name" placeholder="اسم الخطة" value="${esc(p.name)}" style="flex:2"><input class="inp num" data-fp="${i}" data-f="months" type="number" min="1" value="${p.months}" title="شهور" style="width:64px"><input class="inp num" data-fp="${i}" data-f="rate" type="number" min="0" step="0.1" value="${p.rate}" title="%" style="width:64px"><select class="inp" data-fp="${i}" data-f="payer" style="flex:1.4"><option value="store" ${p.payer === "store" ? "selected" : ""}>العمولة على المحل</option><option value="customer" ${p.payer === "customer" ? "selected" : ""}>على العميل</option></select><button class="btn sm ghost" data-act="fpDel" data-i="${i}">✕</button></div>`).join("")}
   <button class="btn sm ghost" data-act="fpAdd">${ico("plus")} خطة</button>${c ? `<label class="row" style="gap:8px"><input type="checkbox" class="ck" id="fcAct" ${x.active ? "checked" : ""}> الشركة شغالة</label>` : ""}<div id="fcErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="finCoSave">حفظ</button></div></div>`);
  S._fcDraw = () => { fcRead(); draw(); }; draw();
}
function fcRead() { const x = S._fc; if (!$("#fcN")) return; x.name = $("#fcN").value; x.transfer_days = +$("#fcD").value || 0; x.phone = $("#fcP").value; x.account_id = +$("#fcA").value || null; if ($("#fcAct")) x.active = $("#fcAct").checked; document.querySelectorAll("[data-fp]").forEach(e => { const p = x.plans[+e.dataset.fp]; p[e.dataset.f] = e.dataset.f === "months" || e.dataset.f === "rate" ? +e.value : e.value; }); }
function settleModal(r) {
  modal(`<h2>تسجيل تحويل من ${esc(planName(r.plan_id).split(" · ")[0])}</h2><p class="muted" style="margin:0 0 10px">${esc(r.sale_no || "")} · المفروض يتحوّل <b class="num">${fmt(r.net, 1)}</b></p><div class="stack">
   <div class="grid g2"><div class="field"><label>المبلغ اللي وصل</label><input class="inp num" id="sAmt" type="number" min="0" value="${r.net}"></div><div class="field"><label>التاريخ</label><input class="inp" id="sDate" type="date" value="${today()}" max="${today()}"></div></div>
   <div class="field"><label>رقم التحويل</label><input class="inp" id="sRef"></div><div class="field"><label>سبب الفرق (لو المبلغ مختلف)</label><input class="inp" id="sWhy"></div><div id="sErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="finSettleGo" data-id="${r.id}">حفظ</button></div></div>`);
}
async function ops2Click(k, a) {
  const wrap = async (fn, after, errBox) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (errBox && $(errBox)) $(errBox).innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); busy(a, false); } };
  if (k === "heldSend") heldSend(a);
  else if (k === "heldList") heldList();
  else if (k === "heldTake") heldTake(a.dataset.id);
  else if (k === "heldCancel") wrap(() => rpc("held_cancel", { p_token: T(), p_id: a.dataset.id }), async () => { toast("اتلغت."); heldList(); });
  else if (k === "saleRet") returnModal(a.dataset.id);
  else if (k === "retGo") retGo(a, a.dataset.id);
  else if (k === "finCoNew") finCoModal(null);
  else if (k === "finCoEdit") finCoModal(S.finCo.find(c => c.id === +a.dataset.id));
  else if (k === "fpAdd") { fcRead(); S._fc.plans.push({ name: "", months: 12, rate: 0, payer: "customer" }); S._fcDraw(); }
  else if (k === "fpDel") { fcRead(); S._fc.plans.splice(+a.dataset.i, 1); S._fcDraw(); }
  else if (k === "finCoSave") { fcRead(); const x = S._fc; if (!x.name.trim()) return ($("#fcErr").innerHTML = `<div class="warnbox">اكتب اسم الشركة.</div>`); if (x.plans.some(p => !p.name.trim() || !(p.months > 0) || p.rate < 0)) return ($("#fcErr").innerHTML = `<div class="warnbox">كل خطة محتاجة اسم وعدد شهور ونسبة.</div>`);
    wrap(() => rpc("fin_company_save", { p_token: T(), p: { id: x.id || null, name: x.name.trim(), transfer_days: x.transfer_days, phone: x.phone, account_id: x.account_id, active: x.active !== false, plans: x.plans.map(p => ({ id: p.id || null, name: p.name, months: p.months, rate: p.rate, payer: p.payer, active: true })) } }), async () => { closeModal(); toast("اتحفظ."); S.finView = null; render(); }, "#fcErr"); }
  else if (k === "finSettle") settleModal(S.finView.rec.find(r => r.id === a.dataset.id));
  else if (k === "finSettleGo") wrap(() => rpc("fin_settle", { p_token: T(), p_id: a.dataset.id, p_amount: +$("#sAmt").value, p_date: $("#sDate").value, p_ref: $("#sRef").value.trim(), p_reason: $("#sWhy").value.trim() || null }), async () => { closeModal(); toast("اتسجّل التحويل."); S.finView = null; render(); }, "#sErr");
  else return ops3Click(k, a);
  return true;
}


/* =====================================================================
   PHASE 2b · suppliers & purchases · warranty & service
   ===================================================================== */
const SUPK = { credit: "آجل", cash: "كاش", consignment: "أمانة" };
const SPM = { cash: "نقدي من الخزنة", bank: "تحويل بنكي", cheque: "شيك", insta: "إنستاباي", wallet: "محفظة", credit: "خصم / إشعار دائن" };
async function loadSup() {
  const [sups, bals, inv, pays, accts] = await Promise.all([q("suppliers", "*", x => x.order("name")), q("supplier_balances", "*"), q("purchase_invoices", "*", x => x.order("created_at", { ascending: false }).limit(1000)), q("supplier_payments", "*", x => x.order("created_at", { ascending: false }).limit(2000)), q("cash_accounts", "*", x => x.order("id"))]);
  sups.forEach(s => { s.balance = +((bals.find(b => b.id === s.id) || {}).balance || 0); const open = inv.filter(i => i.supplier_id === s.id); s.nextDue = open.map(i => i.due_date).sort()[0]; });
  S.sup = { sups, inv, pays, accts, tab: (S.sup && S.sup.tab) || "list" }; return S.sup;
}
V.suppliers = () => { let h = header(); const D = S.sup; if (!D || !D.sups) { setTimeout(() => loadSup().then(() => S.route === "suppliers" && render()).catch(e => toast(errText(e), true)), 0); return h + `<div class="spin"></div>`; }
  const canA = can("suppliers", "a") || can("stock", "a"), canP = can("suppliers", "p"), sc = seeCost();
  h = header(`${can("suppliers", "a") ? `<button class="btn" data-act="supNew">${ico("plus")} مورد جديد</button>` : ""}${canA ? `<button class="btn gold" data-act="purNew">${ico("plus")} فاتورة شراء / استلام</button>` : ""}`);
  h += `<div class="tabs rise">${[["list", "الموردين والأرصدة"], ["inv", "فواتير الشراء"], ["pay", "المدفوعات"]].map(([k, n]) => `<button data-act="supTab" data-k="${k}" class="${D.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  if (D.tab === "list") h += `<div class="tw rise"><table><thead><tr><th>المورد</th><th>النوع</th>${sc ? `<th class="n">الرصيد المستحق</th>` : ""}<th>شروط السداد</th><th></th></tr></thead><tbody>${D.sups.map(s => `<tr><td class="pname">${esc(s.name)}<small>${esc(s.contact || "")} ${esc(s.phone || "")}</small></td><td>${SUPK[s.kind]}</td>${sc ? `<td class="n"><b>${fmt(s.balance, 1)}</b>${s.credit_limit > 0 && s.balance > s.credit_limit ? `<br><span class="chip bad">فوق حد الائتمان</span>` : ""}</td>` : ""}<td>${s.terms_days} يوم</td><td class="row" style="gap:4px;flex-wrap:nowrap">${sc ? `<button class="btn sm ghost" data-act="supStmt" data-id="${s.id}">كشف حساب</button>` : ""}${canP && s.balance > 0 ? `<button class="btn sm gold" data-act="supPay" data-id="${s.id}">سداد</button>` : ""}${can("suppliers", "e") ? `<button class="btn sm ghost" data-act="supEdit" data-id="${s.id}">تعديل</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">لسه مفيش موردين.</td></tr>`}</tbody></table></div>`;
  if (D.tab === "inv") h += `<div class="tw rise"><table><thead><tr><th>الفاتورة</th><th>المورد</th><th>المكان</th><th>التاريخ / الاستحقاق</th>${sc ? `<th class="n">الإجمالي</th>` : ""}<th></th></tr></thead><tbody>${D.inv.map(i => `<tr><td class="num">${esc(i.no)}${i.supplier_ref ? `<br><span class="dim" style="font-size:12px">${esc(i.supplier_ref)}</span>` : ""}</td><td>${esc((D.sups.find(s => s.id === i.supplier_id) || {}).name || "")}</td><td>${esc(locName(i.location_id))}</td><td class="num">${esc(i.inv_date)}<br><span class="dim" style="font-size:12px">${esc(i.due_date)}</span></td>${sc ? `<td class="n">${fmt(i.total, 1)}${i.cost_pending ? `<br><span class="chip warn">التكلفة مستنية مراجعة</span>` : ""}</td>` : ""}<td>${i.cost_pending && sc && can("suppliers", "e") ? `<button class="btn sm gold" data-act="purCost" data-id="${i.id}">مراجعة التكلفة</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">لسه مفيش فواتير شراء.</td></tr>`}</tbody></table></div>`;
  if (D.tab === "pay") h += `<div class="tw rise"><table><thead><tr><th>الرقم</th><th>المورد</th><th>الطريقة</th><th>المرجع</th><th class="n">المبلغ</th><th>التاريخ</th></tr></thead><tbody>${D.pays.map(p => `<tr><td class="num">${esc(p.no)}</td><td>${esc((D.sups.find(s => s.id === p.supplier_id) || {}).name || "")}</td><td>${SPM[p.method]}</td><td>${esc(p.ref || p.note || "")}</td><td class="n">${fmt(p.amount, 1)}</td><td class="num dim">${new Date(p.created_at).toLocaleDateString("ar-EG")}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">لسه مفيش مدفوعات.</td></tr>`}</tbody></table></div>`;
  return h; };
function supModal(s) { const x = s || { name: "", kind: "credit", contact: "", phone: "", terms_days: 30, credit_limit: 0, alert_days: 3, bank_info: "", opening_balance: 0 };
  modal(`<h2>${s ? "تعديل مورد" : "مورد جديد"}</h2><div class="stack" style="margin-top:10px"><div class="grid g2"><div class="field"><label>الاسم</label><input class="inp" id="spN" value="${esc(x.name)}"></div><div class="field"><label>النوع</label><select class="inp" id="spK">${Object.entries(SUPK).map(([k, v]) => `<option value="${k}" ${x.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
   <div class="field"><label>المسؤول</label><input class="inp" id="spC" value="${esc(x.contact || "")}"></div><div class="field"><label>التليفون</label><input class="inp num" id="spP" value="${esc(x.phone || "")}"></div>
   <div class="field"><label>مدة السداد (يوم)</label><input class="inp num" id="spT" type="number" min="0" value="${x.terms_days}"></div><div class="field"><label>حد الائتمان</label><input class="inp num" id="spL" type="number" min="0" value="${x.credit_limit}"></div>
   <div class="field"><label>نبّهني قبل الاستحقاق بـ (يوم)</label><input class="inp num" id="spA" type="number" min="0" value="${x.alert_days}"></div>${s ? "" : `<div class="field"><label>رصيد أول المدة (علينا للمورد)</label><input class="inp num" id="spO" type="number" min="0" value="0"></div>`}</div>
   <div class="field"><label>بيانات البنك</label><input class="inp" id="spB" value="${esc(x.bank_info || "")}"></div><div id="spErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="supSave" data-id="${s ? s.id : ""}">حفظ</button></div></div>`); }
function stmtModal(s) { const D = S.sup, rows = [{ d: (s.opening_date || ""), t: "رصيد أول المدة", dr: +s.opening_balance, cr: 0 }]
    .concat(D.inv.filter(i => i.supplier_id === s.id).map(i => ({ d: i.inv_date, t: `فاتورة ${i.no}${i.supplier_ref ? " (" + i.supplier_ref + ")" : ""} · تستحق ${i.due_date}`, dr: +i.total, cr: 0 })))
    .concat(D.pays.filter(p => p.supplier_id === s.id).map(p => ({ d: p.created_at.slice(0, 10), t: `${SPM[p.method]} ${p.no}${p.ref ? " · " + p.ref : ""}${p.note ? " · " + p.note : ""}`, dr: 0, cr: +p.amount }))).sort((a, b) => String(a.d).localeCompare(String(b.d)));
  let run = 0; modal(`<h2>كشف حساب ${esc(s.name)}</h2><div class="tw" style="margin-top:10px;max-height:60vh;overflow:auto"><table><thead><tr><th>التاريخ</th><th>البيان</th><th class="n">علينا</th><th class="n">دفعنا</th><th class="n">الرصيد</th></tr></thead><tbody>${rows.map(r => { run += r.dr - r.cr; return `<tr><td class="num">${esc(r.d)}</td><td>${esc(r.t)}</td><td class="n">${r.dr ? fmt(r.dr, 1) : ""}</td><td class="n">${r.cr ? fmt(r.cr, 1) : ""}</td><td class="n"><b>${fmt(run, 1)}</b></td></tr>`; }).join("")}</tbody></table></div><div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn" data-act="stmtXls" data-id="${s.id}">Excel</button><button class="btn gold" data-act="mClose">إغلاق</button></div>`);
  S._stmt = { s, rows }; }
function payModal(s) { const lim = +S.sess.role.max_amount || 0;
  modal(`<h2>سداد للمورد ${esc(s.name)}</h2><p class="muted" style="margin:0 0 10px">الرصيد المستحق <b class="num">${fmt(s.balance, 1)}</b>${lim ? ` · حدّك ${fmt(lim)}` : ""}</p><div class="stack"><div class="grid g2"><div class="field"><label>المبلغ</label><input class="inp num" id="pyA" type="number" min="0" max="${s.balance}" value="${s.balance}"></div>
   <div class="field"><label>الطريقة</label><select class="inp" id="pyM">${Object.entries(SPM).filter(([k]) => k !== "credit").map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div class="field"><label>رقم التحويل / الشيك</label><input class="inp" id="pyR"></div><div class="field"><label>تاريخ الشيك</label><input class="inp" id="pyD" type="date"></div></div>
   <div class="field" id="pyPinF" style="display:none"><label>المبلغ فوق حدّك — رمز المالك</label><input class="inp num" type="password" id="pyPin"></div><div id="pyErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="supPayGo" data-id="${s.id}">سداد</button></div></div>`);
  const chk = () => { $("#pyPinF").style.display = lim && +$("#pyA").value > lim ? "" : "none"; }; $("#pyA").oninput = chk; chk(); }

/* ---------- purchase invoice / receiving ---------- */
function purNewModal() { S.pur = { supplier_id: (S.sup.sups[0] || {}).id, location_id: S.sess.staff.location_id || (S.locs.find(l => l.kind === "warehouse") || S.locs[0]).id, supplier_ref: "", inv_date: today(), discount: 0, lines: [] }; purDraw(); }
function purDraw() { const d = S.pur, sc = seeCost(), alertPct = +(S.store.price_alert_pct || 10);
  modal(`<h2>فاتورة شراء / استلام بضاعة</h2>${sc ? "" : `<div class="okbox">بتستلم بالكميات بس — التكلفة بتتسجّل مبدئيًا بآخر سعر شراء لحد ما المحاسب يراجعها.</div>`}<div class="stack" style="margin-top:10px">
   <div class="grid g2"><div class="field"><label>المورد</label><select class="inp" id="puS">${S.sup.sups.filter(s => s.active).map(s => `<option value="${s.id}" ${d.supplier_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div><div class="field"><label>المكان اللي استلم</label><select class="inp" id="puL">${S.locs.filter(l => myLoc(l.id)).map(l => `<option value="${l.id}" ${d.location_id === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
   <div class="field"><label>رقم فاتورة المورد</label><input class="inp" id="puR" value="${esc(d.supplier_ref)}"></div><div class="field"><label>التاريخ</label><input class="inp" id="puD" type="date" value="${d.inv_date}" max="${today()}"></div></div>
   <div class="row" style="gap:6px;flex-wrap:nowrap"><select class="inp" id="puI" style="flex:2">${S.items.map(i => `<option value="${i.id}">${esc(i.name)}${i.barcode ? " · " + esc(i.barcode) : ""}</option>`).join("")}</select><input class="inp num" id="puQ" type="number" min="0.001" step="any" value="1" style="width:80px" title="الكمية">${sc ? `<input class="inp num" id="puC" type="number" min="0" step="0.01" placeholder="تكلفة الوحدة" style="width:110px">` : ""}<button class="btn sm" data-act="purAdd">${ico("plus")}</button></div>
   ${d.lines.map((l, n) => { const it = S.items.find(i => i.id === l.item_id), diff = sc && +it.last_cost > 0 ? Math.abs(l.unit_cost - it.last_cost) / it.last_cost * 100 : 0;
     return `<div class="card" style="padding:10px"><div class="row between"><span><b>${esc(it.name)}</b> × <span class="num">${num(l.qty)}</span>${sc ? ` · <span class="num">${fmt(l.unit_cost, 1)}</span> = <b class="num">${fmt(l.qty * l.unit_cost, 1)}</b>` : ""}</span><button class="btn sm ghost" data-act="purDel" data-n="${n}">✕</button></div>
     ${diff > alertPct ? `<div class="warnbox" style="margin-top:6px;font-size:12.5px">السعر مختلف عن آخر سعر (${fmt(it.last_cost, 1)}) بنسبة ${Math.round(diff)}%. إيه السبب؟ <select class="inp" data-pdr="${n}" style="margin-top:6px"><option value="">— اختار —</option><option value="price" ${l.diff_reason === "price" ? "selected" : ""}>فرق سعر فعلي من المورد</option><option value="quality" ${l.diff_reason === "quality" ? "selected" : ""}>فرق خامة / جودة / موديل</option><option value="error" ${l.diff_reason === "error" ? "selected" : ""}>خطأ في الإدخال</option></select></div>` : ""}
     ${it.serial_required ? `<div class="field" style="margin-top:6px"><label>المسلسلات (${num(l.qty)}) — واحد في كل سطر أو بالسكانر</label><textarea class="inp num" rows="${Math.min(6, l.qty)}" data-psn="${n}">${esc((l.serials || []).join("\n"))}</textarea></div>` : ""}</div>`; }).join("")}
   ${sc && d.lines.length ? `<div class="row between"><span class="muted">خصم على الفاتورة</span><input class="inp num" id="puX" type="number" min="0" value="${d.discount}" style="width:110px"></div><div class="tot big"><span>الإجمالي</span><span class="num">${fmt(d.lines.reduce((a, l) => a + l.qty * l.unit_cost, 0) - (+d.discount || 0), 1)}</span></div>` : ""}
   <div id="puErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="purSave">حفظ واستلام</button></div></div>`);
  const sync = () => { d.supplier_id = +$("#puS").value; d.location_id = +$("#puL").value; d.supplier_ref = $("#puR").value; d.inv_date = $("#puD").value; if ($("#puX")) d.discount = +$("#puX").value || 0; };
  ["#puS", "#puL", "#puR", "#puD", "#puX"].forEach(k => { const e = $(k); if (e) e.onchange = sync; });
  document.querySelectorAll("[data-pdr]").forEach(e => e.onchange = () => { d.lines[+e.dataset.pdr].diff_reason = e.value; });
  document.querySelectorAll("[data-psn]").forEach(e => e.onchange = () => { d.lines[+e.dataset.psn].serials = e.value.split(/[\n,،]+/).map(x => x.trim()).filter(Boolean); });
  S._purSync = sync; }
function purCostModal(inv) { q("purchase_lines", "*", x => x.eq("invoice_id", inv.id)).then(L => {
  modal(`<h2>مراجعة تكلفة ${esc(inv.no)}</h2><p class="muted">الفاتورة اتستلمت بالكميات. اكتب تكلفة الوحدة الفعلية من فاتورة المورد.</p><div class="stack">${L.map(l => `<div class="row between"><span>${esc((S.items.find(i => i.id === l.item_id) || {}).name || "")} × ${num(l.qty)}</span><input class="inp num" type="number" min="0" step="0.01" data-pcl="${l.id}" value="${l.unit_cost}" style="width:120px"></div>`).join("")}<div id="pcErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="purCostGo" data-id="${inv.id}">حفظ</button></div></div>`); }).catch(e => toast(errText(e), true)); }

/* ---------- warranty & service ---------- */
const SVA = { direct: "توجيه العميل للتوكيل", collect: "نستلم الجهاز ونبعته للتوكيل", replace: "استبدال فوري من المخزون" };
const SVS = { directed: ["اتوجّه للتوكيل", "info"], received: ["مستلَم في المعرض", "warn"], center: ["عند التوكيل", "warn"], back: ["رجع من التوكيل", "info"], done: ["اتسلّم للعميل", "ok"], replaced: ["اتستبدل", "ok"] };
async function loadSvc() { const [t, rules] = await Promise.all([q("service_tickets", "*", x => x.order("created_at", { ascending: false }).limit(500)), q("warranty_rules", "*", x => x.order("id"))]); S.svc = { t, rules, tab: (S.svc && S.svc.tab) || "open" }; if (!S.sup) await loadSup().catch(() => {}); return S.svc; }
const svcRuleOf = it => { const R = S.svc.rules, g = ((S.groups.find(x => x.id === it.group_id) || {}).name) || ""; return R.find(r => r.brand === (it.brand || "") && r.group_name === g) || R.find(r => r.brand === (it.brand || "") && r.group_name === "*") || R.find(r => r.brand === "*"); };
const svcLate = t => { if (t.status !== "center" || !t.at_center_since) return 0; const it = S.items.find(i => i.id === t.item_id), r = it ? svcRuleOf(it) : null, d = Math.floor((Date.now() - new Date(t.at_center_since)) / 864e5); return r && d > r.max_days ? d : 0; };
V.svc = () => { let h = header(can("svc", "a") ? `<button class="btn gold" data-act="svcNew">${ico("plus")} تذكرة ضمان</button>` : ""); const D = S.svc; if (!D) { setTimeout(() => loadSvc().then(() => S.route === "svc" && render()).catch(e => toast(errText(e), true)), 0); return h + `<div class="spin"></div>`; }
  const open = D.t.filter(t => !["directed", "done"].includes(t.status) && !(t.status === "replaced" && t.claim_status !== "open")), late = D.t.filter(svcLate), canRule = ["owner", "gm"].includes(S.sess.role.id) || can("svc", "p");
  h += `<div class="grid g4">${[["تذاكر مفتوحة", open.length], ["عند التوكيل", D.t.filter(t => t.status === "center").length, late.length ? `<span style="color:var(--bad)">${late.length} متأخر</span>` : ""], ["جاهز للتسليم", D.t.filter(t => t.status === "back").length], ["مطالبات على الموردين", D.t.filter(t => t.claim_status === "open").length]].map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div>${k[2] ? `<div style="font-size:12px">${k[2]}</div>` : ""}</div>`).join("")}</div>`;
  if (late.length) h += `<div class="warnbox rise">${late.map(t => `${esc(t.no)} · ${esc((S.items.find(i => i.id === t.item_id) || {}).name || "")} — عند التوكيل من ${svcLate(t)} يوم`).join("<br>")}</div>`;
  h += `<div class="tabs rise">${[["open", "المفتوحة"], ["all", "الكل"], ["rules", "قواعد الضمان لكل ماركة"]].map(([k, n]) => `<button data-act="svcTab" data-k="${k}" class="${D.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  if (D.tab !== "rules") { const L = D.tab === "open" ? open : D.t;
    h += `<div class="tw rise"><table><thead><tr><th>التذكرة</th><th>الجهاز والمسلسل</th><th>العميل</th><th>الإجراء</th><th>الحالة</th><th></th></tr></thead><tbody>${L.map(t => { const it = S.items.find(i => i.id === t.item_id) || { name: "—" }, st = SVS[t.status], nx = { received: ["center", "اتبعت للتوكيل"], center: ["back", "رجع من التوكيل"], back: ["done", "اتسلّم للعميل"] }[t.status];
      return `<tr><td class="num">${esc(t.no)}<br><span class="dim" style="font-size:12px">${new Date(t.created_at).toLocaleDateString("ar-EG")} · ${esc(locName(t.location_id))}</span></td><td>${esc(it.name)}<br><span class="dim num" style="font-size:12px">SN ${esc(t.serial)}${t.new_serial ? " ← " + esc(t.new_serial) : ""}</span></td><td>${esc(t.customer_name || "")}<br><span class="dim num" style="font-size:12px">${esc(t.phone || "")}</span></td><td>${SVA[t.action]}${t.action !== t.suggested ? `<br><span class="dim" style="font-size:12px">المقترح: ${SVA[t.suggested]} · ${esc(t.reason || "")}</span>` : ""}${t.center_ref ? `<br><span class="dim num" style="font-size:12px">${esc(t.center_ref)}</span>` : ""}</td>
       <td><span class="chip ${svcLate(t) ? "bad" : st[1]}">${st[0]}</span>${t.claim_status ? `<br><span class="chip ${t.claim_status === "open" ? "warn" : "ok"} plain" style="margin-top:4px">${t.claim_status === "open" ? "مطالبة المورد مفتوحة" : "المورد سوّى"}</span>` : ""}</td>
       <td class="row" style="gap:4px;flex-wrap:nowrap">${nx && can("svc", "e") ? `<button class="btn sm" data-act="svcNext" data-id="${t.id}" data-to="${nx[0]}">${nx[1]}</button>` : ""}${t.claim_status === "open" && canRule ? `<button class="btn sm gold" data-act="svcClaim" data-id="${t.id}">تسوية مع المورد</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="6" class="muted">مفيش تذاكر.</td></tr>`}</tbody></table></div>`; }
  else h += `<div class="tw rise"><table><thead><tr><th>الماركة</th><th>نوع الجهاز (المجموعة)</th><th class="n">الضمان</th><th>الإجراء</th><th>مركز الصيانة</th><th class="n">أقصى أيام</th><th></th></tr></thead><tbody>${D.rules.map(r => `<tr><td>${r.brand === "*" ? "أي ماركة تانية" : esc(r.brand)}</td><td>${r.group_name === "*" ? "كل الأنواع" : esc(r.group_name)}</td><td class="n">${r.months} شهر</td><td>${SVA[r.action]}</td><td>${esc(r.center || "—")}${r.phone ? `<br><span class="dim num">${esc(r.phone)}</span>` : ""}</td><td class="n">${r.max_days}</td><td>${canRule ? `<button class="btn sm ghost" data-act="ruleEdit" data-id="${r.id}">تعديل</button>` : ""}</td></tr>`).join("")}</tbody></table></div>${canRule ? `<button class="btn rise" data-act="ruleEdit" data-id="">${ico("plus")} قاعدة جديدة</button>` : ""}<div class="okbox rise">السيستم بيدوّر على قاعدة الماركة + نوع الجهاز، وبعدها الماركة لوحدها، وبعدها القاعدة العامة. ماركة الصنف بتتحدد من شاشة الأصناف.</div>`;
  return h; };
function ruleModal(r) { const x = r || { brand: "", group_name: "*", months: 12, action: "collect", center: "", phone: "", max_days: 14 }, groups = [...new Set(S.groups.map(g => g.name))];
  modal(`<h2>قاعدة ضمان</h2><div class="stack" style="margin-top:10px"><div class="grid g2"><div class="field"><label>الماركة</label><input class="inp" id="wrB" value="${x.brand === "*" ? "" : esc(x.brand)}" ${x.brand === "*" ? "disabled placeholder='القاعدة العامة'" : ""}></div><div class="field"><label>نوع الجهاز (المجموعة)</label><select class="inp" id="wrG"><option value="*">كل الأنواع</option>${groups.map(g => `<option ${x.group_name === g ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></div>
   <div class="field"><label>مدة الضمان (شهر)</label><input class="inp num" id="wrM" type="number" min="0" value="${x.months}"></div><div class="field"><label>الإجراء الافتراضي</label><select class="inp" id="wrA">${Object.entries(SVA).map(([k, v]) => `<option value="${k}" ${x.action === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
   <div class="field"><label>مركز الصيانة</label><input class="inp" id="wrC" value="${esc(x.center || "")}"></div><div class="field"><label>التليفون</label><input class="inp num" id="wrP" value="${esc(x.phone || "")}"></div>
   <div class="field"><label>أقصى أيام عند التوكيل قبل التنبيه</label><input class="inp num" id="wrX" type="number" min="1" value="${x.max_days}"></div></div><div id="wrErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="ruleSave" data-id="${r ? r.id : ""}">حفظ</button></div></div>`); }
async function svcNewModal() {
  modal(`<h2>تذكرة ضمان جديدة</h2><div class="stack" style="margin-top:10px"><div class="field"><label>المسلسل (امسحه بالسكانر)</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input class="inp num" id="tvSn"><button class="btn" data-act="svcLook">تحقق</button></div></div><div id="tvBox"></div></div>`);
  $("#tvSn").onkeydown = e => { if (e.key === "Enter") svcLook(); };
}
async function svcLook() {
  const sn = $("#tvSn").value.trim(); if (!sn) return;
  const sr = (await q("serials", "*", x => x.eq("serial", sn)).catch(() => []))[0]; let sale = null;
  if (sr && sr.sale_id) sale = (await q("sales", "no,business_day,customer_id,location_id", x => x.eq("id", sr.sale_id)).catch(() => []))[0];
  let cust = null; if (sale && sale.customer_id) cust = (await q("customers", "name,phone", x => x.eq("id", sale.customer_id)).catch(() => []))[0];
  S._tv = { sn, sr, sale };
  const items = S.items.filter(i => i.serial_required), it = sr ? S.items.find(i => i.id === sr.item_id) : items[0];
  $("#tvBox").innerHTML = `${sr ? (sale ? `<div class="okbox">اتباع في ${esc(sale.no)} · ${esc(sale.business_day)}</div>` : `<div class="warnbox">المسلسل موجود بس مش مربوط بفاتورة بيع — اكتب تاريخ البيع.</div>`) : `<div class="warnbox">المسلسل مش متسجّل — اختار الجهاز واكتب تاريخ البيع.</div>`}
   <div class="grid g2"><div class="field"><label>الجهاز</label><select class="inp" id="tvI" ${sr ? "disabled" : ""}>${items.map(i => `<option value="${i.id}" ${it && it.id === i.id ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select></div><div class="field"><label>تاريخ البيع</label><input class="inp" id="tvD" type="date" max="${today()}" value="${sale ? sale.business_day : ""}" ${sale ? "disabled" : ""}></div>
   <div class="field"><label>العميل</label><input class="inp" id="tvC" value="${esc(cust ? cust.name : "")}"></div><div class="field"><label>الموبايل</label><input class="inp num" id="tvP" value="${esc(cust ? cust.phone : "")}"></div></div>
   <div class="field"><label>العطل</label><input class="inp" id="tvW"></div><div id="tvRule"></div>`;
  const ruleBox = () => { const i2 = S.items.find(i => i.id === $("#tvI").value), r = svcRuleOf(i2), d = $("#tvD").value, end = d ? new Date(new Date(d).setMonth(new Date(d).getMonth() + r.months)).toISOString().slice(0, 10) : "", ok = d && end >= today();
    $("#tvRule").innerHTML = `<div class="${ok ? "okbox" : "warnbox"}" style="font-size:12.5px">${d ? (ok ? "الضمان ساري لحد " + end : "الضمان انتهى في " + end) : "حدد تاريخ البيع"} · ${r.months} شهر · ${esc(r.center || "مفيش مركز محدد")}${r.phone ? " · " + esc(r.phone) : ""}</div>
     <div class="field"><label>الإجراء <span class="dim">(المقترح: ${SVA[r.action]})</span></label><select class="inp" id="tvA" data-sug="${r.action}">${Object.entries(SVA).map(([k, v]) => `<option value="${k}" ${k === r.action ? "selected" : ""}>${v}</option>`).join("")}</select></div>
     <div class="field"><label>السبب (إجباري لو غيّرت الإجراء أو الضمان منتهي)</label><input class="inp" id="tvR"></div><div id="tvErr"></div>
     <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="svcSave">فتح التذكرة</button></div>`; };
  ruleBox(); $("#tvI").onchange = ruleBox; $("#tvD").onchange = ruleBox;
}
async function ops3Click(k, a) {
  const wrap = async (fn, after, box) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (box && $(box)) $(box).innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); busy(a, false); } };
  const D = S.sup;
  if (k === "supTab") { D.tab = a.dataset.k; render(); }
  else if (k === "supNew") supModal(null);
  else if (k === "supEdit") supModal(D.sups.find(s => s.id === +a.dataset.id));
  else if (k === "supSave") { const p = { id: a.dataset.id ? +a.dataset.id : null, name: $("#spN").value.trim(), kind: $("#spK").value, contact: $("#spC").value, phone: $("#spP").value, terms_days: +$("#spT").value || 0, credit_limit: +$("#spL").value || 0, alert_days: +$("#spA").value || 0, bank_info: $("#spB").value, opening_balance: $("#spO") ? +$("#spO").value || 0 : undefined };
    wrap(() => rpc("supplier_save", { p_token: T(), p }), async () => { closeModal(); toast("اتحفظ."); await loadSup(); render(); }, "#spErr"); }
  else if (k === "supStmt") stmtModal(D.sups.find(s => s.id === +a.dataset.id));
  else if (k === "stmtXls") { const { s, rows } = S._stmt; let run = 0; const ws = XLSX.utils.aoa_to_sheet([["كشف حساب " + s.name], ["التاريخ", "البيان", "علينا", "دفعنا", "الرصيد"], ...rows.map(r => { run += r.dr - r.cr; return [r.d, r.t, r.dr || "", r.cr || "", Math.round(run * 100) / 100]; })]); ws["!views"] = [{ RTL: true }]; ws["!cols"] = [{ wch: 12 }, { wch: 50 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]; const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "كشف"); XLSX.writeFile(wb, `كشف-حساب-${s.name}.xlsx`); }
  else if (k === "supPay") payModal(D.sups.find(s => s.id === +a.dataset.id));
  else if (k === "supPayGo") wrap(() => rpc("supplier_pay", { p_token: T(), p: { supplier_id: +a.dataset.id, amount: +$("#pyA").value, method: $("#pyM").value, ref: $("#pyR").value.trim(), cheque_date: $("#pyD").value || null, approver_pin: $("#pyPin").value || null } }), async () => { closeModal(); toast("اتسجّل السداد."); await loadSup(); render(); }, "#pyErr");
  else if (k === "purNew") { if (!S.sup.sups.length) return toast("ضيف مورد الأول.", true); purNewModal(); }
  else if (k === "purAdd") { S._purSync(); const id = $("#puI").value, qy = +$("#puQ").value, c = $("#puC") ? +$("#puC").value : null; if (!(qy > 0)) return; if (seeCost() && !(c >= 0 && $("#puC").value !== "")) return toast("اكتب تكلفة الوحدة.", true); const it = S.items.find(i => i.id === id); if (it.serial_required && qy % 1) return toast("الأجهزة بالعدد.", true); S.pur.lines.push({ item_id: id, qty: qy, unit_cost: c, serials: [] }); purDraw(); }
  else if (k === "purDel") { S._purSync(); S.pur.lines.splice(+a.dataset.n, 1); purDraw(); }
  else if (k === "purSave") { S._purSync(); const d = S.pur, sc = seeCost(), alertPct = +(S.store.price_alert_pct || 10); if (!d.lines.length) return ($("#puErr").innerHTML = `<div class="warnbox">ضيف صنف.</div>`);
    for (const l of d.lines) { const it = S.items.find(i => i.id === l.item_id); if (it.serial_required && (l.serials || []).length !== l.qty) return ($("#puErr").innerHTML = `<div class="warnbox">اكتب ${num(l.qty)} مسلسل لـ ${esc(it.name)}.</div>`);
      if (sc && +it.last_cost > 0 && Math.abs(l.unit_cost - it.last_cost) / it.last_cost * 100 > alertPct) { if (!l.diff_reason) return ($("#puErr").innerHTML = `<div class="warnbox">اختار سبب فرق السعر لـ ${esc(it.name)}.</div>`); if (l.diff_reason === "error") return ($("#puErr").innerHTML = `<div class="warnbox">صلّح سعر ${esc(it.name)} الأول.</div>`); } }
    wrap(() => rpc("purchase_post", { p_token: T(), p: { supplier_id: d.supplier_id, location_id: d.location_id, supplier_ref: d.supplier_ref, inv_date: d.inv_date, discount: d.discount, lines: d.lines.map(l => ({ item_id: l.item_id, qty: l.qty, unit_cost: sc ? l.unit_cost : null, diff_reason: l.diff_reason || null, serials: l.serials && l.serials.length ? l.serials : undefined })) } }),
      async () => { closeModal(); toast("الفاتورة اتسجّلت والبضاعة دخلت المخزون."); await loadSup(); await loadItems(); render(); }, "#puErr"); }
  else if (k === "purCost") purCostModal(D.inv.find(i => i.id === a.dataset.id));
  else if (k === "purCostGo") wrap(() => rpc("purchase_set_costs", { p_token: T(), p_invoice: a.dataset.id, p_lines: [...document.querySelectorAll("[data-pcl]")].map(e => ({ line_id: +e.dataset.pcl, unit_cost: +e.value })) }), async () => { closeModal(); toast("اتحفظت التكلفة."); await loadSup(); await loadItems(); render(); }, "#pcErr");
  else if (k === "svcTab") { S.svc.tab = a.dataset.k; render(); }
  else if (k === "svcNew") svcNewModal();
  else if (k === "svcLook") svcLook();
  else if (k === "svcSave") { const p = { serial: S._tv.sn, item_id: $("#tvI").value, sold_on: $("#tvD").value || null, customer_name: $("#tvC").value.trim(), phone: $("#tvP").value.trim(), problem: $("#tvW").value.trim(), action: $("#tvA").value, reason: $("#tvR").value.trim() || null };
    wrap(() => rpc("svc_open", { p_token: T(), p }), async () => { closeModal(); toast("اتفتحت التذكرة."); S.svc = null; await loadItems(); if (S.route === "svc") render(); }, "#tvErr"); }
  else if (k === "svcNext") { const to = a.dataset.to; const ref = to === "center" ? prompt("رقم الاستلام عند التوكيل") : null; if (to === "center" && ref === null) return; wrap(() => rpc("svc_advance", { p_token: T(), p_id: a.dataset.id, p_to: to, p_ref: ref }), async () => { S.svc = null; render(); }); }
  else if (k === "svcClaim") { const t = S.svc.t.find(x => x.id === a.dataset.id); modal(`<h2>تسوية الاستبدال مع المورد</h2><p class="muted">${esc(t.no)}${seeCost() ? " · " + fmt(t.claim_amount, 1) : ""}</p><div class="stack"><label class="row" style="gap:8px"><input type="radio" name="clH" value="credit" checked> المورد خصم قيمة الجهاز من حسابنا</label><label class="row" style="gap:8px"><input type="radio" name="clH" value="unit"> المورد بعت جهاز بديل للمخزن</label><input class="inp num" id="clSn" placeholder="مسلسل الجهاز البديل"><div id="clErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="svcClaimGo" data-id="${t.id}">تأكيد</button></div></div>`); }
  else if (k === "svcClaimGo") wrap(() => rpc("svc_claim_settle", { p_token: T(), p_id: a.dataset.id, p_how: document.querySelector("[name=clH]:checked").value, p_serial: $("#clSn").value.trim() || null }), async () => { closeModal(); toast("اتسوّت."); S.svc = null; S.sup = null; await loadItems(); render(); }, "#clErr");
  else if (k === "ruleEdit") ruleModal(a.dataset.id ? S.svc.rules.find(r => r.id === +a.dataset.id) : null);
  else if (k === "ruleSave") { const p = { id: a.dataset.id ? +a.dataset.id : null, brand: $("#wrB").value.trim() || "*", group_name: $("#wrG").value, months: +$("#wrM").value || 0, action: $("#wrA").value, center: $("#wrC").value.trim(), phone: $("#wrP").value.trim(), max_days: +$("#wrX").value || 14 };
    if (!a.dataset.id && p.brand === "*") return ($("#wrErr").innerHTML = `<div class="warnbox">اكتب الماركة.</div>`);
    wrap(() => rpc("wrule_save", { p_token: T(), p }), async () => { closeModal(); S.svc = null; render(); }, "#wrErr"); }
  else return ops4Click(k, a);
  return true;
}

/* =====================================================================
   PHASE 2c · general ledger · settings & VAT · salesperson commission · offers
   ===================================================================== */
const r2 = n => Math.round((+n || 0) * 100) / 100;
function xlsOut(file, sheet, aoa, widths) { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!views"] = [{ RTL: true }]; if (widths) ws["!cols"] = widths.map(w => ({ wch: w })); const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, sheet); XLSX.writeFile(wb, file + ".xlsx"); }
const isOwnerGm = () => ["owner", "gm"].includes(S.sess.role.id);

/* ---------- general ledger ---------- */
const GKN = { A: "أصول", L: "خصوم", E: "حقوق ملكية", R: "إيرادات", X: "مصروفات" };
const GSRC = { expense: "مصروفات", opening: "أرصدة افتتاحية", sale: "بيع", void: "إلغاء فاتورة", return: "مرتجع", purchase: "شراء", stock: "مخزون", supplier: "مورد", cash: "نقدية", manual: "قيد يدوي", closing: "إقفال" };
const GTABS = [["tb", "ميزان المراجعة"], ["is", "قائمة الدخل"], ["bs", "المركز المالي"], ["jr", "اليومية"], ["lg", "دفتر الأستاذ"], ["coa", "دليل الحسابات"], ["jv", "القيود اليدوية"], ["per", "الفترات والإقفال"]];
async function loadGL() {
  const G = S.gl || { tab: "tb", from: today().slice(0, 4) + "-01-01", to: today(), loc: "all", acct: "1101", page: 0, year: +today().slice(0, 4) };
  const [rows, accts, man, ml, per, yrs] = await Promise.all([rpc("gl_journal", { p_token: T(), p_from: null, p_to: G.to }), q("gl_accounts", "*", x => x.order("code")), q("gl_manual", "*", x => x.order("created_at", { ascending: false }).limit(500)), q("gl_manual_lines", "*", x => x.order("id").limit(10000)), q("gl_periods", "*"), q("gl_years", "*")]);
  G.all = (rows || []).map(r => ({ d: r[0], src: r[1], ref: r[2], memo: r[3], a: r[4], dr: +r[5] || 0, cr: +r[6] || 0, loc: r[7] }));
  G.accts = accts; G.man = man; G.ml = ml; G.per = per.map(p => p.month); G.yrs = yrs.map(y => y.year); G.loaded = G.to;
  if (!S.dir) await loadDir().catch(() => {});
  S.gl = G; return G;
}
const glLeaf = (G, c) => !G.accts.some(a => a.parent === c);
const glAcc = (G, c) => G.accts.find(a => a.code === c) || { name: c, kind: "A" };
const glDebitNature = k => k === "A" || k === "X";
function glRows(G, inPeriod) { return G.all.filter(r => (G.loc === "all" || r.loc === +G.loc) && (inPeriod === "before" ? r.d < G.from : inPeriod ? r.d >= G.from && r.d <= G.to : r.d <= G.to)); }
function glSum(rows) { const m = {}; rows.forEach(r => { const x = m[r.a] || (m[r.a] = { dr: 0, cr: 0 }); x.dr += r.dr; x.cr += r.cr; }); return m; }
const glRoll = (m, code) => Object.keys(m).filter(c => c.startsWith(code)).reduce((s, c) => ({ dr: s.dr + m[c].dr, cr: s.cr + m[c].cr }), { dr: 0, cr: 0 });

function glIncome(G) { const m = glSum(glRows(G, true).filter(r => r.src !== "closing")), net = (c, k) => { const x = glRoll(m, c); return glDebitNature(k) ? x.dr - x.cr : x.cr - x.dr; };
  const leaves = p => G.accts.filter(a => a.code.startsWith(p) && glLeaf(G, a.code));
  const rev = leaves("4").map(a => [a.code + " " + a.name, net(a.code, "R")]), cogs = leaves("51").map(a => [a.code + " " + a.name, net(a.code, "X")]), opx = G.accts.filter(a => a.kind === "X" && !a.code.startsWith("51") && glLeaf(G, a.code)).map(a => [a.code + " " + a.name, net(a.code, "X")]);
  const R = rev.reduce((s, x) => s + x[1], 0), C = cogs.reduce((s, x) => s + x[1], 0), O = opx.reduce((s, x) => s + x[1], 0);
  return { rev, cogs, opx, R, C, O, gp: R - C, np: R - C - O }; }
function glBalance(G) { const m = glSum(glRows(G, false)), bal = (c, k) => { const x = glRoll(m, c); return glDebitNature(k) ? x.dr - x.cr : x.cr - x.dr; };
  const sec = k => G.accts.filter(a => a.kind === k && glLeaf(G, a.code)).map(a => [a.code + " " + a.name, bal(a.code, k)]).filter(x => Math.abs(x[1]) > 0.004);
  const A = sec("A"), L = sec("L"), E = sec("E"), pr = G.accts.filter(a => (a.kind === "R" || a.kind === "X") && glLeaf(G, a.code)).reduce((s, a) => { const x = m[a.code] || { dr: 0, cr: 0 }; return s + x.cr - x.dr; }, 0);
  const tA = A.reduce((s, x) => s + x[1], 0), tL = L.reduce((s, x) => s + x[1], 0), tE = E.reduce((s, x) => s + x[1], 0) + pr;
  return { A, L, E, pr, tA, tL, tE }; }
function glTB(G) { const o = glSum(glRows(G, "before")), p = glSum(glRows(G, true));
  return G.accts.filter(a => glLeaf(G, a.code)).map(a => { const ob = o[a.code] || { dr: 0, cr: 0 }, pm = p[a.code] || { dr: 0, cr: 0 }, open = ob.dr - ob.cr, close = open + pm.dr - pm.cr; return { a, open, dr: pm.dr, cr: pm.cr, close }; }).filter(x => Math.abs(x.open) > 0.004 || x.dr || x.cr); }

V.gl = () => { let h = header(); const G = S.gl; if (!G || G.loaded !== G.to) { setTimeout(() => loadGL().then(() => S.route === "gl" && render()).catch(e => toast(errText(e), true)), 0); return h + `<div class="spin"></div>`; }
  const canA = isOwnerGm() || can("gl", "a"), canP = isOwnerGm() || can("gl", "p"), pend = G.man.filter(m => m.status === "pending");
  h = header(`${canA ? `<button class="btn gold" data-act="jvNew">${ico("plus")} قيد يدوي</button>` : ""}<button class="btn" data-act="glXls">Excel</button>`);
  h += `<div class="card rise" style="padding:12px"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end"><div class="field"><label>من</label><input class="inp" type="date" id="glF" value="${G.from}"></div><div class="field"><label>إلى</label><input class="inp" type="date" id="glT" value="${G.to}" max="${today()}"></div>
   <div class="field"><label>المكان</label><select class="inp" id="glL"><option value="all">الكل (المحل كله)</option>${S.locs.map(l => `<option value="${l.id}" ${String(G.loc) === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></div>
   ${pend.length ? `<span class="chip warn">${pend.length} قيد مستني اعتماد</span>` : ""}</div>${G.loc !== "all" ? `<p class="dim" style="margin:8px 0 0;font-size:12.5px">فلتر المكان بيعرض قيود المعرض أو المخزن بس — الخزنة الرئيسية والقيود اليدوية بتظهر في «الكل».</p>` : ""}</div>`;
  h += `<div class="tabs rise">${GTABS.map(([k, n]) => `<button data-act="glTab" data-k="${k}" class="${G.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  const F = (n, b) => `<td class="n">${n ? (b ? "<b>" : "") + fmt(n, 1) + (b ? "</b>" : "") : ""}</td>`;
  if (G.tab === "tb") { const L = glTB(G), tot = L.reduce((s, x) => ({ dr: s.dr + x.dr, cr: s.cr + x.cr, cd: s.cd + Math.max(x.close, 0), cc: s.cc + Math.max(-x.close, 0) }), { dr: 0, cr: 0, cd: 0, cc: 0 }), ok = Math.abs(tot.dr - tot.cr) < 0.01 && Math.abs(tot.cd - tot.cc) < 0.01;
    h += `<div class="tw rise"><table><thead><tr><th>الحساب</th><th class="n">رصيد أول الفترة</th><th class="n">مدين</th><th class="n">دائن</th><th class="n">الرصيد مدين</th><th class="n">الرصيد دائن</th></tr></thead><tbody>${L.map(x => `<tr><td><span class="num dim">${x.a.code}</span> ${esc(x.a.name)}</td><td class="n">${x.open ? fmt(x.open, 1) : ""}</td>${F(x.dr)}${F(x.cr)}${F(Math.max(x.close, 0))}${F(Math.max(-x.close, 0))}</tr>`).join("") || `<tr><td colspan="6" class="muted">مفيش حركات في الفترة دي.</td></tr>`}
     <tr><td><b>الإجمالي</b></td><td></td>${F(tot.dr, 1)}${F(tot.cr, 1)}${F(tot.cd, 1)}${F(tot.cc, 1)}</tr></tbody></table></div><div class="${ok ? "okbox" : "warnbox"} rise">${ok ? "الميزان متوازن." : "الميزان مش متوازن — بلّغ الدعم."}</div>`; }
  if (G.tab === "is") { const I = glIncome(G), sec = (t, L) => `<tr><td colspan="2"><b>${t}</b></td></tr>` + L.filter(x => Math.abs(x[1]) > 0.004).map(x => `<tr><td style="padding-inline-start:22px">${esc(x[0])}</td><td class="n">${fmt(x[1], 1)}</td></tr>`).join("");
    h += `<div class="tw rise" style="max-width:720px"><table><tbody>${sec("الإيرادات", I.rev)}<tr><td><b>صافي الإيرادات</b></td><td class="n"><b>${fmt(I.R, 1)}</b></td></tr>${sec("تكلفة البضاعة المباعة", I.cogs)}<tr><td><b>مجمل الربح</b></td><td class="n"><b>${fmt(I.gp, 1)}</b>${I.R ? `<br><span class="dim" style="font-size:12px">${(I.gp / I.R * 100).toFixed(1)}%</span>` : ""}</td></tr>${sec("المصروفات", I.opx)}<tr><td><b>إجمالي المصروفات</b></td><td class="n">${fmt(I.O, 1)}</td></tr>
     <tr><td><b style="font-size:16px">صافي ${I.np >= 0 ? "الربح" : "الخسارة"}</b></td><td class="n"><b style="font-size:16px;color:${I.np >= 0 ? "var(--ok)" : "var(--bad)"}">${fmt(Math.abs(I.np), 1)}</b></td></tr></tbody></table></div>`; }
  if (G.tab === "bs") { const B = glBalance(G), sec = (t, L) => `<tr><td colspan="2"><b>${t}</b></td></tr>` + L.map(x => `<tr><td style="padding-inline-start:22px">${esc(x[0])}</td><td class="n">${fmt(x[1], 1)}</td></tr>`).join(""), ok = Math.abs(B.tA - B.tL - B.tE) < 0.01;
    h += `<p class="muted rise">المركز المالي في ${esc(G.to)}</p><div class="grid g2 rise"><div class="tw"><table><tbody>${sec("الأصول", B.A)}<tr><td><b>إجمالي الأصول</b></td><td class="n"><b>${fmt(B.tA, 1)}</b></td></tr></tbody></table></div>
     <div class="tw"><table><tbody>${sec("الخصوم", B.L)}<tr><td><b>إجمالي الخصوم</b></td><td class="n"><b>${fmt(B.tL, 1)}</b></td></tr>${sec("حقوق الملكية", B.E)}<tr><td style="padding-inline-start:22px">أرباح ${B.pr >= 0 ? "" : "(خسائر) "}لم تُقفل بعد</td><td class="n">${fmt(B.pr, 1)}</td></tr><tr><td><b>إجمالي حقوق الملكية</b></td><td class="n"><b>${fmt(B.tE, 1)}</b></td></tr><tr><td><b>الخصوم + حقوق الملكية</b></td><td class="n"><b>${fmt(B.tL + B.tE, 1)}</b></td></tr></tbody></table></div></div>
     <div class="${ok ? "okbox" : "warnbox"} rise">${ok ? "الأصول = الخصوم + حقوق الملكية." : "فيه فرق — بلّغ الدعم."}</div>`; }
  if (G.tab === "jr") { const R = glRows(G, true).slice().reverse(), groups = []; R.forEach(r => { const k = r.d + "|" + r.src + "|" + r.ref + "|" + r.memo; let g = groups[groups.length - 1]; if (!g || g.k !== k) groups.push(g = { k, r, L: [] }); g.L.push(r); });
    const per = 60, pg = Math.min(G.page, Math.max(0, Math.ceil(groups.length / per) - 1)), show = groups.slice(pg * per, pg * per + per);
    h += `<div class="tw rise"><table><thead><tr><th>التاريخ</th><th>المصدر</th><th>البيان</th><th>الحساب</th><th class="n">مدين</th><th class="n">دائن</th></tr></thead><tbody>${show.map(g => g.L.map((r, i) => `<tr${i === 0 ? ` style="border-top:2px solid var(--line2)"` : ""}><td class="num">${i === 0 ? esc(r.d) : ""}</td><td>${i === 0 ? `<span class="chip plain">${GSRC[r.src] || esc(r.src)}</span>` : ""}</td><td>${i === 0 ? `${esc(r.memo || "")}${r.loc ? `<br><span class="dim" style="font-size:12px">${esc(locName(r.loc))}</span>` : ""}` : ""}</td><td><span class="num dim">${r.a}</span> ${esc(glAcc(G, r.a).name)}</td>${F(r.dr)}${F(r.cr)}</tr>`).join("")).join("") || `<tr><td colspan="6" class="muted">مفيش قيود في الفترة دي.</td></tr>`}</tbody></table></div>
     ${groups.length > per ? `<div class="row rise" style="justify-content:center;gap:8px"><button class="btn sm" data-act="glPage" data-d="-1" ${pg === 0 ? "disabled" : ""}>الأحدث</button><span class="dim num">${pg + 1} / ${Math.ceil(groups.length / per)}</span><button class="btn sm" data-act="glPage" data-d="1" ${(pg + 1) * per >= groups.length ? "disabled" : ""}>الأقدم</button></div>` : ""}`; }
  if (G.tab === "lg") { const ac = glAcc(G, G.acct), dn = glDebitNature(ac.kind), ob = glSum(glRows(G, "before"))[G.acct] || { dr: 0, cr: 0 }; let run = dn ? ob.dr - ob.cr : ob.cr - ob.dr; const L = glRows(G, true).filter(r => r.a === G.acct);
    h += `<div class="field rise" style="max-width:420px"><label>الحساب</label><select class="inp" id="glA">${G.accts.filter(a => glLeaf(G, a.code)).map(a => `<option value="${a.code}" ${a.code === G.acct ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("")}</select></div>
     <div class="tw rise"><table><thead><tr><th>التاريخ</th><th>البيان</th><th>المرجع</th><th class="n">مدين</th><th class="n">دائن</th><th class="n">الرصيد</th></tr></thead><tbody><tr><td class="num">${esc(G.from)}</td><td colspan="4"><b>رصيد أول الفترة</b></td><td class="n"><b>${fmt(run, 1)}</b></td></tr>${L.map(r => { run += dn ? r.dr - r.cr : r.cr - r.dr; return `<tr><td class="num">${esc(r.d)}</td><td>${esc(r.memo || GSRC[r.src] || "")}</td><td class="num dim">${esc(String(r.ref || "").slice(0, 14))}</td>${F(r.dr)}${F(r.cr)}<td class="n">${fmt(run, 1)}</td></tr>`; }).join("")}<tr><td colspan="5"><b>الرصيد آخر الفترة</b> <span class="dim">(${dn ? "مدين" : "دائن"} بطبيعته)</span></td><td class="n"><b>${fmt(run, 1)}</b></td></tr></tbody></table></div>`; }
  if (G.tab === "coa") { const m = glSum(glRows(G, false));
    h += `<div class="tw rise"><table><thead><tr><th>الكود</th><th>الحساب</th><th>النوع</th><th class="n">الرصيد في ${esc(G.to)}</th><th></th></tr></thead><tbody>${G.accts.map(a => { const x = glRoll(m, a.code), b = glDebitNature(a.kind) ? x.dr - x.cr : x.cr - x.dr, lf = glLeaf(G, a.code), dep = a.code.length <= 1 ? 0 : a.code.length <= 2 ? 1 : 2;
      return `<tr><td class="num">${a.code}</td><td style="padding-inline-start:${10 + dep * 18}px">${lf ? esc(a.name) : `<b>${esc(a.name)}</b>`}${a.name_en && a.name_en !== a.name ? `<br><span class="dim" style="font-size:12px">${esc(a.name_en)}</span>` : ""}</td><td>${GKN[a.kind]}</td><td class="n">${lf ? fmt(b, 1) : `<b>${fmt(b, 1)}</b>`}</td><td>${canP && a.code.length <= 2 ? `<button class="btn sm ghost" data-act="coaAdd" data-c="${a.code}">${ico("plus")} حساب فرعي</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div><div class="okbox rise">الحسابات الأساسية ثابتة لأن القيود التلقائية بتتسجّل عليها. تقدر تضيف حسابات فرعية تحت أي مجموعة (مثلاً: مصروف جديد تحت «مصروفات التشغيل»).</div>`; }
  if (G.tab === "jv") { h += `<div class="tw rise"><table><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>السطور</th><th class="n">المبلغ</th><th>الحالة</th><th></th></tr></thead><tbody>${G.man.map(m => { const L = G.ml.filter(l => l.entry_id === m.id), amt = L.reduce((s, l) => s + +l.dr, 0);
      return `<tr><td class="num">${esc(m.no)}</td><td class="num">${esc(m.entry_date)}</td><td>${esc(m.memo)}<br><span class="dim" style="font-size:12px">${esc(who(m.created_by))}${m.approved_by && m.approved_by !== m.created_by ? " · اعتمده " + esc(who(m.approved_by)) : ""}</span></td><td style="font-size:12.5px">${L.map(l => `${+l.dr ? "من" : "إلى"} ${esc(glAcc(G, l.account).name)} <span class="num">${fmt(+l.dr || +l.cr, 1)}</span>`).join("<br>")}</td><td class="n">${fmt(amt, 1)}</td>
       <td><span class="chip ${m.status === "approved" ? "ok" : m.status === "pending" ? "warn" : "bad"}">${{ approved: "معتمد", pending: "مستني اعتماد", rejected: "مرفوض" }[m.status]}</span>${m.kind === "closing" ? `<br><span class="chip plain" style="margin-top:4px">إقفال سنوي</span>` : ""}</td><td class="row" style="gap:4px;flex-wrap:nowrap">${m.status === "pending" && canP && (m.created_by !== S.sess.staff.id || S.sess.role.id === "owner") ? `<button class="btn sm gold" data-act="jvOk" data-id="${m.id}">اعتماد</button><button class="btn sm ghost" data-act="jvNo" data-id="${m.id}">رفض</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">لسه مفيش قيود يدوية.</td></tr>`}</tbody></table></div><div class="okbox rise">القيود التلقائية (البيع والشراء والخزنة والمخزون) بتتعمل لوحدها من المستندات ومينفعش تتعدّل باليد. القيد اليدوي للمصروفات والتسويات، وبيتسجّل بعد اعتماد المالك أو المدير العام أو المحاسب (غير اللي كتبه).</div>`; }
  if (G.tab === "per") { const y = G.year, ys = [...new Set([+today().slice(0, 4), +today().slice(0, 4) - 1, ...G.yrs])].sort((a, b) => b - a), closedY = G.yrs.includes(y);
    h += `<div class="row rise" style="gap:8px"><select class="inp" id="glY" style="width:120px">${ys.map(v => `<option ${v === y ? "selected" : ""}>${v}</option>`).join("")}</select>${closedY ? `<span class="chip ok">السنة دي اتقفلت</span>` : S.sess.role.id === "owner" ? `<button class="btn gold" data-act="yearClose" data-y="${y}">إقفال سنة ${y}</button>` : ""}</div>
     <div class="tw rise"><table><thead><tr><th>الشهر</th><th>الحالة</th><th></th></tr></thead><tbody>${Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`).map(mo => { const cl = G.per.includes(mo); return `<tr><td class="num">${mo}</td><td><span class="chip ${cl ? "ok" : "info"}">${cl ? "مقفول" : "مفتوح"}</span></td><td>${!cl && canP && mo < today().slice(0, 7) ? `<button class="btn sm" data-act="perSet" data-m="${mo}" data-c="1">إقفال الشهر</button>` : ""}${cl && !closedY && S.sess.role.id === "owner" ? `<button class="btn sm ghost" data-act="perSet" data-m="${mo}" data-c="0">إعادة فتح</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>
     <div class="okbox rise">الشهر المقفول مينفعش يتسجّل عليه قيد يدوي جديد. إقفال السنة بيرحّل صافي الربح أو الخسارة لحساب «الأرباح المحتجزة» ويقفل الـ ١٢ شهر — والمالك بس اللي يعمله.</div>`; }
  return h; };
H.gl = () => { const G = S.gl; if (!G || !$("#glF")) return;
  $("#glF").onchange = e => { G.from = e.target.value || G.from; G.page = 0; render(); };
  $("#glT").onchange = e => { G.to = e.target.value || today(); G.page = 0; render(); };
  $("#glL").onchange = e => { G.loc = e.target.value; render(); };
  const a = $("#glA"); if (a) a.onchange = () => { G.acct = a.value; render(); };
  const y = $("#glY"); if (y) y.onchange = () => { G.year = +y.value; render(); }; };
function jvModal() { const G = S.gl, leaves = G.accts.filter(a => glLeaf(G, a.code)); S.jv = S.jv || { date: today(), memo: "", lines: [{ a: "", dr: "", cr: "" }, { a: "", dr: "", cr: "" }] }; const J = S.jv;
  modal(`<h2>قيد يدوي</h2><div class="stack" style="margin-top:10px"><div class="grid g2"><div class="field"><label>التاريخ</label><input class="inp" type="date" id="jvD" value="${J.date}" max="${today()}"></div><div class="field"><label>البيان</label><input class="inp" id="jvM" value="${esc(J.memo)}" placeholder="مثال: إيجار المعرض الأول — نوفمبر"></div></div>
   ${J.lines.map((l, n) => `<div class="row" style="gap:6px;flex-wrap:nowrap"><select class="inp" data-jva="${n}" style="flex:2"><option value="">— الحساب —</option>${leaves.map(a => `<option value="${a.code}" ${l.a === a.code ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("")}</select><input class="inp num" type="number" min="0" step="0.01" placeholder="مدين" data-jvd="${n}" value="${esc(l.dr)}" style="width:100px"><input class="inp num" type="number" min="0" step="0.01" placeholder="دائن" data-jvc="${n}" value="${esc(l.cr)}" style="width:100px">${J.lines.length > 2 ? `<button class="btn sm ghost" data-act="jvDel" data-n="${n}">✕</button>` : ""}</div>`).join("")}
   <button class="btn sm" data-act="jvAdd" style="align-self:flex-start">${ico("plus")} سطر</button>
   <div class="row between" id="jvTot"></div>
   ${S.sess.role.id === "owner" ? "" : `<p class="dim" style="margin:0;font-size:12.5px">القيد هيتسجّل بعد ما حد تاني له صلاحية يعتمده.</p>`}<div id="jvErr"></div>
   <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="jvCancel">إلغاء</button><button class="btn gold" data-act="jvSave">حفظ القيد</button></div></div>`);
  const sync = () => { J.date = $("#jvD").value; J.memo = $("#jvM").value; document.querySelectorAll("[data-jva]").forEach(e => { J.lines[+e.dataset.jva].a = e.value; }); document.querySelectorAll("[data-jvd]").forEach(e => { J.lines[+e.dataset.jvd].dr = e.value; }); document.querySelectorAll("[data-jvc]").forEach(e => { J.lines[+e.dataset.jvc].cr = e.value; }); };
  const tot = () => { sync(); const td = J.lines.reduce((s, l) => s + (+l.dr || 0), 0), tc = J.lines.reduce((s, l) => s + (+l.cr || 0), 0), ok = td > 0 && Math.abs(td - tc) < 0.005;
    $("#jvTot").innerHTML = `<span class="muted">مدين <b class="num">${fmt(td, 1)}</b> · دائن <b class="num">${fmt(tc, 1)}</b></span><span class="chip ${ok ? "ok" : "warn"}">${ok ? "متوازن" : "مش متوازن — الفرق " + fmt(Math.abs(td - tc), 1)}</span>`; };
  S._jvSync = sync; document.querySelectorAll("[data-jvd],[data-jvc]").forEach(e => e.oninput = tot); tot(); }
function glExport() { const G = S.gl, nm = (GTABS.find(t => t[0] === G.tab) || ["", "قيود"])[1], tag = ` ${G.from} إلى ${G.to}`;
  if (G.tab === "tb") return xlsOut("ميزان-المراجعة", "الميزان", [["ميزان المراجعة" + tag], ["الكود", "الحساب", "أول الفترة", "مدين", "دائن", "الرصيد مدين", "الرصيد دائن"], ...glTB(G).map(x => [x.a.code, x.a.name, r2(x.open), r2(x.dr), r2(x.cr), r2(Math.max(x.close, 0)), r2(Math.max(-x.close, 0))])], [8, 34, 14, 14, 14, 14, 14]);
  if (G.tab === "is") { const I = glIncome(G); return xlsOut("قائمة-الدخل", "الدخل", [["قائمة الدخل" + tag], ["الإيرادات"], ...I.rev.map(x => ["  " + x[0], r2(x[1])]), ["صافي الإيرادات", r2(I.R)], ["تكلفة البضاعة المباعة"], ...I.cogs.map(x => ["  " + x[0], r2(x[1])]), ["مجمل الربح", r2(I.gp)], ["المصروفات"], ...I.opx.map(x => ["  " + x[0], r2(x[1])]), ["إجمالي المصروفات", r2(I.O)], ["صافي الربح", r2(I.np)]], [40, 16]); }
  if (G.tab === "bs") { const B = glBalance(G); return xlsOut("المركز-المالي", "المركز المالي", [["المركز المالي في " + G.to], ["الأصول"], ...B.A.map(x => ["  " + x[0], r2(x[1])]), ["إجمالي الأصول", r2(B.tA)], ["الخصوم"], ...B.L.map(x => ["  " + x[0], r2(x[1])]), ["إجمالي الخصوم", r2(B.tL)], ["حقوق الملكية"], ...B.E.map(x => ["  " + x[0], r2(x[1])]), ["  أرباح لم تُقفل بعد", r2(B.pr)], ["إجمالي حقوق الملكية", r2(B.tE)]], [40, 16]); }
  if (G.tab === "lg") { const L = glRows(G, true).filter(r => r.a === G.acct); return xlsOut("دفتر-الأستاذ-" + G.acct, "الأستاذ", [[G.acct + " " + glAcc(G, G.acct).name + tag], ["التاريخ", "البيان", "المرجع", "مدين", "دائن"], ...L.map(r => [r.d, r.memo || GSRC[r.src] || "", r.ref, r2(r.dr), r2(r.cr)])], [12, 40, 16, 14, 14]); }
  if (G.tab === "coa") return xlsOut("دليل-الحسابات", "الدليل", [["الكود", "الحساب", "Account", "النوع", "الحساب الأب"], ...G.accts.map(a => [a.code, a.name, a.name_en || "", GKN[a.kind], a.parent || ""])], [8, 34, 30, 12, 10]);
  return xlsOut("اليومية", "اليومية", [["اليومية العامة" + tag], ["التاريخ", "المصدر", "المرجع", "البيان", "الحساب", "اسم الحساب", "مدين", "دائن", "المكان"], ...glRows(G, true).map(r => [r.d, GSRC[r.src] || r.src, r.ref, r.memo, r.a, glAcc(G, r.a).name, r2(r.dr), r2(r.cr), r.loc ? locName(r.loc) : ""])], [12, 12, 16, 36, 8, 26, 14, 14, 14]); }

/* ---------- settings & VAT ---------- */
V.settings = () => { let h = header(); const st = S.store || {}, own = S.sess.role.id === "owner", vx = S.items.filter(i => i.vat_rate != null);
  h += `<div class="card rise"><h3>شعار المحل</h3><div class="row" style="gap:16px;flex-wrap:wrap;align-items:center"><div style="width:140px;height:90px;border:1px dashed var(--line2);border-radius:10px;display:grid;place-items:center;background:#fff;padding:6px">${LOGO() ? logoImg("78px") : `<span class="dim" style="font-size:12px">مفيش شعار</span>`}</div>
    <div class="stack" style="gap:8px"><div class="row" style="gap:8px"><label class="btn gold" for="stLogo" style="cursor:pointer">${LOGO() ? "تغيير الشعار" : "رفع الشعار"}</label><input type="file" id="stLogo" accept="image/png,image/jpeg,image/webp" hidden>${LOGO() ? `<button class="btn ghost" data-act="stLogoDel">إزالة</button>` : ""}</div>
    <span class="dim" style="font-size:12.5px">PNG بخلفية شفافة أحسن حاجة. الشعار بيظهر في القائمة، وشاشة الدخول، والإيصال، والفاتورة الضريبية، والتقرير النهائي.</span><div id="stLogoErr"></div></div></div></div>`;
  if (own) { const bk = bkLast("settings"), late = bk && (!bk.at || Date.now() - new Date(bk.at).getTime() > 36 * 3600e3);
    h += `<div class="card rise"><h3>آخر نسخة احتياطية</h3>${!bk ? `<div class="spin"></div>` : bk.at ? `<div class="row" style="gap:24px;flex-wrap:wrap"><div><div class="dim" style="font-size:12.5px">التاريخ</div><b class="num">${esc(bkWhen(bk.at))}</b></div><div><div class="dim" style="font-size:12.5px">الحجم</div><b class="num">${bkSize(bk.bytes)}</b></div></div>` : `<p style="margin:0">لسه مفيش نسخة على Google Drive.</p>`}
      <p class="dim" style="font-size:12.5px;margin:8px 0 0">نسخة كل يوم الساعة ٦ الصبح على Google Drive وإيميلك (ملف Excel للقراءة + ملف للاسترجاع).${late ? ` <b style="color:var(--bad)">${bk.at ? "آخر نسخة عدّى عليها أكتر من ٣٦ ساعة." : ""}</b>` : ""}</p></div>`; }
  const al = st.auto_lock_min == null ? 10 : +st.auto_lock_min;
  h += `<div class="card rise"><h3>القفل التلقائي</h3><div class="row" style="gap:12px;align-items:flex-end;flex-wrap:wrap"><div class="field" style="max-width:260px"><label>يتقفل بعد كام دقيقة من غير استخدام</label><input class="inp num" type="number" min="0" max="240" id="stLock" value="${al}"></div><button class="btn gold" data-act="stLockSave">حفظ</button></div>
    <p class="dim" style="font-size:12.5px;margin:8px 0 0">بيتطبق على كل الأجهزة، في المعارض والأجهزة الشخصية. ${al === 0 ? `<b style="color:var(--bad)">دلوقتي القفل التلقائي مقفول.</b>` : ""}</p><div id="stLockMsg"></div></div>`;
  h += `<div class="grid g2"><div class="card rise"><h3>بيانات المحل</h3><div class="stack"><div class="field"><label>اسم المحل</label><input class="inp" id="stN" value="${esc(st.name || "")}"></div>
    <div class="grid g2"><div class="field"><label>ميعاد تقفيل اليوم</label><input class="inp" type="time" id="stC" value="${esc(String(st.day_close_time || "06:00").slice(0, 5))}"></div><div class="field"><label>ميعاد فتح اليوم الجديد</label><input class="inp" type="time" id="stO" value="${esc(String(st.day_open_time || "07:00").slice(0, 5))}"></div></div>
    <p class="dim" style="margin:0;font-size:12.5px">البيع بيتقفل بين ميعاد التقفيل وميعاد الفتح، وأي بيع بعد نص الليل وقبل التقفيل بيتحسب على اليوم اللي فات.</p>
    <div class="grid g2"><div class="field"><label>تنبيه فرق سعر الشراء (%)</label><input class="inp num" type="number" min="1" max="100" id="stP" value="${+st.price_alert_pct || 10}"></div><div class="field"><label>أقل هامش ربح مسموح في العروض (%)</label><input class="inp num" type="number" min="0" max="90" id="stM" value="${+st.min_margin_pct || 10}"></div></div></div></div>
   <div class="card rise"><h3>ضريبة القيمة المضافة</h3><div class="stack"><label class="row" style="gap:8px"><input type="checkbox" id="stV" ${st.vat_registered ? "checked" : ""} ${own ? "" : "disabled"}> المحل مسجّل في ضريبة القيمة المضافة</label>
    ${own ? "" : `<p class="dim" style="margin:0;font-size:12.5px">تشغيل أو إيقاف الضريبة من المالك بس.</p>`}
    <div id="stVbox" style="${st.vat_registered ? "" : "display:none"}" class="stack"><div class="grid g2"><div class="field"><label>رقم التسجيل الضريبي (٩ أرقام)</label><input class="inp num" id="stR" maxlength="9" inputmode="numeric" value="${esc(st.vat_rin || "")}"></div><div class="field"><label>بداية تطبيق الضريبة</label><input class="inp" type="date" id="stF" value="${esc(st.vat_from || "")}"></div>
     <div class="field"><label>النسبة العامة (%)</label><input class="inp num" type="number" min="0" max="100" step="0.5" id="stRt" value="${st.vat_rate != null ? +st.vat_rate : 14}"></div><div class="field"><label>أسعار البيع</label><select class="inp" id="stI"><option value="1" ${st.prices_include_vat ? "selected" : ""}>شاملة الضريبة</option><option value="0" ${st.prices_include_vat ? "" : "selected"}>من غير الضريبة (تتضاف عليها)</option></select></div></div>
     <div class="okbox" style="font-size:12.5px">الفواتير من تاريخ البداية بتحسب الضريبة لوحدها وبتتسجّل على حساب «ضريبة القيمة المضافة المستحقة». الفواتير القديمة مش بتتغيّر.</div></div></div></div></div>
   <div id="stErr"></div><button class="btn gold rise" data-act="stSave" style="align-self:flex-start">حفظ الإعدادات</button>`;
  h += `<div class="card rise"><h3>نسبة ضريبة مختلفة لأصناف معيّنة</h3><p class="muted" style="margin-top:0">لو صنف معفي أو له نسبة غير النسبة العامة.</p>
   <div class="row" style="gap:6px;flex-wrap:nowrap;max-width:640px"><select class="inp" id="vxI" style="flex:2">${S.items.filter(i => i.vat_rate == null).map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join("")}</select><input class="inp num" id="vxR" type="number" min="0" max="100" step="0.5" value="0" style="width:90px" title="النسبة %"><button class="btn sm" data-act="vxAdd">${ico("plus")} إضافة</button></div>
   <div class="tw" style="margin-top:10px"><table><thead><tr><th>الصنف</th><th class="n">النسبة</th><th></th></tr></thead><tbody>${vx.map(i => `<tr><td>${esc(i.name)}</td><td class="n">${+i.vat_rate}%${+i.vat_rate === 0 ? ` <span class="chip plain">معفي</span>` : ""}</td><td><button class="btn sm ghost" data-act="vxDel" data-id="${i.id}">رجّعه للنسبة العامة</button></td></tr>`).join("") || `<tr><td colspan="3" class="muted">كل الأصناف على النسبة العامة.</td></tr>`}</tbody></table></div></div>`;
  return h; };
H.settings = () => { const lf = $("#stLogo"); if (lf) lf.onchange = async e => { const f = e.target.files[0]; if (!f) return; const box = $("#stLogoErr");
    try { box.innerHTML = `<span class="dim">بيترفع…</span>`; const url = await shrinkLogo(f); await rpc("store_logo_save", { p_token: T(), p_logo: url }); await loadCore(); toast("اتحفظ الشعار."); render(); }
    catch (er) { box.innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; } };
  const v = $("#stV"); if (v) v.onchange = () => { $("#stVbox").style.display = v.checked ? "" : "none"; if (v.checked && !$("#stF").value) $("#stF").value = today(); }; };

/* logo: shrink in the browser so the store row stays small (≤ 512 px on the long side) */
async function shrinkLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("BAD_IMAGE");
  const src = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });
  const img = new Image(); await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("BAD_IMAGE")); img.src = src; });
  const k = Math.min(1, 512 / Math.max(img.width, img.height)), cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
  cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
  let out = cv.toDataURL("image/png"); if (out.length > 280000) out = cv.toDataURL("image/webp", 0.88);
  if (out.length > 280000 || !out.startsWith("data:image/webp")) { if (out.length > 280000) { const g = cv.getContext("2d"); g.globalCompositeOperation = "destination-over"; g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); out = cv.toDataURL("image/jpeg", 0.85); } }
  if (out.length > 400000) throw new Error("IMAGE_TOO_BIG"); return out; }

/* ---------- salesperson commission ---------- */
const CSC = { dept: "قسم", group: "مجموعة", item: "صنف (تصفية)" };
async function loadCom() { const C = S.com || { month: today().slice(0, 7), tab: "rep" };
  const [rep, rules, tiers, tg] = await Promise.all([rpc("commission_report", { p_token: T(), p_month: C.month }), q("commission_rules", "*", x => x.order("id")), q("commission_tiers", "*", x => x.order("pct")), q("staff_targets", "*", x => x.eq("month", C.month))]);
  await loadDir().catch(() => {});
  C.rep = rep || []; C.cfg = { rules: rules.map(r => ({ scope: r.scope, ref: r.ref, rate: +r.rate, valid_from: r.valid_from || "", valid_to: r.valid_to || "" })), tiers: tiers.map(t => ({ pct: +t.pct, extra_rate: +t.extra_rate, bonus: +t.bonus })), targets: Object.fromEntries(tg.map(t => [t.staff_id, +t.target])) };
  C.loaded = C.month; S.com = C; return C; }
const comRefs = sc => sc === "dept" ? S.depts.map(d => [String(d.id), d.name]) : sc === "group" ? S.groups.map(g => [String(g.id), (S.depts.find(d => d.id === g.department_id) || {}).name + " · " + g.name]) : S.items.map(i => [i.id, i.name]);
V.commission = () => { let h = header(); const C = S.com; if (!C || C.loaded !== C.month) { setTimeout(() => loadCom().then(() => S.route === "commission" && render()).catch(e => toast(errText(e), true)), 0); return h + `<div class="spin"></div>`; }
  const canCfg = ["owner", "gm", "acct"].includes(S.sess.role.id), sellers = (S.dir || []).filter(x => x.active && x.role_id === "seller");
  h = header(`<input class="inp" type="month" id="cmM" value="${C.month}" max="${today().slice(0, 7)}" style="width:160px"><button class="btn" data-act="comXls">Excel</button>`);
  if (canCfg) h += `<div class="tabs rise">${[["rep", "تقرير الشهر"], ["cfg", "القواعد والشرايح والتارجت"]].map(([k, n]) => `<button data-act="comTab" data-k="${k}" class="${C.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  if (C.tab === "rep" || !canCfg) { const tot = C.rep.reduce((s, x) => s + +x.total, 0);
    h += `<div class="tw rise"><table><thead><tr><th>البائع</th><th class="n">صافي المبيعات</th><th class="n">التارجت</th><th class="n">التحقيق</th><th class="n">عمولة الأصناف</th><th class="n">شريحة التارجت</th><th class="n">المكافأة</th><th class="n">الإجمالي</th></tr></thead><tbody>${C.rep.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${fmt(x.net, 1)}</td><td class="n">${x.target ? fmt(x.target) : "—"}</td><td class="n">${x.attain != null ? `<span class="chip ${+x.attain >= 100 ? "ok" : +x.attain >= 80 ? "warn" : "plain"}">${x.attain}%</span>` : "—"}</td><td class="n">${fmt(x.base, 1)}</td><td class="n">${x.tier_pct != null ? `${+x.tier_pct}% ← ${fmt(x.extra, 1)}` : "—"}</td><td class="n">${+x.bonus ? fmt(x.bonus) : "—"}</td><td class="n"><b>${fmt(x.total, 1)}</b></td></tr>`).join("") || `<tr><td colspan="8" class="muted">مفيش مبيعات بأسماء بائعين في الشهر ده.</td></tr>`}${C.rep.length > 1 ? `<tr><td colspan="7"><b>الإجمالي</b></td><td class="n"><b>${fmt(tot, 1)}</b></td></tr>` : ""}</tbody></table></div>
     <div class="okbox rise">صافي المبيعات = فواتير البائع ناقص المرتجعات، من غير الضريبة. العمولة بتتحسب بنسبة الصنف لو ليه قاعدة (تصفية)، وإلا المجموعة، وإلا القسم. ولو البائع وصل لشريحة من التارجت بياخد نسبة إضافية على كل مبيعاته + المكافأة.</div>`; }
  else { const F = C.cfg;
    h += `<div class="card rise"><h3>نسبة العمولة</h3><div class="stack">${F.rules.map((r, n) => `<div class="row" style="gap:6px;flex-wrap:wrap"><select class="inp" data-crs="${n}" style="width:130px">${Object.entries(CSC).map(([k, v]) => `<option value="${k}" ${r.scope === k ? "selected" : ""}>${v}</option>`).join("")}</select><select class="inp" data-crr="${n}" style="flex:2;min-width:180px">${comRefs(r.scope).map(([k, v]) => `<option value="${esc(k)}" ${String(r.ref) === String(k) ? "selected" : ""}>${esc(v)}</option>`).join("")}</select><input class="inp num" type="number" min="0" step="0.1" data-crt="${n}" value="${r.rate}" style="width:80px" title="%"><span class="dim">%</span>${r.scope === "item" ? `<input class="inp" type="date" data-crf="${n}" value="${esc(r.valid_from)}" title="من"><input class="inp" type="date" data-crto="${n}" value="${esc(r.valid_to)}" title="إلى">` : ""}<button class="btn sm ghost" data-act="crDel" data-n="${n}">✕</button></div>`).join("") || `<p class="muted" style="margin:0">لسه مفيش قواعد — مفيش عمولة على أي صنف.</p>`}
     <button class="btn sm" data-act="crAdd" style="align-self:flex-start">${ico("plus")} قاعدة</button></div></div>
     <div class="card rise"><h3>شرايح التارجت الشهري</h3><div class="stack">${F.tiers.map((t, n) => `<div class="row" style="gap:6px;flex-wrap:nowrap"><span class="dim">لو حقق</span><input class="inp num" type="number" min="1" data-ctp="${n}" value="${t.pct}" style="width:80px"><span class="dim">% ياخد زيادة</span><input class="inp num" type="number" min="0" step="0.1" data-cte="${n}" value="${t.extra_rate}" style="width:80px"><span class="dim">% + مكافأة</span><input class="inp num" type="number" min="0" data-ctb="${n}" value="${t.bonus}" style="width:100px"><button class="btn sm ghost" data-act="ctDel" data-n="${n}">✕</button></div>`).join("") || `<p class="muted" style="margin:0">مفيش شرايح.</p>`}
     <button class="btn sm" data-act="ctAdd" style="align-self:flex-start">${ico("plus")} شريحة</button></div></div>
     <div class="card rise"><h3>تارجت ${esc(C.month)}</h3><div class="grid g2">${sellers.map(x => `<div class="field"><label>${esc(x.name)}${x.location_id ? ` <span class="dim">· ${esc(locName(x.location_id))}</span>` : ""}</label><input class="inp num" type="number" min="0" data-ctg="${x.id}" value="${F.targets[x.id] || ""}" placeholder="من غير تارجت"></div>`).join("") || `<p class="muted">مفيش بائعين — ضيفهم من شاشة الموظفين بدور «بائع».</p>`}</div></div>
     <div id="cmErr"></div><button class="btn gold rise" data-act="comSave" style="align-self:flex-start">حفظ</button>`; }
  return h; };
H.commission = () => { const m = $("#cmM"); if (m) m.onchange = () => { if (m.value) { S.com.month = m.value; render(); } };
  document.querySelectorAll("[data-crs]").forEach(e => e.onchange = () => { comSync(); const r = S.com.cfg.rules[+e.dataset.crs]; r.scope = e.value; r.ref = (comRefs(e.value)[0] || [""])[0]; render(); }); };
function comSync() { const F = S.com && S.com.cfg; if (!F || !$("[data-act=comSave]")) return;
  document.querySelectorAll("[data-crr]").forEach(e => { F.rules[+e.dataset.crr].ref = e.value; }); document.querySelectorAll("[data-crt]").forEach(e => { F.rules[+e.dataset.crt].rate = +e.value || 0; });
  document.querySelectorAll("[data-crf]").forEach(e => { F.rules[+e.dataset.crf].valid_from = e.value; }); document.querySelectorAll("[data-crto]").forEach(e => { F.rules[+e.dataset.crto].valid_to = e.value; });
  document.querySelectorAll("[data-ctp]").forEach(e => { F.tiers[+e.dataset.ctp].pct = +e.value || 0; }); document.querySelectorAll("[data-cte]").forEach(e => { F.tiers[+e.dataset.cte].extra_rate = +e.value || 0; }); document.querySelectorAll("[data-ctb]").forEach(e => { F.tiers[+e.dataset.ctb].bonus = +e.value || 0; });
  document.querySelectorAll("[data-ctg]").forEach(e => { if (e.value === "") delete F.targets[e.dataset.ctg]; else F.targets[e.dataset.ctg] = +e.value; }); }

/* ---------- offers ---------- */
const OFK = { pct: "خصم نسبة %", amount: "خصم مبلغ", bxgy: "اشترِ X واحصل على Y", nth: "التاني بخصم", bundle: "طقم بسعر ثابت", gift: "هدية مع الشراء" };
const OFS = { item: "أصناف", group: "مجموعات", dept: "أقسام", invoice: "الفاتورة كلها", bundle: "أصناف الطقم" };
const OFST = { active: ["شغّال", "ok"], paused: ["متوقف مؤقتًا", "warn"], ended: ["انتهى", "plain"] };
const DAYS = ["الأحد", "الاتنين", "التلات", "الأربع", "الخميس", "الجمعة", "السبت"];
async function loadOffers() { const o = await q("offers", "*", x => x.order("status").order("priority", { ascending: false }).order("id", { ascending: false })); S.ofs = { list: o, tab: (S.ofs && S.ofs.tab) || "active" }; return S.ofs; }
const ofTarget = o => { const nm = o.scope === "dept" ? id => (S.depts.find(d => String(d.id) === id) || {}).name : o.scope === "group" ? id => (S.groups.find(g => String(g.id) === id) || {}).name : id => (S.items.find(i => i.id === id) || {}).name;
  return o.scope === "invoice" ? `الفاتورة${+o.min_total ? " من " + fmt(o.min_total) : ""}` : (o.refs || []).map(r => esc(nm(r) || "؟")).join("، "); };
const ofValue = o => o.kind === "pct" ? `${+o.value}%` : o.kind === "amount" ? (o.scope === "invoice" ? fmt(o.value) : fmt(o.value) + " للقطعة") : o.kind === "nth" ? `كل ${+o.buy_qty} ← ${+o.get_qty} بخصم ${+o.value}%` : o.kind === "bxgy" ? `اشترِ ${+o.buy_qty} واحصل على ${+o.get_qty} ببلاش` : o.kind === "bundle" ? `الطقم بـ ${fmt(o.value)}` : `كل ${+o.buy_qty || 1} ← ${+o.get_qty || 1} ${esc((S.items.find(i => i.id === o.gift_item) || {}).name || "")} هدية`;
const ofWhen = o => { const d = x => new Date(x).toLocaleDateString("ar-EG", { day: "numeric", month: "short" }); return `${d(o.starts_at)}${o.ends_at ? " ← " + d(o.ends_at) : " · مفتوح"}${o.days && o.days.length ? "<br>" + o.days.map(x => DAYS[x]).join("، ") : ""}${o.hour_from ? `<br><span class="num">${String(o.hour_from).slice(0, 5)}–${String(o.hour_to).slice(0, 5)}</span>` : ""}${o.locs && o.locs.length ? "<br>" + o.locs.map(locName).map(esc).join("، ") : ""}`; };
V.offers = () => { let h = header(); const D = S.ofs; if (!D) { setTimeout(() => loadOffers().then(() => S.route === "offers" && render()).catch(e => toast(errText(e), true)), 0); return h + `<div class="spin"></div>`; }
  const canA = isOwnerGm() || can("offers", "a"), canE = isOwnerGm() || can("offers", "e"), now = new Date().toISOString();
  h = header(canA ? `<button class="btn gold" data-act="ofNew">${ico("plus")} عرض جديد</button>` : "");
  const live = D.list.filter(o => o.status === "active" && o.starts_at <= now && (!o.ends_at || o.ends_at > now));
  h += `<div class="grid g4">${[["شغّال دلوقتي", live.length], ["مجدول لبعدين", D.list.filter(o => o.status === "active" && o.starts_at > now).length], ["متوقف مؤقتًا", D.list.filter(o => o.status === "paused").length], ["انتهى", D.list.filter(o => o.status === "ended" || (o.ends_at && o.ends_at <= now)).length]].map((k, i) => `<div class="card kpi rise ${i === 0 ? "lux" : ""}" style="--d:${i}"><div class="lbl">${k[0]}</div><div class="val">${k[1]}</div></div>`).join("")}</div>`;
  h += `<div class="tabs rise">${[["active", "الشغّالة والمجدولة"], ["paused", "المتوقفة"], ["ended", "المنتهية"], ["coupons", "الكوبونات"]].map(([k, n]) => `<button data-act="ofTab" data-k="${k}" class="${D.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>`;
  const L = D.list.filter(o => D.tab === "ended" ? o.status === "ended" || (o.ends_at && o.ends_at <= now) : o.status === D.tab && !(o.ends_at && o.ends_at <= now));
  h += `<div class="tw rise"><table><thead><tr><th>العرض</th><th>على</th><th>القيمة</th><th>المدة</th><th class="n">الأولوية</th><th>الحالة</th><th></th></tr></thead><tbody>${L.map(o => { const st = o.ends_at && o.ends_at <= now && o.status !== "ended" ? ["انتهت مدته", "plain"] : o.status === "active" && o.starts_at > now ? ["مجدول", "info"] : OFST[o.status];
    return `<tr><td><b>${esc(o.name)}</b><br><span class="dim" style="font-size:12px">${OFK[o.kind]}</span>${o.note ? `<br><span class="dim" style="font-size:12px">${esc(o.note)}</span>` : ""}</td><td style="max-width:260px">${ofTarget(o)}</td><td>${ofValue(o)}</td><td style="font-size:12.5px">${ofWhen(o)}</td><td class="n">${o.priority}</td><td><span class="chip ${st[1]}">${st[0]}</span></td>
     <td class="row" style="gap:4px;flex-wrap:nowrap">${canE && o.status !== "ended" ? `<button class="btn sm ghost" data-act="ofEdit" data-id="${o.id}">تعديل</button>${o.status === "active" ? `<button class="btn sm ghost" data-act="ofSt" data-id="${o.id}" data-s="paused">إيقاف</button>` : `<button class="btn sm" data-act="ofSt" data-id="${o.id}" data-s="active">تشغيل</button>`}<button class="btn sm ghost" data-act="ofSt" data-id="${o.id}" data-s="ended">إنهاء</button>` : ""}${canA ? `<button class="btn sm ghost" data-act="ofCopy" data-id="${o.id}" title="استخدمه كقالب لعرض جديد">نسخ</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="7" class="muted">مفيش عروض هنا.</td></tr>`}</tbody></table></div>
   <div class="okbox rise">العروض مش بتتجمّع: كل صنف بياخد عرض واحد بس — الأعلى أولوية. عرض الفاتورة بيتطبّق على الأصناف اللي ما عليهاش عرض. ومينفعش عرضين بنفس الأولوية على نفس الصنف في نفس الوقت. لو حصل أي خطأ في حساب العرض، البيع بيكمل بالسعر العادي.</div>`;
  return h; };
const dtl = x => { if (!x) return ""; const d = new Date(x), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
function ofModal(o, copy) { const x = o ? { ...o, refs: [...(o.refs || [])], locs: [...(o.locs || [])], days: [...(o.days || [])] } : { name: "", kind: "pct", scope: "item", refs: [], value: 10, buy_qty: 2, get_qty: 1, gift_item: null, min_total: null, locs: [], starts_at: new Date().toISOString(), ends_at: null, days: [], hour_from: null, hour_to: null, priority: 1, note: "" };
  if (copy) { delete x.id; x.name = "نسخة من " + x.name; x.starts_at = new Date().toISOString(); x.ends_at = null; }
  S.of = x; ofDraw(); }
function ofDraw(check) { const x = S.of, scopes = x.kind === "bundle" ? ["bundle"] : x.kind === "pct" || x.kind === "amount" ? ["item", "group", "dept", "invoice"] : ["item", "group", "dept"];
  if (!scopes.includes(x.scope)) { x.scope = scopes[0]; x.refs = []; }
  const opts = x.scope === "invoice" ? [] : comRefs(x.scope === "bundle" ? "item" : x.scope), chosen = opts.filter(([k]) => x.refs.includes(String(k)));
  modal(`<h2>${x.id ? "تعديل عرض" : "عرض جديد"}</h2><div class="stack" style="margin-top:10px">
   <div class="grid g2"><div class="field"><label>اسم العرض</label><input class="inp" id="ofN" value="${esc(x.name)}" placeholder="مثال: خصم الشتا على المفروشات"></div><div class="field"><label>النوع</label><select class="inp" id="ofK">${Object.entries(OFK).map(([k, v]) => `<option value="${k}" ${x.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></div></div>
   <div class="field"><label>العرض على</label><div class="tabs" style="margin:0">${scopes.map(s => `<button data-act="ofScope" data-k="${s}" class="${x.scope === s ? "on" : ""}">${OFS[s]}</button>`).join("")}</div></div>
   ${x.scope !== "invoice" ? `<div class="field"><label>${OFS[x.scope]} (${chosen.length})</label><input class="inp" id="ofQ" placeholder="دوّر واختار…" autocomplete="off"><div id="ofOpts" class="stack" style="gap:2px;max-height:150px;overflow:auto;margin-top:4px"></div>
     <div class="row" style="gap:4px;flex-wrap:wrap;margin-top:6px">${chosen.map(([k, v]) => `<span class="chip gold plain">${esc(v)} <button class="btn sm ghost" style="padding:0 4px" data-act="ofRef" data-k="${esc(k)}">✕</button></span>`).join("")}</div></div>` : `<div class="field"><label>أقل قيمة للفاتورة</label><input class="inp num" type="number" min="0" id="ofMin" value="${x.min_total || ""}" placeholder="من غير حد أدنى"></div>`}
   <div class="grid g2">${x.kind === "pct" ? `<div class="field"><label>نسبة الخصم %</label><input class="inp num" type="number" min="0.1" max="100" step="0.5" id="ofV" value="${+x.value || ""}"></div>` : x.kind === "amount" ? `<div class="field"><label>${x.scope === "invoice" ? "الخصم على الفاتورة" : "الخصم على القطعة"} (ج.م)</label><input class="inp num" type="number" min="1" id="ofV" value="${+x.value || ""}"></div>` : x.kind === "bundle" ? `<div class="field"><label>سعر الطقم كله (ج.م)</label><input class="inp num" type="number" min="1" id="ofV" value="${+x.value || ""}"></div><div class="field"><label>سعر الأصناف منفصلة</label><div class="num" style="padding:10px 0">${fmt(chosen.reduce((s, [k]) => s + +((S.items.find(i => i.id === k) || {}).sale_price || 0), 0))}</div></div>`
     : x.kind === "nth" ? `<div class="field"><label>كل ما يشتري</label><input class="inp num" type="number" min="1" id="ofB" value="${+x.buy_qty || 1}"></div><div class="field"><label>ياخد كام بخصم (الأرخص)</label><input class="inp num" type="number" min="1" id="ofG" value="${+x.get_qty || 1}"></div><div class="field"><label>نسبة الخصم عليهم %</label><input class="inp num" type="number" min="1" max="100" id="ofV" value="${+x.value || 50}"></div>`
     : x.kind === "bxgy" ? `<div class="field"><label>لما يشتري</label><input class="inp num" type="number" min="1" id="ofB" value="${+x.buy_qty || 2}"></div><div class="field"><label>ياخد ببلاش (الأرخص)</label><input class="inp num" type="number" min="1" id="ofG" value="${+x.get_qty || 1}"></div>`
     : `<div class="field"><label>الهدية</label><select class="inp" id="ofGi">${S.items.map(i => `<option value="${i.id}" ${x.gift_item === i.id ? "selected" : ""}>${esc(i.name)}</option>`).join("")}</select></div><div class="field"><label>كل كام قطعة ← كام هدية</label><div class="row" style="gap:4px;flex-wrap:nowrap"><input class="inp num" type="number" min="1" id="ofB" value="${+x.buy_qty || 1}"><span>←</span><input class="inp num" type="number" min="1" id="ofG" value="${+x.get_qty || 1}"></div></div>`}
    <div class="field"><label>الأولوية <span class="dim">(الأعلى بيكسب)</span></label><input class="inp num" type="number" min="1" max="99" id="ofP" value="${x.priority}"></div></div>
   ${x.kind === "gift" ? `<p class="dim" style="margin:0;font-size:12.5px">الكاشير بيضيف الهدية للفاتورة، والسيستم بيخلّي سعرها صفر لوحده.</p>` : ""}
   <div class="grid g2"><div class="field"><label>يبدأ</label><input class="inp" type="datetime-local" id="ofS" value="${dtl(x.starts_at)}"></div><div class="field"><label>ينتهي <span class="dim">(اختياري)</span></label><input class="inp" type="datetime-local" id="ofE" value="${dtl(x.ends_at)}"></div></div>
   <div class="field"><label>الأيام <span class="dim">(من غير اختيار = كل يوم)</span></label><div class="row" style="gap:8px;flex-wrap:wrap">${DAYS.map((d, i) => `<label class="row" style="gap:4px"><input type="checkbox" data-ofd="${i}" ${x.days.includes(i) ? "checked" : ""}>${d}</label>`).join("")}</div></div>
   <div class="grid g2"><div class="field"><label>من الساعة <span class="dim">(عرض بالوقت)</span></label><input class="inp" type="time" id="ofH1" value="${x.hour_from ? String(x.hour_from).slice(0, 5) : ""}"></div><div class="field"><label>لحد الساعة</label><input class="inp" type="time" id="ofH2" value="${x.hour_to ? String(x.hour_to).slice(0, 5) : ""}"></div></div>
   <div class="field"><label>المعارض <span class="dim">(من غير اختيار = الكل)</span></label><div class="row" style="gap:10px;flex-wrap:wrap">${S.locs.filter(l => l.kind === "showroom").map(l => `<label class="row" style="gap:4px"><input type="checkbox" data-ofl="${l.id}" ${x.locs.includes(l.id) ? "checked" : ""}>${esc(l.name)}</label>`).join("")}</div></div>
   <div class="field"><label>ملاحظة</label><input class="inp" id="ofNt" value="${esc(x.note || "")}"></div>
   ${check ? `<div class="warnbox"><b>تحذير الهامش</b> — محسوب بعد أسوأ عمولة تقسيط على المحل (${+check.worst_comm}%)، والحد الأدنى ${+check.min_margin}%:<div style="max-height:150px;overflow:auto;margin-top:6px">${check.rows.slice(0, 40).map(r => `${esc(r.item)}: صافي <span class="num">${fmt(r.net, 1)}</span> · تكلفة <span class="num">${fmt(r.cost, 1)}</span> · ${r.level === "cost" ? `<b style="color:var(--bad)">تحت التكلفة</b>` : `هامش ${r.margin}%`}`).join("<br>")}${check.rows.length > 40 ? `<br>و ${check.rows.length - 40} صنف كمان` : ""}</div>${check.rows.some(r => r.level === "cost") && !isOwnerGm() ? `<p style="margin:6px 0 0">البيع تحت التكلفة محتاج المالك أو المدير العام.</p>` : ""}</div>` : ""}
   <div id="ofErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button>${check ? `<button class="btn" data-act="ofSave" data-c="1">حفظ رغم التحذير</button>` : `<button class="btn gold" data-act="ofSave">حفظ</button>`}</div></div>`);
  const sync = () => { x.name = $("#ofN").value; x.priority = +$("#ofP").value || 1; x.note = $("#ofNt").value; const v = $("#ofV"); if (v) x.value = +v.value || 0; const b = $("#ofB"); if (b) x.buy_qty = +b.value || 1; const g = $("#ofG"); if (g) x.get_qty = +g.value || 1; const gi = $("#ofGi"); if (gi) x.gift_item = gi.value; const mn = $("#ofMin"); if (mn) x.min_total = mn.value === "" ? null : +mn.value;
    x.starts_at = $("#ofS").value ? new Date($("#ofS").value).toISOString() : new Date().toISOString(); x.ends_at = $("#ofE").value ? new Date($("#ofE").value).toISOString() : null;
    x.days = [...document.querySelectorAll("[data-ofd]:checked")].map(e => +e.dataset.ofd); x.locs = [...document.querySelectorAll("[data-ofl]:checked")].map(e => +e.dataset.ofl); x.hour_from = $("#ofH1").value || null; x.hour_to = $("#ofH2").value || null; };
  S._ofSync = sync; $("#ofK").onchange = e => { sync(); x.kind = e.target.value; ofDraw(); };
  const qi = $("#ofQ"); if (qi) { const draw = () => { const t = norm(qi.value), L = opts.filter(([k, v]) => !x.refs.includes(String(k)) && (!t || norm(v).includes(t))).slice(0, 30); $("#ofOpts").innerHTML = L.map(([k, v]) => `<button class="btn sm ghost" style="justify-content:flex-start" data-act="ofRef" data-k="${esc(k)}">${ico("plus")} ${esc(v)}</button>`).join("") || `<span class="dim">مفيش نتايج.</span>`; }; qi.oninput = draw; draw(); }
}

async function ops4Click(k, a) {
  const wrap = async (fn, after, box) => { busy(a, true); try { await fn(); if (after) await after(); } catch (e) { if (box && $(box)) $(box).innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; else toast(errText(e), true); busy(a, false); } };
  const G = S.gl;
  if (k === "glTab") { G.tab = a.dataset.k; G.page = 0; render(); }
  else if (k === "glPage") { G.page = Math.max(0, G.page + +a.dataset.d); render(); }
  else if (k === "glXls") glExport();
  else if (k === "jvNew") { S.jv = null; jvModal(); }
  else if (k === "jvAdd") { S._jvSync(); S.jv.lines.push({ a: "", dr: "", cr: "" }); jvModal(); }
  else if (k === "jvDel") { S._jvSync(); S.jv.lines.splice(+a.dataset.n, 1); jvModal(); }
  else if (k === "jvCancel") { S.jv = null; closeModal(); }
  else if (k === "jvSave") { S._jvSync(); const J = S.jv, L = J.lines.filter(l => l.a && (+l.dr > 0 || +l.cr > 0));
    if (J.lines.some(l => +l.dr > 0 && +l.cr > 0)) return ($("#jvErr").innerHTML = `<div class="warnbox">السطر الواحد يا مدين يا دائن.</div>`);
    wrap(() => rpc("gl_manual_save", { p_token: T(), p: { date: J.date, memo: J.memo.trim(), lines: L.map(l => ({ account: l.a, dr: +l.dr || 0, cr: +l.cr || 0 })) } }).then(r => toast(r.status === "approved" ? `اتسجّل القيد ${r.no}.` : `القيد ${r.no} مستني الاعتماد.`)), async () => { S.jv = null; closeModal(); S.gl.loaded = null; render(); }, "#jvErr"); }
  else if (k === "jvOk" || k === "jvNo") wrap(() => rpc("gl_manual_decide", { p_token: T(), p_id: a.dataset.id, p_ok: k === "jvOk" }), async () => { S.gl.loaded = null; render(); });
  else if (k === "coaAdd") { const par = glAcc(G, a.dataset.c); modal(`<h2>حساب فرعي تحت «${esc(par.name)}»</h2><div class="stack" style="margin-top:10px"><div class="field"><label>اسم الحساب</label><input class="inp" id="coN"></div><div class="field"><label>الاسم بالإنجليزي <span class="dim">(اختياري)</span></label><input class="inp" id="coE" dir="ltr"></div><div id="coErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" data-act="coaSave" data-c="${par.code}">إضافة</button></div></div>`); }
  else if (k === "coaSave") wrap(() => rpc("gl_account_save", { p_token: T(), p_parent: a.dataset.c, p_name: $("#coN").value.trim(), p_name_en: $("#coE").value.trim() }).then(c => toast("اتضاف الحساب " + c)), async () => { closeModal(); S.gl.loaded = null; render(); }, "#coErr");
  else if (k === "perSet") { const c = a.dataset.c === "1"; if (!confirm(c ? `إقفال شهر ${a.dataset.m}؟ مش هينفع يتسجّل عليه قيد يدوي بعد كده.` : `إعادة فتح شهر ${a.dataset.m}؟`)) return; wrap(() => rpc("gl_period_set", { p_token: T(), p_month: a.dataset.m, p_close: c }), async () => { S.gl.loaded = null; render(); }); }
  else if (k === "yearClose") { const y = +a.dataset.y; if (!confirm(`إقفال سنة ${y}؟\nصافي الربح هيترحّل للأرباح المحتجزة والـ ١٢ شهر هيتقفلوا. الخطوة دي مش بترجع.`)) return; wrap(() => rpc("gl_year_close", { p_token: T(), p_year: y }).then(r => toast(`اتقفلت السنة · صافي الربح ${fmt(r.net_profit, 1)}`)), async () => { S.gl.loaded = null; render(); }); }
  else if (k === "stLockSave") { const v = Math.round(+$("#stLock").value);
    if (!(v >= 0 && v <= 240)) return ($("#stLockMsg").innerHTML = `<div class="warnbox">اكتب رقم من 0 لـ 240.</div>`);
    if (v === 0 && !confirm("صفر يعني الأجهزة مش هتتقفل لوحدها أبدًا، وأي حد يقدر يستخدم جهاز سايبه موظف مفتوح. متأكد؟")) return;
    busy(a, true); rpc("store_autolock_save", { p_token: T(), p_min: v }).then(async () => { await loadCore(); toast(v ? `القفل التلقائي بعد ${v} دقيقة.` : "القفل التلقائي اتقفل."); render(); }).catch(e => { busy(a, false); toast(errText(e), true); }); }
  else if (k === "stLogoDel") { if (!confirm("تشيل الشعار؟")) return; busy(a, true); rpc("store_logo_save", { p_token: T(), p_logo: null }).then(async () => { await loadCore(); toast("اتشال الشعار."); render(); }).catch(e => { busy(a, false); toast(errText(e), true); }); }
  else if (k === "stSave") { const p = { name: $("#stN").value.trim(), day_close_time: $("#stC").value, day_open_time: $("#stO").value, price_alert_pct: +$("#stP").value || 10, min_margin_pct: +$("#stM").value || 0, vat_registered: $("#stV").checked };
    if (p.vat_registered) Object.assign(p, { vat_rin: $("#stR").value.trim(), vat_from: $("#stF").value, vat_rate: +$("#stRt").value, prices_include_vat: $("#stI").value === "1" });
    if (p.vat_registered && !S.store.vat_registered && !confirm("تشغيل ضريبة القيمة المضافة من " + p.vat_from + "؟\nكل الفواتير من التاريخ ده هتتحسب عليها الضريبة.")) return;
    wrap(() => rpc("store_save", { p_token: T(), p }), async () => { await loadCore(); toast("اتحفظت الإعدادات."); render(); }, "#stErr"); }
  else if (k === "vxAdd") { const id = $("#vxI").value; if (!id) return; wrap(() => rpc("item_vat_set", { p_token: T(), p_item: id, p_rate: +$("#vxR").value || 0 }), async () => { await loadItems(); render(); }); }
  else if (k === "vxDel") wrap(() => rpc("item_vat_set", { p_token: T(), p_item: a.dataset.id, p_rate: null }), async () => { await loadItems(); render(); });
  else if (k === "comTab") { comSync(); S.com.tab = a.dataset.k; render(); }
  else if (k === "crAdd") { comSync(); S.com.cfg.rules.push({ scope: "dept", ref: String((S.depts[0] || {}).id || ""), rate: 1, valid_from: "", valid_to: "" }); render(); }
  else if (k === "crDel") { comSync(); S.com.cfg.rules.splice(+a.dataset.n, 1); render(); }
  else if (k === "ctAdd") { comSync(); S.com.cfg.tiers.push({ pct: 100, extra_rate: 0.5, bonus: 0 }); render(); }
  else if (k === "ctDel") { comSync(); S.com.cfg.tiers.splice(+a.dataset.n, 1); render(); }
  else if (k === "comSave") { comSync(); const F = S.com.cfg, sellers = (S.dir || []).filter(x => x.active && x.role_id === "seller");
    wrap(() => rpc("commission_config_save", { p_token: T(), p: { rules: F.rules.filter(r => r.ref), tiers: F.tiers.filter(t => t.pct > 0), targets: sellers.filter(x => F.targets[x.id] != null).map(x => ({ staff_id: x.id, month: S.com.month, target: F.targets[x.id] })) } }), async () => { toast("اتحفظت قواعد العمولة."); S.com.loaded = null; S.com.tab = "rep"; render(); }, "#cmErr"); }
  else if (k === "comXls") { const C = S.com; xlsOut("عمولات-" + C.month, "العمولات", [["عمولات البائعين " + C.month], ["البائع", "صافي المبيعات", "التارجت", "التحقيق %", "عمولة الأصناف", "شريحة %", "زيادة الشريحة", "المكافأة", "الإجمالي"], ...C.rep.map(x => [x.name, +x.net, x.target != null ? +x.target : "", x.attain != null ? +x.attain : "", +x.base, x.tier_pct != null ? +x.tier_pct : "", +x.extra, +x.bonus, +x.total])], [24, 14, 12, 10, 14, 10, 14, 12, 14]); }
  else if (k === "ofTab") { S.ofs.tab = a.dataset.k; render(); }
  else if (k === "ofNew") ofModal(null);
  else if (k === "ofEdit") ofModal(S.ofs.list.find(o => o.id === +a.dataset.id));
  else if (k === "ofCopy") ofModal(S.ofs.list.find(o => o.id === +a.dataset.id), true);
  else if (k === "ofScope") { S._ofSync(); S.of.scope = a.dataset.k; S.of.refs = []; ofDraw(); }
  else if (k === "ofRef") { S._ofSync(); const r = a.dataset.k, i = S.of.refs.indexOf(r); if (i >= 0) S.of.refs.splice(i, 1); else S.of.refs.push(r); ofDraw(); }
  else if (k === "ofSave") { S._ofSync(); const x = S.of, p = { ...x, confirm: a.dataset.c === "1" }; delete p.status; delete p.created_by; delete p.created_at; delete p.updated_at;
    if (p.kind !== "gift") p.gift_item = null; if (!["bxgy", "gift", "nth"].includes(p.kind)) { p.buy_qty = null; p.get_qty = null; } if (p.scope !== "invoice") p.min_total = null; if (!p.locs.length) p.locs = null; if (!p.days.length) p.days = null; if (!p.hour_from || !p.hour_to) { p.hour_from = null; p.hour_to = null; }
    busy(a, true);
    try { const r = await rpc("offer_save", { p_token: T(), p }); if (!r.ok) { ofDraw(r.check); return true; } closeModal(); toast("اتحفظ العرض."); S.ofs = null; render(); }
    catch (e) { $("#ofErr").innerHTML = `<div class="warnbox">${esc(errText(e))}</div>`; busy(a, false); } }
  else if (k === "ofSt") { const s = a.dataset.s; if (s === "ended" && !confirm("إنهاء العرض؟ هيفضل في السجل بس مش هيرجع يشتغل.")) return; wrap(() => rpc("offer_set_status", { p_token: T(), p_id: +a.dataset.id, p_status: s }), async () => { S.ofs = null; render(); }); }
  else return window.MZX ? window.MZX(k, a) : false;
  return true;
}

/* =====================================================================
   EVENTS
   ===================================================================== */
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go); return; }
  const a = e.target.closest("[data-act]"); if (!a) return; const k = a.dataset.act;
  if (k === "menu") $("#side").classList.toggle("open");
  else if (k === "lock") lockNow();
  else if (k === "me") changePin(false);
  else if (k === "theme") { const cur = document.documentElement.dataset.theme === "light" ? "dark" : "light"; document.documentElement.dataset.theme = cur; ls("minzo-theme", cur); }
  else if (k === "itemNew") itemModal(null);
  else if (k === "itemEdit") itemModal(S.items.find(i => i.id === a.dataset.id));
  else if (k === "impDry") impRun(false, a);
  else if (k === "impGo") impRun(true, a);
  else if (k === "impTpl") { const H0 = IFIELDS.map(f => f[1]); const ws = XLSX.utils.aoa_to_sheet([H0, ["طقم حلل جرانيت ١٠ قطع", "", "", "أدوات منزلية", "حلل وأواني", "طقم", 4200, 2850, 10, 3, "لا", 0, ""], ["غسالة ٧ كيلو", "", "", "أجهزة كهربائية", "غسالات", "جهاز", 21900, 15800, 2, 1, "نعم", 24, "SN-001, SN-002"]]); ws["!views"] = [{ RTL: true }]; ws["!cols"] = H0.map(() => ({ wch: 18 })); const wb = XLSX.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] }; XLSX.utils.book_append_sheet(wb, ws, "الأصناف"); XLSX.writeFile(wb, "قالب-استيراد-الأصناف.xlsx"); }
  else if (k === "staffNew") staffModal(null);
  else if (k === "pendLink") { const p = (S.mailAcc.pending || []).find(x => x.auth_user_id === a.dataset.id), free = S.staffList.filter(u => !u.email && u.active);
    modal(`<h2>ربط حساب إيميل بموظف</h2><p class="muted" dir="ltr" style="text-align:right">${esc(p.email)} — «${esc(p.name)}»</p><div class="stack"><div class="field"><label>الموظف</label><select class="inp" id="plStaff">${free.map(u => `<option value="${u.id}">${esc(u.name)} — ${esc((S.roles.find(r => r.id === u.role_id) || {}).name || u.role_id)}</option>`).join("")}</select></div>
      <p class="dim" style="font-size:12.5px;margin:0">بعد الربط بيدخل بالإيميل من أي جهاز، وبعدين برمز الموظف ده. صلاحياته هي صلاحيات دور الموظف.</p><div id="plErr"></div><div class="row" style="justify-content:flex-end;gap:8px"><button class="btn ghost" data-act="mClose">إلغاء</button><button class="btn gold" id="plGo" ${free.length ? "" : "disabled"}>ربط وتفعيل</button></div></div>`);
    $("#plGo").onclick = async e => { busy(e.target, true); try { await rpc("staff_link", { p_token: T(), p_staff: $("#plStaff").value, p_auth: p.auth_user_id }); closeModal(); toast("اتربط واتفعّل."); S.staffList = null; render(); } catch (er) { $("#plErr").innerHTML = `<div class="warnbox">${esc(errText(er))}</div>`; busy(e.target, false); } }; }
  else if (k === "pendDrop") { if (!confirm("تحذف طلب الحساب ده؟")) return; busy(a, true); adminFn({ action: "drop_pending", auth_user_id: a.dataset.id }).then(() => { toast("اتحذف."); S.staffList = null; render(); }).catch(e => { busy(a, false); toast(errText(e), true); }); }
  else if (k === "staffEdit") staffModal(S.staffList.find(u => u.id === a.dataset.id));
  else if (k === "devEdit") devModal(S.devList.find(d => d.id === a.dataset.id));
  else opsClick(k, a);
});
window.MZ = { LOGO, logoImg, S, V, H, P, NAME, SUB, NAV, allowed, sb, $, esc, fmt, num, norm, ls, rpc, q, T, can, has, role, seeCost, locName, ico, toast, modal, closeModal, busy, header, render, go, loadItems, loadCore, loadDir, who, today, xlsOut, errText, myLoc, r2, UNITS, PAYN, returnModal, stockOf, ownStock, kitBuild, codesOf, byCode, srch, rcptLines, posDone };
{ const t = ls("minzo-theme"); if (t) document.documentElement.dataset.theme = t; }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
