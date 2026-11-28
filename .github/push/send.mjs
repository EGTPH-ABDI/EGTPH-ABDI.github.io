// EGTPH — إشعارات الهاتف والتطبيق مغلق (يعمل على GitHub Actions)
// يقرأ التنبيهات من Firebase (egtph-apps) ويرسل:
//  • كل تنبيه عاجل جديد (أكثر من 3 دفعة واحدة = إشعار ملخص واحد)
//  • ملخص الصباح مرة في اليوم بعد الساعة 8 بتوقيت الجزائر
// السر EGTPH_PUSH (إعدادات المستودع ← Secrets) = {"email":"…","password":"…","vapidPrivate":"…"}
import webpush from "web-push";

const RAW = process.env.EGTPH_PUSH || "";
if (!RAW) { console.log("لا يوجد السر EGTPH_PUSH — لا شيء يُرسل."); process.exit(0); }
const S = JSON.parse(RAW);
const API_KEY = "AIzaSyC-jLXkEWlwjQpeg1Yk4TMraXeWYOe6PBA";
const DB = "https://egtph-apps-default-rtdb.europe-west1.firebasedatabase.app";
const ROOT = "egtph-apps/apps_v1_GCLD9MRi4O6r2pYcyw5K6DR2tqb4tsH5WvmjvUdz";
const VAPID_PUBLIC = "BPz92BKGAOt_SvNgJKN3ewa4ncLkVrM5kl9X5QVrQ7j-WRazoHk6zHY-_kE-MsjJ9B3gzDjUNRzX6JXpUWZchgw";
webpush.setVapidDetails("mailto:abdiyetph@gmail.com", VAPID_PUBLIC, S.vapidPrivate);

const login = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: S.email, password: S.password, returnSecureToken: true })
})).json();
if (!login.idToken) { console.error("فشل الدخول إلى Firebase"); process.exit(1); }
const auth = "auth=" + login.idToken;
const get = async (p) => (await fetch(`${DB}/${p}.json?${auth}`)).json();
const put = async (p, v) => fetch(`${DB}/${p}.json?${auth}`, { method: "PUT", body: JSON.stringify(v) });
const del = async (p) => fetch(`${DB}/${p}.json?${auth}`, { method: "DELETE" });

const subs = (await get("egtph-apps/_push")) || {};
const alerts = (await get(ROOT + "/alerts")) || {};
const state = (await get("egtph-apps/_push_state")) || {};

