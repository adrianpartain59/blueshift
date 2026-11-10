// engine/cam3d.js — a minimal 3D pipeline on top of the 2D neon batch: perspective camera with
// yaw/pitch/roll, near-plane clipping, depth fog, a "curved world" bend, and helpers that draw
// lines, quads, glows and rings given in world space. Projection happens on the CPU; the caller
// draws far-to-near (painter's algorithm). World axes: x right, y UP, z forward (into the screen).
//
// Hot-path note: all scratch state lives in typed arrays and results are handed to the batch through
// gfx.S. A double written to a closure variable, or passed to a function V8 does not inline, is
// boxed on the heap; with thousands of lines per frame that is megabytes of garbage per frame.
// So line() and quad() are thin wrappers (small enough to be inlined into their callers, which keeps
// the arguments unboxed) around lineA() / quadA(), which take their numbers from cam.A / cam.Q.
// For the same reason begin() copies every camera property into the typed array T, and the hot paths
// read only T: a number-valued property read from the camera object inside lineA was a fresh heap
// number each time (measured: 32 bytes per line from five property reads, 0 with the snapshot).

export function createCam3d(gfx) {
  // The camera as the hot paths see it: a snapshot taken by begin().
  // T = [0 f, 1 cxp, 2 cyp, 3..11 rotation rows, 12 fogPow, 13 -, 14 -, 15 near, 16 fogStart,
  //      17 fogEnd, 18 widthScale, 19 maxLineWidth, 20 x, 21 y, 22 z, 23 curveX, 24 curveY]
  const T = new Float64Array(25);
  T[0] = 600; T[1] = 640; T[2] = 360; T[3] = 1; T[7] = 1; T[11] = 1;
  T[12] = 1.5; T[15] = 0.4; T[16] = 60; T[17] = 600; T[18] = 1; T[19] = 5;
  const V = new Float64Array(3);   // last camera-space point
  const A = new Float64Array(8);   // arguments of lineA: x0, y0, z0, x1, y1, z1, width, k
  const Q = new Float64Array(14);  // arguments of quadA: four world points, then k and a
  const R = new Float64Array(4);   // last projection: sx, sy, s, zc
  const S = gfx.S;
  // scratch for polygon clipping (max 4 in, 5 out)
  const px = new Float64Array(8), py = new Float64Array(8), pz = new Float64Array(8);
  const qx = new Float64Array(8), qy = new Float64Array(8), qk = new Float64Array(8);

  function view(x, y, z) {
    x -= T[20]; y -= T[21]; z -= T[22];
    const zc = T[9] * x + T[10] * y + T[11] * z, zz = zc * zc;
    V[0] = T[3] * x + T[4] * y + T[5] * z + T[23] * zz;
    V[1] = T[6] * x + T[7] * y + T[8] * z + T[24] * zz;
    V[2] = zc;
  }
  // The same for the point stored at arr[i..i+2]. Its arguments are an array and a small integer, so
  // nothing is boxed even where V8 decides not to inline the call (a quad makes four of them).
  function viewAt(arr, i) {
    const x = arr[i] - T[20], y = arr[i + 1] - T[21], z = arr[i + 2] - T[22];
    const zc = T[9] * x + T[10] * y + T[11] * z, zz = zc * zc;
    V[0] = T[3] * x + T[4] * y + T[5] * z + T[23] * zz;
    V[1] = T[6] * x + T[7] * y + T[8] * z + T[24] * zz;
    V[2] = zc;
  }
  // Fog: 1 up to fogStart, 0 from fogEnd, and in between t^fogPow for t = 1..0.
  function fog(z) {
    if (z <= T[16]) return 1;
    if (z >= T[17]) return 0;
    return Math.pow(1 - (z - T[16]) / (T[17] - T[16]), T[12]);
  }

  const cam = {
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0,
    fov: 1.2,            // vertical field of view, radians
    near: 0.4,
    cx: 0.5, cy: 0.5,    // principal point as a fraction of the view (moves the vanishing point)
    curveX: 0, curveY: 0, // world bend: view x += curveX * z^2, view y += curveY * z^2
    fogStart: 60, fogEnd: 600, fogPow: 1.5,
    widthScale: 1,
    maxLineWidth: 5,     // logical units: on-screen cap for a 3D line's core width
    // results of the last project() call. Hot loops should read cam.P[0..3] = [sx, sy, s, zc]
    // directly: a getter that returns a double boxes it unless V8 inlines the call site.
    P: R,
    A, Q,                // argument arrays of lineA / quadA
    get sx() { return R[0]; },
    get sy() { return R[1]; },
    get s() { return R[2]; },
    get zc() { return R[3]; },

    // Call once per frame after changing ANY camera property (position, angles, fov, cx/cy, near, fog,
    // world bend, width scale): drawing reads the snapshot taken here, not the properties.
    begin() {
      T[0] = (gfx.H * 0.5) / Math.tan(cam.fov * 0.5);
      T[1] = gfx.W * cam.cx; T[2] = gfx.H * cam.cy;
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
      T[3] = cy * cr - sy * sp * sr; T[4] = cp * sr; T[5] = -sy * cr - cy * sp * sr;
      T[6] = -cy * sr - sy * sp * cr; T[7] = cp * cr; T[8] = sy * sr - cy * sp * cr;
      T[9] = sy * cp; T[10] = sp; T[11] = cy * cp;
      T[12] = cam.fogPow;
      T[15] = cam.near; T[16] = cam.fogStart; T[17] = cam.fogEnd; T[18] = cam.widthScale; T[19] = cam.maxLineWidth;
      T[20] = cam.x; T[21] = cam.y; T[22] = cam.z; T[23] = cam.curveX; T[24] = cam.curveY;
    },
    get focal() { return T[0]; },
    fog,
    // World point -> view (logical screen) position. Returns false when behind the near plane.
    project(x, y, z) {
      view(x, y, z);
      const zc = V[2];
      if (zc < T[15]) return false;
      const s = T[0] / zc;
      R[0] = T[1] + V[0] * s; R[1] = T[2] - V[1] * s; R[2] = s; R[3] = zc;
      return true;
    },
    // Depth (camera-space z) of a world point, without projecting.
    depth(x, y, z) { return T[9] * (x - T[20]) + T[10] * (y - T[21]) + T[11] * (z - T[22]); },

    // Neon line between two world points. `width` is in world units (tapers with distance).
    line(x0, y0, z0, x1, y1, z1, width, col, k = 1, glow = 4) {
      A[0] = x0; A[1] = y0; A[2] = z0; A[3] = x1; A[4] = y1; A[5] = z1; A[6] = width; A[7] = k;
      cam.lineA(col, glow);
    },
    // The same line with its numbers taken from cam.A = [x0, y0, z0, x1, y1, z1, width, k].
    lineA(col, glow) {
      const width = A[6], k = A[7];
      viewAt(A, 0); let ax = V[0], ay = V[1], az = V[2];
      viewAt(A, 3); let bx = V[0], by = V[1], bz = V[2];
      const n = T[15];
      if (az < n && bz < n) return;
      if (az < n) { const t = (n - az) / (bz - az); ax += (bx - ax) * t; ay += (by - ay) * t; az = n; }
      else if (bz < n) { const t = (n - bz) / (az - bz); bx += (ax - bx) * t; by += (ay - by) * t; bz = n; }
      // fog, written out here: a helper's double return value would be boxed on every line
      const fs = T[16], fe = T[17], fp = T[12], fr = fe - fs;
      const ka = k * (az <= fs ? 1 : az >= fe ? 0 : Math.pow(1 - (az - fs) / fr, fp));
      const kb = k * (bz <= fs ? 1 : bz >= fe ? 0 : Math.pow(1 - (bz - fs) / fr, fp));
      if (ka < 0.003 && kb < 0.003) return;
      const f = T[0], sa = f / az, sb = f / bz, w = width * T[18], mw = T[19];
      // lines that pass right by the lens would balloon into slabs of light: cap their on-screen width
      const wa = w * sa, wb = w * sb;
      S[0] = T[1] + ax * sa; S[1] = T[2] - ay * sa; S[2] = wa < mw ? wa : mw; S[3] = ka;
      S[4] = T[1] + bx * sb; S[5] = T[2] - by * sb; S[6] = wb < mw ? wb : mw; S[7] = kb;
      gfx.lineTaperS(col, glow);
    },

    // Convex quad given by four world points (in order). Clipped against the near plane, fogged per vertex.
    quad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, col, k = 1, a = 1) {
      Q[0] = x0; Q[1] = y0; Q[2] = z0; Q[3] = x1; Q[4] = y1; Q[5] = z1; Q[6] = x2; Q[7] = y2; Q[8] = z2; Q[9] = x3; Q[10] = y3; Q[11] = z3;
      Q[12] = k; Q[13] = a;
      cam.quadA(col);
    },
    // The same quad with its numbers taken from cam.Q = [x0, y0, z0, ... x3, y3, z3, k, a].
    quadA(col) {
      const k = Q[12], a = Q[13];
      viewAt(Q, 0); px[0] = V[0]; py[0] = V[1]; pz[0] = V[2];
      viewAt(Q, 3); px[1] = V[0]; py[1] = V[1]; pz[1] = V[2];
      viewAt(Q, 6); px[2] = V[0]; py[2] = V[1]; pz[2] = V[2];
      viewAt(Q, 9); px[3] = V[0]; py[3] = V[1]; pz[3] = V[2];
      const n = T[15], f = T[0], cxp = T[1], cyp = T[2];
      const fs = T[16], fe = T[17], fp = T[12], fr = fe - fs;
      let m = 0;
      if (pz[0] >= n && pz[1] >= n && pz[2] >= n && pz[3] >= n) {
        for (let i = 0; i < 4; i++) {
          const z = pz[i], s = f / z;
          qx[i] = cxp + px[i] * s; qy[i] = cyp - py[i] * s;
          qk[i] = k * (z <= fs ? 1 : z >= fe ? 0 : Math.pow(1 - (z - fs) / fr, fp));
        }
        m = 4;
      } else {
        // Sutherland-Hodgman against z >= near
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) & 3, ain = pz[i] >= n, bin = pz[j] >= n;
          if (ain) { const z = pz[i], s = f / z; qx[m] = cxp + px[i] * s; qy[m] = cyp - py[i] * s; qk[m] = k * (z <= fs ? 1 : z >= fe ? 0 : Math.pow(1 - (z - fs) / fr, fp)); m++; }
          if (ain !== bin) {
            const t = (n - pz[i]) / (pz[j] - pz[i]), s = f / n;
            qx[m] = cxp + (px[i] + (px[j] - px[i]) * t) * s; qy[m] = cyp - (py[i] + (py[j] - py[i]) * t) * s; qk[m] = k; m++;
          }
        }
        if (m < 3) return;
      }
      if (qk[0] < 0.003 && qk[1] < 0.003 && qk[2] < 0.003 && (m < 4 || qk[3] < 0.003) && a <= 0) return;
      // entirely off one side of the view: nothing to draw
      const W = gfx.W, H = gfx.H;
      let l = 0, r = 0, u = 0, d = 0;
      for (let i = 0; i < m; i++) { if (qx[i] < 0) l++; else if (qx[i] > W) r++; if (qy[i] < 0) u++; else if (qy[i] > H) d++; }
      if (l === m || r === m || u === m || d === m) return;
      const i3 = m === 3 ? 2 : 3;
      S[0] = qx[0]; S[1] = qy[0]; S[2] = qk[0]; S[3] = qx[1]; S[4] = qy[1]; S[5] = qk[1]; S[6] = qx[2]; S[7] = qy[2]; S[8] = qk[2]; S[9] = qx[i3]; S[10] = qy[i3]; S[11] = qk[i3];
      gfx.quadKS(col, a);
      if (m === 5) {
        S[0] = qx[0]; S[1] = qy[0]; S[2] = qk[0]; S[3] = qx[3]; S[4] = qy[3]; S[5] = qk[3]; S[6] = qx[4]; S[7] = qy[4]; S[8] = qk[4]; S[9] = qx[4]; S[10] = qy[4]; S[11] = qk[4];
        gfx.quadKS(col, a);
      }
    },

    // Camera-facing glow / ring / disc at a world point; sizes in world units.
    glow(x, y, z, radius, col, k = 1, pow = 2) {
      if (!cam.project(x, y, z)) return;
      const kk = k * fog(R[3]); if (kk < 0.003) return;
      gfx.glow(R[0], R[1], radius * R[2], col, kk, pow);
    },
    ring(x, y, z, radius, width, col, k = 1, glow = 4) {
      if (!cam.project(x, y, z)) return;
      const kk = k * fog(R[3]); if (kk < 0.003) return;
      gfx.ring(R[0], R[1], radius * R[2], width * R[2] * T[18], col, kk, glow);
    },
    disc(x, y, z, radius, col, k = 1, a = 1) {
      if (!cam.project(x, y, z)) return;
      gfx.disc(R[0], R[1], radius * R[2], col, k * fog(R[3]), a);
    },
  };
  return cam;
}
