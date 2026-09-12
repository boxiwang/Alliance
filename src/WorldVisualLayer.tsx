import { useEffect, useRef } from "react";
import type { Point } from "./lib/world-engine";
import type { PlanetHaloId, PlanetOrbitId, PlanetSkinId } from "./lib/player-account";
import { PLANET_CORE_GLSL } from "./planet-core-shared";
import { RADIANT_CROWN_GLSL } from "./planet-halo-shared";

export interface WorldVisualCity {
  id: string;
  position: Point;
  skin: PlanetSkinId;
  halo: PlanetHaloId | null;
  orbit: PlanetOrbitId | null;
  own?: boolean;
  selected?: boolean;
  burning?: boolean;
  /** Synthetic GM-only population; real civilizations always win a detail slot. */
  probe?: boolean;
}

export const WORLD_VISUAL_BUDGET = {
  strategic: 800,
  field: 240,
  tactical: 120,
} as const;

export const WORLD_VISUAL_BEACON_BUDGET = 400;

export function worldVisualBudget(zoom: number): number {
  return zoom < 1.45 ? WORLD_VISUAL_BUDGET.strategic : zoom < 3 ? WORLD_VISUAL_BUDGET.field : WORLD_VISUAL_BUDGET.tactical;
}

export function worldVisualBodyRadius(zoom: number, own = false, selected = false): number {
  let radius: number;
  // Strategic view is a constellation: preserve identity color/orbit, but keep
  // hundreds of civilizations from turning into one luminous carpet.
  if (zoom < 1.45) radius = own ? 5.4 : 3;
  else if (zoom < 3) radius = own ? 14 : 11;
  else {
    const amount = Math.max(0, Math.min(1, Math.log2(zoom / 3) / Math.log2(16 / 3)));
    // Deep Tactical is the cosmetic inspection range. The local civilization
    // reaches a true 44 px body radius at 1600% (2x the previous 22 px), and a
    // selected rival receives nearly the same treatment. Unselected rivals
    // stay compact so a dense neighborhood does not become a wall of bloom.
    if (own) radius = 15.5 + amount * 28.5;
    else if (selected) radius = 14.5 + amount * 27.5;
    else radius = 12.5 + amount * 5.5;
  }
  return radius + (selected && zoom < 3 ? (zoom < 1.45 ? 1.2 : 1.5) : 0);
}

/** Deterministic render-only population used by GM stress runs; it never enters game authority. */
export function createWorldVisualStress(count: number, width: number, height: number): WorldVisualCity[] {
  const total = Math.max(0, Math.min(50_000, Math.floor(count)));
  const skins: PlanetSkinId[] = ["dust-homestead", "blue-marble", "void-touched", "sovereign-core", "event-horizon", "solar-imperator"];
  const halos: PlanetHaloId[] = ["faint-corona", "pulse-aura", "aurora-veil", "radiant-crown"];
  const orbits: PlanetOrbitId[] = ["survey-ring", "orbital-belt", "accretion-halo", "sovereign-crown"];
  let seed = 0x51f15e;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: total }, (_, index) => ({
    id: `render-probe-${index}`,
    position: { x: random() * width, y: random() * height },
    skin: skins[index % skins.length],
    halo: halos[(index * 11) % halos.length],
    orbit: orbits[(index * 3) % orbits.length],
    probe: true,
  }));
}

function evenlySample(cities: WorldVisualCity[], count: number): WorldVisualCity[] {
  if (count <= 0) return [];
  if (cities.length <= count) return cities;
  const sampled: WorldVisualCity[] = [];
  const stride = cities.length / count;
  for (let index = 0; index < count; index += 1) sampled.push(cities[Math.floor(index * stride)]);
  return sampled;
}

export interface WorldVisualPlan {
  detailed: WorldVisualCity[];
  /** Real overflow remains visible as a cheap beacon and upgrades when selected. */
  beacons: WorldVisualCity[];
  visibleCount: number;
}

