"""Blender scene assembly and export (runs inside Blender / the `bpy` module)."""
import os

import bpy
import numpy as np

from .clips import FPS
from .mesh import PART_ORDER
from .poses import quat_from_matrix
from .skeleton import DRIVERS

ARMATURE = "Rig"
MATERIAL = "M_Body"
BLANK_RGBA = (0.55, 0.55, 0.55, 1.0)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0      # no .blend1 backups
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.unit_settings.system = "METRIC"
    return sc


def make_armature(sk):
    arm = bpy.data.armatures.new(ARMATURE)
    ob = bpy.data.objects.new(ARMATURE, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    arm.display_type = "OCTAHEDRAL"
    ob.show_in_front = True
    bpy.ops.object.mode_set(mode="EDIT")
    for name in sk.order:
        b = sk[name]
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = b.head.tolist(), b.tail.tolist()
        eb.align_roll(b.frame()[:, 2].tolist())
        eb.use_deform = b.deform
        eb.use_connect = False
    for name in sk.order:
        if sk[name].parent:
            arm.edit_bones[name].parent = arm.edit_bones[sk[name].parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    # verify Blender's bone frames equal ours (roll convention)
    worst = 0.0
    for name in sk.order:
        M = np.array(arm.bones[name].matrix_local)
        worst = max(worst, float(np.abs(M - sk[name].matrix()).max()))
    if worst > 1e-4:
        raise RuntimeError(f"bone frame mismatch vs. template skeleton: {worst}")
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    # driven helpers: keep them visibly distinct
    for name in DRIVERS:
        if name in arm.bones:
            arm.bones[name].hide = False
    return ob


def make_material(texture_path=None, name=MATERIAL):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = BLANK_RGBA
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    if texture_path:
        img = bpy.data.images.load(os.path.abspath(texture_path))
        img.name = os.path.basename(texture_path)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.interpolation = "Linear"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def make_parts(m, uv, names, W, arm_ob, mat):
    """One mesh object per body part, all skinned to the same armature."""
    starts = np.cumsum([0] + [len(f) for f in m.faces])[:-1]
    objs = {}
    for part in PART_ORDER:
        fids = [i for i, p in enumerate(m.face_part) if p == part]
        verts = sorted({v for f in fids for v in m.faces[f]})
        remap = {v: i for i, v in enumerate(verts)}
        me = bpy.data.meshes.new(part)
        me.from_pydata(m.V[verts].tolist(), [], [[remap[v] for v in m.faces[f]] for f in fids])
        me.update()
        uvl = me.uv_layers.new(name="UVMap")
        corner = np.concatenate([np.arange(starts[f], starts[f] + len(m.faces[f])) for f in fids])
        uvl.data.foreach_set("uv", uv[corner].astype(np.float32).ravel())
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        me.normals_split_custom_set_from_vertices(m.N[verts].tolist())
        me.materials.append(mat)
        ob = bpy.data.objects.new(part, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = arm_ob
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = arm_ob
        Wp = W[verts]
        for j, bn in enumerate(names):
            col = Wp[:, j]
            nz = np.nonzero(col > 0)[0]
            if len(nz) == 0:
                continue
            vg = ob.vertex_groups.new(name=bn)
            for vi in nz:
                vg.add([int(vi)], float(col[vi]), "REPLACE")
        ob["unified_vertex_ids_note"] = "vertex i of this part = template vertex verts[i] (sorted)"
        objs[part] = (ob, verts)
    return objs


def make_sockets(sockets, arm_ob):
    out = {}
    for name, sdef in sockets.items():
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = "ARROWS"
        e.empty_display_size = 0.06
        bpy.context.scene.collection.objects.link(e)
        e.parent = arm_ob
        e.parent_type = "BONE"
        e.parent_bone = sdef["parent"]
        bpy.context.view_layer.update()
        # glTF-semantic axes (x, y=up/along, z=forward/out) -> Blender object axes (x, -z, y)
        M = np.eye(4)
        M[:3, 0] = sdef["x"]
        M[:3, 1] = -np.asarray(sdef["z"])
        M[:3, 2] = sdef["y"]
        M[:3, 3] = sdef["pos"]
        from mathutils import Matrix
        e.matrix_world = Matrix(M.tolist())
        e["doc"] = sdef["doc"]
        out[name] = e
    bpy.context.view_layer.update()
    return out


def bake_action(arm_ob, rig, name, frames, meta):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    act.id_root = "OBJECT"
    n = len(frames)
    fr = np.arange(n, dtype=np.float32)
    for bn in rig.order:
        qs = []
        prev = None
        for p in frames:
            R = rig.driven_rotation(p, bn) if bn in DRIVERS else p.rot.get(bn, np.eye(3))
            q = quat_from_matrix(R)
            if prev is not None and np.dot(q, prev) < 0:
                q = -q
            qs.append(q)
            prev = q
        qs = np.array(qs)
        path = f'pose.bones["{bn}"].rotation_quaternion'
        for i in range(4):
            fc = act.fcurves.new(path, index=i, action_group=bn)
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", np.stack([fr, qs[:, i]], 1).ravel())
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
        if bn in ("root", "pelvis"):
            locs = np.array([p.loc.get(bn, np.zeros(3)) for p in frames])
            path = f'pose.bones["{bn}"].location'
            for i in range(3):
                fc = act.fcurves.new(path, index=i, action_group=bn)
                fc.keyframe_points.add(n)
                fc.keyframe_points.foreach_set("co", np.stack([fr, locs[:, i]], 1).ravel())
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
    act.frame_range = (0, n - 1)
    act["clip_meta"] = str(meta)
    if arm_ob.animation_data is None:
        arm_ob.animation_data_create()
    track = arm_ob.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    strip.name = name
    track.mute = True
    return act


def export_glb(path, objects=None, animations=True):
    bpy.ops.object.select_all(action="DESELECT")
    kw = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=False,
              export_texcoords=True, export_normals=True, export_tangents=False,
              export_materials="EXPORT", export_image_format="AUTO",
              export_skins=True, export_all_influences=False, export_influence_nb=4, export_def_bones=False,
              export_animations=animations, export_extras=True, export_cameras=False, export_lights=False)
    if animations:
        kw.update(export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_step=1,
                  export_optimize_animation_size=False, export_reset_pose_bones=True,
                  export_anim_single_armature=True, export_bake_animation=False)
    if objects is not None:
        for o in objects:
            o.select_set(True)
        kw["use_selection"] = True
    bpy.ops.export_scene.gltf(**kw)


def make_test_props(props):
    """Simple test props in their own collection (exported to test_props.glb)."""
    import bmesh
    col = bpy.data.collections.new("TestProps")
    bpy.context.scene.collection.children.link(col)
    mat_h = bpy.data.materials.new("M_TestProp_Handle")
    mat_h.use_nodes = True
    mat_h.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.85, 0.55, 0.12, 1)
    mat_p = bpy.data.materials.new("M_TestProp_Base")
    mat_p.use_nodes = True
    mat_p.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.3, 0.32, 0.36, 1)

    def obj(name, bm, mat, loc):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        for poly in me.polygons:
            poly.use_smooth = True
        o = bpy.data.objects.new(name, me)
        o.location = [float(x) for x in loc]
        col.objects.link(o)
        return o
    h = props["handle"]
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=h["radius"], radius2=h["radius"], depth=h["length"])
    handle = obj("TestHandle", bm, mat_h, h["center"])
    for sgn in (-1, 1):
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(h["radius"] * 2.6, h["radius"] * 2.6, h["radius"] * 1.2), verts=bm.verts)
        c = h["center"] + h["axis"] * sgn * (h["length"] / 2 + h["radius"] * 0.6)
        o = obj(f"TestHandle_Mount{'Top' if sgn > 0 else 'Bottom'}", bm, mat_p, c)
    handle["grip_radius"] = float(h["radius"])
    return col
