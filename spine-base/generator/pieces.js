// Placeholder artwork for the base rig: a neutral mannequin, one draw function per piece.
// Body pieces are drawn in WORLD setup-pose coordinates (y up), exactly where they sit when assembled,
// so real art can be painted over the template sheet piece by piece. The gun and its flash are drawn in
// their bone's local frame (barrel along +x) because that is how an artist would draw a weapon.
export const C = {
  line: '#182033', near: '#a3b6d1', mid: '#8a9dbb', far: '#65788f', farLine: '#182033',
  hand: '#c2cfe0', handFar: '#8d9db5', boot: '#3f4b66', bootFar: '#333d54', belt: '#3f4b66',
  skin: '#c9d4e3', hair: '#3f4b66', accent: '#f2a33c', joint: '#f4f7fb',
  wood: '#8b5b35', woodDark: '#5d3b21', metal: '#b3bcc9', metalDark: '#6c7584', crystal: '#4ad8c7', flash: '#ffd45a',
};
const LW = 3;
function poly(ctx, pts, close = true) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); }
function smooth(ctx, pts, t = 0.5) {
  const n = pts.length; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t / 3, p1[1] + (p2[1] - p0[1]) * t / 3, p2[0] - (p3[0] - p1[0]) * t / 3, p2[1] - (p3[1] - p1[1]) * t / 3, p2[0], p2[1]); }
  ctx.closePath();
}
function paint(ctx, fill, lw = LW) { ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = C.line; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
function capsulePts(a, b, ra, rb, n = 14) {
  const th = Math.atan2(b[1] - a[1], b[0] - a[0]); const pts = [];
  for (let i = 0; i <= n; i++) { const t = th + Math.PI / 2 + Math.PI * i / n; pts.push([a[0] + Math.cos(t) * ra, a[1] + Math.sin(t) * ra]); }
  for (let i = 0; i <= n; i++) { const t = th - Math.PI / 2 + Math.PI * i / n; pts.push([b[0] + Math.cos(t) * rb, b[1] + Math.sin(t) * rb]); }
  return pts;
}
function capsule(ctx, a, b, ra, rb, fill) {
  poly(ctx, capsulePts(a, b, ra, rb)); paint(ctx, fill);
  // soft highlight down the lit side
  ctx.save(); poly(ctx, capsulePts(a, b, ra, rb)); ctx.clip();
  const th = Math.atan2(b[1] - a[1], b[0] - a[0]); const nx = -Math.sin(th), ny = Math.cos(th); const s = nx - ny < 0 ? 1 : -1;   // light from upper-left
  poly(ctx, capsulePts([a[0] + nx * ra * 0.55 * s, a[1] + ny * ra * 0.55 * s], [b[0] + nx * rb * 0.55 * s, b[1] + ny * rb * 0.55 * s], ra * 0.3, rb * 0.3)); ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
  ctx.restore();
}
function dot(ctx, p, r = 4.5) { ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.fillStyle = C.joint; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.line; ctx.stroke(); }
function line(ctx, a, b, lw = 2, col = C.line) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.stroke(); }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.closePath(); }
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ext = (a, b, d) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [b[0] + (b[0] - a[0]) / L * d, b[1] + (b[1] - a[1]) / L * d]; };

/** Enter a bone's local frame (origin at the bone, +x along it) from world coordinates. */
function inBone(ctx, w, fn) { ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.rot * Math.PI / 180); fn(); ctx.restore(); }

function fist(ctx, P, far, part) {
  const { len, w, grip } = P.hand; const h = w / 2;
  if (!far) {   // near hand: we see the back of the hand; one piece that covers whatever it holds
    rrect(ctx, -5, -h, len + 5, w, 13); paint(ctx, C.hand);
    for (const y of [-h / 2, 0, h / 2]) line(ctx, [len - 15, y], [len - 3, y], 2);
    poly(ctx, capsulePts([8, h - 3], [grip + 6, h + 3], 7, 6)); paint(ctx, C.hand, 2.5);          // thumb along the top
    line(ctx, [2, -h + 4], [2, h - 4], 2);
    return;
  }
  if (part === 'back') {   // far hand: palm, behind the weapon
    rrect(ctx, -5, -h, len + 3, w, 13); paint(ctx, C.handFar);
    line(ctx, [2, -h + 4], [2, h - 4], 2);
  } else {                // far hand: four fingers and the thumb, in front of the weapon
    rrect(ctx, grip - 13, -h - 1, len - grip + 15, w + 2, 11); paint(ctx, C.hand);
    for (const y of [-h / 2, 0, h / 2]) line(ctx, [grip - 9, y], [len - 1, y], 2);
    poly(ctx, capsulePts([grip - 14, -h + 7], [grip + 9, -h + 2], 6.5, 5.5)); paint(ctx, C.hand, 2.5);
  }
}