export function planWorldVisualTiers(
  cities: WorldVisualCity[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  zoom: number,
): WorldVisualPlan {
  const priority: WorldVisualCity[] = [];
  const real: WorldVisualCity[] = [];
  const probes: WorldVisualCity[] = [];
  for (const city of cities) {
    if (city.position.x < bounds.minX || city.position.x > bounds.maxX || city.position.y < bounds.minY || city.position.y > bounds.maxY) continue;
    if (city.own || city.selected) priority.push(city);
    else if (city.probe) probes.push(city);
    else real.push(city);
  }

  const room = Math.max(0, worldVisualBudget(zoom) - priority.length);
  const detailedReal = evenlySample(real, room);
  const probeRoom = Math.max(0, room - detailedReal.length);
  const detailed = priority.concat(detailedReal, evenlySample(probes, probeRoom));
  const detailedIds = new Set(detailed.map((city) => city.id));
  const beaconCandidates = zoom >= 1.45 && zoom < 3
    ? real.filter((city) => !detailedIds.has(city.id))
    : [];
  return {
    detailed,
    beacons: evenlySample(beaconCandidates, WORLD_VISUAL_BEACON_BUDGET),
    visibleCount: priority.length + real.length + probes.length,
  };
}

/** Pure planner used by the renderer and by large-population regression tests. */
export function planWorldVisuals(
  cities: WorldVisualCity[],
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  zoom: number,
): WorldVisualCity[] {
  return planWorldVisualTiers(cities, bounds, zoom).detailed;
}

const SKIN_INDEX: Record<PlanetSkinId, number> = {
  "dust-homestead": 0,
  "blue-marble": 1,
  "void-touched": 2,
  "sovereign-core": 3,
  "event-horizon": 4,
  "solar-imperator": 5,
};

const ORBIT_INDEX: Record<PlanetOrbitId, number> = {
  "survey-ring": 0,
  "orbital-belt": 1,
  "accretion-halo": 2,
  "sovereign-crown": 3,
};

const HALO_INDEX: Record<PlanetHaloId, number> = {
  "faint-corona": 0,
  "pulse-aura": 1,
  "aurora-veil": 2,
  "radiant-crown": 3,
};

function stableSeed(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 10_000) / 10_000;
}

const VERTEX_SHADER = `
precision highp float;
attribute vec2 aCorner;
attribute vec2 aCenter;
attribute float aRadius;
attribute float aKind;
attribute float aOrbit;
attribute float aHalo;
attribute float aSeed;
attribute float aFlags;
attribute float aLod;
uniform vec2 uResolution;
varying vec2 vP;
varying float vRadius;
varying float vKind;
varying float vOrbit;
varying float vHalo;
varying float vSeed;
varying float vFlags;
varying float vLod;
void main(){
  vec2 pixel = aCenter + aCorner * aRadius * 3.6;
  vec2 clip = vec2(pixel.x / uResolution.x * 2.0 - 1.0, 1.0 - pixel.y / uResolution.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  vP = aCorner * 3.6;
  vRadius = aRadius;
  vKind = aKind;
  vOrbit = aOrbit;
  vHalo = aHalo;
  vSeed = aSeed;
  vFlags = aFlags;
  vLod = aLod;
}
`;

