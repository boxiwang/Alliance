import { useEffect, useRef } from "react";
import type { Point } from "./lib/world-engine";

// Local copy of World's marker-scale curve (kept in sync) so this module does
// not create a circular import with World.tsx.
function worldMarkerScale(zoom: number): number {
  const s = Math.max(1, Math.min(16, zoom));
  const boost = s <= 3 ? 1 : Math.min(2, 1 + Math.log2(s / 3) * 0.45);
  return boost / s;
}

// Full WebGL rendering of the "Void-Touched / Rift Sovereign" premium planet skin
// (adapted from the sovereign-skins showcase shader). This runs ONLY for the
// player's own home planet, only on the local machine, and only while the planet
// is on-screen at Field zoom or deeper — a single small canvas tracking the SVG
// map, not a per-marker cost. Other players never render your shader.
//
// The canvas is a tight box centred on the planet (body + halo + void-scar tail),
// so the fragment shader only runs over the planet footprint, and it composites
// transparently over the SVG star map. When WebGL is unavailable, or at Strategic
// zoom, or off-screen, it goes inert and World falls back to the SVG skin.

const VERTEX = `
attribute vec2 aPosition;
void main(){ gl_Position = vec4(aPosition, 0., 1.); }
`;

// planet radius rr=.48 in local space maps to uRadius device pixels.
const FRAGMENT = `
precision highp float;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uTime;
uniform float uIntensity;
float hash21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2 hash22(vec2 p){ float n=sin(dot(p,vec2(41.,289.))); return fract(vec2(262144.,32768.)*n); }
float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y); }
float fbm(vec2 p){ float v=0.,a=.5; mat2 m=mat2(.8,.6,-.6,.8);
  for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p*2.03+17.1; a*=.5; } return v; }
float cellEdge(vec2 x){ vec2 n=floor(x),f=fract(x); float md=8.,sd=8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=hash22(n+g);
    vec2 r=g+o-f; float d=dot(r,r); if(d<md){ sd=md; md=d; } else if(d<sd){ sd=d; } }
  return sqrt(sd)-sqrt(md); }
vec2 rot(vec2 p,float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c)*p; }
float ring(vec2 p,float radius,float width){ return exp(-pow((length(p)-radius)/width,2.)); }
float sparks(vec2 p,float seed,float radius){ float a=atan(p.y,p.x); float r=length(p);
  float bands=step(.985,hash21(vec2(floor((a+3.14159)*18.),seed)));
  float rr=radius+.09*sin(a*7.+seed*4.+uTime*.35); return bands*exp(-pow((r-rr)*65.,2.)); }

void main(){
  vec2 p=(gl_FragCoord.xy-uCenter)/(uRadius/0.48);
  vec3 col=vec3(0.); float alpha=0.;
  float t=uTime*.13;

  // Void-scar tail
  vec2 tailP=rot(p-vec2(.42,-.03),-.16);
  float tail=exp(-abs(tailP.y)*15.)*(1.-smoothstep(-.08,.78,tailP.x))*smoothstep(-.05,.15,tailP.x);
  tail*=.35+.65*noise(vec2(tailP.x*7.-uTime*.5,tailP.y*12.));
  col+=tail*vec3(.48,.06,1.1)*uIntensity; alpha=max(alpha,tail*.85);

  // Obsidian body with living violet fractures
  float rr=.48; float r=length(p);
  float planet=1.-smoothstep(rr,rr+.006,r);
  if(planet>0.){
    float z=sqrt(max(0.,rr*rr-dot(p,p)))/rr;
    vec3 n=normalize(vec3(p/rr,z));
    vec2 surface=vec2(atan(n.x,n.z)/3.14159+n.y*.12,asin(n.y)/3.14159);
    surface.x+=t;
    float terrain=fbm(surface*vec2(7.,12.)+2.);
    float edge=cellEdge(surface*vec2(9.,13.)+vec2(t*2.,0.));
    float crack=(1.-smoothstep(.018,.075,edge))*smoothstep(.25,.72,terrain+.1);
    float pulse=.65+.35*sin(uTime*2.3+terrain*9.);
    vec3 dark=mix(vec3(.018,.025,.052),vec3(.10,.13,.20),terrain);
    vec3 lightDir=normalize(vec3(-.5,.5,.9));
    float lit=max(.08,dot(n,lightDir));
    vec3 surf=dark*(.4+lit*.75);
    surf+=crack*pulse*vec3(.52,.08,1.25)*uIntensity*1.8;
    surf+=pow(1.-z,3.)*vec3(.05,.65,1.15)*uIntensity;
    surf+=pow(max(0.,dot(n,normalize(vec3(.5,-.3,.7)))),16.)*.3;
    col=mix(col,surf,planet); alpha=max(alpha,planet);
  }

  // Cyan-violet orbit halo + sparks
  float halo=ring(p,.59,.006)*(.55+.45*sin(atan(p.y,p.x)*4.-uTime*.8));
  float outer=ring(p,.65,.0025)*.35;
  vec3 glow=halo*vec3(.16,.82,1.2)+outer*vec3(.65,.35,1.);
  col+=glow*uIntensity; alpha=max(alpha,clamp((halo+outer)*1.1,0.,1.));
  float sp=sparks(p,2.3,.64);
  col+=sp*vec3(.45,.88,1.2)*uIntensity; alpha=max(alpha,clamp(sp,0.,1.));

  col=1.-exp(-col*1.05); col=pow(col,vec3(.88));
  gl_FragColor=vec4(col,clamp(alpha,0.,1.));
}
`;

