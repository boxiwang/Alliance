/**
 * Shared procedural Core shaders used by both the Relic Vault preview and the
 * batched Star Map renderer. Coordinates are normalized to a unit planet disk
 * with +Y pointing up. This keeps Claude's new bodies visually recognizable at
 * both presentation and tactical scale without maintaining two designs.
 */
export const PLANET_CORE_GLSL = `
float coreDisk(vec2 q,float aa){return 1.0-smoothstep(1.0-aa,1.0+aa,length(q));}
float coreRim(vec2 q,float width,float aa){return exp(-pow((length(q)-1.0)/max(width,aa),2.0));}
vec3 coreNormal(vec2 q){float z=sqrt(max(0.0,1.0-dot(q,q)));return normalize(vec3(q,z));}
vec2 coreSurface(vec3 n,float time,float speed){return vec2(atan(n.x,n.z)/PI+n.y*.12+time*speed,asin(n.y)/PI);}

void drawDustHomestead(inout vec4 col,vec2 q,float time,float seed,float aa,float intensity,float detail){
  float r=length(q),body=coreDisk(q,aa); if(body<=0.0)return;
  vec3 n=coreNormal(q); float z=max(0.0,n.z);
  float sun=max(.06,dot(n,normalize(vec3(-.48,.56,.78))));
  vec2 uv=coreSurface(n,time,.020);
  float grain=fbm(uv*vec2(3.2,7.0)+vec2(seed*7.0,4.0));
  float dustBand=.5+.5*sin(q.y*18.0+noise(vec2(q.x*5.0+seed,time*.025))*3.0);
  vec3 base=mix(vec3(.15,.105,.062),vec3(.57,.43,.27),grain)*(.30+.82*sun);
  base=mix(base,base*vec3(.58,.50,.42),dustBand*.10);
  base*=.70+.30*pow(z,.55);
  over(col,base,body);
  for(int i=0;i<18;i++){
    float fi=float(i);
    float u=hash21(vec2(fi+7.0,seed*37.0+2.0));
    float v=.12+hash21(vec2(fi+41.0,seed*19.0+8.0))*.76;
    float phase=(u+time*.020)*6.2831853;
    float depth=cos(phase);
    if(depth>.14){
      vec2 center=vec2(sin(phase)*.92,(v-.5)*1.72);
      float radius=.05+hash21(vec2(fi+81.0,seed*53.0+1.0))*.11;
      vec2 d=q-center; float ellipse=length(vec2(d.x/max(.08,depth),d.y/.82));
      float crater=(1.0-smoothstep(radius,radius+aa*2.0,ellipse))*min(1.0,(depth-.14)*1.6)*body;
      over(col,vec3(.105,.073,.042),crater*.48);
      float lip=exp(-pow((ellipse-radius*.88)/max(.008,radius*.12),2.0))*min(1.0,(depth-.14)*1.6)*body;
      emit(col,vec3(.76,.66,.49),lip*.11*intensity);
    }
  }
  over(col,vec3(.055,.038,.022),coreRim(q,.022,aa)*.58);
}

void drawBlueMarble(inout vec4 col,vec2 q,float time,float seed,float aa,float intensity,float detail){
  float r=length(q),body=coreDisk(q,aa); if(body<=0.0)return;
  vec3 n=coreNormal(q); float z=max(0.0,n.z);
  vec2 uv=coreSurface(n,time,.012);
  float continental=fbm(uv*vec2(3.1,5.0)+vec2(seed*5.0,7.0));
  continental+=noise(uv*vec2(8.0,11.0)+13.0)*.19;
  float land=smoothstep(.59,.69,continental)*smoothstep(.04,.18,z);
  float terrain=fbm(uv*vec2(9.0,13.0)+21.0);
  vec3 ocean=mix(vec3(.018,.14,.25),vec3(.055,.38,.59),terrain*.45);
  vec3 earth=mix(vec3(.20,.35,.15),vec3(.52,.43,.24),smoothstep(.38,.74,terrain));
  vec3 base=mix(ocean,earth,land);
  float polar=smoothstep(.76,.94,abs(n.y))*smoothstep(.02,.28,z);
  base=mix(base,vec3(.80,.91,.96),polar*.74);
  float cloudField=fbm(uv*vec2(7.0,11.0)+vec2(time*.020+31.0,seed*8.0));
  float clouds=smoothstep(.67,.78,cloudField)*smoothstep(.05,.24,z);
  base=mix(base,vec3(.91,.96,1.0),clouds*.58);
  float daylight=smoothstep(-.34,.56,dot(n,normalize(vec3(-.56,.48,.79))));
  base*=.16+.84*daylight;
  base=mix(vec3(.006,.026,.058),base,.42+.58*pow(z,.38));
  over(col,base,body);
  emit(col,vec3(.25,.76,1.0),coreRim(q,.018,aa)*(.22+.22*daylight)*intensity);
  emit(col,vec3(.73,.91,1.0),coreRim(q,.008,aa)*smoothstep(-.1,.7,-q.x+q.y)*.22*intensity);
}

void drawSovereignCore(inout vec4 col,vec2 q,float time,float seed,float aa,float intensity,float detail){
  float r=length(q),body=coreDisk(q,aa); if(body<=0.0)return;
  vec3 n=coreNormal(q); float z=max(0.0,n.z);
  vec2 uv=coreSurface(n,time,.040);
  float churn=fbm(uv*vec2(7.0,12.0)+vec2(seed*9.0,time*.08));
  float cells=fbm(uv*vec2(15.0,20.0)-vec2(time*.11,seed*4.0));
  vec3 hot=mix(vec3(1.0,.91,.58),vec3(1.0,.52,.08),smoothstep(.30,.78,churn));
  hot=mix(hot,vec3(1.0,.985,.90),smoothstep(.72,.95,cells)*.72);
  hot=mix(hot,vec3(.37,.065,.006),smoothstep(.60,1.0,r)*.72);
  hot*=.70+.30*pow(z,.32);
  over(col,hot,body);
  if(detail>.5){
    for(int i=0;i<14;i++){
      float fi=float(i);
      float u=hash21(vec2(fi+11.0,seed*31.0+4.0));
      float v=.10+hash21(vec2(fi+47.0,seed*17.0+3.0))*.80;
      float phase=(u+time*.035)*6.2831853;
      float depth=cos(phase);
      if(depth>.08){
        vec2 center=vec2(sin(phase)*.92,(v-.5)*1.72);
        float period=1.5+hash21(vec2(fi+73.0,seed*43.0))*2.4;
        float cycle=fract(time/period+hash21(vec2(fi+97.0,seed*59.0)));
        float flare=pow(max(0.0,sin(cycle*PI)),1.6);
        float size=(.14+hash21(vec2(fi+121.0,seed*71.0))*.18)*(.45+.75*flare)*max(.4,depth);
        vec2 d=q-center; float glow=exp(-dot(d,d)/max(.002,size*size*.30))*flare*depth*body;
        emit(col,vec3(1.0,.67,.18),glow*.45*intensity);
        emit(col,vec3(1.0,.985,.91),glow*smoothstep(.55,.92,flare)*.46*intensity);
      }
    }
    for(int i=0;i<4;i++){
      float fi=float(i),u=hash21(vec2(fi+151.0,seed*23.0));
      float v=.25+hash21(vec2(fi+163.0,seed*29.0))*.50;
      float phase=(u+time*.030)*6.2831853,depth=cos(phase);
      if(depth>.14){
        vec2 center=vec2(sin(phase)*.92,(v-.5)*1.72);
        float size=.09+hash21(vec2(fi+181.0,seed*37.0))*.08;
        vec2 d=q-center; float spot=exp(-dot(vec2(d.x/max(.12,depth),d.y),vec2(d.x/max(.12,depth),d.y))/(size*size))*depth*body;
        over(col,vec3(.23,.055,.008),spot*.38);
      }
    }
  }
  float breath=.85+.15*sin(time*.9+seed*4.0);
  vec2 heart=q-vec2(-.10,.10); emit(col,vec3(1.0,.98,.86),exp(-dot(heart,heart)*4.6)*body*.30*breath*intensity);
  over(col,vec3(.20,.025,.002),smoothstep(.66,1.0,r)*.42*body);
  emit(col,vec3(1.0,.86,.50),coreRim(q,.012,aa)*.62*intensity);
}
`;
