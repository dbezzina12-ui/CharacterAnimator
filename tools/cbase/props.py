"""Test weapon props shared by all characters (props/weapons.glb + props/weapons.json).

Prop-local frames use the same glTF semantics as the hand sockets, so attaching a prop is
simply "parent it to socket_hand_R_prop with an identity transform":
  origin = centre of the main (right-hand) power grip
  +Y     = main grip axis, pointing out of the thumb side (blade / staff top / gun top)
  +Z     = out of the right palm
Each prop carries marker nodes: grip_L (support-hand frame: put socket_hand_L_prop here),
and muzzle / tip where useful. Clips place the weapon, then solve both arms onto it.
"""
import json
import os

import numpy as np

from .skeleton import GRIP_RADIUS, _n, _perp, socket_defs

K = np.array([[1.0, 0, 0], [0, 0, -1.0], [0, 1.0, 0]])     # glTF-local -> Blender-local (x, -z, y)


def socket_barrel_dir(sk):
    """Direction the index finger points, expressed in the right-hand socket frame (gun barrel)."""
    s = socket_defs(sk)["socket_hand_R_prop"]
    yh = sk.landmarks["hand_y_R"]
    b = _perp(yh, s["y"])
    return _n(np.array([np.dot(b, s["x"]), 0.0, np.dot(b, s["z"])]))


def mat(R=None, t=None):
    M = np.eye(4)
    if R is not None:
        M[:3, :3] = R
    if t is not None:
        M[:3, 3] = t
    return M


