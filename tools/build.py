"""Gamboligy character-base pipeline CLI (Blender 4.2 as a Python module, or inside Blender).

  python tools/build.py all                       # full reproducible pipeline (layout, master, stocky, diag)
  python tools/build.py layout                    # compute + freeze UV layout v1 (once per template topology)
  python tools/build.py build <id> [--params p.json] [--name "Display"] [--force]
  python tools/build.py freeze <id>
  python tools/build.py texture <source_id> <new_id> --image baked.png
  python tools/build.py props                     # shared weapon props (props/weapons.glb/.json)
  python tools/build.py update-clips <id>         # re-bake the clip library onto an existing/frozen character
  python tools/build.py images                    # UV layout / checker / diagnostic textures

Inside a Blender install instead of the pip module:
  blender --background --python tools/build.py -- all
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from cbase import GEOMETRY_TOPOLOGY_VERSION, TEMPLATE_ID, TEMPLATE_VERSION  # noqa: E402
from cbase import config as C  # noqa: E402
from cbase.params import DESCRIPTIONS, RANGES, resolve  # noqa: E402
from cbase.skeleton import BEND_CONVENTION, DRIVERS, build_skeleton, socket_defs  # noqa: E402
from cbase.collide import BodyProxy  # noqa: E402

UV_VERSION = 1
CLIP_SET_VERSION = 5          # bump when clip recipes change; frozen characters get `update-clips`
SKIN_VERSION = 2              # bump when skin weights change; `update-clips` re-skins frozen characters (geometry/UVs untouched)
STOCKY = {"height": 1.68, "headSize": 1.03, "shoulderWidth": 1.08, "torsoWidth": 1.16, "torsoDepth": 1.14,
          "bellySize": 1.55, "armLength": 0.96, "legLength": 0.92, "handSize": 1.07, "footSize": 1.05}
# body-type bases on the same template (topology, UVs, skeleton names, clips) for meshing clothing/armour later
WOMAN = {"height": 1.68, "headSize": 0.97, "shoulderWidth": 0.87, "torsoWidth": 0.9, "torsoDepth": 0.92,
         "bellySize": 0.75, "armLength": 0.97, "legLength": 1.04, "handSize": 0.88, "footSize": 0.88,
         "hipWidth": 1.14, "waistWidth": 0.92, "bustSize": 1.1, "limbGirth": 0.92}
DWARF = {"height": 1.35, "headSize": 1.22, "shoulderWidth": 1.25, "torsoWidth": 1.3, "torsoDepth": 1.3,
         "bellySize": 1.7, "armLength": 0.9, "legLength": 0.8, "handSize": 1.25, "footSize": 1.2, "limbGirth": 1.2}
BASES = (("master_blank", {}, "Master blank", "master"),
         ("woman_blank", WOMAN, "Woman base", "base"),
         ("dwarf_blank", DWARF, "Dwarf base", "base"),
         ("stocky_test", STOCKY, "Stocky test variant", "draft"))


def _geometry(params):
    from cbase.mesh import build_mesh
    from cbase.weights import compute_weights
    p = resolve(params)
    sk = build_skeleton(p)
    m = build_mesh(sk, p)
    names, W = compute_weights(m, sk)
    return p, sk, m, names, W


def part_hash(me):
    h = hashlib.sha256()
    co = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)
    h.update(co.tobytes())
    uv = np.zeros(len(me.loops) * 2, np.float32)
    me.uv_layers[0].data.foreach_get("uv", uv)
    h.update(uv.tobytes())
    lv = np.zeros(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    h.update(lv.tobytes())
    return h.hexdigest()


def cmd_layout(args):
    import bpy
    from cbase import uvlayout
    bpy.ops.wm.read_factory_settings(use_empty=True)
    p, sk, m, names, W = _geometry({})
    uv, info = uvlayout.compute_layout(m)
    from cbase import textures
    isl = uvlayout.islands(m.faces, m.face_part, uvlayout.all_seams(m))
    ids, overlap = textures.island_mask_ids(m, uv, isl, uvlayout.ATLAS)
    clash = textures.padding_report(ids, uvlayout.PAD_PX)
    q = {"islands": len(isl), "overlapPixels": overlap, "coverage": round(float((ids > 0).mean()), 4),
         "minGapPx": f">{uvlayout.PAD_PX}" if clash is None else clash,
         "texelDensityPxPerM": textures.part_texel_density(m, uv)}
    if overlap or clash is not None:
        raise RuntimeError(f"UV layout failed checks: {q}")
    meta = uvlayout.save_layout(ROOT, UV_VERSION, uv, m, {"quality": q, "islandInfo": info["islands"],
                                                          "density": info["density"],
                                                          "computedFrom": "master_blank topology (default proportions)"})
    print("UV layout frozen:", json.dumps(q))
    return meta


def cmd_images(args):
    from cbase import textures, uvlayout
    p, sk, m, names, W = _geometry({})
    uv, meta = uvlayout.load_layout(ROOT, UV_VERSION, m)
    out = os.path.join(ROOT, "textures")
    os.makedirs(out, exist_ok=True)
    textures.uv_layout_image(m, uv, title=f"{uvlayout.LAYOUT_ID} v{UV_VERSION}").save(os.path.join(out, "uv_layout_v1_2048.png"))
    textures.checker_image().save(os.path.join(out, "uv_checker_2048.png"))
    img, _ = textures.diagnostic_image(m, uv)
    img.save(os.path.join(out, "diagnostic_basecolor_2048.png"))
    # part-ID colour legend (shared with the masks)
    with open(os.path.join(out, "part_id_colors.json"), "w") as fh:
        json.dump({k: "#%02x%02x%02x" % v for k, v in textures.PART_ID_COLORS.items()}, fh, indent=1)
    print("images written to", out)


def load_prop_markers():
    from cbase.props import props_json_path
    p = props_json_path(ROOT)
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        d = json.load(fh)
    return {k: v["markers"] for k, v in d["props"].items()}


def all_character_clips(rig, props, socks, body=None):
    """body: collide.BodyProxy of the character's own skinned mesh (keeps held props out of it)."""
    from cbase import clips as CL
    from cbase import clips_more as CM
    clips = CL.all_clips(rig, props, socks)
    more, _ = CM.more_clips(rig, socks, load_prop_markers(), body)
    clips.update(more)
    return clips


