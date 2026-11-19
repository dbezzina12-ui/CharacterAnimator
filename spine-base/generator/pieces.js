// Placeholder artwork for the base rig: a plain figure in a T-shirt and trousers, one draw function per piece.
// Body pieces are drawn in WORLD setup-pose coordinates (y up), exactly where they sit when assembled,
// so real art can be painted over the template sheet piece by piece. The gun and its flash are drawn in
// their bone's local frame (barrel along +x) because that is how an artist would draw a weapon.
// Joints: a piece that sits in front of its parent leaves its root end without an outline, so the two read as one limb.
export const C = {
  line: '#2a2230', skin: '#e4b48f', skinFar: '#c79672', skinFarLit: '#d3a27d',
  shirt: '#93a9ba', shirtFar: '#748a9c', pants: '#4c586e', pantsFar: '#3d475a', shoe: '#43362f', shoeFar: '#352b26',
  hair: '#3b2b23', cape: '#8f2f3b', capeDark: '#712432', cloak: '#25212e', cloakLit: '#383344', lining: '#9c2233', liningDark: '#761a29', clasp: '#d9a441',
  wood: '#8b5b35', woodDark: '#5d3b21', metal: '#b3bcc9', metalDark: '#6c7584', crystal: '#4ad8c7', flash: '#ffd45a',
};
const LW = 3;
function poly(ctx, pts, close = true) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (close) ctx.closePath(); }
/** Closed curve through the points; a point written [x, y, 1] is a sharp corner. */
function blob(ctx, pts, t = 0.5) {
  const n = pts.length; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n]; const p0 = p1[2] ? p1 : pts[(i - 1 + n) % n], p3 = p2[2] ? p2 : pts[(i + 2) % n];
    ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) * t / 3, p1[1] + (p2[1] - p0[1]) * t / 3, p2[0] - (p3[0] - p1[0]) * t / 3, p2[1] - (p3[1] - p1[1]) * t / 3, p2[0], p2[1]);
  }
  ctx.closePath();
}
const smooth = blob;
function ink(ctx, lw = LW) { ctx.lineWidth = lw; ctx.strokeStyle = C.line; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); }
function paint(ctx, fill, lw = LW) { ctx.fillStyle = fill; ctx.fill(); ink(ctx, lw); }
function capsulePts(a, b, ra, rb, n = 14) {
  const th = Math.atan2(b[1] - a[1], b[0] - a[0]); const pts = [];
  for (let i = 0; i <= n; i++) { const t = th + Math.PI / 2 + Math.PI * i / n; pts.push([a[0] + Math.cos(t) * ra, a[1] + Math.sin(t) * ra]); }
  for (let i = 0; i <= n; i++) { const t = th - Math.PI / 2 + Math.PI * i / n; pts.push([b[0] + Math.cos(t) * rb, b[1] + Math.sin(t) * rb]); }
  return pts;
}
function line(ctx, a, b, lw = 2, col = C.line) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.lineCap = 'round'; ctx.stroke(); }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const ext = (a, b, d) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [b[0] + (b[0] - a[0]) / L * d, b[1] + (b[1] - a[1]) / L * d]; };

/** Limb outline from joint a to joint b. Radius runs ra -> rb with a muscle bulge on each side (bl = left of travel, br = right).
 *  from = [left, right]: how far along each side the outline starts, so the root end blends into the parent piece. */
