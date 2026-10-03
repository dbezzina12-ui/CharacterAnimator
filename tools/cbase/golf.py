"""Golf swing for the knight (right-handed): address → takeaway → top → downswing → impact → follow-through →
finish → back to address. Same rules as the weapon clips: the club is parented to socket_hand_R_prop with
identity, the right hand is solved onto the club origin and the left hand onto its `grip_L` marker (left hand
above the right, toward the butt of the grip), and every frame is solved on the rig (IK + FK).

The club swings in a plane: the plane through the target line (+X) and the shaft at address. Hands and club
rotate in that plane about a pivot between the shoulders; the club angle leads/lags the hands (wrist hinge in
the backswing, lag in the downswing, release through impact). Angles are interpolated with a monotone cubic,
so the club never stops at a key and is fastest through impact.

Club frame (prop-local, shared with viewer/js/knight.js knightGolfClub()): +Y = shaft from the right hand
toward the head, the head's sole runs along SOLE in the X-Y plane at the lie angle, +Z = face normal.
"""
import numpy as np

from .clips import apply_grip, fit_grip
from .clips_more import fit_support_marker, pelvis_world_offset, solve_weapon
from .library import SIDES
from .poses import Pose, rx, ry, rz, two_bone_ik
from .props import mat
from .skeleton import _n, rot_axis

FPS = 30
LIE_DEG = 60.0                      # shaft-to-ground angle at address
HOSEL_Y = 0.87                      # right-hand grip origin → heel of the club head along the shaft (m)
GRIP_L_Y = -0.088                   # left hand above the right on the grip
GRIP_RADIUS = 0.0135
SOLE = np.array([np.sin(np.radians(LIE_DEG)), np.cos(np.radians(LIE_DEG)), 0.0])     # heel → toe (prop-local)
HEAD_UP = np.array([np.cos(np.radians(LIE_DEG)), -np.sin(np.radians(LIE_DEG)), 0.0])  # sole → top line
SWEET = np.array([0, HOSEL_Y, 0]) + SOLE * 0.034 + HEAD_UP * 0.019                  # centre of the face
CLUB_MARKERS = {"grip_L": [0, GRIP_L_Y, 0], "head": SWEET.tolist(), "butt": [0, -0.175, 0]}


def pchip(keys, f):
    """Monotone cubic (Fritsch–Carlson) through [(frame, value or vector)]: no overshoot, no stop at keys."""
    xs = np.array([k[0] for k in keys], float)
    ys = np.array([np.atleast_1d(np.asarray(k[1], float)) for k in keys])
    if f <= xs[0]:
        return ys[0].copy()
    if f >= xs[-1]:
        return ys[-1].copy()
    h = np.diff(xs)
    d = np.diff(ys, axis=0) / h[:, None]
    m = np.zeros_like(ys)
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, len(xs) - 1):
        same = d[i - 1] * d[i] > 0
        w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
        m[i] = np.where(same, (w1 + w2) / (w1 / np.where(same, d[i - 1], 1) + w2 / np.where(same, d[i], 1)), 0.0)
    i = int(np.searchsorted(xs, f) - 1)
    t = (f - xs[i]) / h[i]
    h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
    return h00 * ys[i] + h10 * h[i] * m[i] + h01 * ys[i + 1] + h11 * h[i] * m[i + 1]


def _rot(axis, deg):
    return rot_axis(_n(axis), np.radians(deg))


# key frames (30 fps):    address   takeaway   top    transition  downswing   impact   release   finish  hold  back
KEYS_F = [0, 10, 30, 45, 49, 53, 57, 63, 74, 92, 120]
HANDS = [0, 0, 52, 126, 126, 92, -2, -70, -138, -142, 0]           # hands' angle in the swing plane (deg, + = back)
CLUB = [0, 0, 92, 255, 258, 196, 2.5, -112, -262, -268, 0]          # club angle in the plane (hinge/lag = CLUB - HANDS)
CHEST_YAW = [0, 0, -42, -88, -86, -64, 4, 58, 96, 100, 0]          # shoulder turn (+ = toward the target)
PELVIS_YAW = [0, 0, -14, -32, -28, -8, 26, 42, 52, 52, 0]
BEND = [1, 1, 1, 1, 1, 1, 1, 0.75, 0.2, 0.15, 1]                   # spine tilt over the ball (1 = address)
SHIFT_X = [0, 0, -0.018, -0.03, -0.025, 0.0, 0.015, 0.045, 0.065, 0.065, 0]
HAND_R = [1, 1, 0.94, 0.8, 0.8, 0.84, 1, 0.95, 0.86, 0.86, 1]       # hands' arc radius (in close at the top and in the downswing)
HEAD_FOLLOW = [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.85, 0.55, 0.25, 0.25, 0.9]     # head counter-turn: eyes on the ball
HEAD_X = [0, 0, -0.025, -0.04, -0.04, -0.03, -0.015, 0.04, 0.11, 0.11, 0]  # head path along the target line (m)
HEEL_R = [0, 0, 0, 0, 0, 0, 0.15, 0.6, 1, 1, 0]                     # right heel lifts and turns through to the finish


