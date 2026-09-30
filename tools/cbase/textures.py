"""Atlas images and UV quality checks (Pillow only; deterministic)."""
import colorsys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .mesh import PART_ORDER

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _font(sz):
    try:
        return ImageFont.truetype(FONT, sz)
    except OSError:
        return ImageFont.load_default()


def part_color(part, sat=0.55, val=0.9):
    i = PART_ORDER.index(part)
    h = (i * 0.618034) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, sat, val)
    return int(r * 255), int(g * 255), int(b * 255)


PART_ID_COLORS = {p: part_color(p, 0.85, 0.95) for p in PART_ORDER}


def _island_groups(m):
    from .uvlayout import all_seams, island_group, islands
    out = []
    for f in islands(m.faces, m.face_part, all_seams(m)):
        pt = m.face_part[f[0]]
        if pt == "Head":
            g = island_group(m, f)
            reg = m.face_region[f[0]]
            pt = {"face": "Head_Face", "scalp": "Head_Scalp"}.get(g, "Ear_" + reg[-1])
        out.append((pt, f))
    return out


def _px(uv, size):
    # Blender UV (v up) -> image pixels (y down)
    return np.stack([uv[:, 0] * size, (1.0 - uv[:, 1]) * size], 1)


def _corner_polys(faces, uv, size):
    starts = np.cumsum([0] + [len(f) for f in faces])[:-1]
    P = _px(uv, size)
    return [P[s:s + len(f)] for s, f in zip(starts, faces)]


def island_mask_ids(m, uv, island_list, size):
    """Rasterise islands into an int image (0 = empty, k = island k), plus overlap count."""
    polys = _corner_polys(m.faces, uv, size)
    img = np.zeros((size, size), np.int32)
    overlap = 0
    for k, fids in enumerate(island_list, start=1):
        im = Image.new("L", (size, size), 0)
        d = ImageDraw.Draw(im)
        for f in fids:
            d.polygon([tuple(p) for p in polys[f]], fill=255)
        a = np.array(im) > 0
        overlap += int(np.count_nonzero(a & (img > 0)))
        img[a] = k
    return img, overlap


def padding_report(ids, pad_px):
    """Minimum pixel gap between different islands (checked up to pad_px)."""
    worst = None
    for r in range(1, pad_px + 1):
        found = False
        for dy, dx in ((0, r), (r, 0), (r, r), (r, -r)):
            a = ids[max(0, -dy):ids.shape[0] - max(0, dy), max(0, -dx):ids.shape[1] - max(0, dx)]
            b = ids[max(0, dy):, max(0, dx):][:a.shape[0], :a.shape[1]]
            clash = (a > 0) & (b > 0) & (a != b)
            if clash.any():
                found = True
                break
        if found:
            worst = r
            break
    return worst   # None = all gaps > pad_px