function limbShape(a, b, ra, rb, { bl = 0, br = 0, peak = 0.35, from = [0, 0], n = 16, m = 10 } = {}) {
  const th = Math.atan2(b[1] - a[1], b[0] - a[0]), nx = -Math.sin(th), ny = Math.cos(th), k = Math.log(0.5) / Math.log(peak);
  const at = (t, side) => { const r = ra + (rb - ra) * t + (side > 0 ? bl : br) * Math.sin(Math.PI * Math.pow(t, k)); return [a[0] + (b[0] - a[0]) * t + nx * r * side, a[1] + (b[1] - a[1]) * t + ny * r * side]; };
  const arc = (c, r, a0, a1) => Array.from({ length: m + 1 }, (_, i) => { const g = a0 + (a1 - a0) * i / m; return [c[0] + Math.cos(g) * r, c[1] + Math.sin(g) * r]; });
  const L = [], Rt = []; for (let i = 0; i <= n; i++) { L.push(at(i / n, 1)); Rt.push(at(i / n, -1)); }
  const capB = arc(b, rb, th + Math.PI / 2, th - Math.PI / 2).slice(1, -1), capA = arc(a, ra, th - Math.PI / 2, th - 3 * Math.PI / 2).slice(1, -1);
  return { fill: [...L, ...capB, ...Rt.slice().reverse(), ...capA], open: [...L.slice(Math.round(from[0] * n)), ...capB, ...Rt.slice(Math.round(from[1] * n)).reverse()], at, nx, ny };
}
function limb(ctx, a, b, ra, rb, fill, o = {}) {
  const s = limbShape(a, b, ra, rb, o);
  poly(ctx, s.fill); ctx.fillStyle = fill; ctx.fill();
  ctx.save(); poly(ctx, s.fill); ctx.clip();
  if (o.over) o.over(s);
  const sd = s.nx - s.ny < 0 ? 1 : -1;   // light from the upper left
  const off = (p, r, d) => [p[0] + s.nx * r * d, p[1] + s.ny * r * d];
  poly(ctx, capsulePts(off(a, ra, 0.5 * sd), off(b, rb, 0.5 * sd), ra * 0.3, rb * 0.3)); ctx.fillStyle = 'rgba(255,255,255,0.17)'; ctx.fill();
  poly(ctx, capsulePts(off(a, ra, -0.72 * sd), off(b, rb, -0.72 * sd), ra * 0.34, rb * 0.34)); ctx.fillStyle = 'rgba(30,10,40,0.12)'; ctx.fill();
  ctx.restore();
  poly(ctx, o.closed ? s.fill : s.open, !!o.closed); ink(ctx);
}
/** Short sleeve over the top of an upper arm (called inside the arm's clip). */
const sleeve = (ctx, fill, a, b, r, t = 0.5) => (s) => {
  const e = lerp(a, b, t), th = Math.atan2(b[1] - a[1], b[0] - a[0]), back = [a[0] - Math.cos(th) * r * 2, a[1] - Math.sin(th) * r * 2];
  poly(ctx, [[back[0] + s.nx * r * 2, back[1] + s.ny * r * 2], [e[0] + s.nx * r * 2, e[1] + s.ny * r * 2], [e[0] - s.nx * r * 2, e[1] - s.ny * r * 2], [back[0] - s.nx * r * 2, back[1] - s.ny * r * 2]]);
  ctx.fillStyle = fill; ctx.fill(); line(ctx, [e[0] + s.nx * r * 2, e[1] + s.ny * r * 2], [e[0] - s.nx * r * 2, e[1] - s.ny * r * 2], 2.5);
};

/** Enter a bone's local frame (origin at the bone, +x along it) from world coordinates. */
function inBone(ctx, w, fn) { ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.rot * Math.PI / 180); fn(); ctx.restore(); }

// Closed fist. Hand frame: origin = wrist, +x toward the knuckles, the grip axis runs along y, grip point = hand.grip from the wrist.
function fist(ctx, P, far, part) {
  const { len, w, grip } = P.hand; const h = w / 2; const u = len / 44;
  if (!far) {   // near hand: we see the back of the hand; one piece that covers whatever it holds
    rrect(ctx, -5 * u, -h, len + 5 * u, w, 13 * u); paint(ctx, C.skin);
    for (const y of [-h / 2, 0, h / 2]) line(ctx, [len - 15 * u, y], [len - 3 * u, y], 2);
    poly(ctx, capsulePts([8 * u, h - 3 * u], [grip + 6 * u, h + 3 * u], 7 * u, 6 * u)); paint(ctx, C.skin, 2.5);          // thumb along the top
    return;
  }
  if (part === 'back') {   // far hand: palm, behind the weapon
    rrect(ctx, -5 * u, -h, len + 3 * u, w, 13 * u); paint(ctx, C.skinFar);
  } else {                // far hand: four fingers and the thumb, in front of the weapon
    rrect(ctx, grip - 13 * u, -h - 1, len - grip + 15 * u, w + 2, 11 * u); paint(ctx, C.skinFarLit);
    for (const y of [-h / 2, 0, h / 2]) line(ctx, [grip - 9 * u, y], [len - 1, y], 2);
    poly(ctx, capsulePts([grip - 14 * u, -h + 7 * u], [grip + 9 * u, -h + 2 * u], 6.5 * u, 5.5 * u)); paint(ctx, C.skinFarLit, 2.5);
  }
}
const headBox = (R) => { const { J, P } = R; const H = P.head; return { c: [(J.neck[0] + J.headTop[0]) / 2 + H.w * 0.06, J.neck[1] + H.h * 0.5], rx: H.w / 2, ry: H.h / 2 }; };
const EYES = [[0.2, 0.13], [0.66, 0.09]];   // [centre, half-width] as fractions of the head's half-width: near eye, far eye

