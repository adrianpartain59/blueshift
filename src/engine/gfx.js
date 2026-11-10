// engine/gfx.js — WebGL2 neon batch renderer with HDR bloom and a post-processing stack.
// No dependencies. Everything the game draws goes through one premultiplied-alpha batch:
//   rgb = emitted light (HDR, may exceed 1), a = how much the fragment blocks what is behind it.
//   a = 0 -> pure additive glow, a = 1 -> opaque. One blend state, one draw call per ~16k quads.
// Coordinates are "logical units": the view is always H = 720 units tall, y grows downward,
// (0,0) is the top-left of the view and W depends on the window aspect ratio.

const FLOATS = 11; // x y | u v | r g b a | mode p0 p1
const MAX_QUADS = 16384;
const MODE_SOLID = 0, MODE_LINE = 1, MODE_GLOW = 2, MODE_RING = 3, MODE_DISC = 4;

export const VIEW_H = 720;
const MIN_W = 960, MAX_W = 1760;

const VS_BATCH = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in vec4 a_color;
layout(location=3) in vec3 a_params;
uniform vec2 u_res;
out vec2 v_uv; out vec4 v_color; out vec3 v_params;
void main() {
  v_uv = a_uv; v_color = a_color; v_params = a_params;
  vec2 c = a_pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
}`;

const FS_BATCH = `#version 300 es
precision highp float;
in vec2 v_uv; in vec4 v_color; in vec3 v_params;
uniform float u_ldr;   // 1 while drawing the overlay straight into the display-referred buffer
out vec4 o;
// Hue-preserving tonemap: compress the brightest channel, keep the colour ratio, and let only
// very hot light bleed toward white. Keeps neon saturated instead of washing it to pastel.
vec3 tonemap(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  if (m > 1e-5) {
    float t = 1.0 - exp(-m);
    float w = smoothstep(1.2, 9.0, m) * 0.75;
    c = mix(c / m, vec3(1.0), w) * t;
  }
  return pow(c, vec3(1.0 / 2.2));
}
void main() {
  float mode = v_params.x;
  if (mode < 0.5) {
    // SOLID. p0 > 0.5 enables analytic edge anti-aliasing (uv spans -1..1 across the quad).
    float cov = 1.0;
    if (v_params.y > 0.5) {
      vec2 fw = fwidth(v_uv) * 1.25;
      vec2 e = smoothstep(vec2(1.0), vec2(1.0) - fw, abs(v_uv));
      cov = e.x * e.y;
    }
    o = v_color * cov;
  } else if (mode < 1.5) {
    // LINE: a capsule. uv.x runs along the segment in radius units, uv.y across (-1..1).
    // p0 = half length / radius, p1 = core radius / quad radius.
    vec2 q = vec2(max(abs(v_uv.x) - v_params.y, 0.0), v_uv.y);
    float d = length(q);
    float aa = fwidth(d) + 1e-4;
    float core = 1.0 - smoothstep(v_params.z - aa, v_params.z + aa, d);
    float h = max(1.0 - d, 0.0);
    float halo = h * h * h;
    float lum = dot(v_color.rgb, vec3(0.3333));
    vec3 rgb = v_color.rgb * (core + halo * 0.55) + vec3(lum) * core * 0.75;
    o = vec4(rgb, v_color.a * core);
  } else if (mode < 2.5) {
    // GLOW: radial falloff sprite. p0 = falloff exponent.
    float g = pow(max(1.0 - length(v_uv), 0.0), v_params.y);
    o = v_color * g;
  } else if (mode < 3.5) {
    // RING: p0 = ring radius / quad radius, p1 = half thickness / quad radius.
    float d = abs(length(v_uv) - v_params.y);
    float aa = fwidth(d) + 1e-4;
    float core = 1.0 - smoothstep(v_params.z - aa, v_params.z + aa, d);
    float hw = max(1.0 - v_params.y, 1e-3);
    float h = max(1.0 - d / hw, 0.0);
    float halo = h * h * h;
    float lum = dot(v_color.rgb, vec3(0.3333));
    vec3 rgb = v_color.rgb * (core + halo * 0.55) + vec3(lum) * core * 0.75;
    o = vec4(rgb, v_color.a * core);
  } else {
    // DISC: filled circle with an anti-aliased edge.
    float d = length(v_uv);
    float aa = fwidth(d) + 1e-4;
    o = v_color * (1.0 - smoothstep(1.0 - aa * 1.5, 1.0, d));
  }
  if (u_ldr > 0.5) o.rgb = tonemap(o.rgb);
}`;

const VS_FULL = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec2 u_texel; uniform float u_threshold; uniform float u_first;
in vec2 v_uv; out vec4 o;
void main() {
  vec2 t = u_texel;
  vec3 a = texture(u_tex, v_uv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture(u_tex, v_uv + t * vec2( 0.0, 2.0)).rgb;
  vec3 c = texture(u_tex, v_uv + t * vec2( 2.0, 2.0)).rgb;
  vec3 d = texture(u_tex, v_uv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(u_tex, v_uv).rgb;
  vec3 f = texture(u_tex, v_uv + t * vec2( 2.0, 0.0)).rgb;
  vec3 g = texture(u_tex, v_uv + t * vec2(-2.0,-2.0)).rgb;
  vec3 h = texture(u_tex, v_uv + t * vec2( 0.0,-2.0)).rgb;
  vec3 i = texture(u_tex, v_uv + t * vec2( 2.0,-2.0)).rgb;
  vec3 j = texture(u_tex, v_uv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture(u_tex, v_uv + t * vec2( 1.0, 1.0)).rgb;
  vec3 l = texture(u_tex, v_uv + t * vec2(-1.0,-1.0)).rgb;
  vec3 m = texture(u_tex, v_uv + t * vec2( 1.0,-1.0)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (u_first > 0.5) {
    // soft-knee bright pass, clamped so a single hot pixel cannot explode the bloom
    col = min(col, vec3(24.0));
    float br = max(col.r, max(col.g, col.b));
    float knee = u_threshold * 0.6 + 1e-4;
    float soft = clamp(br - u_threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    col *= max(soft, br - u_threshold) / max(br, 1e-4);
  }
  o = vec4(col, 1.0);
}`;

