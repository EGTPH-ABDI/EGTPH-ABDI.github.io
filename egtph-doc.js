/* EGTPH - moteur de traitement des pieces (version script classique, generee depuis egtph-docengine.js ; caracteres non ASCII echappes). API : window.EGTPHDoc */
(function(){
"use strict";
if(window.EGTPHDoc)return;
/* EGTPH \u2014 moteur de traitement des pi\u00e8ces du \u00ab \u0645\u0644\u0641 \u0627\u0644\u0645\u0624\u0633\u0633\u0629 \u00bb (sans d\u00e9pendance, navigateur + Node).
   Toutes les fonctions travaillent sur une image en niveaux de gris : {w, h, d: Uint8Array}.
   M\u00e9thodes reprises (id\u00e9es, pas de code) de : pdftl/Stirling-PDF (pages blanches : taux d'encre + \u00e9cart-type),
   ScanTailor/unpaper (redressement, rognage, binarisation), Paperless-ngx (classement par r\u00e8gles + apprentissage). */

function toGray(rgba, w, h) {
  const d = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < d.length; i++, j += 4) d[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return { w, h, d };
}

function resize(g, nw) {
  const nh = Math.max(1, Math.round(g.h * nw / g.w)), d = new Uint8Array(nw * nh);
  const sx = g.w / nw, sy = g.h / nh;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {         // moyenne de zone (anti-cr\u00e9nelage)
    const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    let s = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += g.d[yy * g.w + xx]; n++; }
    d[y * nw + x] = s / n;
  }
  return { w: nw, h: nh, d };
}

function meanStd(g) {
  let s = 0, s2 = 0; const n = g.d.length;
  for (let i = 0; i < n; i++) { const v = g.d[i]; s += v; s2 += v * v; }
  const m = s / n; return { mean: m, std: Math.sqrt(Math.max(0, s2 / n - m * m)) };
}

/* 1) Page blanche : rendu basse r\u00e9solution (~250 px de large), taux d'encre + \u00e9cart-type. */
function blankInfo(g, { inkDelta = 30, maxInk = 0.003 } = {}) {
  // r\u00e9duction par MINIMUM (et non moyenne) : un trait fin ou p\u00e2le reste visible \u00e0 basse r\u00e9solution
  const nw = 250, nh = Math.max(1, Math.round(g.h * nw / g.w)), sx = g.w / nw, sy = g.h / nh, s = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    let m = 255; const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const v = g.d[yy * g.w + xx]; if (v < m) m = v; }
    s[y * nw + x] = m;
  }
  const sorted = Float64Array.from(s).sort(), bg = sorted[Math.floor(sorted.length * 0.6)];   // fond = niveau dominant
  let ink = 0; for (const v of s) if (v < bg - inkDelta) ink++;
  const inkRatio = ink / s.length;
  return { blank: inkRatio <= maxInk, inkRatio, background: bg };
}

/* 2) Qualit\u00e9 d'une copie : nettet\u00e9 (variance du Laplacien \u00e0 r\u00e9solution commune) + contraste + d\u00e9finition. */
function quality(g) {
  const s = resize(g, Math.min(1600, g.w)), w = s.w, h = s.h, d = s.d;
  let n = 0, sum = 0, sum2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = 4 * d[i] - d[i - 1] - d[i + 1] - d[i - w] - d[i + w];
    sum += l; sum2 += l * l; n++;
  }
  const lapVar = sum2 / n - (sum / n) ** 2;
  const { std } = meanStd(s);
  const pixels = g.w * g.h;
  // Score : la nettet\u00e9 domine ; contraste et d\u00e9finition d\u00e9partagent. \u00c9chelle logarithmique pour comparer des copies tr\u00e8s diff\u00e9rentes.
  const score = Math.log10(1 + lapVar) * 50 + Math.min(std, 80) * 0.5 + Math.min(Math.log10(pixels), 7) * 5;
  return { score: +score.toFixed(1), sharpness: Math.round(lapVar), contrast: +std.toFixed(1), pixels };
}
function bestCopy(list) {               // list: [{id, gray}] \u2192 classement du meilleur au moins bon
  return list.map(c => ({ id: c.id, ...quality(c.gray) })).sort((a, b) => b.score - a.score);
}