// ── ملف المؤسسة : تنبيهات انتهاء الصلاحية (وثائق الملف، تأمين ومراقبة العتاد المُدرج، انتساب العمال النشطين)
try { await dossierAlerts(); } catch (e) { console.log("تنبيهات الملف:", e.message); }
async function dossierAlerts() {
  const sign = async (key) => (await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: S.email, password: S.password, returnSecureToken: true }) })).json()).idToken;
  const P = { dossier: ["AIzaSyCE1nUWBtJGr-dv0PtN65pI8MtWQE12TrM", "https://egtph-dossier-default-rtdb.europe-west1.firebasedatabase.app"], parc: ["AIzaSyBf7NU7QPvS824duUE78uaXZuCzGdX6Grg", "https://egtph-parc-default-rtdb.europe-west1.firebasedatabase.app"], rh: ["AIzaSyA7xH8pwmEjzIM98lE6C-GmK-cSrAvs9gc", "https://egtph-rh-default-rtdb.europe-west1.firebasedatabase.app"] };
  const T = {}; for (const k of Object.keys(P)) T[k] = await sign(P[k][0]);
  const g = async (k, path) => (await fetch(`${P[k][1]}${path}.json?auth=${T[k]}`)).json();
  const dz0 = new Date(Date.now() + 3600 * 1000), today0 = dz0.toISOString().slice(0, 10), in30 = new Date(dz0.getTime() + 30 * 864e5).toISOString().slice(0, 10), in7 = new Date(dz0.getTime() + 7 * 864e5).toISOString().slice(0, 10);
  const items = [];
  const pieces = (await g("dossier", "/egtph/dossier/pieces")) || {}, ext = (await g("dossier", "/egtph/dossier/ext")) || {}, choices = (await g("dossier", "/egtph/dossier/choices")) || {};
  Object.values(pieces).forEach((p) => { if (p && !p.deleted && p.fin && !String(p.cat).startsWith("abe")) items.push({ k: p.id, name: p.ar || p.fr, fin: p.fin }); });
  Object.entries(ext).forEach(([k, v]) => { if (v && v.fin) items.push({ k: k.replace(/\W/g, "_"), name: k.includes("maj") ? "شهادة CNAS" : "شهادة CACOBATPH", fin: v.fin }); });
  const pd = (await g("parc", "/egtph/EGTPH-mat-2026-CnucIO2DZnBAHqMitxm1Y86k")) || {};
  (pd.equipment || []).filter((e) => e && e.veh && (choices.veh || {})[e.id]).forEach((e) => {
    if (e.assurance && e.assurance.fin) items.push({ k: "as_" + e.id, name: "تأمين " + (e.name || "") + " " + (e.matricule || ""), fin: e.assurance.fin });
    if (e.needsCT && e.ct && e.ct.fin) items.push({ k: "ct_" + e.id, name: "المراقبة التقنية " + (e.name || "") + " " + (e.matricule || ""), fin: e.ct.fin }); });
  const RB = "/egtph-rh/rh_v3_MBInR2bhdTMRnHOL1ts1g187pZhstcz1VwtcHtjz8", ws = (await g("rh", RB + "/records/workers")) || {};
  for (const v of Object.values(ws)) { const w = v && v.data; if (!w || w.deleted || w.st === "INACTIF") continue; const vu = await g("rh", RB + "/files/af_" + w.id + "/meta/validUntil"); if (vu) items.push({ k: "af_" + w.id, name: "انتساب " + (w.N || "") + " " + (w.P || ""), fin: vu }); }
  const want = {};
  items.filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.fin) && x.fin <= in30).forEach((x) => {
    const id = ("dos_" + x.k + "_" + x.fin).replace(/[.#$\[\]\/]/g, "_"), exp = x.fin < today0;
    want[id] = { source: "dossier", app: "dossier", severity: exp || x.fin <= in7 ? "critical" : "warning", title: (exp ? "منتهية: " : "تنتهي قريباً: ") + x.name, message: "ملف المؤسسة — " + (exp ? "انتهت في " : "تنتهي في ") + x.fin.split("-").reverse().join("/"), dueAt: x.fin, status: "open" }; });
  const nowMs = Date.now();
  for (const [id, a] of Object.entries(want)) { const cur = alerts[id]; if (!cur || cur.severity !== a.severity || cur.title !== a.title) { const v = Object.assign({ createdAt: (cur && cur.createdAt) || nowMs, updatedAt: nowMs, read: !!(cur && cur.read && cur.severity === a.severity) }, a); await put(ROOT + "/alerts/" + id, v); alerts[id] = v; } }
  for (const id of Object.keys(alerts)) if (id.startsWith("dos_") && !want[id]) { await del(ROOT + "/alerts/" + id); delete alerts[id]; }
  console.log("تنبيهات الملف:", Object.keys(want).length);
}
const sent = state.sent || {};
const ids = Object.keys(subs);
console.log("هواتف مسجلة:", ids.length, "— تنبيهات:", Object.keys(alerts).length);

// تاريخ الجزائر (UTC+1 دون توقيت صيفي)
const dz = new Date(Date.now() + 3600 * 1000);
const today = dz.toISOString().slice(0, 10);
const hour = dz.getUTCHours();

const live = Object.values(alerts).filter((a) => a && !a.read);
const crit = live.filter((a) => a.severity === "critical");
const fresh = crit.filter((a) => !sent[a.id]);
const msgs = [];

if (!state.seeded) {
  // أول تشغيل: التنبيهات الموجودة تُعتبر مُبلَّغة (لا سيل من الإشعارات)
  crit.forEach((a) => { sent[a.id] = Date.now(); });
  state.seeded = Date.now();
} else if (fresh.length) {
  if (fresh.length > 3) msgs.push({ title: `EGTPH — ${fresh.length} تنبيهات عاجلة جديدة`, body: fresh.slice(0, 3).map((a) => "• " + a.title).join("\n"), tag: "egtph-new", app: "" });
  else fresh.forEach((a) => msgs.push({ title: "EGTPH — " + (a.title || "تنبيه عاجل"), body: a.message || "", tag: a.id, app: a.app || "" }));
  fresh.forEach((a) => { sent[a.id] = Date.now(); });
}

if (hour >= 8 && state.lastMorning !== today) {
  const in3 = new Date(dz.getTime() + 3 * 864e5).toISOString().slice(0, 10);
  const soon = live.filter((a) => a.dueAt && a.dueAt >= today && a.dueAt <= in3);
  const lines = [];
  if (crit.length) lines.push(`🔴 ${crit.length} تنبيه عاجل غير مقروء`);
  if (soon.length) lines.push(`🟡 ${soon.length} أجل خلال 3 أيام`);
  soon.sort((x, y) => (x.dueAt > y.dueAt ? 1 : -1)).slice(0, 2).forEach((a) => lines.push("• " + a.title + " — " + a.dueAt.split("-").reverse().join("/")));
  if (lines.length) msgs.push({ title: "صباح الخير — ملخص EGTPH", body: lines.join("\n"), tag: "egtph-morning", app: "" });
  state.lastMorning = today;
}

// تنظيف سجل المرسَل: تنبيهات لم تعد موجودة
Object.keys(sent).forEach((k) => { if (!alerts[k]) delete sent[k]; });

let ok = 0;
for (const m of msgs) {
  for (const id of ids) {
    const s = subs[id];
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(m), { TTL: 12 * 3600 }); ok++; }
    catch (e) {
      console.log("فشل الإرسال لهاتف:", e.statusCode || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) { await del("egtph-apps/_push/" + id); delete subs[id]; }
    }
  }
}
state.sent = sent; state.lastRun = Date.now();
await put("egtph-apps/_push_state", state);
console.log("إشعارات:", msgs.length, "— إرسالات ناجحة:", ok);
