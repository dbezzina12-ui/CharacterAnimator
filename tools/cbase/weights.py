"""Skin weights computed on the unified body surface (before it is split into parts).

Because every part boundary vertex is the *same* unified vertex duplicated into both
parts, both copies always receive identical weights -> no cracks when posed.

Method:
  1. Every cage face carries a weight region (spine, neck, head, arm_L, hand_L,
     finger_index_L, thumb_L, leg_L, foot_L, ...). A vertex averages the functions of
     the regions it touches.
  2. Inside a region, weights follow a bone chain split by joint planes (bisector of the
     two bone directions) with a smoothstep blend of a per-joint width.
  3. Extra overlapping influences: clavicle/upper arm on the shoulder girdle, thighs on
     the lower pelvis, forearm twist on the distal forearm.
  4. Weights are diffused a few steps only near region seams, pruned to 4 influences
     and renormalised.
"""
import numpy as np

from .skeleton import FINGERS, HELPER_PAIRS, _n

MAX_INFLUENCES = 4


def _smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _chain(P, bones, joints):
    """P: (n,3). bones: list of names (len k). joints: list of (point, normal, width), len k-1.
    Returns dict bone -> weight array (partition of unity)."""
    ts = []
    for (pt, nrm, w) in joints:
        d = (P - pt) @ nrm
        w = w(P) if callable(w) else w
        ts.append(_smoothstep(-w, w, d))
    out = {}
    for i, b in enumerate(bones):
        wgt = np.ones(len(P))
        if i > 0:
            wgt = wgt * ts[i - 1]
        if i < len(ts):
            wgt = wgt * (1.0 - ts[i])
        out[b] = out.get(b, 0) + wgt
    return out


def _dir(b):
    return _n(b.tail - b.head)


def _bis(a, b):
    return _n(_dir(a) + _dir(b))


def region_weights(region, P, sk, m):
    s = sk.scale
    L = sk.landmarks
    B = sk.bones
    if region == "spine":
        w = _chain(P, ["pelvis", "spine_01", "spine_02", "chest"],
                   [(B["spine_01"].head, _bis(B["pelvis"], B["spine_01"]), 0.050 * s),
                    (B["spine_02"].head, _bis(B["spine_01"], B["spine_02"]), 0.050 * s),
                    (B["chest"].head, _bis(B["spine_02"], B["chest"]), 0.050 * s)])
        extra = {}
        for sd, sx in (("L", 1.0), ("R", -1.0)):
            side = _smoothstep(-0.02 * s, 0.03 * s, sx * P[:, 0])
            # thighs on the lower pelvis / buttocks
            hip = L[f"hip_{sd}"]
            back = _smoothstep(-0.01 * s, 0.07 * s, P[:, 1])
            f_front = _smoothstep(hip[2] - 0.03 * s, hip[2] - 0.10 * s, P[:, 2])
            f_back = _smoothstep(hip[2] + 0.07 * s, hip[2] - 0.10 * s, P[:, 2])
            extra[f"thigh_{sd}"] = 0.55 * (f_front * (1 - back) + f_back * back) * side
            # shoulder girdle: clavicle over the upper chest/trapezius, upper arm near the joint
            sh = L[f"shoulder_{sd}"]
            cl = B[f"clavicle_{sd}"]
            dsh = np.linalg.norm(P - sh, axis=1)
            fu = _smoothstep(0.15 * s, 0.045 * s, dsh)
            a, b = cl.head, cl.tail
            t = np.clip(((P - a) @ (b - a)) / np.dot(b - a, b - a), 0, 1)
            dcl = np.linalg.norm(P - (a + t[:, None] * (b - a)), axis=1)
            fc = _smoothstep(0.13 * s, 0.05 * s, dcl) * _smoothstep(0.1, 0.6, t) * side
            extra[f"upperarm_{sd}"] = 0.45 * fu * side
            extra[f"clavicle_{sd}"] = 0.40 * fc * (1 - 0.5 * fu) + 0.15 * fu * side
        tot = sum(extra.values())
        scale = np.clip(1.0 - tot, 0.0, 1.0)
        tot_c = np.maximum(tot, 1.0)
        out = {k: v * scale for k, v in w.items()}
        for k, v in extra.items():
            out[k] = v / tot_c
        return out
    if region == "neck":
        n2 = np.array([m.cage.V[i] for i in m.cage.rings["neck_top"]]).mean(0)
        return _chain(P, ["chest", "neck", "head"],
                      [(B["neck"].head + _dir(B["neck"]) * 0.004 * s, _dir(B["neck"]), 0.022 * s),
                       (n2, _dir(B["neck"]), 0.016 * s)])
    if region == "head" or region.startswith("ear_"):
        return {"head": np.ones(len(P))}
    sd = region[-1]
    if region.startswith("arm_"):
        cl, ua, fa, hd = (B[f"{x}_{sd}"] for x in ("clavicle", "upperarm", "forearm", "hand"))
        w = _chain(P, [cl.name, ua.name, fa.name, hd.name],
                   [(ua.head, _bis(cl, ua), 0.050 * s), (fa.head, _bis(ua, fa), 0.034 * s),
                    (hd.head, _dir(fa), 0.020 * s)])
        return _twist_split(w, P, fa, sd)
    if region.startswith("hand_"):
        fa, hd = B[f"forearm_{sd}"], B[f"hand_{sd}"]
        w = _chain(P, [fa.name, hd.name], [(hd.head, _dir(fa), 0.020 * s)])
        return _twist_split(w, P, fa, sd)
    if region.startswith("finger_") or region.startswith("thumb_"):
        fname = region.split("_")[1] if region.startswith("finger_") else "thumb"
        b1, b2, b3 = (B[f"{fname}_{i:02d}_{sd}"] for i in (1, 2, 3))
        hd = B[f"hand_{sd}"]
        u = hd.length / 0.098
        if fname == "thumb":
            j1 = (b1.head + _dir(b1) * 0.020 * u, _dir(b1), 0.014 * u)
        else:
            j1 = (b1.head, _dir(b1), 0.008 * u)
        return _chain(P, [hd.name, b1.name, b2.name, b3.name],
                      [j1, (b2.head, _bis(b1, b2), 0.0058 * u), (b3.head, _bis(b2, b3), 0.0050 * u)])
    if region.startswith("leg_"):
        pv, th, sh, ft = B["pelvis"], B[f"thigh_{sd}"], B[f"shin_{sd}"], B[f"foot_{sd}"]
        def hip_w(Q):
            back = _smoothstep(-0.01 * s, 0.07 * s, Q[:, 1])
            return (0.035 + 0.060 * back) * s
        return _chain(P, [pv.name, th.name, sh.name, ft.name],
                      [(th.head + _dir(th) * 0.070 * s, _dir(th), hip_w),
                       (sh.head, _bis(th, sh), 0.052 * s),
                       (ft.head + np.array([0, 0, 0.012 * s]), _dir(sh), 0.020 * s)])
    if region.startswith("foot_"):
        sh, ft, to = B[f"shin_{sd}"], B[f"foot_{sd}"], B[f"toe_{sd}"]
        return _chain(P, [sh.name, ft.name, to.name],
                      [(ft.head + np.array([0, 0, 0.012 * s]), _dir(sh), 0.020 * s),
                       (to.head, _n(_dir(ft) * np.array([1, 1, 0]) + 1e-9), 0.016 * s)])
    raise KeyError(region)


