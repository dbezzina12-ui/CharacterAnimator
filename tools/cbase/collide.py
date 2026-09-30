"""Keep held props out of the body.

The body is the character's own skinned template mesh (same vertices/weights as the GLB), posed
per frame. A prop is a set of sample spheres along its blade / shaft / barrel (prop-local, glTF
semantics, see props.py). A sample is "inside" when it lies behind the surface at its nearest
body vertex (signed distance along that vertex's skinned normal) by more than the clearance.

`resolve_track` pushes the prop out along the body normals with a small rigid motion per frame
(point-to-plane least squares that prefers rotating about the right-hand grip over moving the
hands), smooths the corrections over time so the motion stays fluid, and repeats.
"""
import re

import numpy as np

from .mesh import vertex_normals

CLEARANCE = 0.010          # metres between prop surface and skin
NEAR = 0.09                # nearest-vertex sign test is only trusted this close to the surface
HELD_BONES = re.compile(r"^(forearm|forearm_twist|elbow_helper|hand|thumb|index|middle|ring|pinky)(_\d+)?_[LR]$")


def rotvec_matrix(w):
    a = np.linalg.norm(w)
    if a < 1e-12:
        return np.eye(3)
    k = w / a
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K


class BodyProxy:
    """Skinned body surface (positions + normals) for a pose, optionally without some parts."""

    def __init__(self, rig, m, names, W, stride=1):
        self.rig = rig
        self.names = names
        V = np.asarray(m.V, float)
        N = vertex_normals(V, m.faces)
        vpart = np.empty(len(V), dtype=object)
        for f, pt in zip(m.faces, m.face_part):
            for v in f:
                vpart[v] = pt
        sel = np.arange(0, len(V), stride)
        self.V, self.N, self.W, self.part = V[sel], N[sel], np.asarray(W)[sel], vpart[sel]

    def held_mask(self, sides):
        """Vertices driven by a holding arm's elbow/forearm/hand/fingers (weight >= 0.25): the prop touches these."""
        cols = [j for j, b in enumerate(self.names) if any(b.endswith(f"_{sd}") for sd in sides)
                and (HELD_BONES.match(b) is not None)]
        return self.W[:, cols].sum(1) >= 0.25

    def posed(self, pose, exclude=(), only=None, held_sides=()):
        Wd = self.rig.fk(pose)
        S = self.rig.skin_matrices(Wd, self.names)
        keep = ~np.isin(self.part, list(exclude)) if only is None else np.isin(self.part, list(only))
        if held_sides:
            keep &= ~self.held_mask(held_sides)
        V, N, Wt = self.V[keep], self.N[keep], self.W[keep]
        # linear blend of the skin matrices, applied to positions and (as directions) to normals
        M = np.einsum("vj,jab->vab", Wt, S)
        P = np.einsum("vab,vb->va", M[:, :3, :3], V) + M[:, :3, 3]
        Nn = np.einsum("vab,vb->va", M[:, :3, :3], N)
        Nn /= np.linalg.norm(Nn, axis=1, keepdims=True)
        return P, Nn


def depths(points, radii, body, clearance=CLEARANCE, k=6):
    """Penetration depth (>0 = too deep) of each sample sphere, and the push direction.
    Inside/outside is the median over the k nearest skin points (robust at concave junctions,
    e.g. a point beside the hip whose single nearest vertex is on the inner upper arm)."""
    P, N = body
    d2 = ((points[:, None, :] - P[None, :, :]) ** 2).sum(-1)
    kk = min(k, len(P))
    idx = np.argpartition(d2, kk - 1, axis=1)[:, :kk]
    rows = np.arange(len(points))[:, None]
    order = np.argsort(d2[rows, idx], axis=1)
    idx = idx[rows, order]
    near = np.sqrt(d2[rows[:, 0], idx[:, 0]])
    signed_k = ((points[:, None, :] - P[idx]) * N[idx]).sum(-1)
    signed = np.median(signed_k, axis=1) - radii - clearance
    n = N[idx].mean(1)
    n /= np.linalg.norm(n, axis=1, keepdims=True)
    dep = np.where(near < NEAR + radii, -signed, -1.0)
    return dep, n