const FRAGMENT_SHADER = `
precision highp float;
#define PI 3.14159265359
uniform float uTime;
uniform float uMotion;
varying vec2 vP;
varying float vRadius;
varying float vKind;
varying float vOrbit;
varying float vHalo;
varying float vSeed;
varying float vFlags;
varying float vLod;

float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ float n=sin(dot(p,vec2(41.0,289.0))); return fract(vec2(262144.0,32768.0)*n); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.0,a=.5; mat2 m=mat2(.8,.6,-.6,.8); for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p*2.03+17.1; a*=.5; } return v; }
float cellEdge(vec2 x){ vec2 n=floor(x),f=fract(x); float md=8.0,sd=8.0; for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=hash22(n+g); vec2 r=g+o-f; float d=dot(r,r); if(d<md){ sd=md; md=d; }else if(d<sd){ sd=d; } } return sqrt(sd)-sqrt(md); }
vec2 rot(vec2 p,float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c)*p; }
float ring(vec2 p,vec2 size,float width){ return 1.0-smoothstep(width,width+1.6/max(vRadius,4.0),abs(length(p/size)-1.0)); }
float disk(vec2 p,float radius){ float aa=1.35/max(vRadius,4.0); return 1.0-smoothstep(radius-aa,radius+aa,length(p)); }
float segment(vec2 p,vec2 a,vec2 b){ vec2 pa=p-a,ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
float softLine(vec2 p,vec2 a,vec2 b,float width){ float aa=1.2/max(vRadius,4.0); return 1.0-smoothstep(width,width+aa,segment(p,a,b)); }
float softBox(vec2 p,vec2 bounds){ vec2 d=abs(p)-bounds; float dist=length(max(d,0.0))+min(max(d.x,d.y),0.0); return 1.0-smoothstep(0.0,1.4/max(vRadius,4.0),dist); }
void over(inout vec4 c,vec3 rgb,float alpha){ alpha=clamp(alpha,0.0,1.0); c.rgb=rgb*alpha+c.rgb*(1.0-alpha); c.a=alpha+c.a*(1.0-alpha); }
void emit(inout vec4 c,vec3 rgb,float amount){ amount=max(0.0,amount); c.rgb+=rgb*amount; c.a=max(c.a,clamp(amount*.8,0.0,1.0)); }
${PLANET_CORE_GLSL}
${RADIANT_CROWN_GLSL}
vec3 orbitColor(){ if(vOrbit<.5)return vec3(.35,.86,1.0); if(vOrbit<1.5)return vec3(.66,.42,1.0); if(vOrbit<2.5)return vec3(1.0,.7,.32); return vec3(.84,.91,1.0); }

void drawOrbit(inout vec4 col,vec2 p,float front){
  if(vOrbit<-.5)return;
  vec3 color=orbitColor();
  float halfMask=front>.5?smoothstep(-.07,.07,p.y):1.0-smoothstep(-.07,.07,p.y);
  float theta=atan(p.y/.66,p.x/2.18);
  if(vLod<.5){
    float simple=ring(p,vec2(2.05,.62),.026)*halfMask;
    float pulse=.42+.18*sin(uTime*.8+vSeed*9.0);
    emit(col,color,simple*pulse);
    return;
  }
  if(vOrbit<.5){
    float dash=.35+.65*step(.36,fract((theta/6.28318+.5)*18.0-uTime*.11*uMotion));
    float line=ring(p,vec2(2.15,.645),.018)*halfMask*dash;
    emit(col,color,line*.68);
    float a=uTime*.48*uMotion+vSeed*6.28318;
    vec2 node=vec2(cos(a)*2.15,sin(a)*.645);
    float nodeHalf=front>.5?step(0.0,node.y):step(node.y,0.0);
    emit(col,vec3(.88,.98,1.0),disk(p-node,.085)*nodeHalf*.95);
  }else if(vOrbit<1.5){
    float main=ring(p,vec2(2.05,.62),.02)*halfMask;
    float outer=ring(rot(p,.12),vec2(2.55,.61),.014)*halfMask;
    float dust=step(.52,fract((theta/6.28318+.5)*31.0+vSeed*5.0+uTime*.035*uMotion));
    emit(col,color,main*.44+outer*dust*.34);
    for(int i=0;i<4;i++){
      float a=float(i)*1.5708+uTime*(.22+float(i)*.012)*uMotion+vSeed*6.28318;
      vec2 sat=vec2(cos(a)*2.05,sin(a)*.62);
      float side=front>.5?step(0.0,sat.y):step(sat.y,0.0);
      float d=length(p-sat);
      emit(col,color,exp(-d*d*55.0)*side*.42);
      over(col,vec3(.95,.98,1.0),disk(p-sat,.07)*side);
    }
  }else if(vOrbit<2.5){
    float q=abs(length(p/vec2(2.24,.76))-1.0);
    float flow=noise(vec2(theta*7.0-uTime*.8*uMotion,vSeed*13.0));
    float band=exp(-q*q*1450.0)*halfMask*(.28+.72*flow);
    vec3 mixed=mix(vec3(.66,.38,1.0),vec3(1.0,.68,.25),smoothstep(-2.2,1.5,p.x));
    emit(col,mixed,band*.9);
    emit(col,vec3(1.0,.88,.58),ring(p,vec2(1.92,.65),.018)*halfMask*.75);
  }else{
    float main=ring(p,vec2(2.2,.7),.018)*halfMask;
    vec2 pA=rot(p,.52),pB=rot(p,-.7);
    float gyroA=ring(pA,vec2(2.35,.5),.014)*(front>.5?smoothstep(-.06,.06,pA.y):1.0-smoothstep(-.06,.06,pA.y));
    float gyroB=ring(pB,vec2(2.35,.5),.014)*(front>.5?smoothstep(-.06,.06,pB.y):1.0-smoothstep(-.06,.06,pB.y));
    emit(col,color,main*.58+(gyroA+gyroB)*.28);
    for(int i=0;i<6;i++){
      float a=float(i)*1.0472+uTime*.18*uMotion+vSeed*6.28318;
      vec2 gem=vec2(cos(a)*2.2,sin(a)*.7);
      float side=front>.5?step(0.0,gem.y):step(gem.y,0.0);
      vec2 d=abs(rot(p-gem,.7854));
      float diamond=1.0-smoothstep(.075,.105,max(d.x,d.y));
      emit(col,vec3(1.0,.78,.32),exp(-dot(p-gem,p-gem)*42.0)*side*.38);
      over(col,vec3(1.0,.95,.78),diamond*side);
    }
  }
}

void drawHalo(inout vec4 col,vec2 p,float front){
  if(vHalo<-.5)return;
  // Strategic markers remain equal and non-identifying; Halo resolves only at
  // Field/Tactical LOD, bounded inside twice the Core radius.
  if(vLod<.5)return;
  float r=length(p),a=atan(p.y,p.x),t=uTime*uMotion;
  if(vHalo<.5){
    float breathe=.78+.22*sin(uTime*.42+vSeed*6.0);
    if(front<.5)emit(col,vec3(.35,.86,1.0),exp(-pow((r-1.18)/.31,2.0))*smoothstep(.9,1.03,r)*.16*breathe);
    else emit(col,vec3(.72,.96,1.0),ring(p,vec2(1.015),.009)*.42*breathe);
  }else if(vHalo<1.5){
    if(front<.5){
      emit(col,vec3(.66,.42,1.0),exp(-pow((r-1.17)/.29,2.0))*smoothstep(.9,1.02,r)*.15);
      for(int k=0;k<2;k++){
        float phase=fract(uTime*.33+float(k)*.5+vSeed); float rr=1.02+phase*.96;
        emit(col,vec3(.69,.43,1.0),ring(p,vec2(rr),.009)*(1.0-phase)*(1.0-phase)*.55);
      }
    }else emit(col,vec3(.83,.66,1.0),ring(p,vec2(1.015),.01)*.5);
  }else if(vHalo<2.5){
    float top=smoothstep(-.05,.05,p.y); float side=front>.5?1.0-top:top;
    float target=1.15+.075*sin(a*4.0+t*.4+vSeed*5.0); float curtain=exp(-pow((r-target)/.18,2.0));
    float shimmer=.35+.65*(.5+.5*sin(a*3.0+t*.5+sin(a*7.0)*1.7+vSeed*9.0));
    vec3 aurora=mix(vec3(.31,.94,.82),vec3(.66,.42,1.0),.5+.5*cos(a));
    if(front<.5)emit(col,vec3(.31,.94,.82),exp(-pow((r-1.22)/.34,2.0))*smoothstep(.9,1.02,r)*.12);
    emit(col,aurora,curtain*shimmer*side*.34);
    if(front>.5)emit(col,vec3(.55,1.0,.9),ring(p,vec2(1.015),.009)*.4);
  }else{
    // vP follows screen coordinates (+Y down); canonical Crown geometry uses
    // +Y up, matching the Vault shader and Claude's canvas study.
    vec2 q=vec2(p.x,-p.y);
    float cyc=fract((uTime+vSeed*12.0)/12.0); float g=cyc<.60?smoothstep(0.0,.60,cyc):cyc<.66?1.0:max(0.0,1.0-((cyc-.66)/.24)/.35);
    float diffuse=1.0-g; float burst=cyc>=.66&&cyc<.90?(cyc-.66)/.24:-1.0; float breathe=.85+.15*sin(uTime*.28+vSeed*4.0);
    if(front<.5){
      float radial=smoothstep(.9,1.08,r)*(1.0-smoothstep(1.15,2.08,r));
      float rayA=pow(abs(cos(a*6.0+t*.028)),18.0),rayB=pow(abs(cos(a*12.0-t*.016)),28.0);
      emit(col,vec3(.95,.72,.28),radial*(rayA*.16+rayB*.075)*diffuse*breathe);
      emit(col,vec3(1.0,.86,.58),exp(-pow((r-1.28)/.44,2.0))*smoothstep(.88,1.02,r)*(.07+.09*diffuse)*breathe);
      float crown=radiantCrownShape(q,mix(.18,.12,g));
      emit(col,radiantCrownColor(q),crown*g*.60);
      float band=radiantLine(q,vec2(-1.30,.18),vec2(1.30,.18),.018,.035);
      emit(col,vec3(1.0,.992,.94),band*crown*g*.30);
      if(burst>=0.0){
        float flash=max(0.0,1.0-burst*2.2); vec2 release=q-vec2(0.0,.15);
        emit(col,vec3(1.0,.90,.69),pow(1.0-smoothstep(0.0,1.70,length(release)),2.0)*flash*.36);
        float shards=0.0;
        shards+=radiantShard(q,vec2(0.0,1.70),vec2(0.0,1.55),burst);
        shards+=radiantShard(q,vec2(-.60,1.20),vec2(-.60,1.05),burst); shards+=radiantShard(q,vec2(.60,1.20),vec2(.60,1.05),burst);
        shards+=radiantShard(q,vec2(-1.50,1.00),vec2(-1.50,.85),burst); shards+=radiantShard(q,vec2(1.50,1.00),vec2(1.50,.85),burst);
        shards+=radiantShard(q,vec2(-.95,.17),vec2(-.95,.02),burst); shards+=radiantShard(q,vec2(.95,.17),vec2(.95,.02),burst);
        shards+=radiantShard(q,vec2(-.45,.01),vec2(-.45,-.14),burst); shards+=radiantShard(q,vec2(.45,.01),vec2(.45,-.14),burst);
        shards+=radiantShard(q,vec2(0.0,-.07),vec2(0.0,-.22),burst);
        emit(col,vec3(1.0,.84,.50),shards*.40);
      }
    }else{
      emit(col,vec3(1.0,.98,.9),ring(p,vec2(1.015),.009)*.6);
      emit(col,vec3(.95,.7,.28),ring(p,vec2(1.025),.02)*.27);
      for(int i=0;i<8;i++){
        float fi=float(i),ang=t*.10+fi*.7854,rr=1.34+.21*sin(t*.26+fi); vec2 mote=vec2(cos(ang),sin(ang))*rr*(1.0-.32*g);
        float twinkle=max(0.0,.3+.4*sin(uTime*.7+fi*1.7))*(.4+.6*diffuse);
        emit(col,vec3(1.0,.98,.88),exp(-dot(p-mote,p-mote)*62.0)*twinkle);
      }
      vec2 gemDelta=q-vec2(0.0,1.93);
      emit(col,vec3(.81,.59,1.0),exp(-dot(gemDelta,gemDelta)*13.0)*g*.34);
      emit(col,vec3(1.0,.985,.94),radiantDiamond(q,.035)*g*.95);
      if(burst>=0.0&&burst<.4){float apex=1.0-burst/.4; vec2 d=q-vec2(0.0,1.42); emit(col,vec3(1.0),exp(-dot(d,d)*75.0)*apex*.55);}
    }
  }
}

void drawPlanet(inout vec4 col,vec2 p){
  float r=length(p);
  float body=disk(p,1.0);
  if(vLod<.5){
    // Strategic view deliberately withholds cosmetic identity: every Core is
    // the same restrained navigation marker until a closer observation tier.
    over(col,vec3(.055,.11,.16),body);
    emit(col,vec3(.32,.72,.86),ring(p,vec2(1.0),.026)*.44);
    return;
  }
  float time=uTime*uMotion;
  float aa=1.35/max(vRadius,4.0);
  vec2 q=vec2(p.x,-p.y);
  if(vKind<.5){
    drawDustHomestead(col,q,time,vSeed,aa,1.0,step(1.5,vLod));
  }else if(vKind<1.5){
    drawBlueMarble(col,q,time,vSeed,aa,1.0,step(1.5,vLod));
  }else if(vKind<2.5){
    // Restored Rift Sovereign surface: the first design used a living Voronoi
    // fracture field wrapped around a rotating sphere, not three fixed strokes.
    float z=sqrt(max(0.0,1.0-r*r));
    vec3 normal=normalize(vec3(p,z));
    float lit=max(.08,dot(normal,normalize(vec3(-.48,-.55,.85))));
    emit(col,vec3(.18,.72,1.0),exp(-pow((r-1.025)*10.0,2.0))*.34);
    if(body>0.0){
      vec2 surface=vec2(atan(normal.x,normal.z)/PI+normal.y*.12,asin(normal.y)/PI);
      surface.x+=uTime*.13*uMotion+vSeed*.17;
      float terrain=fbm(surface*vec2(7.0,12.0)+2.0+vSeed*3.0);
      float edge=cellEdge(surface*vec2(9.0,13.0)+vec2(uTime*.26*uMotion,0.0));
      float crack=(1.0-smoothstep(.018,.075,edge))*smoothstep(.25,.72,terrain+.1);
      float pulse=.65+.35*sin(uTime*2.3*uMotion+terrain*9.0+vSeed*8.0);
      vec3 base=mix(vec3(.018,.025,.052),vec3(.10,.13,.20),terrain)*(.4+lit*.75);
      base+=crack*pulse*vec3(.52,.08,1.25)*1.95;
      base+=pow(1.0-z,3.0)*vec3(.05,.65,1.15);
      base+=pow(max(0.0,dot(normal,normalize(vec3(.5,-.3,.7)))),16.0)*.3;
      over(col,base,body);
    }
  }else if(vKind<3.5){
    drawSovereignCore(col,q,time,vSeed,aa,1.0,step(1.5,vLod));
  }else if(vKind<4.5){
    vec2 q=rot(p,.28);
    float back=ring(q,vec2(1.6,.42),.07)*(1.0-smoothstep(-.05,.05,q.y));
    emit(col,mix(vec3(.55,.1,1.0),vec3(1.0,.42,.12),smoothstep(-1.6,1.6,q.x)),back*.78);
    emit(col,vec3(.62,.2,1.0),exp(-pow((r-1.02)*7.5,2.0))*.52);
    over(col,vec3(.0,.0,.008),disk(p,.8));
    emit(col,vec3(.96,.82,1.0),ring(p,vec2(.95,.95),.028)*.82);
    float front=ring(q,vec2(1.6,.42),.065)*smoothstep(-.05,.05,q.y);
    emit(col,mix(vec3(.55,.14,1.0),vec3(1.0,.5,.16),smoothstep(-1.6,1.6,q.x)),front*.92);
  }else{
    float z=sqrt(max(0.0,1.0-r*r));
    vec3 normal=normalize(vec3(p,z));
    float lit=max(.08,dot(normal,normalize(vec3(-.48,-.55,.85))));
    float rays=.55+.45*sin(atan(p.y,p.x)*19.0+uTime*.7*uMotion+vSeed*8.0);
    float corona=exp(-pow((r-1.08)*5.0,2.0))*(.2+.35*rays);
    emit(col,vec3(1.0,.38,.08),corona);
    if(body>0.0){
      vec2 surface=vec2(atan(normal.x,normal.z)/PI,asin(normal.y)/PI);
      surface.x+=uTime*.075*uMotion+vSeed*.13;
      float terrain=fbm(surface*vec2(8.0,14.0)+11.0);
      float edge=cellEdge(surface*vec2(10.0,14.0)+3.0+vSeed*2.0);
      float fault=(1.0-smoothstep(.012,.065,edge))*smoothstep(.34,.74,terrain);
      vec3 base=mix(vec3(.018,.019,.024),vec3(.14,.105,.055),terrain)*(.4+lit*.8);
      base+=fault*(.72+.28*sin(uTime*1.7*uMotion+terrain*12.0))*vec3(1.32,.55,.07)*1.65;
      base+=pow(1.0-z,3.0)*vec3(1.0,.38,.06)*.7;
      base+=pow(max(0.0,dot(normal,normalize(vec3(.5,-.2,.8)))),24.0)*.5;
      over(col,base,body);
    }
  }
}

void drawBeacon(inout vec4 col,vec2 p){
  vec3 skin=vKind<.5?vec3(.68,.49,.29):vKind<1.5?vec3(.20,.68,1.0):vKind<2.5?vec3(.58,.2,1.0):vKind<3.5?vec3(1.0,.70,.24):vKind<4.5?vec3(.82,.38,1.0):vec3(1.0,.63,.16);
  float pulse=.82+.18*sin(uTime*uMotion*1.15+vSeed*9.0);
  emit(col,skin,exp(-dot(p,p)*1.8)*.18*pulse);
  over(col,mix(skin,vec3(1.0),.42),disk(p,.4));
  emit(col,orbitColor(),ring(p,vec2(.74,.42),.055)*.64);
}

void drawWormhole(inout vec4 col,vec2 p){
  float r=length(p);
  float theta=atan(p.y,p.x);
  float motion=uTime*uMotion;
  float swirl=.5+.5*sin(theta*7.0-r*13.0-motion*1.5+noise(p*3.0)*4.0);
  float nebula=exp(-r*r*.42)*(1.0-smoothstep(.45,2.65,r))*swirl;
  emit(col,mix(vec3(.15,.68,1.0),vec3(.66,.16,1.0),swirl),nebula*.16);
  vec2 q=rot(p,-.22);
  float disc=exp(-pow(abs(length(q/vec2(2.35,.58))-1.0)*5.0,2.0));
  vec3 discColor=mix(vec3(.24,.8,1.0),vec3(.78,.22,1.0),smoothstep(-2.2,2.2,q.x));
  emit(col,discColor,disc*(.38+.36*swirl));
  emit(col,vec3(.58,.25,1.0),exp(-pow((r-1.18)*7.0,2.0))*.7);
  emit(col,vec3(.72,.9,1.0),ring(p,vec2(1.02,1.02),.028)*.95);
  over(col,vec3(.0,.0,.012),disk(p,.78));
  float inner=exp(-r*r*5.0);
  over(col,vec3(.002,.001,.009),inner);
  float sparks=step(.94,hash21(vec2(floor((theta+PI)*26.0),vSeed*41.0)))*exp(-pow((r-1.5)*9.0,2.0));
  emit(col,vec3(.75,.86,1.0),sparks*.72);
}

void main(){
  vec4 col=vec4(0.0);
  if(vLod<-.5){
    drawBeacon(col,vP);
  }else if(vKind>5.5){
    drawWormhole(col,vP);
  }else{
    drawHalo(col,vP,0.0);
    drawOrbit(col,vP,0.0);
    drawPlanet(col,vP);
    drawOrbit(col,vP,1.0);
    drawHalo(col,vP,1.0);
    float own=mod(floor(vFlags+.5),2.0);
    float selected=mod(floor(vFlags/2.0),2.0);
    float burning=mod(floor(vFlags/4.0),2.0);
    emit(col,vec3(.25,.88,1.0),ring(vP,vec2(2.85,2.85),.018)*own*(.18+.1*sin(uTime*uMotion)));
    emit(col,vec3(.82,.68,1.0),ring(vP,vec2(3.08,3.08),.022)*selected*(.5+.25*sin(uTime*2.0*uMotion)));
    emit(col,vec3(1.0,.18,.28),exp(-pow((length(vP)-1.32)*5.5,2.0))*burning*(.25+.2*sin(uTime*3.0*uMotion)));
  }
  gl_FragColor=col;
}
`;

