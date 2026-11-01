/* EGTPH — scanner de documents partagé (façon CamScanner), sans Internet.
   1) détection automatique des bords ; 2) coins déplaçables, rotation ;
   3) redressement de perspective ; 4) filtres : Original · Magique (fond blanc, ombres retirées, couleurs des cachets gardées) · Gris · Noir & blanc.
   Toute photo choisie dans un <input type="file"> d'image passe par ici (sauf data-noscan),
   puis le programme reçoit l'image scannée comme s'il l'avait reçue directement.
   API : EGTPHScan.scanFile(file) → Promise<File|null> ; EGTPHScan.autoFile(file) ; EGTPHScan.scanImage(canvas) → Promise<{canvas}|null>. */
(function(){
  if(window.EGTPHScan)return;
  const AR=()=>/^ar/i.test(document.documentElement.lang||"")||document.documentElement.dir==="rtl";
  const T=k=>(AR()?I.ar:I.fr)[k]||k;
  const I={
    fr:{title:"Scanner le document",step2:"Choisir le rendu",auto:"🔍 Auto",full:"⬜ Image entière",next:"Suivant ➜",cancel:"Annuler",orig:"Garder la photo d’origine",save:"✓ Enregistrer",back:"↩ Coins",
      det:"Bords détectés — déplacez les coins si besoin",nodet:"Bords non détectés — placez les 4 coins",fOrig:"Original",fMagic:"✨ Magique",fGray:"Gris",fBw:"Noir & blanc",
      allAuto:"⚡ Auto pour les {n} suivantes",busy:"Traitement…"},
    ar:{title:"مسح الوثيقة",step2:"اختر شكل الوثيقة",auto:"🔍 تلقائي",full:"⬜ الصورة كاملة",next:"التالي ➜",cancel:"إلغاء",orig:"الاحتفاظ بالصورة الأصلية",save:"✓ حفظ",back:"↩ الزوايا",
      det:"تم اكتشاف حواف الورقة — حرّك الزوايا عند الحاجة",nodet:"لم تُكتشف الحواف — ضع الزوايا الأربع",fOrig:"الأصلية",fMagic:"✨ محسّنة",fGray:"رمادي",fBw:"أبيض وأسود",
      allAuto:"⚡ تلقائي للصور الـ {n} الباقية",busy:"جارٍ المعالجة…"}
  };
  const FKEY="egtph_scan_filter";
  const getF=()=>{try{return localStorage.getItem(FKEY)||"magic";}catch(e){return "magic";}};
  const setF=v=>{try{localStorage.setItem(FKEY,v);}catch(e){}};

  /* ---------- algorithmes ---------- */
  function gray(img,maxSide){
    const s=Math.min(1,maxSide/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*s)),h=Math.max(1,Math.round(img.height*s));
    const cv=document.createElement("canvas");cv.width=w;cv.height=h;const ctx=cv.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);
    const d=ctx.getImageData(0,0,w,h).data,g=new Uint8ClampedArray(w*h),sat=new Uint8ClampedArray(w*h);
    for(let i=0,j=0;i<d.length;i+=4,j++){const r=d[i],gg=d[i+1],b=d[i+2];g[j]=(r*299+gg*587+b*114)/1000;const mx=Math.max(r,gg,b),mn=Math.min(r,gg,b);sat[j]=mx?255*(mx-mn)/mx:0;}
    return {g,sat,w,h,s};
  }
  function box(a,w,h,r){
    const t=new Float32Array(w*h),o=new Uint8ClampedArray(w*h);
    for(let y=0;y<h;y++){let acc=0;const row=y*w;for(let x=-r;x<=r;x++)acc+=a[row+Math.min(w-1,Math.max(0,x))];
      for(let x=0;x<w;x++){t[row+x]=acc/(2*r+1);acc+=a[row+Math.min(w-1,x+r+1)]-a[row+Math.max(0,x-r)];}}
    for(let x=0;x<w;x++){let acc=0;for(let y=-r;y<=r;y++)acc+=t[Math.min(h-1,Math.max(0,y))*w+x];
      for(let y=0;y<h;y++){o[y*w+x]=acc/(2*r+1);acc+=t[Math.min(h-1,y+r+1)*w+x]-t[Math.max(0,y-r)*w+x];}}
    return o;
  }
  function morph(m,w,h,r,isMax){
    const t=new Uint8Array(w*h),o=new Uint8Array(w*h),f=isMax?1:0;
    for(let y=0;y<h;y++){const row=y*w;for(let x=0;x<w;x++){let v=1-f;for(let k=-r;k<=r;k++){const xx=x+k;if(xx<0||xx>=w)continue;if(m[row+xx]===f){v=f;break;}}t[row+x]=v;}}
    for(let x=0;x<w;x++){for(let y=0;y<h;y++){let v=1-f;for(let k=-r;k<=r;k++){const yy=y+k;if(yy<0||yy>=h)continue;if(t[yy*w+x]===f){v=f;break;}}o[y*w+x]=v;}}
    return o;
  }
  function largest(m,w,h){
    const lab=new Int32Array(w*h);let best=null,id=0;const q=new Int32Array(w*h);
    for(let i=0;i<w*h;i++){if(!m[i]||lab[i])continue;id++;let qh=0,qt=0;q[qt++]=i;lab[i]=id;
      let n=0,tl=[0,0,1e9],tr=[0,0,-1e9],br=[0,0,-1e9],bl=[0,0,1e9];
      while(qh<qt){const p=q[qh++],x=p%w,y=(p/w)|0;n++;
        const s1=x+y,s2=x-y;if(s1<tl[2])tl=[x,y,s1];if(s1>br[2])br=[x,y,s1];if(s2>tr[2])tr=[x,y,s2];if(s2<bl[2])bl=[x,y,s2];
        if(x>0){const k=p-1;if(m[k]&&!lab[k]){lab[k]=id;q[qt++]=k;}}if(x<w-1){const k=p+1;if(m[k]&&!lab[k]){lab[k]=id;q[qt++]=k;}}
        if(y>0){const k=p-w;if(m[k]&&!lab[k]){lab[k]=id;q[qt++]=k;}}if(y<h-1){const k=p+w;if(m[k]&&!lab[k]){lab[k]=id;q[qt++]=k;}}}
      if(!best||n>best.n)best={n,id,quad:[[tl[0],tl[1]],[tr[0],tr[1]],[br[0],br[1]],[bl[0],bl[1]]]};}
    if(best)best.lab=lab;
    return best;
  }
  function hull(pts){pts.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const lo=[],up=[];
    for(const p of pts){while(lo.length>=2&&cr(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p);}
    for(let i=pts.length-1;i>=0;i--){const p=pts[i];while(up.length>=2&&cr(up[up.length-2],up[up.length-1],p)<=0)up.pop();up.push(p);}
    up.pop();lo.pop();return lo.concat(up);}
  function area(q){let a=0;for(let i=0;i<4;i++){const [x1,y1]=q[i],[x2,y2]=q[(i+1)%4];a+=x1*y2-x2*y1;}return Math.abs(a)/2;}
  function bestQuad(hl){
    let best=null;
    for(let a=0;a<90;a+=1.5){const r=a*Math.PI/180,c=Math.cos(r),sn=Math.sin(r);let e=[null,null,null,null],v=[1e9,-1e9,-1e9,1e9];
      for(const p of hl){const x=p[0]*c+p[1]*sn,y=-p[0]*sn+p[1]*c,s1=x+y,s2=x-y;if(s1<v[0]){v[0]=s1;e[0]=p;}if(s2>v[1]){v[1]=s2;e[1]=p;}if(s1>v[2]){v[2]=s1;e[2]=p;}if(s2<v[3]){v[3]=s2;e[3]=p;}}
      const ar=area(e);if(!best||ar>best.ar)best={ar,q:e};}
    const q=best.q,sum=q.map(p=>p[0]+p[1]),dif=q.map(p=>p[0]-p[1]);
    return [q[sum.indexOf(Math.min(...sum))],q[dif.indexOf(Math.max(...dif))],q[sum.indexOf(Math.max(...sum))],q[dif.indexOf(Math.min(...dif))]];
  }
  function otsu(g){const h=new Float64Array(256);g.forEach(v=>h[v]++);let sum=0;for(let i=0;i<256;i++)sum+=i*h[i];let sB=0,wB=0,best=128,mx=-1;const tot=g.length;
    for(let t=0;t<256;t++){wB+=h[t];if(!wB)continue;const wF=tot-wB;if(!wF)break;sB+=t*h[t];const mB=sB/wB,mF=(sum-sB)/wF,v=wB*wF*(mB-mF)*(mB-mF);if(v>mx){mx=v;best=t;}}return best;}
  function detectQuad(img){
    const {g,sat,w,h,s}=gray(img,640),bl=box(g,w,h,2),tot=w*h,cands=[];
    const ot=otsu(bl);
    const masks=[Uint8Array.from(bl,(v,i)=>(v>Math.max(ot,90)&&sat[i]<70)?1:0),Uint8Array.from(bl,v=>v>ot?1:0),Uint8Array.from(bl,(v,i)=>(v<232||sat[i]>30)?1:0)];
    masks.forEach(m=>{
      let mm=morph(m,w,h,4,true);mm=morph(mm,w,h,4,false);mm=morph(mm,w,h,3,false);mm=morph(mm,w,h,3,true);
      const c=largest(mm,w,h);if(!c)return;
      const pts=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(c.lab[i]!==c.id)continue;if(x===0||y===0||x===w-1||y===h-1||c.lab[i-1]!==c.id||c.lab[i+1]!==c.id||c.lab[i-w]!==c.id||c.lab[i+w]!==c.id)pts.push([x,y]);}
      if(pts.length>=4)c.quad=bestQuad(hull(pts));
      const qa=area(c.quad),frac=qa/tot,rect=c.n/Math.max(1,qa);
      if(frac<0.18||frac>0.985||rect<0.82)return;
      cands.push({quad:c.quad,score:rect*2+Math.min(frac,0.9)*0.6});
    });
    if(!cands.length)return null;
    cands.sort((a,b)=>b.score-a.score);
    const q=cands[0].quad.map(([x,y])=>[x/s,y/s]),cx=q.reduce((a,p)=>a+p[0],0)/4,cy=q.reduce((a,p)=>a+p[1],0)/4;
    return q.map(([x,y])=>[Math.min(img.width,Math.max(0,cx+(x-cx)*1.012)),Math.min(img.height,Math.max(0,cy+(y-cy)*1.012))]);
  }
  function homography(src,dst){
    const A=[],B=[];
    for(let i=0;i<4;i++){const [x,y]=dst[i],[u,v]=src[i];A.push([x,y,1,0,0,0,-u*x,-u*y]);B.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);B.push(v);}
    for(let c=0;c<8;c++){let p=c;for(let r=c+1;r<8;r++)if(Math.abs(A[r][c])>Math.abs(A[p][c]))p=r;[A[c],A[p]]=[A[p],A[c]];[B[c],B[p]]=[B[p],B[c]];
      for(let r=0;r<8;r++){if(r===c)continue;const f=A[r][c]/A[c][c];for(let k=c;k<8;k++)A[r][k]-=f*A[c][k];B[r]-=f*B[c];}}
    return B.map((b,i)=>b/A[i][i]).concat([1]);
  }
  const srcCache=new WeakMap();
  function pixels(img){let c=srcCache.get(img);if(c)return c;const sv=document.createElement("canvas");sv.width=img.width;sv.height=img.height;const x=sv.getContext("2d",{willReadFrequently:true});x.drawImage(img,0,0);c=x.getImageData(0,0,img.width,img.height).data;srcCache.set(img,c);return c;}
  function warp(img,quad,maxSide){
    const d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
    let W=Math.max(d(quad[0],quad[1]),d(quad[3],quad[2])),H=Math.max(d(quad[0],quad[3]),d(quad[1],quad[2]));
    const sc=Math.min(maxSide/Math.max(W,H),2.2);W=Math.max(1,Math.round(W*sc));H=Math.max(1,Math.round(H*sc));
    const S=pixels(img),iw=img.width,ih=img.height;
    const Hm=homography(quad,[[0,0],[W,0],[W,H],[0,H]]);
    const out=document.createElement("canvas");out.width=W;out.height=H;const octx=out.getContext("2d");const od=octx.createImageData(W,H),O=od.data;
    for(let y=0;y<H;y++){for(let x=0;x<W;x++){
      const z=Hm[6]*x+Hm[7]*y+1,u=(Hm[0]*x+Hm[1]*y+Hm[2])/z,v=(Hm[3]*x+Hm[4]*y+Hm[5])/z;
      let x0=Math.floor(u),y0=Math.floor(v);const fx=u-x0,fy=v-y0;x0=Math.min(iw-2,Math.max(0,x0));y0=Math.min(ih-2,Math.max(0,y0));
      const i00=(y0*iw+x0)*4,i10=i00+4,i01=i00+iw*4,i11=i01+4,o=(y*W+x)*4;
      for(let c=0;c<3;c++)O[o+c]=(S[i00+c]*(1-fx)+S[i10+c]*fx)*(1-fy)+(S[i01+c]*(1-fx)+S[i11+c]*fx)*fy;
      O[o+3]=255;}}
    octx.putImageData(od,0,0);return out;
  }
  function copy(img,maxSide){const s=Math.min(1,(maxSide||1e9)/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.imageSmoothingQuality="high";x.drawImage(img,0,0,c.width,c.height);return c;}
  // fond (ombres, teinte du papier) retiré ; couleurs des cachets conservées
  function clean(cv){
    const W=cv.width,H=cv.height,ctx=cv.getContext("2d",{willReadFrequently:true}),id=ctx.getImageData(0,0,W,H),D=id.data;
    const k=Math.max(8,Math.round(Math.max(W,H)/90)),sw=Math.max(4,Math.ceil(W/k)),sh=Math.max(4,Math.ceil(H/k));
    const sm=document.createElement("canvas");sm.width=sw;sm.height=sh;const sctx=sm.getContext("2d",{willReadFrequently:true});sctx.imageSmoothingQuality="high";sctx.drawImage(cv,0,0,sw,sh);
    const sd=sctx.getImageData(0,0,sw,sh).data,bg=[0,1,2].map(c=>{let a=new Uint8ClampedArray(sw*sh);for(let i=0;i<sw*sh;i++)a[i]=sd[i*4+c];
      for(let it=0;it<3;it++){const b=new Uint8ClampedArray(sw*sh);for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){let m=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=sw||yy>=sh)continue;const v=a[yy*sw+xx];if(v>m)m=v;}b[y*sw+x]=m;}a=b;}
      return box(a,sw,sh,2);});
    const lo=35,hi=232,lut=new Uint8ClampedArray(256);for(let v=0;v<256;v++){const n=Math.min(1,Math.max(0,(v-lo)/(hi-lo)));lut[v]=Math.round(Math.pow(n,1.25)*255);}
    for(let y=0;y<H;y++){const fy=Math.min(sh-1.001,Math.max(0,(y+.5)/k-.5)),y0=fy|0,ty=fy-y0;
      for(let x=0;x<W;x++){const fx=Math.min(sw-1.001,Math.max(0,(x+.5)/k-.5)),x0=fx|0,tx=fx-x0,i0=y0*sw+x0,o=(y*W+x)*4;
        for(let c=0;c<3;c++){const B=bg[c],b=(B[i0]*(1-tx)+B[i0+1]*tx)*(1-ty)+(B[i0+sw]*(1-tx)+B[i0+sw+1]*tx)*ty;D[o+c]=lut[Math.min(255,Math.round(D[o+c]/Math.max(b,1)*255))];}}}
    ctx.putImageData(id,0,0);return cv;
  }
  function sharpen(cv,a){
    const W=cv.width,H=cv.height,ctx=cv.getContext("2d",{willReadFrequently:true}),id=ctx.getImageData(0,0,W,H),d=id.data,s=new Uint8ClampedArray(d);
    for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const k=(y*W+x)*4;for(let c=0;c<3;c++){const v=s[k+c],bl=(s[k-4+c]+s[k+4+c]+s[k-W*4+c]+s[k+W*4+c])/4;d[k+c]=v+a*(v-bl);}}
    ctx.putImageData(id,0,0);return cv;
  }
  function toGray(cv,bw){
    const ctx=cv.getContext("2d",{willReadFrequently:true}),id=ctx.getImageData(0,0,cv.width,cv.height),d=id.data;
    for(let i=0;i<d.length;i+=4){let v=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000;
      if(bw){v=v<150?0:v>200?255:Math.round((v-150)/50*255);}
      d[i]=d[i+1]=d[i+2]=v;}
    ctx.putImageData(id,0,0);return cv;
  }
  function render(img,quad,filter,maxSide){
    const cv=quad?warp(img,quad,maxSide):copy(img,maxSide);
    if(filter==="magic"){clean(cv);sharpen(cv,0.35);}
    else if(filter==="gray"){clean(cv);toGray(cv,false);sharpen(cv,0.35);}
    else if(filter==="bw"){clean(cv);toGray(cv,true);}
    return cv;
  }
  function rotate(img,dir){const cv=document.createElement("canvas");cv.width=img.height;cv.height=img.width;const c=cv.getContext("2d");c.translate(cv.width/2,cv.height/2);c.rotate(dir*Math.PI/2);c.drawImage(img,-img.width/2,-img.height/2);return cv;}
  async function loadFile(file){
    let bmp;try{bmp=await createImageBitmap(file);}catch(e){
      bmp=await new Promise((res,rej)=>{const u=URL.createObjectURL(file),im=new Image();im.onload=()=>{URL.revokeObjectURL(u);res(im);};im.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("decode"));};im.src=u;});}
    const w=bmp.naturalWidth||bmp.width,h=bmp.naturalHeight||bmp.height,s=Math.min(1,3600/Math.max(w,h)),c=document.createElement("canvas");
    c.width=Math.round(w*s);c.height=Math.round(h*s);const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.imageSmoothingQuality="high";x.drawImage(bmp,0,0,c.width,c.height);
    try{bmp.close&&bmp.close();}catch(e){}
    return c;
  }
  const toBlob=(cv,q)=>new Promise(r=>cv.toBlob(r,"image/jpeg",q||0.92));
  const outName=f=>String(f.name||"document").replace(/\.[a-z0-9]+$/i,"")+"_scan.jpg";

  /* ---------- interface ---------- */
  function css(){
    if(document.getElementById("egtph-scan-css"))return;
    const st=document.createElement("style");st.id="egtph-scan-css";
    st.textContent=`.egs-ui{position:fixed;inset:0;background:#0c1c21;z-index:2147483000;display:flex;flex-direction:column;padding:10px 10px calc(10px + env(safe-area-inset-bottom));font:14px system-ui,-apple-system,Segoe UI,Tahoma,sans-serif;color:#fff}
.egs-bar{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:4px 4px 8px}.egs-bar small{color:#c7d2cd;font-size:12px}
.egs-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}.egs-stage canvas{touch-action:none;max-width:100%;max-height:100%;background:#fff}
.egs-tools{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding-top:8px;align-items:center}
.egs-ui button{font:inherit;border-radius:10px;padding:9px 14px;border:1px solid #c8a86a;background:transparent;color:#fff;cursor:pointer}
.egs-ui button.on,.egs-ui button.pri{background:#c8a86a;color:#111;font-weight:700}.egs-ui button.gr{border-color:#667}
.egs-ui button:disabled{opacity:.5}`;
    document.head.appendChild(st);
  }
  // remaining : nombre de photos encore à traiter (bouton « auto pour les suivantes »)
  function ui(src,remaining){
    css();
    return new Promise(resolve=>{
      let img=src,q0=detectQuad(img),auto=!!q0,quad=q0||[[0,0],[img.width,0],[img.width,img.height],[0,img.height]],filter=getF(),step=1,prev=null;
      const el=document.createElement("div");el.className="egs-ui";el.setAttribute("dir",AR()?"rtl":"ltr");
      document.body.appendChild(el);
      let cv,ctx,sc=1,drag=-1;
      const finish=v=>{window.removeEventListener("resize",fit);el.remove();resolve(v);};
      function fit(){if(!cv)return;const st=el.querySelector(".egs-stage"),mw=st.clientWidth-8,mh=st.clientHeight-8,im=step===1?img:prev;if(!im)return;sc=Math.min(mw/im.width,mh/im.height);cv.width=Math.max(1,Math.round(im.width*sc));cv.height=Math.max(1,Math.round(im.height*sc));draw();}
      function draw(){
        ctx.clearRect(0,0,cv.width,cv.height);
        if(step===2){ctx.drawImage(prev,0,0,cv.width,cv.height);return;}
        ctx.drawImage(img,0,0,cv.width,cv.height);
        ctx.fillStyle="rgba(0,0,0,.45)";ctx.beginPath();ctx.rect(0,0,cv.width,cv.height);const p=quad.map(([x,y])=>[x*sc,y*sc]);ctx.moveTo(p[0][0],p[0][1]);for(let i=3;i>=0;i--)ctx.lineTo(p[i][0],p[i][1]);ctx.closePath();ctx.fill("evenodd");
        ctx.strokeStyle="#c8a86a";ctx.lineWidth=3;ctx.beginPath();p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.stroke();
        p.forEach(([x,y])=>{ctx.beginPath();ctx.arc(x,y,13,0,7);ctx.fillStyle="rgba(200,168,106,.35)";ctx.fill();ctx.lineWidth=3;ctx.strokeStyle="#fff";ctx.stroke();});
      }
      function preview(){prev=render(img,quad,filter,1100);fit();}
      function build(){
        const extra=remaining>0?`<button data-a="all" class="gr">${T("allAuto").replace("{n}",remaining)}</button>`:"";
        el.innerHTML=step===1
          ?`<div class="egs-bar"><b>${T("title")}</b><small>${auto?T("det"):T("nodet")}</small></div><div class="egs-stage"><canvas></canvas></div>
            <div class="egs-tools"><button data-a="l">⟲</button><button data-a="r">⟳</button><button data-a="auto">${T("auto")}</button><button data-a="full">${T("full")}</button></div>
            <div class="egs-tools"><button data-a="cancel" class="gr">${T("cancel")}</button><button data-a="orig">${T("orig")}</button>${extra}<button data-a="next" class="pri">${T("next")}</button></div>`
          :`<div class="egs-bar"><b>${T("step2")}</b></div><div class="egs-stage"><canvas></canvas></div>
            <div class="egs-tools">${[["orig","fOrig"],["magic","fMagic"],["gray","fGray"],["bw","fBw"]].map(([k,l])=>`<button data-f="${k}" class="${k===filter?"on":""}">${T(l)}</button>`).join("")}</div>
            <div class="egs-tools"><button data-a="back" class="gr">${T("back")}</button><button data-a="l">⟲</button><button data-a="r">⟳</button>${extra}<button data-a="save" class="pri">${T("save")}</button></div>`;
        cv=el.querySelector("canvas");ctx=cv.getContext("2d");
        if(step===1){
          const pos=ev=>{const r=cv.getBoundingClientRect();return [(ev.clientX-r.left)/sc,(ev.clientY-r.top)/sc];};
          cv.addEventListener("pointerdown",ev=>{const [x,y]=pos(ev);let bi=-1,bd=1e9;quad.forEach(([qx,qy],i)=>{const dd=Math.hypot(qx-x,qy-y)*sc;if(dd<bd){bd=dd;bi=i;}});if(bd<48){drag=bi;cv.setPointerCapture(ev.pointerId);}});
          cv.addEventListener("pointermove",ev=>{if(drag<0)return;const [x,y]=pos(ev);quad[drag]=[Math.min(img.width,Math.max(0,x)),Math.min(img.height,Math.max(0,y))];draw();});
          cv.addEventListener("pointerup",()=>{drag=-1;});cv.addEventListener("pointercancel",()=>{drag=-1;});
        }
        el.querySelectorAll("[data-f]").forEach(b=>b.onclick=()=>{filter=b.dataset.f;setF(filter);el.querySelectorAll("[data-f]").forEach(x=>x.classList.toggle("on",x===b));setTimeout(preview,10);});
        el.querySelectorAll("[data-a]").forEach(b=>b.onclick=()=>{
          const a=b.dataset.a;
          if(a==="l"||a==="r"){
            if(step===1){img=rotate(img,a==="l"?-1:1);const q=detectQuad(img);auto=!!q;quad=q||[[0,0],[img.width,0],[img.width,img.height],[0,img.height]];build();requestAnimationFrame(fit);}
            else{img=rotate(img,a==="l"?-1:1);const q=detectQuad(img);quad=q||[[0,0],[img.width,0],[img.width,img.height],[0,img.height]];preview();}
          }
          else if(a==="auto"){const q=detectQuad(img);auto=!!q;if(q)quad=q;build();requestAnimationFrame(fit);}
          else if(a==="full"){quad=[[0,0],[img.width,0],[img.width,img.height],[0,img.height]];auto=false;build();requestAnimationFrame(fit);}
          else if(a==="cancel")finish(null);
          else if(a==="orig")finish({original:true});
          else if(a==="next"){b.disabled=true;b.textContent=T("busy");setTimeout(()=>{step=2;build();preview();},20);}
          else if(a==="back"){step=1;build();requestAnimationFrame(fit);}
          else if(a==="save"||a==="all"){b.disabled=true;b.textContent=T("busy");setTimeout(()=>finish({canvas:render(img,quad,filter,3000),all:a==="all",filter}),30);}
        });
      }
      window.addEventListener("resize",fit);build();requestAnimationFrame(fit);
    });
  }
  async function scanImage(src,remaining){return ui(src,remaining||0);}
  async function autoCanvas(src){const q=detectQuad(src);return render(src,q,getF()==="orig"?"magic":getF(),3000);}
  async function scanFile(file,remaining){
    let src;try{src=await loadFile(file);}catch(e){return {file};} // format non lisible ici (ex. HEIC) : fichier d'origine
    const r=await ui(src,remaining||0);
    if(!r)return null;
    if(r.original)return {file};
    return {file:new File([await toBlob(r.canvas)],outName(file),{type:"image/jpeg",lastModified:Date.now()}),all:r.all};
  }
  async function autoFile(file){
    let src;try{src=await loadFile(file);}catch(e){return file;}
    return new File([await toBlob(await autoCanvas(src))],outName(file),{type:"image/jpeg",lastModified:Date.now()});
  }

  /* ---------- branchement automatique sur les champs « fichier » ---------- */
  const isImg=f=>/^image\//i.test(f.type||"")||/\.(jpe?g|png|webp|bmp|heic|heif)$/i.test(f.name||"");
  const acceptsImg=inp=>{const a=(inp.getAttribute("accept")||"").toLowerCase();return !a||/image|\.jpe?g|\.png|\.webp/.test(a);};
  async function onChange(ev){
    const inp=ev.target;
    if(!inp||inp.tagName!=="INPUT"||inp.type!=="file")return;
    if(inp.__egsPass){inp.__egsPass=false;return;}
    if(window.EGTPH_SCAN_OFF||inp.hasAttribute("data-noscan")||inp.closest("[data-noscan]")||!acceptsImg(inp))return;
    const files=[...(inp.files||[])];if(!files.some(isImg))return;
    ev.stopImmediatePropagation();ev.preventDefault();
    const out=[];let allAuto=false;const imgs=files.filter(isImg).length;let done=0;
    for(const f of files){
      if(!isImg(f)){out.push(f);continue;}
      done++;
      if(allAuto){try{out.push(await autoFile(f));}catch(e){out.push(f);}continue;}
      let r;try{r=await scanFile(f,imgs-done);}catch(e){console.warn("[scan]",e);r={file:f};}
      if(r===null)continue;            // annulée
      out.push(r.file);if(r.all)allAuto=true;
    }
    try{const dt=new DataTransfer();out.forEach(f=>dt.items.add(f));inp.files=dt.files;}
    catch(e){console.warn("[scan] remplacement impossible",e);}
    if(!out.length){try{inp.value="";}catch(e){}return;}
    inp.__egsPass=true;
    inp.dispatchEvent(new Event("change",{bubbles:true}));
  }
  window.addEventListener("change",onChange,true);
  window.EGTPHScan={scanFile,autoFile,scanImage,detectQuad,warp,clean,render,loadFile};
})();
