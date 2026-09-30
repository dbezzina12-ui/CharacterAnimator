// Mesh and weight tools for 2D attachments (pure JS; used by the editor and the build scripts).
// Mesh vertices live in IMAGE pixels (origin top-left, +y down) so editing a vertex moves the mesh over
// the artwork without distorting it; UVs are simply vertex / image size.

import { MAX_INFLUENCES } from './core.js';

/**
 * Starting mesh from image alpha: a grid of cells that contain visible pixels (dilated by `margin` so
 * anti-aliased edges and ink stay inside). Concave outlines and holes are handled cell by cell, so there
 * are no self-crossing triangles and no large transparent rectangles; interior vertices give the mesh
 * room to bend. cell ~ 1/10 of the image's larger side unless given.
 */
export function gridMesh(alpha, w, h, opts = {}) {
  const cell = Math.max(6, Math.round(opts.cell || Math.max(w, h) / 10));
  const thr = opts.threshold ?? 8, margin = opts.margin ?? 2;
  const nx = Math.ceil(w / cell), ny = Math.ceil(h / cell);
  const occ = new Uint8Array(nx * ny);
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    const x0 = Math.max(0, cx * cell - margin), x1 = Math.min(w, (cx + 1) * cell + margin);
    const y0 = Math.max(0, cy * cell - margin), y1 = Math.min(h, (cy + 1) * cell + margin);
    let hit = false;
    for (let y = y0; y < y1 && !hit; y++) for (let x = x0; x < x1; x++) if (alpha[y * w + x] > thr) { hit = true; break; }
    occ[cy * nx + cx] = hit ? 1 : 0;
  }
  const vid = new Map(), vertices = [], triangles = [];
  const V = (i, j) => {
    const k = j * (nx + 1) + i;
    let id = vid.get(k);
    if (id === undefined) { id = vertices.length / 2; vid.set(k, id); vertices.push(Math.min(i * cell, w), Math.min(j * cell, h)); }
    return id;
  };
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    if (!occ[cy * nx + cx]) continue;
    const a = V(cx, cy), b = V(cx + 1, cy), c = V(cx + 1, cy + 1), d = V(cx, cy + 1);
    if ((cx + cy) & 1) triangles.push(a, b, c, a, c, d); else triangles.push(a, b, d, b, c, d);
  }
  return { vertices, triangles, cell };
}

/** Quad covering the whole image (a rigid "region" attachment). */
export function quadMesh(w, h) { return { vertices: [0, 0, w, 0, w, h, 0, h], triangles: [0, 1, 2, 0, 2, 3] }; }

/** Signed area of every triangle in image space; a valid mesh has them all non-zero with one sign. */
export function checkMesh(vertices, triangles) {
  let pos = 0, neg = 0, zero = 0;
  const nv = vertices.length / 2;
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
    if (a >= nv || b >= nv || c >= nv || a === b || b === c || a === c) { zero++; continue; }
    const ar = (vertices[b * 2] - vertices[a * 2]) * (vertices[c * 2 + 1] - vertices[a * 2 + 1]) -
      (vertices[c * 2] - vertices[a * 2]) * (vertices[b * 2 + 1] - vertices[a * 2 + 1]);
    if (Math.abs(ar) < 1e-9) zero++; else if (ar > 0) pos++; else neg++;
  }
  return { ok: zero === 0 && (pos === 0 || neg === 0), positive: pos, negative: neg, degenerate: zero };
}

function triContains(vs, a, b, c, x, y) {
  const ax = vs[a * 2], ay = vs[a * 2 + 1], bx = vs[b * 2], by = vs[b * 2 + 1], cx = vs[c * 2], cy = vs[c * 2 + 1];
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-12) return null;
  const l1 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
  const l2 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
  const l3 = 1 - l1 - l2;
  return l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9 ? [l1, l2, l3] : null;
}
/** Index of the triangle containing image point (x, y) and its barycentric coordinates. */
export function findTriangle(vertices, triangles, x, y) {
  for (let i = 0; i < triangles.length; i += 3) {
    const bc = triContains(vertices, triangles[i], triangles[i + 1], triangles[i + 2], x, y);
    if (bc) return { tri: i / 3, bc };
  }
  return null;
}