/* 3) Doublons : empreinte dHash 64 bits + distance de Hamming. */
function dHash(g) {
  const s = resizeTo(g, 9, 8); let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += s.d[y * 9 + x] > s.d[y * 9 + x + 1] ? '1' : '0';
  return bits;
}
function resizeTo(g, nw, nh) {
  const r = resize(g, nw); if (r.h === nh) return r;
  const d = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) { const sy = Math.min(r.h - 1, Math.floor(y * r.h / nh)); for (let x = 0; x < nw; x++) d[y * nw + x] = r.d[sy * nw + x]; }
  return { w: nw, h: nh, d };
}
const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const isDuplicate = (a, b, max = 6) => hamming(dHash(a), dHash(b)) <= max;

/* 4) Binarisation de Sauvola (images int\u00e9grales) : fond blanc, texte noir, pour imprimante N&B. */
function sauvola(g, { win = 25, k = 0.2, R = 128 } = {}) {
  const { w, h, d } = g, W = w + 1, I = new Float64Array(W * (h + 1)), I2 = new Float64Array(W * (h + 1));
  for (let y = 1; y <= h; y++) { let r = 0, r2 = 0; for (let x = 1; x <= w; x++) {
    const v = d[(y - 1) * w + x - 1]; r += v; r2 += v * v; I[y * W + x] = I[(y - 1) * W + x] + r; I2[y * W + x] = I2[(y - 1) * W + x] + r2; } }
  const out = new Uint8Array(w * h), hw = win >> 1;
  for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - hw), y1 = Math.min(h, y + hw + 1);
    for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - hw), x1 = Math.min(w, x + hw + 1), n = (x1 - x0) * (y1 - y0);
      const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      const s2 = I2[y1 * W + x1] - I2[y0 * W + x1] - I2[y1 * W + x0] + I2[y0 * W + x0];
      const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m));
      out[y * w + x] = d[y * w + x] > m * (1 + k * (sd / R - 1)) ? 255 : 0; } }
  return { w, h, d: out };
}

/* 5) Angle d'inclinaison (profil de projection, \u00b1maxDeg) : l'angle qui rend les lignes de texte les plus nettes. */
function skewAngle(g, o) { return skewInfo(g, o).angle; }
/* angle + gain de confiance (score \u00e0 l'angle trouv\u00e9 \u00f7 score \u00e0 0\u00b0) : on ne redresse que si gain \u2265 1,15 */
function skewInfo(g, { maxDeg = 6, step = 0.25 } = {}) {
  const s = resize(g, 800), { mean } = meanStd(s), pts = [];
  // toutes les lignes (un pas de 2 en y cr\u00e9e des cases vides altern\u00e9es qui faussent le score \u00e0 0\u00b0)
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x += 2) if (s.d[y * s.w + x] < mean - 50) pts.push(x, y);
  let best = 0, bestV = -1, v0 = 1;
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += step) {
    const t = Math.tan(a * Math.PI / 180), bins = new Float64Array(s.h * 2);
    for (let i = 0; i < pts.length; i += 2) { const r = Math.round(pts[i + 1] - pts[i] * t) + s.h; if (r >= 0 && r < bins.length) bins[r]++; }
    let v = 0; for (let i = 1; i < bins.length; i++) { const dd = bins[i] - bins[i - 1]; v += dd * dd; }
    if (Math.abs(a) < 1e-9) v0 = Math.max(1, v);
    if (v > bestV) { bestV = v; best = a; }
  }
  return { angle: +best.toFixed(2), gain: +(bestV / v0).toFixed(2), points: pts.length / 2 };   // degr\u00e9s : pour redresser, tourner l'image de +angle dans le sens anti-horaire (convention canvas : rotate(-angle))
}

