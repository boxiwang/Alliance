// Canvas FX ported from docs/mockups/city-fx-claude.html (#claude-fx).
// Keep all rings, ticks, buildings and trajectories in the same measured pixel space.
import { prodPerHour, type GameState, type BKey } from "./game";
import type { LiveMarch } from "./realtime";
import type { GraphicsQuality } from "./graphics-tier";

export type CityFxState = { view: GameState; marches: LiveMarch[]; quality: GraphicsQuality };
export const CITY_DISTRICTS = [
  {label:"ECONOMY",color:"#e8b24c",ids:["bank","oilwell","powerplant","storage"],q:-45,step:19},
  {label:"MILITARY",color:"#ff8a5c",ids:["armyCamp","navalBase","airfield"],q:45,step:24},
  {label:"BASTION",color:"#5fc8ff",ids:["embassy","wall","hospital"],q:135,step:24},
  {label:"INTEL · SCIENCE",color:"#aa82ff",ids:["milestone","watchtower","academy"],q:-135,step:24}
];
export function cityQueue(view: GameState, id: string) {
  if(id==="academy"&&view.researchQueue.finishAt>0)return view.researchQueue;
  if(id==="hospital"&&view.healing.finishAt>0)return view.healing;
  const arm=id==="armyCamp"?"army":id==="navalBase"?"navy":id==="airfield"?"air":null;
  if(arm&&view.training[arm].finishAt>0){const q=view.training[arm];return{finishAt:q.finishAt,durationSec:q.per*q.qty};}
  return view.buildings[id as BKey];
}
export function mountCityFx(map: HTMLDivElement, core: HTMLButtonElement, cv: HTMLCanvasElement, getState:()=>CityFxState) {
  const ctx=cv.getContext("2d");if(!ctx)return()=>{};
  const districts=CITY_DISTRICTS,districtOf:Record<string,typeof CITY_DISTRICTS[number]>={};
  districts.forEach(d=>d.ids.forEach(id=>districtOf[id]=d));
  const flows=[
    {id:"bank",color:"#43f2a1",res:"cash",offset:0},
    {id:"oilwell",color:"#ffb454",res:"oil",offset:2.7},
    {id:"powerplant",color:"#38d9ff",res:"power",offset:5.4}
  ];
  let W=0,H=0,dpr=1,G:any=null,raf=0,last=0,disposed=false;
  const t0=performance.now(),PHI=-7*Math.PI/180,cosP=Math.cos(PHI),sinP=Math.sin(PHI);
  function ell(e,t){const x=e.a*Math.cos(t),y=e.b*Math.sin(t);return[e.cx+x*cosP-y*sinP,e.cy+x*sinP+y*cosP];}
  function measure(){
    W=map.clientWidth;H=map.clientHeight;if(!W||!H){G=null;return;}
    dpr=Math.min(2,devicePixelRatio||1,getState().quality.dprCap);cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);
    const outer={cx:W*.5,cy:H*.45,a:W*.44,b:H*.35},inner={cx:W*.5,cy:H*.45,a:W*.28,b:H*.225};
    const rad=Math.PI/180,nodes:Record<string,any>={};
    districts.forEach(d=>d.ids.forEach((id,i)=>{
      const el=map.querySelector<HTMLButtonElement>('[data-id="'+id+'"]');if(!el)return;
      const t=(d.q+(i-(d.ids.length-1)/2)*d.step)*rad,[x,y]=ell(outer,t);
      // Buttons use translate(-50%,-50%); their left/top are their centers.
      el.style.left=x+"px";el.style.top=y+"px";
      el.style.setProperty("--fx-depth",(0.86+0.24*Math.max(0,Math.min(1,y/H))).toFixed(3));
      nodes[id]={el,x,y,w:el.offsetWidth,h:el.offsetHeight};
    }));
    const c={x:W*.5,y:H*.45,r:core.offsetWidth/2};
    const arcs=districts.map(d=>({...d,e:outer,t0:(d.q-42)*rad,t1:(d.q+42)*rad,tl:d.q*rad}));
    const paths=flows.map(f=>{const n=nodes[f.id];if(!n)return null;const dx=c.x-n.x,dy=c.y-n.y,len=Math.hypot(dx,dy);return{...f,x0:n.x,y0:n.y,cx:(n.x+c.x)/2-dy*.18,cy:(n.y+c.y)/2+dx*.18,x1:c.x,y1:c.y,len};}).filter(Boolean);
    G={c,nodes,outer,inner,arcs,paths};packets.length=0;emits.length=0;hits.length=0;
  }
  const bez=(p,t)=>{const u=1-t;return[u*u*p.x0+2*u*t*p.cx+t*t*p.x1,u*u*p.y0+2*u*t*p.cy+t*t*p.y1];};
  const CYCLE=8,TRAVEL=1.9,packets:any[]=[],emits:any[]=[],hits:any[]=[];
  const lastCycle=flows.map(()=>-1);
  const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    function schedule(T){if(!G)return;const view=getState().view,production=prodPerHour(view);G.paths.forEach((p,i)=>{if(view.buildings[p.id].lvl<1||production[p.res]<=0)return;const k=Math.floor((T-p.offset)/CYCLE);if(T>=p.offset&&k>lastCycle[i]){lastCycle[i]=k;packets.push({p,start:T});emits.push({x:p.x0,y:p.y0,color:p.color,start:T})}})}

  function land(p,T){const c=G.c,ang=Math.atan2(p.y1-p.cy,p.x1-p.cx)+Math.PI;hits.push({ang,color:p.color,start:T});}
  const F='"Chakra Petch",sans-serif';
  const bearing=id=>{let h=0;for(const ch of String(id))h=(h*31+ch.charCodeAt(0))|0;return((h>>>0)%360)*Math.PI/180;};
    function strokeEll(e,t0,t1,steps){ctx.beginPath();for(let i=0;i<=steps;i++){const[x,y]=ell(e,t0+(t1-t0)*i/steps);i?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke()}
  function brackets(x,y,w,h,s,color,a){ctx.strokeStyle=color;ctx.globalAlpha=a;ctx.lineWidth=1.5;const L=7;[[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([sx,sy])=>{const bx=x+sx*w/2,by=y+sy*h/2;ctx.beginPath();ctx.moveTo(bx-sx*L*s,by);ctx.lineTo(bx,by);ctx.lineTo(bx,by-sy*L*s);ctx.stroke()});ctx.globalAlpha=1}


  function frame(now){
    if(disposed||document.hidden)return;
    const {view,marches,quality}=getState(),still=!quality.fallbackAnim||quality.tier==="low";
    // Low/reduced-motion redraws only for data updates; high retains Claude's full geometry.
    const interval=still?500:1000/Math.min(30,quality.frameHz);
    if(now-last<interval){raf=requestAnimationFrame(frame);return;}last=now;
    if(!G){raf=requestAnimationFrame(frame);return;}
    const T=still?0:(now-t0)/1000,nowMs=Date.now();
    const {c,outer,inner,arcs}=G;
    const nodes:Record<string,any>=G.nodes;
    const production=prodPerHour(view);
    const paths=G.paths.filter(p=>production[p.res]>0&&view.buildings[p.id].lvl>0);
    const rings:Record<string,any>={};
    Object.keys(nodes).forEach(id=>{if(cityQueue(view,id).finishAt>nowMs)rings[id]={ring:districtOf[id].color};});
    const queues=Object.keys(rings),threats=new Map(marches.filter(m=>m.arriveAt>nowMs).map(m=>[m.id,m]));
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);ctx.globalAlpha=1;ctx.setLineDash([]);ctx.lineDashOffset=0;
        // outer ring ticks + scanning head
    ctx.strokeStyle='rgba(125,157,199,.16)';ctx.lineWidth=1;
    for(let i=0;i<120;i++){const t=i/120*Math.PI*2,[x,y]=ell(outer,t),k=i%10===0?7:3,dx=x-outer.cx,dy=y-outer.cy,l=Math.hypot(dx,dy);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx/l*k,y+dy/l*k);ctx.stroke()}
    if(!still){const head=T*.22;for(let i=0;i<24;i++){ctx.strokeStyle=`rgba(56,217,255,${(.5*(1-i/24)).toFixed(3)})`;ctx.lineWidth=2;strokeEll(outer,head-(i+1)*.02,head-i*.02,2)}}

    // quadrant wedges, dividers, arcs, labels
    arcs.forEach(d=>{ctx.beginPath();for(let i=0;i<=32;i++){const[x,y]=ell(outer,d.t0+(d.t1-d.t0)*i/32);i?ctx.lineTo(x,y):ctx.moveTo(x,y)}for(let i=32;i>=0;i--){const[x,y]=ell(inner,d.t0+(d.t1-d.t0)*i/32);ctx.lineTo(x,y)}ctx.closePath();ctx.fillStyle=d.color;ctx.globalAlpha=.022;ctx.fill();ctx.globalAlpha=1;
      ctx.save();ctx.strokeStyle=d.color;ctx.lineWidth=2.4;ctx.globalAlpha=.5;ctx.shadowColor=d.color;ctx.shadowBlur=quality.blur?10:0;ctx.lineCap='round';strokeEll(outer,d.t0,d.t1,48);ctx.restore();
      const[lx,ly]=ell(inner,d.tl);ctx.font=`600 8.5px ${F}`;ctx.letterSpacing='2.5px';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=d.color;ctx.globalAlpha=.75;ctx.fillText(`${d.label} · ${d.ids.length}`,lx,ly);ctx.globalAlpha=1;ctx.letterSpacing='0px'});
    ctx.setLineDash([2,4]);ctx.strokeStyle='rgba(140,170,210,.22)';ctx.lineWidth=1;
    [0,90,180,270].forEach(deg=>{const t=deg*Math.PI/180,[x0,y0]=ell(inner,t),[x1,y1]=ell(outer,t);ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke()});
    ctx.setLineDash([]);

    // node pedestals (ground glow)
    for(const id in nodes){const n=nodes[id],d=districtOf[id];if(!d)continue;const s=+n.el.style.getPropertyValue('--fx-depth')||1,gy=n.y+n.h*.5*s+5,g=ctx.createRadialGradient(n.x,gy,0,n.x,gy,n.w*.75*s);g.addColorStop(0,d.color+'38');g.addColorStop(1,d.color+'00');ctx.fillStyle=g;ctx.save();ctx.translate(n.x,gy);ctx.scale(1,.22);ctx.beginPath();ctx.arc(0,0,n.w*.75*s,0,Math.PI*2);ctx.restore();ctx.fill()}

    // queue links core -> busy buildings
    ctx.setLineDash([3,6]);ctx.lineDashOffset=still?0:-T*22;ctx.lineWidth=1.2;
    queues.forEach(id=>{const n=nodes[id],r=rings[id];if(!n||!r)return;const dx=n.x-c.x,dy=n.y-c.y,l=Math.hypot(dx,dy),sx=c.x+dx/l*(c.r+8),sy=c.y+dy/l*(c.r+8),ex=n.x-dx/l*(n.w*.72),ey=n.y-dy/l*(n.w*.72);ctx.strokeStyle=r.ring;ctx.globalAlpha=.45;ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke()});
    ctx.setLineDash([]);ctx.globalAlpha=1;

    // resource routes: permanent hairlines, lit only while a packet travels
    paths.forEach(p=>{ctx.strokeStyle=p.color;ctx.globalAlpha=still?.22:.06;ctx.lineWidth=1;if(still)ctx.setLineDash([2,5]);ctx.beginPath();ctx.moveTo(p.x0,p.y0);ctx.quadraticCurveTo(p.cx,p.cy,p.x1,p.y1);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1});
    if(!still){schedule(T);
      // launch: a thin ring leaves the building
      for(let i=emits.length-1;i>=0;i--){const e=emits[i],a=(T-e.start)/.6;if(a>=1){emits.splice(i,1);continue}const n=Object.values(nodes).find(n=>n.x===e.x&&n.y===e.y);const r0=n?n.w*.62:30;ctx.strokeStyle=e.color;ctx.globalAlpha=.45*(1-a);ctx.lineWidth=1;ctx.beginPath();ctx.arc(e.x,e.y,r0+a*12,0,Math.PI*2);ctx.stroke()}
      ctx.globalAlpha=1;ctx.globalCompositeOperation='lighter';
      for(let i=packets.length-1;i>=0;i--){const k=packets[i],u=(T-k.start)/TRAVEL,p=k.p;
        if(u>=1.45){packets.splice(i,1);continue}
        if(u>=1&&!k.landed){k.landed=true;land(p,T)}
        const head=ease(Math.min(1,u)),stop=1-(c.r*.9)/p.len;
        // route reveal behind the head, fading out after arrival
        const reveal=u<1?.16:.16*(1-(u-1)/.45);ctx.strokeStyle=p.color;ctx.globalAlpha=Math.max(0,reveal);ctx.lineWidth=1;ctx.beginPath();for(let s2=0;s2<=24;s2++){const[x,y]=bez(p,Math.min(head,stop)*s2/24);s2?ctx.lineTo(x,y):ctx.moveTo(x,y)}ctx.stroke();
        if(u>=1||head>stop)continue;
        // tapered comet streak
        const tail=Math.max(0,head-.2);ctx.lineCap='round';for(let s2=0;s2<14;s2++){const ta=tail+(head-tail)*s2/14,tb=tail+(head-tail)*(s2+1)/14,[x0,y0]=bez(p,ta),[x1,y1]=bez(p,tb),w=s2/14;ctx.strokeStyle=p.color;ctx.globalAlpha=w*w*.9;ctx.lineWidth=.5+w*2.3;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke()}ctx.lineCap='butt';
        const[hx,hy]=bez(p,head);ctx.globalAlpha=1;ctx.shadowColor=p.color;ctx.shadowBlur=quality.blur?14:0;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(hx,hy,2.9,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(hx,hy,1.3,0,Math.PI*2);ctx.fill()}
      // arrival: short arc lights on the core rim where the packet entered
      for(let i=hits.length-1;i>=0;i--){const h=hits[i],a=(T-h.start)/.9;if(a>=1){hits.splice(i,1);continue}const r=c.r+3,sp=.18+a*.35;ctx.strokeStyle=h.color;ctx.globalAlpha=.8*(1-a);ctx.lineWidth=2.2*(1-a)+.6;ctx.shadowColor=h.color;ctx.shadowBlur=quality.blur?10:0;ctx.beginPath();ctx.arc(c.x,c.y,r,h.ang-sp,h.ang+sp);ctx.stroke();ctx.shadowBlur=0}
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over'}

    // shield dome (hex lattice, shimmer band)
    ctx.save();const R=c.r+34;ctx.beginPath();ctx.arc(c.x,c.y,R,0,Math.PI*2);ctx.clip();
    const band=still?0:(T*.5)%2-.5;ctx.strokeStyle='#8fb0ff';ctx.lineWidth=.8;const hs=11,hw=hs*Math.sqrt(3);
    for(let row=-8;row<=8;row++)for(let col=-8;col<=8;col++){const hx=c.x+col*hw+(row&1?hw/2:0),hy=c.y+row*hs*1.5,dd=Math.hypot(hx-c.x,hy-c.y)/R;if(dd>1.05||dd<(c.r+4)/R)continue;const sweep=still?0:Math.max(0,1-Math.abs((hy-c.y)/R-band*1.4)*3);ctx.globalAlpha=(.05+.22*Math.pow(dd,3))*(1+sweep*2.2);ctx.beginPath();for(let k=0;k<6;k++){const a=Math.PI/6+k*Math.PI/3;ctx.lineTo(hx+Math.cos(a)*hs*.92,hy+Math.sin(a)*hs*.92)}ctx.closePath();ctx.stroke()}
    ctx.restore();ctx.globalAlpha=.35;ctx.strokeStyle='#8fb0ff';ctx.lineWidth=1;ctx.beginPath();ctx.arc(c.x,c.y,R,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;

    // core upgrade progress ring
    const coreQueue=view.buildings.keep,coreTotal=(coreQueue.durationSec||0)*1000;
    const frac=coreTotal>0&&coreQueue.finishAt>nowMs?Math.max(0,Math.min(1,1-(coreQueue.finishAt-nowMs)/coreTotal)):0,rr=c.r+11,a0=-Math.PI/2;
    ctx.lineWidth=3;ctx.strokeStyle='rgba(140,170,210,.12)';ctx.beginPath();ctx.arc(c.x,c.y,rr,0,Math.PI*2);ctx.stroke();
    if(coreQueue.finishAt>nowMs&&coreTotal>0){
    const cg=ctx.createConicGradient?ctx.createConicGradient(a0,c.x,c.y):null;if(cg){cg.addColorStop(0,'#38d9ff');cg.addColorStop(.9,'#aa82ff');cg.addColorStop(1,'#aa82ff')}
    ctx.strokeStyle=cg||'#38d9ff';ctx.shadowColor='#7fb8ff';ctx.shadowBlur=quality.blur?10:0;ctx.lineCap='round';ctx.beginPath();ctx.arc(c.x,c.y,rr,a0,a0+frac*Math.PI*2);ctx.stroke();ctx.shadowBlur=0;ctx.lineCap='butt';
    const ha=a0+frac*Math.PI*2;ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(c.x+Math.cos(ha)*rr,c.y+Math.sin(ha)*rr,2.6+(still?0:Math.sin(T*6)*.6),0,Math.PI*2);ctx.fill();
    }
    ctx.strokeStyle='rgba(160,190,230,.22)';ctx.lineWidth=1;for(let i=0;i<72;i++){const a=i/72*Math.PI*2+(still?0:T*.05),r1=rr+6,r2=rr+(i%6?8:11);ctx.beginPath();ctx.moveTo(c.x+Math.cos(a)*r1,c.y+Math.sin(a)*r1);ctx.lineTo(c.x+Math.cos(a)*r2,c.y+Math.sin(a)*r2);ctx.stroke()}

    // selection beam + brackets
    const sel=map.querySelector<HTMLElement>('.selected');
    if(sel===core){ctx.save();ctx.translate(c.x,c.y);ctx.rotate(still?0:T*.25);ctx.strokeStyle='#38d9ff';ctx.globalAlpha=.55;ctx.lineWidth=1.5;for(let k=0;k<4;k++){ctx.beginPath();ctx.arc(0,0,c.r+46,k*Math.PI/2-.22,k*Math.PI/2+.22);ctx.stroke()}ctx.restore();ctx.globalAlpha=1}
    else if(sel&&nodes[sel.dataset.id]){const n=nodes[sel.dataset.id],s=+n.el.style.getPropertyValue('--fx-depth')||1,dx=c.x-n.x,dy=c.y-n.y,l=Math.hypot(dx,dy),sx=n.x+dx/l*n.w*.6,sy=n.y+dy/l*n.w*.6,ex=c.x-dx/l*(c.r+14),ey=c.y-dy/l*(c.r+14);
      const g=ctx.createLinearGradient(sx,sy,ex,ey);g.addColorStop(0,'rgba(56,217,255,.7)');g.addColorStop(1,'rgba(56,217,255,.05)');ctx.strokeStyle=g;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(ex,ey);ctx.stroke();
      if(!still)for(let k=0;k<3;k++){const f=((T*.8+k/3)%1);ctx.fillStyle='#bff3ff';ctx.globalAlpha=.9*(1-f);ctx.beginPath();ctx.arc(sx+(ex-sx)*f,sy+(ey-sy)*f,1.8,0,Math.PI*2);ctx.fill()}ctx.globalAlpha=1;
      const b=still?1:1+Math.sin(T*4)*.06;brackets(n.x,n.y,(n.w+18)*s*b,(n.h+18)*s*b,1,'#38d9ff',.9)}

    // incoming attacks: one trajectory per march, progress from server departAt/arriveAt
    
    threats.forEach(m=>{const span=Math.max(1,m.arriveAt-m.departAt),f=Math.max(0,Math.min(1,(nowMs-m.departAt)/span)),th=bearing(m.id),[ix,iy]=ell(outer,th),far={...outer,a:outer.a*1.9,b:outer.b*1.9},[px0,py0]=ell(far,th-.25),[qx,qy]=ell({...outer,a:outer.a*1.35,b:outer.b*1.35},th-.2);
      const P=t=>{const u=1-t;return[u*u*px0+2*u*t*qx+t*t*ix,u*u*py0+2*u*t*qy+t*t*iy]};
      ctx.setLineDash([5,6]);ctx.lineDashOffset=still?0:-T*30;ctx.strokeStyle='#ff4d6a';ctx.globalAlpha=.75;ctx.lineWidth=1.6;ctx.beginPath();ctx.moveTo(px0,py0);ctx.quadraticCurveTo(qx,qy,ix,iy);ctx.stroke();ctx.setLineDash([]);
      const[mx,my]=P(f),[nx,ny]=P(Math.min(1,f+.01)),ang=Math.atan2(ny-my,nx-mx);ctx.globalAlpha=1;ctx.save();ctx.translate(mx,my);ctx.rotate(ang);ctx.fillStyle='#ff4d6a';ctx.shadowColor='#ff4d6a';ctx.shadowBlur=quality.blur?14:0;ctx.beginPath();ctx.moveTo(8,0);ctx.lineTo(-6,-5);ctx.lineTo(-3,0);ctx.lineTo(-6,5);ctx.closePath();ctx.fill();ctx.restore();
      const pr=(still?.5:(T*1.5)%1);ctx.strokeStyle='#ff4d6a';ctx.globalAlpha=.8*(1-pr);ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(ix,iy,6+pr*22,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1});


    raf=requestAnimationFrame(frame);
  }
  const wake=()=>{cancelAnimationFrame(raf);if(!disposed&&!document.hidden)raf=requestAnimationFrame(frame);};
  const observer=new ResizeObserver(()=>{measure();wake();});observer.observe(map);observer.observe(core);
  document.addEventListener("visibilitychange",wake);
  measure();wake();
  return()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();document.removeEventListener("visibilitychange",wake);};
}