const FS_UP = `#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform vec2 u_texel; uniform float u_weight;
in vec2 v_uv; out vec4 o;
void main() {
  vec2 t = u_texel;
  vec3 s = texture(u_tex, v_uv + t * vec2(-1.0, 1.0)).rgb + texture(u_tex, v_uv + t * vec2(1.0, 1.0)).rgb
         + texture(u_tex, v_uv + t * vec2(-1.0,-1.0)).rgb + texture(u_tex, v_uv + t * vec2(1.0,-1.0)).rgb;
  s += 2.0 * (texture(u_tex, v_uv + t * vec2(0.0, 1.0)).rgb + texture(u_tex, v_uv + t * vec2(0.0,-1.0)).rgb
            + texture(u_tex, v_uv + t * vec2(-1.0, 0.0)).rgb + texture(u_tex, v_uv + t * vec2(1.0, 0.0)).rgb);
  s += 4.0 * texture(u_tex, v_uv).rgb;
  o = vec4(s / 16.0 * u_weight, 1.0);
}`;

const GLSL_TONEMAP = `
// Hue-preserving tonemap: compress the brightest channel, keep the colour ratio, and let only
// very hot light bleed toward white. Keeps neon saturated instead of washing it to pastel.
vec3 tonemap(vec3 c) {
  float m = max(c.r, max(c.g, c.b));
  if (m > 1e-5) {
    float t = 1.0 - exp(-m);
    float w = smoothstep(1.2, 9.0, m) * 0.75;
    c = mix(c / m, vec3(1.0), w) * t;
  }
  return pow(c, vec3(1.0 / 2.2));
}
`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D u_scene; uniform sampler2D u_bloom;
uniform float u_bloomK, u_exposure, u_time, u_contrast, u_aspect, u_rblur;
uniform vec2 u_center;
uniform vec4 u_shock[4];    // xy = center (uv), z = radius, w = strength (aspect-corrected uv units)
uniform float u_shockW[4];  // band width
in vec2 v_uv; out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
${GLSL_TONEMAP}
void main() {
  vec2 uv = v_uv;
  // shockwave ripples bend the world (not the HUD overlay, which is drawn after this pass)
  for (int i = 0; i < 4; i++) {
    vec4 s = u_shock[i];
    if (s.w != 0.0) {
      vec2 d = (uv - s.xy) * vec2(u_aspect, 1.0);
      float dist = length(d) + 1e-5;
      float w = (dist - s.z) / u_shockW[i];
      uv += (d / dist) * s.w * exp(-w * w) / vec2(u_aspect, 1.0);
    }
  }
  vec3 c;
  if (u_rblur > 0.0) {
    // radial blur in HDR, before tonemapping, so bright neon streaks instead of smearing grey
    vec2 dir = uv - u_center;
    vec3 acc = vec3(0.0); float wsum = 0.0;
    for (int i = 0; i < 12; i++) {
      float t = float(i) / 11.0;
      float w = 1.0 - t * 0.7;
      acc += texture(u_scene, uv - dir * u_rblur * t).rgb * w;
      wsum += w;
    }
    c = acc / wsum;
  } else {
    c = texture(u_scene, uv).rgb;
  }
  c = (c + texture(u_bloom, uv).rgb * u_bloomK) * u_exposure;
  c = tonemap(c);
  c = mix(c, c * c * (3.0 - 2.0 * c), u_contrast);
  // triangular dither: kills banding in the dark gradients space scenes are made of
  float n = hash(gl_FragCoord.xy + fract(u_time) * 61.0) + hash(gl_FragCoord.yx * 1.31 + fract(u_time) * 17.0) - 1.0;
  o = vec4(c + n / 255.0, 1.0);
}`;

const FS_FINAL = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_time;
uniform float u_ab, u_vig, u_scan, u_grain, u_flash, u_glitch, u_barrel, u_sat, u_invert, u_zoom, u_fade;
uniform vec3 u_flashColor, u_tint;
uniform vec2 u_offset, u_center;
in vec2 v_uv; out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main() {
  vec2 uv = v_uv;
  uv = (uv - 0.5) / u_zoom + 0.5 + u_offset;
  vec2 c = uv - 0.5;
  uv = 0.5 + c * (1.0 + u_barrel * dot(c, c));
  if (u_glitch > 0.0) {
    float band = floor(uv.y * 28.0 + floor(u_time * 24.0) * 3.7);
    float n = hash(vec2(band, floor(u_time * 24.0)));
    if (n > 1.0 - u_glitch * 0.45) uv.x += (hash(vec2(band, 9.1 + floor(u_time * 24.0))) - 0.5) * 0.12 * u_glitch;
  }
  vec2 dir = uv - u_center;
  // grows toward the edges like a lens, but levels off: the HUD lives in the corners and has to stay readable
  float amt = u_ab * (0.35 + min(dot(dir, dir), 0.1) * 3.0);
  vec3 col = vec3(texture(u_tex, uv + dir * amt).r, texture(u_tex, uv).g, texture(u_tex, uv - dir * amt).b);
  // outside the frame (after distortion) is black
  vec2 inb = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  col *= inb.x * inb.y;
  float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 * 0.6667);
  col *= 1.0 - u_scan * scan * (0.6 + 0.4 * (1.0 - dot(col, vec3(0.333))));
  col *= 1.0 - u_vig * smoothstep(0.25, 1.05, length(c * vec2(1.0, 1.15)) * 1.35);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, u_sat) * u_tint;
  col = mix(col, 1.0 - col, u_invert);
  col += u_flashColor * u_flash;
  col += (hash(gl_FragCoord.xy * 0.71 + fract(u_time * 7.13) * 91.0) - 0.5) * u_grain;
  o = vec4(col * u_fade, 1.0);
}`;