/* 6) Recadrage d'une pi\u00e8ce pos\u00e9e sur un fond (carte d'assurance sur une table) : bo\u00eete englobante de la zone claire. */
function cardBox(g, { minFrac = 0.6 } = {}) {
  const s = resize(g, 500), f = g.w / s.w, { mean } = meanStd(s);
  const thr = mean;                                   // carte (claire) vs fond (sombre)
  const rows = [], cols = new Array(s.w).fill(0);
  for (let y = 0; y < s.h; y++) { let c = 0; for (let x = 0; x < s.w; x++) if (s.d[y * s.w + x] > thr) { c++; cols[x]++; } rows.push(c); }
  const rmax = Math.max(...rows), cmax = Math.max(...cols);
  const first = (a, m) => a.findIndex(v => v >= m * minFrac), last = (a, m) => a.length - 1 - [...a].reverse().findIndex(v => v >= m * minFrac);
  const box = { x: first(cols, cmax), y: first(rows, rmax), x2: last(cols, cmax), y2: last(rows, rmax) };
  return { x: Math.round(box.x * f), y: Math.round(box.y * f), w: Math.round((box.x2 - box.x + 1) * f), h: Math.round((box.y2 - box.y + 1) * f) };
}

/* 7) Plan d'impression recto verso : chaque pi\u00e8ce commence sur une nouvelle feuille ;
   une pi\u00e8ce \u00ab recto seul \u00bb re\u00e7oit un verso blanc ; une pi\u00e8ce recto verso occupe les deux faces.
   items: [{id, pages, duplex}] \u2192 s\u00e9quence de pages (null = page blanche ajout\u00e9e), nombre de feuilles. */
function duplexPlan(items) {
  const seq = [];
  for (const it of items) {
    if (seq.length % 2) seq.push(null);               // la pi\u00e8ce pr\u00e9c\u00e9dente a laiss\u00e9 un verso libre \u2192 blanc
    for (let p = 0; p < it.pages; p++) {
      seq.push({ id: it.id, page: p + 1 });
      if (!it.duplex) seq.push(null);                 // recto seul : verso blanc
    }
  }
  if (seq.length % 2) seq.push(null);
  while (seq.length && seq[seq.length - 1] === null && seq[seq.length - 2] === null) seq.splice(-2, 2);
  return { seq, faces: seq.length, sheets: Math.ceil(seq.length / 2), blanks: seq.filter(x => x === null).length };
}
/* Impression manuelle sur imprimante sans recto verso : passe 1 = rectos, passe 2 = versos (ordre invers\u00e9 si la pile se retourne). */
function manualDuplexPasses(seq, reverseBacks = true) {
  const fronts = [], backs = [];
  seq.forEach((p, i) => (i % 2 ? backs : fronts).push(i));
  return { pass1: fronts, pass2: reverseBacks ? backs.reverse() : backs };
}

