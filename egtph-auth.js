// ════════════════════════════════════════════════════════════
// egtph-auth.js — مساعد تسجيل الدخول المشترك لكل برامج EGTPH
// ════════════════════════════════════════════════════════════
// يُستعمل من كل برنامج بإضافة هذا السطر في <head>:
//     <script src="../egtph-auth.js"></script>
//
// ⚠️ لا يخزّن هذا الملف أي كلمة سر. كلمة السر تُكتب مرة لكل جهاز،
// ثم يُحفظ "token" يتجدّد وحده — لمدة أقصاها 10 أيام، بعدها تُطلب
// كلمة السر من جديد (حتى لو بقي الجهاز "متذكَّراً").
//
// حسابان:
//   • المالك  (opts.email)      : قراءة + كتابة.
//   • حساب العرض فقط: قراءة وطباعة فقط. يُدخَل اسمه من «حساب آخر» في نافذة الدخول
//     (اسم من أرقام فقط يُكمَل بـ @gmail.com). لا يُكتب اسمه هنا عمداً.
//   الحماية الحقيقية في قواعد Firebase (حساب العرض مرفوض في الكتابة)؛
//   هنا فقط نُخفي أزرار الإدخال والتعديل ونمنع الإرسال.
//
//   EGTPHAuth.init({ appId, apiKey, email, onReady, onTokenChange })
//   EGTPHAuth.authParam(appId)  → "?auth=…"
//   EGTPHAuth.isViewer(appId)   → true لحساب العرض
//
(function (global) {
  "use strict";

  var MAX_SESSION_MS = 10 * 24 * 60 * 60 * 1000; // 10 أيام

  function storageKey(appId) { return "egtph_auth_" + appId; }

  function saveSession(appId, data, extra) {
    try {
      var prev = loadSession(appId) || {};
      extra = extra || {};
      localStorage.setItem(storageKey(appId), JSON.stringify({
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (parseInt(data.expiresIn || "3600", 10) * 1000) - 60000,
        uid: data.localId || data.uid || prev.uid || null,
        role: extra.role || prev.role || "owner",
        loginAt: extra.loginAt || prev.loginAt || Date.now()
      }));
    } catch (e) {}
  }
  function loadSession(appId) {
    try { return JSON.parse(localStorage.getItem(storageKey(appId))); } catch (e) { return null; }
  }
  function clearSession(appId) {
    try { localStorage.removeItem(storageKey(appId)); } catch (e) {}
  }
  // جلسة أقدم من 10 أيام → تُمسح ويُطلب كلمة السر
  function tooOld(sess) {
    if (!sess) return true;
    if (!sess.loginAt) return false; // جلسة قديمة بلا تاريخ: تُؤرَّخ عند أول تجديد
    return (Date.now() - Number(sess.loginAt)) > MAX_SESSION_MS;
  }

  function signIn(apiKey, email, password) {
    return fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password, returnSecureToken: true })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (e) { throw new Error((e.error && e.error.message) || "AUTH_FAILED"); });
      return r.json();
    });
  }

  function refreshToken(apiKey, refreshTok) {
    var body = "grant_type=refresh_token&refresh_token=" + encodeURIComponent(refreshTok);
    return fetch("https://securetoken.googleapis.com/v1/token?key=" + apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error("REFRESH_FAILED");
      return r.json();
    }).then(function (d) {
      return { idToken: d.id_token, refreshToken: d.refresh_token, expiresIn: d.expires_in, uid: d.user_id };
    });
  }

  // ─────────── واجهة الدخول ───────────
  function buildOverlay() {
    var existing = document.getElementById("egtphAuthOverlay");
    if (existing) return existing;
    var css = document.createElement("style");
    css.textContent =
      "#egtphAuthOverlay{position:fixed;inset:0;z-index:99999;background:rgba(10,10,12,.92);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif;direction:rtl}" +
      "#egtphAuthOverlay .eg-card{background:#1c1e24;border:1px solid #2c2f38;border-radius:14px;padding:26px 22px;" +
      "width:100%;max-width:290px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.5)}" +
      "#egtphAuthOverlay h2{color:#f0f0f0;font-size:15px;margin:0 0 4px}" +
      "#egtphAuthOverlay p{color:#9a9ea6;font-size:12px;margin:0 0 14px;line-height:1.6}" +
      "#egtphAuthOverlay input{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #333740;" +
      "background:#262932;color:#f0f0f0;font-size:15px;text-align:center;box-sizing:border-box}" +
      "#egtphAuthOverlay button{width:100%;margin-top:10px;padding:10px;border:0;border-radius:8px;" +
      "background:#ff7a1a;color:#1a0f06;font-weight:700;font-size:13px;cursor:pointer}" +
      "#egtphAuthOverlay .eg-err{color:#ff8a78;font-size:12px;margin-top:8px;min-height:1em}";
    document.head.appendChild(css);
    var wrap = document.createElement("div");
    wrap.id = "egtphAuthOverlay";
    wrap.innerHTML =
      '<div class="eg-card">' +
      "<h2>EGTPH — تسجيل الدخول</h2>" +
      "<p>اكتب كلمة السر للدخول.</p>" +
      '<form id="egtphAuthForm">' +
      '<input type="text" id="egtphAuthUser" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="الاسم" style="display:none;margin-bottom:8px">' +
      '<input type="password" id="egtphAuthPass" autocomplete="current-password" placeholder="كلمة السر" autofocus>' +
      '<button type="submit">دخول</button>' +
      "</form>" +
      '<div class="eg-err" id="egtphAuthErr"></div>' +
      '<a href="#" id="egtphAuthOther" style="display:inline-block;margin-top:10px;color:#9a9ea6;font-size:12px">حساب آخر</a>' +
      "</div>";
    document.body.appendChild(wrap);
    return wrap;
  }

  function errText(code) {
    code = String(code || "");
    if (code.indexOf("TOO_MANY_ATTEMPTS") >= 0) return "محاولات كثيرة — انتظر بضع دقائق ثم أعد.";
    if (code.indexOf("USER_DISABLED") >= 0) return "هذا الحساب موقوف.";
    if (code.indexOf("Failed to fetch") >= 0 || code.indexOf("NetworkError") >= 0) return "لا يوجد اتصال بالإنترنت.";
    return "كلمة السر غير صحيحة، أعد المحاولة.";
  }

  function promptLogin(opts) {
    return new Promise(function (resolve) {
      var overlay = buildOverlay();
      overlay.style.display = "flex";
      var form = document.getElementById("egtphAuthForm");
      var passInput = document.getElementById("egtphAuthPass");
      var errBox = document.getElementById("egtphAuthErr");
      passInput.focus();
      function done(d, role) {
        saveSession(opts.appId, d, { role: role, loginAt: Date.now() });
        form.removeEventListener("submit", onSubmit);
        overlay.style.display = "none";
        passInput.value = "";
        if (userInput) userInput.value = "";
        resolve(d.idToken);
      }
      var userInput = document.getElementById("egtphAuthUser");
      var other = document.getElementById("egtphAuthOther");
      if (other) other.onclick = function (ev) {
        ev.preventDefault();
        var showIt = userInput.style.display === "none";
        userInput.style.display = showIt ? "" : "none";
        other.textContent = showIt ? "حساب المالك" : "حساب آخر";
        if (!showIt) userInput.value = "";
        (showIt ? userInput : passInput).focus();
      };
      function onSubmit(e) {
        e.preventDefault();
        var pw = passInput.value;
        if (!pw) return;
        var name = String(userInput && userInput.value || "").trim();
        var email = name ? (/^\d+$/.test(name) ? name + "@gmail.com" : name) : opts.email;
        var role = (!name || email.toLowerCase() === String(opts.email).toLowerCase()) ? "owner" : "viewer";
        errBox.textContent = "...";
        signIn(opts.apiKey, email, pw).then(function (d) { done(d, role); })
          .catch(function (err) {
            errBox.textContent = errText(err && err.message);
            passInput.value = "";
            passInput.focus();
          });
      }
      form.addEventListener("submit", onSubmit);
    });
  }

  // ─────────── وضع العرض فقط ───────────
  var viewerOn = false, lastBlockToast = 0;
  var HIDE_RX = /(حفظ|احفظ|إضافة|اضافة|أضف|اضف|جديد|تعديل|عدّل|عدل|حذف|احذف|مسح|امسح|استيراد|استرجاع|استعادة|دمج|أرشفة|ارشفة|ترحيل|تسجيل دفعة|رفع|ajouter|nouveau|nouvelle|modifier|supprimer|enregistrer|importer|restaurer|effacer|archiver|valider|➕|✏️|✏|🗑|💾|📥)/i;
  var KEEP_RX = /(طباعة|اطبع|طبع|pdf|تصدير|excel|بحث|إغلاق|اغلاق|رجوع|عودة|عرض|معاينة|خروج|الدخول|imprimer|exporter|recherch|fermer|retour|aperçu|déconnexion|×|✕)/i;
  // تُخفى دائماً حتى لو ذكرت PDF (تغيّر البيانات أو تُدخل ملفات)
  var STRONG_RX = /(استيراد|إرفاق|ارفاق|استبدال|التقاط|ملء|املأ|اسحب|اختر ملف|اختيار ملف|مزامنة|تفعيل|تعطيل|إزالة|ازالة|importer|import |joindre|remplacer|prendre une photo|remplir|glissez|choisir un fichier|synchronis|réinitialiser|retirer|actif|inactif|📤|📎|📷|🔁)/i;
  var CLICKABLE = "button,[role=button],input[type=submit],input[type=button],a.btn,.btn,[onclick],label[for]";

  function toast(msg) {
    var now = Date.now();
    if (now - lastBlockToast < 4000) return;
    lastBlockToast = now;
    var d = document.createElement("div");
    d.textContent = msg;
    d.style.cssText = "position:fixed;left:50%;bottom:62px;transform:translateX(-50%);z-index:2147483001;background:#1c1e24;color:#fff;" +
      "padding:9px 14px;border-radius:10px;font:13px Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);direction:rtl";
    (document.body || document.documentElement).appendChild(d);
    setTimeout(function () { try { d.remove(); } catch (e) {} }, 2600);
  }

  function scanReadOnly(root) {
    if (!viewerOn || !root || !root.querySelectorAll) return;
    var list = root.querySelectorAll(CLICKABLE);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.closest && (el.closest("#egtphAuthOverlay") || el.closest("#egtphViewerBar") || el.closest("#egtphLock"))) continue;
      var txt = ((el.innerText || el.value || "") + " " + (el.title || "") + " " + (el.getAttribute("aria-label") || "")).trim();
      if (!txt) continue;
      if (STRONG_RX.test(txt) || (HIDE_RX.test(txt) && !KEEP_RX.test(txt))) el.classList.add("egtph-ro-hide");
    }
    var files = root.querySelectorAll("input[type=file]");
    for (var j = 0; j < files.length; j++) files[j].disabled = true;
    var ed = root.querySelectorAll("[contenteditable=true],[contenteditable='']");
    for (var k = 0; k < ed.length; k++) ed[k].setAttribute("contenteditable", "false");
  }

  function isDbUrl(u) { return /(firebasedatabase\.app|firebaseio\.com)/i.test(String(u || "")); }

  var viewerExit = null;
  function enableViewerMode(onExit) {
    if (typeof onExit === "function") viewerExit = onExit;
    if (viewerOn) return;
    viewerOn = true;
    var de = document.documentElement;
    de.classList.add("egtph-viewer");
    var st = document.createElement("style");
    st.textContent = ".egtph-ro-hide{display:none!important}" +
      "#egtphViewerBar{position:fixed;left:0;right:0;bottom:0;z-index:2147482999;display:flex;gap:10px;align-items:center;justify-content:center;" +
      "padding:7px 12px calc(7px + env(safe-area-inset-bottom));background:#111;color:#fff;font:13px Arial,sans-serif;direction:rtl;border-top:2px solid #fff}" +
      "#egtphViewerBar button{background:#fff;color:#111;border:0;border-radius:6px;padding:4px 10px;font-weight:700;cursor:pointer}" +
      "@media print{#egtphViewerBar{display:none!important}}";
    (document.head || de).appendChild(st);

    // منع أي كتابة إلى القاعدة (القواعد ترفضها أصلاً — هذا لتفادي رسائل الخطأ)
    var nativeFetch = global.fetch;
    if (nativeFetch && !nativeFetch.__egtphRO) {
      var roFetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url);
        var method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
        if (isDbUrl(url) && method !== "GET") {
          toast("👁️ حساب العرض فقط — لا يمكن الحفظ");
          return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
        }
        return nativeFetch.apply(this, arguments);
      };
      roFetch.__egtphRO = true;
      global.fetch = roFetch;
    }
    if (global.XMLHttpRequest && !global.XMLHttpRequest.prototype.__egtphRO) {
      var xo = global.XMLHttpRequest.prototype.open, xs = global.XMLHttpRequest.prototype.send;
      global.XMLHttpRequest.prototype.open = function (m, u) { this.__egtphBlock = isDbUrl(u) && String(m).toUpperCase() !== "GET"; return xo.apply(this, arguments); };
      global.XMLHttpRequest.prototype.send = function () { if (this.__egtphBlock) { toast("👁️ حساب العرض فقط — لا يمكن الحفظ"); return; } return xs.apply(this, arguments); };
      global.XMLHttpRequest.prototype.__egtphRO = true;
    }

    function boot() {
      if (!document.getElementById("egtphViewerBar")) {
        var bar = document.createElement("div");
        bar.id = "egtphViewerBar";
        bar.innerHTML = "<span>👁️ وضع العرض والطباعة فقط</span><button type=\"button\" id=\"egtphViewerOut\">خروج</button>";
        document.body.appendChild(bar);
        document.body.style.paddingBottom = "44px";
        document.getElementById("egtphViewerOut").onclick = function () {
          Object.keys(sessions).forEach(function (id) { logout(id); });
          Promise.resolve(viewerExit ? viewerExit() : null).then(function () { location.reload(); }, function () { location.reload(); });
        };
      }
      scanReadOnly(document.body);
      try {
        new MutationObserver(function (muts) {
          for (var i = 0; i < muts.length; i++) {
            var n = muts[i].target;
            scanReadOnly(n && n.nodeType === 1 ? n : document.body);
          }
        }).observe(document.body, { childList: true, subtree: true });
      } catch (e) {}
    }
    if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
  }

  // ─────────── الحالة الداخلية لكل برنامج ───────────
  var sessions = {}, lastOpts = {}, pendingRefresh = {};

  function adoptSession(appId, opts, token) {
    var prev = sessions[appId];
    if (prev && prev.refreshTimer) clearTimeout(prev.refreshTimer);
    sessions[appId] = { token: token, opts: opts };
    var sess = loadSession(appId);
    if (sess && sess.role === "viewer") enableViewerMode();
    scheduleRefresh(appId);
    return token;
  }

  function scheduleRefresh(appId) {
    var s = sessions[appId];
    if (!s) return;
    if (s.refreshTimer) clearTimeout(s.refreshTimer);
    var sess = loadSession(appId);
    if (!sess) return;
    var delay = Math.max(5000, sess.expiresAt - Date.now() - 5000);
    s.refreshTimer = setTimeout(function () {
      var cur = loadSession(appId);
      if (!cur || !cur.refreshToken) return;
      if (tooOld(cur)) { clearSession(appId); ensureLogin(appId, s.opts); return; }
      refreshToken(s.opts.apiKey, cur.refreshToken).then(function (d) {
        saveSession(appId, d);
        s.token = d.idToken;
        if (s.opts.onTokenChange) try { s.opts.onTokenChange(d.idToken); } catch (e) {}
        scheduleRefresh(appId);
      }).catch(function () {
        clearSession(appId);
        ensureLogin(appId, s.opts);
      });
    }, delay);
  }

  // قاعدة كل برنامج — للتحقق من صلاحية حساب العرض (القواعد في Firebase هي الحماية الحقيقية)
  var DB_OF = {
    gestion: "https://egtph-abdi-youssouf-islam-default-rtdb.europe-west1.firebasedatabase.app",
    facture: "https://egtph-abdi-youssouf-islam-default-rtdb.europe-west1.firebasedatabase.app",
    caution: "https://egtph-reception-default-rtdb.europe-west1.firebasedatabase.app",
    commande: "https://egtph-commande-default-rtdb.europe-west1.firebasedatabase.app",
    lapayeparmois: "https://egtph-pay-default-rtdb.europe-west1.firebasedatabase.app",
    semaine: "https://egtph-semaine-default-rtdb.europe-west1.firebasedatabase.app",
    parc_document: "https://egtph-parc-default-rtdb.europe-west1.firebasedatabase.app",
    service: "https://egtph-service-default-rtdb.europe-west1.firebasedatabase.app"
  };
  function showNoAccess(appId) {
    var w = document.getElementById("egtphNoAccess");
    if (w) return;
    w = document.createElement("div");
    w.id = "egtphNoAccess";
    w.style.cssText = "position:fixed;inset:0;z-index:2147483002;background:#0d0f14;color:#f0f0f0;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:14px;padding:24px;text-align:center;font:15px Arial,sans-serif;direction:rtl";
    w.innerHTML = "<div style=\"font-size:42px\">🔒</div><div><b>لا تملك صلاحية الدخول إلى هذا البرنامج</b><br>" +
      "<span style=\"color:#9a9ea6;font-size:13px\">يمنحها المسير من لوحة التحكم.</span></div>" +
      "<button type=\"button\" style=\"background:#fff;color:#111;border:0;border-radius:8px;padding:9px 18px;font-weight:700\">خروج</button>";
    (document.body || document.documentElement).appendChild(w);
    w.querySelector("button").onclick = function () { logout(appId); location.reload(); };
  }
  function viewerAllowed(appId, token) {
    var base = DB_OF[appId];
    if (!base) return Promise.resolve(true);
    return fetch(base + "/_viewer/" + appId + ".json?auth=" + encodeURIComponent(token), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : false; })
      .then(function (v) { return v === true; }, function () { return true; }); // بلا إنترنت: القواعد تمنع على أي حال
  }
  function ready(appId, opts, token) {
    adoptSession(appId, opts, token);
    if (isViewer(appId)) {
      viewerAllowed(appId, token).then(function (ok) {
        if (!ok) { showNoAccess(appId); return; }
        if (opts.onReady) opts.onReady(token);
      });
      return token;
    }
    if (opts.onReady) opts.onReady(token);
    return token;
  }

  function ensureLogin(appId, opts) {
    lastOpts[appId] = opts;
    var sess = loadSession(appId);
    if (sess && tooOld(sess)) { clearSession(appId); sess = null; }
    if (sess && sess.idToken && Date.now() < sess.expiresAt) {
      return Promise.resolve(ready(appId, opts, sess.idToken));
    }
    if (sess && sess.refreshToken) {
      return refreshToken(opts.apiKey, sess.refreshToken).then(function (d) {
        saveSession(appId, d);
        return ready(appId, opts, d.idToken);
      }).catch(function () {
        clearSession(appId);
        return promptLogin(opts).then(function (token) { return ready(appId, opts, token); });
      });
    }
    return promptLogin(opts).then(function (token) { return ready(appId, opts, token); });
  }

  function init(opts) {
    if (!opts || !opts.appId || !opts.apiKey || !opts.email) {
      console.error("EGTPHAuth.init: appId, apiKey و email مطلوبون");
      return Promise.reject(new Error("EGTPHAuth.init: config"));
    }
    return ensureLogin(opts.appId, opts);
  }

  function getToken(appId) { var s = sessions[appId]; return s ? s.token : null; }

  function sessionValid(appId, skewMs) {
    var sess = loadSession(appId);
    if (!sess || !sess.idToken || tooOld(sess)) return null;
    if (!(Date.now() < (Number(sess.expiresAt) || 0) - (skewMs || 0))) return null;
    return sess;
  }
  function optsFor(appId) { var s = sessions[appId]; return (s && s.opts) || lastOpts[appId] || null; }

  function forceRefresh(appId) {
    var opts = optsFor(appId);
    if (!opts) return Promise.reject(new Error("لم تُهيّأ المصادقة بعد"));
    if (pendingRefresh[appId]) return pendingRefresh[appId];
    var cur = loadSession(appId), p;
    function adopt(tk) {
      adoptSession(appId, opts, tk);
      if (opts.onTokenChange) try { opts.onTokenChange(tk); } catch (e) {}
      return tk;
    }
    if (cur && cur.refreshToken && !tooOld(cur)) {
      p = refreshToken(opts.apiKey, cur.refreshToken).then(function (d) { saveSession(appId, d); return adopt(d.idToken); })
        .catch(function () { clearSession(appId); return promptLogin(opts).then(adopt); });
    } else {
      clearSession(appId);
      p = promptLogin(opts).then(adopt);
    }
    p = p.then(function (v) { pendingRefresh[appId] = null; return v; }, function (e) { pendingRefresh[appId] = null; throw e; });
    pendingRefresh[appId] = p;
    return p;
  }

  function getFreshToken(appId) {
    var opts = optsFor(appId);
    if (!opts) return Promise.reject(new Error("لم تُهيّأ المصادقة بعد"));
    if (pendingRefresh[appId]) return pendingRefresh[appId];
    var ok = sessionValid(appId, 120000);
    if (ok) {
      var s = sessions[appId];
      if (s) {
        if (s.token !== ok.idToken) { s.token = ok.idToken; if (opts.onTokenChange) try { opts.onTokenChange(ok.idToken); } catch (e) {} }
      } else adoptSession(appId, opts, ok.idToken);
      return Promise.resolve(ok.idToken);
    }
    return forceRefresh(appId);
  }

  function wakeCheck() {
    Object.keys(sessions).forEach(function (appId) {
      if (!optsFor(appId)) return;
      if (!sessionValid(appId, 120000)) forceRefresh(appId).catch(function () {});
      else scheduleRefresh(appId);
    });
  }
  try {
    document.addEventListener("visibilitychange", function () { if (!document.hidden) wakeCheck(); }, false);
    global.addEventListener("focus", wakeCheck, false);
    global.addEventListener("online", wakeCheck, false);
    global.addEventListener("pageshow", wakeCheck, false);
  } catch (e) {}

  function authParam(appId) { var t = getToken(appId); return t ? ("?auth=" + t) : ""; }

  function logout(appId) {
    var s = sessions[appId];
    if (s && s.refreshTimer) clearTimeout(s.refreshTimer);
    clearSession(appId);
    delete sessions[appId];
  }

  function isViewer(appId) {
    var sess = loadSession(appId);
    return !!(sess && sess.role === "viewer");
  }

  global.EGTPHAuth = {
    init: init,
    getToken: getToken,
    getFreshToken: getFreshToken,
    forceRefresh: forceRefresh,
    tokenExpiresAt: function (appId) { var sess = loadSession(appId); return sess ? Number(sess.expiresAt) || 0 : 0; },
    authParam: authParam,
    logout: logout,
    isViewer: isViewer,
    enableViewerMode: enableViewerMode
  };
})(window);
