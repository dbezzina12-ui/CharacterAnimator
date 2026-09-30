// Dev: contact sheet of clip frames from the viewer (weapon props auto-attached).
import { chromium } from 'playwright-core';
import { startServer, CHROME, CHROME_ARGS } from '../../scripts/serve.mjs';
const [char, clipsArg, out, samples = '5', az = '35', el = '8', size = '1.0'] = process.argv.slice(2);
const clips = clipsArg.split(',');
const server = await startServer(0);
const browser = await chromium.launch({ executablePath: CHROME, args: CHROME_ARGS });
const S = 300, n = Number(samples);
const page = await browser.newPage({ viewport: { width: S, height: S } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/viewer/index.html?char=${char}&hideui=1`);
await page.waitForFunction(() => window.viewer && (window.viewer.ready || window.viewer.error), null, { timeout: 90000 });
const shots = [];
for (const c of clips) {
  for (let i = 0; i < n; i++) {
    const b64 = await page.evaluate(async ([c, i, n, az, el, size]) => {
      const v = window.viewer; const T = v.THREE; const ch = v.character;
      const clip = ch.clip(c); const t = clip.duration * i / Math.max(1, n - 1) * (n > 1 ? 1 : 0) || (n === 1 ? clip.duration / 2 : 0);
      v.playClip(c, Math.min(t, clip.duration - 1e-3), false);
      if (v.state.props) v.state.props.visible = false;
      const h = ch.height(); const tgt = new T.Vector3(0, h * 0.5, 0); const d = h * 2.3 * size;
      const a = T.MathUtils.degToRad(az), e = T.MathUtils.degToRad(el);
      v.camera.position.set(Math.sin(a) * Math.cos(e) * d, tgt.y + Math.sin(e) * d, Math.cos(a) * Math.cos(e) * d);
      v.camera.fov = 30; v.camera.updateProjectionMatrix(); v.orbit.target.copy(tgt); v.orbit.update();
      v.renderer.render(v.scene, v.camera);
      return v.renderer.domElement.toDataURL('image/png');
    }, [c, i, n, Number(az), Number(el), Number(size)]);
    shots.push(b64);
  }
}
await page.setViewportSize({ width: S * n, height: S * clips.length });
await page.setContent(`<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${n},${S}px)">${shots.map((s) => `<img src="${s}" width=${S} height=${S}>`).join('')}</body>`);
await page.screenshot({ path: out, fullPage: true });
await browser.close(); server.close();