def weapon_samples(spec, step=0.025):
    """Sample spheres (prop-local centre, radius) over a prop's collision parts. Parts that are held
    (inside a hand zone) or marked as intended contact (e.g. a rifle stock) are skipped."""
    pts, rad = [], []

    def seg(a, b, r):
        a, b = np.asarray(a, float), np.asarray(b, float)
        n = max(2, int(np.ceil(np.linalg.norm(b - a) / step)) + 1)
        for t in np.linspace(0, 1, n):
            pts.append(a + (b - a) * t)
            rad.append(r)

    for pi, part in enumerate(spec["parts"]):
        kind = part[0]
        if pi in spec.get("contact_parts", ()):      # intended contact, e.g. a rifle stock in the shoulder
            continue
        if kind == "cyl":
            seg(part[1], part[2], part[3])
        elif kind == "blade":
            a, b, w = np.asarray(part[1], float), np.asarray(part[2], float), part[3]
            ax = (b - a) / np.linalg.norm(b - a)
            side = np.array([1.0, 0, 0]) if abs(ax[0]) < 0.9 else np.array([0, 0, 1.0])
            for s in (-0.8, 0.0, 0.8):     # centre line + both edges (edges taper toward the tip)
                seg(a + side * w * s, b + side * w * s * 0.25, 0.006)
        elif kind == "beam":
            size = part[3]
            seg(part[1], part[2], 0.5 * min(size))
        elif kind == "box":
            c, sz = np.asarray(part[1], float), np.asarray(part[2], float)
            k = int(np.argmax(sz))
            e = np.zeros(3)
            e[k] = sz[k] / 2
            seg(c - e, c + e, 0.5 * sorted(sz)[1])
        elif kind == "sphere":
            pts.append(np.asarray(part[1], float))
            rad.append(part[2])
    pts, rad = np.array(pts), np.array(rad)
    keep = np.ones(len(pts), bool)
    zones = [np.zeros(3)] + ([np.asarray(spec["markers"]["grip_L"])[:3, 3]] if spec.get("support") else [])
    for z in zones:               # the hands hold these stretches of the grip
        keep &= np.linalg.norm(pts - z, axis=1) > 0.07
    return pts[keep], rad[keep]


def _step(P, pts, rad, body, lam_t=4.0, lam_w=0.02):
    """One point-to-plane rigid update (rotation about the prop origin + translation)."""
    W = (P[:3, :3] @ pts.T).T + P[:3, 3]
    dep, n = depths(W, rad, body)
    bad = dep > 0
    if not bad.any():
        return P, 0.0
    r = W[bad] - P[:3, 3]
    A = np.concatenate([np.cross(r, n[bad]), n[bad]], 1)
    b = dep[bad] + 0.002
    reg = np.diag([lam_w] * 3 + [lam_t] * 3) * len(b) * 1e-3
    x = np.linalg.solve(A.T @ A + reg + 1e-9 * np.eye(6), A.T @ b)
    w, t = x[:3], x[3:]
    ang = np.linalg.norm(w)
    if ang > np.radians(12):
        w *= np.radians(12) / ang
    if np.linalg.norm(t) > 0.04:
        t *= 0.04 / np.linalg.norm(t)
    Q = P.copy()
    Q[:3, :3] = rotvec_matrix(w) @ P[:3, :3]
    Q[:3, 3] = P[:3, 3] + t
    return Q, float(dep.max())


def _log(R):
    c = np.clip((np.trace(R) - 1) / 2, -1, 1)
    a = np.arccos(c)
    if a < 1e-9:
        return np.zeros(3)
    return a / (2 * np.sin(a)) * np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])


def _smooth(vals, sigma, loop):
    n = len(vals)
    if sigma <= 0 or n < 3:
        return vals
    k = np.arange(-int(3 * sigma), int(3 * sigma) + 1)
    g = np.exp(-0.5 * (k / sigma) ** 2)
    g /= g.sum()
    out = np.zeros_like(vals)
    for i in range(n):
        idx = (i + k) % n if loop else np.clip(i + k, 0, n - 1)
        out[i] = (g[:, None] * vals[idx]).sum(0)
    return out


def resolve_track(Ps, bodies, pts, rad, loop=False, passes=4, iters=10):
    """Ps: per-frame prop frames (4x4, Blender world); bodies: per-frame posed body (P, N).
    Returns corrected frames and the worst remaining depth."""
    Ps = [np.array(P, float) for P in Ps]
    corr = np.zeros((len(Ps), 6))            # rotation vector (about the prop origin) + translation
    for ps in range(passes):
        for i, P0 in enumerate(Ps):
            P = P0.copy()
            P[:3, :3] = rotvec_matrix(corr[i, :3]) @ P0[:3, :3]
            P[:3, 3] = P0[:3, 3] + corr[i, 3:]
            for _ in range(iters):
                P, d = _step(P, pts, rad, bodies[i])
                if d <= 1e-4:
                    break
            corr[i, :3] = _log(P[:3, :3] @ P0[:3, :3].T)
            corr[i, 3:] = P[:3, 3] - P0[:3, 3]
        if not np.abs(corr).max() > 0:
            break                                # nothing touches the body
        if ps < passes - 1:
            # widen each correction a little in time, then smooth, so the prop eases around the body
            corr = _smooth(corr * 1.15, 2.0, loop)
    out = []
    worst = -1.0
    for i, P0 in enumerate(Ps):
        P = P0.copy()
        P[:3, :3] = rotvec_matrix(corr[i, :3]) @ P0[:3, :3]
        P[:3, 3] = P0[:3, 3] + corr[i, 3:]
        W = (P[:3, :3] @ pts.T).T + P[:3, 3]
        worst = max(worst, float(depths(W, rad, bodies[i])[0].max()))
        out.append(P)
    return out, worst, corr
