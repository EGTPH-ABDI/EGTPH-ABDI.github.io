// EGTPH — نسخة احتياطية يومية مشفّرة لقواعد بيانات البرامج (تعمل على GitHub Actions)
// • المكان 1: Firebase egtph-apps/_backup (أيام آخر 30 يوماً؛ لا يُخزَّن برنامج من جديد إلا إذا تغيّر)
// • المكان 2: ملفات مشفّرة في GitHub (artifact يُحذف وحده بعد 30 يوماً) — يكتبها هذا السكريبت في ./out
// التشفير: AES-256-GCM بمفتاح مشتق (PBKDF2) من كلمة سر حساب Claude (في السر EGTPH_PUSH) — لا قراءة دونها.
// لا يكتب هذا السكريبت أبداً في بيانات البرامج: قراءة فقط منها.
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";

const S = JSON.parse(process.env.EGTPH_PUSH || "{}");
if (!S.password) { console.log("لا يوجد السر EGTPH_PUSH"); process.exit(0); }
const TEST = process.env.BACKUP_TEST_BASE || ""; // للاختبار على Firebase وهمي فقط
const rdb = (p) => TEST ? `${TEST}/${p}` : `https://${p}-default-rtdb.europe-west1.firebasedatabase.app`;
const APPS = [
  { id: "gestion", key: "AIzaSyBqMfhLqRm-GWR4HgPkLH-erCFg8EsrLcA", db: rdb("egtph-abdi-youssouf-islam"), paths: ["egtph_gp_v13_EGTPH-Chlef-2026-x7Kq94RvTzM3pWd8"] },
  { id: "facture", key: "AIzaSyBqMfhLqRm-GWR4HgPkLH-erCFg8EsrLcA", db: rdb("egtph-abdi-youssouf-islam"), paths: ["EGTPH-FACT-xB9U6PtjCLYVz8d0NdNTELtq"] },
  { id: "caution", key: "AIzaSyDBUQZn_jiHWQrbiQrdZDIne2OlhdrhS7E", db: rdb("egtph-reception"), paths: ["egtph"] },
  { id: "commande", key: "AIzaSyA471hWJkoUr3__sWGwFB0DeNOSvoDcPKk", db: rdb("egtph-commande"), paths: ["egtph"] },
  { id: "rh", key: "AIzaSyA7xH8pwmEjzIM98lE6C-GmK-cSrAvs9gc", db: rdb("egtph-rh"), paths: ["egtph-rh"] },
  { id: "lapayeparmois", key: "AIzaSyD6Up-mmyDwqhr0UMBmV3aI5Xv-TjvoMDA", db: rdb("egtph-pay"), paths: ["egtph"] },
  { id: "semaine", key: "AIzaSyAnRqmYvW3g9b7ysQJQ9stVsdoEVgKFcxM", db: rdb("egtph-semaine"), paths: ["egtph"] },
  { id: "parc_document", key: "AIzaSyBf7NU7QPvS824duUE78uaXZuCzGdX6Grg", db: rdb("egtph-parc"), paths: ["egtph"] },
  { id: "service", key: "AIzaSyA5fS3IgHJdrZIR3rJ97OJJvDQdT0XlKf4", db: rdb("egtph-service"), paths: ["egtph"] },
  { id: "apps", key: "AIzaSyC-jLXkEWlwjQpeg1Yk4TMraXeWYOe6PBA", db: rdb("egtph-apps"), paths: ["egtph-apps/apps_v1_GCLD9MRi4O6r2pYcyw5K6DR2tqb4tsH5WvmjvUdz", "egtph-apps/_push"] }
];
const HOME = APPS.find((a) => a.id === "apps"); // مكان النسخ: egtph-apps
const BK = "egtph-apps/_backup";
const KEEP_DAYS = 30, PART = 4 * 1024 * 1024;
const KEY = crypto.pbkdf2Sync(S.password, "egtph-backup-v1", 200000, 32, "sha256");

