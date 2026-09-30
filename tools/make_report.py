"""Build validation/REPORT.md and contact sheets from validation/report.json (+ references)."""
import glob
import json
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = os.path.join(ROOT, "validation")


def sheet(files, out, size=300, cols=6, bg=(40, 42, 48)):
    if not files:
        return None
    rows = (len(files) + cols - 1) // cols
    img = Image.new("RGB", (size * min(cols, len(files)), size * rows), bg)
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGBA")
        im.thumbnail((size, size))
        b = Image.new("RGBA", (size, size), bg + (255,))
        b.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
        img.paste(b.convert("RGB"), ((i % cols) * size, (i // cols) * size))
    img.save(out, optimize=True)
    return os.path.relpath(out, V)


def main():
    rep = json.load(open(os.path.join(V, "report.json")))
    os.makedirs(os.path.join(V, "sheets"), exist_ok=True)
    md = ["# Validation report", "", f"Generated {rep['generated']} by `scripts/validate.mjs` "
          "(each GLB opened in a fresh browser context with only the GLB + its JSON).", ""]
    for cid, c in rep["characters"].items():
        n_ok = sum(k["ok"] for k in c["checks"])
        md += [f"## {cid} — {'PASS' if c['ok'] else 'FAIL'} ({n_ok}/{len(c['checks'])} checks)", "",
               "| check | result | detail |", "|---|---|---|"]
        for k in c["checks"]:
            md.append(f"| `{k['id']}` | {'✅' if k['ok'] else '❌'} | {k['detail'].replace('|', '/')} |")
        rt = c["viewerRoundTrip"]
        md += ["", f"**Viewer export → fresh reload:** {'PASS' if rt['ok'] else 'FAIL'} "
               f"({sum(k['ok'] for k in rt['checks'])}/{len(rt['checks'])} checks; material {rt['material']})", ""]
        i = c["info"]
        md += [f"Boundary vertices per part pair: `{json.dumps(i['boundaries'])}`", "",
               f"Grip: `{json.dumps(i.get('grip'))}` · Press: `{json.dumps(i.get('press'))}`", ""]
        for mat in ("blank", "original", "checker"):
            full = sorted(f for f in glob.glob(os.path.join(V, "screens", cid, f"{mat}_*.png")) if "closeup" not in f)
            close = sorted(glob.glob(os.path.join(V, "screens", cid, f"{mat}_closeup_*.png")))
            a = sheet(full, os.path.join(V, "sheets", f"{cid}_{mat}_poses.jpg"), 260, 7)
            b = sheet(close, os.path.join(V, "sheets", f"{cid}_{mat}_closeups.jpg"), 300, 5)
            if a:
                md += [f"### {mat} material — test poses (2 angles each)", "", f"![]({a})", ""]
            if b:
                md += [f"### {mat} material — joint close-ups", "", f"![]({b})", ""]
        rt_img = os.path.join(V, "roundtrip", f"{cid}_reloaded_textured.png")
        if os.path.exists(rt_img):
            md += ["### Viewer-exported GLB reloaded in a fresh page (texture embedded)", "",
                   f"![](roundtrip/{cid}_reloaded_textured.png)", ""]
        ref = os.path.join(ROOT, "references", cid)
        if os.path.isdir(ref):
            views = ["front", "back", "left", "right", "front_three_quarter"]
            files = [os.path.join(ref, f"{v}.png") for v in views] + [os.path.join(ref, "masks", f"{v}_partid.png") for v in views]
            s = sheet(files, os.path.join(V, "sheets", f"{cid}_references.jpg"), 260, 5)
            cov = json.load(open(os.path.join(ref, "cameras.json")))["coverage"]
            md += ["### Projection references + part-ID masks", "", f"![]({s})", "",
                   f"Coverage by the 5 reference views (UV texels): `{json.dumps(cov['uvTexelFractions'])}`; "
                   f"single view alone: `{json.dumps(cov['singleViewTexelCoverage'])}`", ""]
    with open(os.path.join(V, "REPORT.md"), "w") as fh:
        fh.write("\n".join(md))
    print("wrote validation/REPORT.md")


if __name__ == "__main__":
    main()
