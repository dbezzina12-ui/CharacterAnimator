"""Unified body mesh: cage -> interpolating fit -> 2x Catmull-Clark -> sculpt -> normals."""
import hashlib

import numpy as np

from .cage import build_cage
from .sculpt import sculpt
from .subdiv import fit_interpolating, subdivide

SUBDIV_LEVELS = 2
FIT_ITERS = 8          # damped interpolation fit: shrink compensation without ripples
FIT_DAMPING = 0.7

PART_ORDER = ["Head", "Neck", "Torso", "Pelvis",
              "UpperArm_L", "UpperArm_R", "Forearm_L", "Forearm_R", "Hand_L", "Hand_R",
              "Thigh_L", "Thigh_R", "Shin_L", "Shin_R", "Foot_L", "Foot_R"]


class BodyMesh:
    pass


def vertex_normals(V, faces):
    N = np.zeros_like(V)
    for f in faces:
        P = V[list(f)]
        # Newell normal (area weighted) for the polygon
        n = np.zeros(3)
        for i in range(len(f)):
            a, b = P[i], P[(i + 1) % len(f)]
            n += np.cross(a, b)
        for v in f:
            N[v] += n
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    return N


def topology_hash(faces):
    h = hashlib.sha256()
    for f in faces:
        h.update((",".join(map(str, f)) + ";").encode())
    return h.hexdigest()


def build_mesh(sk, p):
    cg = build_cage(sk, p)
    targets = np.array(cg.V)
    C, emax, emean = fit_interpolating(targets, cg.F, SUBDIV_LEVELS, iters=FIT_ITERS, damping=FIT_DAMPING)
    V, F, fa, seams, plans = subdivide(C, cg.F, SUBDIV_LEVELS,
                                       {"part": cg.part, "region": cg.region}, cg.seams)
    m = BodyMesh()
    m.cage = cg
    m.cage_ctrl = C
    m.fit_error = (emax, emean)
    m.faces = [tuple(f) for f in F]
    m.face_part = fa["part"]
    m.face_region = fa["region"]
    m.seams = seams
    m.plans = plans
    # vertex tags from the cage survive as "vertex points" (first indices at every level)
    m.n_cage = len(cg.V)
    V = sculpt(V, m, sk, p)
    m.V = V
    m.N = vertex_normals(V, m.faces)
    m.topology_hash = topology_hash(m.faces)
    return m
