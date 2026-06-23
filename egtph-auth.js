// ════════════════════════════════════════════════════════════
// egtph-auth.js — مساعد تسجيل الدخول المشترك لكل برامج EGTPH
// ════════════════════════════════════════════════════════════
// يُستعمل من كل برنامج بإضافة هذا السطر في <head>:
//     <script src="../egtph-auth.js"></script>
//
// ⚠️ لا يخزّن هذا الملف أي كلمة سر. كلمة السر تُكتب من المستخدم
// مرة واحدة لكل جهاز/متصفح، ثم يُحفظ "token" مؤقت يتجدّد وحده.
//
// كيفية الاستعمال داخل كل برنامج (مثال):
//   EGTPHAuth.init({
//     appId:   'gestion',                 // اسم مميز لهذا البرنامج (لتخزين الجلسة بدون تعارض)
//     apiKey:  'AIzaSy...',                // Web API Key لمشروع Firebase الخاص بهذا البرنامج
//     email:   'youcef@egtph.internal',    // الإيميل المسجَّل في Firebase Auth لهذا المشروع
//     onReady: function(token){ /* شُغّل المزامنة الآن أن التوكن جاهز */ },
//     onTokenChange: function(token){ /* يُستدعى عند كل تجديد للتوكن */ }
//   });
//
//   ثم عند بناء رابط القاعدة:
//     FB_BASE + '.json' + EGTPHAuth.authParam('gestion')
//
(function (global) {
  "use strict";

  function storageKey(appId) { return "egtph_auth_" + appId; }

  function saveSession(appId, data) {
    try {
      localStorage.setItem(storageKey(appId), JSON.stringify({
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt: Date.now() + (parseInt(data.expiresIn || "3600", 10) * 1000) - 60000,
        uid: data.localId || data.uid || null
      }));
    } catch (e) {}
  }
  function loadSession(appId) {
    try { return JSON.parse(localStorage.getItem(storageKey(appId))); } catch (e) { return null; }
  }
  function clearSession(appId) {
    try { localStorage.removeItem(storageKey(appId)); } catch (e) {}
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

  // ─────────── واجهة الدخول (نافذة صغيرة، بلا تبعيات) ───────────
  function buildOverlay(appId) {
    var existing = document.getElementById("egtphAuthOverlay");
    if (existing) return existing;
    var css = document.createElement("style");
    css.textContent =
      "#egtphAuthOverlay{position:fixed;inset:0;z-index:99999;background:rgba(10,10,12,.92);" +
      "display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif}" +
      "#egtphAuthOverlay .eg-card{background:#1c1e24;border:1px solid #2c2f38;border-radius:14px;padding:26px 22px;" +
      "width:100%;max-width:280px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.5)}" +
      "#egtphAuthOverlay h2{color:#f0f0f0;font-size:15px;margin-bottom:4px}" +
      "#egtphAuthOverlay p{color:#9a9ea6;font-size:12px;margin-bottom:14px}" +
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
      "<h2>EGTPH \u2014 \u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644</h2>" +
      "<p>\u0627\u0644\u0628\u0631\u0646\u0627\u0645\u062c \u0645\u062d\u0645\u064a \u0628\u0643\u0644\u0645\u0629 \u0633\u0631 \u2014 \u0627\u0643\u062a\u0628\u0647\u0627 \u0644\u0644\u062f\u062e\u0648\u0644</p>" +
      '<form id="egtphAuthForm">' +
      '<input type="password" id="egtphAuthPass" autocomplete="current-password" autofocus>' +
      '<button type="submit">\u062f\u062e\u0648\u0644</button>' +
      "</form>" +
      '<div class="eg-err" id="egtphAuthErr"></div>' +
      "</div>";
    document.body.appendChild(wrap);
    return wrap;
  }

  function promptLogin(opts) {
    return new Promise(function (resolve, reject) {
      var overlay = buildOverlay(opts.appId);
      overlay.style.display = "flex";
      var form = document.getElementById("egtphAuthForm");
      var passInput = document.getElementById("egtphAuthPass");
      var errBox = document.getElementById("egtphAuthErr");
      passInput.focus();
      function onSubmit(e) {
        e.preventDefault();
        var pw = passInput.value;
        errBox.textContent = "...";
        signIn(opts.apiKey, opts.email, pw).then(function (d) {
          saveSession(opts.appId, d);
          form.removeEventListener("submit", onSubmit);
          overlay.style.display = "none";
          passInput.value = "";
          resolve(d.idToken);
        }).catch(function () {
          errBox.textContent = "\u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0631 \u0627\u0644\u062a\u064a \u0643\u062a\u0628\u062a \u0639\u0644\u0627\u0647\u0627 \u0645\u0648\u062c\u0648\u062f\u0629\u060c \u0623\u0639\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629.";
          passInput.value = "";
          passInput.focus();
        });
      }
      form.addEventListener("submit", onSubmit);
    });
  }

  // ─────────── الحالة الداخلية لكل برنامج ───────────
  var sessions = {}; // appId -> { token, opts, refreshTimer }

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
      refreshToken(s.opts.apiKey, cur.refreshToken).then(function (d) {
        saveSession(appId, d);
        s.token = d.idToken;
        if (s.opts.onTokenChange) s.opts.onTokenChange(d.idToken);
        scheduleRefresh(appId);
      }).catch(function () {
        clearSession(appId);
        ensureLogin(appId, s.opts);
      });
    }, delay);
  }

  function ensureLogin(appId, opts) {
    var sess = loadSession(appId);
    if (sess && sess.idToken && Date.now() < sess.expiresAt) {
      sessions[appId] = { token: sess.idToken, opts: opts };
      scheduleRefresh(appId);
      if (opts.onReady) opts.onReady(sess.idToken);
      return Promise.resolve(sess.idToken);
    }
    if (sess && sess.refreshToken) {
      return refreshToken(opts.apiKey, sess.refreshToken).then(function (d) {
        saveSession(appId, d);
        sessions[appId] = { token: d.idToken, opts: opts };
        scheduleRefresh(appId);
        if (opts.onReady) opts.onReady(d.idToken);
        return d.idToken;
      }).catch(function () {
        clearSession(appId);
        return promptLogin(opts).then(function (token) {
          sessions[appId] = { token: token, opts: opts };
          scheduleRefresh(appId);
          if (opts.onReady) opts.onReady(token);
          return token;
        });
      });
    }
    return promptLogin(opts).then(function (token) {
      sessions[appId] = { token: token, opts: opts };
      scheduleRefresh(appId);
      if (opts.onReady) opts.onReady(token);
      return token;
    });
  }

  function init(opts) {
    if (!opts || !opts.appId || !opts.apiKey || !opts.email) {
      console.error("EGTPHAuth.init: appId, apiKey و email مطلوبون");
      return;
    }
    ensureLogin(opts.appId, opts);
  }

  function getToken(appId) {
    var s = sessions[appId];
    return s ? s.token : null;
  }

  function authParam(appId) {
    var t = getToken(appId);
    return t ? ("?auth=" + t) : "";
  }

  function logout(appId) {
    clearSession(appId);
    delete sessions[appId];
  }

  global.EGTPHAuth = {
    init: init,
    getToken: getToken,
    authParam: authParam,
    logout: logout
  };
})(window);
