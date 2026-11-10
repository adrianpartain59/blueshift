// game/city_sky.js — private to city.js: deep space behind the city. One full-view shader layer
// (void, nebula, the far-city haze, an aberrated starfield, the planet crescent, the star's limb
// and its prominences, flare rays) plus the jump gate ring at the vanishing point.
// It is the backdrop, so everything in it stays dark: the city and the tube are drawn on top.
import { clamp01 } from '../engine/math.js';
import { C } from './config.js';

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform vec2 u_res; uniform float u_time;
uniform vec4 u_view;   // xy = vanishing point (logical px, y down), z = focal length in px
uniform vec2 u_rot;    // cos, sin of the camera roll
uniform vec3 u_colA;   // structure colour (gear ramp)
uniform vec3 u_colB;   // deep colour
uniform vec4 u_a;      // x star aberration scale (1 = none), y haze, z star gain, w star streak
uniform vec4 u_b;      // x planet, y star limb, z flare, w nebula
uniform vec4 u_c;      // x danger, y kick, z fade

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.7; a *= 0.5; } return s; }

// One star per cell of a sky grid. pxu = logical px per sky unit, so stars stay ~1 px however
// far the field is squeezed toward the gate; streak stretches them along the radius.
float starLayer(vec2 q, float scale, float pxu, float seed, float dens, float streak) {
  vec2 g = q * scale, id = floor(g), f = fract(g);
  float h = h21(id + seed);
  vec2 sp = 0.2 + 0.6 * vec2(h21(id + seed + 7.13), h21(id + seed + 13.71));
  vec2 dv = (f - sp) / scale * pxu;
  vec2 rd = normalize(q + 1e-5);
  float d = length(vec2(dot(dv, rd) / (1.0 + streak), dot(dv, vec2(-rd.y, rd.x))));
  float mag = h21(id + seed + 3.31); mag *= mag;
  float tw = 0.8 + 0.2 * sin(u_time * (1.5 + 5.0 * mag) + h * 40.0);
  return step(h, dens) * smoothstep(1.3, 0.25, d) * (0.25 + 1.5 * mag) * tw;
}

