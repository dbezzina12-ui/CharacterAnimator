"""Knight sword raises (for the 2D effects: lightning on a two-handed raise, fire on a one-handed raise).

sword_raise_2h: from the guard, both hands lift the sword straight overhead (tip to the sky), hold, and lower it back.
sword_raise_1h: from the guard, the left hand lets go and drops to the side while the right hand thrusts the sword
skyward; hold; the sword comes down and the left hand takes the grip again.

Same rules as the weapon clips: the sword sits in socket_hand_R_prop with identity, the right hand is solved onto it
and the left hand onto the shared grip_L marker of props/weapons.json. The raise is kept in the picture plane (the
blade's flat faces the camera), which is what a front-three-quarter 2D rig shows best.
"""
import json
import os

import numpy as np

from .clips import apply_grip  # noqa: F401  (grips are applied inside _weapon_clip)
from .clips_more import _weapon_clip, blade_frame, lerp_vals
from .library import raise_arm
from .poses import curl_fingers, matrix_from_quat, quat_from_matrix, rx, ry, slerp
from .props import mat, weapon_specs

N = 105                                    # 3.5 s at 30 fps
LEFT_ARM = ["clavicle_L", "upperarm_L", "forearm_L", "hand_L"] + [f"{f}_0{i}_L" for f in ("thumb", "index", "middle", "ring", "pinky") for i in (1, 2, 3)]


def _sword(sk, root):
    specs = weapon_specs(sk)
    sw = specs["Sword2H"]
    sw["name"] = "Sword2H"
    path = os.path.join(root, "props", "weapons.json")
    if os.path.exists(path):
        fixed = json.load(open(path))["props"]["Sword2H"]["markers"]
        sw["markers"] = {k: np.asarray(v, float) for k, v in fixed.items()}
    return sw


def _frames(sk):
    s = sk.scale
    hipz = sk.landmarks["hip_z"]
    face = np.array([0, -1.0, 0])          # blade flat toward the camera side
    guard = blade_frame(np.array([-0.02 * s, -0.36 * s, hipz + 0.20 * s]), [0.05, -0.75, 0.66], np.array([0.3, -1.0, 0.0]))
    return s, hipz, face, guard


def _lift(f, keys):
    return float(lerp_vals(keys, f))


def sword_raise_2h(rig, socks, root):
    sk = rig.sk
    s, hipz, face, guard = _frames(sk)
    sw = _sword(sk, root)
    front = blade_frame(np.array([0.0, -0.42 * s, hipz + 0.55 * s]), [0.02, -0.45, 0.89], face)
    over = blade_frame(np.array([0.0, -0.10 * s, hipz + 0.97 * s]), [0.0, -0.06, 1.0], face)
    over_b = mat(over[:3, :3], over[:3, 3] + np.array([0, 0, 0.012 * s]))
    keys = [(0, guard), (18, front), (30, over), (50, over_b), (72, over), (90, front), (N, guard)]
    up = [(0, 0), (18, 0.5), (30, 1), (72, 1), (90, 0.5), (N, 0)]

    def torso(f):
        u = _lift(f, up)
        return {"spine_02": rx(-4 * u), "chest": rx(-5 * u), "neck": rx(-6 * u), "head": rx(-12 * u)}
    poles = {"R": np.array([-0.9, 0.2, -0.6]), "L": np.array([0.9, 0.2, -0.6])}
    frames, meta = _weapon_clip(rig, socks, sw, keys, N, poles, torso=torso,
                                meta={"loop": True, "markers": {"raise": 8, "raised": 30, "lower": 72, "end": N},
                                      "note": "Both hands lift the sword overhead, tip to the sky (2D effect: lightning)."})
    return frames, meta


def sword_raise_1h(rig, socks, root):
    sk = rig.sk
    s, hipz, face, guard = _frames(sk)
    sw = _sword(sk, root)
    front = blade_frame(np.array([-0.10 * s, -0.40 * s, hipz + 0.50 * s]), [-0.05, -0.40, 0.90], face)
    over = blade_frame(np.array([-0.20 * s, -0.06 * s, hipz + 1.00 * s]), [-0.10, -0.02, 1.0], face)
    over_b = mat(over[:3, :3], over[:3, 3] + np.array([0, 0, 0.012 * s]))
    keys = [(0, guard), (16, front), (30, over), (50, over_b), (72, over), (90, front), (N, guard)]
    up = [(0, 0), (16, 0.5), (30, 1), (72, 1), (90, 0.5), (N, 0)]
    on_grip = [(0, 1), (8, 1), (20, 0), (78, 0), (96, 1), (N, 1)]   # left hand: 1 = on the grip, 0 = free at the side

    def torso(f):
        u = _lift(f, up)
        return {"spine_02": rx(-3 * u) @ ry(-4 * u), "chest": rx(-5 * u), "neck": rx(-5 * u) @ ry(-6 * u), "head": rx(-12 * u) @ ry(-8 * u)}

    def left_free(p, f):
        raise_arm(rig, p, "L", -38, clavicle_share=0.0)
        p.rot["forearm_L"] = rx(22)
        curl_fingers(p, "L", 0.85, thumb=0.6)        # clenched fist at the side
    poles = {"R": np.array([-0.9, 0.1, -0.5]), "L": np.array([0.9, 0.2, -0.6])}
    held, meta = _weapon_clip(rig, socks, sw, keys, N, poles, torso=torso)
    free_sw = dict(sw, support=None)
    free, _ = _weapon_clip(rig, socks, free_sw, keys, N, poles, torso=torso, fingers=left_free)
    frames = []
    for f in range(N + 1):
        w = _lift(f, on_grip)
        p = free[f].copy()
        for b in LEFT_ARM:
            qa = quat_from_matrix(free[f].rot.get(b, np.eye(3)))
            qb = quat_from_matrix(held[f].rot.get(b, np.eye(3)))
            if np.dot(qa, qb) < 0:
                qb = -qb
            p.rot[b] = matrix_from_quat(slerp(qa, qb, w))
        frames.append(p)
    meta = {k: v for k, v in meta.items() if k not in ("support",)}
    meta.update({"loop": True, "support": None, "markers": {"release": 8, "raised": 30, "lower": 72, "regrip": 96, "end": N},
                 "note": "The left hand lets go; the right hand thrusts the sword skyward (2D effect: fire)."})
    return frames, meta
