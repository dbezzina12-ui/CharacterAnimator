import cv2, numpy as np, sys
from PIL import Image
src = cv2.imread(sys.argv[1], cv2.IMREAD_UNCHANGED)
if src.shape[2] == 4: src = cv2.cvtColor(src, cv2.COLOR_BGRA2BGR)
H, W = src.shape[:2]
gray = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY).astype(np.float32)
# local texture: std dev in a 7x7 window; the painted characters are hatched, the backdrop is a smooth gradient
mean = cv2.blur(gray, (7, 7)); sq = cv2.blur(gray * gray, (7, 7)); std = np.sqrt(np.maximum(0, sq - mean * mean))
def cut(x0, x1, name):
    roi = src[:, x0:x1].copy(); st = std[:, x0:x1]
    h, w = roi.shape[:2]
    mask = np.full((h, w), cv2.GC_PR_BGD, np.uint8)
    textured = (st > 9).astype(np.uint8)
    textured = cv2.morphologyEx(textured, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    # sure foreground: textured blobs well inside; sure background: smooth areas near the sides / corners
    inner = cv2.erode(textured, np.ones((15, 15), np.uint8))
    mask[inner > 0] = cv2.GC_FGD
    mask[(st < 3)] = cv2.GC_PR_BGD
    mask[:, :12] = cv2.GC_BGD; mask[:, -12:] = cv2.GC_BGD; mask[:8, :] = cv2.GC_BGD
    bgd = np.zeros((1, 65), np.float64); fgd = np.zeros((1, 65), np.float64)
    cv2.grabCut(roi, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    fg = ((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)).astype(np.uint8)
    # keep the largest component, fill holes
    n, lab, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA]); fg = (lab == big).astype(np.uint8)
    holes = fg.copy(); ff = np.zeros((h + 2, w + 2), np.uint8); cv2.floodFill(holes, ff, (0, 0), 1)
    fg = fg | (1 - holes)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    alpha = cv2.GaussianBlur(fg.astype(np.float32), (5, 5), 0)
    alpha = np.clip((alpha - 0.35) / 0.4, 0, 1)
    # trim to bounds
    ys, xs = np.where(alpha > 0.02); y0, y1, xx0, xx1 = ys.min(), min(h, ys.max() + 1), max(0, xs.min() - 6), min(w, xs.max() + 7)
    rgba = np.dstack([cv2.cvtColor(roi, cv2.COLOR_BGR2RGB), (alpha * 255).astype(np.uint8)])[y0:y1, xx0:xx1]
    Image.fromarray(rgba, 'RGBA').save(f'{name}.png')
    print(name, 'crop', (x0 + xx0, y0, rgba.shape[1], rgba.shape[0]), 'coverage', round(float((alpha > .5).mean()), 3))
    return rgba
a = cut(60, 760, 'ranger'); b = cut(800, 1500, 'gunslinger')
# preview on a checkerboard
def board(rgba):
    h, w = rgba.shape[:2]; yy, xx = np.mgrid[:h, :w]; chk = (((yy // 24) + (xx // 24)) % 2) * 60 + 90
    bg = np.dstack([chk, chk, chk]).astype(np.float32); al = rgba[..., 3:4] / 255.0
    return (rgba[..., :3] * al + bg * (1 - al)).astype(np.uint8)
pa, pb = board(a), board(b); h = max(pa.shape[0], pb.shape[0]); canvas = np.full((h, pa.shape[1] + pb.shape[1] + 20, 3), 40, np.uint8)
canvas[:pa.shape[0], :pa.shape[1]] = pa; canvas[:pb.shape[0], pa.shape[1] + 20:] = pb
Image.fromarray(canvas).resize((canvas.shape[1] // 2, canvas.shape[0] // 2)).save('preview.png')
