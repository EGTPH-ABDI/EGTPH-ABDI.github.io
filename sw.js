// EGTPH — عمل دون إنترنت: الشبكة أولاً، ثم النسخة المحفوظة إن انقطع الاتصال.
// لا يحفظ بيانات Firebase (تبقى مزامنتها كما هي)، فقط ملفات البرامج والخطوط.
var CACHE = "egtph-v2";
var CORE = ["/apps.html", "/egtph-auth.js", "/egtph-lock.js", "/manifest.webmanifest", "/icons/icon-180.png"];
var EXTERNAL = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|www\.gstatic\.com\/firebasejs\/)/;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).catch(function () {}));
  self.skipWaiting();
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var u = new URL(r.url);
  var same = u.origin === self.location.origin;
  if (!same && !EXTERNAL.test(r.url)) return; // Firebase, Google login...: بدون تدخل
  // الصفحات: دائماً من الشبكة دون ذاكرة المتصفح، حتى تظهر آخر نسخة فوراً
  var req = r.mode === "navigate" ? new Request(r.url, { cache: "no-store", credentials: "same-origin" }) : r;
  e.respondWith(fetch(req).then(function (res) {
    if (res && (res.ok || res.type === "opaque")) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(r, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(r, { ignoreSearch: same }).then(function (m) {
      return m || (r.mode === "navigate" ? caches.match("/apps.html") : Response.error());
    });
  }));
});
