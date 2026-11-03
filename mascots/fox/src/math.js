// Small 2D math + easing helpers shared by the solver, the art and the tests.
// Canvas convention: x right, y DOWN, angles in radians, positive = clockwise on screen.

export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const deg = (d) => d * Math.PI / 180;
export const smoothstep = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

export const EASE = {
  linear: (t) => t,
  smooth: smoothstep,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  // overshoot slightly past the target before settling (for pops and fist pumps)
  back: (t) => { const s = 1.70158; return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); },
  // sharp snap: fast start, slow landing (downswing / recoil)
  snap: (t) => 1 - Math.pow(1 - t, 5),
  bounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  step: (t) => (t >= 1 ? 1 : 0),
};

export const v2 = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerpV = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });
export const rot = (p, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
export const angleOf = (p) => Math.atan2(p.y, p.x);
export const normAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

/** Shortest-path angle interpolation. */
export const mixAngle = (a, b, t) => a + normAngle(b - a) * t;

/**
 * Two-bone IK in the plane. Returns the joint (elbow/knee) position for a chain
 * root->joint->end with segment lengths l1, l2 that reaches `target` as closely as
 * possible. `bend` = +1 puts the joint on the clockwise side of root->target, -1 the other.
 * Bone lengths are never changed; an out-of-reach target gives a straight chain.
 */
export function twoBoneIK(root, target, l1, l2, bend = 1) {
  let d = sub(target, root);
  let L = len(d);
  if (L < 1e-6) { d = { x: 0, y: 1 }; L = 1e-6; }
  const dir = scale(d, 1 / L);
  const reach = clamp(L, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const a = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = { x: -dir.y, y: dir.x }; // clockwise normal on a y-down canvas
  const joint = add(add(root, scale(dir, a)), scale(perp, h * bend));
  const end = add(root, scale(dir, Math.min(L, l1 + l2)));
  const minReach = Math.abs(l1 - l2) + 1e-4;
  return { joint, end: L > l1 + l2 ? end : target, reachError: Math.max(0, L - (l1 + l2), minReach - L) };
}

/** Catmull-Rom spline through points -> cubic bezier segments appended to a Path2D/ctx. */
export function catmullRomPath(ctx, pts, closed = false, tension = 0.5) {
  const n = pts.length;
  if (n < 2) return;
  const get = (i) => pts[closed ? (i + n) % n : clamp(i, 0, n - 1)];
  ctx.moveTo(pts[0].x, pts[0].y);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const c1 = { x: p1.x + (p2.x - p0.x) * tension / 3, y: p1.y + (p2.y - p0.y) * tension / 3 };
    const c2 = { x: p2.x - (p3.x - p1.x) * tension / 3, y: p2.y - (p3.y - p1.y) * tension / 3 };
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
  }
  if (closed) ctx.closePath();
}

/** Resample a polyline into a smooth polyline with `per` points per segment (Catmull-Rom). */
export function smoothPolyline(pts, per = 6) {
  const out = [];
  const n = pts.length;
  const get = (i) => pts[clamp(i, 0, n - 1)];
  for (let i = 0; i < n - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      out.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(pts[n - 1]);
  return out;
}

/** Deterministic hash noise in [0,1) from integer inputs (fur jitter, blink schedules). */
export function hash(i, j = 0) {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}