def cmd_props(args):
    """Shared weapon props: fit the support-hand grip markers once on the master rig, then export
    props/weapons.glb + props/weapons.json (every character's clips reuse these markers)."""
    from cbase import blender_build as BB
    from cbase import clips_more as CM
    from cbase.poses import Rig
    from cbase.props import build_blender_props, save_markers
    BB.reset_scene()
    sk = build_skeleton(resolve({}))
    _, specs = CM.weapon_clips(Rig(sk), socket_defs(sk))
    save_markers(ROOT, specs, {"fittedOn": "master_blank rest skeleton", "created": C.now()})
    build_blender_props(specs, os.path.join(ROOT, "props", "weapons.glb"))
    print("props written:", ", ".join(specs))


def anim_meta(clips):
    from cbase.clips import FPS
    return [{"name": n, "frames": len(f), "fps": FPS, "duration": round((len(f) - 1) / FPS, 4), **m}
            for n, (f, m) in clips.items()]


def cmd_update_clips(args):
    """Re-bake the clip library onto an existing (possibly frozen) character WITHOUT touching its
    geometry, UVs or skeleton: open its .blend, verify hashes, replace actions, re-export. When the
    character's skin version is older than SKIN_VERSION its vertex weights are replaced too (the
    part meshes and UVs are verified byte-identical before and after)."""
    import bpy
    from cbase import blender_build as BB
    from cbase import clips as CL
    from cbase.poses import Rig
    cid = args.id
    cfg = C.load_config(ROOT, cid)
    if cfg is None:
        raise SystemExit(f"unknown character {cid}")
    d = C.char_dir(ROOT, cid)
    blend = os.path.join(d, cfg["files"]["blend"])
    if cfg.get("frozen") and C.sha256_file(blend) != cfg["freezeRecord"]["blendSha256"]:
        raise SystemExit(".blend changed since the last recorded state; refusing")
    bpy.ops.wm.open_mainfile(filepath=blend)
    bpy.context.preferences.filepaths.save_version = 0
    for prt in cfg["geometry"]["parts"]:
        if part_hash(bpy.data.objects[prt["name"]].data) != prt["hash"]:
            raise SystemExit(f"part {prt['name']} geometry/UV hash mismatch; refusing")
    p = resolve(cfg["proportions"])
    sk = build_skeleton(p)
    if C.skeleton_hash(sk) != cfg["skeleton"]["hash"]:
        raise SystemExit("skeleton rebuilt from the recorded proportions does not match the frozen rig; refusing")
    rig = Rig(sk)
    socks = socket_defs(sk)
    # the collision body is rebuilt from the recorded proportions and must be the frozen geometry
    _, _, m, names, W = _geometry(cfg["proportions"])
    if C.geometry_hash(m) != cfg["geometry"]["hash"]:
        raise SystemExit("mesh rebuilt from the recorded proportions does not match the frozen geometry; refusing")
    props = CL.prop_layout(sk)
    skin_old = (cfg.get("skin") or {}).get("version", 1)
    if skin_old < SKIN_VERSION:
        reskin_parts(m, names, W)
        for prt in cfg["geometry"]["parts"]:
            if part_hash(bpy.data.objects[prt["name"]].data) != prt["hash"]:
                raise SystemExit(f"re-skin changed part {prt['name']} geometry/UVs; refusing")
        cfg["skeleton"]["weightsHash"] = C.weights_hash(W)
        cfg["skin"] = {"version": SKIN_VERSION}
        cfg.setdefault("skinRevisions", []).append(
            {"date": C.now(), "from": skin_old, "to": SKIN_VERSION, "weightsHash": cfg["skeleton"]["weightsHash"],
             "note": "vertex weights replaced (shoulder/armpit field); geometry, UVs and skeleton verified unchanged"})
        print(f"re-skinned {cid}: skin v{skin_old} -> v{SKIN_VERSION}")
    clips = all_character_clips(rig, props, socks, BodyProxy(rig, m, names, W))
    arm = bpy.data.objects[BB.ARMATURE]
    if arm.animation_data:
        for tr in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(tr)
        arm.animation_data.action = None
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    for name, (frames, meta) in clips.items():
        BB.bake_action(arm, rig, name, frames, meta)
    bpy.context.scene.frame_end = max(len(f) for f, _ in clips.values()) - 1
    objs = [arm] + [bpy.data.objects[q["name"]] for q in cfg["geometry"]["parts"]] + \
           [bpy.data.objects[k] for k in cfg["attachments"]]
    glb = os.path.join(d, cfg["files"]["glb"])
    BB.export_glb(glb, objs, animations=True)
    # test props follow the clip set (the pedestal button was replaced by the hand-held detonator)
    old = bpy.data.collections.get("TestProps")
    if old:
        for o in list(old.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.collections.remove(old)
    prop_col = BB.make_test_props(props)
    BB.export_glb(os.path.join(d, cfg["files"]["testProps"]), list(prop_col.objects), animations=False)
    cfg["testProps"] = test_props_cfg(props)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    info = C.inspect_glb(glb)
    cfg["animations"] = anim_meta(clips)
    cfg["animationSet"] = {"version": CLIP_SET_VERSION, "clips": list(clips), "weaponProps": "props/weapons.glb"}
    cfg["exportCheck"] = info
    cfg["files"]["glbSha256"] = C.sha256_file(glb)
    rev = {"date": C.now(), "clipSetVersion": CLIP_SET_VERSION, "clips": len(clips),
           "geometryHash": cfg["geometry"]["hash"], "note": "animations re-baked; geometry/UV/skin/skeleton verified unchanged"}
    cfg.setdefault("animationRevisions", []).append(rev)
    if cfg.get("frozen"):
        cfg["freezeRecord"]["glbSha256"] = cfg["files"]["glbSha256"]
        cfg["freezeRecord"]["blendSha256"] = C.sha256_file(blend)
    C.write_config(ROOT, cid, cfg)
    write_index()
    print(f"updated clips on {cid}: {len(clips)} clips -> {[a['name'] for a in info['animations']]}")


def reskin_parts(m, names, W):
    """Replace the vertex groups of the existing part objects (vertex i of a part = the i-th smallest
    template vertex of that part, as created by blender_build.make_parts)."""
    import bpy
    from cbase.mesh import PART_ORDER
    for part in PART_ORDER:
        ob = bpy.data.objects[part]
        verts = sorted({v for f, pt in zip(m.faces, m.face_part) if pt == part for v in f})
        if len(verts) != len(ob.data.vertices):
            raise SystemExit(f"part {part}: vertex count differs from the template; refusing")
        ob.vertex_groups.clear()
        Wp = W[verts]
        for j, bn in enumerate(names):
            nz = np.nonzero(Wp[:, j] > 0)[0]
            if len(nz) == 0:
                continue
            vg = ob.vertex_groups.new(name=bn)
            for vi in nz:
                vg.add([int(vi)], float(Wp[vi, j]), "REPLACE")


def test_props_cfg(props):
    return {"file": "test_props.glb",
            "handle": {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in props["handle"].items()},
            "note": "Placement in Blender world coords (Z up); the GLB is Y-up. Hand-held props (weapons, "
                    "detonator) live in props/weapons.glb."}


def build_character(cid, params, display=None, texture=None, force=False, derived=None, status="draft"):
    import bpy
    from mathutils import Matrix  # noqa: F401
    from cbase import blender_build as BB
    from cbase import clips as CL
    from cbase import uvlayout
    from cbase.poses import Rig

    C.assert_writable(ROOT, cid, force)
    BB.reset_scene()
    p, sk, m, names, W = _geometry(params)
    uv, uvmeta = uvlayout.load_layout(ROOT, UV_VERSION, m)
    rig = Rig(sk)
    socks = socket_defs(sk)
    props = CL.prop_layout(sk)
    arm = BB.make_armature(sk)
    mat = BB.make_material(texture)
    parts = BB.make_parts(m, uv, names, W, arm, mat)
    sock_objs = BB.make_sockets(socks, arm)
    clips = all_character_clips(rig, props, socks, BodyProxy(rig, m, names, W))
    anim_info = []
    for name, (frames, meta) in clips.items():
        BB.bake_action(arm, rig, name, frames, meta)
        anim_info.append({"name": name, "frames": len(frames), "fps": CL.FPS,
                          "duration": round((len(frames) - 1) / CL.FPS, 4), **meta})
    anim_set = {"version": CLIP_SET_VERSION, "clips": list(clips), "weaponProps": "props/weapons.glb"}
    prop_col = BB.make_test_props(props)
    d = C.char_dir(ROOT, cid)
    os.makedirs(d, exist_ok=True)
    glb = os.path.join(d, f"{cid}.glb")
    char_objs = [arm] + [o for o, _ in parts.values()] + list(sock_objs.values())
    BB.export_glb(glb, char_objs, animations=True)
    props_glb = os.path.join(d, "test_props.glb")
    BB.export_glb(props_glb, list(prop_col.objects), animations=False)
    blend = os.path.join(d, f"{cid}.blend")
    bpy.context.scene.frame_end = max(len(f) for f, _ in clips.values()) - 1
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    info = C.inspect_glb(glb)
    tris = sum(len(f) - 2 for f in m.faces)
    cfg = {
        "schema": C.SCHEMA,
        "characterId": cid,
        "displayName": display or cid,
        "status": status,
        "frozen": False,
        "created": C.now(),
        "template": {"id": TEMPLATE_ID, "version": TEMPLATE_VERSION, "topologyVersion": GEOMETRY_TOPOLOGY_VERSION,
                     "topologyHash": m.topology_hash},
        "derivedFrom": derived,
        "proportions": {k: round(v, 4) for k, v in p.items()},
        "proportionRanges": RANGES,
        "proportionDescriptions": DESCRIPTIONS,
        "coordinateSystem": {"units": "metres", "up": "+Y", "forward": "+Z (character faces +Z)",
                             "characterLeft": "+X", "authoring": "Blender +Z up, faces -Y; converted on export"},
        "geometry": {"hash": C.geometry_hash(m), "templateVertices": int(len(m.V)), "triangles": int(tris),
                     "subdivisionLevels": 2, "fitError": [float(x) for x in m.fit_error],
                     "parts": [{"name": pt, "vertices": len(v), "hash": part_hash(o.data)}
                               for pt, (o, v) in parts.items()]},
        "uvLayout": {"id": uvmeta["id"], "version": uvmeta["version"], "sha256": uvmeta["sha256"],
                     "atlas": uvmeta["atlas"], "paddingPx": uvmeta["paddingPx"],
                     "file": f"template/uv/{uvmeta['id']}_v{uvmeta['version']}.bin",
                     "layoutImage": "textures/uv_layout_v1_2048.png", "shared": True,
                     "note": "Shared by every character built on this template; never regenerated."},
        "skeleton": {"hash": C.skeleton_hash(sk), "weightsHash": C.weights_hash(W), "maxInfluences": 4,
                     "bones": [{"name": b, "parent": sk[b].parent, "deform": sk[b].deform,
                                "length": round(sk[b].length, 5),
                                **({"driven": {"source": DRIVERS[b][0], "mode": DRIVERS[b][1]}} if b in DRIVERS else {})}
                               for b in sk.order],
                     "bendConvention": BEND_CONVENTION,
                     "driverRules": {"half": "basis = slerp(identity, source.basis, 0.5); helper shares the source's "
                                             "parent-relative rest frame",
                                     "twist_half": "basis = rotation about +Y by 50% of the source's swing-twist angle about +Y"},
                     "exportedJoints": info["joints"]},
        "attachments": {k: {"parentBone": v["parent"], "doc": v["doc"],
                            "gltfNode": info["sockets"].get(k)} for k, v in socks.items()},
        "material": {"name": BB.MATERIAL, "mode": "texture" if texture else "blank",
                     "baseColorFactor": list(BB.BLANK_RGBA) if not texture else [1, 1, 1, 1],
                     "roughness": 0.85, "metallic": 0.0,
                     "baseColorTexture": None},
        "animations": anim_info,
        "animationSet": anim_set,
        "skin": {"version": SKIN_VERSION},
        "testProps": test_props_cfg(props),
        "files": {"glb": f"{cid}.glb", "blend": f"{cid}.blend", "testProps": "test_props.glb"},
        "exportCheck": info,
    }
    cfg["files"]["glbSha256"] = C.sha256_file(glb)
    C.write_config(ROOT, cid, cfg)
    write_index()
    print(f"built {cid}: {tris} tris, {info['joints']} joints, parts {len(info['meshNodes'])}, "
          f"anims {[a['name'] for a in info['animations']]}")
    return cfg


def write_index():
    """characters/index.json: what the viewer lists (id, files, status)."""
    base = os.path.join(ROOT, "characters")
    out = []
    for cid in sorted(os.listdir(base)):
        cfg = C.load_config(ROOT, cid)
        if not cfg:
            continue
        out.append({"id": cid, "displayName": cfg["displayName"], "status": cfg["status"], "frozen": cfg.get("frozen", False),
                    "glb": cfg["files"]["glb"], "config": f"{cid}.character.json", "props": cfg["files"].get("testProps")})
    order = {"master_blank": 0, "woman_blank": 1, "dwarf_blank": 2, "stocky_test": 3, "diag_textured_test": 4}
    out.sort(key=lambda e: (order.get(e["id"], 9), e["id"]))
    with open(os.path.join(base, "index.json"), "w") as fh:
        json.dump({"characters": out}, fh, indent=1)


def cmd_build(args):
    params = {}
    if args.params:
        with open(args.params) as fh:
            params = json.load(fh)
    return build_character(args.id, params, args.name, force=args.force,
                           status="master" if args.id == "master_blank" else "draft")


def cmd_freeze(args):
    cfg = C.load_config(ROOT, args.id)
    if cfg is None:
        raise SystemExit(f"unknown character {args.id}")
    if cfg.get("frozen"):
        print(f"{args.id} already frozen")
        return cfg
    cfg["frozen"] = True
    cfg["frozenAt"] = C.now()
    if cfg["status"] == "draft":
        cfg["status"] = "frozen"
    cfg["freezeRecord"] = {"geometryHash": cfg["geometry"]["hash"], "uvSha256": cfg["uvLayout"]["sha256"],
                           "glbSha256": C.sha256_file(os.path.join(C.char_dir(ROOT, args.id), cfg["files"]["glb"])),
                           "blendSha256": C.sha256_file(os.path.join(C.char_dir(ROOT, args.id), cfg["files"]["blend"]))}
    C.write_config(ROOT, args.id, cfg)
    write_index()
    print(f"froze {args.id}")
    return cfg


def cmd_texture(args):
    """Apply a baked base-colour texture to a FROZEN character without regenerating anything."""
    import bpy
    from cbase import blender_build as BB
    src = C.load_config(ROOT, args.source)
    if src is None or not src.get("frozen"):
        raise SystemExit("texture application requires a frozen source character (run: build.py freeze <id>)")
    C.assert_writable(ROOT, args.new_id, args.force)
    sdir = C.char_dir(ROOT, args.source)
    if C.sha256_file(os.path.join(sdir, src["files"]["blend"])) != src["freezeRecord"]["blendSha256"]:
        raise SystemExit("source .blend changed since it was frozen; refusing to texture it")
    bpy.ops.wm.open_mainfile(filepath=os.path.join(sdir, src["files"]["blend"]))
    bpy.context.preferences.filepaths.save_version = 0
    # verify geometry + UVs are bit-identical to the frozen record
    for prt in src["geometry"]["parts"]:
        me = bpy.data.objects[prt["name"]].data
        if part_hash(me) != prt["hash"]:
            raise SystemExit(f"part {prt['name']} geometry/UV hash mismatch; refusing")
    ddir = C.char_dir(ROOT, args.new_id)
    os.makedirs(os.path.join(ddir, "textures"), exist_ok=True)
    tex_name = "basecolor.png"
    tex_dst = os.path.join(ddir, "textures", tex_name)
    shutil.copyfile(args.image, tex_dst)
    mat = bpy.data.materials[BB.MATERIAL]
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    img = bpy.data.images.load(tex_dst)
    img.name = tex_name
    texn = nt.nodes.new("ShaderNodeTexImage")
    texn.image = img
    nt.links.new(texn.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    arm = bpy.data.objects[BB.ARMATURE]
    objs = [arm] + [bpy.data.objects[p["name"]] for p in src["geometry"]["parts"]] + \
           [bpy.data.objects[k] for k in src["attachments"]]
    glb = os.path.join(ddir, f"{args.new_id}.glb")
    BB.export_glb(glb, objs, animations=True)
    shutil.copyfile(os.path.join(sdir, src["files"]["testProps"]), os.path.join(ddir, "test_props.glb"))
    # save under the new name first, THEN point the image at "//textures/..." (relative to the new .blend) and
    # save again; setting it while the source .blend is still open would resolve it next to the source
    img.filepath = os.path.abspath(tex_dst)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ddir, f"{args.new_id}.blend"), compress=True)
    img.filepath = "//textures/" + tex_name
    bpy.ops.wm.save_mainfile(compress=True)
    info = C.inspect_glb(glb)
    cfg = json.loads(json.dumps(src))
    cfg.update({"characterId": args.new_id, "displayName": args.name or args.new_id, "status": "textured",
                "frozen": False, "created": C.now(),
                "derivedFrom": {"characterId": args.source, "geometryHash": src["geometry"]["hash"],
                                "glbSha256": src["freezeRecord"]["glbSha256"],
                                "operation": "baked base-colour texture applied; geometry/UV/skeleton/clips unchanged"}})
    cfg.pop("freezeRecord", None)
    cfg.pop("frozenAt", None)
    cfg["material"] = {"name": BB.MATERIAL, "mode": "texture", "baseColorFactor": [1, 1, 1, 1],
                       "roughness": 0.85, "metallic": 0.0,
                       "baseColorTexture": {"uri": f"textures/{tex_name}", "sha256": C.sha256_file(tex_dst),
                                            "embeddedInGlb": True, "colorSpace": "sRGB", "texCoord": 0,
                                            "sourceImage": os.path.relpath(os.path.abspath(args.image), ROOT)}}
    cfg["files"] = {"glb": f"{args.new_id}.glb", "blend": f"{args.new_id}.blend", "testProps": "test_props.glb",
                    "glbSha256": C.sha256_file(glb)}
    cfg["exportCheck"] = info
    C.write_config(ROOT, args.new_id, cfg)
    write_index()
    print(f"textured {args.new_id} from {args.source}: images {info['images']}")
    return cfg


