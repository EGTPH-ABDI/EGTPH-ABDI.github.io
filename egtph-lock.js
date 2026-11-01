// ════════════════════════════════════════════════════════════
// egtph-lock.js — قفل سريع مشترك لكل برامج EGTPH (Face ID)
// ════════════════════════════════════════════════════════════
// يُضاف في <head> كل برنامج:   <script src="../egtph-lock.js"></script>
//
// - الإعداد يتم مرة واحدة من لوحة التحكم (⋮ ← الدخول السريع: PIN و Face ID)،
//   ويعمل في كل البرامج على نفس الهاتف لأنها على نفس الموقع.
// - لا يُرسل شيء للخادم: رمز PIN محفوظ مشفّراً (PBKDF2) على الجهاز فقط،
//   و Face ID عبر WebAuthn (مفتاح خاص لا يغادر الهاتف).
// - إن لم يُفعَّل أي قفل على الجهاز، لا يفعل هذا الملف شيئاً.
// - فتح القفل مرة واحدة يكفي لكل البرامج في نفس النافذة، ويعود القفل
//   بعد 5 دقائق في الخلفية. 5 أخطاء في PIN تمسح جلسات البرامج فيُطلب كلمة السر.
(function (global) {
  "use strict";
  var LOCK_KEY = "egtph_apps_lock_v1", SESSION_KEY = "egtph_apps_unlocked", IDLE_MS = 5 * 60 * 1000;
  var hiddenAt = 0, shown = false;

  // PIN أُلغي بطلب المسير: Face ID فقط (يُمسح أي PIN قديم محفوظ)
  function cfg() { try { var c = JSON.parse(localStorage.getItem(LOCK_KEY)) || {}; if (c.pin) { delete c.pin; try { localStorage.setItem(LOCK_KEY, JSON.stringify(c)); } catch (e) {} } return c; } catch (e) { return {}; } }
  function save(c) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(c)); } catch (e) {} }
  function enabled() { var c = cfg(); return !!(c.pin || c.face); }
  function unlocked() { try { return sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; } }
  function fr() { try { return (localStorage.getItem("egtph_lang") || document.documentElement.lang || "ar").indexOf("fr") === 0; } catch (e) { return false; } }
  function t(ar, f) { return fr() ? f : ar; }
  function b64(buf) { var a = new Uint8Array(buf), s = ""; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64(s) { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var r = atob(s), a = new Uint8Array(r.length); for (var i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; }
  function pinHash(pin, salt) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"])
      .then(function (k) { return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: 210000 }, k, 256); })
      .then(b64);
  }

  function css() {
    if (document.getElementById("egtphLockCss")) return;
    var s = document.createElement("style"); s.id = "egtphLockCss";
    s.textContent =
      "#egtphLock{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;" +
      "background:radial-gradient(circle at 20% 10%,rgba(61,140,255,.16),transparent 28%),radial-gradient(circle at 85% 20%,rgba(244,170,33,.18),transparent 28%),#050b14;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl}" +
      "#egtphLock .c{width:min(360px,100%);padding:28px 22px;border:1px solid rgba(255,255,255,.14);border-radius:22px;background:linear-gradient(150deg,#10223b,#091323);box-shadow:0 30px 90px rgba(0,0,0,.6);text-align:center;color:#eef3fa}" +
      "#egtphLock h2{font-size:18px;margin:6px 0 4px}#egtphLock p{font-size:13px;color:#9fb0c6;margin:0 0 16px}" +
      "#egtphLock input{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:#050d18;color:#fff;text-align:center;font-size:24px;letter-spacing:.5em;direction:ltr}" +
      "#egtphLock input::placeholder{letter-spacing:.05em;font-size:14px}#egtphLock input:focus{outline:none;border-color:#f4aa21}" +
      "#egtphLock button{width:100%;padding:13px;margin-top:10px;border:0;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer}" +
      "#egtphLock .face{background:linear-gradient(135deg,#f4aa21,#c37309);color:#211300}" +
      "#egtphLock .alt{background:transparent;color:#f6c25d;font-weight:700;font-size:13px}" +
      "#egtphLock .m{min-height:20px;color:#ff8a78;font-size:13px;margin-top:10px}" +
      "#egtphLock svg{width:64px;height:64px}";
    (document.head || document.documentElement).appendChild(s);
  }

  function hide() { var el = document.getElementById("egtphLock"); if (el) el.remove(); shown = false; }
  function ok() { try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {} var c = cfg(); c.fails = 0; save(c); hide(); }
  function useGmail() {
    // تُمسح جلسات البرامج المحفوظة فيُطلب كلمة السر عند إعادة التحميل.
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf("egtph_auth_") === 0) localStorage.removeItem(k); }); } catch (e) {}
    hide(); location.reload();
  }
  function msg(x) { var m = document.getElementById("egtphLockMsg"); if (m) m.textContent = x; }
  function fail(text) {
    var c = cfg(); c.fails = (c.fails || 0) + 1; save(c);
    if (c.fails >= 5) { c.fails = 0; save(c); useGmail(); return; }
    msg(text + " (" + (5 - c.fails) + " " + t("محاولات متبقية", "essais restants") + ")");
  }
  function tryPin(v) {
    var c = cfg(); if (!c.pin || v.length !== (c.pin.len || 6)) return;
    pinHash(v, unb64(c.pin.salt)).then(function (h) {
      if (h === c.pin.hash) ok();
      else { var i = document.getElementById("egtphLockPin"); if (i) i.value = ""; fail(t("رمز PIN غير صحيح", "Code PIN incorrect")); }
    });
  }
  function tryFace() {
    var c = cfg(); if (!c.face || !navigator.credentials) return;
    navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: unb64(c.face.id), transports: ["internal"] }],
      userVerification: "required", timeout: 60000 } })
      .then(function (cred) { if (cred && b64(cred.rawId) === c.face.id) ok(); else fail(t("لم يتم التحقق", "Non vérifié")); })
      .catch(function () { msg(c.pin ? t("لم يكتمل Face ID — أعد المحاولة أو استعمل PIN.", "Face ID non abouti — réessayez ou utilisez le PIN.") : t("لم يكتمل Face ID — أعد المحاولة أو ادخل بكلمة السر.", "Face ID non abouti — réessayez ou utilisez le mot de passe.")); });
  }

  function show() {
    if (shown || !document.body) return;
    shown = true; css();
    var c = cfg(), el = document.createElement("div");
    el.id = "egtphLock";
    el.innerHTML = '<div class="c">' +
      '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 4L90 18v34c0 22-18 38-40 44C28 90 10 74 10 52V18Z" fill="#111f35" stroke="#f4aa21" stroke-width="3"/><text x="50" y="58" text-anchor="middle" font-family="Georgia,serif" font-size="31" font-weight="700" fill="#f4aa21">EG</text></svg>' +
      "<h2>" + t("البرنامج مقفل", "Application verrouillée") + "</h2>" +
      "<p>" + (c.face && c.pin ? t("استعمل Face ID أو رمز PIN", "Utilisez Face ID ou le code PIN") : c.face ? t("استعمل Face ID", "Utilisez Face ID") : t("أدخل رمز PIN", "Saisissez le code PIN")) + "</p>" +
      (c.face ? '<button type="button" class="face" id="egtphLockFace">🙂 ' + t("فتح بـ Face ID", "Déverrouiller avec Face ID") + "</button>" : "") +
      (c.pin ? '<input id="egtphLockPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="9" autocomplete="off" placeholder="••••••" aria-label="PIN" style="margin-top:' + (c.face ? "12px" : "0") + '">' : "") +
      '<div class="m" id="egtphLockMsg"></div>' +
      '<button type="button" class="alt" id="egtphLockAlt">' + t("الدخول بكلمة السر بدلاً من ذلك", "Se connecter avec le mot de passe") + "</button>" +
      "</div>";
    document.body.appendChild(el);
    var pin = document.getElementById("egtphLockPin");
    if (pin) {
      pin.addEventListener("input", function () { var L = (cfg().pin || {}).len || 6; this.value = this.value.replace(/\D/g, "").slice(0, 9); if (this.value.length === L) tryPin(this.value); });
      if (!c.face) setTimeout(function () { pin.focus(); }, 60);
    }
    var f = document.getElementById("egtphLockFace"); if (f) f.onclick = tryFace;
    document.getElementById("egtphLockAlt").onclick = useGmail;
  }

  function check() { if (enabled() && !unlocked()) show(); }
  function relock() { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} check(); }

  // لوحة التحكم لها قفلها الخاص (apps.html): هذا الملف للبرامج فقط.
  if (/\/apps(?:-diagnostic)?\.html$/.test(location.pathname)) return;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check); else check();
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > IDLE_MS) relock();
    hiddenAt = 0;
  });
  // قفل فُتح في لوحة التحكم أو في برنامج آخر بنفس النافذة يُغلق هنا أيضاً.
  global.addEventListener("storage", function (e) { if (e.key === LOCK_KEY && !enabled()) hide(); });

  global.EGTPHLock = { check: check, relock: relock, enabled: enabled };
})(window);