def _twist_split(w, P, fa, sd):
    tw = f"forearm_twist_{sd}"
    if fa.name not in w:
        return w
    a, b = fa.head, fa.tail
    t = ((P - a) @ (b - a)) / np.dot(b - a, b - a)
    f = _smoothstep(0.15, 1.0, t)
    w[tw] = w.get(tw, 0) + w[fa.name] * f
    w[fa.name] = w[fa.name] * (1 - f)
    return w


def shoulder_field(W, V, names, idx, sk, vreg, lap=None, iters=10):
    """Explicit shoulder/armpit weights (replaces the chain/diffusion result near each shoulder joint).

    How much a vertex follows the upper arm, f in [0, 1], comes from anatomy rather than distance:
      * deltoid cap (around/above the joint, lateral of it) and the arm itself (close to the upper-arm
        axis) follow the arm;
      * the ribcage side under the armpit (far from the arm axis) and the trapezius/neck (medial of the
        joint) stay with the torso, so raising an arm forms an armpit instead of stretching the chest.
    f is realised through the half-rotation shoulder helper: f<=0.5 -> helper 2f + torso; f>0.5 ->
    upper arm 2f-1 + helper 2-2f (so the arm-following share is exactly f and the crease is smooth).
    """
    s = sk.scale
    L = sk.landmarks
    B = sk.bones
    for sd, sx in (("L", 1.0), ("R", -1.0)):
        J = L[f"shoulder_{sd}"]
        a = _n(B[f"upperarm_{sd}"].tail - B[f"upperarm_{sd}"].head)
        rel = V - J
        along = rel @ a
        perp = np.linalg.norm(rel - along[:, None] * a[None, :], axis=1)
        in_arm = np.array([f"arm_{sd}" in r for r in vreg])
        ring = in_arm & (along > 0.06 * s) & (along < 0.10 * s)
        R = float(np.median(perp[ring]))                       # upper-arm radius just below the joint
        f_arm = _smoothstep(1.95 * R, 1.0 * R, perp) * _smoothstep(-0.045 * s, 0.03 * s, along)
        lat = sx * rel[:, 0]
        dist = np.linalg.norm(rel, axis=1)
        f_cap = _smoothstep(0.090 * s, 0.040 * s, dist) * _smoothstep(-0.045 * s, 0.005 * s, lat) \
            * _smoothstep(-0.02 * s, 0.02 * s, rel[:, 2] + 0.6 * lat)
        f = np.maximum(f_arm, 0.9 * f_cap)
        # only where the existing weights are shoulder-girdle weights, fading out down the upper arm
        grp = [idx[b] for b in (f"upperarm_{sd}", f"shoulder_helper_{sd}", f"clavicle_{sd}", "chest", "spine_02", "neck")]
        own = W[:, grp].sum(1)
        lam = _smoothstep(0.14 * s, 0.09 * s, along) * _smoothstep(0.90, 0.99, own) * _smoothstep(0.26 * s, 0.20 * s, dist)
        if not lam.any():
            continue
        iu, ih, ic, ich = idx[f"upperarm_{sd}"], idx[f"shoulder_helper_{sd}"], idx[f"clavicle_{sd}"], idx["chest"]
        new = np.zeros_like(W)
        new[:, iu] = np.clip(2 * f - 1, 0, 1)
        new[:, ih] = 2 * np.minimum(f, 1 - f)
        rest = np.clip(1 - 2 * f, 0, 1)
        torso = W.copy()
        torso[:, [iu, ih]] = 0.0
        tsum = torso.sum(1)
        fallback = np.zeros_like(W)
        fallback[np.arange(len(W)), np.where(rel[:, 2] > 0, ic, ich)] = 1.0
        torso = np.where(tsum[:, None] > 1e-6, torso / np.maximum(tsum, 1e-9)[:, None], fallback)
        new += rest[:, None] * torso
        W = (1 - lam)[:, None] * W + lam[:, None] * new
        if lap is not None:            # relax the new field over the surface (no jagged transition)
            rows, cols, deg = lap
            zone = lam > 1e-3
            for _ in range(iters):
                acc = np.zeros_like(W)
                np.add.at(acc, rows, W[cols])
                avg = acc / deg[:, None]
                W[zone] = 0.5 * W[zone] + 0.5 * avg[zone]
    return W


