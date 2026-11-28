/* EGTPH — صندوق الوارد الذكي لبرنامج العتاد (parc_document).
   تختار صوراً أو ملفات PDF (بطاقات رمادية، تأمين، مراقبة تقنية، رخص سير) كما جاءت، والبرنامج:
   1) يقص وينظف ويقوّم (egtph-scan.js) ؛ 2) يقرأ النص (Tesseract الخاص بالبرنامج) ؛ 3) يعرف نوع الوثيقة (قواعد + ذكاء يتعلم من تصحيحاتك)
   4) يعرف المركبة من الماتريكول ؛ 5) يقترح تواريخ البداية والنهاية ؛ 6) يعرض عليك كل شيء للتأكيد ؛
   7) عند التأكيد: يحفظ القديمة في السجل (يمكن الرجوع إليها)، يضع الجديدة مكانها، ويتعلم من اختياراتك.
   لا يكتب شيئاً قبل ضغطك على «اعتماد». يعتمد على: egtph-doc.js (EGTPHDoc) و egtph-scan.js و دوال البرنامج (setImg, _findVehByMat, pvCreateWorker…). */
(function(){
  "use strict";
  if(window.EGTPHInbox)return;
  const L=(fr,ar)=>(String(document.documentElement.lang||"").startsWith("ar")||document.documentElement.dir==="rtl")?ar:fr;
  const TT={cg:["Carte grise","البطاقة الرمادية"],as:["Assurance","التأمين"],ct:["Contrôle technique","المراقبة التقنية"],pm:["Permis de circuler","رخصة السير"]};
  const TYPE2TT={carte_grise:"cg",assurance:"as",controle_technique:"ct",permis:"pm"};
  const MKEY="egtph_ai_model_parc";
  const fbModelPath=()=>FB_URL+"/egtph/"+FB_SECRET+"_ai/model.json"+_fbAuthQS();
  const histPath=k=>FB_URL+FB_IMG_BASE+"_hist/"+_imgKey(k)+"/"+Date.now()+".json"+_fbAuthQS();
  const esc2=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const D=()=>window.EGTPHDoc;

  /* ---------- النموذج المتعلّم (محلي + Firebase) ---------- */
  let MODEL=null;
  async function loadModel(){
    if(MODEL)return MODEL;
    try{MODEL=JSON.parse(localStorage.getItem(MKEY)||"null");}catch(e){}
    try{if(navigator.onLine){const r=await fetch(fbModelPath(),{cache:"no-store"});if(r.ok){const m=await r.json();if(m&&m.docs&&(!MODEL||JSON.stringify(m.docs)!==JSON.stringify(MODEL.docs)))MODEL=m;}}}catch(e){}
    if(!MODEL)MODEL=D().newModel();
    return MODEL;
  }
  async function saveModel(){
    try{localStorage.setItem(MKEY,JSON.stringify(MODEL));}catch(e){}
    try{if(navigator.onLine)await fetch(fbModelPath(),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(MODEL)});}catch(e){}
  }

  /* ---------- تحويل ملف إلى صور (PDF: كل صفحة صورة) ---------- */
  async function filesToImages(files,progress){
    const out=[];
    for(const f of files){
      if(/pdf/i.test(f.type)||/\.pdf$/i.test(f.name)){
        const pdfjs=await loadPdfLibrary(),pdf=await pdfjs.getDocument({data:new Uint8Array(await f.arrayBuffer())}).promise;
        for(let i=1;i<=Math.min(pdf.numPages,30);i++){progress(L("Lecture du PDF ","قراءة PDF ")+f.name+" — "+i+"/"+pdf.numPages);
          const page=await pdf.getPage(i),url=await pvRenderPdfPage(page);try{page.cleanup();}catch(e){}
          const b=await (await fetch(url)).blob();out.push({file:new File([b],f.name+"-p"+i+".jpg",{type:"image/jpeg"}),src:f.name,page:i});}
      }else if(/^image\//i.test(f.type)||/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))out.push({file:f,src:f.name,page:1});
    }
    return out;
  }
  const readStore=file=>new Promise(res=>processDocumentImageRaw(file,r=>res(r)));

  /* ---------- قراءة صفحة واحدة ---------- */
  async function readPage(item,worker){
    let file=item.file;
    try{if(window.EGTPHScan&&EGTPHScan.autoFile)file=await EGTPHScan.autoFile(file);}catch(e){}
    const st=await readStore(file);if(!st)throw new Error("image");
    let text="";try{text=(await pvRecognizeImage(worker,st.ocr,1,1)).text||"";}catch(e){}
    return {store:st.store,text};
  }

  /* ---------- تحليل: النوع، المركبة، التواريخ ---------- */
  function guessType(text){
    const n=String(text).toLowerCase();
    if(/permis de circul|رخصة السير|رخصة المرور/.test(n))return {tt:"pm",sure:true,by:"règles"};
    const d=D().decide(text,MODEL),tt=TYPE2TT[d.type]||(d.type&&TT[d.type]?d.type:null);
    return {tt,sure:!!(tt&&d.sure),by:d.by,raw:d};
  }
  function findVehicle(text,tt){
    const x=D().extract(text);
    for(const m of x.matricules){const e=_findVehByMat(m);if(e)return {e,mat:m};}
    const digits=scanDigits(text);   // احتياط: ماتريكول مكتوب بشكل آخر
    const hits=DATA.equipment.filter(e=>e&&e.veh&&scanDigits(e.matricule).length>=8&&digits.includes(scanDigits(e.matricule)));
    if(hits.length===1)return {e:hits[0],mat:hits[0].matricule};
    /* احتياط ذكي: رقم الوثيقة/المحضر، رقم الهيكل، رقم التسجيل المقلوب أو الناقص، تاريخ التجديد */
    if(tt!=="pm"&&D().vehiclePick){const r=D().vehiclePick(text,DATA.equipment.filter(e=>e&&e.veh),tt==="ct"?"ct":tt==="cg"?"cg":"as");
      if(r.best)return {e:r.sure?r.best.e:null,guess:r.best.e,why:r.best.why,sure:r.sure,mat:x.matricules[0]||"",many:r.list.map(c=>c.e)};}
    return {e:null,mat:x.matricules[0]||"",many:hits};
  }
  function guessDates(text,tt){
    const ds=D().datesIn(text);if(!ds.length||tt==="cg")return {deb:"",fin:""};
    const fin=ds[ds.length-1],y=+fin.slice(0,4);
    const deb=ds.filter(d=>d<fin&&+d.slice(0,4)>=y-1).pop()||"";
    return {deb,fin};
  }

  /* ---------- النافذة ---------- */
  function vehOptions(sel){
    const vs=DATA.equipment.filter(e=>e&&e.veh).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
    return `<option value="">${L("— véhicule —","— المركبة —")}</option>`+vs.map(e=>`<option value="${esc2(e.id)}" ${sel===e.id?"selected":""}>${esc2(e.name)} — ${esc2(e.matricule||"")}</option>`).join("");
  }
  function ttOptions(sel){return `<option value="">${L("— type —","— النوع —")}</option>`+Object.keys(TT).map(k=>`<option value="${k}" ${sel===k?"selected":""}>${L(TT[k][0],TT[k][1])}</option>`).join("");}

  async function open(){
    if(!D()){alert(L("Moteur en cours de chargement, réessayez.","المحرك قيد التحميل، أعد المحاولة."));return;}
    const inp=document.createElement("input");inp.type="file";inp.multiple=true;inp.accept="image/*,application/pdf";inp.dataset.noscan="1";
    inp.onchange=()=>{const fs=[...inp.files];if(fs.length)run(fs);};inp.click();
  }

  async function run(files){
    $("#modal").innerHTML=`<h3>📥 ${L("Boîte de réception","صندوق الوارد")}</h3><p class="muted" id="ibx_prog">${L("Préparation…","جارٍ التحضير…")}</p>`;
    $("#overlay").classList.add("show");
    const prog=s=>{const p=$("#ibx_prog");if(p)p.textContent=s;};
    await loadModel();
    let items=[],worker=null;
    try{
      items=await filesToImages(files,prog);
      if(!items.length){prog(L("Aucune image ou PDF.","لا توجد صور أو PDF."));return;}
      worker=await pvCreateWorker(items.length);
      for(let i=0;i<items.length;i++){prog(L("Lecture ","قراءة ")+(i+1)+" / "+items.length+" …");
        try{Object.assign(items[i],await readPage(items[i],worker));}catch(e){items[i].err=true;}}
    }finally{try{if(worker)await worker.terminate();}catch(e){}}
    // découpage : un scan de plusieurs pages = plusieurs pièces ; on garde la 1re page de chaque pièce (parc stocke une image par pièce)
    // le découpage se fait À L'INTÉRIEUR de chaque fichier (deux photos séparées = toujours deux pièces)
    const groups=[],bySrc={};items.forEach((x,i)=>(bySrc[x.src]=bySrc[x.src]||[]).push(i));
    for(const idx of Object.values(bySrc)){
      const gs=idx.length===1?[{pages:[0]}]:D().splitPages(idx.map(i=>({text:items[i].text||"",blank:!items[i].err&&!String(items[i].text||"").trim()})),MODEL);
      gs.forEach(g=>groups.push({pages:g.pages.map(k=>idx[k])}));
    }
    const rows=[];
    for(const g of groups){const it=items[g.pages[0]];if(!it||it.err||!it.store)continue;
      const all=g.pages.map(p=>items[p].text||"").join("\n");
      const ty=guessType(all),vh=findVehicle(all,ty.tt),dt=guessDates(all,ty.tt);
      let has=false;if(vh.e&&ty.tt){try{has=!!(await idbGetImg(vh.e.id+"_"+ty.tt));}catch(e){}}
      rows.push({img:it.store,text:all,src:it.src+(g.pages.length>1?" ("+g.pages.length+" p.)":""),tt:ty.tt,sure:ty.sure,by:ty.by,eid:vh.e?vh.e.id:(vh.guess?vh.guess.id:""),vsure:!!vh.e,vwhy:vh.why||[],mat:vh.mat,has,deb:dt.deb,fin:dt.fin});
    }
    review(rows);
  }

  function review(rows){
    const H=rows.map((r,i)=>`<div class="ibx-row" style="display:flex;gap:10px;align-items:flex-start;border:1px solid #ddd;border-radius:10px;padding:8px;margin:8px 0">
      <img src="${r.img}" style="width:92px;height:auto;border-radius:6px;border:1px solid #ccc;flex:none">
      <div style="flex:1;min-width:0">
        <label class="chk" style="font-weight:700"><input type="checkbox" data-ok="${i}" ${r.tt&&r.eid&&(r.vsure||!r.vwhy.length)?"checked":""}> ${esc2(r.src)}</label>
        <div class="row2" style="margin-top:4px"><select data-tt="${i}">${ttOptions(r.tt)}</select><select data-veh="${i}">${vehOptions(r.eid)}</select></div>
        <small class="muted">${r.tt?(r.sure?"✓ ":"? ")+L("type ","النوع ")+(r.by==="appris"?L("(appris)","(متعلَّم)"):""):L("type inconnu — choisissez","نوع غير معروف — اختر")}
          ${r.mat?" · "+esc2(r.mat):""}${r.eid&&r.vwhy.length?" · "+(r.vsure?"✓ ":"⚠ "+L("véhicule probable","مركبة مرجّحة")+": ")+esc2(r.vwhy.join(", ")):""}${r.has?" · "+L("remplace l'ancienne (gardée dans l'historique)","تستبدل القديمة (تبقى في السجل)"):""}</small>
        <div class="row2" data-dates="${i}" style="margin-top:4px;${r.tt==="cg"?"display:none":""}"><input type="date" data-deb="${i}" value="${esc2(r.deb)}" title="${L("Début","البداية")}"><input type="date" data-fin="${i}" value="${esc2(r.fin)}" title="${L("Fin","النهاية")}"></div>
      </div></div>`).join("");
    $("#modal").innerHTML=`<h3>📥 ${L("Boîte de réception","صندوق الوارد")}</h3>
      <p class="muted" style="margin-top:0">${rows.length} ${L("pièce(s) lue(s). Vérifiez le type, le véhicule et les dates, puis validez. Rien n'est enregistré avant « Valider ».","وثيقة مقروءة. تحقق من النوع والمركبة والتواريخ ثم اعتمد. لا يُحفظ شيء قبل «اعتماد».")}</p>
      <div style="max-height:60vh;overflow:auto">${H||`<p>${L("Rien de reconnu.","لم يُتعرَّف على شيء.")}</p>`}</div><p class="muted" id="ibx_prog" style="font-size:12px"></p>
      <div class="modal-actions"><button class="btn gray" id="ibx_cancel" type="button">${L("Annuler","إلغاء")}</button><button class="btn" id="ibx_go" type="button">${L("Valider","اعتماد")}</button></div>`;
    $("#ibx_cancel").onclick=closeModal;
    document.querySelectorAll("[data-tt]").forEach(s=>s.onchange=()=>{const d=document.querySelector(`[data-dates="${s.dataset.tt}"]`);if(d)d.style.display=s.value==="cg"?"none":"";});
    $("#ibx_go").onclick=async()=>{
      $("#ibx_go").disabled=true;let n=0,learned=0;
      for(let i=0;i<rows.length;i++){
        const r=rows[i],okb=document.querySelector(`[data-ok="${i}"]`);if(!okb||!okb.checked)continue;
        const tt=document.querySelector(`[data-tt="${i}"]`).value,eid=document.querySelector(`[data-veh="${i}"]`).value;
        const e=DATA.equipment.find(x=>x&&x.id===eid);if(!tt||!e)continue;
        const key=e.id+"_"+tt;
        // السجل: نحفظ القديمة قبل الاستبدال
        try{const old=await getImg(key);if(old&&navigator.onLine)await fetch(histPath(key),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({img:old,t:new Date().toISOString(),by:"inbox"})});}catch(x){}
        await setImg(key,r.img);
        const deb=(document.querySelector(`[data-deb="${i}"]`)||{}).value||"",fin=(document.querySelector(`[data-fin="${i}"]`)||{}).value||"";
        const f=tt==="as"?"assurance":tt==="ct"?"ct":tt==="pm"?"permis":null;
        if(f){e[f]=e[f]||{};if(deb)e[f].deb=deb;if(fin)e[f].fin=fin;}
        e._mod=nextMod();n++;
        // التعلّم: النوع الذي اخترته أو صححته
        const typ=Object.keys(TYPE2TT).find(k=>TYPE2TT[k]===tt)||tt;if(r.text&&r.text.length>20){D().train(MODEL,typ,r.text);learned++;}
        const p=$("#ibx_prog");if(p)p.textContent=n+" …";
      }
      if(learned)await saveModel();
      await saveAll();closeModal();try{show(CUR);}catch(x){try{render();}catch(y){}}
      egToast(L(n+" pièce(s) rangée(s) ✓",n+" وثيقة رُتّبت ✓"));
    };
  }

  window.inboxBtnHtml=()=>`<button class="btn ghost" id="inboxBtn" type="button">📥 ${L("Boîte de réception","صندوق الوارد")}</button>`;
  document.addEventListener("click",ev=>{const b=ev.target.closest&&ev.target.closest("#inboxBtn");if(b){ev.preventDefault();open();}});
  window.EGTPHInbox={open,run,review,guessType,findVehicle,guessDates,loadModel,_model:()=>MODEL};
})();
