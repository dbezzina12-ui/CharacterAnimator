"""Rest skeleton generated from proportion parameters.

Authoring space is Blender's: +Z up, character faces -Y, character LEFT is +X.
(glTF export converts to +Y up / faces +Z; character left stays +X.)

Bone local axes (Blender convention, identical after glTF export up to the
Z-up -> Y-up change of basis):
  +Y  points from the bone head to its tail (along the bone)
  +Z  is the bone's "positive bend" direction, so a positive rotation about
      local +X moves the tail toward +Z.  The meaning per bone is recorded in
      BEND_CONVENTION and exported in the character JSON.
"""
import numpy as np

from .params import girth

BEND_CONVENTION = {
    "spine/neck/head": "+X rotation bends forward (flexion)",
    "clavicle": "+X rotation moves the shoulder forward (protraction)",
    "upperarm": "+X rotation swings the arm forward (shoulder flexion)",
    "forearm": "+X rotation bends the elbow (flexion)",
    "forearm_twist": "rotation about +Y only; carries ~50% of hand twist",
    "hand": "+X rotation flexes the wrist toward the palm; local +Z is the palm normal",
    "fingers": "+X rotation curls the finger toward the palm",
    "thumb": "+X rotation curls the thumb across the palm",
    "thigh": "+X rotation swings the leg forward (hip flexion)",
    "shin": "+X rotation bends the knee (flexion)",
    "foot": "+X rotation lifts the toes (dorsiflexion)",
    "toe": "+X rotation lifts the toes (extension)",
}

FINGERS = ("index", "middle", "ring", "pinky")

# Driven joints. Their rotation is a pure function of another bone's basis rotation:
#   "half"       -> slerp(identity, source_basis, 0.5)   (same rest frame as the source)
#   "twist_half" -> 50% of the source's twist about its local +Y
# Baked into every exported clip; mirrored as Copy Rotation constraints in the .blend.
DRIVERS = {}
for _sd in ("L", "R"):
    DRIVERS[f"shoulder_helper_{_sd}"] = (f"upperarm_{_sd}", "half")
    DRIVERS[f"elbow_helper_{_sd}"] = (f"forearm_{_sd}", "half")
    DRIVERS[f"hip_helper_{_sd}"] = (f"thigh_{_sd}", "half")
    DRIVERS[f"knee_helper_{_sd}"] = (f"shin_{_sd}", "half")
    DRIVERS[f"forearm_twist_{_sd}"] = (f"hand_{_sd}", "twist_half")

# weight pairs whose overlap is routed through a helper
HELPER_PAIRS = {}
for _sd in ("L", "R"):
    HELPER_PAIRS[f"shoulder_helper_{_sd}"] = (f"clavicle_{_sd}", f"upperarm_{_sd}")
    HELPER_PAIRS[f"elbow_helper_{_sd}"] = (f"upperarm_{_sd}", f"forearm_{_sd}")
    HELPER_PAIRS[f"hip_helper_{_sd}"] = ("pelvis", f"thigh_{_sd}")
    HELPER_PAIRS[f"knee_helper_{_sd}"] = (f"thigh_{_sd}", f"shin_{_sd}")


def _n(v):
    v = np.asarray(v, dtype=float)
    return v / np.linalg.norm(v)


def _perp(v, axis):
    v = np.asarray(v, float)
    return _n(v - np.dot(v, axis) * axis)