def compute_weights(m, sk, smooth_iters=6, smooth_rings=3):
    V = m.V
    n = len(V)
    names = [b for b in sk.order if sk[b].deform]
    idx = {b: i for i, b in enumerate(names)}
    W = np.zeros((n, len(names)))
    cnt = np.zeros(n)
    vreg = [set() for _ in range(n)]
    for f, r in zip(m.faces, m.face_region):
        for v in f:
            vreg[v].add(r)
    regions = sorted({r for rs in vreg for r in rs})
    for reg in regions:
        sel = np.array([reg in rs for rs in vreg])
        ids = np.nonzero(sel)[0]
        rw = region_weights(reg, V[ids], sk, m)
        for b, wv in rw.items():
            W[ids, idx[b]] += wv
        cnt[ids] += 1
    W /= cnt[:, None]
    # neighbour lists
    nb = [set() for _ in range(n)]
    for f in m.faces:
        k = len(f)
        for i in range(k):
            a, b = f[i], f[(i + 1) % k]
            nb[a].add(b)
            nb[b].add(a)
    # smoothing mask: vertices within `smooth_rings` of a region seam
    mask = np.array([len(r) > 1 for r in vreg])
    for _ in range(smooth_rings):
        grow = mask.copy()
        for v in np.nonzero(mask)[0]:
            for u in nb[v]:
                grow[u] = True
        mask = grow
    rows = np.repeat(np.arange(n), [len(x) for x in nb])
    cols = np.concatenate([list(x) for x in nb])
    deg = np.array([len(x) for x in nb], float)
    for _ in range(smooth_iters):
        acc = np.zeros_like(W)
        np.add.at(acc, rows, W[cols])
        avg = acc / deg[:, None]
        W[mask] = 0.5 * W[mask] + 0.5 * avg[mask]
    # route the overlap of each joint pair through its half-rotation helper
    for helper, (a, b) in HELPER_PAIRS.items():
        ia, ib, ih = idx[a], idx[b], idx[helper]
        m2 = np.minimum(W[:, ia], W[:, ib])
        W[:, ia] -= m2
        W[:, ib] -= m2
        W[:, ih] += 2 * m2
    W = shoulder_field(W, V, names, idx, sk, vreg, lap=(rows, cols, deg))
    # prune to MAX_INFLUENCES and renormalise
    order = np.argsort(-W, axis=1)
    keep = order[:, :MAX_INFLUENCES]
    Wp = np.zeros_like(W)
    r = np.arange(n)[:, None]
    Wp[r, keep] = W[r, keep]
    Wp[Wp < 1e-4] = 0.0
    Wp /= Wp.sum(1, keepdims=True)
    # quantise to 1/65535 so glTF (UNSIGNED_SHORT normalised) round-trips exactly
    return names, Wp
