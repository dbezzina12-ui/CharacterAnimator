"""Anatomical control cage for the blank humanoid.

The cage is a single closed quad-dominant polygon mesh whose topology is fixed for
template version 1; only vertex *positions* depend on the proportion parameters.
Every cage vertex is given a desired *surface* position; `subdiv.fit_interpolating`
then solves for control points so the Catmull-Clark limit surface passes through
those targets. Body parts are face sets, so part boundaries are shared edge loops
of one continuous surface (no gaps, no random intersections).

Topology summary (cage level; x16 faces after 2 subdivision levels):
  torso/pelvis 8 around | neck 8 | head 24 around (8->24 hexagon strip) + 6x6 crown cap
  arms 6 around | palm 10 | fingers & thumb 4 | legs 6 | feet 8 with capped heel/toe
"""
import numpy as np

from .params import girth
from .skeleton import FINGERS, _n, _perp

SQ = 1.0 / np.sqrt(2.0)


class Cage:
    def __init__(self):
        self.V = []
        self.F = []
        self.part = []
        self.region = []
        self.seams = set()
        self.vtag = []          # per-vertex semantic tag (for sculpting / debugging)
        self.rings = {}          # named rings -> vertex index lists
        self.mirror = {}         # centre-structure vertex -> mirror partner

    def v(self, p, tag=""):
        self.V.append(np.asarray(p, float))
        self.vtag.append(tag)
        return len(self.V) - 1

    def face(self, vs, part, region):
        vs = tuple(int(x) for x in vs)
        assert len(set(vs)) == len(vs), vs
        self.F.append(vs)
        self.part.append(part)
        self.region.append(region)
        return len(self.F) - 1

    def seam(self, a, b):
        self.seams.add((a, b) if a < b else (b, a))

    def seam_path(self, vs):
        for a, b in zip(vs[:-1], vs[1:]):
            self.seam(a, b)

    def strip(self, A, B, part, region, skip=()):
        n = len(A)
        assert n == len(B)
        for i in range(n):
            if i in skip:
                continue
            self.face((A[i], A[(i + 1) % n], B[(i + 1) % n], B[i]), part, region)


def _sym8(pts):
    """8-ring from the 5 left-half points k=0..4 (front, front-left, left, back-left, back)."""
    M = np.array([-1.0, 1, 1])
    p = [np.asarray(x, float) for x in pts]
    return [p[0], p[1], p[2], p[3], p[4], p[3] * M, p[2] * M, p[1] * M]


def _ellip_raycast(F, origin, d, tmax=0.4):
    lo, hi = 0.0, tmax
    assert F(origin) < 0
    for _ in range(48):
        mid = 0.5 * (lo + hi)
        if F(origin + d * mid) < 0:
            lo = mid
        else:
            hi = mid
    return origin + d * 0.5 * (lo + hi)


def _ellipsoid(q, c, r):
    p = (q - c)
    k0 = np.linalg.norm(p / r)
    k1 = np.linalg.norm(p / (r * r))
    return k0 * (k0 - 1.0) / max(k1, 1e-9)


def _smin(a, b, k):
    h = max(k - abs(a - b), 0.0) / k
    return min(a, b) - h * h * k * 0.25


def head_field(hs_s, C, neck_a=None, neck_b=None, neck_r=(0.056, 0.051), neck_cy=0.0):
    """Implicit head (cranium + face mass + chin + jaw angles) smoothly united with a
    neck column, in world units. The column gives a clean nape and throat fillet."""
    comps = [
        (np.array([0, 0.015, 0.020]), np.array([0.096, 0.111, 0.117])),
        (np.array([0, -0.020, -0.066]), np.array([0.071, 0.071, 0.080])),
        (np.array([0, -0.064, -0.128]), np.array([0.028, 0.021, 0.021])),
        (np.array([0.050, 0.000, -0.098]), np.array([0.019, 0.024, 0.024])),
        (np.array([-0.050, 0.000, -0.098]), np.array([0.019, 0.024, 0.024])),
    ]

    def F(p):
        q = (p - C) / hs_s
        d = _ellipsoid(q, *comps[0])
        for c, r in comps[1:3]:
            d = _smin(d, _ellipsoid(q, c, r), 0.040)
        for c, r in comps[3:]:
            d = _smin(d, _ellipsoid(q, c, r), 0.018)
        d = d * hs_s
        if neck_a is not None:
            ax = neck_b - neck_a
            t = np.dot(p - neck_a, ax) / np.dot(ax, ax)
            c = neck_a + ax * t
            rel = p - c
            e = np.sqrt((rel[0] / neck_r[0]) ** 2 + ((rel[1] - neck_cy) / neck_r[1]) ** 2 + 1e-12)
            dn = (e - 1.0) * min(neck_r)
            dn = max(dn, (t - 1.0) * np.linalg.norm(ax))
            d = _smin(d, dn, 0.024 * hs_s)
        return d

    def Fneck(p):
        ax = neck_b - neck_a
        t = np.dot(p - neck_a, ax) / np.dot(ax, ax)
        rel = p - (neck_a + ax * t)
        e = np.sqrt((rel[0] / neck_r[0]) ** 2 + ((rel[1] - neck_cy) / neck_r[1]) ** 2 + 1e-12)
        return (e - 1.0) * min(neck_r)
    F.neck = Fneck
    return F


