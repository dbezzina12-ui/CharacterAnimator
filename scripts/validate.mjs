// Fresh-instance validation of exported character GLBs.
// For every character: new browser context (no storage/session), load ONLY the GLB + its JSON
// in the viewer, run structural / seam / bone-length / socket / helper / grip / press checks
// over every clip, capture pose screenshots (blank + UV checker, several angles), then export
// from the viewer (GLTFExporter, with a texture) and reload that export in another fresh page.
//   node scripts/validate.mjs [characterId ...]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, CHROME, CHROME_ARGS } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ids = process.argv.slice(2).length ? process.argv.slice(2)
  : JSON.parse(fs.readFileSync(path.join(ROOT, 'characters/index.json'), 'utf8')).characters.map((c) => c.id);
const OUT = path.join(ROOT, 'validation');
fs.mkdirSync(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });

async function freshViewer(query, size = [1100, 1100]) {
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] } });   // no shared storage
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon') && !m.text().includes('404')) errors.push(m.text()); });
  await page.goto(`${base}/viewer/index.html?${query}`);
  await page.waitForFunction(() => window.viewer && (window.viewer.ready || window.viewer.error), null, { timeout: 90000 });
  await page.addScriptTag({ type: 'module', url: '/viewer/js/validate.js' });
  await page.waitForFunction(() => window.V);
  return { ctx, page, errors };
}

const SHOTS = {
  poses: ['arms_raised', 'elbows_bent', 'hands_near_face', 'wrist_rotation_finger_curl', 'torso_twist', 'head_turn', 'crouch'],
  angles: [[35, 5], [215, 10]],
  // close-ups: [pose, bone to frame, frame size factor, azimuths]
  focus: [['arms_raised', 'clavicle_L', 0.28, [20, 160, 300]], ['elbows_bent', 'forearm_R', 0.2, [300, 200]],
    ['hands_near_face', 'head', 0.25, [0, 40]], ['wrist_rotation_finger_curl', 'hand_L', 0.14, [30, 120, 240]],
    ['wrist_rotation_finger_curl', 'hand_R', 0.14, [330, 240]], ['torso_twist', 'spine_02', 0.4, [0, 180]],
    ['head_turn', 'neck', 0.22, [60, 200]], ['crouch', 'thigh_L', 0.33, [0, 90, 200, 300]]],
};

async function screenshots(page, id, material) {
  const dir = path.join(OUT, 'screens', id);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  await page.evaluate((m) => window.viewer.setMaterialMode(m), material);
  for (const pose of SHOTS.poses) {
    for (const [az, el] of SHOTS.angles) {
      await page.evaluate(([pose, az, el]) => {
        const v = window.viewer; const T = v.THREE; const ch = v.character;
        const meta = v.state.cfg.animations.find((a) => a.name === '_qa_pose_cycle');
        v.playClip('_qa_pose_cycle', (meta.markers[pose] + 7) / 30, false);
        v.state.props.visible = false;
        const h = ch.height(); const d = h * 1.55; const tgt = new T.Vector3(0, h * 0.55, 0);
        if (pose === 'crouch') tgt.y = h * 0.4;
        const a = T.MathUtils.degToRad(az), e = T.MathUtils.degToRad(el);
        v.camera.position.set(Math.sin(a) * Math.cos(e) * d, tgt.y + Math.sin(e) * d, Math.cos(a) * Math.cos(e) * d);
        v.camera.fov = 40; v.camera.updateProjectionMatrix(); v.orbit.target.copy(tgt); v.orbit.update();
      }, [pose, az, el]);
      await page.waitForTimeout(150);
      const f = path.join(dir, `${material}_${pose}_az${az}.png`);
      await page.locator('#main canvas').screenshot({ path: f });
      files.push(path.relative(OUT, f));
    }
  }
  for (const [pose, bone, size, azs] of SHOTS.focus) {
    for (const az of azs) {
      await page.evaluate(([pose, bone, size, az]) => {
        const v = window.viewer; const T = v.THREE; const ch = v.character;
        const meta = v.state.cfg.animations.find((a) => a.name === '_qa_pose_cycle');
        v.playClip('_qa_pose_cycle', (meta.markers[pose] + 7) / 30, false);
        v.state.props.visible = false;
        const h = ch.height(); const tgt = ch.bones[bone].getWorldPosition(new T.Vector3());
        const d = h * size / (2 * Math.tan(T.MathUtils.degToRad(15)));
        const a = T.MathUtils.degToRad(az);
        v.camera.position.set(tgt.x + Math.sin(a) * d, tgt.y + d * 0.15, tgt.z + Math.cos(a) * d);
        v.camera.fov = 30; v.camera.updateProjectionMatrix(); v.orbit.target.copy(tgt); v.orbit.update();
      }, [pose, bone, size, az]);
      await page.waitForTimeout(120);
      const f = path.join(dir, `${material}_closeup_${pose}_${bone}_az${az}.png`);
      await page.locator('#main canvas').screenshot({ path: f });
      files.push(path.relative(OUT, f));
    }
  }
  return files;
}

