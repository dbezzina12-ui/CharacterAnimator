// Dev: close-ups around a socket (or `bone:<name>`) during a clip at given frames, from several azimuths.
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from '../../scripts/serve.mjs';
const [char, clip, framesArg, out, azs = '0,60,120', dist = '0.35', sock = 'socket_hand_R_prop'] = process.argv.slice(2);
const frames = framesArg.split(',').map(Number), az = azs.split(',').map(Number);
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const S = 320;
const page = await browser.newPage({ viewport: { width: S, height: S } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/index.html?char=${char}&hideui=1`);
await page.waitForFunction(() => window.viewer && (window.viewer.ready || window.viewer.error), null, { timeout: 90000 });
const shots = [];
for (const f of frames) for (const a of az) {
  shots.push(await page.evaluate(([clip, f, a, dist, sock]) => {
    const v = window.viewer, T = v.THREE, ch = v.character;
    v.playClip(clip, f / 30, false);
    if (v.state.props) v.state.props.visible = false;
    const tgt = (sock.startsWith('bone:') ? ch.bones[sock.slice(5)] : ch.sockets[sock]).getWorldPosition(new T.Vector3());
    const r = T.MathUtils.degToRad(a);
    v.camera.position.set(tgt.x + Math.sin(r) * dist, tgt.y + 0.08, tgt.z + Math.cos(r) * dist);
    v.camera.fov = 35; v.camera.updateProjectionMatrix(); v.orbit.target.copy(tgt); v.orbit.update();
    v.renderer.render(v.scene, v.camera);
    return v.renderer.domElement.toDataURL('image/png');
  }, [clip, f, a, Number(dist), sock]));
}
await page.setViewportSize({ width: S * az.length, height: S * frames.length });
await page.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${az.length},${S}px)">${shots.map((s) => `<img src="${s}" width=${S} height=${S}>`).join('')}</body>`);
await page.screenshot({ path: out, fullPage: true });
await browser.close(); server.close();