def build_cage(sk, p):
    """Return Cage with target surface positions for skeleton `sk` / params `p`."""
    cg = Cage()
    L = sk.landmarks
    s = sk.scale
    tw, td, bs, sw = p["torsoWidth"], p["torsoDepth"], p["bellySize"], p["shoulderWidth"]
    hw, ww = p.get("hipWidth", 1.0), p.get("waistWidth", 1.0)
    # pelvis rings widen with hipWidth (most at the hip-joint ring, buttocks a little fuller behind);
    # the waist ring follows waistWidth. All factors are exactly 1.0 for the neutral template.
    hx0, hx1, hx2 = tw * (1.0 + 0.9 * (hw - 1.0)), tw * (1.0 + 0.9 * (hw - 1.0)), tw * (1.0 + 0.45 * (hw - 1.0))
    hb0, hb1 = td * (1.0 + 0.4 * (hw - 1.0)), td * (1.0 + 0.5 * (hw - 1.0))
    wx = tw * ww
    g = girth(p)
    hipz, nbz = L["hip_z"], L["neckbase_z"]

    def T(x, y, z_abs, xs=1.0, ys=1.0):
        return np.array([x * s * xs, y * s * ys, z_abs])

    b1 = bs - 1.0
    shx = (L["sh_x"] / s) / 0.168           # shoulder spread relative to default
    # ---------------- torso / pelvis rings (desired surface points) ----------------
    Z = lambda dz, base=hipz: base + dz * s  # noqa: E731
    ring_defs = {
        "r0": [T(0, -0.075 - 0.004 * b1, Z(-0.050), hx0, td), T(0.106, -0.070, Z(-0.046), hx0, td),
               T(0.160, 0.000, Z(-0.036), hx0, td), T(0.100, 0.105, Z(-0.092), hx0, hb0),
               T(0, 0.088, Z(-0.078), hx0, hb0)],
        "r1": [T(0, -0.092 - 0.008 * b1, Z(0.018), hx1, td), T(0.128, -0.082 - 0.004 * b1, Z(0.016), hx1, td),
               T(0.166, 0.006, Z(0.010), hx1, td), T(0.126, 0.120, Z(-0.004), hx1, hb1),
               T(0, 0.104, Z(0.000), hx1, hb1)],
        "r2": [T(0, -0.097 - 0.022 * b1, Z(0.095), hx2, td), T(0.120, -0.084 - 0.012 * b1, Z(0.097), hx2, td),
               T(0.150, 0.004, Z(0.100), hx2, td), T(0.116, 0.092, Z(0.095), hx2, td),
               T(0, 0.078, Z(0.092), hx2, td)],
        "r3": [T(0, -0.102 - 0.036 * b1, Z(0.168), wx, td), T(0.105 + 0.008 * b1, -0.088 - 0.022 * b1, Z(0.168), wx, td),
               T(0.132 + 0.006 * b1, 0.004, Z(0.168), wx, td), T(0.104, 0.084, Z(0.168), wx, td),
               T(0, 0.068, Z(0.168), wx, td)],
        "r4": [T(0, -0.112 - 0.018 * b1, Z(0.268), tw, td), T(0.120, -0.096 - 0.008 * b1, Z(0.268), tw, td),
               T(0.151, 0.004, Z(0.268), tw, td), T(0.124, 0.094, Z(0.268), tw, td),
               T(0, 0.086, Z(0.268), tw, td)],
        "r5": [T(0, -0.122, Z(0.360), tw, td), T(0.132 * (0.7 + 0.3 * shx), -0.090, Z(0.362), tw, td),
               T(0.156 * (0.75 + 0.25 * shx), 0.012, Z(0.345), tw, td),
               T(0.130 * (0.7 + 0.3 * shx), 0.092, Z(0.365), tw, td), T(0, 0.104, Z(0.362), tw, td)],
        "r6": [T(0, -0.108, Z(-0.058, nbz), tw, td), T(0.150 * shx, -0.062, Z(-0.014, nbz), 1.0, td),
               T(0.198 * shx, 0.008, Z(0.016, nbz), 1.0, 1.0), T(0.150 * shx, 0.080, Z(-0.004, nbz), 1.0, td),
               T(0, 0.104, Z(-0.036, nbz), tw, td)],
        "r7": [T(0, -0.044, Z(0.002, nbz)), T(0.047, -0.029, Z(0.022, nbz)), T(0.064, 0.016, Z(0.048, nbz)),
               T(0.048, 0.060, Z(0.052, nbz)), T(0, 0.074, Z(0.052, nbz))],
        "n1": [T(0, -0.040, Z(0.036, nbz)), T(0.042, -0.026, Z(0.052, nbz)), T(0.057, 0.015, Z(0.082, nbz)),
               T(0.045, 0.057, Z(0.095, nbz)), T(0, 0.070, Z(0.101, nbz))],
        "n2": [T(0, -0.039, Z(0.072, nbz)), T(0.044, -0.025, Z(0.086, nbz)), T(0.061, 0.014, Z(0.117, nbz)),
               T(0.049, 0.057, Z(0.139, nbz)), T(0, 0.074, Z(0.148, nbz))],
    }
    # neck girth follows head/torso mildly
    for key in ("r7", "n1", "n2"):
        c = np.array([0, 0.018 * s, 0])
        pts = []
        for q in ring_defs[key]:
            d = q - np.array([0, c[1], q[2]])
            pts.append(np.array([0, c[1], q[2]]) + d * np.array([g ** 0.5, g ** 0.5, 0]) + np.array([0, 0, 0]))
            pts[-1][2] = q[2]
        ring_defs[key] = pts
    rings = {}
    for key, pts in ring_defs.items():
        idx = [cg.v(q, f"{key}_{k}") for k, q in enumerate(_sym8(pts))]
        rings[key] = idx
        for k in range(8):
            cg.mirror[idx[k]] = idx[(8 - k) % 8]
    cg.rings.update(rings)
    crotch = cg.v(T(0, 0.000, Z(-0.112)), "crotch")
    cg.mirror[crotch] = crotch
    r0, r1, r2, r3, r4, r5, r6, r7, n1, n2 = (rings[k] for k in
                                              ("r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7", "n1", "n2"))
    cg.strip(r0, r1, "Pelvis", "spine")
    cg.strip(r1, r2, "Pelvis", "spine")
    cg.strip(r2, r3, "Pelvis", "spine")
    cg.strip(r3, r4, "Torso", "spine")
    cg.strip(r4, r5, "Torso", "spine")
    cg.strip(r5, r6, "Torso", "spine", skip=(1, 2, 5, 6))
    cg.strip(r6, r7, "Torso", "spine")
    cg.strip(r7, n1, "Neck", "neck")
    cg.strip(n1, n2, "Neck", "neck")
    # torso/pelvis seams: sides (front/back islands); neck: back line
    for side_k in (2, 6):
        cg.seam_path([r0[side_k], r1[side_k], r2[side_k], r3[side_k], r4[side_k], r5[side_k]])
        cg.seam_path([r6[side_k], r7[side_k]])
    cg.seam_path([r7[4], n1[4], n2[4]])

    # ---------------- head ----------------
    hs_s = p["headSize"] * s
    C = np.array([0, -0.008 * s, L["chin_z"] + 0.150 * hs_s])
    n2p = [cg.V[i] for i in n2]
    nk = sk["neck"]
    nr = (0.5 * (n2p[2][0] - n2p[6][0]), 0.5 * (n2p[4][1] - n2p[0][1]))
    ncy = 0.5 * (n2p[4][1] + n2p[0][1])
    na = np.array([0.0, 0.0, nk.head[2] - 0.05 * s])
    nb_ = np.array([0.0, 0.0, C[2] - 0.02 * hs_s])
    F = head_field(hs_s, C, na, nb_, nr, ncy)
    NH = 24
    # h0: expanded neck-top ring (24) bridging to the head
    h0 = []
    for j in range(NH):
        k, fr = divmod(j, 3)
        a, b = n2p[k], n2p[(k + 1) % 8]
        q = a + (b - a) * (fr / 3.0)
        o = np.array([0.0, ncy, q[2] + (0.0105 - 0.0025 * np.cos(np.radians(15 * j))) * s])
        dr = q - np.array([0.0, ncy, q[2]])
        dr[2] = 0.0
        h0.append(cg.v(_ellip_raycast(F, o, _n(dr)), f"h0_{j}"))
    for k in range(8):
        cg.face((n2[k], n2[(k + 1) % 8], h0[(3 * k + 3) % NH], h0[3 * k + 2], h0[3 * k + 1], h0[3 * k]),
                "Head", "head")
    lat_front = [-60, -48, -36, -24, -12, 0, 12, 23, 34, 45, 56]
    lat_back = [-38, -27, -16, -6, 4, 14, 23, 32, 40, 48, 57]

    def hdir(phi, lam):
        phi, lam = np.radians(phi), np.radians(lam)
        return np.array([np.cos(lam) * np.sin(phi), -np.cos(lam) * np.cos(phi), np.sin(lam)])

    hr = [h0]
    gap = 0.007 * hs_s
    for i in range(len(lat_front)):
        ring = []
        for j in range(NH):
            phi = 360.0 * j / NH
            w = ((1 - np.cos(np.radians(phi))) / 2.0) ** 2
            lam = lat_front[i] * (1 - w) + lat_back[i] * w
            below = cg.V[hr[-1][j]]
            hit = _ellip_raycast(F, C, hdir(phi, lam))
            while hit[2] < below[2] + gap and lam < 80:     # keep rings strictly ordered bottom->top
                lam += 1.0
                hit = _ellip_raycast(F, C, hdir(phi, lam))
            ring.append(cg.v(hit, f"h{i + 1}_{j}"))
        hr.append(ring)
    for ring in hr:
        for j in range(NH):
            cg.mirror[ring[j]] = ring[(NH - j) % NH]
    # ear ports: left j=6..7, rings h3..h5 ; right mirrored j=17..18
    ear_skip = {3: set(), 4: set()}
    EAR_J = {"L": 6, "R": NH - 7}
    for sd, j0 in EAR_J.items():
        ear_skip[3].add(j0)
        ear_skip[4].add(j0)
    for i in range(len(hr) - 1):
        cg.strip(hr[i], hr[i + 1], "Head", "head", skip=ear_skip.get(i, ()))
    # crown cap: 6x6 grid on the last ring
    top = hr[-1]
    G = 6
    loop = []   # boundary grid coords in ring order starting at j=21 (front-right corner)
    for i in range(G):
        loop.append((i, 0))
    for k in range(G):
        loop.append((G, k))
    for i in range(G, 0, -1):
        loop.append((i, G))
    for k in range(G, 0, -1):
        loop.append((0, k))
    grid = {}
    for m, gk in enumerate(loop):
        grid[gk] = top[(21 + m) % NH]
    bpos = {gk: cg.V[grid[gk]] for gk in loop}
    for i in range(1, G):
        for k in range(1, G):
            u, v = i / G, k / G
            P = ((1 - v) * bpos[(i, 0)] + v * bpos[(i, G)] + (1 - u) * bpos[(0, k)] + u * bpos[(G, k)]
                 - ((1 - u) * (1 - v) * bpos[(0, 0)] + u * (1 - v) * bpos[(G, 0)]
                    + (1 - u) * v * bpos[(0, G)] + u * v * bpos[(G, G)]))
            grid[(i, k)] = cg.v(_ellip_raycast(F, C, _n(P - C)), f"cap_{i}_{k}")
    for i in range(1, G):
        for k in range(1, G):
            mi = G - i
            cg.mirror[grid[(i, k)]] = grid[(mi, k)]
    for i in range(G):
        for k in range(G):
            cg.face((grid[(i, k)], grid[(i + 1, k)], grid[(i + 1, k + 1)], grid[(i, k + 1)]), "Head", "head")
    # ears
    for sd, j0 in EAR_J.items():
        j1 = (j0 + 1) % NH
        if sd == "R":
            j0, j1 = j1, j0   # keep front->back order mirrored
        a, b = hr[3], hr[4]
        c5 = hr[5]
        port = [a[j0], a[j1], b[j1], c5[j1], c5[j0], b[j0]]  # bot-front, bot-back, mid-back, top-back, top-front, mid-front
        P = np.array([cg.V[i] for i in port])
        pc = P.mean(0)
        nrm = _n(pc - C)
        nrm = _n(nrm + np.array([0, 0.25, 0]))            # ears angle back a little
        up = _perp(np.array([0, 0, 1.0]), nrm)
        bk = _n(np.cross(up, nrm)) if sd == "L" else -_n(np.cross(up, nrm))
        if bk[1] < 0:
            bk = -bk
        prev = port
        # rounded "C" ear: rings are ellipses in the (back, up) plane of the ear port
        angs = np.radians([240, 300, 0, 60, 120, 180])     # matches port order
        specs = [(0.004, 0.003, 0.013, 0.022), (0.011, 0.009, 0.016, 0.029), (0.016, 0.014, 0.012, 0.026)]
        for off, back, rh_, rv_ in specs:
            ring = []
            for ang in angs:
                q = pc + nrm * off * hs_s + bk * (back + rh_ * np.cos(ang)) * hs_s + up * (rv_ * np.sin(ang)) * hs_s
                ring.append(cg.v(q, f"ear_{sd}"))
            cg.strip(prev, ring, "Head", f"ear_{sd}")
            prev = ring
        e = prev
        # cap as two quads: (bb, mb, mf, bf) and (mb, tb, tf, mf)
        cg.face((e[1], e[2], e[5], e[0]), "Head", f"ear_{sd}")
        cg.face((e[2], e[3], e[4], e[5]), "Head", f"ear_{sd}")
        cg.seam_path(port + [port[0]])
        cg.rings[f"ear_port_{sd}"] = port
    # face / scalp seams: columns j=6 and j=18 up to ring 8, then across the forehead on ring 8
    TOPR = 9
    for jc in (6, 18):
        path = [n2[jc // 3]] + [hr[i][jc] for i in range(0, TOPR + 1)]
        cg.seam_path(path)
    fore = [hr[TOPR][j % NH] for j in range(18, NH + 7)]
    cg.seam_path(fore)
    cg.rings["head"] = hr
    cg.rings["neck_top"] = n2
    cg.head_center = C
    cg.head_scale = hs_s

    # ---------------- limbs (left built, right mirrored) ----------------
    vstart, fstart = len(cg.V), len(cg.F)
    seam_before = set(cg.seams)
    arm_port = [r5[1], r5[2], r5[3], r6[3], r6[2], r6[1]]
    leg_port = [r0[0], r0[1], r0[2], r0[3], r0[4], crotch]
    _build_left_arm(cg, sk, p, arm_port, g, s)
    _build_left_leg(cg, sk, p, leg_port, g, s)
    vend, fend = len(cg.V), len(cg.F)
    new_seams = cg.seams - seam_before
    M = np.array([-1.0, 1, 1])
    vmap = dict(cg.mirror)
    for i in range(vstart, vend):
        vmap[i] = cg.v(cg.V[i] * M, cg.vtag[i].replace("_L", "_R"))
    for fi in range(fstart, fend):
        f = cg.F[fi]
        cg.face(tuple(vmap[i] for i in f), cg.part[fi].replace("_L", "_R"), cg.region[fi].replace("_L", "_R"))
    for (a, b) in new_seams:
        cg.seam(vmap[a], vmap[b])
    def _mapr(x):
        return [_mapr(y) for y in x] if isinstance(x, list) else vmap[x]
    for key in list(cg.rings.keys()):
        if key.endswith("_L") and key[:-2] + "_R" not in cg.rings:
            cg.rings[key[:-2] + "_R"] = _mapr(cg.rings[key])
    orient_faces(cg)
    return cg


def _frame_arm(a, rh, nh):
    D = _perp(-nh, a)
    R = np.cross(a, D)
    if np.dot(R, rh) < 0:
        R = -R
    return D, R


def _arm_ring(c, a, rh, nh, rd, rp, rr, ru):
    D, R = _frame_arm(a, rh, nh)
    out = []
    for i in range(6):
        al = np.radians(120 + 60 * i)
        ca, sa = np.cos(al), np.sin(al)
        out.append(c + ca * D * (rd if ca >= 0 else rp) + sa * R * (rr if sa >= 0 else ru))
    return out


def _build_left_arm(cg, sk, p, port, g, s):
    L = sk.landmarks
    rh, nh = L["hand_r_L"], L["hand_n_L"]
    ua, fa = sk["upperarm_L"], sk["forearm_L"]
    G = g * s
    # (bone, t, dorsal, palmar, radial, ulnar) radii in metres @ scale 1
    spec = [
        (ua, 0.16, 0.061, 0.049, 0.057, 0.058, "UpperArm_L"),
        (ua, 0.50, 0.050, 0.045, 0.049, 0.048, "UpperArm_L"),
        (ua, 0.86, 0.043, 0.039, 0.042, 0.041, "UpperArm_L"),
        (fa, 0.00, 0.039, 0.035, 0.038, 0.042, "Forearm_L"),     # elbow ring (part boundary)
        (fa, 0.13, 0.041, 0.037, 0.042, 0.039, "Forearm_L"),
        (fa, 0.34, 0.040, 0.035, 0.043, 0.037, "Forearm_L"),
        (fa, 0.72, 0.030, 0.025, 0.034, 0.030, "Forearm_L"),
        (fa, 1.00, 0.021, 0.020, 0.031, 0.029, "Forearm_L"),     # wrist ring (part boundary)
    ]
    prev = port
    seam_line = [port[1]]
    for k, (b, t, rd, rp, rr, ru, part) in enumerate(spec):
        c = b.head + (b.tail - b.head) * t
        a = _n(b.tail - b.head)
        if k == 0:
            c = c + _perp(np.array([0, 0, 1.0]), a) * 0.006 * s
        ring = [cg.v(q, f"arm{k}_L") for q in _arm_ring(c, a, rh, nh, rd * G, rp * G, rr * G, ru * G)]
        part_here = "UpperArm_L" if k <= 3 else "Forearm_L"
        cg.strip(prev, ring, part_here, "arm_L")
        seam_line.append(ring[1])
        prev = ring
        if k == 3:
            cg.rings["elbow_L"] = ring
    cg.seam_path(seam_line)
    cg.rings["wrist_L"] = prev
    _build_left_hand(cg, sk, p, prev, s)


def _build_left_hand(cg, sk, p, W, s):
    L = sk.landmarks
    wrist, yh, rd, nd = L["wrist_L"], L["hand_y_L"], L["hand_r_L"], L["hand_n_L"]
    u = sk["hand_L"].length / 0.098        # handSize * scale

    def H(l, r, n):
        return wrist + yh * (l * u) + rd * (r * u) + nd * (n * u)

    def palm_ring(l, dr, dn, pr, pn, dl=None, pl=None):
        # returns [p0..p4, d4..d0]  (increasing alpha order)
        P = [H(l if pl is None else pl[i], pr[i], pn[i]) for i in range(5)]
        D = [H(l if dl is None else dl[i], dr[i], dn[i]) for i in range(5)]
        return P + D[::-1]

    P1 = palm_ring(0.016, [0.033, 0.016, 0.0, -0.016, -0.030], [-0.011, -0.016, -0.017, -0.016, -0.012],
                   [0.036, 0.018, 0.0, -0.017, -0.031], [0.022, 0.019, 0.013, 0.017, 0.019])
    P2 = palm_ring(0.054, [0.031, 0.019, 0.0, -0.020, -0.038], [-0.011, -0.015, -0.016, -0.015, -0.011],
                   [0.032, 0.020, 0.0, -0.021, -0.039], [0.019, 0.015, 0.011, 0.015, 0.016])
    bl = [0.088, 0.095, 0.097, 0.091, 0.080]
    P3 = palm_ring(None, [0.0425, 0.0205, -0.0005, -0.0205, -0.0405], [-0.010, -0.0125, -0.013, -0.012, -0.009],
                   [0.0425, 0.0205, -0.0005, -0.0205, -0.0405], [0.010, 0.011, 0.011, 0.011, 0.010],
                   dl=bl, pl=[x - 0.002 for x in bl])
    R1 = [cg.v(q, "palm1_L") for q in P1]
    R2 = [cg.v(q, "palm2_L") for q in P2]
    R3 = [cg.v(q, "palm3_L") for q in P3]
    # wrist (6) -> palm (10) transition; palm index: p0..p4 = 0..4, d4..d0 = 5..9
    pi = lambda name: {"p0": 0, "p1": 1, "p2": 2, "p3": 3, "p4": 4, "d4": 5, "d3": 6, "d2": 7, "d1": 8, "d0": 9}[name]  # noqa
    A = R1
    part, reg = "Hand_L", "hand_L"
    cg.face((W[0], W[1], A[pi("p2")], A[pi("p1")], A[pi("p0")]), part, reg)
    cg.face((W[1], W[2], A[pi("p4")], A[pi("p3")], A[pi("p2")]), part, reg)
    cg.face((W[2], W[3], A[pi("d4")], A[pi("p4")]), part, reg)
    cg.face((W[3], W[4], A[pi("d2")], A[pi("d3")], A[pi("d4")]), part, reg)
    cg.face((W[4], W[5], A[pi("d0")], A[pi("d1")], A[pi("d2")]), part, reg)
    cg.face((W[5], W[0], A[pi("p0")], A[pi("d0")]), part, reg)
    # palm strips; thumb port = radial side face between R1 and R2 (edge d0(9) -> p0(0))
    cg.strip(R1, R2, part, reg, skip=(9,))
    cg.strip(R2, R3, part, reg)
    # palmar/dorsal split seams along p0 and p4 lines
    cg.seam_path([W[0], R1[0], R2[0], R3[0]])
    cg.seam_path([W[2], R1[4], R2[4], R3[4]])
    cg.rings["palm_L"] = [R1, R2, R3]
    # ---- fingers ----
    fw = {"index": (0.0112, 0.0103), "middle": (0.0116, 0.0106), "ring": (0.0110, 0.0101), "pinky": (0.0099, 0.0091)}
    for c, fname in enumerate(FINGERS):
        d_c, d_c1 = R3[9 - c], R3[9 - (c + 1)]
        p_c, p_c1 = R3[c], R3[c + 1]
        port = [d_c, d_c1, p_c1, p_c]     # dorsal-radial, dorsal-ulnar, palmar-ulnar, palmar-radial
        b1, b2, b3 = (sk[f"{fname}_{i:02d}_L"] for i in (1, 2, 3))
        w, h = fw[fname]
        stations = [(b1, 0.50, 1.00), (b2, 0.00, 1.05), (b3, 0.00, 1.02), (b3, 0.52, 0.93), (b3, 1.00, 0.70)]
        prev = port
        seam_u, seam_r = [p_c1], [p_c]
        for k, (b, t, sc) in enumerate(stations):
            cpos = b.head + (b.tail - b.head) * t
            a = _n(b.tail - b.head)
            rho = _perp(rd, a)
            nu = _perp(nd, a)
            nu = _n(nu - np.dot(nu, rho) * rho)
            ww, hh = w * u * sc, h * u * sc
            if k == len(stations) - 1:
                cpos = cpos + a * 0.0015 * u
            ring = [cg.v(cpos + rho * ww * SQ - nu * hh * SQ, f"{fname}_L"),
                    cg.v(cpos - rho * ww * SQ - nu * hh * SQ, f"{fname}_L"),
                    cg.v(cpos - rho * ww * SQ + nu * hh * SQ, f"{fname}_L"),
                    cg.v(cpos + rho * ww * SQ + nu * hh * SQ, f"{fname}_L")]
            cg.strip(prev, ring, part, f"finger_{fname}_L")
            seam_u.append(ring[2])
            seam_r.append(ring[3])
            prev = ring
        cg.face(tuple(prev), part, f"finger_{fname}_L")     # fingertip cap
        cg.seam_path(seam_u)
        cg.seam_path(seam_r)
        cg.seam(prev[2], prev[3])
    # ---- thumb ----
    port = [R1[9], R2[9], R2[0], R1[0]]       # d0@P1, d0@P2, p0@P2, p0@P1
    Pp = np.array([cg.V[i] for i in port])
    pc = Pp.mean(0)
    t1, t2, t3 = sk["thumb_01_L"], sk["thumb_02_L"], sk["thumb_03_L"]
    stations = [(t1, 0.78, 0.0168, 0.0150), (t2, 0.00, 0.0142, 0.0128), (t2, 0.50, 0.0134, 0.0120),
                (t3, 0.00, 0.0130, 0.0116), (t3, 0.52, 0.0120, 0.0108), (t3, 1.00, 0.0087, 0.0079)]
    prev = port
    seam_line = [port[3]]
    for k, (b, t, w, h) in enumerate(stations):
        cpos = b.head + (b.tail - b.head) * t
        a = _n(b.tail - b.head)
        if k == len(stations) - 1:
            cpos = cpos + a * 0.0015 * u
        zf = _perp(-rd + 0.8 * nd, a)                 # flexion side of the thumb
        xf = np.cross(a, zf)
        # uniform corners; twist chosen to best match the port corner directions
        angs = []
        for q in Pp:
            dq = q - pc
            angs.append(np.arctan2(np.dot(dq, zf), np.dot(dq, xf)))
        base = np.radians([45, 135, 225, 315])
        best = None
        for sign in (1, -1):
            for shift in range(4):
                cand = np.array([base[(shift + sign * i) % 4] for i in range(4)])
                off = np.angle(np.mean(np.exp(1j * (np.array(angs) - cand))))
                err = np.sum(1 - np.cos(np.array(angs) - cand - off))
                if best is None or err < best[0]:
                    best = (err, cand + off)
        ring = []
        for ang in best[1]:
            ring.append(cg.v(cpos + xf * np.cos(ang) * w * u + zf * np.sin(ang) * h * u, "thumb_L"))
        cg.strip(prev, ring, "Hand_L", "thumb_L")
        seam_line.append(ring[3])
        prev = ring
    cg.face(tuple(prev), "Hand_L", "thumb_L")
    cg.seam_path(port + [port[0]])
    cg.seam_path(seam_line)


def _leg_ring(c, a, rout, rin, rfront, rback, phis):
    O = _perp(np.array([1.0, 0, 0]), a)
    Fw = _perp(np.array([0, -1.0, 0]), a)
    Fw = _n(Fw - np.dot(Fw, O) * O)
    out = []
    for ph in phis:
        t = np.radians(ph)
        ct, st = np.cos(t), np.sin(t)
        out.append(c + ct * O * (rout if ct >= 0 else rin) + st * Fw * (rfront if st >= 0 else rback))
    return out


def _build_left_leg(cg, sk, p, port, g, s):
    L = sk.landmarks
    th, sh = sk["thigh_L"], sk["shin_L"]
    G = g * s
    base_phi = [120, 60, 0, 300, 240, 180]
    # (bone, t, out, in, front, back, twist_deg)
    spec = [
        (th, 0.30, 0.083, 0.073, 0.080, 0.086, 0),
        (th, 0.56, 0.072, 0.065, 0.072, 0.070, 0),
        (th, 0.87, 0.058, 0.054, 0.058, 0.056, 0),
        (sh, 0.00, 0.053, 0.053, 0.057, 0.050, 0),     # knee ring (part boundary)
        (sh, 0.11, 0.051, 0.051, 0.051, 0.056, 5),
        (sh, 0.32, 0.052, 0.050, 0.046, 0.066, 10),
        (sh, 0.68, 0.039, 0.037, 0.037, 0.044, 20),
        (sh, 0.90, 0.032, 0.031, 0.031, 0.034, 28),
    ]
    prev = port
    seam_line = [port[5]]
    hw = p.get("hipWidth", 1.0)
    thigh_fill = [1.0 + 0.9 * (hw - 1.0), 1.0 + 0.5 * (hw - 1.0), 1.0 + 0.2 * (hw - 1.0)]   # upper thighs follow the hips
    for k, (b, t, ro, ri, rf, rb, tw_) in enumerate(spec):
        c = b.head + (b.tail - b.head) * t
        a = _n(b.tail - b.head)
        phis = [ph + tw_ for ph in base_phi]
        Gk = G * thigh_fill[k] if k < len(thigh_fill) else G
        ring = [cg.v(q, f"leg{k}_L") for q in _leg_ring(c, a, ro * Gk, ri * Gk, rf * Gk, rb * Gk, phis)]
        cg.strip(prev, ring, "Thigh_L" if k <= 3 else "Shin_L", "leg_L")
        seam_line.append(ring[5])
        prev = ring
        if k == 3:
            cg.rings["knee_L"] = ring
    cg.rings["ankle_top_L"] = prev
    foot_port = _build_left_foot(cg, sk, p, s)
    cg.strip(prev, foot_port, "Shin_L", "leg_L")
    seam_line.append(foot_port[5])
    cg.seam_path(seam_line)


def _build_left_foot(cg, sk, p, s):
    L = sk.landmarks
    fz = p["footSize"]
    u = fz * s
    heel = L["heel_L"]
    f = L["foot_fwd_L"]
    so = _perp(np.array([1.0, 0, 0]), f)
    so[2] = 0
    so = _n(so)
    up = np.array([0, 0, 1.0])

    def P(fd, sd, z):
        return np.array([heel[0], heel[1], 0.0]) + f * (fd * u) + so * (sd * u) + up * (z * u)

    rows = [  # f, w_out, w_in, top, bottom_out, bottom_in
        (0.014, 0.025, 0.025, 0.060, 0.006, 0.006),
        (0.036, 0.032, 0.031, 0.086, 0.000, 0.001),
        (0.092, 0.037, 0.037, 0.074, 0.000, 0.006),
        (0.145, 0.042, 0.040, 0.055, 0.000, 0.011),
        (0.190, 0.046, 0.045, 0.038, 0.000, 0.002),
        (0.232, 0.040, 0.045, 0.026, 0.000, 0.000),
    ]
    R = []
    for k, (fd, wo, wi, top, bo, bi) in enumerate(rows):
        fin = fd + (0.006 if k == 5 else 0.0)   # big-toe side reaches further
        pts = [P(fd, 0, top), P(fd, 0.75 * wo, 0.82 * top), P(fd, wo, 0.42 * top), P(fd, 0.8 * wo, bo),
               P((fd + fin) / 2, 0, min(bo, bi)), P(fin, -0.8 * wi, bi), P(fin, -wi, 0.42 * top),
               P(fin, -0.75 * wi, 0.82 * top)]
        R.append([cg.v(q, f"foot{k}_L") for q in pts])
    T_, TO, O, BO, B, BI, I, TI = range(8)
    hc = cg.v(P(0.0, 0.0, 0.030), "heel_L")
    tc = cg.v(P(0.257, -0.006, 0.014), "toe_L")
    part, reg = "Foot_L", "foot_L"
    for cap, ring in ((hc, R[0]), (tc, R[-1])):
        cg.face((ring[TI], ring[T_], cap, ring[I]), part, reg)
        cg.face((ring[T_], ring[TO], ring[O], cap), part, reg)
        cg.face((cap, ring[O], ring[BO], ring[B]), part, reg)
        cg.face((ring[I], cap, ring[B], ring[BI]), part, reg)
    for k in range(len(R) - 1):
        skip = (T_, TI) if k == 1 else ()      # ankle port on top between rows 1 and 2
        # strip faces: i -> (R[k][i], R[k][i+1], R[k+1][i+1], R[k+1][i]); face TI is index 7 (TI->T)
        cg.strip(R[k], R[k + 1], part, reg, skip=skip)
    # seams: sole/top split along O and I lines through both caps; top cut from ankle port to heel cap
    cg.seam_path([hc] + [R[k][O] for k in range(len(R))] + [tc])
    cg.seam_path([hc] + [R[k][I] for k in range(len(R))] + [tc])
    cg.seam_path([R[1][T_], R[0][T_], hc])
    cg.rings["foot_L"] = R
    # port order must match leg ring order [TI2, T2, TO2, TO1, T1, TI1]
    return [R[2][TI], R[2][T_], R[2][TO], R[1][TO], R[1][T_], R[1][TI]]


def orient_faces(cg):
    """Make face winding consistent across the manifold and outward-facing."""
    F = [list(f) for f in cg.F]
    edge_faces = {}
    for fi, f in enumerate(F):
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            edge_faces.setdefault((min(a, b), max(a, b)), []).append(fi)
    seen = [False] * len(F)
    for start in range(len(F)):
        if seen[start]:
            continue
        seen[start] = True
        stack = [start]
        while stack:
            fi = stack.pop()
            f = F[fi]
            for i in range(len(f)):
                a, b = f[i], f[(i + 1) % len(f)]
                for fj in edge_faces[(min(a, b), max(a, b))]:
                    if fj == fi or seen[fj]:
                        continue
                    g = F[fj]
                    # neighbour must traverse the shared edge as b->a
                    same = any(g[k] == a and g[(k + 1) % len(g)] == b for k in range(len(g)))
                    if same:
                        F[fj] = g[::-1]
                    seen[fj] = True
                    stack.append(fj)
    V = np.array(cg.V)
    vol = 0.0
    for f in F:
        p0 = V[f[0]]
        for i in range(1, len(f) - 1):
            vol += np.dot(p0, np.cross(V[f[i]], V[f[i + 1]]))
    if vol < 0:
        F = [f[::-1] for f in F]
    cg.F = [tuple(f) for f in F]