// validating a subset (ids on the command line) updates those entries in the existing report
const reportPath = path.join(OUT, 'report.json');
const report = process.argv.slice(2).length && fs.existsSync(reportPath)
  ? Object.assign({ generated: new Date().toISOString(), characters: {} }, JSON.parse(fs.readFileSync(reportPath, 'utf8')))
  : { generated: new Date().toISOString(), characters: {} };
for (const id of ids) {
  const cfgPath = `/characters/${id}/${id}.character.json`;
  const q = `glb=${encodeURIComponent(`/characters/${id}/${id}.glb`)}&config=${encodeURIComponent(cfgPath)}&props=${encodeURIComponent(`/characters/${id}/test_props.glb`)}&hideui=1`;
  const { ctx, page, errors } = await freshViewer(q);
  const res = await page.evaluate(() => window.V.validate({ step: 2 }));
  const shots = [...await screenshots(page, id, id === 'diag_textured_test' ? 'original' : 'blank'), ...await screenshots(page, id, 'checker')];
  // ---- export from the viewer (with an uploaded texture) and reload in a new fresh page
  const exported = await page.evaluate(async () => {
    const v = window.viewer; const T = v.THREE;
    const tex = await new T.TextureLoader().loadAsync('../textures/diagnostic_basecolor_2048.png');
    tex.flipY = false; tex.colorSpace = T.SRGBColorSpace; tex.name = 'diagnostic_basecolor_2048.png';
    v.state.upload = tex;
    const buf = await v.exportGLB();
    const cfg = v.exportConfig();
    let s = ''; const u8 = new Uint8Array(buf); for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return { b64: btoa(s), cfg };
  });
  const rtDir = path.join(OUT, 'roundtrip');
  fs.mkdirSync(rtDir, { recursive: true });
  fs.writeFileSync(path.join(rtDir, `${id}_viewer_export.glb`), Buffer.from(exported.b64, 'base64'));
  fs.writeFileSync(path.join(rtDir, `${id}_viewer_export.character.json`), JSON.stringify(exported.cfg, null, 2));
  await ctx.close();
  const rq = `glb=${encodeURIComponent(`/validation/roundtrip/${id}_viewer_export.glb`)}&config=${encodeURIComponent(`/validation/roundtrip/${id}_viewer_export.character.json`)}&hideui=1`;
  const fresh = await freshViewer(rq);
  const rt = await fresh.page.evaluate(() => window.V.validate({ step: 6 }));
  await fresh.page.evaluate(() => { window.viewer.playClip('reach_grip_handle', 2.0, false); window.viewer.setView('front_three_quarter'); });
  await fresh.page.waitForTimeout(200);
  await fresh.page.locator('#main canvas').screenshot({ path: path.join(rtDir, `${id}_reloaded_textured.png`) });
  await fresh.ctx.close();
  report.characters[id] = { ok: res.ok && errors.length === 0, checks: res.checks, info: res.info, pageErrors: errors, screenshots: shots,
    viewerRoundTrip: { ok: rt.ok, checks: rt.checks.map((c) => ({ id: c.id, ok: c.ok, detail: c.detail })), material: rt.info.material, errors: fresh.errors } };
  const failed = res.checks.filter((c) => !c.ok).map((c) => c.id);
  console.log(`${id}: ${res.checks.length - failed.length}/${res.checks.length} checks passed${failed.length ? ' FAILED: ' + failed.join(', ') : ''}; round-trip ${rt.ok ? 'ok' : 'FAILED ' + rt.checks.filter((c) => !c.ok).map((c) => c.id)}`);
}
report.generated = new Date().toISOString();
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
await browser.close();
server.close();
