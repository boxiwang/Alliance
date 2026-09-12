/**
 * Radiant Crown geometry copied from Claude's canonical Halo study.
 *
 * The Crown is deliberately normalized to the planet radius rather than the
 * preview canvas. Keeping one silhouette here prevents the Vault WebGL,
 * batched Star Map WebGL and SVG fallback from drifting into three designs.
 */
export const RADIANT_CROWN_POINTS = [
  [-1.35, -0.02], [-1.62, -0.98], [-1.0, -0.06],
  [-0.62, -1.12], [-0.3, -0.04], [0, -1.62],
  [0.3, -0.04], [0.62, -1.12], [1.0, -0.06],
  [1.62, -0.98], [1.35, -0.02], [1.3, 0.5], [-1.3, 0.5],
] as const;

export function radiantCrownSvgPath(cx: number, cy: number, radius: number): string {
  const crownCenterY = cy - radius * 0.15;
  return RADIANT_CROWN_POINTS.map(([x, y], index) =>
    `${index === 0 ? "M" : "L"} ${cx + x * radius} ${crownCenterY + y * radius}`,
  ).join(" ") + " Z";
}

/**
 * Shared GLSL helpers. `q` is in planet-radius units with +Y pointing up.
 * The five triangles and broad band are the exact filled silhouette from
 * docs/mockups/planet-halos.html, including the splayed outer spikes.
 */
export const RADIANT_CROWN_GLSL = `
float radiantCross(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}
float radiantTriangle(vec2 p,vec2 a,vec2 b,vec2 c,float feather){
  float orientation=radiantCross(b-a,c-a);
  float direction=orientation<0.0?-1.0:1.0;
  float e0=direction*radiantCross(b-a,p-a)/max(length(b-a),.0001);
  float e1=direction*radiantCross(c-b,p-b)/max(length(c-b),.0001);
  float e2=direction*radiantCross(a-c,p-c)/max(length(a-c),.0001);
  return smoothstep(-feather,feather,min(e0,min(e1,e2)));
}
float radiantSegmentDistance(vec2 p,vec2 a,vec2 b){
  vec2 pa=p-a,ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h);
}
float radiantLine(vec2 p,vec2 a,vec2 b,float width,float feather){
  return 1.0-smoothstep(width,width+feather,radiantSegmentDistance(p,a,b));
}
float radiantCrownShape(vec2 q,float feather){
  float shape=0.0;
  shape=max(shape,radiantTriangle(q,vec2(-1.30,-.35),vec2(1.30,-.35),vec2(1.35,.17),feather));
  shape=max(shape,radiantTriangle(q,vec2(-1.30,-.35),vec2(1.35,.17),vec2(-1.35,.17),feather));
  shape=max(shape,radiantTriangle(q,vec2(-1.35,.17),vec2(-1.62,1.13),vec2(-1.00,.21),feather));
  shape=max(shape,radiantTriangle(q,vec2(-1.00,.21),vec2(-.62,1.27),vec2(-.30,.19),feather));
  shape=max(shape,radiantTriangle(q,vec2(-.30,.19),vec2(0.0,1.77),vec2(.30,.19),feather));
  shape=max(shape,radiantTriangle(q,vec2(.30,.19),vec2(.62,1.27),vec2(1.00,.21),feather));
  shape=max(shape,radiantTriangle(q,vec2(1.00,.21),vec2(1.62,1.13),vec2(1.35,.17),feather));
  return shape;
}
vec3 radiantCrownColor(vec2 q){
  float y=clamp((q.y+.35)/2.12,0.0,1.0);
  vec3 bronze=vec3(.69,.49,.19),gold=vec3(.953,.769,.420),white=vec3(1.0,.984,.91);
  return y<.58?mix(bronze,gold,y/.58):mix(gold,white,(y-.58)/.42);
}
float radiantDiamond(vec2 q,float feather){
  vec2 d=abs(q-vec2(0.0,1.93));
  return 1.0-smoothstep(1.0,1.0+feather,d.x/.144+d.y/.20);
}
float radiantShard(vec2 q,vec2 origin,vec2 direction,float burst){
  float eased=1.0-(1.0-burst)*(1.0-burst);
  vec2 center=origin+normalize(direction)*eased*1.2;
  float radius=.30-.12*burst;
  return exp(-dot(q-center,q-center)/max(.0001,radius*radius*.32))*(1.0-burst);
}
`;
