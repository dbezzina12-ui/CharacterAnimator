"""Dev helper: build the unified mesh and dump JSON for the quick three.js preview."""
import json, sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from cbase.params import resolve
from cbase.skeleton import build_skeleton
from cbase.mesh import build_mesh

out = sys.argv[1]
params = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
p = resolve(params)
sk = build_skeleton(p)
m = build_mesh(sk, p)
parts = sorted(set(m.face_part))
tris, tpart = [], []
for f, pt in zip(m.faces, m.face_part):
    for i in range(1, len(f) - 1):
        tris += [f[0], f[i], f[i + 1]]
        tpart.append(parts.index(pt))
bones = [[*map(float, sk[b].head), *map(float, sk[b].tail)] for b in sk.order]
bmap = {b: [*map(float, sk[b].head), *map(float, sk[b].tail)] for b in sk.order}
seam_pts = []
for a, b in m.seams:
    seam_pts += [*map(float, m.V[a]), *map(float, m.V[b])]
json.dump({"V": m.V.astype(float).round(5).flatten().tolist(), "T": tris, "tp": tpart, "parts": parts,
           "bones": bones, "bmap": bmap, "seams": seam_pts}, open(out, "w"))
print("verts", len(m.V), "tris", len(tris) // 3)
