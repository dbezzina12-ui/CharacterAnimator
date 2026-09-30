"""UV layout: computed ONCE per template topology in Blender, then frozen and versioned.

Every proportion variant shares the template's topology (same vertex/face order), so the
frozen layout is simply re-applied by face-corner index. It is never regenerated for an
existing variant; a new layout requires a new layout version (and invalidates baked art).

Storage: template/uv/<id>_v<N>.bin  (float32 corner UVs, face-corner order)
         template/uv/<id>_v<N>.json (metadata: topology hash, atlas, padding, sha256, islands)
"""
import hashlib
import json
import os

import numpy as np

LAYOUT_ID = "humanoid_uv"
ATLAS = 2048
PAD_PX = 8                 # minimum gap between islands in pixels at 2048
# relative linear texel density per island group (1.0 = body)
DENSITY = {"face": 2.0, "scalp": 1.25, "ear": 1.35, "hand": 1.5, "foot": 0.95, "body": 1.0, "neck": 1.1}


def corner_count(faces):
    return sum(len(f) for f in faces)


def islands(faces, face_part, seams):
    """Connected face sets not crossing seams or part boundaries."""
    edge_faces = {}
    for fi, f in enumerate(faces):
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            edge_faces.setdefault((min(a, b), max(a, b)), []).append(fi)
    parent = list(range(len(faces)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    for e, fs in edge_faces.items():
        if e in seams or len(fs) != 2:
            continue
        a, b = fs
        if face_part[a] != face_part[b]:
            continue
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    groups = {}
    for fi in range(len(faces)):
        groups.setdefault(find(fi), []).append(fi)
    return sorted(groups.values(), key=lambda g: g[0])


def island_group(m, fids):
    part = m.face_part[fids[0]]
    regs = {m.face_region[f] for f in fids}
    if part == "Head":
        if any(r.startswith("ear_") for r in regs):
            return "ear"
        C = m.cage.head_center
        cen = np.mean([m.V[list(m.faces[f])].mean(0) for f in fids], axis=0)
        return "face" if cen[1] < C[1] - 0.02 else "scalp"
    if part.startswith("Hand"):
        return "hand"
    if part.startswith("Foot"):
        return "foot"
    if part == "Neck":
        return "neck"
    return "body"


def all_seams(m):
    seams = set(m.seams)
    edge_parts = {}
    for f, pt in zip(m.faces, m.face_part):
        for i in range(len(f)):
            a, b = f[i], f[(i + 1) % len(f)]
            edge_parts.setdefault((min(a, b), max(a, b)), set()).add(pt)
    for e, pts in edge_parts.items():
        if len(pts) > 1:
            seams.add(e)
    return seams


def compute_layout(m):
    """Unwrap + orient + density-scale + pack in Blender. Returns (uv (n_corners,2) float32, info)."""
    import bmesh
    import bpy

    seams = all_seams(m)
    me = bpy.data.meshes.new("_uv_tmp")
    me.from_pydata(m.V.tolist(), [], [list(f) for f in m.faces])
    me.update()
    ob = bpy.data.objects.new("_uv_tmp", me)
    bpy.context.scene.collection.objects.link(ob)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    for e in me.edges:
        a, b = e.vertices
        e.use_seam = (min(a, b), max(a, b)) in seams
    me.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", fill_holes=True, correct_aspect=True, margin=0.0)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = np.zeros((len(me.loops), 2))
    me.uv_layers.active.data.foreach_get("uv", uv.ravel())
    # corner index for face f, corner k
    starts = np.cumsum([0] + [len(f) for f in m.faces])[:-1]
    isl = islands(m.faces, m.face_part, seams)
    info_islands = []
    for fids in isl:
        corners = np.concatenate([np.arange(starts[f], starts[f] + len(m.faces[f])) for f in fids])
        verts = np.concatenate([list(m.faces[f]) for f in fids])
        P = m.V[verts]
        U = uv[corners]
        grp = island_group(m, fids)
        # orientation: map 3D up (or forward for flat-lying islands) to +V
        Pc, Uc = P - P.mean(0), U - U.mean(0)
        A, *_ = np.linalg.lstsq(Pc, Uc, rcond=None)      # (3,2): uv = p @ A
        up = np.array([0, 0, 1.0]) @ A
        fw = np.array([0, -1.0, 0]) @ A
        d = up if np.linalg.norm(up) > 0.6 * np.linalg.norm(fw) else fw
        ang = np.arctan2(d[0], d[1])                     # rotate so d points to +V
        c, s = np.cos(ang), np.sin(ang)
        R = np.array([[c, -s], [s, c]])
        k = DENSITY[grp]
        uv[corners] = U.mean(0) + (Uc @ R.T) * k
        info_islands.append({"part": m.face_part[fids[0]], "group": grp, "faces": len(fids)})
    me.uv_layers.active.data.foreach_set("uv", uv.ravel())
    me.update()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=False, scale=True, merge_overlap=False,
                            margin_method="FRACTION", margin=PAD_PX / ATLAS * 1.25, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    me.uv_layers.active.data.foreach_get("uv", uv.ravel())
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return uv.astype(np.float32), {"islands": info_islands, "density": DENSITY}


def layout_paths(root, version):
    base = os.path.join(root, "template", "uv", f"{LAYOUT_ID}_v{version}")
    return base + ".bin", base + ".json"


def save_layout(root, version, uv, m, extra):
    bin_p, json_p = layout_paths(root, version)
    os.makedirs(os.path.dirname(bin_p), exist_ok=True)
    if os.path.exists(bin_p):
        raise FileExistsError(f"UV layout v{version} already exists and is frozen: {bin_p}")
    data = uv.astype("<f4").tobytes()
    with open(bin_p, "wb") as fh:
        fh.write(data)
    meta = {
        "id": LAYOUT_ID, "version": version, "frozen": True,
        "atlas": [ATLAS, ATLAS], "paddingPx": PAD_PX,
        "topologyHash": m.topology_hash, "corners": int(len(uv)),
        "sha256": hashlib.sha256(data).hexdigest(),
        "format": "float32 little-endian (u,v) pairs in face-corner order of the template topology; "
                  "v up (Blender convention). glTF stores v' = 1 - v.",
        **extra,
    }
    with open(json_p, "w") as fh:
        json.dump(meta, fh, indent=1)
    return meta


def load_layout(root, version, m=None):
    bin_p, json_p = layout_paths(root, version)
    with open(json_p) as fh:
        meta = json.load(fh)
    with open(bin_p, "rb") as fh:
        data = fh.read()
    if hashlib.sha256(data).hexdigest() != meta["sha256"]:
        raise ValueError("UV layout binary does not match its recorded sha256 (tampered or corrupt)")
    uv = np.frombuffer(data, dtype="<f4").reshape(-1, 2).astype(np.float32)
    if m is not None and m.topology_hash != meta["topologyHash"]:
        raise ValueError("mesh topology does not match the frozen UV layout; create a new template/layout version")
    return uv, meta