function enc(buf) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", KEY, iv); const ct = Buffer.concat([c.update(buf), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]); }
async function login(key) {
  const r = await fetch(`${TEST || "https://identitytoolkit.googleapis.com"}/v1/accounts:signInWithPassword?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: S.email, password: S.password, returnSecureToken: true }) });
  const j = await r.json(); if (!j.idToken) throw new Error("login " + JSON.stringify(j.error || j).slice(0, 120)); return j.idToken;
}
async function req(db, tok, path, method = "GET", body, query = "") {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${db}/${path}.json?auth=${tok}${query}${method === "GET" ? "" : "&print=silent"}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!r.ok) throw new Error(method + " " + path + " → " + r.status);
      return method === "GET" ? await r.text() : null;
    } catch (e) { if (i === 2) throw e; await new Promise((ok) => setTimeout(ok, 3000)); }
  }
}

const dz = new Date(Date.now() + 3600 * 1000), today = dz.toISOString().slice(0, 10);
const homeTok = await login(HOME.key);
const day = {}, report = [];
fs.mkdirSync("out", { recursive: true });

for (const a of APPS) {
  try {
    const tok = a.id === "apps" ? homeTok : await login(a.key);
    const parts = {};
    for (const p of a.paths) parts[p] = JSON.parse((await req(a.db, tok, p)) || "null");
    const raw = Buffer.from(JSON.stringify({ app: a.id, db: a.db, at: Date.now(), data: parts }));
    if (raw.length < 40) throw new Error("فارغة");
    const sha = crypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 20);
    const blob = enc(zlib.gzipSync(raw, { level: 9 }));
    fs.writeFileSync(`out/${today}_${a.id}.egtph.bin`, blob); // للنسخة الثانية في GitHub
    const id = `${a.id}_${sha}`;
    const has = await req(HOME.db, homeTok, `${BK}/blobs/${id}/meta`, "GET", undefined, "&shallow=true");
    if (!has || has === "null") {
      const b64 = blob.toString("base64"), n = Math.ceil(b64.length / PART);
      for (let i = 0; i < n; i++) await req(HOME.db, homeTok, `${BK}/blobs/${id}/parts/${i}`, "PUT", b64.slice(i * PART, (i + 1) * PART));
      await req(HOME.db, homeTok, `${BK}/blobs/${id}/meta`, "PUT", { app: a.id, sha, raw: raw.length, enc: blob.length, parts: n, at: Date.now(), first: today });
      report.push(`${a.id}: جديد ${(raw.length / 1024).toFixed(0)}K`);
    } else report.push(`${a.id}: لم يتغيّر`);
    day[a.id] = id;
  } catch (e) { report.push(`${a.id}: خطأ ${e.message}`); }
}
if (!Object.keys(day).length) { console.error("لم تُؤخذ أي نسخة"); process.exit(1); }
await req(HOME.db, homeTok, `${BK}/days/${today}`, "PUT", { ...day, at: Date.now() });

// الإبقاء على آخر 30 يوماً، وحذف ما لم يعد مستعملاً
const days = JSON.parse((await req(HOME.db, homeTok, `${BK}/days`)) || "{}");
const limit = new Date(dz.getTime() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
for (const d of Object.keys(days)) if (d < limit) { await req(HOME.db, homeTok, `${BK}/days/${d}`, "DELETE"); delete days[d]; }
const used = new Set(); Object.values(days).forEach((m) => Object.entries(m).forEach(([k, v]) => { if (k !== "at") used.add(v); }));
const blobs = JSON.parse((await req(HOME.db, homeTok, `${BK}/blobs`, "GET", undefined, "&shallow=true")) || "{}");
for (const b of Object.keys(blobs)) if (!used.has(b)) await req(HOME.db, homeTok, `${BK}/blobs/${b}`, "DELETE");

console.log("نسخة " + today + "\n" + report.join("\n") + "\nأيام محفوظة: " + Object.keys(days).length);
if (report.some((x) => x.includes("خطأ"))) process.exitCode = 1;
