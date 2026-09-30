"""Authored animation clips, evaluated to per-frame FK poses and baked.

Clips are recipes over the rig (IK targets, finger curls, driven helpers) that are
re-solved for every character variant, so a stockier/shorter character still reaches
the same test props. The baked result is plain rotation keys per bone (plus pelvis
translation), exported as named glTF animations; nothing lives in a viewer loop.
"""
import numpy as np

from .library import SIDES, TEST_POSES, plant_legs, rotate_world, reach
from .poses import Pose, curl_fingers, matrix_from_quat, quat_from_matrix, rx, ry, rz, slerp, two_bone_ik
from .skeleton import FINGERS, GRIP_RADIUS, _n, _perp, socket_defs

FPS = 30


def ease(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def socket_matrix(sock):
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = sock["x"], sock["y"], sock["z"], sock["pos"]
    return M


# ------------------------------------------------------------------ test props ---
def prop_layout(sk):
    """World placement (Blender coords) of the test props for this character."""
    s = sk.scale
    L = sk.landmarks
    shR = L["shoulder_R"]
    handle_c = shR + np.array([-0.07, -0.37, -0.36]) * s
    return {
        "handle": {"center": handle_c, "axis": np.array([0, 0, 1.0]), "radius": GRIP_RADIUS * s,
                   "length": 0.14 * s},
    }


# ------------------------------------------------------------------ grip fitting --
def _finger_radius(sk, fname, side):
    u = sk[f"hand_{side}"].length / 0.098
    w = {"index": 0.0112, "middle": 0.0116, "ring": 0.0110, "pinky": 0.0099, "thumb": 0.0130}[fname]
    return w * u * 0.92


def _seg_line_dist(a, b, c, axis, n=6):
    ts = np.linspace(0, 1, n)
    P = a[None] + (b - a)[None] * ts[:, None]
    rel = P - c
    perp = rel - np.outer(rel @ axis, axis)
    return np.linalg.norm(perp, axis=1).min()


def _clearance(rig, pose, side, fname, center, axis, radius):
    sk = rig.sk
    W = rig.fk(pose)
    rf = _finger_radius(sk, fname, side)
    out = []
    for i in (1, 2, 3):
        M = W[f"{fname}_{i:02d}_{side}"]
        out.append(_seg_line_dist(M[:3, 3], M[:3, 3] + M[:3, 1] * sk[f"{fname}_{i:02d}_{side}"].length,
                                  center, axis) - radius - rf)
    return min(out)


def thumb_rot(g):
    az, ax, c = g
    return {"thumb_01": rz(az) @ rx(ax), "thumb_02": rx(40 * c), "thumb_03": rx(55 * c)}


def fit_grip(rig, pose, side, center, axis, radius):
    """Curl each finger until it touches the handle; search thumb opposition/flexion/curl
    for the most wrapped configuration that still does not penetrate the handle."""
    out = {}
    for fname in FINGERS:
        best = 0.0
        for a in np.linspace(0, 1.0, 81):
            p2 = pose.copy()
            curl_fingers(p2, side, {fname: a}, fingers=(fname,))
            if _clearance(rig, p2, side, fname, center, axis, radius) < 0.0005 * rig.sk.scale:
                break
            best = a
        out[fname] = float(best)
    best, best_score = (0.0, -40.0, 0.0), -1e9
    for az in range(-30, 51, 10):
        for ax in range(-40, 51, 10):
            for c in np.linspace(0, 1, 11):
                p2 = pose.copy()
                for bn, R in thumb_rot((az, ax, c)).items():
                    p2.rot[f"{bn}_{side}"] = R
                cl = _clearance(rig, p2, side, "thumb", center, axis, radius)
                if cl < 0.0005 * rig.sk.scale:
                    continue
                score = ax + 40 * c - 4000 * cl
                if score > best_score:
                    best, best_score = (az, ax, float(c)), score
    out["thumb"] = best
    return out


def apply_grip(pose, side, g, amount=1.0):
    curl_fingers(pose, side, {f: g[f] * amount for f in FINGERS})
    az, ax, c = g["thumb"]
    for bn, R in thumb_rot((az * amount, ax * amount, c * amount)).items():
        pose.rot[f"{bn}_{side}"] = R


# ------------------------------------------------------------------ helpers -------
class ArmKey:
    """A keyed arm state: wrist target, hand world rotation, finger pose function."""

    def __init__(self, wrist, Rh, fingers):
        self.wrist, self.Rh, self.fingers = wrist, Rh, fingers


def rest_arm(rig, side):
    W = rig.fk(Pose())
    return W[f"hand_{side}"][:3, 3].copy(), W[f"hand_{side}"][:3, :3].copy()


def rest_pole(rig, side):
    W = rig.fk(Pose())
    S = W[f"upperarm_{side}"][:3, 3]
    E = W[f"forearm_{side}"][:3, 3]
    Wr = W[f"hand_{side}"][:3, 3]
    u = _n(Wr - S)
    return _perp(E - S, u)


def hand_for_socket(rig, side, socket_world, sockets):
    """Hand bone world matrix that puts the prop socket at `socket_world`."""
    hand_rest = rig.rest[f"hand_{side}"]
    sock_rest = socket_matrix(sockets[f"socket_hand_{side}_prop"])
    local = np.linalg.inv(hand_rest) @ sock_rest
    return socket_world @ np.linalg.inv(local)


def arm_pose(rig, side, wrist, Rh, pole, base=None):
    p = base.copy() if base is not None else Pose()
    two_bone_ik(rig, p, f"upperarm_{side}", f"forearm_{side}", wrist, pole)
    rig.set_world_rotation(p, f"hand_{side}", Rh)
    return p


def lerp_keys(keys, f):
    """keys: list of (frame, value) with value = (wrist, Rh, pole, finger_blend). Smooth piecewise."""
    for (f0, a), (f1, b) in zip(keys[:-1], keys[1:]):
        if f <= f1:
            t = ease((f - f0) / max(f1 - f0, 1e-9))
            wrist = a[0] + (b[0] - a[0]) * t
            q = slerp(quat_from_matrix(a[1]), quat_from_matrix(b[1]), t)
            pole = _n(a[2] + (b[2] - a[2]) * t)
            fing = a[3] + (b[3] - a[3]) * t
            return wrist, matrix_from_quat(q), pole, fing
    return keys[-1][1]


# ------------------------------------------------------------------ clips ---------
def clip_idle(rig):
    n = 4 * FPS
    s = rig.sk.scale
    frames = []
    for f in range(n + 1):
        ph = 2 * np.pi * f / n
        p = Pose()
        br = np.sin(ph * 2)                      # two breaths per loop
        p.rot["spine_02"] = rx(0.8 * br)
        p.rot["chest"] = rx(1.2 * br)
        p.rot["neck"] = rx(-0.6 * br) @ ry(1.5 * np.sin(ph))
        p.rot["head"] = ry(2.0 * np.sin(ph + 0.6)) @ rz(0.8 * np.sin(ph + 1.2))
        p.loc["pelvis"] = rig.rest["pelvis"][:3, :3].T @ np.array([0.009 * s * np.sin(ph), 0, -0.002 * s * (1 - np.cos(2 * ph)) / 2])
        p.rot["pelvis"] = ry(1.2 * np.sin(ph)) @ rz(-1.0 * np.sin(ph))
        p.rot["spine_01"] = rz(0.8 * np.sin(ph))
        for sd, sx in SIDES:
            rotate_world(rig, p, f"clavicle_{sd}", np.array([0, -sx, 0]), 0.8 * br)
            p.rot[f"forearm_{sd}"] = rx(4 + 2.0 * np.sin(ph + (0.5 if sd == "L" else 2.0)))
            curl_fingers(p, sd, 0.12 + 0.03 * np.sin(ph + 1.0), thumb=0.15)
        for sd, sx in SIDES:
            rotate_world(rig, p, f"upperarm_{sd}", np.array([-1.0, 0, 0]), 1.8 * np.sin(ph + (0.0 if sd == "L" else 0.9)))
        plant_legs(rig, p)
        frames.append(p)
    return frames, {"loop": True}


def clip_reach_grip(rig, props, sockets, side="R"):
    sk = rig.sk
    s = sk.scale
    sx = 1.0 if side == "L" else -1.0
    h = props["handle"]
    c, ax = h["center"], h["axis"]
    # socket frame on the handle (glTF-semantic axes, Blender world coords):
    #   +Y along the handle (thumb up), +Z out of the palm (palm faces the midline), X = Y x Z
    y = ax
    z = _perp(np.array([-sx, -0.30, 0.0]), y)          # palm faces the midline and slightly forward
    x = np.cross(y, z)
    Sw = np.eye(4)
    Sw[:3, 0], Sw[:3, 1], Sw[:3, 2], Sw[:3, 3] = x, y, z, c
    Hg = hand_for_socket(rig, side, Sw, sockets)
    approach = -z * 0.09 * s + np.array([0, 0.03 * s, 0])        # back off along -palm and toward body
    Hpre = Hg.copy()
    Hpre[:3, 3] += approach
    w0, R0 = rest_arm(rig, side)
    pole0 = rest_pole(rig, side)
    pole1 = _n(np.array([sx * 0.8, 0.5, -1.0]))
    keys = [(0, (w0, R0, pole0, 0.0)), (32, (Hpre[:3, 3], Hpre[:3, :3], pole1, 0.0)),
            (44, (Hg[:3, 3], Hg[:3, :3], pole1, 0.0)), (80, (Hg[:3, 3], Hg[:3, :3], pole1, 0.0)),
            (92, (Hpre[:3, 3], Hpre[:3, :3], pole1, 0.0)), (126, (w0, R0, pole0, 0.0))]
    base_grip = arm_pose(rig, side, Hg[:3, 3], Hg[:3, :3], pole1)
    g = fit_grip(rig, base_grip, side, c, ax, h["radius"])
    frames = []
    n = 126
    for f in range(n + 1):
        wrist, Rh, pole, _ = lerp_keys(keys, f)
        p = Pose()
        # a little upper-body participation
        k = ease(min(f, n - f) / 30.0)
        p.rot["spine_02"] = ry(-3 * sx * k)                  # reaching shoulder comes forward
        p.rot["chest"] = ry(-3 * sx * k) @ rx(3 * k)
        p.rot["head"] = ry(8 * sx * k) @ rx(6 * k)            # look toward the handle
        p = arm_pose(rig, side, wrist, Rh, pole, base=p)
        close = ease((f - 44) / 12.0) * (1 - ease((f - 80) / 10.0))
        open_ = (1 - close) * ease(min(f, 92 - f) / 12.0) if f < 92 else 0.0
        apply_grip(p, side, g, close)
        if open_ > 0:
            curl_fingers(p, side, {ff: -0.06 * open_ + g[ff] * close for ff in FINGERS}, spread=0.0)
        frames.append(p)
    meta = {"loop": False, "side": side,
            "grip": {k: (round(float(v), 3) if not isinstance(v, tuple) else [round(float(x), 3) for x in v])
                     for k, v in g.items()},
            "markers": {"contact": 44, "gripClosed": 56, "release": 80, "end": n},
            "prop": "TestHandle"}
    return frames, meta


def clip_qa_cycle(rig):
    rest = Pose()
    frames, markers = [], {}
    f = 0
    for name, fn in TEST_POSES.items():
        target = fn(rig)
        for k in range(10):
            frames.append(Pose.blend(rest, target, ease(k / 10.0)))
        markers[name] = len(frames)
        for k in range(14):
            frames.append(target.copy())
        for k in range(10):
            frames.append(Pose.blend(target, rest, ease(k / 10.0)))
    frames.append(rest)
    return frames, {"loop": False, "markers": markers, "note": "test poses held for 14 frames each"}


def all_clips(rig, props, sockets):
    out = {}
    out["idle"] = clip_idle(rig)
    out["reach_grip_handle"] = clip_reach_grip(rig, props, sockets, "R")
    out["_qa_pose_cycle"] = clip_qa_cycle(rig)
    return out
