/* EGTPH — وثائق العامل للمناقصات + صندوق الوارد الذكي (برنامج العمال egtph-rh).
   1) في نافذة العامل: قسم «📂 وثائق العامل» : الشهادة الجامعية، شهادة الخبرة، شهادة العمل الممضاة، بطاقة التعريف.
      إرفاق / استبدال (الصور تُقص وتُنظف بـ egtph-scan.js) — فتح — حذف ؛ عند الاستبدال تُحفظ النسخة القديمة في السجل files_hist.
   2) تزامن مع Firebase في نفس عقدة الملفات «files» (مفاتيح dip_/exp_/att_/cni_ + معرّف العامل)، منفصل تماماً عن تزامن CNAS.
   3) «📥 صندوق الوارد» في صفحة العمال: تختار صوراً أو PDF، البرنامج يقرأها (EGTPHOcr)، يعرف النوع (قواعد + ذكاء يتعلم من تصحيحاتك)
      ويعرف العامل (رقم الضمان الاجتماعي، الاسم واللقب، تاريخ الميلاد)، ثم يعرض كل شيء للتأكيد. لا يُحفظ شيء قبل «اعتماد».
   يعتمد على دوال البرنامج: getWorkerDoc, putWorkerDoc, deleteWorkerDoc, idbGetDoc, idbPutDoc, blobToB64, b64ToBlob, fbRef, fbReady,
   fbIsViewer, fbNormalize, editW, S, toast, oM, closeM, LANG — وعلى egtph-doc.js و egtph-scan.js و egtph-ocr.js. */