export const PIECES = {
  // ---------------- arms
  'upper-near': (ctx, R) => { const { J, P } = R; capsule(ctx, J.shoulderN, J.elbowN, P.limb.upperArm[0] / 2, P.limb.upperArm[1] / 2, C.near); dot(ctx, J.shoulderN); },
  'forearm-near': (ctx, R) => { const { J, P } = R; capsule(ctx, J.elbowN, ext(J.elbowN, J.wristN, 4), P.limb.forearm[0] / 2, P.limb.forearm[1] / 2, C.near); dot(ctx, J.elbowN); },
  'hand-near': (ctx, R) => inBone(ctx, R.world['hand-near'], () => fist(ctx, R.P, false)),
  'upper-far': (ctx, R) => { const { J, P } = R; capsule(ctx, J.shoulderF, J.elbowF, P.limb.upperArm[0] / 2 - 1, P.limb.upperArm[1] / 2 - 1, C.far); dot(ctx, J.shoulderF); },
  'forearm-far': (ctx, R) => { const { J, P } = R; capsule(ctx, J.elbowF, ext(J.elbowF, J.wristF, 4), P.limb.forearm[0] / 2 - 1, P.limb.forearm[1] / 2 - 1, C.far); dot(ctx, J.elbowF); },
  'hand-far-back': (ctx, R) => inBone(ctx, R.world['hand-far'], () => fist(ctx, R.P, true, 'back')),
  'hand-far-front': (ctx, R) => inBone(ctx, R.world['hand-far'], () => fist(ctx, R.P, true, 'front')),
  // ---------------- legs
  'thigh-near': (ctx, R) => { const { J, P } = R; capsule(ctx, J.hipN, J.kneeN, P.limb.thigh[0] / 2, P.limb.thigh[1] / 2, C.near); dot(ctx, J.hipN); },
  'shin-near': (ctx, R) => { const { J, P } = R; capsule(ctx, J.kneeN, J.ankleN, P.limb.shin[0] / 2, P.limb.shin[1] / 2, C.near); dot(ctx, J.kneeN); },
  'thigh-far': (ctx, R) => { const { J, P } = R; capsule(ctx, J.hipF, J.kneeF, P.limb.thigh[0] / 2 - 1, P.limb.thigh[1] / 2 - 1, C.far); dot(ctx, J.hipF); },
  'shin-far': (ctx, R) => { const { J, P } = R; capsule(ctx, J.kneeF, J.ankleF, P.limb.shin[0] / 2 - 1, P.limb.shin[1] / 2 - 1, C.far); dot(ctx, J.kneeF); },
  'foot-near': (ctx, R) => boot(ctx, R, 'N', C.boot),
  'foot-far': (ctx, R) => boot(ctx, R, 'F', C.bootFar),
  // ---------------- trunk
  pelvis: (ctx, R) => {
    const { J, P } = R; const w = P.torso.waistHalf + 3; const top = J.waist[1] - 8, crotch = J.hip[1] - P.limb.thigh[0] * 0.5;
    smooth(ctx, [[J.hip[0] - w, top], [J.hip[0] + w, top], [J.hip[0] + w + 3, J.hip[1] - 4], [J.hipF[0] + P.limb.thigh[0] * 0.42, crotch], [J.hip[0] + 2, crotch + 8], [J.hipN[0] - P.limb.thigh[0] * 0.42, crotch], [J.hip[0] - w - 3, J.hip[1] - 4]], 0.35); paint(ctx, C.mid);
    ctx.save(); ctx.clip(); ctx.fillStyle = C.belt; ctx.fillRect(J.hip[0] - w - 10, top - 4, 2 * w + 20, 15); ctx.restore();
    line(ctx, [J.hip[0] - w + 2, top - 12], [J.hip[0] + w - 2, top - 12], 2); rrect(ctx, J.hip[0] + w * 0.25, top - 14, 16, 14, 3); paint(ctx, C.accent, 2);
    dot(ctx, J.hip);
  },
  torso: (ctx, R) => {
    const { J, P } = R; const T = P.torso; const rs = P.limb.upperArm[0] / 2 + 5; const my = (J.waist[1] + J.neck[1]) / 2;
    // neck stub first, then the ribcage over it
    rrect(ctx, J.neck[0] - T.neckW / 2, J.neck[1] - 16, T.neckW, 34, 8); paint(ctx, C.skin);
    smooth(ctx, [[J.shoulderN[0] - rs, J.shoulderN[1] - 4], [J.shoulderN[0] + 2, J.shoulderN[1] + rs], [J.neck[0], J.neck[1] - 2], [J.shoulderF[0] - 2, J.shoulderF[1] + rs * 0.8], [J.shoulderF[0] + rs * 0.85, J.shoulderF[1] - 8],
      [J.waist[0] + T.chestHalf * 1.04, my + 16], [J.hip[0] + T.waistHalf * 0.98, J.waist[1] - 26], [J.hip[0], J.waist[1] - 34], [J.hip[0] - T.waistHalf * 0.98, J.waist[1] - 28], [J.waist[0] - T.chestHalf * 0.95, my + 4]], 0.5); paint(ctx, C.mid);
    ctx.save(); ctx.clip();
    // lit near side, front panel line, emblem that shows which way the chest faces
    smooth(ctx, [[J.shoulderN[0] - rs, J.shoulderN[1] + 20], [J.shoulderN[0] + rs * 0.6, J.shoulderN[1] + rs], [J.waist[0] - T.chestHalf * 0.35, my], [J.hip[0] - T.waistHalf * 0.5, J.waist[1] - 40], [J.hip[0] - T.waistHalf * 1.2, J.waist[1] - 30]], 0.5); ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fill();
    ctx.restore();
    line(ctx, [J.neck[0] + T.neckW * 0.2, J.neck[1] - 16], [J.hip[0] + T.waistHalf * 0.45, J.waist[1] - 26], 2);
    const e = [J.waist[0] + T.chestHalf * 0.5, my + 26]; poly(ctx, [[e[0], e[1] + 13], [e[0] + 10, e[1]], [e[0], e[1] - 13], [e[0] - 10, e[1]]]); paint(ctx, C.accent, 2);
    dot(ctx, J.waist);
  },
  head: (ctx, R) => {
    const { J, P } = R; const H = P.head; const c = [(J.neck[0] + J.headTop[0]) / 2 + 6, J.neck[1] + H.h * 0.5]; const rx = H.w / 2, ry = H.h / 2;
    // skull with a jaw pushed toward the facing side
    smooth(ctx, [[c[0] - rx, c[1] + ry * 0.1], [c[0] - rx * 0.75, c[1] + ry * 0.8], [c[0], c[1] + ry], [c[0] + rx * 0.8, c[1] + ry * 0.72], [c[0] + rx * 1.02, c[1] + ry * 0.05],
      [c[0] + rx * 0.98, c[1] - ry * 0.5], [c[0] + rx * 0.55, c[1] - ry * 0.98], [c[0] - rx * 0.1, c[1] - ry * 0.9], [c[0] - rx * 0.8, c[1] - ry * 0.55]], 0.5); paint(ctx, C.skin);
    ctx.save(); ctx.clip();
    smooth(ctx, [[c[0] - rx * 1.2, c[1] + ry * 0.15], [c[0] - rx * 0.6, c[1] + ry * 1.2], [c[0] + rx * 0.5, c[1] + ry * 1.2], [c[0] + rx * 0.95, c[1] + ry * 0.62], [c[0] + rx * 0.2, c[1] + ry * 0.52], [c[0] - rx * 0.45, c[1] + ry * 0.2], [c[0] - rx * 0.6, c[1] - ry * 0.5], [c[0] - rx * 1.2, c[1] - ry * 0.5]], 0.5); ctx.fillStyle = C.hair; ctx.fill();
    ctx.restore();
    // ear, eyes (near larger, far narrower), brows, nose, mouth
    ctx.beginPath(); ctx.ellipse(c[0] - rx * 0.42, c[1] - ry * 0.04, rx * 0.13, ry * 0.15, 0, 0, Math.PI * 2); paint(ctx, C.skin, 2);
    for (const [ex, rw] of [[0.22, 0.13], [0.68, 0.09]]) {
      ctx.beginPath(); ctx.ellipse(c[0] + rx * ex, c[1] + ry * 0.04, rx * rw, ry * 0.075, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(c[0] + rx * (ex + 0.03), c[1] + ry * 0.04, ry * 0.05, 0, Math.PI * 2); ctx.fillStyle = C.line; ctx.fill();
      line(ctx, [c[0] + rx * (ex - rw - 0.02), c[1] + ry * 0.19], [c[0] + rx * (ex + rw + 0.02), c[1] + ry * 0.15], 3.5);
    }
    line(ctx, [c[0] + rx * 0.5, c[1] - ry * 0.02], [c[0] + rx * 0.58, c[1] - ry * 0.2], 2); line(ctx, [c[0] + rx * 0.58, c[1] - ry * 0.2], [c[0] + rx * 0.46, c[1] - ry * 0.22], 2);
    line(ctx, [c[0] + rx * 0.3, c[1] - ry * 0.46], [c[0] + rx * 0.7, c[1] - ry * 0.44], 2.5);
    dot(ctx, J.neck);
  },
  'eyes-closed': (ctx, R) => {
    const { J, P } = R; const H = P.head; const c = [(J.neck[0] + J.headTop[0]) / 2 + 6, J.neck[1] + H.h * 0.5]; const rx = H.w / 2, ry = H.h / 2;
    for (const [ex, rw] of [[0.22, 0.13], [0.68, 0.09]]) {
      ctx.beginPath(); ctx.ellipse(c[0] + rx * ex, c[1] + ry * 0.04, rx * rw + 2.5, ry * 0.075 + 2.5, 0, 0, Math.PI * 2); ctx.fillStyle = C.skin; ctx.fill();
      line(ctx, [c[0] + rx * (ex - rw), c[1] + ry * 0.03], [c[0] + rx * (ex + rw), c[1] + ry * 0.03], 2.5);
    }
  },
  // ---------------- weapons
  staff: (ctx, R) => {   // drawn upright where it stands in the setup pose; the staff bone's origin is the main grip
    const s = R.geo.staff; const x = s.x; const k = R.geo.k;
    rrect(ctx, x - 5.5, 6, 11, s.top - 46, 4); paint(ctx, C.wood);
    line(ctx, [x - 2, 30], [x - 2, s.top - 70], 2, 'rgba(255,255,255,0.25)');
    rrect(ctx, x - 8, 0, 16, 26, 4); paint(ctx, C.metalDark);                         // metal foot
    for (const gy of [s.gripY - 16, s.gripY + s.nearUp + 16 * k]) { rrect(ctx, x - 7, gy - 5, 14, 10, 3); paint(ctx, C.woodDark, 2); }   // grip bands either side of the hands
    rrect(ctx, x - 9, s.top - 64, 18, 16, 4); paint(ctx, C.metal);                    // collar
    smooth(ctx, [[x - 9, s.top - 50], [x - 22, s.top - 30], [x - 14, s.top - 6], [x - 6, s.top - 24], [x, s.top - 44], [x + 6, s.top - 24], [x + 14, s.top - 6], [x + 22, s.top - 30], [x + 9, s.top - 50]], 0.4); paint(ctx, C.metal);
    poly(ctx, [[x, s.top + 14], [x + 13, s.top - 12], [x, s.top - 36], [x - 13, s.top - 12]]); paint(ctx, C.crystal); line(ctx, [x - 5, s.top - 10], [x, s.top + 6], 2, 'rgba(255,255,255,0.7)');
  },
  gun: (ctx, R) => {     // bone-local: origin = grip point inside the fist, barrel along +x
    const k = R.geo.k; ctx.save(); ctx.scale(k, k);
    poly(ctx, [[-10, 10], [10, 12], [6, -34], [-16, -32]]); paint(ctx, C.woodDark);            // grip
    ctx.beginPath(); ctx.arc(18, 2, 11, Math.PI, Math.PI * 2); ctx.lineWidth = 3.5; ctx.strokeStyle = C.line; ctx.stroke();   // trigger guard (y up: lower half)
    rrect(ctx, -22, 8, 96, 24, 5); paint(ctx, C.metal);                                         // frame + barrel
    rrect(ctx, -22, 20, 70, 12, 4); paint(ctx, C.metalDark, 2);                                 // slide
    rrect(ctx, 60, 12, 14, 16, 3); paint(ctx, C.metalDark, 2);                                  // muzzle
    poly(ctx, [[-22, 30], [-30, 40], [-14, 32]]); paint(ctx, C.metalDark, 2);                   // hammer
    rrect(ctx, 52, 32, 8, 7, 2); paint(ctx, C.metalDark, 2);                                    // front sight
    ctx.restore();
  },
  'muzzle-flash': (ctx, R) => {   // bone-local at the muzzle, pointing +x
    const k = R.geo.k; ctx.save(); ctx.scale(k, k);
    const pts = []; const spikes = [[70, 0], [34, 12], [46, 30], [22, 20], [18, 40], [6, 18]];
    pts.push([-4, 0]); for (let i = spikes.length - 1; i >= 0; i--) pts.push([spikes[i][0], spikes[i][1]]); pts.push([70, 0]); for (const s of spikes.slice(1)) pts.push([s[0], -s[1]]);
    poly(ctx, pts); ctx.fillStyle = C.flash; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#ff8a1e'; ctx.stroke();
    poly(ctx, [[0, 0], [16, 8], [44, 0], [16, -8]]); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();
  },
};
function boot(ctx, R, S, fill) {
  const { J } = R; const a = J['ankle' + S], t = J['toe' + S]; const rA = R.P.limb.shin[1] / 2 + 3;
  smooth(ctx, [[a[0] - rA, a[1] + 14], [a[0] + rA, a[1] + 14], [a[0] + rA + 6, a[1] - 12], [lerp(a, t, 0.6)[0], 26], [t[0] + 2, 22], [t[0] + 10, 10], [t[0] + 8, 0], [a[0] - rA - 4, 0], [a[0] - rA - 5, a[1] - 14]], 0.35); paint(ctx, fill);
  ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(a[0] - 80, -2, 260, 8); ctx.restore();
  line(ctx, [a[0] - rA, a[1] + 14], [a[0] + rA, a[1] + 14], 2); dot(ctx, a);
}
/** Which frame each piece is drawn in and which bone it hangs on. */
export const PIECE_INFO = {
  'upper-far': { bone: 'upper-far' }, 'forearm-far': { bone: 'forearm-far' }, 'hand-far-back': { bone: 'hand-far' }, 'hand-far-front': { bone: 'hand-far' },
  'thigh-far': { bone: 'thigh-far' }, 'shin-far': { bone: 'shin-far' }, 'foot-far': { bone: 'foot-far' }, pelvis: { bone: 'hip' },
  'thigh-near': { bone: 'thigh-near' }, 'shin-near': { bone: 'shin-near' }, 'foot-near': { bone: 'foot-near' }, torso: { bone: 'chest' }, head: { bone: 'head' },
  'eyes-closed': { bone: 'head', slot: 'eyelids' }, 'upper-near': { bone: 'upper-near' }, 'forearm-near': { bone: 'forearm-near' }, 'hand-near': { bone: 'hand-near' },
  staff: { bone: 'staff', slot: 'weapon-far', skin: 'staff' }, gun: { bone: 'gun', slot: 'weapon-near', skin: 'gun', frame: 'bone' }, 'muzzle-flash': { bone: 'gun-muzzle', slot: 'muzzle-flash', skin: 'gun', frame: 'bone' },
};