def rot_axis(axis, ang):
    """Rotation matrix about unit axis by ang radians."""
    a = _n(axis)
    c, s = np.cos(ang), np.sin(ang)
    x, y, z = a
    return np.array([
        [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
        [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
        [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
    ])


class Bone:
    __slots__ = ("name", "head", "tail", "parent", "zref", "deform", "side")

    def __init__(self, name, head, tail, parent, zref, deform=True, side=""):
        self.name = name
        self.head = np.asarray(head, float)
        self.tail = np.asarray(tail, float)
        self.parent = parent
        self.zref = np.asarray(zref, float)
        self.deform = deform
        self.side = side

    @property
    def length(self):
        return float(np.linalg.norm(self.tail - self.head))

    def frame(self):
        """3x3 matrix whose columns are the bone's local X, Y, Z axes (armature space)."""
        y = _n(self.tail - self.head)
        z = _perp(self.zref, y)
        x = np.cross(y, z)
        return np.stack([x, y, z], axis=1)

    def matrix(self):
        m = np.eye(4)
        m[:3, :3] = self.frame()
        m[:3, 3] = self.head
        return m


class Skeleton:
    def __init__(self):
        self.bones = {}
        self.order = []
        self.landmarks = {}
        self.sockets = {}
        self.scale = 1.0

    def add(self, b):
        self.bones[b.name] = b
        self.order.append(b.name)
        return b

    def __getitem__(self, k):
        return self.bones[k]

    def mirrored_name(self, name):
        if name.endswith("_L"):
            return name[:-2] + "_R"
        if name.endswith("_R"):
            return name[:-2] + "_L"
        return name


MIRROR = np.diag([-1.0, 1.0, 1.0])


def build_skeleton(p):
    """Return Skeleton for resolved params `p` (see params.resolve)."""
    hs, sw, tw, td = p["headSize"], p["shoulderWidth"], p["torsoWidth"], p["torsoDepth"]
    al, ll, hz, fz = p["armLength"], p["legLength"], p["handSize"], p["footSize"]
    g = girth(p)

    # ---- nominal vertical landmarks (metres, before global rescale) ----
    ankle_z = 0.080 * (0.6 + 0.4 * fz)
    shin_len = 0.405 * ll
    thigh_len = 0.415 * ll
    knee_z = ankle_z + shin_len
    hip_z = knee_z + thigh_len
    torso_len = 0.490 * (0.85 + 0.15 * tw)
    neckbase_z = hip_z + torso_len
    chin_z = neckbase_z + 0.090
    head_h = 0.280 * hs
    crown_z = chin_z + head_h
    s = p["height"] / crown_z

    sk = Skeleton()
    sk.scale = s
    L = sk.landmarks
    L.update(dict(ankle_z=ankle_z, knee_z=knee_z, hip_z=hip_z, neckbase_z=neckbase_z,
                  chin_z=chin_z, crown_z=crown_z, head_h=head_h, girth=g))

    # ---- centre line ----
    root = sk.add(Bone("root", (0, 0, 0), (0, 0, 0.25), None, (0, -1, 0), deform=False))
    pelvis_h = np.array([0, 0.004, hip_z + 0.045])
    spine1_h = np.array([0, 0.018, hip_z + 0.135])
    spine2_h = np.array([0, 0.030, hip_z + 0.245])
    chest_h = np.array([0, 0.028, hip_z + 0.350])
    neck_h = np.array([0, 0.030, neckbase_z + 0.012])
    head_h_pt = np.array([0, 0.008, chin_z + 0.068])
    crown = np.array([0, 0.008, crown_z])
    fwd = (0, -1, 0)
    sk.add(Bone("pelvis", pelvis_h, spine1_h, "root", fwd))
    sk.add(Bone("spine_01", spine1_h, spine2_h, "pelvis", fwd))
    sk.add(Bone("spine_02", spine2_h, chest_h, "spine_01", fwd))
    sk.add(Bone("chest", chest_h, neck_h, "spine_02", fwd))
    sk.add(Bone("neck", neck_h, head_h_pt, "chest", fwd))
    sk.add(Bone("head", head_h_pt, crown, "neck", fwd))

    # ---- left arm (right is mirrored) ----
    sh_x = 0.168 * sw * (0.9 + 0.1 * tw)
    clav_h = np.array([0.020, -0.030, neckbase_z - 0.018])
    shoulder = np.array([sh_x, 0.006, neckbase_z - 0.020])
    down, fwd_ang = np.radians(48.0), np.radians(7.0)
    d_ua = _n([np.cos(down) * np.cos(fwd_ang), -np.cos(down) * np.sin(fwd_ang), -np.sin(down)])
    ua_len, fa_len = 0.292 * al, 0.245 * al
    elbow = shoulder + d_ua * ua_len
    f_perp = _perp((0, -1, 0.35), d_ua)            # elbow flexion direction (forward, slightly up)
    elbow_bend = np.radians(14.0)
    d_fa = _n(np.cos(elbow_bend) * d_ua + np.sin(elbow_bend) * f_perp)
    wrist = elbow + d_fa * fa_len

    # hand frame: Y along the hand, r = radial (thumb side, forward), n = palm normal (in/down)
    yh = d_fa
    r_dir = _perp((0, -1, 0), yh)
    n_dir = np.cross(yh, r_dir)                   # left hand: points medially/down
    if n_dir[0] > 0:
        n_dir = -n_dir
    palm_len = 0.098 * hz
    L.update(dict(shoulder_L=shoulder, elbow_L=elbow, wrist_L=wrist, hand_y_L=yh, hand_r_L=r_dir,
                  hand_n_L=n_dir, ua_len=ua_len, fa_len=fa_len, palm_len=palm_len, sh_x=sh_x))

    left = []
    left.append(Bone("clavicle_L", clav_h, shoulder, "chest", (0, -1, 0), side="L"))
    left.append(Bone("upperarm_L", shoulder, elbow, "clavicle_L", f_perp, side="L"))
    left.append(Bone("forearm_L", elbow, wrist, "upperarm_L", _perp(f_perp, d_fa), side="L"))
    left.append(Bone("forearm_twist_L", elbow + d_fa * fa_len * 0.5, wrist, "forearm_L",
                     _perp(f_perp, d_fa), side="L"))
    knuckle_mid = wrist + yh * palm_len
    left.append(Bone("hand_L", wrist, knuckle_mid, "forearm_L", n_dir, side="L"))

    def hp(l, r, n):
        return wrist + yh * (l * hz) + r_dir * (r * hz) + n_dir * (n * hz)

    # finger layout (hand-local l, r, n in metres at handSize 1); lengths prox/mid/dist
    finger_def = {
        "index": dict(mcp=(0.093, 0.031, 0.002), lens=(0.044, 0.027, 0.023), spread=5.0),
        "middle": dict(mcp=(0.098, 0.010, -0.001), lens=(0.048, 0.031, 0.025), spread=0.0),
        "ring": dict(mcp=(0.094, -0.011, 0.001), lens=(0.045, 0.029, 0.024), spread=-4.0),
        "pinky": dict(mcp=(0.085, -0.030, 0.004), lens=(0.035, 0.022, 0.021), spread=-9.0),
    }
    rest_curl = (np.radians(6), np.radians(10), np.radians(6))
    L["finger_def"] = finger_def
    for fname, fd in finger_def.items():
        pos = hp(*fd["mcp"])
        base_dir = _n(rot_axis(n_dir, np.radians(fd["spread"])) @ yh)  # spread about palm normal
        # sign: positive spread toward radial side
        if np.dot(base_dir, r_dir) * fd["spread"] < 0:
            base_dir = _n(rot_axis(n_dir, -np.radians(fd["spread"])) @ yh)
        across = _n(np.cross(base_dir, n_dir))
        d = base_dir
        parent = "hand_L"
        for i, (ln, curl) in enumerate(zip(fd["lens"], rest_curl)):
            d = _n(rot_axis(across, curl) @ d)
            # make sure curl bends toward the palm (n)
            if np.dot(d - base_dir, n_dir) < -1e-9 and i == 0:
                across = -across
                d = _n(rot_axis(across, 2 * curl) @ d)
            tail = pos + d * ln * hz
            name = f"{fname}_{i + 1:02d}_L"
            left.append(Bone(name, pos, tail, parent, _perp(n_dir, d), side="L"))
            parent, pos = name, tail
        L[f"{fname}_tip_L"] = pos

    # thumb: CMC near the wrist on the radial/palmar side
    cmc = hp(0.020, 0.021, 0.008)
    t_lens = (0.047, 0.036, 0.031)
    t_dirs = [_n(0.78 * yh + 0.52 * r_dir + 0.32 * n_dir),
              _n(0.90 * yh + 0.33 * r_dir + 0.25 * n_dir),
              _n(0.95 * yh + 0.20 * r_dir + 0.20 * n_dir)]
    pos, parent = cmc, "hand_L"
    for i, (ln, d) in enumerate(zip(t_lens, t_dirs)):
        tail = pos + d * ln * hz
        flex = _perp(-r_dir + 0.8 * n_dir, d)     # thumb curls across the palm
        name = f"thumb_{i + 1:02d}_L"
        left.append(Bone(name, pos, tail, parent, flex, side="L"))
        parent, pos = name, tail
    L["thumb_tip_L"] = pos

    # ---- left leg ----
    hip_x = 0.089 * (0.6 + 0.4 * tw) * (1.0 + 0.7 * (p.get("hipWidth", 1.0) - 1.0))
    hip = np.array([hip_x, 0.000, hip_z])
    knee = np.array([hip_x + 0.006, -0.014, knee_z])
    ankle = np.array([hip_x + 0.014, 0.018, ankle_z])
    toe_out = np.radians(6.0)
    ff = _n(rot_axis((0, 0, 1), toe_out) @ np.array([0, -1.0, 0]))   # foot forward, turned out
    if ff[0] < 0:
        ff = _n(rot_axis((0, 0, 1), -toe_out) @ np.array([0, -1.0, 0]))
    heel_back = ankle - ff * (0.058 * fz)
    heel_back[2] = 0.0
    ball = heel_back + ff * (0.188 * fz)
    ball[2] = 0.026 * fz
    toe_tip = heel_back + ff * (0.255 * fz)
    toe_tip[2] = 0.020 * fz
    L.update(dict(hip_L=hip, knee_L=knee, ankle_L=ankle, heel_L=heel_back, ball_L=ball,
                  toe_tip_L=toe_tip, foot_fwd_L=ff, hip_x=hip_x))
    left.append(Bone("thigh_L", hip, knee, "pelvis", (0, -1, 0), side="L"))
    left.append(Bone("shin_L", knee, ankle, "thigh_L", (0, 1, 0), side="L"))
    left.append(Bone("foot_L", ankle, ball, "shin_L", (0, 0, 1), side="L"))
    left.append(Bone("toe_L", ball, toe_tip, "foot_L", (0, 0, 1), side="L"))

    # driven helper joints (take half of a joint's rotation; prevent LBS collapse)
    byname = {b.name: b for b in left}
    for helper, parent, src in (("shoulder_helper_L", "clavicle_L", "upperarm_L"),
                                ("elbow_helper_L", "upperarm_L", "forearm_L"),
                                ("hip_helper_L", "pelvis", "thigh_L"),
                                ("knee_helper_L", "thigh_L", "shin_L")):
        sb = byname[src]
        left.append(Bone(helper, sb.head, sb.head + (sb.tail - sb.head) * 0.35, parent, sb.zref, side="L"))

    # add left, then mirrored right
    for b in left:
        sk.add(b)
    for b in left:
        nb = Bone(b.name[:-2] + "_R", MIRROR @ b.head, MIRROR @ b.tail,
                  None if b.parent is None else sk.mirrored_name(b.parent),
                  MIRROR @ b.zref, b.deform, side="R")
        sk.add(nb)
    for k in list(L.keys()):
        if k.endswith("_L") and isinstance(L[k], np.ndarray):
            v = L[k]
            L[k[:-2] + "_R"] = MIRROR @ v if v.shape == (3,) else v

    # ---- global rescale to the requested height ----
    for b in sk.bones.values():
        b.head = b.head * s
        b.tail = b.tail * s
    for k, v in list(L.items()):
        if isinstance(v, np.ndarray) and v.shape == (3,) and not k.startswith("hand_") and \
                not k.startswith("foot_fwd"):
            L[k] = v * s
        elif isinstance(v, float) and k != "girth":
            L[k] = v * s
    return sk


def socket_defs(sk):
    """Attachment sockets. Frames use glTF semantics (+Y up/along, +Z forward/out).

    Returns name -> dict(parent, position (armature space, Blender coords), x, y, z axes
    expressed in *Blender* world axes for the glTF-semantic local axes).
    """
    s = sk.scale
    L = sk.landmarks
    out = {}
    hz = 1.0
    for side in ("L", "R"):
        wrist = L[f"wrist_{side}"]
        yh, rd, nd = L[f"hand_y_{side}"], L[f"hand_r_{side}"], L[f"hand_n_{side}"]
        hand = sk[f"hand_{side}"]
        hsz = hand.length / (0.098 * s)   # handSize factor recovered from palm length
        pos = wrist + yh * (0.080 * s * hsz) + nd * (0.034 * s * hsz) + rd * (0.004 * s * hsz)
        grip_axis = _n(rd + 0.30 * yh)   # oblique power-grip axis, toward the thumb side
        z_out = _perp(nd, grip_axis)       # out of the palm
        x = np.cross(grip_axis, z_out)
        out[f"socket_hand_{side}_prop"] = dict(parent=f"hand_{side}", pos=pos, x=x, y=grip_axis, z=z_out,
                                              doc="Hand prop: +Y = grip axis exiting the thumb/index side, "
                                                  "+Z = out of the palm, origin = centre of a closed power grip "
                                                  f"(handle radius {GRIP_RADIUS * 1000:.0f} mm at scale 1).")
    head = sk["head"]
    up, fw = np.array([0, 0, 1.0]), np.array([0, -1.0, 0])
    out["socket_head_accessory"] = dict(parent="head", pos=head.tail.copy(), x=np.cross(up, -fw) * -1,
                                        y=up, z=fw, doc="Head accessory: origin at the crown, +Y up, +Z facing "
                                                         "forward (same as the character).")
    chest = sk["chest"]
    back = np.array([0, chest.head[1] + 0.105 * s * L.get("girth", 1.0), chest.head[2] + 0.02 * s])
    out["socket_back_accessory"] = dict(parent="chest", pos=back, x=np.array([-1.0, 0, 0]), y=up,
                                        z=np.array([0, 1.0, 0]),
                                        doc="Back accessory: origin between the shoulder blades on the skin, "
                                            "+Y up, +Z pointing away from the back.")
    # fix head x axis (x = y cross z in glTF semantics)
    o = out["socket_head_accessory"]
    o["x"] = np.cross(o["y"], o["z"])
    o = out["socket_back_accessory"]
    o["x"] = np.cross(o["y"], o["z"])
    return out


GRIP_RADIUS = 0.016   # metres at scale 1: the power-grip socket is fitted to this handle radius