def rot_y(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_x(deg):
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


DETONATOR_BUTTON_Y = 0.066   # button top above the grip centre: within reach of the master rig's thumb tip on the
                             # grip axis, clear of the closed fist (the index finger tops out at ~0.053)
DETONATOR_TRAVEL = 0.005


def weapon_specs(sk):
    """Geometry parts (glTF prop-local) and markers. The sword's grip_L roll is refined by
    clips_more.fit_support_marker(); the rifle and two-handed pistol support frames are fixed by
    design (support_fixed). Markers are stored in props/weapons.json."""
    r = GRIP_RADIUS
    b = socket_barrel_dir(sk)                 # barrel / forward for guns (prop-local)
    up = np.array([0, 1.0, 0])
    zp = np.array([0, 0, 1.0])                # out of the right palm = toward the gun's left panel
    # rifle support hand UNDER the handguard: palm up (+Z of the hand frame = gun up), thumb forward (+Y = barrel)
    rifle_L = np.stack([np.cross(b, up), b, up], 1)
    # two-handed pistol: the left hand cups the right fist; same grip axis, left palm on the fist's left side
    # (+Z of the left hand frame = -Z of the prop), fingers wrapped around the right fist
    pistol_L = np.stack([np.cross(up, -zp), up, -zp], 1)
    return {
        "Sword2H": {
            "parts": [("cyl", [0, -0.19, 0], [0, 0.06, 0], r, "grip"),
                      ("box", [0, 0.07, 0], [0.22, 0.022, 0.035], "guard"),
                      ("sphere", [0, -0.205, 0], 0.024, "metal"),
                      ("blade", [0, 0.08, 0], [0, 0.98, 0], 0.052, "blade")],
            "markers": {"grip_L": mat(t=[0, -0.105, 0]), "tip": mat(t=[0, 0.98, 0])},
            "support": "L", "grip_radius": r,
        },
        "Staff": {
            # one-handed walking/wizard staff: held at ~1.16 m with the butt on the ground
            "parts": [("cyl", [0, -1.14, 0], [0, 0.62, 0], r, "wood"),
                      ("sphere", [0, 0.64, 0], 0.03, "metal"), ("sphere", [0, -1.14, 0], 0.024, "metal")],
            "markers": {"tip": mat(t=[0, 0.64, 0]), "butt": mat(t=[0, -1.164, 0])},
            "support": None, "grip_radius": r,
        },
        "Pistol": {
            "parts": [("cyl", [0, -0.055, 0], [0, 0.045, 0], r * 1.05, "grip"),
                      ("beam", list(up * 0.062 - b * 0.035), list(up * 0.062 + b * 0.165), [0.030, 0.034], "metal", b),
                      ("cyl", list(up * 0.066 + b * 0.16), list(up * 0.066 + b * 0.19), 0.007, "dark")],
            "markers": {"muzzle": mat(t=up * 0.066 + b * 0.19),
                        "grip_L_2h": mat(pistol_L, zp * 0.021 - up * 0.006)},
            "support": None, "grip_radius": r, "barrel": b.tolist(),
            # the left fingers wrap the right fist: a ~3.6 cm cylinder around the gun's grip axis
            "support_radius_2h": 0.036, "support_center_2h": (zp * 0.004 - up * 0.006).tolist(),
        },
        "Rifle": {
            "parts": [("cyl", [0, -0.06, 0], [0, 0.04, 0], r * 1.05, "grip"),
                      ("beam", list(up * 0.065 - b * 0.08), list(up * 0.065 + b * 0.18), [0.045, 0.06], "metal", b),
                      ("beam", list(up * 0.045 - b * 0.31), list(up * 0.06 - b * 0.08), [0.04, 0.10], "wood", b),
                      ("beam", list(up * 0.06 + b * 0.10), list(up * 0.06 + b * 0.40), [0.034, 0.036], "wood", b),
                      ("cyl", list(up * 0.075 + b * 0.18), list(up * 0.075 + b * 0.62), 0.011, "dark")],
            "markers": {"grip_L": mat(rifle_L, up * 0.06 + b * 0.20), "muzzle": mat(t=up * 0.075 + b * 0.62),
                        "butt": mat(t=up * 0.045 - b * 0.31)},
            "support": "L", "grip_radius": r, "barrel": b.tolist(),
            "support_axis": b.tolist(),       # support hand wraps the handguard (axis = barrel)
            "support_fixed": True,
            "contact_parts": [2],             # the stock rests in the shoulder pocket by design
        },
        "Detonator": {
            # hand-held remote: power grip around the body, thumb on the red button on top
            "parts": [("cyl", [0, -0.062, 0], [0, 0.052, 0], r * 1.1, "dark"),
                      ("cyl", [0, 0.052, 0], [0, DETONATOR_BUTTON_Y - 0.006, 0], r * 1.3, "metal"),
                      ("cyl", [0, DETONATOR_BUTTON_Y - 0.006, 0], [0, DETONATOR_BUTTON_Y, 0], 0.0085, "red"),
                      ("cyl", [-0.012, 0.03, 0.008], [-0.012, 0.15, 0.008], 0.0025, "dark"),   # antenna, away from the thumb
                      ("sphere", [-0.012, 0.152, 0.008], 0.005, "red")],
            "markers": {"button": mat(t=[0, DETONATOR_BUTTON_Y, 0])},
            "support": None, "grip_radius": r * 1.1, "buttonTravel": DETONATOR_TRAVEL,
        },
    }


def props_json_path(root):
    return os.path.join(root, "props", "weapons.json")


def save_markers(root, specs, extra=None):
    os.makedirs(os.path.join(root, "props"), exist_ok=True)
    out = {"schema": "gamboligy.props/1.0",
           "frame": "glTF prop-local: origin = right-hand grip centre, +Y = grip axis (thumb side), "
                    "+Z = out of the right palm. Attach with identity to socket_hand_R_prop.",
           "collisionSamples": "[x, y, z, radius] spheres (prop-local) that must stay out of the skin; held "
                               "stretches of grip and intended contact (rifle stock) are excluded",
           "props": {}}
    from .collide import weapon_samples
    for name, sp in specs.items():
        pts, rad = weapon_samples(sp)
        out["props"][name] = {"collisionSamples": np.concatenate([pts, rad[:, None]], 1).round(5).tolist(),"markers": {k: np.asarray(v).round(6).tolist() for k, v in sp["markers"].items()},
                              "gripRadius": sp["grip_radius"], "supportHand": sp["support"],
                              **({"barrel": sp["barrel"]} if "barrel" in sp else {}),
                              **({"buttonTravel": sp["buttonTravel"]} if "buttonTravel" in sp else {})}
    if extra:
        out.update(extra)
    with open(props_json_path(root), "w") as fh:
        json.dump(out, fh, indent=1)


def build_blender_props(specs, path):
    """Create the prop meshes + marker empties in Blender and export props/weapons.glb."""
    import bmesh
    import bpy
    from mathutils import Matrix

    from .blender_build import export_glb
    mats = {}
    colors = {"grip": (0.25, 0.16, 0.10, 1), "guard": (0.55, 0.45, 0.2, 1), "metal": (0.72, 0.74, 0.78, 1),
              "blade": (0.82, 0.85, 0.9, 1), "wood": (0.45, 0.28, 0.12, 1), "dark": (0.12, 0.12, 0.13, 1),
              "red": (0.85, 0.08, 0.06, 1)}
    for k, c in colors.items():
        m = bpy.data.materials.new(f"M_Prop_{k}")
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = c
        bsdf.inputs["Metallic"].default_value = 0.6 if k in ("metal", "blade") else 0.0
        bsdf.inputs["Roughness"].default_value = 0.35 if k in ("metal", "blade") else 0.7
        mats[k] = m
    col = bpy.data.collections.new("Weapons")
    bpy.context.scene.collection.children.link(col)
    objs = []

    def add_part(bm, kind, a, b, size, extra=None):
        a, b = np.asarray(a, float), np.asarray(b, float)
        if kind == "sphere":
            geom = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=b if np.isscalar(b) else size)
            bmesh.ops.translate(bm, vec=a.tolist(), verts=geom["verts"])
            return geom["verts"]
        if kind == "box":
            geom = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=list(b), verts=geom["verts"])
            bmesh.ops.translate(bm, vec=a.tolist(), verts=geom["verts"])
            return geom["verts"]
        ax = b - a
        L = np.linalg.norm(ax)
        d = ax / L
        if kind == "cyl":
            geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=size, radius2=size, depth=L)
        elif kind == "blade":
            geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=size, radius2=size * 0.25, depth=L)
            bmesh.ops.scale(bm, vec=(0.18, 1.0, 1.0), verts=geom["verts"])   # thin across the palm normal
        else:   # beam: rectangular section size=[w,h], built along its own z
            geom = bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=(size[0], size[1], L), verts=geom["verts"])
        # local z -> d ; for beams keep local y ~ prop +Y
        z = d
        yref = np.array([0, 1.0, 0]) if abs(d[1]) < 0.9 else np.array([1.0, 0, 0])
        y = _perp(yref, z)
        x = np.cross(y, z)
        R = np.stack([x, y, z], 1)
        M = np.eye(4)
        M[:3, :3] = R
        M[:3, 3] = (a + b) / 2
        bmesh.ops.transform(bm, matrix=Matrix(M.tolist()), verts=geom["verts"])
        return geom["verts"]

    for name, sp in specs.items():
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        used = []
        for part in sp["parts"]:
            kind, a, b, size, matk = part[0], part[1], part[2], part[3] if len(part) > 3 else None, part[4] if len(part) > 4 else part[3]
            if kind == "sphere":
                size, matk = part[2], part[3]
                verts = add_part(bm, kind, a, size, size)
            else:
                verts = add_part(bm, kind, a, b, size)
            if matk not in used:
                used.append(matk)
            mi = used.index(matk)
            for f in {f for v in verts for f in v.link_faces}:
                f.material_index = mi
        # glTF-local -> Blender-local
        for v in bm.verts:
            v.co = (K @ np.array(v.co)).tolist()
        bm.to_mesh(me)
        bm.free()
        for k in used:
            me.materials.append(mats[k])
        ob = bpy.data.objects.new(name, me)
        col.objects.link(ob)
        ob["frame"] = "origin = right-hand grip; +Y grip axis (thumb side); +Z out of right palm"
        objs.append(ob)
        for mk, Mg in sp["markers"].items():
            e = bpy.data.objects.new(f"{name}_{mk}", None)
            e.empty_display_type = "ARROWS"
            e.empty_display_size = 0.04
            col.objects.link(e)
            e.parent = ob
            Mb = np.eye(4)
            Mb[:3, :3] = K @ np.asarray(Mg)[:3, :3] @ K.T
            Mb[:3, 3] = K @ np.asarray(Mg)[:3, 3]
            e.matrix_parent_inverse = Matrix.Identity(4)
            e.matrix_basis = Matrix(Mb.tolist())
            objs.append(e)
    # lay them out in a row for viewing (the GLB keeps each prop's own origin as its node origin)
    for i, ob in enumerate([o for o in objs if o.type == "MESH"]):
        ob.location = (i * 0.4 - 0.6, 0.0, 1.0)
    bpy.context.view_layer.update()
    export_glb(path, objs, animations=False)
    return objs