/** Split the triangle under (x, y) into three; the new vertex gets interpolated weights. */
export function addVertex(mesh, x, y) {
  const hit = findTriangle(mesh.vertices, mesh.triangles, x, y);
  if (!hit) return -1;
  const i = hit.tri * 3, [a, b, c] = mesh.triangles.slice(i, i + 3);
  const v = mesh.vertices.length / 2;
  mesh.vertices.push(x, y);
  mesh.triangles.splice(i, 3, a, b, v, b, c, v, c, a, v);
  if (mesh.weights) mesh.weights.push(mixWeights([mesh.weights[a], mesh.weights[b], mesh.weights[c]], hit.bc));
  return v;
}

function mixWeights(lists, ws) {
  const acc = new Map();
  lists.forEach((l, k) => { for (let j = 0; l && j < l.length; j += 2) acc.set(l[j], (acc.get(l[j]) || 0) + l[j + 1] * ws[k]); });
  return pruneWeights(acc);
}
export function pruneWeights(map, max = MAX_INFLUENCES) {
  // relative threshold: normalise the strongest `max` influences first, then drop negligible ones
  let e = [...map.entries()].filter(([, w]) => w > 0).sort((p, q) => q[1] - p[1]).slice(0, max);
  let sum = e.reduce((s, [, w]) => s + w, 0);
  if (!(sum > 0)) return [];
  e = e.filter(([, w]) => w / sum > 1e-4);
  sum = e.reduce((s, [, w]) => s + w, 0);
  const out = e.map(([b, w]) => [b, +(w / sum).toFixed(6)]);
  const drift = 1 - out.reduce((s, [, w]) => s + w, 0);     // keep the rounded sum exactly 1
  out[0][1] = +(out[0][1] + drift).toFixed(6);
  return out.flat();
}

/** Remove a vertex: its incident triangles are removed and the hole is re-triangulated (ear clipping). */
export function deleteVertex(mesh, v) {
  const T = mesh.triangles, inc = [];
  for (let i = 0; i < T.length; i += 3) if (T[i] === v || T[i + 1] === v || T[i + 2] === v) inc.push(i / 3);
  if (!inc.length) return false;
  // boundary edges of the fan, oriented as in their triangles, without v
  const edges = inc.map((ti) => { const t = T.slice(ti * 3, ti * 3 + 3); const k = t.indexOf(v); return [t[(k + 1) % 3], t[(k + 2) % 3]]; });
  const ring = [edges[0][0], edges[0][1]];
  const used = new Set([0]);
  while (used.size < edges.length) {
    const last = ring[ring.length - 1];
    const k = edges.findIndex((e, j) => !used.has(j) && e[0] === last);
    if (k < 0) break;
    used.add(k);
    if (edges[k][1] === ring[0]) break;
    ring.push(edges[k][1]);
  }
  const keep = [];
  for (let i = 0; i < T.length; i += 3) if (!inc.includes(i / 3)) keep.push(T[i], T[i + 1], T[i + 2]);
  const fill = earClip(mesh.vertices, ring);
  const tris = keep.concat(fill);
  // drop vertex v and reindex
  mesh.vertices.splice(v * 2, 2);
  mesh.triangles = tris.map((x) => (x > v ? x - 1 : x));
  if (mesh.weights) mesh.weights.splice(v, 1);
  return true;
}

/** Ear clipping of a simple polygon given by vertex indices (either winding). */
export function earClip(vs, poly) {
  const idx = poly.slice(), out = [];
  const X = (i) => vs[i * 2], Y = (i) => vs[i * 2 + 1];
  let area = 0;
  for (let i = 0; i < idx.length; i++) { const a = idx[i], b = idx[(i + 1) % idx.length]; area += X(a) * Y(b) - X(b) * Y(a); }
  const sign = area >= 0 ? 1 : -1;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      const cr = (X(b) - X(a)) * (Y(c) - Y(a)) - (Y(b) - Y(a)) * (X(c) - X(a));
      if (cr * sign <= 1e-12) continue;
      let inside = false;
      for (const p of idx) if (p !== a && p !== b && p !== c && triContains(vs, a, b, c, X(p), Y(p))) { inside = true; break; }
      if (inside) continue;
      out.push(a, b, c); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

// ------------------------------------------------------------------ weights ---------
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const u = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy));
}
/**
 * Automatic starting weights for new artwork: inverse-distance to each candidate bone's bind segment
 * (world px), sharpened by `power`, max four influences, normalised. `bones`: [{id, head:[x,y], tail:[x,y]}].
 */