def uv_layout_image(m, uv, size=2048, title="humanoid_uv v1"):
    img = Image.new("RGB", (size, size), (28, 28, 30))
    d = ImageDraw.Draw(img)
    polys = _corner_polys(m.faces, uv, size)
    for f, pt in enumerate(m.face_part):
        c = part_color(pt, 0.45, 0.55)
        d.polygon([tuple(p) for p in polys[f]], fill=c)
    for f in range(len(m.faces)):
        d.line([tuple(p) for p in polys[f]] + [tuple(polys[f][0])], fill=(20, 20, 20), width=1)
    fnt = _font(max(12, size // 110))
    for pt, fids in _island_groups(m):
        c = np.concatenate([polys[f] for f in fids]).mean(0)
        d.text((c[0], c[1]), pt, fill=(255, 255, 255), font=fnt, anchor="mm", stroke_width=2, stroke_fill=(0, 0, 0))
    d.text((12, 10), f"{title}  |  {size}x{size}  |  L/R unique, no stacked islands", fill=(230, 230, 230),
           font=_font(max(12, size // 90)))
    return img


def checker_image(size=2048, cells=16):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    cs = size // cells
    fnt = _font(cs // 4)
    for j in range(cells):
        for i in range(cells):
            h = ((i + j * 3) % cells) / cells
            r, g, b = colorsys.hsv_to_rgb(h, 0.35 if (i + j) % 2 else 0.55, 0.95 if (i + j) % 2 else 0.75)
            d.rectangle([i * cs, j * cs, (i + 1) * cs - 1, (j + 1) * cs - 1], fill=(int(r * 255), int(g * 255), int(b * 255)))
            d.text((i * cs + cs / 2, j * cs + cs / 2), f"{chr(65 + j)}{i + 1}", fill=(20, 20, 20), font=fnt, anchor="mm")
            # small orientation tick: arrow toward +V (up in the image)
            x0, y0 = i * cs + cs * 0.15, j * cs + cs * 0.85
            d.line([(x0, y0), (x0, y0 - cs * 0.25)], fill=(20, 20, 20), width=max(1, cs // 40))
            d.polygon([(x0 - cs * 0.05, y0 - cs * 0.2), (x0 + cs * 0.05, y0 - cs * 0.2), (x0, y0 - cs * 0.3)], fill=(20, 20, 20))
    for k in range(cells + 1):
        d.line([(k * cs, 0), (k * cs, size)], fill=(40, 40, 40), width=2)
        d.line([(0, k * cs), (size, k * cs)], fill=(40, 40, 40), width=2)
    return img


def diagnostic_image(m, uv, size=2048):
    """Temporary 'baked' test texture: per-part colour, fine grid, part labels, L/R marks and
    'UP' arrows on each island. Asymmetric by design, so any L/R mix-up or mirroring is obvious."""
    base = Image.new("RGB", (size, size), (255, 0, 255))   # gutters: island colours dilated, then black
    d = ImageDraw.Draw(base)
    polys = _corner_polys(m.faces, uv, size)
    for f, pt in enumerate(m.face_part):
        d.polygon([tuple(p) for p in polys[f]], fill=part_color(pt, 0.45, 0.95))
    # dilate island colours into the padding so bilinear/mip sampling never bleeds magenta
    arr = np.array(base)
    mask = np.all(arr == [255, 0, 255], axis=2)
    fill = Image.fromarray(np.where(mask[..., None], 0, arr).astype(np.uint8))
    for _ in range(4):
        grown = fill.filter(ImageFilter.MaxFilter(5))
        a2 = np.array(grown)
        cur = np.array(fill)
        empty = np.all(cur == 0, axis=2)
        cur[empty] = a2[empty]
        fill = Image.fromarray(cur)
    img = fill
    d = ImageDraw.Draw(img)
    step = size // 64
    for k in range(0, size, step):
        d.line([(k, 0), (k, size)], fill=(0, 0, 0), width=1)
        d.line([(0, k), (size, k)], fill=(0, 0, 0), width=1)
    fnt = _font(max(14, size // 70))
    small = _font(max(10, size // 120))
    for pt, fids in _island_groups(m):
        pts = np.concatenate([polys[f] for f in fids])
        c = pts.mean(0)
        label = pt.replace("_", " ")
        side = pt[-1] if pt[-2:] in ("_L", "_R") else ""
        d.text((c[0], c[1]), label, fill=(0, 0, 0), font=fnt, anchor="mm", stroke_width=3, stroke_fill=(255, 255, 255))
        if side:
            d.text((c[0], c[1] + size // 40), "LEFT" if side == "L" else "RIGHT",
                   fill=(200, 0, 0) if side == "R" else (0, 0, 200), font=fnt, anchor="mm",
                   stroke_width=3, stroke_fill=(255, 255, 255))
        d.text((c[0], c[1] - size // 45), "▲ UP", fill=(0, 0, 0), font=small, anchor="mm")
    return img, mask


def part_texel_density(m, uv, size=2048):
    starts = np.cumsum([0] + [len(f) for f in m.faces])[:-1]
    out = {}
    for f, (fc, pt) in enumerate(zip(m.faces, m.face_part)):
        P = m.V[list(fc)]
        U = uv[starts[f]:starts[f] + len(fc)] * size
        a3 = 0.5 * np.linalg.norm(np.cross(P[2] - P[0], P[1] - P[0])) + 0.5 * np.linalg.norm(np.cross(P[3] - P[0], P[2] - P[0])) if len(fc) == 4 else 0
        e = U - U[0]
        a2 = 0.5 * abs(np.cross(e[1], e[2])) + (0.5 * abs(np.cross(e[2], e[3])) if len(fc) == 4 else 0)
        o = out.setdefault(pt, [0.0, 0.0])
        o[0] += a3
        o[1] += a2
    return {pt: round(float(np.sqrt(a2 / a3)), 1) for pt, (a3, a2) in out.items()}   # px per metre
