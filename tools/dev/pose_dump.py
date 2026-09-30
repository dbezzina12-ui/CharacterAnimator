"""Dev: deform the unified mesh with test poses (numpy LBS) and dump a side-by-side preview."""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from cbase.params import resolve
from cbase.skeleton import build_skeleton
from cbase.mesh import build_mesh
from cbase.weights import compute_weights
from cbase.poses import Rig, Pose
from cbase.library import TEST_POSES
out = sys.argv[1]
which = sys.argv[2].split(',') if len(sys.argv) > 2 else list(TEST_POSES)
p = resolve({}); sk = build_skeleton(p); m = build_mesh(sk, p)
names, W = compute_weights(m, sk)
rig = Rig(sk)
parts = sorted(set(m.face_part))
allV, T, tp = [], [], []
off = 0
for i, name in enumerate(which):
    pose = Pose() if name == 'rest' else TEST_POSES[name](rig)
    Vp = rig.deform(m.V, W, names, pose) + np.array([1.1 * i, 0, 0])
    for f, pt in zip(m.faces, m.face_part):
        for k in range(1, len(f) - 1):
            T += [f[0] + off, f[k] + off, f[k + 1] + off]; tp.append(parts.index(pt))
    allV.append(Vp); off += len(Vp)
V = np.concatenate(allV)
dom = np.argmax(W, 1)
json.dump({"V": V.round(5).flatten().tolist(), "T": T, "tp": tp, "parts": parts, "bones": [], "bmap": {b: [0]*6 for b in sk.order},
           "n": len(which), "dom": np.tile(dom, len(which)).tolist()}, open(out, 'w'))
print('poses', which)