const CORNERS = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1] as const;
const STRIDE = 11;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create Star Map shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Star Map shader compilation failed.");
  return shader;
}

export default function WorldVisualLayer({
  svgRef, cities, wormhole, zoom, onReadyChange,
}: {
  svgRef: React.RefObject<SVGSVGElement>;
  cities: WorldVisualCity[];
  wormhole: Point;
  zoom: number;
  onReadyChange?: (ready: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ cities, wormhole, zoom });
  latest.current = { cities, wormhole, zoom };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "high-performance",
    });
    if (!gl) { onReadyChange?.(false); return; }

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Star Map shader link failed.");
    } catch (error) {
      console.warn(error);
      onReadyChange?.(false);
      return;
    }

    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const attributes = [
      ["aCorner", 2, 0], ["aCenter", 2, 2], ["aRadius", 1, 4], ["aKind", 1, 5],
      ["aOrbit", 1, 6], ["aHalo", 1, 7], ["aSeed", 1, 8], ["aFlags", 1, 9], ["aLod", 1, 10],
    ] as const;
    for (const [name, size, offset] of attributes) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    }
    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uMotion = gl.getUniformLocation(program, "uMotion");
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let data = new Float32Array(STRIDE * 6 * 256);
    let raf = 0;
    let dprCap = 1.5;
    let slowFrames = 0;
    let smoothFrames = 0;
    let lastFrame = performance.now();
    let statsAt = 0;
    let statsFrames = 0;
    let statsWorstGap = 0;
    let statsStartedAt = lastFrame;
    let cachedSource: WorldVisualCity[] | null = null;
    let cachedZoom = -1;
    let cachedTransform = [NaN, NaN, NaN, NaN, NaN, NaN];
    let cachedWidth = -1;
    let cachedHeight = -1;
    let vertexCount = 0;
    let cityDrawn = 0;
    let detailedDrawn = 0;
    let beaconDrawn = 0;
    let visibleCount = 0;
    let landmarkDrawn = 0;
    onReadyChange?.(true);

    const writeQuad = (offset: number, centerX: number, centerY: number, radius: number, kind: number, orbit: number, halo: number, seed: number, flags: number, lod: number) => {
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const base = offset + vertex * STRIDE;
        data[base] = CORNERS[vertex * 2]; data[base + 1] = CORNERS[vertex * 2 + 1];
        data[base + 2] = centerX; data[base + 3] = centerY; data[base + 4] = radius;
        data[base + 5] = kind; data[base + 6] = orbit; data[base + 7] = halo; data[base + 8] = seed;
        data[base + 9] = flags; data[base + 10] = lod;
      }
      return offset + STRIDE * 6;
    };

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const svg = svgRef.current;
      const rect = canvas.getBoundingClientRect();
      const matrix = svg?.getScreenCTM();
      if (!svg || !matrix || rect.width < 2 || rect.height < 2) return;

      const { cities: source, wormhole: hole, zoom: currentZoom } = latest.current;
      const frameGap = Math.min(100, time - lastFrame); lastFrame = time;
      statsFrames += 1;
      statsWorstGap = Math.max(statsWorstGap, frameGap);
      if (frameGap > 24) { slowFrames += 1; smoothFrames = 0; }
      else if (frameGap < 19) { smoothFrames += 1; slowFrames = Math.max(0, slowFrames - 1); }
      // Deep inspection starts at a Retina-ready cap. It may step down under a
      // sustained load, but never to the visibly soft 1x raster used by the
      // mass-population overview. Planet shaders are re-evaluated at the new
      // radius; no profile texture is being enlarged here.
      const inspectionDprMin = currentZoom >= 8 ? 1.5 : 1;
      const inspectionDprMax = currentZoom >= 8 ? 2 : 1.5;
      dprCap = Math.max(inspectionDprMin, Math.min(inspectionDprMax, dprCap));
      if (currentZoom >= 8 && cachedZoom < 8) dprCap = inspectionDprMax;
      if (slowFrames > 24 && dprCap > inspectionDprMin) { dprCap = Math.max(inspectionDprMin, dprCap - .25); slowFrames = 0; }
      if (smoothFrames > 420 && dprCap < inspectionDprMax) { dprCap = Math.min(inspectionDprMax, dprCap + .25); smoothFrames = 0; }
      const dpr = Math.min(dprCap, window.devicePixelRatio || 1);
      const deviceWidth = Math.max(2, Math.round(rect.width * dpr));
      const deviceHeight = Math.max(2, Math.round(rect.height * dpr));
      if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) { canvas.width = deviceWidth; canvas.height = deviceHeight; }

      const transform = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
      const geometryChanged = source !== cachedSource || currentZoom !== cachedZoom || rect.width !== cachedWidth || rect.height !== cachedHeight
        || transform.some((value, index) => Math.abs(value - cachedTransform[index]) > .01);
      if (geometryChanged) {
        cachedSource = source; cachedZoom = currentZoom; cachedWidth = rect.width; cachedHeight = rect.height; cachedTransform = transform;
        // Convert the canvas viewport back into world coordinates for the pure
        // population planner. SVG can be letterboxed, so all four corners matter.
        const inverse = matrix.inverse();
        const screenCorners = [
          [rect.left, rect.top], [rect.right, rect.top], [rect.left, rect.bottom], [rect.right, rect.bottom],
        ];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        screenCorners.forEach(([x, y]) => {
          const wx = inverse.a * x + inverse.c * y + inverse.e;
          const wy = inverse.b * x + inverse.d * y + inverse.f;
          minX = Math.min(minX, wx); maxX = Math.max(maxX, wx); minY = Math.min(minY, wy); maxY = Math.max(maxY, wy);
        });
        // The 3.6x shader quad includes crowns, rings and orbital particles.
        // Expand the planner band with the largest inspectable body so those
        // effects do not pop or clip while a large planet enters the viewport.
        const visualExtent = Math.max(36, worldVisualBodyRadius(currentZoom, true) * 3.6);
        const margin = visualExtent / Math.max(.001, Math.hypot(matrix.a, matrix.b));
        const planned = planWorldVisualTiers(source, { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin }, currentZoom);
        const required = (planned.detailed.length + planned.beacons.length + 1) * STRIDE * 6;
        if (data.length < required) data = new Float32Array(2 ** Math.ceil(Math.log2(required)));
        const lod = currentZoom < 1.45 ? 0 : currentZoom < 3 ? 1 : 2;
        let offset = 0;
        cityDrawn = 0;
        detailedDrawn = 0;
        beaconDrawn = 0;
        visibleCount = planned.visibleCount;
        landmarkDrawn = 0;
        const mapPoint = (point: Point) => ({
          x: matrix.a * point.x + matrix.c * point.y + matrix.e - rect.left,
          y: matrix.b * point.x + matrix.d * point.y + matrix.f - rect.top,
        });
        const holeScreen = mapPoint(hole);
        const holeRadius = currentZoom < 1.45 ? 26 : currentZoom < 3 ? 30 : Math.min(44, 31 + Math.log2(currentZoom / 3) * 5);
        if (holeScreen.x + holeRadius * 3.6 > 0 && holeScreen.x - holeRadius * 3.6 < rect.width && holeScreen.y + holeRadius * 3.6 > 0 && holeScreen.y - holeRadius * 3.6 < rect.height) {
          offset = writeQuad(offset, holeScreen.x, holeScreen.y, holeRadius, 6, 0, 0, .731, 0, lod);
          landmarkDrawn = 1;
        }
        // Cheap overflow beacons render first; selecting one promotes it into
        // the detailed budget on the next React frame.
        for (const city of planned.beacons) {
          const screen = mapPoint(city.position);
          const radius = city.selected ? 3.2 : 2.7;
          if (screen.x + radius * 3.6 < 0 || screen.x - radius * 3.6 > rect.width || screen.y + radius * 3.6 < 0 || screen.y - radius * 3.6 > rect.height) continue;
          offset = writeQuad(offset, screen.x, screen.y, radius, SKIN_INDEX[city.skin] ?? 0, city.orbit ? ORBIT_INDEX[city.orbit] : -1, city.halo ? HALO_INDEX[city.halo] : -1, stableSeed(city.id), 0, -1);
          beaconDrawn += 1;
        }
        for (const city of planned.detailed) {
          const screen = mapPoint(city.position);
          const radius = worldVisualBodyRadius(currentZoom, city.own, city.selected);
          if (screen.x + radius * 3.6 < 0 || screen.x - radius * 3.6 > rect.width || screen.y + radius * 3.6 < 0 || screen.y - radius * 3.6 > rect.height) continue;
          const flags = (city.own ? 1 : 0) + (city.selected ? 2 : 0) + (city.burning ? 4 : 0);
          offset = writeQuad(offset, screen.x, screen.y, radius, SKIN_INDEX[city.skin] ?? 0, city.orbit ? ORBIT_INDEX[city.orbit] : -1, city.halo ? HALO_INDEX[city.halo] : -1, stableSeed(city.id), flags, lod);
          detailedDrawn += 1;
        }
        cityDrawn = detailedDrawn + beaconDrawn;
        vertexCount = offset / STRIDE;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, offset), gl.DYNAMIC_DRAW);
      }

      gl.viewport(0, 0, deviceWidth, deviceHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform2f(uResolution, rect.width, rect.height);
      gl.uniform1f(uTime, time / 1000);
      gl.uniform1f(uMotion, reducedMotion ? 0 : 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

      if (time - statsAt > 500) {
        statsAt = time;
        const fps = Math.round(statsFrames * 1000 / Math.max(1, time - statsStartedAt));
        canvas.dataset.rendered = String(cityDrawn);
        canvas.dataset.detailed = String(detailedDrawn);
        canvas.dataset.beacons = String(beaconDrawn);
        canvas.dataset.visible = String(visibleCount);
        canvas.dataset.landmarks = String(landmarkDrawn);
        canvas.dataset.source = String(source.length);
        canvas.dataset.dpr = dpr.toFixed(2);
        canvas.dataset.budget = String(worldVisualBudget(currentZoom));
        canvas.dataset.frameGap = frameGap.toFixed(1);
        canvas.dataset.maxFrameGap = statsWorstGap.toFixed(1);
        canvas.dataset.fps = String(fps);
        // Keep GM/browser smoke tests observable without coupling the map to a
        // debug panel or reaching into WebGL internals.
        canvas.setAttribute("aria-label", `Star Map renderer: ${detailedDrawn} detailed and ${beaconDrawn} beacon civilizations from ${source.length} sources, ${visibleCount} in the cull band, ${landmarkDrawn} landmark, ${fps} FPS, ${frameGap.toFixed(1)} millisecond frame gap, ${statsWorstGap.toFixed(1)} millisecond worst gap, ${dpr.toFixed(2)} DPR, ${worldVisualBudget(currentZoom)} detail budget`);
        statsFrames = 0;
        statsWorstGap = 0;
        statsStartedAt = time;
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      onReadyChange?.(false);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [svgRef, onReadyChange]);

  return <canvas ref={canvasRef} className="world-visual-layer" aria-label="High fidelity civilization and Wormhole renderer" />;
}
