# EGTPH — traitement « qualité maximale » des pièces (GitHub Actions)
# Outils : OCRmyPDF (Tesseract ara+fra, unpaper --clean-final, redressement, PDF/A via Ghostscript, pngquant), Ghostscript (PDF gris d'impression),
#          page-dewarp (aplatit une page photographiée courbée), qpdf, poppler (pdftoppm / pdftotext).
#
# Protocole, identique pour chaque programme (dans SA propre base Firebase) :
#   <root>/_docpro/queue/<id> = { src: "<chemin de la valeur dans la base>", ops: ["clean","ocr","gray","dewarp"], app, t }
#     la valeur à src est une data-URL (image/jpeg, image/png, application/pdf) ou un objet { d|data|url: data-URL }
#   → <root>/_docpro/files/<id> = { img: data-URL JPEG couleur nettoyée, pdf: data-URL PDF/A cherchable, gray: data-URL PDF gris d'impression }
#   → <root>/_docpro/done/<id>  = { src, ok, text (texte lu, 20 000 car. max), report, t }   puis la tâche est retirée de queue
# Sécurité : AUCUNE écriture hors de <root>/_docpro/ ; la pièce d'origine (src) n'est jamais modifiée — c'est le programme qui décide de l'échange.
import base64, json, os, re, shutil, subprocess, sys, tempfile, time, urllib.request, urllib.error

S = json.loads(os.environ.get("EGTPH_PUSH") or "{}")
DB = lambda p: f"https://{p}-default-rtdb.europe-west1.firebasedatabase.app"
APPS = [  # programmes branchés (racine autorisée pour le compte Claude dans chaque base)
    {"id": "dossier", "key": "AIzaSyCE1nUWBtJGr-dv0PtN65pI8MtWQE12TrM", "db": DB("egtph-dossier"), "root": "egtph"},
    {"id": "parc_document", "key": "AIzaSyBf7NU7QPvS824duUE78uaXZuCzGdX6Grg", "db": DB("egtph-parc"), "root": "egtph"},
    {"id": "rh", "key": "AIzaSyA7xH8pwmEjzIM98lE6C-GmK-cSrAvs9gc", "db": DB("egtph-rh"), "root": "egtph-rh"},
]
MAX_OUT = 9 * 1024 * 1024          # une valeur Realtime Database doit rester < 10 Mo
MAX_JOBS = int(os.environ.get("DOCPRO_MAX_JOBS", "25"))

def run(cmd, timeout=300):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr)[-600:]

def data_url_to_file(v, folder):
    if isinstance(v, dict):
        v = v.get("d") or v.get("data") or v.get("url") or v.get("img") or ""
    m = re.match(r"^data:([\w/+.-]+);base64,(.*)$", v or "", re.S)
    if not m: raise ValueError("valeur src non reconnue (data-URL attendue)")
    mime, raw = m.group(1).lower(), base64.b64decode(m.group(2))
    ext = {"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "application/pdf": ".pdf"}.get(mime)
    if not ext: raise ValueError("type non pris en charge : " + mime)
    p = os.path.join(folder, "in" + ext); open(p, "wb").write(raw); return p, mime

def file_to_data_url(p, mime):
    return f"data:{mime};base64," + base64.b64encode(open(p, "rb").read()).decode()

def process(src_path, ops, folder):
    """Traite une pièce localement. Retourne {img?, pdf?, gray?, text, report}."""
    rep, out = [], {}
    pdf_in = os.path.join(folder, "in.pdf")
    if src_path.lower().endswith(".pdf"):
        if src_path != pdf_in: shutil.copy(src_path, pdf_in)
        is_img = False
    else:
        img = src_path
        if "dewarp" in ops:   # page courbée → aplatie (on garde l'original si l'outil échoue)
            code, log = run(["page-dewarp", "-o", folder, "-f", "png", img], 240)
            cand = [f for f in os.listdir(folder) if f.endswith("_thresh.png") or f.endswith("_dewarped.png")]
            if code == 0 and cand: img = os.path.join(folder, cand[0]); rep.append("dewarp ok")
            else: rep.append("dewarp ignoré")
        code, log = run(["img2pdf", "--output", pdf_in, img])
        if code: raise RuntimeError("img2pdf : " + log)
        is_img = True
    ocr_pdf = os.path.join(folder, "ocr.pdf")
    base = ["ocrmypdf", "-l", "ara+fra", "--rotate-pages", "--rotate-pages-threshold", "5", "--output-type", "pdfa", "--optimize", "1", "--jobs", "2"]
    base += (["--deskew", "--clean-final"] if is_img else ["--skip-text", "--deskew", "--clean-final"])   # PDF : pages déjà textuelles laissées telles quelles
    if "clean" not in ops and is_img: base = [a for a in base if a not in ("--clean-final",)]
    code, log = run(base + [pdf_in, ocr_pdf], 600)
    if code not in (0, 4, 6, 10):   # 4/6/10 = avertissements (PDF/A non validé, déjà du texte…) : le fichier est produit
        rep.append("ocrmypdf échec " + str(code)); ocr_pdf = pdf_in
    else: rep.append("ocrmypdf ok" + ("" if code == 0 else f" (avertissement {code})"))
    if not os.path.exists(ocr_pdf): ocr_pdf = pdf_in
    out["pdf"] = ocr_pdf
    if is_img:  # image nettoyée (couleur) pour les programmes qui stockent des photos
        stem = os.path.join(folder, "page")
        code, log = run(["pdftoppm", "-r", "200", "-jpeg", "-jpegopt", "quality=88", "-singlefile", ocr_pdf, stem])
        if code == 0 and os.path.exists(stem + ".jpg"): out["img"] = stem + ".jpg"
    if "gray" in ops:   # PDF d'impression en gris (Ghostscript)
        g = os.path.join(folder, "gray.pdf")
        code, log = run(["gs", "-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite", "-sColorConversionStrategy=Gray",
                         "-dProcessColorModel=/DeviceGray", "-dCompatibilityLevel=1.5", "-o", g, ocr_pdf])
        if code == 0: out["gray"] = g; rep.append("gris ok")
        else: rep.append("gris échec")
    full = subprocess.run(["pdftotext", "-layout", ocr_pdf, "-"], capture_output=True, text=True).stdout or ""
    out["text"] = full[:20000]
    out["pages"] = [pg[:4000] for pg in full.split("\f") if pg.strip() or True][:60]   # texte page par page → découpage automatique côté programme
    if out["pages"] and not out["pages"][-1].strip(): out["pages"].pop()
    out["report"] = "; ".join(rep)
    return out

# ---------- Firebase (REST) ----------
def http(url, method="GET", body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read().decode() or "null")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 404): raise
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    raise RuntimeError("réseau : " + url.split("?")[0])

