"""Dev: shoulder stress poses (numpy LBS on the unified mesh) for tuning shoulder weights/rhythm.
usage: shoulder_dump.py out.json [params_json]"""
import json
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np  # noqa: E402
from cbase.library import raise_arm, pose_arms_raised  # noqa: E402
from cbase.mesh import build_mesh  # noqa: E402
from cbase.params import resolve  # noqa: E402
from cbase.poses import Pose, Rig, two_bone_ik  # noqa: E402
from cbase.skeleton import build_skeleton  # noqa: E402
from cbase.weights import compute_weights  # noqa: E402

out = sys.argv[1]
p = resolve(json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
sk = build_skeleton(p)
m = build_mesh(sk, p)
names, W = compute_weights(m, sk)
rig = Rig(sk)
s = sk.scale
L = sk.landmarks


def tpose(r):
    q = Pose()
    for sd in "LR":
        raise_arm(r, q, sd, 48)
    return q


def forward(r):   # both arms straight forward at shoulder height (pistol-like)
    q = Pose()
    for sd, sx in (("L", 1), ("R", -1)):
        sh = r.fk(q)[f"upperarm_{sd}"][:3, 3]
        two_bone_ik(r, q, f"upperarm_{sd}", f"forearm_{sd}", sh + np.array([sx * 0.02, -0.52, 0.02]) * s,
                    np.array([sx * 1.0, 0.0, -1.0]))
    return q


def across(r):    # left hand to the right shoulder, right arm forward-up
    q = Pose()
    two_bone_ik(r, q, "upperarm_L", "forearm_L", L["shoulder_R"] + np.array([0.02, -0.12, -0.05]) * s,
                np.array([1.0, 0.0, -1.0]))
    sh = r.fk(q)["upperarm_R"][:3, 3]
    two_bone_ik(r, q, "upperarm_R", "forearm_R", sh + np.array([-0.05, -0.35, 0.35]) * s, np.array([-1.0, 0.0, -1.0]))
    return q


poses = {"rest": lambda r: Pose(), "raised": pose_arms_raised, "tpose": tpose, "forward": forward, "across": across}
parts = sorted(set(m.face_part))
allV, T, tp = [], [], []
off = 0
for i, (name, fn) in enumerate(poses.items()):
    Vp = rig.deform(m.V, W, names, fn(rig)) + np.array([1.8 * i, 0, 0])
    for f, pt in zip(m.faces, m.face_part):
        for k in range(1, len(f) - 1):
            T += [f[0] + off, f[k] + off, f[k + 1] + off]
            tp.append(parts.index(pt))
    allV.append(Vp)
    off += len(Vp)
V = np.concatenate(allV)
# heat: how much each vertex follows the left upper arm (upper arm + half of the half-rotation helper)
ix = {b: i for i, b in enumerate(names)}
heat = W[:, ix["upperarm_L"]] + 0.5 * W[:, ix["shoulder_helper_L"]]
json.dump({"V": V.round(5).flatten().tolist(), "T": T, "tp": tp, "parts": parts, "bones": [],
           "heat": heat.round(3).tolist(),
           "bmap": {b: [0] * 6 for b in sk.order}, "n": len(poses)}, open(out, "w"))
print("poses", list(poses))
