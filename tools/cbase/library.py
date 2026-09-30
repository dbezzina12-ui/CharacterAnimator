"""Named test poses and authored clip recipes (rotation-only, IK-driven where useful).

Everything here evaluates to plain per-bone basis rotations, which build.py bakes
into Blender actions -> glTF animations. Nothing depends on a viewer update loop.
"""
import numpy as np

from .poses import Pose, curl_fingers, rx, ry, rz, set_hand, two_bone_ik
from .skeleton import _n, _perp, rot_axis

SIDES = (("L", 1.0), ("R", -1.0))


def rotate_world(rig, pose, bone, axis, deg):
    cur = rig.world(pose, bone)[:3, :3]
    rig.set_world_rotation(pose, bone, rot_axis(np.asarray(axis, float), np.radians(deg)) @ cur)


def raise_arm(rig, pose, side, elev_deg, fwd_deg=0.0, clavicle_share=0.22):
    """Abduct the arm by elev_deg (frontal plane) and flex it forward by fwd_deg."""
    sx = 1.0 if side == "L" else -1.0
    ax_abd = np.array([0, -sx, 0])
    rotate_world(rig, pose, f"clavicle_{side}", ax_abd, elev_deg * clavicle_share)
    rotate_world(rig, pose, f"upperarm_{side}", ax_abd, elev_deg * (1 - clavicle_share))
    if fwd_deg:
        # forward flexion: rotate about world -X so the arm swings toward -Y (front)
        rotate_world(rig, pose, f"upperarm_{side}", np.array([-1.0, 0, 0]), fwd_deg)


def hand_frame(side, rig, palm_dir, finger_dir):
    """World rotation for hand_<side> whose local +Y = finger_dir and +Z (palm normal) = palm_dir."""
    y = _n(finger_dir)
    z = _perp(palm_dir, y)
    x = np.cross(y, z)
    return np.stack([x, y, z], 1)


def reach(rig, pose, side, wrist_target, pole, palm_dir, finger_dir, clav=0.0):
    if clav:
        sx = 1.0 if side == "L" else -1.0
        rotate_world(rig, pose, f"clavicle_{side}", np.array([0, -sx, 0]), clav)
    err = two_bone_ik(rig, pose, f"upperarm_{side}", f"forearm_{side}", wrist_target, pole)
    set_hand(rig, pose, side, hand_frame(side, rig, palm_dir, finger_dir))
    return err


def plant_legs(rig, pose, rest_pose=None):
    """Keep both feet at their rest placement (leg IK + flat feet)."""
    rest = rig.fk(Pose())
    for sd, sx in SIDES:
        ank = rest[f"foot_{sd}"][:3, 3]
        two_bone_ik(rig, pose, f"thigh_{sd}", f"shin_{sd}", ank, np.array([0.12 * sx, -1.0, 0]))
        rig.set_world_rotation(pose, f"foot_{sd}", rest[f"foot_{sd}"][:3, :3])


def pelvis_offset(rig, world_delta):
    R = rig.rest["pelvis"][:3, :3]
    return R.T @ np.asarray(world_delta, float)


# ------------------------------- test poses ---------------------------------------
def pose_arms_raised(rig):
    p = Pose()
    for sd, _ in SIDES:
        raise_arm(rig, p, sd, 118, fwd_deg=12)
        p.rot[f"forearm_{sd}"] = rx(15)
    return p


def pose_elbows_bent(rig):
    p = Pose()
    for sd, sx in SIDES:
        raise_arm(rig, p, sd, 30, fwd_deg=35)
        p.rot[f"forearm_{sd}"] = rx(138)
    return p


def pose_hands_face(rig):
    p = Pose()
    s = rig.sk.scale
    head = rig.sk["head"]
    for sd, sx in SIDES:
        tgt = head.head + np.array([0.075 * sx * s, -0.16 * s, -0.035 * s])
        reach(rig, p, sd, tgt, pole=np.array([sx * 0.9, 0.2, -1.0]), palm_dir=np.array([-sx * 0.4, 1.0, 0.1]),
              finger_dir=np.array([-sx * 0.25, 0.1, 1.0]), clav=8)
        curl_fingers(p, sd, 0.25, thumb=0.3)
    return p


def pose_wrist_fingers(rig):
    p = Pose()
    for sd, sx in SIDES:
        raise_arm(rig, p, sd, 10, fwd_deg=45)
        p.rot[f"forearm_{sd}"] = rx(70)
    # left: strong pronation twist + full fist; right: supination + wrist flexion + half curl
    p.rot["hand_L"] = ry(85)
    curl_fingers(p, "L", 1.0, thumb=1.0)
    p.rot["hand_R"] = ry(-70) @ rx(45)
    curl_fingers(p, "R", {"index": 0.2, "middle": 0.5, "ring": 0.7, "pinky": 0.9}, thumb=0.5)
    return p


def pose_torso_twist(rig):
    p = Pose()
    for b in ("spine_01", "spine_02", "chest"):
        p.rot[b] = ry(-16) @ rx(4)
    for sd, sx in SIDES:
        raise_arm(rig, p, sd, 20, fwd_deg=20 * sx)
        p.rot[f"forearm_{sd}"] = rx(40)
    return p


def pose_head_turn(rig):
    p = Pose()
    p.rot["neck"] = ry(28) @ rx(-8)
    p.rot["head"] = ry(40) @ rz(10) @ rx(12)
    return p


def pose_crouch(rig):
    p = Pose()
    s = rig.sk.scale
    p.loc["pelvis"] = pelvis_offset(rig, [0, 0.05 * s, -0.30 * s])
    p.rot["pelvis"] = rx(16)
    for b in ("spine_01", "spine_02"):
        p.rot[b] = rx(10)
    p.rot["chest"] = rx(4)
    p.rot["neck"] = rx(-14)
    p.rot["head"] = rx(-10)
    plant_legs(rig, p)
    for sd, sx in SIDES:
        raise_arm(rig, p, sd, 0, fwd_deg=40)
        p.rot[f"forearm_{sd}"] = rx(55)
    return p


TEST_POSES = {
    "arms_raised": pose_arms_raised,
    "elbows_bent": pose_elbows_bent,
    "hands_near_face": pose_hands_face,
    "wrist_rotation_finger_curl": pose_wrist_fingers,
    "torso_twist": pose_torso_twist,
    "head_turn": pose_head_turn,
    "crouch": pose_crouch,
}