def login(key):
    j = http(f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={key}", "POST",
             {"email": S["email"], "password": S["password"], "returnSecureToken": True})
    return j["idToken"]

class Base:
    def __init__(self, app): self.a, self.tok = app, login(app["key"])
    def url(self, path, q=""): return f"{self.a['db']}/{path}.json?auth={self.tok}{q}"
    def get(self, path, q=""): return http(self.url(path, q))
    def write(self, path, method, body=None):
        if not path.startswith(self.a["root"] + "/_docpro/"):   # garde-fou : jamais ailleurs
            raise PermissionError("écriture interdite hors _docpro : " + path)
        return http(self.url(path), method, body)

def handle(app):
    b, root, done = Base(app), app["root"], 0
    queue = b.get(f"{root}/_docpro/queue") or {}
    for jid, job in sorted(queue.items(), key=lambda kv: (kv[1] or {}).get("t", 0)):
        if done >= MAX_JOBS: break
        rec = {"src": (job or {}).get("src"), "key": (job or {}).get("key"), "meta": (job or {}).get("meta"), "t": int(time.time() * 1000), "app": app["id"]}
        try:
            src = rec["src"] or ""
            if not src or ".." in src: raise ValueError("src invalide")
            val = b.get(src)
            with tempfile.TemporaryDirectory() as d:
                p, mime = data_url_to_file(val, d)
                r = process(p, job.get("ops") or ["clean", "ocr", "gray"], d)
                files = {}
                want = job.get("out") or ["img", "pdf", "gray"]
                for k, m in (("img", "image/jpeg"), ("pdf", "application/pdf"), ("gray", "application/pdf")):
                    if k in want and r.get(k) and os.path.getsize(r[k]) < MAX_OUT * 3 // 4: files[k] = file_to_data_url(r[k], m)
                b.write(f"{root}/_docpro/files/{jid}", "PUT", files)
                rec.update(ok=True, text=r["text"], pages=r.get("pages", []), report=r["report"], outputs=sorted(files))
        except Exception as e:
            rec.update(ok=False, error=str(e)[:300])
        b.write(f"{root}/_docpro/done/{jid}", "PUT", rec)
        b.write(f"{root}/_docpro/queue/{jid}", "DELETE")
        done += 1
        print(app["id"], jid, "ok" if rec.get("ok") else "erreur", rec.get("report") or rec.get("error"))
    return done

if __name__ == "__main__":
    if len(sys.argv) > 1:   # test local : python worker.py image.jpg
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, os.path.basename(sys.argv[1])); shutil.copy(sys.argv[1], p)
            r = process(p, sys.argv[2].split(",") if len(sys.argv) > 2 else ["clean", "ocr", "gray"], d)
            os.makedirs("out", exist_ok=True)
            for k in ("img", "pdf", "gray"):
                if r.get(k): shutil.copy(r[k], os.path.join("out", k + os.path.splitext(r[k])[1]))
            print(json.dumps({"report": r["report"], "text": r["text"][:300]}, ensure_ascii=False))
        sys.exit(0)
    if not S.get("password"): print("pas de secret EGTPH_PUSH"); sys.exit(0)
    if os.environ.get("DOCPRO_CHECK"):   # étape légère : y a-t-il des pièces en attente ? (évite d'installer les outils pour rien)
        n = 0
        for app in APPS:
            try: n += len(Base(app).get(f"{app['root']}/_docpro/queue", "&shallow=true") or {})
            except Exception as e: print(app["id"], "ignoré :", str(e)[:120])
        print("en attente :", n)
        with open(os.environ.get("GITHUB_OUTPUT", os.devnull), "a") as f: f.write(f"jobs={n}\n")
        sys.exit(0)
    total = 0
    for app in APPS:
        try: total += handle(app)
        except Exception as e: print(app["id"], "ignoré :", str(e)[:200])
    print("pièces traitées :", total)