type Props = {
  svgRef: React.RefObject<SVGSVGElement>;
  home: Point;
  zoom: number;
  strategic: boolean;
  /** Reports whether the shader is actively covering the planet, so the caller can hide its SVG skin. */
  onActiveChange?: (active: boolean) => void;
};

export default function VoidPlanetOverlay({ svgRef, home, zoom, strategic, onActiveChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest reactive values, read inside the rAF loop without re-subscribing it.
  const latest = useRef({ home, zoom, strategic });
  latest.current = { home, zoom, strategic };
  const activeRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: false, powerPreference: "low-power" });
    if (!gl) return; // no WebGL → World keeps the SVG skin
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "shader");
      return shader;
    };
    let program: WebGLProgram;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "link");
    } catch { return; } // compile failure → SVG fallback stays
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const uCenter = gl.getUniformLocation(program, "uCenter");
    const uRadius = gl.getUniformLocation(program, "uRadius");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uIntensity = gl.getUniformLocation(program, "uIntensity");
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);

    let raf = 0;
    let start = performance.now();
    const setActive = (value: boolean) => {
      if (activeRef.current === value) return;
      activeRef.current = value;
      canvas.style.display = value ? "block" : "none";
      onActiveChange?.(value);
    };

    const draw = (time: number) => {
      raf = window.requestAnimationFrame(draw);
      const svg = svgRef.current;
      const { home: h, zoom: z, strategic: strat } = latest.current;
      if (!svg || strat) { setActive(false); return; }
      const rect = svg.getBoundingClientRect();
      const shell = canvas.parentElement?.getBoundingClientRect();
      if (!shell || rect.width < 2) { setActive(false); return; }

      // Follow the browser's exact viewBox transform. The SVG is letterboxed on
      // many screen ratios; manual X/Y ratios drift vertically while panning.
      const matrix = svg.getScreenCTM();
      if (!matrix) { setActive(false); return; }
      const point = svg.createSVGPoint(); point.x = h.x; point.y = h.y;
      const screen = point.matrixTransform(matrix);
      const screenX = screen.x - shell.left;
      const screenY = screen.y - shell.top;
      const worldUnitPx = Math.hypot(matrix.a, matrix.b);
      const radiusPx = 9 * worldMarkerScale(z) * 1.35 * worldUnitPx;
      const half = 3.6 * radiusPx; // covers body + halo (1.52r) + void tail (~3.3r)

      // Off-screen (with the footprint fully past an edge) → go inert, let SVG handle it.
      if (screenX + half < 0 || screenY + half < 0 || screenX - half > shell.width || screenY - half > shell.height || radiusPx < 3) {
        setActive(false); return;
      }
      setActive(true);
      if (document.hidden) return; // keep last frame, spend nothing while hidden

      const sizePx = Math.max(4, half * 2);
      canvas.style.left = `${screenX - half}px`;
      canvas.style.top = `${screenY - half}px`;
      canvas.style.width = `${sizePx}px`;
      canvas.style.height = `${sizePx}px`;
      const dev = Math.max(4, Math.round(sizePx * dpr));
      if (canvas.width !== dev || canvas.height !== dev) { canvas.width = dev; canvas.height = dev; }
      gl.viewport(0, 0, dev, dev);
      gl.useProgram(program);
      gl.uniform2f(uCenter, dev / 2, dev / 2);
      gl.uniform1f(uRadius, radiusPx * dpr);
      gl.uniform1f(uTime, reducedMotion ? 6 : (time - start) / 1000);
      gl.uniform1f(uIntensity, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    raf = window.requestAnimationFrame(draw);
    return () => {
      // NB: do NOT call WEBGL_lose_context here. Under React StrictMode the effect
      // is mounted → cleaned up → remounted in dev; losing the context would leave
      // the remount's getContext() returning the same now-dead context (nothing
      // draws). Just stop the loop; the context is reclaimed on real unmount.
      window.cancelAnimationFrame(raf);
      onActiveChange?.(false);
    };
  }, [svgRef, onActiveChange]);

  return <canvas ref={canvasRef} className="world-void-canvas" aria-hidden="true" style={{ display: "none" }} />;
}