def club_frame(R, origin):
    return mat(R, origin)


def golf_swing(rig, socks):
    sk = rig.sk
    s = sk.scale
    X = np.array([1.0, 0, 0])
    n_frames = KEYS_F[-1]
    # address: shaft in the Y-Z plane at the lie angle, face square to the target (+X), sole flat on the ground
    y_w = np.array([0, -np.cos(np.radians(LIE_DEG)), -np.sin(np.radians(LIE_DEG))])   # shaft, hands → head
    z_w = X
    R0 = np.stack([np.cross(y_w, z_w), y_w, z_w], 1)
    heel = np.array([0.012 * s, 0, 0.004 * s])
    rest = rig.fk(Pose())
    heel[1] = rest["upperarm_R"][:3, 3][1] - 0.76 * s           # ball distance from the shoulders' line
    O0 = heel - R0 @ np.array([0, HOSEL_Y, 0])
    plane_n = _n(np.cross(y_w, -X))

    def _addr_torso():
        q = Pose()
        q.loc["pelvis"] = pelvis_world_offset(rig, [0, (0.01 + 0.055) * s, -0.065 * s])
        q.rot["pelvis"], q.rot["spine_01"], q.rot["spine_02"], q.rot["chest"] = rx(18), rx(7), rx(5), rx(2)
        q.rot["neck"], q.rot["head"] = rx(6), rx(14)
        return q

    def body(f):
        k = lambda arr: float(pchip(list(zip(KEYS_F, arr)), f)[0])
        b, cy, py = k(BEND), k(CHEST_YAW), k(PELVIS_YAW)
        p = Pose()
        stance = (0.045 + 0.02 * b) * s
        p.loc["pelvis"] = pelvis_world_offset(rig, [k(SHIFT_X) * s, (0.01 + 0.055 * b) * s, -stance])
        # turn about the tilted spine (tilt applied after the twist), so the spine angle over the ball is kept
        p.rot["pelvis"] = rx(4 + 14 * b) @ ry(py)
        p.rot["spine_01"] = rx(-3 + 10 * b) @ ry(0.30 * (cy - py))
        p.rot["spine_02"] = rx(-2 + 7 * b) @ ry(0.35 * (cy - py))
        p.rot["chest"] = rx(2 * b) @ ry(0.35 * (cy - py))
        # side bend of the spine (about each bone's forward axis) keeps the head on HEAD_X: turning about a
        # tilted spine would otherwise swing the head well off the ball (secant solve, 6 steps)
        hx0 = rig.fk(_addr_torso())["head"][:3, 3][0]
        want = hx0 + k(HEAD_X) * s

        def head_x(a):
            q = Pose(); q.loc = dict(p.loc); q.rot = dict(p.rot)
            for bn, w in (("spine_01", 0.5), ("spine_02", 0.5)):
                q.rot[bn] = q.rot[bn] @ rz(a * w)
            return rig.fk(q)["head"][:3, 3][0], q
        a0, a1 = 0.0, 8.0
        x0, _ = head_x(a0)
        x1, q = head_x(a1)
        for _ in range(6):
            if abs(x1 - x0) < 1e-7:
                break
            a0, a1, x0 = a1, a1 - (x1 - want) * (a1 - a0) / (x1 - x0), x1
            x1, q = head_x(a1)
        p.rot.update({bn: q.rot[bn] for bn in ("spine_01", "spine_02")})
        hf = k(HEAD_FOLLOW)
        p.rot["neck"] = rx(6 * b) @ ry(-0.4 * hf * cy)
        p.rot["head"] = rx(10 * b + 4) @ ry(-0.5 * hf * cy)
        # legs: feet planted; the right heel peels up and the right knee turns in toward the target at the finish
        W0 = rig.fk(Pose())
        for sd, sx in SIDES:
            ank = W0[f"foot_{sd}"][:3, 3].copy()
            Rf = W0[f"foot_{sd}"][:3, :3]
            pole = np.array([0.12 * sx, -1.0, 0])
            if sd == "R":
                hl = k(HEEL_R)
                if hl > 1e-4:
                    ball = (W0["toe_R"][:3, 3] if "toe_R" in W0 else ank + np.array([0, -0.12 * s, -0.05 * s]))
                    Rp = _rot(X, -38 * hl) @ _rot([0, 0, 1], 28 * hl)       # heel up, foot turned toward the target
                    ank = ball + Rp @ (ank - ball)
                    Rf = Rp @ Rf
                    pole = _n(np.array([0.12 * sx + 0.9 * hl, -1.0, 0]))
            two_bone_ik(rig, p, f"thigh_{sd}", f"shin_{sd}", ank, pole)
            rig.set_world_rotation(p, f"foot_{sd}", Rf)
        return p

    # the pivot of the arc: between the shoulders at address
    p_addr = body(0)
    Wa = rig.fk(p_addr)
    pivot0 = 0.5 * (Wa["upperarm_L"][:3, 3] + Wa["upperarm_R"][:3, 3]) + np.array([0, -0.02, -0.08]) * s
    club = {"name": "GolfClub", "support": "L", "grip_radius": GRIP_RADIUS,
            "markers": {"grip_L": mat(t=[0, GRIP_L_Y, 0]), "head": mat(t=SWEET)}}
    poles = {"R": np.array([-0.6, 0.2, -1.0]), "L": np.array([0.7, 0.1, -1.0])}
    P_addr = club_frame(R0, O0)
    fit_support_marker(rig, club, P_addr, socks, poles, base=p_addr)

    def club_at(f):
        k = lambda arr: float(pchip(list(zip(KEYS_F, arr)), f)[0])
        shift = np.array([k(SHIFT_X) * s, 0, 0])
        pivot = pivot0 + shift
        Rh, Rc = _rot(plane_n, k(HANDS)), _rot(plane_n, k(CLUB))
        origin = pivot + k(HAND_R) * (Rh @ (O0 - pivot0))
        return club_frame(Rc @ R0, origin)

    p0, P0 = solve_weapon(rig, body(0), P_addr, club, socks, poles, return_P=True)
    gR = fit_grip(rig, p0, "R", P0[:3, 3], P0[:3, 1], GRIP_RADIUS)
    ML = P0 @ club["markers"]["grip_L"]
    gL = fit_grip(rig, p0, "L", ML[:3, 3], ML[:3, 1], GRIP_RADIUS)
    frames, track, slid = [], [], []
    for f in range(n_frames + 1):
        Pt = club_at(f)
        p, P = solve_weapon(rig, body(f), Pt, club, socks, poles, return_P=True)
        apply_grip(p, "R", gR)
        apply_grip(p, "L", gL)
        frames.append(p)
        track.append(P)
        slid.append(float(np.linalg.norm(P[:3, 3] - Pt[:3, 3])))
    head = [(P @ np.append(SWEET, 1.0))[:3] for P in track]
    impact_f = KEYS_F[6]
    meta = {"loop": True, "prop": "GolfClub", "attach": "socket_hand_R_prop",
            "support": {"hand": "L", "marker": "grip_L", "gripRadius": GRIP_RADIUS},
            "grip": {"R": {k2: (list(v) if isinstance(v, tuple) else v) for k2, v in gR.items()},
                     "L": {k2: (list(v) if isinstance(v, tuple) else v) for k2, v in gL.items()}},
            "markers": {"takeaway": KEYS_F[2], "top": KEYS_F[3], "impact": impact_f, "finish": KEYS_F[8], "end": n_frames},
            "clubMarkers": {k2: [float(x) for x in v] for k2, v in CLUB_MARKERS.items()},
            "gripLMarker": club["markers"]["grip_L"].tolist(),
            "checks": {"headAtAddress_m": [round(float(x), 4) for x in head[0]],
                       "headAtImpact_m": [round(float(x), 4) for x in head[impact_f]],
                       "impactMissFromAddress_m": round(float(np.linalg.norm(head[impact_f] - head[0])), 4),
                       "lowestHeadZ_m": round(float(min(h[2] for h in head)), 4),
                       "maxReachSlide_m": round(max(slid), 4)}}
    return frames, meta