const POST_DEFAULTS = {
  time: 0, exposure: 1.0, bloom: 1.0, bloomThreshold: 0.9, bloomSpread: 0.72, contrast: 0.35,
  aberration: 0.0012, vignette: 0.42, scanlines: 0.08, grain: 0.035,
  flash: 0, flashColor: [1, 1, 1], glitch: 0, radialBlur: 0, barrel: 0.02,
  saturation: 1, tint: [1, 1, 1], invert: 0, zoom: 1, fade: 1,
  offsetX: 0, offsetY: 0, centerX: 0.5, centerY: 0.5,
  shockwaves: null, // array of {x, y, radius, width, strength} in uv space (0..1, y down)
};

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    throw new Error('Shader compile failed: ' + log + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
  }
  return s;
}
function link(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { program: p, u: uniforms };
}

export function createGfx(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer,
  });
  if (!gl) return null;
  const hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  gl.getExtension('OES_texture_float_linear');
  const IFMT = hdr ? gl.RGBA16F : gl.RGBA8;

  const batch = link(gl, VS_BATCH, FS_BATCH);
  const pDown = link(gl, VS_FULL, FS_DOWN);
  const pUp = link(gl, VS_FULL, FS_UP);
  const pComposite = link(gl, VS_FULL, FS_COMPOSITE);
  const pFinal = link(gl, VS_FULL, FS_FINAL);

  // ---- batch buffers
  const vdata = new Float32Array(MAX_QUADS * 4 * FLOATS);
  const idata = new Uint16Array(MAX_QUADS * 6);
  for (let i = 0, v = 0; i < idata.length; i += 6, v += 4) {
    idata[i] = v; idata[i + 1] = v + 1; idata[i + 2] = v + 2;
    idata[i + 3] = v; idata[i + 4] = v + 2; idata[i + 5] = v + 3;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vdata.byteLength, gl.DYNAMIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idata, gl.STATIC_DRAW);
  const STRIDE = FLOATS * 4;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, STRIDE, 8);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE, 16);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE, 32);
  gl.bindVertexArray(null);
  const emptyVao = gl.createVertexArray();

  // ---- state
  let vn = 0;            // floats written
  let quads = 0;
  let W = 1280, H = VIEW_H;       // logical view size
  let pxScale = 1;                // device pixels per logical unit
  let vpX = 0, vpY = 0, vpW = 1, vpH = 1; // viewport rect on the canvas, device px
  let scene = null, ldr = null, mips = [];
  let renderScale = opts.renderScale || 1;
  const maxPixelRatio = opts.maxPixelRatio || 2;
  const stats = { quads: 0, draws: 0, hdr };
  let frameQuads = 0, frameDraws = 0;
  let inPass = false;

  // transform: | a c tx |
  //            | b d ty |
  // Transform, scale and fade live in a typed array, not in closure variables: V8 boxes a double
  // every time one is written to a captured variable, which would be garbage on every draw call.
  // M = [a, b, c, d, tx, ty, uniform scale, fade]
  const M = new Float64Array([1, 0, 0, 1, 0, 0, 1, 1]);
  const stack = new Float64Array(8 * 48);
  let sp = 0;
  const resetM = () => { M[0] = 1; M[1] = 0; M[2] = 0; M[3] = 1; M[4] = 0; M[5] = 0; M[6] = 1; M[7] = 1; };

  function makeTarget(w, h, ifmt) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, ifmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }
  function freeTarget(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } }

  function resize(force) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio) * renderScale;
    const cw = Math.max(2, Math.round((canvas.clientWidth || window.innerWidth) * dpr));
    const ch = Math.max(2, Math.round((canvas.clientHeight || window.innerHeight) * dpr));
    if (!force && canvas.width === cw && canvas.height === ch && scene) return false;
    canvas.width = cw; canvas.height = ch;
    const aspect = cw / ch;
    const minA = MIN_W / VIEW_H, maxA = MAX_W / VIEW_H;
    if (aspect < minA) { vpW = cw; vpH = Math.round(cw / minA); }       // too tall: letterbox
    else if (aspect > maxA) { vpH = ch; vpW = Math.round(ch * maxA); }   // too wide: pillarbox
    else { vpW = cw; vpH = ch; }
    vpX = (cw - vpW) >> 1; vpY = (ch - vpH) >> 1;
    H = VIEW_H; W = VIEW_H * (vpW / vpH);
    pxScale = vpH / VIEW_H;
    freeTarget(scene); freeTarget(ldr); for (const m of mips) freeTarget(m);
    scene = makeTarget(vpW, vpH, IFMT);
    ldr = makeTarget(vpW, vpH, gl.RGBA8);
    mips = [];
    let mw = vpW >> 1, mh = vpH >> 1;
    while (mips.length < 7 && mw >= 4 && mh >= 4) { mips.push(makeTarget(mw, mh, IFMT)); mw >>= 1; mh >>= 1; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  function flush() {
    if (quads === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vdata, 0, vn);
    gl.drawElements(gl.TRIANGLES, quads * 6, gl.UNSIGNED_SHORT, 0);
    frameQuads += quads; frameDraws++;
    vn = 0; quads = 0;
  }

  let overlay = false;
  function bindBatch() {
    gl.useProgram(batch.program);
    gl.uniform2f(batch.u.u_res, W, H);
    gl.uniform1f(batch.u.u_ldr, overlay ? 1 : 0);
    gl.bindVertexArray(vao);
  }

  function beginFrame() {
    resize(false);
    frameQuads = 0; frameDraws = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    overlay = false;
    bindBatch();
    resetM(); sp = 0;
    vn = 0; quads = 0;
  }

  const shockArr = new Float32Array(16), shockW = new Float32Array(4);
  const P = (post, k) => (post && post[k] !== undefined ? post[k] : POST_DEFAULTS[k]);

  // Bloom + composite (world distortion, tonemap) into the display-referred LDR target.
  function resolveWorld(post) {
    gl.bindVertexArray(emptyVao);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    // ---- bloom: bright-pass + 13-tap downsample chain
    gl.useProgram(pDown.program);
    gl.uniform1i(pDown.u.u_tex, 0);
    gl.uniform1f(pDown.u.u_threshold, hdr ? P(post, 'bloomThreshold') : Math.min(P(post, 'bloomThreshold'), 0.55));
    let src = scene;
    for (let i = 0; i < mips.length; i++) {
      const dst = mips[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(pDown.u.u_texel, 1 / src.w, 1 / src.h);
      gl.uniform1f(pDown.u.u_first, i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = dst;
    }
    // ---- tent upsample, accumulating each level into the next larger one
    gl.useProgram(pUp.program);
    gl.uniform1i(pUp.u.u_tex, 0);
    gl.uniform1f(pUp.u.u_weight, P(post, 'bloomSpread')); // <1 favours tight glow over wide haze
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = mips.length - 1; i > 0; i--) {
      const s = mips[i], dst = mips[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.uniform2f(pUp.u.u_texel, 1 / s.w, 1 / s.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
    // ---- composite + world distortion + tonemap into LDR
    gl.bindFramebuffer(gl.FRAMEBUFFER, ldr.fbo);
    gl.viewport(0, 0, ldr.w, ldr.h);
    const u = pComposite.u;
    gl.useProgram(pComposite.program);
    gl.uniform1i(u.u_scene, 0);
    gl.uniform1i(u.u_bloom, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mips.length ? mips[0].tex : scene.tex);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1f(u.u_bloomK, mips.length ? P(post, 'bloom') * 0.55 : 0);
    gl.uniform1f(u.u_exposure, P(post, 'exposure'));
    gl.uniform1f(u.u_time, P(post, 'time'));
    gl.uniform1f(u.u_contrast, P(post, 'contrast'));
    gl.uniform1f(u.u_aspect, vpW / vpH);
    gl.uniform1f(u.u_rblur, P(post, 'radialBlur'));
    gl.uniform2f(u.u_center, P(post, 'centerX'), 1 - P(post, 'centerY'));
    shockArr.fill(0); shockW.fill(1);
    const sw = post && post.shockwaves;
    if (sw) {
      for (let i = 0; i < Math.min(4, sw.length); i++) {
        const s = sw[i];
        shockArr[i * 4] = s.x; shockArr[i * 4 + 1] = 1 - s.y; shockArr[i * 4 + 2] = s.radius; shockArr[i * 4 + 3] = s.strength;
        shockW[i] = Math.max(s.width, 1e-3);
      }
    }
    gl.uniform4fv(u.u_shock, shockArr);
    gl.uniform1fv(u.u_shockW, shockW);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Finish the world (bloom, distortion, tonemap) and switch drawing to the overlay: everything drawn
  // from here until endFrame() lands crisp on top, immune to radial blur and shockwaves (HUD, menus).
  function beginOverlay(post) {
    flush();
    resolveWorld(post);
    overlay = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, ldr.fbo);
    gl.viewport(0, 0, ldr.w, ldr.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    bindBatch();
    resetM(); sp = 0;
  }

  function endFrame(post) {
    flush();
    if (!overlay) resolveWorld(post);
    overlay = false;
    gl.bindVertexArray(emptyVao);
    gl.disable(gl.BLEND);
    // ---- final: screen punch, barrel, glitch, aberration, scanlines, vignette, grain, flash
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (vpW !== canvas.width || vpH !== canvas.height) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.viewport(vpX, vpY, vpW, vpH);
    gl.useProgram(pFinal.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ldr.tex);
    const u = pFinal.u;
    gl.uniform1i(u.u_tex, 0);
    gl.uniform1f(u.u_time, P(post, 'time'));
    gl.uniform1f(u.u_ab, P(post, 'aberration'));
    gl.uniform1f(u.u_vig, P(post, 'vignette'));
    gl.uniform1f(u.u_scan, P(post, 'scanlines'));
    gl.uniform1f(u.u_grain, P(post, 'grain'));
    gl.uniform1f(u.u_flash, P(post, 'flash'));
    gl.uniform1f(u.u_glitch, P(post, 'glitch'));
    gl.uniform1f(u.u_barrel, P(post, 'barrel'));
    gl.uniform1f(u.u_sat, P(post, 'saturation'));
    gl.uniform1f(u.u_invert, P(post, 'invert'));
    gl.uniform1f(u.u_zoom, P(post, 'zoom'));
    gl.uniform1f(u.u_fade, P(post, 'fade'));
    const fc = P(post, 'flashColor'), tint = P(post, 'tint');
    gl.uniform3f(u.u_flashColor, fc[0], fc[1], fc[2]);
    gl.uniform3f(u.u_tint, tint[0], tint[1], tint[2]);
    // post offsets are given in logical units, y down; uv space is y up
    gl.uniform2f(u.u_offset, -P(post, 'offsetX') / W, P(post, 'offsetY') / H);
    gl.uniform2f(u.u_center, P(post, 'centerX'), 1 - P(post, 'centerY'));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    stats.quads = frameQuads; stats.draws = frameDraws;
  }

  // ---- vertex writing. Every primitive writes its four vertices straight into the batch array.
  // No helper here takes a long list of numbers: V8 boxes each double passed to a function it does
  // not inline, and a few thousand primitives per frame would become megabytes of garbage per frame.
  const S = new Float64Array(16);   // scratch for the *S entry points (hot callers fill it, then call)
  const A = new Float32Array(7);    // r g b a mode p0 p1 shared by the four vertices of one quad
  function fill4(o) {
    const d = vdata;
    for (let b = o + 4; b < o + 44; b += 11) { d[b] = A[0]; d[b + 1] = A[1]; d[b + 2] = A[2]; d[b + 3] = A[3]; d[b + 4] = A[4]; d[b + 5] = A[5]; d[b + 6] = A[6]; }
  }
  // screen-aligned square sprite centred on the view-space point (cx, cy) with half size (rx, ry)
  function sprite(cx, cy, rx, ry) {
    const d = vdata, o = vn;
    d[o] = cx - rx; d[o + 1] = cy - ry; d[o + 2] = -1; d[o + 3] = -1;
    d[o + 11] = cx + rx; d[o + 12] = cy - ry; d[o + 13] = 1; d[o + 14] = -1;
    d[o + 22] = cx + rx; d[o + 23] = cy + ry; d[o + 24] = 1; d[o + 25] = 1;
    d[o + 33] = cx - rx; d[o + 34] = cy + ry; d[o + 35] = -1; d[o + 36] = 1;
    fill4(o); vn = o + 44; quads++;
  }

  const gfx = {
    gl, canvas, stats, hdr, S,
    get W() { return W; },
    get H() { return H; },
    get pxScale() { return pxScale; },
    resize, beginFrame, beginOverlay, endFrame, flush,
    setRenderScale(s) { if (s !== renderScale) { renderScale = s; resize(true); } },
    getRenderScale() { return renderScale; },

    // ---- transform stack (applies to every draw call below)
    push() {
      const o = sp * 8;
      for (let i = 0; i < 8; i++) stack[o + i] = M[i];
      if (sp < 47) sp++;
    },
    pop() {
      if (sp > 0) sp--;
      const o = sp * 8;
      for (let i = 0; i < 8; i++) M[i] = stack[o + i];
    },
    resetTransform() { const f = M[7]; resetM(); M[7] = f; },
    translate(x, y) { M[4] += M[0] * x + M[2] * y; M[5] += M[1] * x + M[3] * y; },
    scale(sx, sy = sx) { M[0] *= sx; M[1] *= sx; M[2] *= sy; M[3] *= sy; M[6] = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])); },
    rotate(rad) {
      const c = Math.cos(rad), s = Math.sin(rad), a = M[0], b = M[1], cc = M[2], d = M[3];
      M[0] = a * c + cc * s; M[1] = b * c + d * s; M[2] = cc * c - a * s; M[3] = d * c - b * s;
    },
    // Multiplies all following light and alpha by k (restored by pop()).
    setFade(k) { M[7] = k; },
    mulFade(k) { M[7] *= k; },
    getFade() { return M[7]; },
    // view-space position of a local point
    tx(x, y) { return M[0] * x + M[2] * y + M[4]; },
    ty(x, y) { return M[1] * x + M[3] * y + M[5]; },

    // ---- primitives. col = [r,g,b] linear. k = light multiplier (HDR). a = occlusion alpha (0 additive .. 1 opaque).
    rect(x, y, w, h, col, k = 1, a = 1) {
      if (quads >= MAX_QUADS) flush();
      const ma = M[0], mb = M[1], mc = M[2], md = M[3], tx = M[4], ty = M[5], f = M[7];
      const x1 = x + w, y1 = y + h, d = vdata, o = vn;
      d[o] = ma * x + mc * y + tx; d[o + 1] = mb * x + md * y + ty; d[o + 2] = -1; d[o + 3] = -1;
      d[o + 11] = ma * x1 + mc * y + tx; d[o + 12] = mb * x1 + md * y + ty; d[o + 13] = 1; d[o + 14] = -1;
      d[o + 22] = ma * x1 + mc * y1 + tx; d[o + 23] = mb * x1 + md * y1 + ty; d[o + 24] = 1; d[o + 25] = 1;
      d[o + 33] = ma * x + mc * y1 + tx; d[o + 34] = mb * x + md * y1 + ty; d[o + 35] = -1; d[o + 36] = 1;
      k *= f;
      A[0] = col[0] * k; A[1] = col[1] * k; A[2] = col[2] * k; A[3] = a * f; A[4] = MODE_SOLID; A[5] = 1; A[6] = 0;
      fill4(o); vn = o + 44; quads++;
    },
    // Arbitrary convex quad, vertices in order around the shape. No edge AA.
    quad(x0, y0, x1, y1, x2, y2, x3, y3, col, k = 1, a = 1) {
      if (quads >= MAX_QUADS) flush();
      const ma = M[0], mb = M[1], mc = M[2], md = M[3], tx = M[4], ty = M[5], f = M[7];
      const d = vdata, o = vn;
      d[o] = ma * x0 + mc * y0 + tx; d[o + 1] = mb * x0 + md * y0 + ty; d[o + 2] = 0; d[o + 3] = 0;
      d[o + 11] = ma * x1 + mc * y1 + tx; d[o + 12] = mb * x1 + md * y1 + ty; d[o + 13] = 0; d[o + 14] = 0;
      d[o + 22] = ma * x2 + mc * y2 + tx; d[o + 23] = mb * x2 + md * y2 + ty; d[o + 24] = 0; d[o + 25] = 0;
      d[o + 33] = ma * x3 + mc * y3 + tx; d[o + 34] = mb * x3 + md * y3 + ty; d[o + 35] = 0; d[o + 36] = 0;
      k *= f;
      A[0] = col[0] * k; A[1] = col[1] * k; A[2] = col[2] * k; A[3] = a * f; A[4] = MODE_SOLID; A[5] = 0; A[6] = 0;
      fill4(o); vn = o + 44; quads++;
    },
    // Quad with a two-stop gradient: vertices 0,1 use (colA,kA,aA); vertices 2,3 use (colB,kB,aB).
    quadGrad(x0, y0, x1, y1, x2, y2, x3, y3, colA, kA, aA, colB, kB, aB) {
      S[0] = x0; S[1] = y0; S[2] = x1; S[3] = y1; S[4] = x2; S[5] = y2; S[6] = x3; S[7] = y3; S[8] = kA; S[9] = aA; S[10] = kB; S[11] = aB;
      gfx.quadGradS(colA, colB);
    },
    // Same quad, read from the scratch array: S = [x0, y0, x1, y1, x2, y2, x3, y3, kA, aA, kB, aB]. For hot callers.
    quadGradS(colA, colB) {
      if (quads >= MAX_QUADS) flush();
      const ma = M[0], mb = M[1], mc = M[2], md = M[3], tx = M[4], ty = M[5], f = M[7];
      const x0 = S[0], y0 = S[1], x1 = S[2], y1 = S[3], x2 = S[4], y2 = S[5], x3 = S[6], y3 = S[7];
      const kA = S[8] * f, aA = S[9] * f, kB = S[10] * f, aB = S[11] * f;
      const d = vdata; let o = vn;
      d[o] = ma * x0 + mc * y0 + tx; d[o + 1] = mb * x0 + md * y0 + ty; d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = colA[0] * kA; d[o + 5] = colA[1] * kA; d[o + 6] = colA[2] * kA; d[o + 7] = aA; d[o + 8] = 0; d[o + 9] = 0; d[o + 10] = 0; o += 11;
      d[o] = ma * x1 + mc * y1 + tx; d[o + 1] = mb * x1 + md * y1 + ty; d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = colA[0] * kA; d[o + 5] = colA[1] * kA; d[o + 6] = colA[2] * kA; d[o + 7] = aA; d[o + 8] = 0; d[o + 9] = 0; d[o + 10] = 0; o += 11;
      d[o] = ma * x2 + mc * y2 + tx; d[o + 1] = mb * x2 + md * y2 + ty; d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = colB[0] * kB; d[o + 5] = colB[1] * kB; d[o + 6] = colB[2] * kB; d[o + 7] = aB; d[o + 8] = 0; d[o + 9] = 0; d[o + 10] = 0; o += 11;
      d[o] = ma * x3 + mc * y3 + tx; d[o + 1] = mb * x3 + md * y3 + ty; d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = colB[0] * kB; d[o + 5] = colB[1] * kB; d[o + 6] = colB[2] * kB; d[o + 7] = aB; d[o + 8] = 0; d[o + 9] = 0; d[o + 10] = 0;
      vn = o + 11; quads++;
    },
    // Axis-aligned vertical gradient rect: top uses A, bottom uses B.
    rectGrad(x, y, w, h, colA, kA, aA, colB, kB, aB) {
      gfx.quadGrad(x, y, x + w, y, x + w, y + h, x, y + h, colA, kA, aA, colB, kB, aB);
    },
    tri(x0, y0, x1, y1, x2, y2, col, k = 1, a = 1) {
      gfx.quad(x0, y0, x1, y1, x2, y2, x2, y2, col, k, a);
    },
    // Neon line. `width` is the bright core thickness in local units; the halo extends to width*glow/2.
    line(x0, y0, x1, y1, width, col, k = 1, glow = 4, a = 0) {
      S[0] = x0; S[1] = y0; S[2] = x1; S[3] = y1; S[4] = width; S[5] = k;
      gfx.lineS(col, glow, a);
    },
    // Same line, read from the scratch array: S = [x0, y0, x1, y1, width, k]. For hot callers.
    lineS(col, glow = 4, a = 0) {
      const ma = M[0], mb = M[1], mc = M[2], md = M[3], tx = M[4], ty = M[5], f = M[7];
      const ax = ma * S[0] + mc * S[1] + tx, ay = mb * S[0] + md * S[1] + ty;
      const bx = ma * S[2] + mc * S[3] + tx, by = mb * S[2] + md * S[3] + ty;
      let core = S[4] * 0.5 * M[6], k = S[5] * f;
      const minCore = 0.55 / pxScale;
      if (core < minCore) { k *= core / minCore; core = minCore; }
      const R = core * glow;
      if ((ax < -R && bx < -R) || (ax > W + R && bx > W + R) || (ay < -R && by < -R) || (ay > H + R && by > H + R)) return;
      let dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
      const nx = -dy * R, ny = dx * R, ex = dx * R, ey = dy * R;
      const h = (len * 0.5) / R, ue = h + 1;
      if (quads >= MAX_QUADS) flush();
      const d = vdata, o = vn;
      d[o] = ax - ex + nx; d[o + 1] = ay - ey + ny; d[o + 2] = -ue; d[o + 3] = 1;
      d[o + 11] = ax - ex - nx; d[o + 12] = ay - ey - ny; d[o + 13] = -ue; d[o + 14] = -1;
      d[o + 22] = bx + ex - nx; d[o + 23] = by + ey - ny; d[o + 24] = ue; d[o + 25] = -1;
      d[o + 33] = bx + ex + nx; d[o + 34] = by + ey + ny; d[o + 35] = ue; d[o + 36] = 1;
      A[0] = col[0] * k; A[1] = col[1] * k; A[2] = col[2] * k; A[3] = a * f; A[4] = MODE_LINE; A[5] = h; A[6] = 1 / glow;
      fill4(o); vn = o + 44; quads++;
    },
    // Tapered neon segment with flat ends: its own core width and light at each end. This is the
    // perspective line (thick and bright near the camera, thin and dim far away). No caps, so
    // chained segments do not build hot spots where they meet.
    lineTaper(x0, y0, w0, k0, x1, y1, w1, k1, col, glow = 4) {
      S[0] = x0; S[1] = y0; S[2] = w0; S[3] = k0; S[4] = x1; S[5] = y1; S[6] = w1; S[7] = k1;
      gfx.lineTaperS(col, glow);
    },
    // Same segment, read from the scratch array: S = [x0, y0, w0, k0, x1, y1, w1, k1]. For hot callers.
    lineTaperS(col, glow = 4) {
      const ma = M[0], mb = M[1], mc = M[2], md = M[3], tx = M[4], ty = M[5], f = M[7], ms = M[6];
      const ax = ma * S[0] + mc * S[1] + tx, ay = mb * S[0] + md * S[1] + ty;
      const bx = ma * S[4] + mc * S[5] + tx, by = mb * S[4] + md * S[5] + ty;
      const minCore = 0.55 / pxScale;
      let c0 = S[2] * 0.5 * ms, c1 = S[6] * 0.5 * ms, k0 = S[3] * f, k1 = S[7] * f;
      if (c0 < minCore) { k0 *= c0 / minCore; c0 = minCore; }
      if (c1 < minCore) { k1 *= c1 / minCore; c1 = minCore; }
      const R0 = c0 * glow, R1 = c1 * glow, Rm = R0 > R1 ? R0 : R1;
      if ((ax < -Rm && bx < -Rm) || (ax > W + Rm && bx > W + Rm) || (ay < -Rm && by < -Rm) || (ay > H + Rm && by > H + Rm)) return;
      let dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) return;
      dx /= len; dy /= len;
      if (quads >= MAX_QUADS) flush();
      const d = vdata, r = col[0], g = col[1], b = col[2], cr = 1 / glow;
      let o = vn;
      d[o] = ax - dy * R0; d[o + 1] = ay + dx * R0; d[o + 2] = 0; d[o + 3] = 1; d[o + 4] = r * k0; d[o + 5] = g * k0; d[o + 6] = b * k0; d[o + 7] = 0; d[o + 8] = MODE_LINE; d[o + 9] = 0; d[o + 10] = cr; o += 11;
      d[o] = ax + dy * R0; d[o + 1] = ay - dx * R0; d[o + 2] = 0; d[o + 3] = -1; d[o + 4] = r * k0; d[o + 5] = g * k0; d[o + 6] = b * k0; d[o + 7] = 0; d[o + 8] = MODE_LINE; d[o + 9] = 0; d[o + 10] = cr; o += 11;
      d[o] = bx + dy * R1; d[o + 1] = by - dx * R1; d[o + 2] = 0; d[o + 3] = -1; d[o + 4] = r * k1; d[o + 5] = g * k1; d[o + 6] = b * k1; d[o + 7] = 0; d[o + 8] = MODE_LINE; d[o + 9] = 0; d[o + 10] = cr; o += 11;
      d[o] = bx - dy * R1; d[o + 1] = by + dx * R1; d[o + 2] = 0; d[o + 3] = 1; d[o + 4] = r * k1; d[o + 5] = g * k1; d[o + 6] = b * k1; d[o + 7] = 0; d[o + 8] = MODE_LINE; d[o + 9] = 0; d[o + 10] = cr;
      vn = o + 11; quads++;
    },
    // Convex quad with its own light multiplier at each vertex (depth-fogged 3D faces).
    quadK(x0, y0, k0, x1, y1, k1, x2, y2, k2, x3, y3, k3, col, a = 1) {
      S[0] = x0; S[1] = y0; S[2] = k0; S[3] = x1; S[4] = y1; S[5] = k1; S[6] = x2; S[7] = y2; S[8] = k2; S[9] = x3; S[10] = y3; S[11] = k3;
      gfx.quadKS(col, a);
    },
    // Same quad, read from the scratch array: S = [x0,y0,k0, x1,y1,k1, x2,y2,k2, x3,y3,k3]. For hot callers.
    quadKS(col, a = 1) {
      if (quads >= MAX_QUADS) flush();
      const ma = M[0], mb = M[1], mc = M[2], md = M[3], tx = M[4], ty = M[5], f = M[7];
      const d = vdata, r = col[0] * f, g = col[1] * f, b = col[2] * f;
      a *= f;
      let o = vn;
      for (let i = 0; i < 12; i += 3) {
        const x = S[i], y = S[i + 1], k = S[i + 2];
        d[o] = ma * x + mc * y + tx; d[o + 1] = mb * x + md * y + ty; d[o + 2] = 0; d[o + 3] = 0; d[o + 4] = r * k; d[o + 5] = g * k; d[o + 6] = b * k; d[o + 7] = a; d[o + 8] = 0; d[o + 9] = 0; d[o + 10] = 0;
        o += 11;
      }
      vn = o; quads++;
    },
    // Radial glow sprite. pow = falloff exponent (1 = wide and soft, 4 = tight).
    glow(x, y, radius, col, k = 1, pow = 2, a = 0) {
      const cx = M[0] * x + M[2] * y + M[4], cy = M[1] * x + M[3] * y + M[5], r = radius * M[6], f = M[7];
      if (cx < -r || cx > W + r || cy < -r || cy > H + r) return;
      if (quads >= MAX_QUADS) flush();
      k *= f;
      A[0] = col[0] * k; A[1] = col[1] * k; A[2] = col[2] * k; A[3] = a * f; A[4] = MODE_GLOW; A[5] = pow; A[6] = 0;
      sprite(cx, cy, r, r);
    },
    // Elliptical glow (rx, ry radii, unrotated).
    glowEllipse(x, y, rx, ry, col, k = 1, pow = 2, a = 0) {
      const cx = M[0] * x + M[2] * y + M[4], cy = M[1] * x + M[3] * y + M[5], f = M[7];
      rx *= M[6]; ry *= M[6];
      if (cx < -rx || cx > W + rx || cy < -ry || cy > H + ry) return;
      if (quads >= MAX_QUADS) flush();
      k *= f;
      A[0] = col[0] * k; A[1] = col[1] * k; A[2] = col[2] * k; A[3] = a * f; A[4] = MODE_GLOW; A[5] = pow; A[6] = 0;
      sprite(cx, cy, rx, ry);
    },
    // Neon circle outline. `width` = core thickness.
    ring(x, y, radius, width, col, k = 1, glow = 4, a = 0) {
      const cx = M[0] * x + M[2] * y + M[4], cy = M[1] * x + M[3] * y + M[5], r = radius * M[6], f = M[7];
      let core = width * 0.5 * M[6];
      const minCore = 0.55 / pxScale;
      k *= f;
      if (core < minCore) { k *= core / minCore; core = minCore; }
      const R = r + core * glow;
      if (cx < -R || cx > W + R || cy < -R || cy > H + R) return;
      if (quads >= MAX_QUADS) flush();
      A[0] = col[0] * k; A[1] = col[1] * k; A[2] = col[2] * k; A[3] = a * f; A[4] = MODE_RING; A[5] = r / R; A[6] = core / R;
      sprite(cx, cy, R, R);
    },
    // Filled circle.
    disc(x, y, radius, col, k = 1, a = 1) {
      const cx = M[0] * x + M[2] * y + M[4], cy = M[1] * x + M[3] * y + M[5], r = radius * M[6], f = M[7];
      if (cx < -r || cx > W + r || cy < -r || cy > H + r) return;
      if (quads >= MAX_QUADS) flush();
      k *= f;
      A[0] = col[0] * k; A[1] = col[1] * k; A[2] = col[2] * k; A[3] = a * f; A[4] = MODE_DISC; A[5] = 0; A[6] = 0;
      sprite(cx, cy, r, r);
    },
    // Connected neon segments. pts = flat [x0,y0,x1,y1,...], n = point count.
    polyline(pts, n, width, col, k = 1, closed = false, glow = 4) {
      for (let i = 0; i < n - 1; i++) gfx.line(pts[i * 2], pts[i * 2 + 1], pts[i * 2 + 2], pts[i * 2 + 3], width, col, k, glow);
      if (closed && n > 2) gfx.line(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1], pts[0], pts[1], width, col, k, glow);
    },
    // Neon arc from angle a0 to a1 (radians, clockwise on screen because y is down).
    arc(x, y, radius, a0, a1, width, col, k = 1, glow = 4) {
      const span = a1 - a0;
      const n = Math.max(3, Math.ceil(Math.abs(span) * Math.max(radius * M[6], 8) / 14));
      let px = x + Math.cos(a0) * radius, py = y + Math.sin(a0) * radius;
      for (let i = 1; i <= n; i++) {
        const t = a0 + (span * i) / n, nx = x + Math.cos(t) * radius, ny = y + Math.sin(t) * radius;
        gfx.line(px, py, nx, ny, width, col, k, glow);
        px = nx; py = ny;
      }
    },
    // Outline of an axis-aligned rect in neon.
    rectLine(x, y, w, h, width, col, k = 1, glow = 4) {
      gfx.line(x, y, x + w, y, width, col, k, glow); gfx.line(x + w, y, x + w, y + h, width, col, k, glow);
      gfx.line(x + w, y + h, x, y + h, width, col, k, glow); gfx.line(x, y + h, x, y, width, col, k, glow);
    },

    // ---- custom full-view fragment shader layer (procedural skies etc). The shader gets
    // `in vec2 v_uv` (0..1, origin bottom-left), `uniform vec2 u_res` (logical W,H), `uniform float u_time`
    // and writes premultiplied HDR `out vec4 o`. Drawn in submission order with the batch.
    createLayer(fragSource) {
      const prog = link(gl, VS_FULL, fragSource);
      return {
        uniforms: prog.u,
        draw(time, setUniforms) {
          flush();
          gl.useProgram(prog.program);
          gl.bindVertexArray(emptyVao);
          if (prog.u.u_res) gl.uniform2f(prog.u.u_res, W, H);
          if (prog.u.u_time) gl.uniform1f(prog.u.u_time, time);
          if (setUniforms) setUniforms(gl, prog.u);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          frameDraws++;
          bindBatch();
        },
      };
    },

    // client (CSS px) -> logical view coordinates
    clientToView(clientX, clientY, out = { x: 0, y: 0 }) {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      out.x = ((clientX - rect.left) * sx - vpX) / pxScale;
      out.y = ((clientY - rect.top) * sy - vpY) / pxScale;
      return out;
    },
  };
  resize(true);
  return gfx;
}
