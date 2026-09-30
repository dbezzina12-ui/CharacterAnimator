"""Character configuration JSON, content hashes, freeze guards and GLB inspection."""
import datetime
import hashlib
import json
import os
import struct

import numpy as np

SCHEMA = "gamboligy.character/1.0"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def geometry_hash(m):
    h = hashlib.sha256()
    h.update(np.round(m.V, 6).astype("<f8").tobytes())
    h.update(m.topology_hash.encode())
    return h.hexdigest()


def skeleton_hash(sk):
    h = hashlib.sha256()
    for b in sk.order:
        bone = sk[b]
        h.update(f"{b}|{bone.parent}|{int(bone.deform)}|".encode())
        h.update(np.round(bone.matrix(), 6).astype("<f8").tobytes())
    return h.hexdigest()


def weights_hash(W):
    return hashlib.sha256(np.round(W, 6).astype("<f8").tobytes()).hexdigest()


def read_glb_json(path):
    with open(path, "rb") as fh:
        data = fh.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    clen, ctype = struct.unpack_from("<II", data, 12)
    return json.loads(data[20:20 + clen].decode())


def inspect_glb(path):
    g = read_glb_json(path)
    nodes = g.get("nodes", [])
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    skins = g.get("skins", [])
    meshes = [nodes[i]["name"] for i, n in enumerate(nodes) if "mesh" in n]
    sockets = {}
    for i, n in enumerate(nodes):
        if n.get("name", "").startswith("socket_"):
            sockets[n["name"]] = {"parentNode": nodes[parent[i]]["name"] if i in parent else None,
                                  "translation": n.get("translation", [0, 0, 0]),
                                  "rotation": n.get("rotation", [0, 0, 0, 1])}
    anims = []
    acc = g.get("accessors", [])
    for a in g.get("animations", []):
        tmax = 0.0
        for smp in a["samplers"]:
            tmax = max(tmax, acc[smp["input"]].get("max", [0])[0])
        anims.append({"name": a["name"], "duration": round(tmax, 4), "channels": len(a["channels"])})
    return {
        "nodes": len(nodes), "meshNodes": meshes, "skins": len(skins),
        "joints": len(skins[0]["joints"]) if skins else 0,
        "jointNames": [nodes[j]["name"] for j in skins[0]["joints"]] if skins else [],
        "sockets": sockets, "animations": anims,
        "materials": [m.get("name") for m in g.get("materials", [])],
        "images": [im.get("name", im.get("mimeType")) for im in g.get("images", [])],
    }


def char_dir(root, cid):
    return os.path.join(root, "characters", cid)


def config_path(root, cid):
    return os.path.join(char_dir(root, cid), f"{cid}.character.json")


def load_config(root, cid):
    p = config_path(root, cid)
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        return json.load(fh)


def assert_writable(root, cid, force=False):
    cfg = load_config(root, cid)
    if cfg and cfg.get("frozen") and not force:
        raise PermissionError(
            f"character '{cid}' is frozen (geometry {cfg['geometry']['hash'][:12]}…, UV "
            f"{cfg['uvLayout']['id']} v{cfg['uvLayout']['version']}). Frozen characters are never rebuilt; "
            "create a new character id / version instead.")
    return cfg


def now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()


def write_config(root, cid, cfg):
    os.makedirs(char_dir(root, cid), exist_ok=True)
    with open(config_path(root, cid), "w") as fh:
        json.dump(cfg, fh, indent=2)
    return config_path(root, cid)