void main() {
  vec2 p = vec2(v_uv.x, 1.0 - v_uv.y) * u_res;
  vec2 d = (p - u_view.xy) / u_view.z; d.y = -d.y;                                // view tangent, y up
  vec2 q = vec2(u_rot.x * d.x - u_rot.y * d.y, u_rot.y * d.x + u_rot.x * d.y);    // direction in the tube frame
  float r = length(d);
  vec3 col = vec3(0.0022, 0.0008, 0.0075);

  // nebula: two slow veils in the ramp colours
  float n = fbm(q * 1.25 + vec2(3.1, -1.7));
  float n2 = fbm(q * 2.6 - vec2(n * 1.6, 8.2));
  col += (u_colB * 0.7 + vec3(0.03, 0.0, 0.05)) * pow(n, 3.2) * 0.16 * u_b.w;
  col += u_colA * pow(n2, 4.0) * 0.10 * u_b.w;

  // the far city dissolves into a soft glow around the gate
  col += u_colA * (exp(-r * 3.4) * u_a.y + exp(-r * 1.1) * u_a.y * 0.07);

  // stars, squeezed toward the gate as speed rises (relativistic aberration) and blue-shifted with it
  float c = u_a.x, pxu = u_view.z * c;
  vec2 qs = q / c;
  float st = starLayer(qs, 13.0, pxu, 1.0, 0.34 * (0.45 + 0.55 * c), u_a.w) + 0.5 * starLayer(qs, 29.0, pxu, 9.0, 0.16 * c, u_a.w);
  float hue = h21(floor(qs * 13.0) + 4.4);
  vec3 sc = mix(mix(vec3(1.0, 0.84, 0.7), vec3(0.72, 0.85, 1.0), hue), vec3(0.75, 0.9, 1.0), 1.0 - c);
  vec3 starCol = st * u_a.z * sc * (1.0 + (1.0 - c) * 1.2 * exp(-r * 2.0));

  // planet: a dark body with a thin lit crescent on the side that faces the gate
  if (u_b.x > 0.002) {
    vec2 pc = vec2(-1.22, 0.66); float pr = 0.80;
    vec2 pd = (q - pc) / pr; float pl = length(pd);
    vec3 ice = mix(u_colA, vec3(0.7, 0.88, 1.0), 0.6);
    vec2 L2 = normalize(vec2(0.62, -0.42));
    float body = smoothstep(0.0, 0.12, u_b.x);
    if (pl < 1.0) {
      float nz = sqrt(1.0 - pl * pl);
      float lam = max(dot(vec3(pd, nz), normalize(vec3(0.62, -0.42, -0.74))), 0.0);
      float bands = 0.5 + 0.5 * vnoise(vec2(pd.y * 13.0 + vnoise(pd * 4.0) * 2.5, pd.x * 1.5));
      float limbLine = smoothstep(0.955, 1.0, pl) * smoothstep(0.1, 0.8, dot(pd / pl, L2));
      vec3 lit = ice * (pow(lam, 2.0) * bands * 0.9 + limbLine * 0.6) * u_b.x;
      col = mix(col, vec3(0.0012, 0.0006, 0.003) + lit, body);
      starCol *= 1.0 - body;
    } else {
      col += ice * exp(-(pl - 1.0) * 22.0) * 0.16 * u_b.x * smoothstep(0.0, 0.9, dot(pd / pl, L2));
    }
  }
  col += starCol;

  // CORONA: the star's limb as a curved horizon under the city, with prominence loops
  if (u_b.y > 0.002) {
    float Rs = 7.0;
    vec2 dn = normalize(vec2(0.42, -0.9));                 // where "down toward the star" is in the tube frame
    vec2 sc0 = dn * (Rs + 1.02);
    vec2 sd = q - sc0;
    float dl = length(sd) - Rs;                            // < 0 inside the star
    float ang = atan(sd.x, sd.y);
    vec3 n0 = vec3(1.0, 0.19, 0.012), n1 = vec3(1.0, 0.64, 0.19);
    if (dl < 0.0) {
      float depth = clamp(-dl / 0.9, 0.0, 1.0);
      float gran = fbm(vec2(ang * 60.0 + u_time * 0.03, dl * 8.0 - u_time * 0.12));
      float cells = fbm(vec2(ang * 190.0, dl * 30.0 + u_time * 0.25));
      float hot = smoothstep(0.52, 0.8, gran) * cells;
      vec3 surf = mix(n0, n1, clamp(gran * 1.3 - 0.25 + hot, 0.0, 1.0)) * (0.03 + 0.22 * gran * gran + 0.5 * hot * hot) * (1.0 - 0.55 * depth)
                + n1 * exp(-depth * 14.0) * 0.16;
      col = mix(col, surf, u_b.y);
    } else {
      col += n0 * exp(-dl * 7.0) * 0.13 * u_b.y;           // the corona's glow
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float a0 = atan(-dn.x, -dn.y) + (fi - 1.5) * 0.085 + 0.01 * sin(u_time * 0.21 + fi * 2.1);
        vec2 base = sc0 + Rs * vec2(sin(a0), cos(a0));
        float pr2 = (0.10 + 0.085 * h21(vec2(fi, 3.7))) * (1.0 + 0.06 * sin(u_time * 0.5 + fi * 1.7));
        float dd = abs(length((q - base) * vec2(1.0, 0.8 + 0.3 * h21(vec2(fi, 9.1)))) - pr2);
        col += mix(n0, n1, 0.45) * (exp(-dd * 85.0) * 0.42 + exp(-dd * 14.0) * 0.05) * u_b.y;
      }
    }
    col += n1 * exp(-abs(dl) * 55.0) * 0.55 * u_b.y;       // the limb itself: one bright hairline
  }

  // FLARE: white-blue rays leaking from the gate
  if (u_b.z > 0.002) {
    vec2 un = d / max(r, 1e-4);
    float rays = pow(vnoise(un * 5.0 + u_time * 0.35), 3.0) + 0.6 * pow(vnoise(un * 13.0 - u_time * 0.5 + 7.0), 4.0);
    col += vec3(0.62, 0.85, 1.0) * (rays * exp(-r * 1.3) * (1.0 - exp(-r * 6.0)) * 0.26 + exp(-r * 5.5) * 0.07) * u_b.z;
  }
  o = vec4(col * u_c.z, 1.0);
}`;

export function createSky(E) {
  const { gfx } = E;
  let layer = null;
  try { layer = gfx.createLayer(FS); } catch (err) { layer = null; console.error('city sky shader failed, using the flat backdrop: ' + err.message); }
  const gateCol = [0, 0, 0];

  // uniform values for this frame: aberration, haze, star gain, streak, planet, limb, flare, nebula,
  // fade (in a typed array, so neither draw() nor the setter below allocates)
  const U = new Float64Array(9);
  const setU = (gl, u) => {
    const f = E.frame;
    gl.uniform4f(u.u_view, E.vpx, E.vpy, E.focal, 0);
    gl.uniform2f(u.u_rot, Math.cos(f.roll), Math.sin(f.roll));
    gl.uniform3f(u.u_colA, E.colA[0], E.colA[1], E.colA[2]);
    gl.uniform3f(u.u_colB, E.colB[0], E.colB[1], E.colB[2]);
    gl.uniform4f(u.u_a, U[0], U[1], U[2], U[3]);
    gl.uniform4f(u.u_b, U[4], U[5], U[6], U[7]);
    gl.uniform4f(u.u_c, E.danger, E.kick, U[8], 0);
  };

  function draw() {
    const f = E.frame;
    const g = clamp01((f.gearF - 1) / 4);
    // the faster you go, the more the sky bunches ahead of you
    U[0] = 1 - 0.5 * g - 0.14 * E.gFlare;
    U[3] = g * g * 1.6 + E.gFlare * 1.0;
    U[2] = 0.42 + 0.04 * g + 0.08 * E.gFlare - 0.1 * E.gStar;
    U[1] = (0.075 + 0.03 * f.kick) * (1 - 0.6 * E.gStar) * (0.6 + 0.4 * E.boost) * (0.4 + 0.6 * E.kF);
    const planet = 0.38 + 0.62 * E.gShat - 0.6 * E.gStar - 0.12 * E.gSign;
    U[4] = planet < 0 ? 0 : planet;
    U[5] = E.gStar;
    U[6] = E.gFlare;
    U[7] = 1 - 0.5 * E.gStar;
    U[8] = E.capOn ? 0 : 1;
    if (layer) layer.draw(E.time, setU);
    else gfx.rectGrad(0, 0, E.W, E.H, C.void0, 1, 1, C.void1, 1, 1);
    if (E.capOn) return;

    // THE JUMP GATE: a small bright ring exactly where the rails converge. The one thing allowed there.
    const x = E.vpx, y = E.vpy;
    const rad = Math.max(6.5, 13 * E.focal / 648) * (1 + 0.06 * f.kick);      // ~10 px: small, but the brightest thing we own
    gateCol[0] = 0.62 + 0.3 * E.gFlare; gateCol[1] = 0.9; gateCol[2] = 1;
    gfx.glow(x, y, rad * 5.5, E.colC, 0.16 + 0.05 * f.kick, 2);
    gfx.glow(x, y, rad * 1.5, gateCol, 0.30, 1.6);
    gfx.line(x - rad * 4.2, y, x + rad * 4.2, y, 0.9, gateCol, 0.22, 5);     // anamorphic streak
    gfx.ring(x, y, rad, 1.3, gateCol, 1.05 + 0.25 * f.kick, 4);
    gfx.ring(x, y, rad * 0.55, 0.9, E.colC, 0.5, 3);
    // four docking ticks, turning slowly: it is a machine, not a star
    const a0 = E.t * 0.25;
    for (let i = 0; i < 4; i++) {
      const a = a0 + i * 1.5708, cx = Math.cos(a), sy = Math.sin(a);
      gfx.line(x + cx * rad * 1.25, y + sy * rad * 1.25, x + cx * rad * 1.75, y + sy * rad * 1.75, 0.9, gateCol, 0.55, 3);
    }
  }
  return { draw };
}