def cmd_all(args):
    from cbase import uvlayout
    if not os.path.exists(uvlayout.layout_paths(ROOT, UV_VERSION)[0]):
        cmd_layout(args)
    cmd_images(args)
    if not os.path.exists(os.path.join(ROOT, "props", "weapons.json")):
        cmd_props(args)
    os.makedirs(os.path.join(ROOT, "template", "presets"), exist_ok=True)
    with open(os.path.join(ROOT, "template", "presets", "master_blank.json"), "w") as fh:
        json.dump({}, fh)
    for cid, params, _, _ in BASES[1:]:
        with open(os.path.join(ROOT, "template", "presets", f"{cid}.json"), "w") as fh:
            json.dump(params, fh, indent=1)
    for cid, params, name, status in BASES:
        cfg = C.load_config(ROOT, cid)
        if cfg and cfg.get("frozen"):
            if (cfg.get("animationSet") or {}).get("version") != CLIP_SET_VERSION or \
                    (cfg.get("skin") or {}).get("version", 1) != SKIN_VERSION:
                print(f"{cid} is frozen – re-baking its clips (and re-skinning if needed) only")
                cmd_update_clips(argparse.Namespace(id=cid))
            else:
                print(f"{cid} is frozen – kept as is")
            continue
        build_character(cid, params, name, status=status)
        cmd_freeze(argparse.Namespace(id=cid))
    if not (C.load_config(ROOT, "diag_textured_test") or {}).get("frozen"):
        cmd_texture(argparse.Namespace(source="stocky_test", new_id="diag_textured_test", force=True,
                                       image=os.path.join(ROOT, "textures", "diagnostic_basecolor_2048.png"),
                                       name="Stocky variant + diagnostic texture"))


def main(argv):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("all")
    sub.add_parser("layout")
    sub.add_parser("images")
    sub.add_parser("props")
    u = sub.add_parser("update-clips")
    u.add_argument("id")
    b = sub.add_parser("build")
    b.add_argument("id")
    b.add_argument("--params")
    b.add_argument("--name")
    b.add_argument("--force", action="store_true")
    f = sub.add_parser("freeze")
    f.add_argument("id")
    t = sub.add_parser("texture")
    t.add_argument("source")
    t.add_argument("new_id")
    t.add_argument("--image", required=True)
    t.add_argument("--name")
    t.add_argument("--force", action="store_true")
    a = ap.parse_args(argv)
    {"all": cmd_all, "layout": cmd_layout, "images": cmd_images, "build": cmd_build,
     "freeze": cmd_freeze, "texture": cmd_texture, "props": cmd_props, "update-clips": cmd_update_clips}[a.cmd](a)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(argv)
    # bpy-as-a-module can crash while tearing down after an export; all outputs are written by now
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(0)
