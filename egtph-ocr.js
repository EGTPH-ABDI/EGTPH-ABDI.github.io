/* EGTPH — moteur de lecture (OCR) partagé, réglé pour la meilleure précision.
   Mêmes principes que les lecteurs professionnels :
   - PDF numérique : texte lu directement (aucune erreur possible) ; PDF scanné : page rendue à 300 dpi ;
   - image mise à l'échelle « 300 dpi » (texte assez grand pour Tesseract) ;
   - plusieurs rendus de la même page : original, nettoyé (fond blanc, ombres retirées), binarisé (Sauvola) ;
   - pour chaque ligne, la lecture la plus sûre (confiance) est gardée ;
   - photo couchée / à l'envers détectée et redressée ;
   - moteurs gardés en mémoire (pas de rechargement à chaque lecture).
   API : EGTPHOcr.recognize(image|canvas|Blob|dataURL, lang, {logger, psm, fast}) → {data:{text,confidence,blocks,lines,rotation,variant}}
         EGTPHOcr.prepare(src,"clean"|"bin") → canvas ; EGTPHOcr.pdfPageCanvas(pdfPage) → canvas 300 dpi */
(function(){
  if(window.EGTPHOcr)return;
  const TESS_URLS=["https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js","https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.4/tesseract.min.js","https://unpkg.com/tesseract.js@5.1.1/dist/tesseract.min.js"];
  const load=src=>new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=()=>rej(new Error("load "+src));document.head.appendChild(s);});
  async function lib(){
    if(window.Tesseract&&window.Tesseract.createWorker)return window.Tesseract;
    let err;for(const u of TESS_URLS){try{await load(u);if(window.Tesseract)return window.Tesseract;}catch(e){err=e;}}
    throw err||new Error("OCR");
  }
  /* ---------- moteurs en cache ---------- */
  const pool={};let curLogger=null;
  async function worker(lang){
    const k=lang||"fra";
    if(!pool[k])pool[k]={p:(async()=>{const T=await lib();const w=await T.createWorker(k,1,{logger:m=>{try{curLogger&&curLogger(m);}catch(e){}}});
      try{await w.setParameters({preserve_interword_spaces:"1",user_defined_dpi:"300"});}catch(e){}return w;})()};
    clearTimeout(pool[k].t);pool[k].t=setTimeout(async()=>{const p=pool[k];delete pool[k];try{(await p.p).terminate();}catch(e){}},120000);
    try{return await pool[k].p;}catch(e){delete pool[k];throw e;}
  }
  /* ---------- images ---------- */
  async function toCanvas(src){
    if(src&&src.getContext)return src;
    let img=src;
    if(typeof src==="string"){img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=src;});}
    else if(src instanceof Blob){try{img=await createImageBitmap(src);}catch(e){img=await new Promise((res,rej)=>{const u=URL.createObjectURL(src),im=new Image();im.onload=()=>{URL.revokeObjectURL(u);res(im);};im.onerror=rej;im.src=u;});}}
    const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height,c=document.createElement("canvas");c.width=w;c.height=h;
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,w,h);x.drawImage(img,0,0);return c;
  }
  function scaled(cv,s,rot){
    const r=((rot||0)%360+360)%360,w=Math.max(1,Math.round(cv.width*s)),h=Math.max(1,Math.round(cv.height*s)),c=document.createElement("canvas");
    c.width=(r===90||r===270)?h:w;c.height=(r===90||r===270)?w:h;
    const x=c.getContext("2d",{willReadFrequently:true});x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.imageSmoothingQuality="high";
    x.translate(c.width/2,c.height/2);x.rotate(r*Math.PI/180);x.drawImage(cv,-w/2,-h/2,w,h);x.setTransform(1,0,0,1,0,0);return c;
  }
  // échelle « 300 dpi » : la plus grande dimension d'une page A4 ≈ 3500 px
  function normScale(cv){const L=Math.max(cv.width,cv.height);return L<2400?Math.min(2.6,2600/L):(L>3600?3600/L:1);}
  function grayOf(cv){const x=cv.getContext("2d",{willReadFrequently:true}),d=x.getImageData(0,0,cv.width,cv.height).data,g=new Float32Array(cv.width*cv.height);for(let i=0,j=0;i<d.length;i+=4,j++)g[j]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];return g;}
  function putGray(cv,g){const x=cv.getContext("2d",{willReadFrequently:true}),id=x.getImageData(0,0,cv.width,cv.height),d=id.data;for(let i=0,j=0;i<d.length;i+=4,j++){d[i]=d[i+1]=d[i+2]=g[j];d[i+3]=255;}x.putImageData(id,0,0);return cv;}
  function copy(cv){const c=document.createElement("canvas");c.width=cv.width;c.height=cv.height;c.getContext("2d").drawImage(cv,0,0);return c;}
  // fond retiré (ombres, papier jauni) puis niveaux de gris étirés
  function cleanCv(cv){
    const c=copy(cv);
    if(window.EGTPHScan&&EGTPHScan.clean){EGTPHScan.clean(c);}
    const W=c.width,H=c.height,g=grayOf(c),hist=new Uint32Array(256);g.forEach(v=>hist[v|0]++);
    const pct=q=>{let a=0,t=q*W*H;for(let v=0;v<256;v++){a+=hist[v];if(a>=t)return v;}return 255;};
    const lo=pct(0.004),hi=Math.max(lo+40,pct(0.9));
    for(let j=0;j<g.length;j++){const t=(g[j]-lo)/(hi-lo);g[j]=t<=0?0:t>=1?255:Math.round(255*Math.pow(t,1.1));}
    return putGray(c,g);
  }
  // binarisation locale de Sauvola (image intégrale)
  function sauvola(cv){
    const c=copy(cv),W=c.width,H=c.height,g=grayOf(c),I=new Float64Array((W+1)*(H+1)),I2=new Float64Array((W+1)*(H+1));
    for(let y=0;y<H;y++){let s=0,s2=0;for(let x=0;x<W;x++){const v=g[y*W+x];s+=v;s2+=v*v;const k=(y+1)*(W+1)+x+1;I[k]=I[k-W-1]+s;I2[k]=I2[k-W-1]+s2;}}
    const R=Math.max(10,Math.round(Math.max(W,H)/90)),K=0.2,Rr=128,o=new Float32Array(W*H);
    for(let y=0;y<H;y++){const y1=Math.max(0,y-R),y2=Math.min(H-1,y+R);for(let x=0;x<W;x++){const x1=Math.max(0,x-R),x2=Math.min(W-1,x+R),n=(x2-x1+1)*(y2-y1+1);
      const a=(y2+1)*(W+1)+x2+1,b=y1*(W+1)+x2+1,cc=(y2+1)*(W+1)+x1,d=y1*(W+1)+x1;
      const m=(I[a]-I[b]-I[cc]+I[d])/n,sd=Math.sqrt(Math.max(0,(I2[a]-I2[b]-I2[cc]+I2[d])/n-m*m));
      o[y*W+x]=g[y*W+x]>m*(1+K*(sd/Rr-1))?255:0;}}
    return putGray(c,o);
  }
  function prepare(src,mode){return toCanvas(src).then(cv=>{const n=scaled(cv,normScale(cv));return mode==="bin"?sauvola(cleanCv(n)):mode==="clean"?cleanCv(n):n;});}
  /* ---------- résultats ---------- */
  function linesOf(data){const out=[];(data.blocks||[]).forEach(b=>(b.paragraphs||[]).forEach(p=>(p.lines||[]).forEach(l=>out.push(l))));return out;}
  function rescale(data,f){
    if(f===1)return;const fix=o=>{if(o&&o.bbox){const b=o.bbox;o.bbox={x0:b.x0/f,y0:b.y0/f,x1:b.x1/f,y1:b.y1/f};}};
    (data.blocks||[]).forEach(b=>{fix(b);(b.paragraphs||[]).forEach(p=>{fix(p);(p.lines||[]).forEach(l=>{fix(l);(l.words||[]).forEach(w=>{fix(w);(w.symbols||[]).forEach(fix);});});});});
  }
  // Fusion par ligne : toutes les lectures (original, nettoyé, binarisé) sont mises ensemble ;
  // pour chaque endroit de la page, la ligne la plus riche en texte sûr est gardée.
  const alnum=t=>(String(t||"").match(/[0-9A-Za-zÀ-ÿ\u0600-\u06FF]/g)||[]).length;
  const quality=l=>alnum(l.text)*Math.max(0,(l.confidence||0)-20);
  function overlap(a,b){const ov=Math.min(a.bbox.y1,b.bbox.y1)-Math.max(a.bbox.y0,b.bbox.y0),hh=Math.min(a.bbox.y1-a.bbox.y0,b.bbox.y1-b.bbox.y0),hx=Math.min(a.bbox.x1,b.bbox.x1)-Math.max(a.bbox.x0,b.bbox.x0);return hh>0&&ov/hh>0.45&&hx>0;}
  function fuse(res){
    const all=[];res.forEach((r,ri)=>linesOf(r.data).forEach(l=>{if(alnum(l.text))all.push({l,ri,q:quality(l)});}));
    all.sort((a,b)=>b.q-a.q);
    const keep=[],from=res.map(()=>0);
    all.forEach(c=>{if(!keep.some(k=>overlap(k.l,c.l))){keep.push(c);from[c.ri]+=c.q;}});
    keep.sort((a,b)=>a.l.bbox.y0-b.l.bbox.y0||a.l.bbox.x0-b.l.bbox.x0);
    const lines=keep.map(k=>k.l),tot=keep.reduce((a,k)=>a+alnum(k.l.text),0);
    const data=Object.assign({},res[0].data);
    data.blocks=lines.map(l=>({bbox:l.bbox,confidence:l.confidence,text:l.text,paragraphs:[{bbox:l.bbox,text:l.text,lines:[l]}]}));
    data.text=lines.map(l=>String(l.text||"").replace(/\n$/,"")).join("\n");
    data.confidence=tot?keep.reduce((a,k)=>a+alnum(k.l.text)*(k.l.confidence||0),0)/tot:0;
    data.words=lines.reduce((a,l)=>a.concat(l.words||[]),[]);
    return {data,variant:res[from.indexOf(Math.max(...from))].variant,score:keep.reduce((a,k)=>a+k.q,0)};
  }
  async function recognize(src,lang,opts){
    opts=opts||{};lang=lang||"fra";
    const base=await toCanvas(src),s=normScale(base),rot=opts.rotation||0;
    const norm=scaled(base,s,rot),w=await worker(lang);
    try{await w.setParameters({tessedit_pageseg_mode:String(opts.psm||3)});}catch(e){}
    const variants=[["clean",()=>cleanCv(norm)],["orig",()=>norm],["bin",()=>sauvola(cleanCv(norm))]];
    const want=opts.fast?1:3,res=[];
    for(let i=0;i<variants.length&&res.length<want;i++){
      if(i===2&&res.length>=2&&Math.min(...res.map(r=>r.data.confidence||0))>=85)break; // déjà très sûr
      curLogger=opts.logger?m=>{if(m&&m.status==="recognizing text")opts.logger(Object.assign({},m,{progress:(i+(m.progress||0))/Math.min(want,variants.length)}));else opts.logger(m);}:null;
      const r=await w.recognize(variants[i][1](),{},{blocks:true,text:true});
      r.variant=variants[i][0];res.push(r);
    }
    curLogger=null;
    const best=fuse(res);
    // photo couchée ou à l'envers : presque rien de sûr → essai des autres sens
    if(!opts.rotation&&!opts.noRotate&&(best.data.confidence||0)<45){
      let br=null;
      for(const r of [90,270,180]){
        const t=scaled(base,Math.min(1,1600/Math.max(base.width,base.height)),r),q=await w.recognize(cleanCv(t),{},{text:true});
        if((q.data.confidence||0)>(best.data.confidence||0)+15&&(!br||q.data.confidence>br.c))br={r,c:q.data.confidence};
      }
      if(br)return recognize(base,lang,Object.assign({},opts,{rotation:br.r,noRotate:true}));
    }
    rescale(best.data,s);
    best.data.lines=linesOf(best.data);best.data.rotation=rot;best.data.variant=best.variant;
    return best;
  }
  async function pdfPageCanvas(page,dpi){
    const base=page.getViewport({scale:1}),scale=Math.min((dpi||300)/72,3600/Math.max(base.width,base.height)),vp=page.getViewport({scale});
    const c=document.createElement("canvas");c.width=Math.round(vp.width);c.height=Math.round(vp.height);
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:x,viewport:vp}).promise;return c;
  }
  window.EGTPHOcr={recognize,prepare,pdfPageCanvas,worker,lib};
})();
