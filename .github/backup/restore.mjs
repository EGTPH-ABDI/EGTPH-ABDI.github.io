// فك نسخة احتياطية EGTPH إلى ملف JSON محلي (لا يكتب في Firebase).
// الاستعمال: EGTPH_PASSWORD=… node restore.mjs <ملف .bin أو base64>  > نسخة.json
// الاسترجاع في Firebase يتم يدوياً بعد مراجعة المحتوى ومقارنته بالبيانات الحالية.
import crypto from "node:crypto";
import zlib from "node:zlib";
import fs from "node:fs";
const pw = process.env.EGTPH_PASSWORD; if (!pw) { console.error("EGTPH_PASSWORD مطلوب"); process.exit(1); }
const KEY = crypto.pbkdf2Sync(pw, "egtph-backup-v1", 200000, 32, "sha256");
let buf = fs.readFileSync(process.argv[2]); if (!/\.bin$/.test(process.argv[2])) buf = Buffer.from(buf.toString().trim(), "base64");
const d = crypto.createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28));
process.stdout.write(zlib.gunzipSync(Buffer.concat([d.update(buf.subarray(28)), d.final()])));