(function(){
  "use strict";
  if(window.EGTPHRhDocs)return;
  const AR=()=>{try{return LANG==="ar";}catch(e){return document.documentElement.lang==="ar";}};
  const L=(fr,ar)=>AR()?ar:fr;
  const KINDS={dip:["Diplôme","الشهادة الجامعية / المهنية"],exp:["Attestation d'expérience","شهادة الخبرة"],att:["Attestation de travail signée","شهادة العمل (ممضاة)"],cni:["Pièce d'identité","بطاقة التعريف"]};
  const PK=Object.keys(KINDS),MAXN=9;
  const base=k=>String(k||"").replace(/\d+$/,"");            // dip2 → dip
  const isPK=k=>PK.includes(base(k));
  const slots=k=>[k].concat(Array.from({length:MAXN-1},(_,i)=>k+(i+2)));   // dip, dip2 … dip9
  async function docsOf(wid,k){const out=[];for(const s of slots(k)){let r=null;try{r=await getWorkerDoc(wid,s);}catch(e){}if(r)out.push({slot:s,r});}return out;}
  async function freeSlot(wid,k){for(const s of slots(k)){let r=null;try{r=await getWorkerDoc(wid,s);}catch(e){}if(!r)return s;}return null;}
  const TYPE2K={diplome:"dip",attestation_travail:"att",experience:"exp",cni:"cni"};
  const TOMB="egtph_rh_pers_tombs_v1",MKEY="egtph_ai_model_rh";
  const esc2=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const D=()=>window.EGTPHDoc;
  const key=(kind,wid)=>kind+"_"+wid;
  const ready=()=>{try{return !!(fbReady&&fbRef);}catch(e){return false;}};
  const viewer=()=>{try{return fbIsViewer();}catch(e){return false;}};
  const tombs=()=>{try{return JSON.parse(localStorage.getItem(TOMB)||"{}");}catch(e){return {};}};
  const saveTombs=t=>{try{localStorage.setItem(TOMB,JSON.stringify(t));}catch(e){}};
  const fdate=iso=>{try{return new Date(iso).toLocaleDateString(AR()?"ar-DZ":"fr-DZ");}catch(e){return "";}};

  /* ---------- حفظ وثيقة (مع السجل) ---------- */
  async function cleanFile(f){
    if(/^image\//i.test(f.type)&&window.EGTPHScan&&EGTPHScan.autoFile){try{return await EGTPHScan.autoFile(f);}catch(e){}}
    return f;
  }
  async function archiveOld(wid,kind){
    try{const old=await getWorkerDoc(wid,kind);if(!old||!old.blob||!ready()||viewer())return;
      await fbRef.child("files_hist/"+key(kind,wid)+"/"+Date.now()).set(fbNormalize({name:old.name,type:old.type,size:old.size,updatedAtMs:Number(old.updatedAtMs)||0,b64:await blobToB64(old.blob)}));
    }catch(e){console.warn("[RH docs] historique",e);}
  }
  async function storeDoc(wid,kind,file,extra){
    file=await cleanFile(file);
    await archiveOld(wid,kind);
    await putWorkerDoc(wid,kind,file,extra||{});
    const rec=await idbGetDoc(kind+":"+wid);if(rec){rec.updatedAtMs=Date.now();if(extra&&extra.label)rec.label=extra.label;await idbPutDoc(rec);}
    const t=tombs();if(t[key(kind,wid)]){delete t[key(kind,wid)];saveTombs(t);}
    sync();return rec;
  }
  async function removeDoc(wid,kind){
    await deleteWorkerDoc(wid,kind);const t=tombs();t[key(kind,wid)]=Date.now();saveTombs(t);sync();
  }

  /* ---------- التزامن (نفس منطق CNAS، لأنواع وثائق العامل فقط، مع الاحتفاظ بنوع الملف) ---------- */
  let busy=false,pending=false;
  async function sync(){
    if(!ready())return;if(busy){pending=true;return;}busy=true;let changed=false;
    try{
      const remote=(await fbRef.child("files").once("value")).val()||{};
      const local={};(await idbAllDocs()).forEach(r=>{if(r&&isPK(r.kind))local[key(r.kind,r.workerId)]=r;});
      const tb=tombs();
      for(const k of Object.keys(remote)){
        const rv=remote[k];if(!rv||typeof rv!=="object")continue;const kind=rv.kind||k.split("_")[0];if(!isPK(kind))continue;
        const rms=Number(rv.updatedAtMs)||0,lr=local[k];
        if(tb[k]&&tb[k]>=rms)continue;if(lr&&(Number(lr.updatedAtMs)||0)>=rms)continue;
        const wid=k.slice(k.indexOf("_")+1);
        if(rv.deleted){if(lr){await idbDelDoc(lr.id);delete local[k];changed=true;}continue;}
        if(!S.workers.some(w=>w.id===wid)||!rv.b64)continue;
        const rec={id:kind+":"+wid,workerId:wid,kind,name:rv.name||k,type:rv.type||"application/pdf",size:Number(rv.size)||0,
          updatedAt:new Date(rms).toISOString(),updatedAtMs:rms,cloudMs:rms,blob:b64ToBlob(rv.b64,rv.type||"application/pdf"),ocrText:rv.ocrText||"",label:rv.label||""};
        await idbPutDoc(rec);local[k]=rec;changed=true;
      }
      if(!viewer()){
        for(const k of Object.keys(local)){
          const lr=local[k],lms=Number(lr.updatedAtMs)||0,rv=remote[k],rms=rv?Number(rv.updatedAtMs)||0:0;
          if(!lms||(rv&&rms>=lms))continue;
          try{await fbRef.child("files/"+k).set(fbNormalize({kind:lr.kind,wid:lr.workerId,name:lr.name,label:lr.label||"",type:lr.type,size:lr.size,updatedAtMs:lms,ocrText:String(lr.ocrText||"").slice(0,5000),b64:await blobToB64(lr.blob)}));
            lr.cloudMs=lms;await idbPutDoc(lr);}catch(e){console.warn("[RH docs] envoi",k,e&&e.message);}
        }
        for(const k of Object.keys(tb)){const ms=tb[k],rv=remote[k],rms=rv?Number(rv.updatedAtMs)||0:0;
          if(!rv||(rv.deleted&&rms>=ms)||(!rv.deleted&&rms>ms)){delete tb[k];continue;}
          try{await fbRef.child("files/"+k).set({kind:k.split("_")[0],deleted:true,updatedAtMs:ms});delete tb[k];}catch(e){}}
        saveTombs(tb);
      }
    }catch(e){console.warn("[RH docs] synchronisation",e);}
    finally{busy=false;if(changed)renderPers();if(pending){pending=false;setTimeout(sync,500);}}
  }

  /* ---------- قسم الوثائق في نافذة العامل ---------- */
  function injectSection(){
    const box=document.getElementById("wCnasDocBox");if(!box||document.getElementById("wPersDocs"))return;
    const d=document.createElement("div");d.className="fl full doc-store";d.id="wPersDocs";box.after(d);
    const inp=document.createElement("input");inp.type="file";inp.id="wPersFile";inp.accept="application/pdf,image/*";inp.style.display="none";document.body.appendChild(inp);
    inp.onchange=async()=>{const f=inp.files&&inp.files[0],kind=inp.dataset.kind;inp.value="";if(!f||!kind||!editW)return;
      const label=(window.prompt(L("Intitulé (ex. Master génie civil) — facultatif","العنوان (مثلاً: ماستر هندسة مدنية) — اختياري"),"")||"").trim();
      try{await storeDoc(editW,kind,f,{label});toast(L("Pièce enregistrée ✓","حُفظت الوثيقة ✓"));renderPers();}catch(e){toast(L("Échec de l'enregistrement","تعذّر الحفظ"),"er");}};
  }
  async function renderPers(){
    injectSection();const box=document.getElementById("wPersDocs");if(!box)return;
    let wid=null;try{wid=editW;}catch(e){}
    let rows="";
    for(const k of PK){
      const list=wid?await docsOf(wid,k):[];
      rows+=`<div style="margin:8px 0;padding-top:6px;border-top:1px solid var(--br)"><b>${esc2(L(KINDS[k][0],KINDS[k][1]))}</b>`;
      if(!list.length)rows+=`<div class="doc-store-info">${L("— aucune —","— لا توجد —")}</div>`;
      for(const {slot,r} of list)rows+=`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0">
        <span class="doc-store-info" style="flex:1">✓ ${esc2(r.label||r.name)} · ${fdate(r.updatedAt)}</span>
        <button class="btp gray" type="button" data-pk-add="${slot}">📎 ${L("Remplacer","استبدال")}</button>
        <button class="btp gray" type="button" data-pk-open="${slot}">👁️</button>
        <button class="btp danger" type="button" data-pk-del="${slot}" ${viewer()?"disabled":""}>🗑️</button></div>`;
      rows+=`<button class="btp gray" type="button" data-pk-new="${k}" ${wid?"":"disabled"}>➕ ${list.length?L("Ajouter une autre","إضافة أخرى"):L("Joindre","إرفاق")}</button></div>`;
    }
    box.innerHTML=`<label>📂 ${L("Pièces du travailleur (soumissions)","وثائق العامل (للمناقصات)")}</label>
      ${wid?"":`<div class="doc-store-info">${L("Enregistrez d'abord le travailleur, puis joignez ses pièces.","احفظ العامل أولاً، ثم أرفق وثائقه.")}</div>`}${rows}`;
    const pick=slot=>{const i=document.getElementById("wPersFile");i.dataset.kind=slot;i.click();};
    box.querySelectorAll("[data-pk-add]").forEach(b=>b.onclick=()=>pick(b.dataset.pkAdd));
    box.querySelectorAll("[data-pk-new]").forEach(b=>b.onclick=async()=>{const s=await freeSlot(editW,b.dataset.pkNew);if(!s){toast(L("Maximum atteint","وصلت للحد الأقصى"),"er");return;}pick(s);});
    box.querySelectorAll("[data-pk-open]").forEach(b=>b.onclick=async()=>{const r=await getWorkerDoc(editW,b.dataset.pkOpen);if(r&&r.blob)window.open(URL.createObjectURL(r.blob),"_blank");});
    box.querySelectorAll("[data-pk-del]").forEach(b=>b.onclick=async()=>{if(!confirm(L("Retirer cette pièce ? (une copie reste dans l'historique)","حذف هذه الوثيقة؟ (تبقى نسخة في السجل)")))return;
      await archiveOld(editW,b.dataset.pkDel);await removeDoc(editW,b.dataset.pkDel);renderPers();});
  }

  /* ---------- الذكاء: النموذج المتعلّم ---------- */
  let MODEL=null;
  async function loadModel(){
    if(MODEL)return MODEL;try{MODEL=JSON.parse(localStorage.getItem(MKEY)||"null");}catch(e){}
    try{if(ready()){const m=(await fbRef.child("ai/model").once("value")).val();if(m&&m.docs&&(!MODEL||JSON.stringify(m.docs)!==JSON.stringify(MODEL.docs)))MODEL=m;}}catch(e){}
    if(!MODEL)MODEL=D().newModel();return MODEL;
  }
  async function saveModel(){try{localStorage.setItem(MKEY,JSON.stringify(MODEL));}catch(e){}try{if(ready()&&!viewer())await fbRef.child("ai/model").set(MODEL);}catch(e){}}

  /* ---------- القراءة ---------- */
  async function readText(f){
    try{
      if(/pdf/i.test(f.type)||/\.pdf$/i.test(f.name)){
        const pdfjs=await EGTPHOcr.lib(),pdf=await pdfjs.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;let txt="";
        for(let i=1;i<=Math.min(pdf.numPages,4);i++){const pg=await pdf.getPage(i);const tc=await pg.getTextContent();let t=tc.items.map(x=>x.str).join(" ");
          if(t.replace(/\s/g,"").length<40){const cv=await EGTPHOcr.pdfPageCanvas(pg,200);t=((await EGTPHOcr.recognize(cv,"ara+fra",{fast:true})).data||{}).text||"";}
          txt+=t+"\n";}
        return txt;
      }
      return ((await EGTPHOcr.recognize(await cleanFile(f),"ara+fra",{fast:true})).data||{}).text||"";
    }catch(e){console.warn("[RH inbox] lecture",e);return "";}
  }
  function guessKind(text){
    const n=String(text).toLowerCase();
    if(/attestation d.exp[ée]rience|شهادة (ال)?خبرة|certificat de travail/.test(n))return {k:"exp",sure:true};
    if(/carte nationale d.identit|بطاقة التعريف الوطنية|passeport|جواز السفر/.test(n))return {k:"cni",sure:true};
    const d=D().decide(text,MODEL);
    if(["cnas","casnos","cacobatph","affiliation"].includes(d.type))return {k:null,cnas:true,sure:d.sure};
    const k=TYPE2K[d.type]||(PK.includes(d.type)?d.type:null);return {k,sure:!!(k&&d.sure)};
  }
  const up=s=>String(s||"").toUpperCase().normalize("NFKD").replace(/[̀-ͯ]/g,"");
  function guessWorker(text){
    const T=up(text),digits=String(text).replace(/[٠-٩]/g,c=>"٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(/\D/g,"");
    const ws=(S.workers||[]);
    const bySS=ws.filter(w=>{const s=String(w.ss||"").replace(/\D/g,"");return s.length>=10&&digits.includes(s);});if(bySS.length===1)return bySS[0];
    const byName=ws.filter(w=>w.N&&w.P&&T.includes(up(w.N))&&T.includes(up(w.P)));if(byName.length===1)return byName[0];
    const ds=D().datesIn(text);const byDob=byName.length>1?byName.filter(w=>w.dd&&ds.includes(w.dd)):[];if(byDob.length===1)return byDob[0];
    return null;
  }

  /* ---------- صندوق الوارد ---------- */
  function modal(html){
    let m=document.getElementById("mInbox");
    if(!m){m=document.createElement("div");m.className="mo";m.id="mInbox";m.innerHTML='<div class="mc" style="max-width:760px"></div>';document.body.appendChild(m);}
    m.querySelector(".mc").innerHTML=html;oM("mInbox");return m;
  }
  function openInbox(){
    if(!D()||!window.EGTPHOcr){toast(L("Moteur en cours de chargement, réessayez.","المحرك قيد التحميل، أعد المحاولة."),"er");return;}
    const inp=document.createElement("input");inp.type="file";inp.multiple=true;inp.accept="application/pdf,image/*";inp.dataset.noscan="1";
    inp.onchange=()=>{const fs=[...inp.files];if(fs.length)runInbox(fs);};inp.click();
  }
  async function runInbox(files){
    modal(`<h3>📥 ${L("Boîte de réception","صندوق الوارد")}<span class="x" onclick="closeM('mInbox')">✕</span></h3><p id="ibxP">${L("Préparation…","جارٍ التحضير…")}</p>`);
    await loadModel();const rows=[];
    for(let i=0;i<files.length;i++){const f=files[i];const p=document.getElementById("ibxP");if(p)p.textContent=L("Lecture ","قراءة ")+(i+1)+" / "+files.length+" …";
      const text=await readText(f),g=guessKind(text),w=guessWorker(text);rows.push({file:f,text,k:g.k,sure:g.sure,cnas:g.cnas,wid:w?w.id:""});}
    review(rows);
  }
  function review(rows){
    const ws=(S.workers||[]).slice().sort((a,b)=>String(a.N).localeCompare(String(b.N)));
    const wopt=sel=>`<option value="">${L("— travailleur —","— العامل —")}</option>`+ws.map(w=>`<option value="${esc2(w.id)}" ${sel===w.id?"selected":""}>${esc2(w.N+" "+w.P)}</option>`).join("");
    const kopt=sel=>`<option value="">${L("— type —","— النوع —")}</option>`+PK.map(k=>`<option value="${k}" ${sel===k?"selected":""}>${esc2(L(KINDS[k][0],KINDS[k][1]))}</option>`).join("");
    const H=rows.map((r,i)=>`<div style="border:1px solid var(--br);border-radius:10px;padding:8px;margin:8px 0">
      <label style="font-weight:700"><input type="checkbox" data-ok="${i}" ${r.k&&r.wid?"checked":""}> ${esc2(r.file.name)}</label>
      ${r.cnas?`<div class="doc-store-info">⚠️ ${L("Pièce CNAS / CASNOS / CACOBATPH : utilisez l'import CNAS habituel (lecture automatique des dates).","وثيقة CNAS / CASNOS / CACOBATPH : استعمل استيراد CNAS المعتاد (قراءة التواريخ تلقائياً).")}</div>`:""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><select data-k="${i}">${kopt(r.k)}</select><select data-w="${i}">${wopt(r.wid)}</select>
        <select data-m="${i}"><option value="add" ${r.k==="cni"||r.k==="att"?"":"selected"}>${L("Ajouter (garder les autres)","إضافة (مع الإبقاء على الأخرى)")}</option><option value="rep" ${r.k==="cni"||r.k==="att"?"selected":""}>${L("Remplacer la première","استبدال الأولى")}</option></select>
        <input data-l="${i}" placeholder="${L("Intitulé (facultatif)","العنوان (اختياري)")}" style="flex:1;min-width:140px"></div>
      <div class="doc-store-info">${r.k?(r.sure?"✓ ":"? ")+L("type reconnu","نوع متعرَّف عليه"):L("type inconnu — choisissez","نوع غير معروف — اختر")}${r.wid?" · "+L("travailleur reconnu","عامل متعرَّف عليه"):""}</div></div>`).join("");
    modal(`<h3>📥 ${L("Boîte de réception","صندوق الوارد")}<span class="x" onclick="closeM('mInbox')">✕</span></h3>
      <p class="hint">${rows.length} ${L("pièce(s) lue(s). Vérifiez le type et le travailleur, puis validez. Rien n'est enregistré avant « Valider ».","وثيقة مقروءة. تحقق من النوع والعامل ثم اعتمد. لا يُحفظ شيء قبل «اعتماد».")}</p>
      <div style="max-height:60vh;overflow:auto">${H}</div><p class="hint" id="ibxP"></p>
      <div class="mft"><button class="btp gray" type="button" onclick="closeM('mInbox')">${L("Annuler","إلغاء")}</button><button class="btp solid" type="button" id="ibxGo">${L("Valider","اعتماد")}</button></div>`);
    document.getElementById("ibxGo").onclick=async()=>{
      document.getElementById("ibxGo").disabled=true;let n=0,learned=0;
      for(let i=0;i<rows.length;i++){const ok=document.querySelector(`#mInbox [data-ok="${i}"]`);if(!ok||!ok.checked)continue;
        const k=document.querySelector(`#mInbox [data-k="${i}"]`).value,wid=document.querySelector(`#mInbox [data-w="${i}"]`).value;if(!k||!wid)continue;
        const mode=document.querySelector(`#mInbox [data-m="${i}"]`).value,label=(document.querySelector(`#mInbox [data-l="${i}"]`).value||"").trim();
        const slot=mode==="rep"?k:(await freeSlot(wid,k));if(!slot){toast(L("Maximum atteint","وصلت للحد الأقصى"),"er");continue;}
        await storeDoc(wid,slot,rows[i].file,{ocrText:rows[i].text.slice(0,5000),label});n++;
        if(rows[i].text.length>20){const typ=Object.keys(TYPE2K).find(t=>TYPE2K[t]===k)||k;D().train(MODEL,typ,rows[i].text);learned++;}
        const p=document.getElementById("ibxP");if(p)p.textContent=n+" …";}
      if(learned)await saveModel();closeM("mInbox");toast(L(n+" pièce(s) rangée(s) ✓",n+" وثيقة رُتّبت ✓"));
    };
  }

  /* ---------- التركيب في الصفحة ---------- */
  function mount(){
    injectSection();
    const tit=document.querySelector("#pg-wk .ctit");
    if(tit&&!document.getElementById("rhInboxBtn")){const b=document.createElement("button");b.className="btp gray";b.id="rhInboxBtn";b.type="button";
      b.textContent="📥 "+L("Boîte de réception","صندوق الوارد");b.onclick=openInbox;const add=tit.querySelector("button");if(add)add.before(b);else tit.appendChild(b);}
    // كلما فُتحت نافذة العامل (refreshWorkerCnasDoc تُستدعى عند الفتح) نُحدّث قسم الوثائق
    if(typeof window.refreshWorkerCnasDoc==="function"&&!window.refreshWorkerCnasDoc._pers){
      const orig=window.refreshWorkerCnasDoc;const wrapped=async function(){const r=await orig.apply(this,arguments);try{await renderPers();}catch(e){}return r;};wrapped._pers=true;window.refreshWorkerCnasDoc=wrapped;}
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
  // التزامن: عند جاهزية Firebase ثم كل دقيقتين
  let tries=0;const boot=setInterval(()=>{if(ready()){clearInterval(boot);sync();}else if(++tries>120)clearInterval(boot);},2000);
  setInterval(()=>{if(ready())sync();},120000);
  window.EGTPHRhDocs={KINDS,docsOf,freeSlot,storeDoc,removeDoc,sync,renderPers,openInbox,runInbox,review,guessKind,guessWorker,loadModel,_model:()=>MODEL};
})();
