"""Procedural sculpt layer applied after subdivision.

Adds readable-but-neutral facial structure (brow ridge, eye sockets with eye mounds,
nose, cheekbones, lips, chin, ear bowls) and a little body anatomy. All features are
defined relative to the head/skeleton landmarks, so every proportion variant gets the
same features in the same places, and the vertex count/order never changes.
"""
import numpy as np


def _bump(r):
    r = np.clip(r, 0.0, 1.0)
    return (1.0 - r * r) ** 2


def _normals(V, faces):
    N = np.zeros_like(V)
    F = np.array([f for f in faces if len(f) == 4])
    a, b, c, d = (V[F[:, i]] for i in range(4))
    n = np.cross(c - a, d - b)
    for i in range(4):
        np.add.at(N, F[:, i], n)
    return N / np.linalg.norm(N, axis=1, keepdims=True)


def _vertex_regions(n, faces, region):
    out = [set() for _ in range(n)]
    for f, r in zip(faces, region):
        for v in f:
            out[v].add(r)
    return out


def sculpt(V, m, sk, p):
    V = V.copy()
    N = _normals(V, m.faces)
    vreg = _vertex_regions(len(V), m.faces, m.face_region)
    head = np.array([r == {"head"} or r == {"head", "neck"} for r in vreg])
    C = m.cage.head_center
    u = m.cage.head_scale
    q = (V - C) / u                     # head-local, head units
    x, y, z = q[:, 0], q[:, 1], q[:, 2]
    front = np.clip((-y - 0.03) / 0.03, 0, 1)   # 0 behind the cheeks, 1 on the face
    fwd = np.array([0, -1.0, 0])
    disp_n = np.zeros(len(V))          # along the normal (head units)
    disp_f = np.zeros(len(V))          # straight forward (head units)

    ez, ex = -0.014, 0.036
    for sx in (-1, 1):
        r = np.sqrt(((x - sx * ex) / 0.030) ** 2 + ((z - ez) / 0.023) ** 2)
        disp_n += -0.0070 * _bump(r)                                   # socket
        r2 = np.sqrt(((x - sx * ex) / 0.0175) ** 2 + ((z - ez + 0.001) / 0.0135) ** 2)
        disp_n += 0.0052 * _bump(r2)                                   # eye mound
        rc = np.sqrt(((x - sx * 0.050) / 0.032) ** 2 + ((z + 0.043) / 0.024) ** 2)
        disp_n += 0.0026 * _bump(rc)                                   # cheek
    # brow ridge
    bw = np.clip(1.0 - (np.abs(x) / 0.060) ** 4, 0, 1)
    disp_n += 0.0032 * bw * np.exp(-((z - 0.009 - 0.003 * (np.abs(x) / 0.06)) / 0.0095) ** 2)
    # nose: bridge -> rounded tip -> underside
    z_top, z_tip, z_base = 0.000, -0.040, -0.055
    t = np.clip((z_top - z) / (z_top - z_tip), 0, 1)
    h = np.where(z >= z_tip, 0.0025 + 0.0160 * t ** 1.7,
                 0.0185 * _bump((z_tip - z) / (z_tip - z_base)) ** 0.8)
    w = np.where(z >= z_tip, 0.0070 + 0.0085 * t ** 1.3, 0.0155 + 0.0035 * np.clip((z_tip - z) / 0.012, 0, 1))
    in_nose = (z < z_top + 0.014)
    disp_f += np.where(in_nose, h * np.exp(-1.3 * (x / w) ** 2), 0.0)
    for sx in (-1, 1):                                                 # nostril wings
        ra = np.sqrt(((x - sx * 0.0140) / 0.0095) ** 2 + ((z + 0.046) / 0.0085) ** 2)
        disp_f += 0.0048 * _bump(ra)
    # lips and mouth line
    lw = np.clip(1.0 - (np.abs(x) / 0.027) ** 2, 0, 1)
    disp_f += 0.0040 * lw * np.exp(-((z + 0.071) / 0.0060) ** 2)       # upper lip
    disp_f += 0.0036 * lw * np.exp(-((z + 0.088) / 0.0068) ** 2)       # lower lip
    mw = np.clip(1.0 - (np.abs(x) / 0.026) ** 4, 0, 1)
    disp_f += -0.0026 * mw * np.exp(-((z + 0.0795) / 0.0032) ** 2)     # mouth line
    # chin
    rch = np.sqrt((x / 0.022) ** 2 + ((z + 0.121) / 0.017) ** 2)
    disp_f += 0.0035 * _bump(rch)
    rlab = np.sqrt((x / 0.020) ** 2 + ((z + 0.103) / 0.0065) ** 2)
    disp_f += -0.0014 * _bump(rlab)                                    # labiomental groove

    mask = head * front
    V += (N * (disp_n * mask * u)[:, None]) + fwd[None, :] * (disp_f * mask * u)[:, None]

    # ears: shallow bowl on the outer face
    for sd in ("L", "R"):
        ear = np.array([f"ear_{sd}" in r for r in vreg])
        if not ear.any():
            continue
        E = V[ear]
        ec = E.mean(0)
        nrm = ec - C
        nrm[2] = 0
        nrm /= np.linalg.norm(nrm)
        dist_out = (E - ec) @ nrm
        inplane = (E - ec) - np.outer(dist_out, nrm)
        rr = np.sqrt((inplane[:, 2] / (0.020 * u)) ** 2 + (np.linalg.norm(inplane[:, :2], axis=1) / (0.011 * u)) ** 2)
        outer = np.clip((N[ear] @ nrm - 0.3) / 0.5, 0, 1)
        V[ear] -= nrm[None, :] * (0.0055 * u * _bump(rr) * outer)[:, None]

    # --- light body anatomy ---
    s = sk.scale
    L = sk.landmarks
    hipz = L["hip_z"]
    spine = np.array([r <= {"spine", "neck"} and "spine" in r for r in vreg])
    X, Y, Z = V[:, 0], V[:, 1], V[:, 2]
    dn = np.zeros(len(V))
    for sx in (-1, 1):
        rp = np.sqrt(((X - sx * 0.062 * s) / (0.070 * s)) ** 2 + ((Z - (hipz + 0.335 * s)) / (0.050 * s)) ** 2)
        dn += 0.0055 * s * _bump(rp) * (Y < -0.03 * s)                  # pectorals
        rb = np.sqrt(((X - sx * 0.072 * s) / (0.055 * s)) ** 2 + ((Z - (hipz + 0.330 * s)) / (0.060 * s)) ** 2)
        dn += 0.0040 * s * _bump(rb) * (Y > 0.03 * s)                   # shoulder blades
    sg = np.exp(-(X / (0.016 * s)) ** 2) * (Y > 0.02 * s) * np.clip((Z - hipz - 0.06 * s) / (0.05 * s), 0, 1) \
        * np.clip((hipz + 0.44 * s - Z) / (0.05 * s), 0, 1)
    dn += -0.0045 * s * sg                                             # spine groove
    V += N * (dn * spine)[:, None]
    # breasts (bustSize > 0 only, so the neutral template is untouched): soft, slightly outward-pointing
    # volumes on the front of the chest, fuller below the centre than above
    bust = p.get("bustSize", 0.0)
    if bust > 0:
        tw = p["torsoWidth"]
        front = np.clip((-Y - 0.015 * s) / (0.03 * s), 0, 1)
        for sx in (-1, 1):
            cx, cz = sx * 0.084 * s * tw, hipz + 0.300 * s
            dz = Z - cz
            rz = np.where(dz > 0, 0.080 * s, 0.050 * s)
            rb = np.sqrt(((X - cx) / (0.064 * s * tw)) ** 2 + (dz / rz) ** 2)
            amt = 0.042 * s * bust * _bump(rb) ** 0.85 * front * spine
            d = np.array([sx * 0.22, -1.0, -0.12])
            V += np.outer(amt, d / np.linalg.norm(d))
    # knee caps
    for sd in ("L", "R"):
        leg = np.array([f"leg_{sd}" in r for r in vreg])
        kn = L[f"knee_{sd}"]
        rk = np.sqrt(((X - kn[0]) / (0.032 * s)) ** 2 + ((Z - kn[2] - 0.008 * s) / (0.036 * s)) ** 2)
        V += N * (0.0045 * s * _bump(rk) * (Y < kn[1] - 0.02 * s) * leg)[:, None]
    return V