export const PIECES = {
  // ---------------- capes. 'cape' is the back panel of either style (one image; the rig bends it as a mesh across four bones).
  cape: (ctx, R) => {
    const { J, P } = R; const g = R.geo.cape; const ra = P.limb.upperArm[0] / 2, span = J.shoulderF[0] - J.shoulderN[0], nW = P.torso.neckW; const wrap = P.cape === 'wrap';
    // the vampire cape is wider, reaches the ankles, shows its red lining from the front and ends in a scalloped hem
    const tl = wrap ? [J.shoulderN[0] - ra * 1.2, J.shoulderN[1] + ra * 0.5] : [J.shoulderN[0] - ra * 0.9, J.shoulderN[1] + ra * 0.6], tr = wrap ? [J.shoulderF[0] + ra * 0.9, J.shoulderF[1] + ra * 0.4] : [J.neck[0] + nW * 0.3, J.neck[1] - nW * 0.1];
    const by = g.end[1], bl = [g.end[0] - (wrap ? 1.0 : 0.78) * span, by + 4], br = [g.end[0] + (wrap ? 1.3 : 0.6) * span, by + 10], len = tl[1] - by;
    const hem = wrap ? [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => { const q = lerp(br, bl, i / 10); return i % 2 ? [q[0], q[1] + 0.04 * len] : [q[0], q[1], 1]; })
      : [0.2, 0.4, 0.6, 0.8].map((f, i) => { const q = lerp(br, bl, f); return [q[0], q[1] + (i % 2 ? 0.012 : -0.022) * len]; });
    const outline = [[tl[0], tl[1], 1], [(tl[0] + tr[0]) / 2, (tl[1] + tr[1]) / 2 + ra * 0.5], [tr[0], tr[1], 1], [tr[0] + (wrap ? 0.3 : 0.16) * span, by + len * 0.5], [br[0], br[1], 1], ...hem, [bl[0], bl[1], 1], [tl[0] - (wrap ? 0.42 : 0.3) * span, by + len * 0.45]];
    blob(ctx, outline); ctx.fillStyle = wrap ? C.lining : C.cape; ctx.fill();
    ctx.save(); ctx.clip();
    for (const [f0, f1, w] of wrap ? [[0.1, 0.08, 0.06], [0.32, 0.28, 0.07], [0.55, 0.5, 0.08], [0.76, 0.72, 0.07], [0.94, 0.92, 0.06]] : [[0.18, 0.12, 0.07], [0.5, 0.42, 0.09], [0.8, 0.74, 0.07]]) {   // folds fanning out from the shoulders
      const s0 = lerp(tl, tr, f0 * 0.8 + 0.1), s1 = lerp(bl, br, f1); poly(ctx, [[s0[0] - 2, s0[1]], [s0[0] + 2, s0[1]], [s1[0] + w * span, s1[1] - 12], [s1[0] - w * span, s1[1] - 12]]); ctx.fillStyle = wrap ? C.liningDark : C.capeDark; ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(bl[0] - span, by - 30, 5 * span, 0.06 * len + 30);
    if (wrap) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(tl[0] - span, tl[1] - 0.2 * len, 5 * span, 0.3 * len); }   // shadow where the body stands in front of it
    ctx.restore(); blob(ctx, outline); ink(ctx);
  },
  // Vampire cape, part 2: the stand-up collar behind the head (rigid on the chest). We look into it, so it shows the lining with a dark rim.
  'cape-collar': (ctx, R) => {
    const { J, P } = R; const ra = P.limb.upperArm[0] / 2, nW = P.torso.neckW, hh = P.head.h, nk = J.neck, sN = J.shoulderN, sF = J.shoulderF;
    const shape = [[sN[0] + ra * 0.2, sN[1] + ra * 0.7, 1], [nk[0] - nW * 2.15, nk[1] + hh * 0.26], [nk[0] - nW * 1.95, nk[1] + hh * 0.62, 1], [nk[0] - nW * 0.9, nk[1] + hh * 0.44], [nk[0] + nW * 0.2, nk[1] + hh * 0.4],
      [nk[0] + nW * 1.3, nk[1] + hh * 0.42], [nk[0] + nW * 2.35, nk[1] + hh * 0.56, 1], [nk[0] + nW * 2.4, nk[1] + hh * 0.22], [sF[0] - ra * 0.1, sF[1] + ra * 0.6, 1], [nk[0], nk[1] - nW * 0.5]];
    blob(ctx, shape); ctx.fillStyle = C.lining; ctx.fill();
    ctx.save(); ctx.clip(); blob(ctx, shape); ctx.lineWidth = ra * 0.8; ctx.strokeStyle = C.cloak; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(nk[0] - nW * 1.1, nk[1] - nW, nW * 2.6, hh);   // the back of the collar is in the head's shadow
    ctx.restore(); blob(ctx, shape); ink(ctx);
  },
  // Part 3: the mantle. It lies over both shoulders in front of the torso and closes at the throat with a clasp.
  'cape-mantle': (ctx, R) => {
    const { J, P } = R; const r = P.limb.upperArm[0] / 2 + 1.5, nW = P.torso.neckW, nk = J.neck, sN = J.shoulderN, sF = J.shoulderF; const c = [nk[0] + nW * 0.12, nk[1] - nW];
    const shape = [[sN[0] - r * 1.2, sN[1] - r * 0.5], [sN[0] - r * 0.4, sN[1] + r * 1.15], [nk[0] - nW * 0.8, nk[1] + nW * 0.2, 1], [c[0], c[1], 1], [nk[0] + nW * 0.85, nk[1] + nW * 0.1, 1], [sF[0] + r * 0.2, sF[1] + r],
      [sF[0] + r, sF[1] - r * 0.3], [sF[0] + r * 0.5, sF[1] - r * 1.6, 1], [c[0] + nW * 0.1, c[1] - nW * 0.75], [sN[0] + r * 0.8, sN[1] - r * 1.9], [sN[0] - r, sN[1] - r * 1.6, 1]];
    blob(ctx, shape); ctx.fillStyle = C.cloak; ctx.fill();
    ctx.save(); ctx.clip();
    poly(ctx, [[sN[0] - r * 1.4, sN[1] + r * 1.4], [sN[0] + r * 0.4, sN[1] + r * 1.4], [sN[0] + r * 0.9, sN[1] - r * 2.2], [sN[0] - r * 1.4, sN[1] - r * 2.2]]); ctx.fillStyle = C.cloakLit; ctx.fill();
    poly(ctx, [[nk[0] - nW * 0.8, nk[1] + nW * 0.2], [c[0], c[1]], [nk[0] + nW * 0.85, nk[1] + nW * 0.1], [nk[0] + nW * 1.1, nk[1] - nW * 0.15], [c[0] + 1, c[1] - nW * 0.34], [nk[0] - nW * 1.05, nk[1] - nW * 0.05]]); ctx.fillStyle = C.lining; ctx.fill();   // lining turned out along the opening
    ctx.restore(); blob(ctx, shape); ink(ctx);
    ctx.beginPath(); ctx.arc(c[0], c[1] - nW * 0.2, nW * 0.2, 0, Math.PI * 2); paint(ctx, C.clasp, 2);
  },
  // Parts 4 and 5: the panels that hang over each shoulder and arm (meshes on their own three-bone chains). Forearms and hands come out in front of them.
  'cape-near': (ctx, R) => {
    const { J, P } = R; const r = P.limb.upperArm[0] / 2 + 1.5, sN = J.shoulderN, by = R.geo.capeNear.end[1], len = sN[1] + r - by;
    const shape = [[sN[0] - r * 1.25, sN[1] + r * 0.15], [sN[0] - r * 0.3, sN[1] + r * 1.2], [sN[0] + r * 1.2, sN[1] + r * 0.75, 1], [sN[0] + r * 1.75, sN[1] - 0.25 * len], [sN[0] + r * 2.1, sN[1] - 0.6 * len], [sN[0] + r * 1.9, by + 4, 1],
      [sN[0] - r * 0.4, by - 0.015 * len], [sN[0] - r * 2.9, by + 8, 1], [sN[0] - r * 2.5, sN[1] - 0.5 * len], [sN[0] - r * 1.7, sN[1] - 0.12 * len]];
    blob(ctx, shape); ctx.fillStyle = C.cloak; ctx.fill();
    ctx.save(); ctx.clip();
    poly(ctx, [[sN[0] - r * 0.9, sN[1] + r], [sN[0] - r * 0.1, sN[1] + r], [sN[0] - r * 0.6, by - 10], [sN[0] - r * 1.9, by - 10]]); ctx.fillStyle = C.cloakLit; ctx.fill();
    poly(ctx, [[sN[0] + r * 0.5, sN[1]], [sN[0] + r * 0.9, sN[1]], [sN[0] + r * 1.1, by - 10], [sN[0] + r * 0.5, by - 10]]); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
    poly(ctx, [[sN[0] + r * 1.2, sN[1] + r * 0.75], [sN[0] + r * 1.75, sN[1] - 0.25 * len], [sN[0] + r * 2.1, sN[1] - 0.6 * len], [sN[0] + r * 1.9, by - 10], [sN[0] + r * 3, by - 10], [sN[0] + r * 3, sN[1] + r * 2]]); ctx.lineWidth = r * 0.55; ctx.strokeStyle = C.lining; ctx.lineJoin = 'round'; ctx.stroke();   // lining along the front edge
    ctx.restore(); blob(ctx, shape); ink(ctx);
  },
  'cape-far': (ctx, R) => {
    const { J, P } = R; const r = P.limb.upperArm[0] / 2 + 1.5, sF = J.shoulderF, by = R.geo.capeFar.end[1], len = sF[1] + r - by;
    const shape = [[sF[0] - r, sF[1] + r * 0.8, 1], [sF[0] + r * 0.3, sF[1] + r * 1.1], [sF[0] + r * 1.3, sF[1] + r * 0.1], [sF[0] + r * 1.9, sF[1] - 0.3 * len], [sF[0] + r * 2.4, sF[1] - 0.65 * len], [sF[0] + r * 2.3, by + 6, 1],
      [sF[0] - r * 0.2, by - 0.012 * len], [sF[0] - r * 2.2, by, 1], [sF[0] - r * 1.8, sF[1] - 0.4 * len]];
    blob(ctx, shape); ctx.fillStyle = C.cloak; ctx.fill();
    ctx.save(); ctx.clip();
    poly(ctx, [[sF[0] + r * 0.4, sF[1] + r], [sF[0] + r * 1.0, sF[1] + r], [sF[0] + r * 1.7, by - 10], [sF[0] + r * 0.9, by - 10]]); ctx.fillStyle = C.cloakLit; ctx.fill();
    ctx.restore(); blob(ctx, shape); ink(ctx);
  },
  // ---------------- arms
  'upper-near': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.upperArm; limb(ctx, J.shoulderN, J.elbowN, d0 / 2, d1 / 2, C.skin, { br: d0 * 0.05, from: [0.16, 0], over: sleeve(ctx, C.shirt, J.shoulderN, J.elbowN, d0, 0.5) }); },
  'forearm-near': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.forearm; limb(ctx, J.elbowN, ext(J.elbowN, J.wristN, 3), d0 / 2, d1 / 2, C.skin, { bl: d0 * 0.07, br: d0 * 0.05, peak: 0.3 }); },
  'hand-near': (ctx, R) => inBone(ctx, R.world['hand-near'], () => fist(ctx, R.P, false)),
  'upper-far': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.upperArm; limb(ctx, J.shoulderF, J.elbowF, d0 / 2, d1 / 2, C.skinFar, { bl: d0 * 0.05, closed: true, over: sleeve(ctx, C.shirtFar, J.shoulderF, J.elbowF, d0, 0.5) }); },
  'forearm-far': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.forearm; limb(ctx, J.elbowF, ext(J.elbowF, J.wristF, 3), d0 / 2, d1 / 2, C.skinFar, { bl: d0 * 0.07, br: d0 * 0.05, peak: 0.3 }); },
  'hand-far-back': (ctx, R) => inBone(ctx, R.world['hand-far'], () => fist(ctx, R.P, true, 'back')),
  'hand-far-front': (ctx, R) => inBone(ctx, R.world['hand-far'], () => fist(ctx, R.P, true, 'front')),
  // ---------------- legs
  'thigh-near': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.thigh; limb(ctx, J.hipN, J.kneeN, d0 / 2, d1 / 2, C.pants, { bl: d0 * 0.04, br: d0 * 0.03, from: [0.3, 0] }); },
  'shin-near': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.shin; limb(ctx, J.kneeN, J.ankleN, d0 / 2, d1 / 2, C.pants, { br: d0 * 0.09, peak: 0.3 }); },
  'thigh-far': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.thigh; limb(ctx, J.hipF, J.kneeF, d0 / 2, d1 / 2, C.pantsFar, { bl: d0 * 0.04, closed: true }); },
  'shin-far': (ctx, R) => { const { J, P } = R; const [d0, d1] = P.limb.shin; limb(ctx, J.kneeF, J.ankleF, d0 / 2, d1 / 2, C.pantsFar, { br: d0 * 0.09, peak: 0.3 }); },
  'foot-near': (ctx, R) => shoe(ctx, R, 'N', C.shoe),
  'foot-far': (ctx, R) => shoe(ctx, R, 'F', C.shoeFar),
  // ---------------- trunk
  pelvis: (ctx, R) => {   // the top of the trousers; both thighs tuck into it
    const { J, P } = R; const rT = P.limb.thigh[0] / 2 + 1.5, T = J.neck[1] - J.hip[1], top = J.waist[1] - 0.05 * T, wh = P.torso.waistHalf, cx = (J.hipN[0] + J.hipF[0]) / 2;
    blob(ctx, [[J.waist[0] - wh, top, 1], [J.waist[0] + wh * 1.03, top, 1], [J.hipF[0] + rT, J.hipF[1] + rT * 0.15], [J.hipF[0] + rT * 0.74, J.hipF[1] - rT * 0.7], [cx + 2, J.hip[1] - rT * 0.98],
      [J.hipN[0] - rT * 0.74, J.hipN[1] - rT * 0.7], [J.hipN[0] - rT, J.hipN[1] + rT * 0.15]]); paint(ctx, C.pants);
  },
  torso: (ctx, R) => {   // T-shirt with the neck; the near shoulder cap belongs to this piece so a raised arm still has a shoulder
    const { J, P } = R; const Tt = P.torso, ra = P.limb.upperArm[0] / 2 + 1.5, T = J.neck[1] - J.hip[1];
    const sN = J.shoulderN, sF = J.shoulderF, nk = J.neck, wa = J.waist, hp = J.hip, nW = Tt.neckW, cx = (sN[0] + sF[0]) / 2;
    const hem = hp[1] + 0.1 * T, yAt = (f) => wa[1] + (nk[1] - wa[1]) * f;
    poly(ctx, [[nk[0] - nW * 0.52, nk[1] - nW * 0.6], [nk[0] + nW * 0.5, nk[1] - nW * 0.6], [nk[0] + nW * 0.56, nk[1] + nW * 0.8], [nk[0] - nW * 0.4, nk[1] + nW * 0.8]]); paint(ctx, C.skin);
    const A = [nk[0] - nW * 0.66, nk[1] - nW * 0.1, 1], B = [nk[0] + nW * 0.62, nk[1] - nW * 0.2, 1], dip = [nk[0] + nW * 0.06, nk[1] - nW * 0.5];
    const body = [A, [(A[0] + sN[0]) / 2 - ra * 0.1, (A[1] + sN[1] + ra) / 2 + 1], [sN[0] - ra * 0.25, sN[1] + ra], [sN[0] - ra, sN[1] - ra * 0.05], [sN[0] - ra * 0.7, sN[1] - ra * 1.15],
      [cx - Tt.chestHalf * 0.9, yAt(0.42)], [wa[0] - Tt.waistHalf * 0.98, wa[1] + 0.02 * T], [hp[0] - Tt.waistHalf * 1.04, hem, 1], [hp[0] + Tt.waistHalf * 1.1, hem + 0.012 * T, 1],
      [wa[0] + Tt.waistHalf * 1.04, wa[1] + 0.05 * T], [cx + Tt.chestHalf * 1.03, yAt(0.6)], [sF[0] + ra * 0.72, sF[1] - ra * 0.35], [sF[0] + ra * 0.05, sF[1] + ra * 0.8], B, dip];
    blob(ctx, body); ctx.fillStyle = C.shirt; ctx.fill();
    ctx.save(); ctx.clip();
    // the far third of the chest turns away from the light; the near flank catches it
    poly(ctx, [[nk[0] + nW * 0.9, nk[1] + 20], [sF[0] + ra * 3, nk[1] + 20], [sF[0] + ra * 3, hem - 20], [hp[0] + Tt.waistHalf * 0.62, hem - 20], [wa[0] + Tt.waistHalf * 0.6, wa[1]], [cx + Tt.chestHalf * 0.55, yAt(0.62)]]); ctx.fillStyle = 'rgba(30,20,60,0.13)'; ctx.fill();
    poly(ctx, [[sN[0] - ra * 2, sN[1]], [sN[0] + ra * 0.3, sN[1] - ra], [cx - Tt.chestHalf * 0.55, yAt(0.4)], [wa[0] - Tt.waistHalf * 0.62, wa[1]], [hp[0] - Tt.waistHalf * 0.66, hem - 20], [sN[0] - ra * 2, hem - 20]]); ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fill();
    ctx.restore(); blob(ctx, body); ink(ctx);
    ctx.beginPath(); ctx.moveTo(A[0] + 2, A[1] - nW * 0.16); ctx.quadraticCurveTo(dip[0], dip[1] - nW * 0.42, B[0] - 2, B[1] - nW * 0.14); ink(ctx, 2);   // collar rib
  },
  head: (ctx, R) => {
    const { c, rx, ry } = headBox(R);
    // skull with the jaw pushed toward the facing side
    const skull = [[c[0] - rx, c[1] + ry * 0.1], [c[0] - rx * 0.75, c[1] + ry * 0.8], [c[0], c[1] + ry], [c[0] + rx * 0.8, c[1] + ry * 0.72], [c[0] + rx * 1.02, c[1] + ry * 0.05],
      [c[0] + rx * 0.98, c[1] - ry * 0.5], [c[0] + rx * 0.55, c[1] - ry * 0.98], [c[0] - rx * 0.1, c[1] - ry * 0.9], [c[0] - rx * 0.8, c[1] - ry * 0.55]];
    blob(ctx, skull); ctx.fillStyle = C.skin; ctx.fill();
    ctx.save(); ctx.clip();
    poly(ctx, [[c[0] + rx * 0.72, c[1] + ry], [c[0] + rx * 1.3, c[1] + ry], [c[0] + rx * 1.3, c[1] - ry * 1.2], [c[0] + rx * 0.3, c[1] - ry * 1.2], [c[0] + rx * 0.62, c[1] - ry * 0.55], [c[0] + rx * 0.84, c[1] - ry * 0.1]]); ctx.fillStyle = 'rgba(120,50,40,0.14)'; ctx.fill();
    blob(ctx, [[c[0] - rx * 1.2, c[1] + ry * 0.15], [c[0] - rx * 0.6, c[1] + ry * 1.2], [c[0] + rx * 0.5, c[1] + ry * 1.2], [c[0] + rx * 0.97, c[1] + ry * 0.6], [c[0] + rx * 0.3, c[1] + ry * 0.5], [c[0] - rx * 0.42, c[1] + ry * 0.2], [c[0] - rx * 0.58, c[1] - ry * 0.5], [c[0] - rx * 1.2, c[1] - ry * 0.5]]); ctx.fillStyle = C.hair; ctx.fill();
    ctx.restore(); blob(ctx, skull); ink(ctx);
    // ear, eyes (near larger, far narrower), brows, nose, mouth
    ctx.beginPath(); ctx.ellipse(c[0] - rx * 0.42, c[1] - ry * 0.04, rx * 0.13, ry * 0.15, 0, 0, Math.PI * 2); paint(ctx, C.skin, 2);
    for (const [ex, rw] of EYES) {
      ctx.beginPath(); ctx.ellipse(c[0] + rx * ex, c[1] + ry * 0.04, rx * rw, ry * 0.075, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.line; ctx.stroke();
      ctx.beginPath(); ctx.arc(c[0] + rx * (ex + 0.03), c[1] + ry * 0.04, ry * 0.05, 0, Math.PI * 2); ctx.fillStyle = C.line; ctx.fill();
      line(ctx, [c[0] + rx * (ex - rw - 0.02), c[1] + ry * 0.19], [c[0] + rx * (ex + rw + 0.02), c[1] + ry * 0.15], 3.5, C.hair);
    }
    line(ctx, [c[0] + rx * 0.5, c[1] - ry * 0.02], [c[0] + rx * 0.58, c[1] - ry * 0.2], 2); line(ctx, [c[0] + rx * 0.58, c[1] - ry * 0.2], [c[0] + rx * 0.46, c[1] - ry * 0.22], 2);
    line(ctx, [c[0] + rx * 0.3, c[1] - ry * 0.46], [c[0] + rx * 0.7, c[1] - ry * 0.44], 2.5);
  },
  'eyes-closed': (ctx, R) => {
    const { c, rx, ry } = headBox(R);
    for (const [ex, rw] of EYES) {
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
function shoe(ctx, R, S, fill) {
  const { J } = R; const a = J['ankle' + S], t = J['toe' + S]; const rA = R.P.limb.shin[1] / 2 + 3, h = a[1];
  blob(ctx, [[a[0] - rA, a[1] + h * 0.3, 1], [a[0] + rA, a[1] + h * 0.3, 1], [a[0] + rA + h * 0.14, a[1] - h * 0.28], [lerp(a, t, 0.6)[0], h * 0.6], [t[0] + 2, h * 0.5], [t[0] + h * 0.22, h * 0.22], [t[0] + h * 0.18, 0, 1], [a[0] - rA - h * 0.1, 0, 1], [a[0] - rA - h * 0.12, a[1] - h * 0.32]], 0.4); paint(ctx, fill);
  ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.fillRect(a[0] - 200, -2, 600, 2 + h * 0.14); ctx.restore();
}
/** Which bone each piece hangs on. frame 'bone' = drawn in the bone's own frame; mesh = bent across a bone chain. */
export const PIECE_INFO = {
  cape: { bone: 'cape-1', mesh: 'cape' }, 'cape-collar': { bone: 'chest', cape: 'wrap' }, 'cape-far': { bone: 'cape-far-1', mesh: 'capeFar', cape: 'wrap' },
  'cape-mantle': { bone: 'chest', cape: 'wrap' }, 'cape-near': { bone: 'cape-near-1', mesh: 'capeNear', cape: 'wrap' },
  'upper-far': { bone: 'upper-far' }, 'forearm-far': { bone: 'forearm-far' }, 'hand-far-back': { bone: 'hand-far' }, 'hand-far-front': { bone: 'hand-far' },
  'thigh-far': { bone: 'thigh-far' }, 'shin-far': { bone: 'shin-far' }, 'foot-far': { bone: 'foot-far' }, pelvis: { bone: 'hip' },
  'thigh-near': { bone: 'thigh-near' }, 'shin-near': { bone: 'shin-near' }, 'foot-near': { bone: 'foot-near' }, torso: { bone: 'chest' }, head: { bone: 'head' },
  'eyes-closed': { bone: 'head', slot: 'eyelids' }, 'upper-near': { bone: 'upper-near' }, 'forearm-near': { bone: 'forearm-near' }, 'hand-near': { bone: 'hand-near' },
  staff: { bone: 'staff', slot: 'weapon-far', skin: 'staff' }, gun: { bone: 'gun', slot: 'weapon-near', skin: 'gun', frame: 'bone' }, 'muzzle-flash': { bone: 'gun-muzzle', slot: 'muzzle-flash', skin: 'gun', frame: 'bone' },
};
