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
  const latin=t=>String(t||"").toUpperCase().normalize("NFD").replace(/[^0-9A-Z]/g,"");
  const arabicRatio=t=>{const a=(String(t||"").match(/[\u0600-\u06FF]/g)||[]).length;return a/Math.max(1,alnum(t));};
  function lev(a,b){if(a===b)return 0;const m=a.length,n=b.length;if(!m||!n)return Math.max(m,n);let p=Array.from({length:n+1},(_,j)=>j);
    for(let i=1;i<=m;i++){const c=[i];for(let j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c;}return p[n];}
  function fuse(res,lang){
    const all=[];res.forEach((r,ri)=>linesOf(r.data).forEach(l=>{if(alnum(l.text))all.push({l,ri,q:quality(l),pp:r.variant==="paddle"});}));
    // PaddleOCR contre Tesseract sur la même ligne : même texte → Tesseract (espaces) ; texte différent → PaddleOCR (plus juste),
    // sauf ligne surtout arabe quand l'arabe est demandé.
    const pps=all.filter(c=>c.pp),tss=all.filter(c=>!c.pp);
    pps.forEach(P=>{
      const near=tss.filter(T=>overlap(P.l,T.l));if(!near.length){P.q+=1e6;return;}
      const T=near.sort((a,b)=>b.q-a.q)[0],a=latin(P.l.text),b=latin(T.l.text);
      // même début de ligne (l'un peut contenir en plus la partie arabe mal lue) → même texte
      const sh=a.length<=b.length?a:b,lg=a.length<=b.length?b:a;
      const sim=Math.max(1-lev(a,b)/Math.max(1,a.length,b.length), sh.length>=4?1-lev(sh,lg.slice(0,sh.length))/sh.length:0);
      if(sim>=0.9){P.q=-1;T.q+=1e6;}
      else if(/ara/.test(lang||"")&&arabicRatio(T.l.text)>0.4){P.q=-1;T.q+=1e6;}
      else{P.q+=1e6;}
    });
    for(let i=all.length-1;i>=0;i--)if(all[i].q<0)all.splice(i,1);
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
    const res=[];let want=opts.fast?1:3;
    if(opts.paddle!==false&&!opts.rotation){
      try{
        curLogger=null;if(opts.logger)opts.logger({status:"loading PaddleOCR",progress:0});
        const pr=await paddle(norm,{logger:opts.logger?m=>opts.logger(Object.assign({},m,{progress:(m.progress||0)*0.5})):null});
        if(pr.lines.length){
          res.push({variant:"paddle",data:{text:pr.text,confidence:pr.lines.reduce((a,l)=>a+l.confidence,0)/pr.lines.length,
            blocks:pr.lines.map(l=>({bbox:l.bbox,confidence:l.confidence,text:l.text,paragraphs:[{bbox:l.bbox,text:l.text,lines:[l]}]}))}});
          want=opts.fast?1:2; // Tesseract en complément (arabe, espaces)
        }
      }catch(e){console.warn("[ocr] PaddleOCR indisponible, Tesseract seul",e);}
    }
    const n0=res.length;
    for(let i=0;i<variants.length&&res.length-n0<want;i++){
      if(i===2&&res.length-n0>=2&&Math.min(...res.slice(n0).map(r=>r.data.confidence||0))>=85)break; // déjà très sûr
      curLogger=opts.logger?m=>{if(m&&m.status==="recognizing text")opts.logger(Object.assign({},m,{progress:(n0?0.5:0)+(n0?0.5:1)*(i+(m.progress||0))/Math.max(1,Math.min(want,variants.length))}));else opts.logger(m);}:null;
      const r=await w.recognize(variants[i][1](),{},{blocks:true,text:true});
      r.variant=variants[i][0];res.push(r);
    }
    curLogger=null;
    const best=fuse(res,lang);
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
  /* ---------- PaddleOCR PP-OCRv5 (réseaux de neurones, ONNX) : bien plus fort que Tesseract sur les photos,
     pour le texte latin (français, accents) et tous les chiffres. L'arabe reste lu par Tesseract. ---------- */
  const ORT_URL="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js";
  const PP_BASE="https://cdn.jsdelivr.net/npm/pdfmarkdown-ppocrv5-models@1.0.0/";
  let ppP=null;
  function paddleLoad(){
    if(ppP)return ppP;
    ppP=(async()=>{
      if(!window.ort)await load(ORT_URL);
      ort.env.wasm.wasmPaths="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
      ort.env.wasm.numThreads=Math.min(4,navigator.hardwareConcurrency||2);
      const opt={executionProviders:["wasm"],graphOptimizationLevel:"all"};
      const [det,rec,dict]=await Promise.all([
        ort.InferenceSession.create(PP_BASE+"detection/PP-OCRv5_mobile_det_infer.ort",opt),
        ort.InferenceSession.create(PP_BASE+"recognition/PP-OCRv5_mobile_rec_infer.onnx",opt),
        fetch(PP_BASE+"recognition/ppocrv5_dict.txt").then(r=>r.text())]);
      const chars=dict.replace(/\r/g,"").split("\n");if(chars[chars.length-1]==="")chars.pop();chars.push(" ");
      return {det,rec,chars};
    })();
    ppP.catch(()=>{ppP=null;});
    return ppP;
  }
  function bgrTensor(data,w,h,mean,std){
    const n=w*h,f=new Float32Array(3*n);
    for(let i=0,j=0;i<n;i++,j+=4){f[i]=(data[j+2]/255-mean[0])/std[0];f[n+i]=(data[j+1]/255-mean[1])/std[1];f[2*n+i]=(data[j]/255-mean[2])/std[2];}
    return new ort.Tensor("float32",f,[1,3,h,w]);
  }
  async function paddleDetect(m,cv){
    const MAX=1600,L=Math.max(cv.width,cv.height),r=Math.min(1,MAX/L);
    const W=Math.max(32,Math.round(cv.width*r/32)*32),H=Math.max(32,Math.round(cv.height*r/32)*32);
    const c=document.createElement("canvas");c.width=W;c.height=H;const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(cv,0,0,W,H);
    const t=bgrTensor(x.getImageData(0,0,W,H).data,W,H,[0.485,0.456,0.406],[0.229,0.224,0.225]);
    const out=await m.det.run({[m.det.inputNames[0]]:t}),pm=out[m.det.outputNames[0]].data;
    // carte de probabilité → zones de texte (composantes connexes)
    const bin=new Uint8Array(W*H);for(let i=0;i<W*H;i++)bin[i]=pm[i]>0.3?1:0;
    const lab=new Int32Array(W*H),q=new Int32Array(W*H),boxes=[];let id=0;
    for(let i=0;i<W*H;i++){if(!bin[i]||lab[i])continue;id++;let h0=0,t0=0;q[t0++]=i;lab[i]=id;let x0=1e9,y0=1e9,x1=-1,y1=-1,sum=0,n=0;
      while(h0<t0){const p=q[h0++],px=p%W,py=(p/W)|0;n++;sum+=pm[p];if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;
        const nb=[px>0?p-1:-1,px<W-1?p+1:-1,py>0?p-W:-1,py<H-1?p+W:-1];for(const k of nb){if(k>=0&&bin[k]&&!lab[k]){lab[k]=id;q[t0++]=k;}}}
      const bw=x1-x0+1,bh=y1-y0+1;if(bh<3||bw<3||sum/n<0.55)continue;
      const d=bw*bh*1.5/(2*(bw+bh)); // « unclip » de DBNet
      boxes.push({x0:Math.max(0,(x0-d)*cv.width/W),y0:Math.max(0,(y0-d)*cv.height/H),x1:Math.min(cv.width,(x1+1+d)*cv.width/W),y1:Math.min(cv.height,(y1+1+d)*cv.height/H),score:sum/n});
    }
    return boxes;
  }
  async function paddleRecognize(m,cv,b){
    const bw=b.x1-b.x0,bh=b.y1-b.y0;if(bw<4||bh<4)return null;
    const H=48,W=Math.max(16,Math.min(3200,Math.ceil(H*bw/bh)));
    const c=document.createElement("canvas");c.width=W;c.height=H;const x=c.getContext("2d",{willReadFrequently:true});x.imageSmoothingQuality="high";x.drawImage(cv,b.x0,b.y0,bw,bh,0,0,W,H);
    const t=bgrTensor(x.getImageData(0,0,W,H).data,W,H,[0.5,0.5,0.5],[0.5,0.5,0.5]);
    const out=await m.rec.run({[m.rec.inputNames[0]]:t}),o=out[m.rec.outputNames[0]],[,T,C]=o.dims,d=o.data;
    const em=[];let prev=0,cs=0,cn=0;
    for(let k=0;k<T;k++){let bi=0,bv=-1;for(let j=0;j<C;j++){const v=d[k*C+j];if(v>bv){bv=v;bi=j;}}
      if(bi!==0&&bi!==prev){em.push({c:m.chars[bi]||"",k});cs+=bv;cn++;}prev=bi;}
    // espaces entre les mots retrouvés d'après les écarts (le modèle les oublie souvent en majuscules)
    const gaps=[];for(let i=1;i<em.length;i++)if(em[i].c!==" "&&em[i-1].c!==" ")gaps.push(em[i].k-em[i-1].k);
    const med=gaps.length?gaps.slice().sort((a,b)=>a-b)[gaps.length>>1]:0;
    let txt="";em.forEach((e,i)=>{if(i&&med&&e.c!==" "&&em[i-1].c!==" "&&(e.k-em[i-1].k)>Math.max(med*1.9,med+2.5))txt+=" ";txt+=e.c;});
    // mot surtout en majuscules : tout en majuscules (« ABDl » → « ABDI », « zEmALA » → « ZEMALA »)
    txt=txt.replace(/\s+/g," ").trim().split(" ").map(w=>{const up=(w.match(/[A-ZÀ-Þ]/g)||[]).length,lo=(w.match(/[a-zß-ÿ]/g)||[]).length;return up>=3&&up>=lo*1.5?w.replace(/l/g,"I").toUpperCase():w;}).join(" ");
    if(!txt)return null;
    return {text:txt,confidence:cn?cs/cn*100:0,bbox:{x0:b.x0,y0:b.y0,x1:b.x1,y1:b.y1}};
  }
  // → {lines:[{text,confidence,bbox,words}], text} ; les zones d'une même ligne sont regroupées de gauche à droite
  async function paddle(src,opts){
    opts=opts||{};
    const cv=await toCanvas(src),m=await paddleLoad();
    const boxes=await paddleDetect(m,cv),parts=[];
    for(let i=0;i<boxes.length;i++){const r=await paddleRecognize(m,cv,boxes[i]);if(r&&r.confidence>=50)parts.push(r);if(opts.logger)opts.logger({status:"recognizing text",progress:(i+1)/boxes.length});}
    parts.sort((a,b)=>((a.bbox.y0+a.bbox.y1)/2)-((b.bbox.y0+b.bbox.y1)/2));
    const lines=[];
    parts.forEach(p=>{const cy=(p.bbox.y0+p.bbox.y1)/2,h=p.bbox.y1-p.bbox.y0;
      const l=lines.find(l=>Math.abs(l.cy-cy)<Math.max(h,l.h)*0.5);
      if(l){l.words.push(p);l.cy=(l.cy*l.words.length+cy)/(l.words.length+1);}else lines.push({cy,h,words:[p]});});
    const out=lines.map(l=>{l.words.sort((a,b)=>a.bbox.x0-b.bbox.x0);
      const bb={x0:Math.min(...l.words.map(w=>w.bbox.x0)),y0:Math.min(...l.words.map(w=>w.bbox.y0)),x1:Math.max(...l.words.map(w=>w.bbox.x1)),y1:Math.max(...l.words.map(w=>w.bbox.y1))};
      const len=l.words.reduce((a,w)=>a+w.text.length,0)||1;
      return {text:l.words.map(w=>w.text).join(" "),confidence:l.words.reduce((a,w)=>a+w.confidence*w.text.length,0)/len,bbox:bb,
        words:l.words.map(w=>({text:w.text,confidence:w.confidence,bbox:w.bbox}))};});
    out.sort((a,b)=>a.bbox.y0-b.bbox.y0);
    return {lines:out,text:out.map(l=>l.text).join("\n")};
  }
  async function pdfPageCanvas(page,dpi){
    const base=page.getViewport({scale:1}),scale=Math.min((dpi||300)/72,3600/Math.max(base.width,base.height)),vp=page.getViewport({scale});
    const c=document.createElement("canvas");c.width=Math.round(vp.width);c.height=Math.round(vp.height);
    const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);
    await page.render({canvasContext:x,viewport:vp}).promise;return c;
  }
  window.EGTPHOcr={recognize,prepare,pdfPageCanvas,worker,lib,paddle,paddleLoad};
})();
