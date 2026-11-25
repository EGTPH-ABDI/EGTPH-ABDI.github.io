// EGTPH — عمل دون إنترنت وبشبكة ضعيفة.
// - الصفحات وملفات البرامج: الشبكة أولاً، لكن بمهلة قصيرة؛ إن تأخرت الشبكة تُعرض النسخة المحفوظة فوراً
//   (ثم تُحدَّث النسخة في الخلفية) — حتى لا تبقى الشاشة سوداء مع LTE ضعيف.
// - مكتبات Firebase والخطوط (ثابتة برقم إصدار): من النسخة المحفوظة مباشرة.
// - لا يحفظ بيانات Firebase (تبقى مزامنتها كما هي).
var CACHE = "egtph-v4";
var CORE = ["/apps.html", "/egtph-auth.js", "/egtph-lock.js", "/manifest.webmanifest", "/icons/icon-180.png"];
var EXTERNAL = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|www\.gstatic\.com\/firebasejs\/)/;
var NAV_WAIT = 3500, FILE_WAIT = 5000;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).catch(function () {}));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    // تُنقل النسخ المحفوظة من الإصدار السابق قبل حذفه، فلا يضيع العمل دون إنترنت
    var old = ks.filter(function (k) { return k !== CACHE; });
    return caches.open(CACHE).then(function (nc) {
      return Promise.all(old.map(function (k) {
        return caches.open(k).then(function (oc) {
          return oc.keys().then(function (reqs) {
            return Promise.all(reqs.map(function (q) {
              return nc.match(q).then(function (has) { return has || oc.match(q).then(function (r) { return r && nc.put(q, r); }); });
            }));
          });
        }).then(function () { return caches.delete(k); });
      }));
    });
  }).catch(function () {}).then(function () { return self.clients.claim(); }));
});

// Safari يرفض صفحة جاءت بعد تحويل (redirect) من الـ service worker: تُعاد كاستجابة نظيفة
function clean(res) {
  if (!res || !res.redirected) return Promise.resolve(res);
  return res.blob().then(function (b) { return new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }); });
}
function store(r, res) {
  if (res && (res.ok || res.type === "opaque")) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, copy); }).catch(function () {}); }
  return res;
}

self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url);
  var same = u.origin === self.location.origin;
  if (!same && !EXTERNAL.test(r.url)) return; // Firebase (البيانات)، دخول Google...: بدون تدخل

  // مكتبات ثابتة: المحفوظ أولاً
  if (!same) {
    e.respondWith(caches.match(r).then(function (m) {
      return m || fetch(r).then(function (res) { return store(r, res); });
    }));
    return;
  }

  var nav = r.mode === "navigate";
  // لوحة التحكم: فتح فوري من النسخة المحفوظة، ثم تُجلب النسخة الجديدة في الخلفية وتُبلَّغ الصفحة إن تغيّرت
  if (nav && (u.pathname === "/apps.html" || u.pathname === "/")) {
    var key = "/apps.html";
    e.respondWith(caches.match(key).then(function (m) {
      var oldText = m ? m.clone().text() : Promise.resolve(null); // تُقرأ قبل تسليم النسخة للصفحة
      var net = fetch(new Request(self.location.origin + key, { cache: "no-store", credentials: "same-origin" })).then(clean).then(function (res) {
        if (!res || !res.ok) return res;
        var a = res.clone();
        return Promise.all([a.text(), oldText]).then(function (x) {
          if (x[0] === x[1]) return res;
          return caches.open(CACHE).then(function (c) { return c.put(key, res.clone()); }).then(function () {
            if (m) setTimeout(function () { self.clients.matchAll({ type: "window" }).then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: "egtph-new-version", path: key }); }); }); }, 2000); // بعد جاهزية الصفحة
            return res;
          });
        });
      });
      if (m) { e.waitUntil(net.then(function () { return new Promise(function (ok) { setTimeout(ok, 2500); }); }).catch(function () {})); return m; }
      return net.catch(function () { return Response.error(); });
    }));
    return;
  }
  // الصفحات: من الشبكة دون ذاكرة المتصفح، حتى تظهر آخر نسخة
  var req = nav ? new Request(r.url, { cache: "no-store", credentials: "same-origin" }) : r;
  var net = fetch(req).then(clean).then(function (res) { return store(r, res); });
  var saved = function () {
    return caches.match(r, { ignoreSearch: true }).then(function (m) {
      return m || (nav ? caches.match("/apps.html") : null);
    });
  };
  e.waitUntil(net.catch(function () {}));
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function give(x) { if (!done && x) { done = true; resolve(x); } }
    // شبكة بطيئة: النسخة المحفوظة بعد المهلة
    var timer = setTimeout(function () { saved().then(give); }, nav ? NAV_WAIT : FILE_WAIT);
    net.then(function (res) { clearTimeout(timer); give(res); }).catch(function () {
      clearTimeout(timer);
      saved().then(function (m) { give(m || Response.error()); });
    });
    // لا نسخة محفوظة بعد المهلة: ننتظر الشبكة مهما طالت
  }));
});

// إشعارات الهاتف: الضغط على الإشعار يفتح اللوحة (أو البرنامج المعني)
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var app = e.notification.data && e.notification.data.app;
  var url = "/apps.html" + (app ? "#" + encodeURIComponent(app) : "");
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if (/\/apps\.html/.test(cs[i].url) && cs[i].focus) { return cs[i].focus(); } }
    return self.clients.openWindow ? self.clients.openWindow(url) : null;
  }));
});
// جاهز لإشعارات تُرسل من خادم مستقبلاً (Web Push)
self.addEventListener("push", function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "EGTPH", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.tag || "egtph", data: { app: d.app || "" } }));
});
