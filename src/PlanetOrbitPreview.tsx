import { useEffect, useRef } from "react";
import { PLANET_HALOS, PLANET_ORBITS, PLANET_SKINS, type PlanetHaloId, type PlanetOrbitId, type PlanetSkinId } from "./lib/player-account";
import { PLANET_CORE_GLSL } from "./planet-core-shared";
import { RADIANT_CROWN_GLSL } from "./planet-halo-shared";

const CORE_INDEX: Record<PlanetSkinId, number> = {
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

const VERTEX = `
attribute vec2 aPosition;
void main(){ gl_Position=vec4(aPosition,0.,1.); }
`;

// The Core functions restore the procedural surface treatment from the first
// Sovereign Skins study. The Orbit functions use the same normalized geometry
// and palette as the batched Star Map renderer, so a Vault assembly remains
// recognizable when it is reduced to tactical-map scale.
const FRAGMENT = `
precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uCore;
uniform float uOrbit;
uniform float uShowOrbit;
uniform float uHalo;
uniform float uShowHalo;
uniform float uMotion;
uniform float uIntensity;
uniform float uAssemblyScale;
uniform float uAssemblyOffsetY;

#define PI 3.14159265359
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ float n=sin(dot(p,vec2(41.,289.))); return fract(vec2(262144.,32768.)*n); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.,a=.5; mat2 m=mat2(.8,.6,-.6,.8); for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p*2.03+17.1; a*=.5; } return v; }
float cellEdge(vec2 x){ vec2 n=floor(x),f=fract(x); float md=8.,sd=8.; for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=hash22(n+g); vec2 r=g+o-f; float d=dot(r,r); if(d<md){ sd=md; md=d; }else if(d<sd){ sd=d; } } return sqrt(sd)-sqrt(md); }
vec2 rot(vec2 p,float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c)*p; }
float ring(vec2 p,vec2 size,float width){ return exp(-pow((length(p/size)-1.)/width,2.)); }
float disc(vec2 p,float radius,float feather){ return 1.-smoothstep(radius-feather,radius+feather,length(p)); }
float lineSeg(vec2 p,vec2 a,vec2 b,float width){ vec2 pa=p-a,ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); return 1.-smoothstep(width,width+.012,length(pa-ba*h)); }
float boxMask(vec2 p,vec2 bounds,float feather){ vec2 d=abs(p)-bounds; float dist=length(max(d,0.))+min(max(d.x,d.y),0.); return 1.-smoothstep(0.,feather,dist); }
void over(inout vec4 c,vec3 rgb,float alpha){ alpha=clamp(alpha,0.,1.); c.rgb=rgb*alpha+c.rgb*(1.-alpha); c.a=alpha+c.a*(1.-alpha); }
void emit(inout vec4 c,vec3 rgb,float amount){ amount=max(0.,amount); c.rgb+=rgb*amount; c.a=max(c.a,clamp(amount*.8,0.,1.)); }
${PLANET_CORE_GLSL}
${RADIANT_CROWN_GLSL}

vec3 stars(vec2 p,float seed){
  vec3 col=vec3(.004,.009,.022);
  vec2 q=p*8.; vec2 id=floor(q),gv=fract(q)-.5; float h=hash21(id+seed); vec2 off=(hash22(id+seed)-.5)*.7;
  float s=smoothstep(.03,0.,length(gv-off))*step(.91,h); float tw=.55+.45*sin(uTime*(1.2+h*2.)+h*30.);
  col+=s*tw*mix(vec3(.28,.65,1.),vec3(1.,.72,.38),step(.975,h));
  vec2 q2=p*22.; vec2 id2=floor(q2),gv2=fract(q2)-.5; float h2=hash21(id2+seed*3.7);
  col+=smoothstep(.018,0.,length(gv2-(hash22(id2)-.5)*.8))*step(.965,h2)*vec3(.3,.43,.68);
  col+=.018*vec3(.11,.2,.42)*fbm(p*2.2+seed);
  return col;
}

vec3 orbitColor(){ if(uOrbit<.5)return vec3(.35,.86,1.); if(uOrbit<1.5)return vec3(.66,.42,1.); if(uOrbit<2.5)return vec3(1.,.7,.32); return vec3(.84,.91,1.); }
float halfMask(vec2 p,float front){ return front>.5?smoothstep(-.025,.025,p.y):1.-smoothstep(-.025,.025,p.y); }

void drawOrbit(inout vec4 col,vec2 p,float front){
  if(uShowOrbit<.5)return;
  vec3 color=orbitColor(); float side=halfMask(p,front); float t=uTime*uMotion; float theta=atan(p.y/.66,p.x/2.18);
  if(uOrbit<.5){
    float dash=.3+.7*step(.34,fract((theta/6.28318+.5)*18.-t*.11));
    emit(col,color,ring(p,vec2(1.03,.309),.018)*side*dash*.78*uIntensity);
    float a=t*.48+1.3; vec2 node=vec2(cos(a)*1.03,sin(a)*.309); float nodeSide=front>.5?step(0.,node.y):step(node.y,0.);
    emit(col,vec3(.88,.98,1.),disc(p-node,.026,.008)*nodeSide);
  }else if(uOrbit<1.5){
    emit(col,color,(ring(p,vec2(.98,.294),.018)+ring(rot(p,.12),vec2(1.16,.275),.014)*.42)*side*.58*uIntensity);
    float dust=step(.57,fract((theta/6.28318+.5)*31.+t*.035)); emit(col,color,ring(p,vec2(1.05,.315),.025)*side*dust*.34);
    for(int i=0;i<4;i++){ float a=float(i)*1.5708+t*(.22+float(i)*.012); vec2 sat=vec2(cos(a)*.98,sin(a)*.294); float satSide=front>.5?step(0.,sat.y):step(sat.y,0.); float d=length(p-sat); emit(col,color,exp(-d*d*1400.)*satSide*.8); over(col,vec3(.95,.98,1.),disc(p-sat,.021,.007)*satSide); }
  }else if(uOrbit<2.5){
    float q=abs(length(p/vec2(1.08,.36))-1.); float flow=noise(vec2(theta*7.-t*.8,13.)); float band=exp(-q*q*1800.)*side*(.28+.72*flow);
    vec3 mixed=mix(vec3(.66,.38,1.),vec3(1.,.68,.25),smoothstep(-1.05,.72,p.x)); emit(col,mixed,band*1.12*uIntensity);
    emit(col,vec3(1.,.88,.58),ring(p,vec2(.91,.304),.014)*side*.82);
  }else{
    emit(col,color,ring(p,vec2(1.04,.325),.016)*side*.72*uIntensity);
    vec2 pA=rot(p,.52),pB=rot(p,-.7); emit(col,color,(ring(pA,vec2(1.12,.24),.014)*halfMask(pA,front)+ring(pB,vec2(1.12,.24),.014)*halfMask(pB,front))*.38);
    for(int i=0;i<6;i++){ float a=float(i)*1.0472+t*.18; vec2 gem=vec2(cos(a)*1.04,sin(a)*.325); float gemSide=front>.5?step(0.,gem.y):step(gem.y,0.); vec2 d=abs(rot(p-gem,.7854)); float diamond=1.-smoothstep(.022,.034,max(d.x,d.y)); emit(col,vec3(1.,.78,.32),exp(-dot(p-gem,p-gem)*750.)*gemSide*.5); over(col,vec3(1.,.95,.78),diamond*gemSide); }
  }
}

void drawHalo(inout vec4 col,vec2 p,float front){
  if(uShowHalo<.5)return;
  float r=length(p),a=atan(p.y,p.x),t=uTime*uMotion;
  if(uHalo<.5){
    float breathe=.78+.22*sin(uTime*.42);
    if(front<.5){
      float bloom=exp(-pow((r-.57)/.15,2.))*smoothstep(.43,.51,r);
      emit(col,vec3(.35,.86,1.),bloom*.16*breathe*uIntensity);
    }else emit(col,vec3(.72,.96,1.),ring(p,vec2(.486),.008)*.42*breathe*uIntensity);
  }else if(uHalo<1.5){
    if(front<.5){
      emit(col,vec3(.66,.42,1.),exp(-pow((r-.56)/.14,2.))*smoothstep(.43,.5,r)*.15*uIntensity);
      for(int k=0;k<2;k++){
        float phase=fract(uTime*.33+float(k)*.5); float rr=.49+phase*.47;
        emit(col,vec3(.69,.43,1.),ring(p,vec2(rr),.009)*(1.-phase)*(1.-phase)*.55*uIntensity);
      }
    }else emit(col,vec3(.83,.66,1.),ring(p,vec2(.486),.009)*.5*uIntensity);
  }else if(uHalo<2.5){
    float top=smoothstep(-.025,.025,p.y); float side=front>.5?1.-top:top;
    float target=.55+.035*sin(a*4.+t*.4); float curtain=exp(-pow((r-target)/.085,2.));
    float shimmer=.35+.65*(.5+.5*sin(a*3.+t*.5+sin(a*7.)*1.7));
    vec3 aurora=mix(vec3(.31,.94,.82),vec3(.66,.42,1.),.5+.5*cos(a));
    if(front<.5)emit(col,vec3(.31,.94,.82),exp(-pow((r-.59)/.16,2.))*smoothstep(.43,.5,r)*.12*uIntensity);
    emit(col,aurora,curtain*shimmer*side*.34*uIntensity);
    if(front>.5)emit(col,vec3(.55,1.,.9),ring(p,vec2(.486),.008)*.4*uIntensity);
  }else{
    vec2 q=p/.48;
    float cyc=fract(uTime/12.); float g=cyc<.60?smoothstep(0.,.60,cyc):cyc<.66?1.:max(0.,1.-((cyc-.66)/.24)/.35);
    float diffuse=1.-g; float burst=cyc>=.66&&cyc<.90?(cyc-.66)/.24:-1.; float breathe=.85+.15*sin(uTime*.28);
    if(front<.5){
      float radial=smoothstep(.43,.53,r)*(1.-smoothstep(.55,1.02,r));
      float rayA=pow(abs(cos(a*6.+t*.028)),18.); float rayB=pow(abs(cos(a*12.-t*.016)),28.);
      emit(col,vec3(.95,.72,.28),radial*(rayA*.16+rayB*.075)*diffuse*breathe*uIntensity);
      emit(col,vec3(1.,.86,.58),exp(-pow((r-.61)/.21,2.))*smoothstep(.42,.5,r)*(.07+.09*diffuse)*breathe*uIntensity);
      // Exact Claude silhouette: a broad band hidden behind the Core, five
      // filled spikes rising from its rim, and splayed outer points.
      float crown=radiantCrownShape(q,mix(.18,.12,g));
      emit(col,radiantCrownColor(q),crown*g*.60*uIntensity);
      float band=radiantLine(q,vec2(-1.30,.18),vec2(1.30,.18),.018,.035);
      emit(col,vec3(1.,.992,.94),band*crown*g*.30*uIntensity);
      if(burst>=0.){
        float flash=max(0.,1.-burst*2.2); vec2 release=q-vec2(0.,.15);
        emit(col,vec3(1.,.90,.69),pow(1.-smoothstep(0.,1.70,length(release)),2.)*flash*.36*uIntensity);
        float shards=0.;
        shards+=radiantShard(q,vec2(0.,1.70),vec2(0.,1.55),burst);
        shards+=radiantShard(q,vec2(-.60,1.20),vec2(-.60,1.05),burst); shards+=radiantShard(q,vec2(.60,1.20),vec2(.60,1.05),burst);
        shards+=radiantShard(q,vec2(-1.50,1.00),vec2(-1.50,.85),burst); shards+=radiantShard(q,vec2(1.50,1.00),vec2(1.50,.85),burst);
        shards+=radiantShard(q,vec2(-.95,.17),vec2(-.95,.02),burst); shards+=radiantShard(q,vec2(.95,.17),vec2(.95,.02),burst);
        shards+=radiantShard(q,vec2(-.45,.01),vec2(-.45,-.14),burst); shards+=radiantShard(q,vec2(.45,.01),vec2(.45,-.14),burst);
        shards+=radiantShard(q,vec2(0.,-.07),vec2(0.,-.22),burst);
        emit(col,vec3(1.,.84,.50),shards*.40*uIntensity);
      }
    }else{
      emit(col,vec3(1.,.98,.9),ring(p,vec2(.486),.007)*.6*uIntensity);
      emit(col,vec3(.95,.7,.28),ring(p,vec2(.492),.018)*.27*uIntensity);
      for(int i=0;i<8;i++){
        float fi=float(i),ang=t*.10+fi*.7854,rr=.64+.1*sin(t*.26+fi); vec2 mote=vec2(cos(ang),sin(ang))*rr*(1.-.32*g);
        float twinkle=max(0.,.3+.4*sin(uTime*.7+fi*1.7))*(.4+.6*diffuse);
        emit(col,vec3(1.,.98,.88),exp(-dot(p-mote,p-mote)*1500.)*twinkle*uIntensity);
      }
      vec2 gemDelta=q-vec2(0.,1.93);
      emit(col,vec3(.81,.59,1.),exp(-dot(gemDelta,gemDelta)*13.)*g*.34*uIntensity);
      emit(col,vec3(1.,.985,.94),radiantDiamond(q,.035)*g*.95*uIntensity);
      if(burst>=0.&&burst<.4){float apex=1.-burst/.4; vec2 d=q-vec2(0.,1.42); emit(col,vec3(1.),exp(-dot(d,d)*75.)*apex*.55*uIntensity);}
    }
  }
}

void riftCore(inout vec4 col,vec2 p){
  float rr=.48,r=length(p),body=disc(p,rr,.004); if(body<=0.)return;
  float z=sqrt(max(0.,rr*rr-dot(p,p)))/rr; vec3 n=normalize(vec3(p/rr,z)); vec2 surface=vec2(atan(n.x,n.z)/PI+n.y*.12,asin(n.y)/PI); surface.x+=uTime*.13*uMotion;
  float terrain=fbm(surface*vec2(7.,12.)+2.); float edge=cellEdge(surface*vec2(9.,13.)+vec2(uTime*.26*uMotion,0.));
  float crack=(1.-smoothstep(.018,.075,edge))*smoothstep(.25,.72,terrain+.1); float pulse=.65+.35*sin(uTime*2.3*uMotion+terrain*9.);
  float lit=max(.08,dot(n,normalize(vec3(-.5,.5,.9)))); vec3 surf=mix(vec3(.018,.025,.052),vec3(.10,.13,.20),terrain)*(.4+lit*.75);
  surf+=crack*pulse*vec3(.52,.08,1.25)*uIntensity*1.8; surf+=pow(1.-z,3.)*vec3(.05,.65,1.15)*uIntensity; surf+=pow(max(0.,dot(n,normalize(vec3(.5,-.3,.7)))),16.)*.3;
  over(col,surf,body); emit(col,vec3(.2,.76,1.15),ring(p,vec2(.49,.49),.012)*.22*uIntensity);
}

void horizonCore(inout vec4 col,vec2 p){
  float r=length(p); vec2 q=rot(p,-.19); vec2 e=vec2(q.x,q.y*4.6); float er=length(e),a=atan(e.y,e.x);
  float flow=fbm(vec2(a*1.8-uTime*.34*uMotion,er*8.)); float diskFx=exp(-pow((er-.48)*12.,2.))*(1.-smoothstep(.15,.86,abs(q.y)))*(.28+.95*flow);
  vec3 diskCol=mix(vec3(.52,.06,.88),vec3(1.25,.58,.12),smoothstep(-.75,.7,q.x)); emit(col,diskCol,diskFx*uIntensity*1.25);
  emit(col,vec3(.42,.22,.75),ring(p,vec2(.4,.4),.038)*(.4+.6*noise(vec2(a*5.-uTime*.18*uMotion,7.)))*uIntensity);
  over(col,vec3(.0002,.0004,.001),disc(p,.245,.008)); emit(col,mix(vec3(1.3,.56,.13),vec3(.55,.16,1.2),smoothstep(-.5,.5,p.y)),(ring(p,vec2(.268),.03)+ring(p,vec2(.287),.011)*.7)*uIntensity);
  emit(col,diskCol,diskFx*smoothstep(-.025,.07,-q.y)*uIntensity*.75);
}

void solarCore(inout vec4 col,vec2 p){
  float r=length(p),rr=.47,a=atan(p.y,p.x); float flareNoise=fbm(vec2(a*2.2-uTime*.12*uMotion,4.)); float corona=exp(-pow((r-(.49+.055*flareNoise))*22.,2.))*(.25+.75*flareNoise)*smoothstep(.15,.52,r);
  emit(col,vec3(1.2,.52,.08),corona*uIntensity); float body=disc(p,rr,.004); if(body<=0.)return;
  float z=sqrt(max(0.,rr*rr-dot(p,p)))/rr; vec3 n=normalize(vec3(p/rr,z)); vec2 surface=vec2(atan(n.x,n.z)/PI,asin(n.y)/PI); surface.x+=uTime*.075*uMotion;
  float terrain=fbm(surface*vec2(8.,14.)+11.); float edge=cellEdge(surface*vec2(10.,14.)+3.); float fault=(1.-smoothstep(.012,.065,edge))*smoothstep(.34,.74,terrain);
  float lit=max(.06,dot(n,normalize(vec3(-.45,.55,.9)))); vec3 surf=mix(vec3(.018,.019,.024),vec3(.14,.105,.055),terrain)*(.4+lit*.8);
  surf+=fault*(.72+.28*sin(uTime*1.7*uMotion+terrain*12.))*vec3(1.32,.55,.07)*uIntensity*1.55; surf+=pow(1.-z,3.)*vec3(1.,.38,.06)*uIntensity*.7; surf+=pow(max(0.,dot(n,normalize(vec3(.5,-.2,.8)))),24.)*.5;
  over(col,surf,body);
}

void drawCore(inout vec4 col,vec2 p){
  float time=uTime*uMotion;
  vec2 q=p/.48;
  if(uCore<.5)drawDustHomestead(col,q,time,1.13,.008,uIntensity,1.);
  else if(uCore<1.5)drawBlueMarble(col,q,time,2.37,.008,uIntensity,1.);
  else if(uCore<2.5)riftCore(col,p);
  else if(uCore<3.5)drawSovereignCore(col,q,time,5.71,.008,uIntensity,1.);
  else if(uCore<4.5)horizonCore(col,p);
  else solarCore(col,p);
}

void main(){
  vec2 p=(gl_FragCoord.xy*2.-uResolution.xy)/min(uResolution.x,uResolution.y);
  vec3 base=stars(p,1.7+uCore*4.); float grid=(smoothstep(.497,.5,abs(fract((p.x+2.)*.5)-.5))+smoothstep(.497,.5,abs(fract((p.y+2.)*.5)-.5)))*.018; base+=grid*vec3(.16,.5,.75);
  // Fit mode scales only the cosmetic assembly. The star field remains full
  // bleed while the widest Orbit and tallest Crown stay inside the viewport.
  vec2 assemblyP=(p+vec2(0.,uAssemblyOffsetY))/max(.01,uAssemblyScale);
  vec4 col=vec4(base,1.); drawHalo(col,assemblyP,0.); drawOrbit(col,assemblyP,0.); drawCore(col,assemblyP); drawOrbit(col,assemblyP,1.); drawHalo(col,assemblyP,1.);
  float vignette=1.-smoothstep(.55,1.38,length(p)); col.rgb*=.46+.54*vignette; col.rgb=1.-exp(-col.rgb*(1.08*uIntensity)); col.rgb=pow(col.rgb,vec3(.88)); gl_FragColor=vec4(col.rgb,1.);
}
`;

type Props = {
  skin: PlanetSkinId;
  /** Null deliberately renders the Core by itself, without any Orbit slot. */
  orbit: PlanetOrbitId | null;
  /** Null deliberately suppresses the independent light-aura slot. */
  halo?: PlanetHaloId | null;
  chrome?: boolean;
  staticPreview?: boolean;
  /** Leave enough safe area for every equipped Halo and Orbit to be visible. */
  fitAssembly?: boolean;
  className?: string;
};

/** High-fidelity Core + Halo + Orbit assembly used by Dossier and Relic Vault. */
export default function PlanetOrbitPreview({ skin, orbit, halo = null, chrome = true, staticPreview = false, fitAssembly = false, className = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const core = PLANET_SKINS.find((item) => item.id === skin) || PLANET_SKINS[0];
  const definition = orbit ? PLANET_ORBITS.find((item) => item.id === orbit) || PLANET_ORBITS[0] : null;
  const haloDefinition = halo ? PLANET_HALOS.find((item) => item.id === halo) || PLANET_HALOS[0] : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, powerPreference: staticPreview ? "low-power" : "high-performance" });
    if (!gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Planet preview shader");
      return shader;
    };

    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Planet preview link");
    } catch (error) {
      console.warn(error);
      return;
    }

    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const resolution = gl.getUniformLocation(program, "uResolution");
    const timeUniform = gl.getUniformLocation(program, "uTime");
    const coreUniform = gl.getUniformLocation(program, "uCore");
    const orbitUniform = gl.getUniformLocation(program, "uOrbit");
    const showOrbit = gl.getUniformLocation(program, "uShowOrbit");
    const haloUniform = gl.getUniformLocation(program, "uHalo");
    const showHalo = gl.getUniformLocation(program, "uShowHalo");
    const motion = gl.getUniformLocation(program, "uMotion");
    const intensity = gl.getUniformLocation(program, "uIntensity");
    const assemblyScale = gl.getUniformLocation(program, "uAssemblyScale");
    const assemblyOffsetY = gl.getUniformLocation(program, "uAssemblyOffsetY");
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(staticPreview ? 1.25 : 2, window.devicePixelRatio || 1);
    const start = performance.now() - 2600;
    let raf = 0;

    const draw = (now = start + 2600) => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(2, Math.round(rect.width * dpr));
      const height = Math.max(2, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; gl.viewport(0, 0, width, height); }
      gl.useProgram(program);
      gl.uniform2f(resolution, width, height);
      gl.uniform1f(timeUniform, staticPreview || reduce ? 3.4 : (now - start) / 1000);
      gl.uniform1f(coreUniform, CORE_INDEX[skin]);
      gl.uniform1f(orbitUniform, orbit ? ORBIT_INDEX[orbit] : 0);
      gl.uniform1f(showOrbit, orbit ? 1 : 0);
      gl.uniform1f(haloUniform, halo ? HALO_INDEX[halo] : 0);
      gl.uniform1f(showHalo, halo ? 1 : 0);
      gl.uniform1f(motion, staticPreview || reduce ? 0 : 1);
      gl.uniform1f(intensity, 1.08);
      gl.uniform1f(assemblyScale, fitAssembly ? .80 : 1);
      gl.uniform1f(assemblyOffsetY, fitAssembly ? .04 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    const loop = (now: number) => { draw(now); if (!staticPreview && !reduce && !document.hidden) raf = requestAnimationFrame(loop); };
    const resize = () => draw(performance.now());
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const onVisibility = () => { cancelAnimationFrame(raf); if (!staticPreview && !reduce && !document.hidden) raf = requestAnimationFrame(loop); };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(staticPreview || reduce ? draw : loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [fitAssembly, halo, orbit, skin, staticPreview]);

  const label = [core.name, haloDefinition?.name, definition?.name].filter(Boolean).join(" with ");
  return <div className={`planet-orbit-preview ${orbit ? `planet-orbit-${orbit}` : "planet-core-only"} ${halo ? `planet-halo-${halo}` : "planet-halo-none"} ${className}`.trim()}>
    <canvas ref={canvasRef} aria-label={label} />
    {chrome && (definition || haloDefinition) && <><span className="planet-orbit-tier"><i />{haloDefinition?.tier || definition?.tier}</span><small>BOUND ASSEMBLY // LIVE PREVIEW</small></>}
    {chrome && !definition && !haloDefinition && <small>CORE ISOLATION // LIGHT + ORBITS SUPPRESSED</small>}
  </div>;
}