/* 8) Classement d'une pi\u00e8ce par son texte (r\u00e8gles type Paperless-ngx) ; les corrections de l'utilisateur ajoutent des mots-cl\u00e9s. */
const DOC_RULES = [
  { type: 'cnas', any: ['cnas', '\u0627\u0644\u0635\u0646\u062f\u0648\u0642 \u0627\u0644\u0648\u0637\u0646\u064a \u0644\u0644\u062a\u0623\u0645\u064a\u0646\u0627\u062a \u0627\u0644\u0627\u062c\u062a\u0645\u0627\u0639\u064a\u0629', 'mise \u00e0 jour', 'attestation de mise a jour'] },
  { type: 'casnos', any: ['casnos', 'non salari\u00e9s', '\u063a\u064a\u0631 \u0627\u0644\u0623\u062c\u0631\u0627\u0621'] },
  { type: 'cacobatph', any: ['cacobatph', 'cong\u00e9s pay\u00e9s', '\u0627\u0644\u0639\u0637\u0644 \u0627\u0644\u0645\u062f\u0641\u0648\u0639\u0629'] },
  { type: 'extrait_role', any: ['extrait de r\u00f4le', 'extrait de role', '\u0645\u0633\u062a\u062e\u0631\u062c \u0645\u0646 \u0627\u0644\u062c\u062f\u0627\u0648\u0644', '\u0645\u0633\u062a\u062e\u0631\u062c \u0627\u0644\u062c\u062f\u0648\u0644'] },
  { type: 'qualification', any: ['qualification et de classification', '\u0627\u0644\u062a\u0623\u0647\u064a\u0644 \u0648\u0627\u0644\u062a\u0635\u0646\u064a\u0641', '\u0627\u0644\u062a\u0623\u0647\u064a\u0644 \u0648 \u0627\u0644\u062a\u0635\u0646\u064a\u0641'] },
  { type: 'registre_commerce', any: ['registre de commerce', '\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u062a\u062c\u0627\u0631\u064a', 'cnrc'] },
  { type: 'nif', any: ["num\u00e9ro d'identification fiscale", 'nif', '\u0631\u0642\u0645 \u0627\u0644\u062a\u0639\u0631\u064a\u0641 \u0627\u0644\u062c\u0628\u0627\u0626\u064a'] },
  { type: 'nis', any: ["num\u00e9ro d'identification statistique", 'nis', '\u0631\u0642\u0645 \u0627\u0644\u062a\u0639\u0631\u064a\u0641 \u0627\u0644\u0625\u062d\u0635\u0627\u0626\u064a'] },
  { type: 'carte_grise', any: ['carte grise', "certificat d'immatriculation", '\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u062a\u0631\u0642\u064a\u0645', '\u0627\u0644\u0628\u0637\u0627\u0642\u0629 \u0627\u0644\u0631\u0645\u0627\u062f\u064a\u0629'] },
  { type: 'assurance', any: ['attestation d\'assurance', 'police', 'assurance', '\u062a\u0623\u0645\u064a\u0646'] },
  { type: 'controle_technique', any: ['contr\u00f4le technique', 'controle technique', '\u0627\u0644\u0645\u0631\u0627\u0642\u0628\u0629 \u0627\u0644\u062a\u0642\u0646\u064a\u0629'] },
  { type: 'bilan', any: ['bilan', 'compte de r\u00e9sultat', 'tcr', '\u0627\u0644\u0645\u064a\u0632\u0627\u0646\u064a\u0629'] },
  { type: 'bonne_execution', any: ['bonne ex\u00e9cution', 'bonne execution', '\u062d\u0633\u0646 \u0627\u0644\u062a\u0646\u0641\u064a\u0630', '\u062d\u0633\u0646 \u0627\u0644\u0625\u0646\u062c\u0627\u0632'] },
  { type: 'rib', any: ['relev\u00e9 d\'identit\u00e9 bancaire', 'rib', '\u0643\u0634\u0641 \u0627\u0644\u0647\u0648\u064a\u0629 \u0627\u0644\u0628\u0646\u0643\u064a\u0629'] },
  { type: 'affiliation', any: ['affiliation', '\u0627\u0646\u062a\u0633\u0627\u0628'] },
  { type: 'diplome', any: ['dipl\u00f4me', 'diplome', '\u0634\u0647\u0627\u062f\u0629 \u0644\u064a\u0633\u0627\u0646\u0633', '\u0645\u0627\u0633\u062a\u0631', 'master', 'licence'] },
  { type: 'attestation_travail', any: ['attestation de travail', '\u0634\u0647\u0627\u062f\u0629 \u0639\u0645\u0644'] },
];
const norm = s => s.toLowerCase().normalize('NFKD').replace(/[\u064b-\u0652\u0640]/g, '').replace(/[\u0623\u0625\u0622]/g, '\u0627').replace(/\u0649/g, '\u064a').replace(/\u0629/g, '\u0647');
function classify(text, rules = DOC_RULES) {
  const t = norm(text), scores = rules.map(r => {
    let s = 0; for (const k of r.any) { const kk = norm(k); if (kk.length <= 4 ? new RegExp(`(^|[^a-z])${kk}([^a-z]|$)`).test(t) : t.includes(kk)) s += kk.length > 6 ? 3 : 1; }
    return { type: r.type, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scores.length) return { type: null, sure: false, candidates: [] };
  const sure = scores.length === 1 || scores[0].s >= scores[1].s * 2;
  return { type: scores[0].type, sure, candidates: scores.slice(0, 3) };
}
function learn(rules, type, keyword) {          // correction de l'utilisateur \u2192 nouveau mot-cl\u00e9
  const r = rules.find(x => x.type === type); if (r && !r.any.includes(keyword)) r.any.push(keyword); return rules;
}

/* 9) Dates : toutes les dates d'un texte (jj/mm/aaaa, aaaa/mm/jj, avec - ou .), tri\u00e9es. */
function datesIn(text) {
  const t = text.replace(/[\u0660-\u0669]/g, c => '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(c)), out = new Set();
  for (const m of t.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/g)) out.add(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  for (const m of t.matchAll(/\b(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\b/g)) out.add(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  return [...out].filter(s => { const [y, mo, d] = s.split('-').map(Number); return y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31; }).sort();
}

/* 4 bis) Blanchiment \u00ab gris propre \u00bb (recommand\u00e9 pour l'impression : garde cachets, signatures et traits fins) :
   fond estim\u00e9 par maximum local \u00e0 basse r\u00e9solution, division (supprime ombres et fond color\u00e9), puis \u00e9tirement du contraste. */
function whiten(g, { block = 24, lowPct = 0.02 } = {}) {
  const { w, h, d } = g, bw = Math.ceil(w / block), bh = Math.ceil(h / block), bg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let m = 0; for (let y = by * block; y < Math.min(h, (by + 1) * block); y++) for (let x = bx * block; x < Math.min(w, (bx + 1) * block); x++) { const v = d[y * w + x]; if (v > m) m = v; }
    bg[by * bw + bx] = m;
  }
  const sm = new Float32Array(bw * bh);                // lissage 3\u00d73 du fond
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { let s = 0, n = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const yy = y + j, xx = x + i; if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += bg[yy * bw + xx]; n++; } }
    sm[y * bw + x] = s / n; }
  const out = new Uint8Array(w * h), tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(bw - 1.001, Math.max(0, x / block - 0.5)), fy = Math.min(bh - 1.001, Math.max(0, y / block - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const b = sm[y0 * bw + x0] * (1 - ax) * (1 - ay) + sm[y0 * bw + x0 + 1] * ax * (1 - ay) + sm[(y0 + 1) * bw + x0] * (1 - ax) * ay + sm[(y0 + 1) * bw + x0 + 1] * ax * ay;
    tmp[y * w + x] = Math.min(1, d[y * w + x] / Math.max(1, b));
  }
  const sorted = Float32Array.from(tmp).sort(), lo = sorted[Math.floor(sorted.length * lowPct)];
  for (let i = 0; i < tmp.length; i++) { let v = (tmp[i] - lo) / (0.92 - lo); v = Math.max(0, Math.min(1, v)); out[i] = Math.round(255 * Math.pow(v, 1.4)); }
  return { w, h, d: out };
}

/* 11) Pi\u00e8ce coup\u00e9e au bord : de l'encre qui touche le bord de l'image = texte probablement coup\u00e9 \u00e0 la prise de vue.
   Retourne les bords suspects (haut/bas/gauche/droite) pour demander une nouvelle photo AVANT d'enregistrer. */
function edgeCut(g, { band = 0.012, minInk = 0.04 } = {}) {
  const s = resize(g, 1000), { w, h, d } = s, sorted = Float64Array.from(d).sort(), bg = sorted[Math.floor(d.length * 0.6)];
  const ink = (x0, y0, x1, y1) => { let n = 0, t = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t++; if (d[y * w + x] < bg - 60) n++; } return n / t; };
  const bh = Math.max(3, Math.round(h * band)), bw = Math.max(3, Math.round(w * band));
  const r = { haut: ink(0, 0, w, bh), bas: ink(0, h - bh, w, h), droite: ink(w - bw, 0, w, h), gauche: ink(0, 0, bw, h) };
  return { cut: Object.keys(r).filter(k => r[k] >= minInk), ink: r };
}

window.EGTPHDoc={toGray,resize,blankInfo,quality,bestCopy,dHash,hamming,isDuplicate,sauvola,skewAngle,skewInfo,cardBox,duplexPlan,manualDuplexPasses,DOC_RULES,classify,learn,datesIn,whiten,edgeCut};
})();
