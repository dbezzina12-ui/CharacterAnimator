"""Catmull-Clark subdivision for closed polygon meshes, with attribute propagation.

Vertex ordering is fully deterministic (vertex points, then edge points, then face
points), so the same cage topology always yields the same final vertex/face order.
That determinism is what lets a frozen UV layout be reused across proportion variants.
"""
import numpy as np


def edge_key(a, b):
    return (a, b) if a < b else (b, a)


class Plan:
    """Topology of one CC step; `apply` maps old positions -> new positions."""

    def __init__(self, n_verts, faces):
        self.n_old = n_verts
        self.faces = [tuple(f) for f in faces]
        edges = {}
        edge_faces = []
        for fi, f in enumerate(self.faces):
            k = len(f)
            for i in range(k):
                key = edge_key(f[i], f[(i + 1) % k])
                ei = edges.get(key)
                if ei is None:
                    ei = len(edge_faces)
                    edges[key] = ei
                    edge_faces.append([])
                edge_faces[ei].append(fi)
        bad = [k for k, ei in edges.items() if len(edge_faces[ei]) != 2]
        if bad:
            raise ValueError(f"mesh is not closed 2-manifold; {len(bad)} bad edges, e.g. {bad[:5]}")
        self.edges = edges
        self.edge_list = [None] * len(edges)
        for k, ei in edges.items():
            self.edge_list[ei] = k
        self.edge_faces = np.array(edge_faces, dtype=np.int64)
        self.n_edges = len(edges)
        self.n_faces = len(self.faces)
        # vertex adjacency
        vf = [[] for _ in range(n_verts)]
        ve = [[] for _ in range(n_verts)]
        for fi, f in enumerate(self.faces):
            for v in f:
                vf[v].append(fi)
        for ei, (a, b) in enumerate(self.edge_list):
            ve[a].append(ei)
            ve[b].append(ei)
        self.vf, self.ve = vf, ve
        if any(len(x) == 0 for x in ve):
            raise ValueError("isolated vertex in cage")
        # new faces
        E0 = n_verts
        F0 = n_verts + self.n_edges
        new_faces, parent = [], []
        for fi, f in enumerate(self.faces):
            k = len(f)
            for i in range(k):
                a, b, pv = f[i], f[(i + 1) % k], f[(i - 1) % k]
                new_faces.append((a, E0 + edges[edge_key(a, b)], F0 + fi, E0 + edges[edge_key(pv, a)]))
                parent.append(fi)
        self.new_faces = new_faces
        self.face_parent = np.array(parent, dtype=np.int64)
        self.n_new = F0 + self.n_faces
        # precompute gather structures
        self._fidx = [np.array(f) for f in self.faces]
        maxk = max(len(f) for f in self.faces)
        fpad = np.full((self.n_faces, maxk), -1, dtype=np.int64)
        for fi, f in enumerate(self.faces):
            fpad[fi, :len(f)] = f
        self.fpad = fpad
        self.fcount = (fpad >= 0).sum(1)
        self.el = np.array(self.edge_list, dtype=np.int64)
        self.valence = np.array([len(x) for x in ve], dtype=np.float64)

    def apply(self, V):
        V = np.asarray(V, float)
        mask = self.fpad >= 0
        g = V[np.where(mask, self.fpad, 0)] * mask[..., None]
        FP = g.sum(1) / self.fcount[:, None]
        EM = 0.5 * (V[self.el[:, 0]] + V[self.el[:, 1]])
        EP = 0.5 * EM + 0.25 * (FP[self.edge_faces[:, 0]] + FP[self.edge_faces[:, 1]])
        Q = np.zeros_like(V)
        R = np.zeros_like(V)
        nf = np.zeros(len(V))
        fi_rep = np.repeat(np.arange(self.n_faces), self.fcount)
        vids = self.fpad[mask]
        np.add.at(Q, vids, FP[fi_rep])
        np.add.at(nf, vids, 1.0)
        np.add.at(R, self.el[:, 0], EM)
        np.add.at(R, self.el[:, 1], EM)
        n = self.valence
        Q /= nf[:, None]
        R /= n[:, None]
        VP = (Q + 2 * R + (n - 3)[:, None] * V) / n[:, None]
        return np.concatenate([VP, EP, FP], axis=0)

    def child_seams(self, seams):
        """seams: set of edge keys on the old mesh -> set on the new mesh."""
        out = set()
        E0 = self.n_old
        for (a, b) in seams:
            ei = self.edges.get((a, b))
            if ei is None:
                raise KeyError(f"seam edge {(a, b)} not in mesh")
            e = E0 + ei
            out.add(edge_key(a, e))
            out.add(edge_key(e, b))
        return out


def subdivide(V, faces, levels, face_attrs=None, seams=None):
    """Return (V, faces, face_attrs, seams, plans)."""
    face_attrs = {k: list(v) for k, v in (face_attrs or {}).items()}
    seams = set(seams or ())
    plans = []
    for _ in range(levels):
        plan = Plan(len(V), faces)
        V = plan.apply(V)
        seams = plan.child_seams(seams)
        face_attrs = {k: [v[i] for i in plan.face_parent] for k, v in face_attrs.items()}
        faces = plan.new_faces
        plans.append(plan)
    return V, faces, face_attrs, seams, plans


def fit_interpolating(targets, faces, levels=2, iters=40, weight=None, damping=1.0):
    """Solve for cage positions whose subdivided surface passes through `targets`
    at the cage-vertex locations (iterative defect correction)."""
    plans = []
    nv = len(targets)
    f = faces
    for _ in range(levels):
        p = Plan(nv, f)
        plans.append(p)
        nv, f = p.n_new, p.new_faces
    C = np.array(targets, float)
    w = np.ones(len(C)) if weight is None else np.asarray(weight, float)
    for it in range(iters):
        X = C
        for p in plans:
            X = p.apply(X)
        S = X[:len(C)]
        D = targets - S
        C = C + damping * w[:, None] * D
    X = C
    for p in plans:
        X = p.apply(X)
    err = np.linalg.norm(targets - X[:len(C)], axis=1)
    return C, float(err.max()), float(err.mean())
