"""Dev: plot a mid-sagittal (x~0) or other slice profile of the final mesh."""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
from PIL import Image, ImageDraw
from cbase.params import resolve
from cbase.skeleton import build_skeleton
from cbase.mesh import build_mesh
out = sys.argv[1]; zlo, zhi = float(sys.argv[2]), float(sys.argv[3])
p = resolve({}); sk = build_skeleton(p); m = build_mesh(sk, p)
V = m.V
S = 900; img = Image.new('RGB', (S, S), 'white'); d = ImageDraw.Draw(img)
span = zhi - zlo
def P(y, z): return ((y + span / 2) / span * S, (zhi - z) / span * S)
# slice edges of faces crossing x=0
for f in m.faces:
    pts = V[list(f)]
    for i in range(len(f)):
        a, b = pts[i], pts[(i + 1) % len(f)]
        if (a[0] <= 0 <= b[0]) or (b[0] <= 0 <= a[0]):
            if abs(a[0] - b[0]) < 1e-12: continue
            t = -a[0] / (b[0] - a[0]); q = a + t * (b - a)
            if zlo <= q[2] <= zhi:
                x, y = P(q[1], q[2]); d.ellipse([x - 1.5, y - 1.5, x + 1.5, y + 1.5], fill='black')
cg = m.cage
for name in ('n1', 'n2'):
    for vi in cg.rings[name]:
        if abs(cg.V[vi][0]) < 1e-6:
            x, y = P(cg.V[vi][1], cg.V[vi][2]); d.ellipse([x - 4, y - 4, x + 4, y + 4], outline='red')
for i, r in enumerate(cg.rings['head'][:5]):
    for vi in (r[0], r[12]):
        x, y = P(cg.V[vi][1], cg.V[vi][2]); d.ellipse([x - 4, y - 4, x + 4, y + 4], outline='blue'); d.text((x + 6, y - 6), f"h{i}", fill='blue')
img.save(out)