export function autoWeights(points, bones, { power = 4, maxInfluences = MAX_INFLUENCES } = {}) {
  const n = points.length / 2, out = [];
  for (let v = 0; v < n; v++) {
    const x = points[v * 2], y = points[v * 2 + 1], m = new Map();
    for (const b of bones) {
      const d = segDist(x, y, b.head[0], b.head[1], b.tail[0], b.tail[1]);
      m.set(b.id, 1 / (Math.pow(d + 1, power)));
    }
    out.push(pruneWeights(m, maxInfluences));
  }
  return out;
}

/** Edge neighbour lists. */
export function neighbours(nv, triangles) {
  const nb = Array.from({ length: nv }, () => new Set());
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i], triangles[i + 1], triangles[i + 2]];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  return nb;
}
/** Laplacian smoothing of weights; locked vertices (Set of indices) are left untouched. */
export function smoothWeights(weights, triangles, { iterations = 2, amount = 0.5, locked = new Set(), only = null } = {}) {
  const nv = weights.length, nb = neighbours(nv, triangles);
  let cur = weights.map((l) => new Map(pairs(l)));
  for (let it = 0; it < iterations; it++) {
    const next = cur.map((m, v) => {
      if (locked.has(v) || (only && !only.has(v)) || !nb[v].size) return m;
      const acc = new Map();
      for (const [b, w] of m) acc.set(b, (1 - amount) * w);
      for (const u of nb[v]) for (const [b, w] of cur[u]) acc.set(b, (acc.get(b) || 0) + amount * w / nb[v].size);
      return new Map(pairs(pruneWeights(acc)));
    });
    cur = next;
  }
  return cur.map((m) => pruneWeights(m));
}
function pairs(l) { const p = []; for (let j = 0; l && j < l.length; j += 2) p.push([l[j], l[j + 1]]); return p; }
/** Normalise (sum 1, max four influences); locked vertices keep their weights. */
export function normalizeWeights(weights, locked = new Set()) {
  return weights.map((l, v) => (locked.has(v) ? l : pruneWeights(new Map(pairs(l)))));
}
/**
 * Paint weight for `bone` at vertices within `radius` of (x, y) (image px): mode 'add' | 'subtract' |
 * 'replace' | 'smooth'. Other influences are rescaled so the sum stays 1. Locked vertices are skipped.
 */
export function paintWeights(mesh, bone, x, y, radius, strength, mode = 'add', locked = new Set()) {
  const vs = mesh.vertices, changed = [];
  const only = new Set();
  for (let v = 0; v < vs.length / 2; v++) {
    const d = Math.hypot(vs[v * 2] - x, vs[v * 2 + 1] - y);
    if (d > radius || locked.has(v)) continue;
    const f = strength * (1 - d / radius);
    if (mode === 'smooth') { only.add(v); continue; }
    const m = new Map(pairs(mesh.weights[v]));
    const w0 = m.get(bone) || 0;
    const w1 = mode === 'add' ? Math.min(1, w0 + f) : mode === 'subtract' ? Math.max(0, w0 - f) : w0 + (strength - w0) * (1 - d / radius);
    let rest = 0; for (const [b, w] of m) if (b !== bone) rest += w;
    const out = new Map();
    for (const [b, w] of m) if (b !== bone) out.set(b, rest > 0 ? w * (1 - w1) / rest : 0);
    out.set(bone, w1);
    if (rest === 0 && w1 < 1) out.set(bone, 1);          // nothing else to take the remainder
    mesh.weights[v] = pruneWeights(out);
    changed.push(v);
  }
  if (mode === 'smooth' && only.size) {
    mesh.weights = smoothWeights(mesh.weights, mesh.triangles, { iterations: 1, amount: strength, locked, only });
    changed.push(...only);
  }
  return changed;
}

/** Fill RGB of fully transparent pixels from opaque neighbours (edge bleed) so filtering adds no fringes. */
export function bleedEdges(rgba, w, h, passes = 4) {
  const a = (i) => rgba[i * 4 + 3];
  let filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = a(i) > 0 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (filled[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X; if (!filled[j]) continue;
        r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
      }
      if (n) { rgba[i * 4] = r / n; rgba[i * 4 + 1] = g / n; rgba[i * 4 + 2] = b / n; next[i] = 1; }
    }
    filled = next;
  }
  return rgba;
}
