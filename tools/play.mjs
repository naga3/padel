// 人として遊ぶ流れをブラウザで確かめる：サーブを打ち、球に向かって動き、J を押す。
import { chromium } from '/home/naga3/src/etc/slime-lab/node_modules/playwright-core/index.mjs';
const [q = '?start', out = '/tmp/padel-play', secs = '12', cam = '0'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto('http://127.0.0.1:5199/' + q);
await page.waitForTimeout(800);
for (let i = 0; i < Number(cam); i++) await page.keyboard.press('KeyV');
const held = new Set();
const setKey = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } else if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } };
let shots = 0;
for (let t = 0; t < Number(secs) * 10; t++) {
  const s = await page.evaluate(() => {
    const g = __game, h = g.human;
    let mx = 0, my = 0, press = false;
    if (g.state === 'ready' && g.serveInfo.sv === h) press = g.stateT > 0.5;
    if (g.state === 'play' && g.rally.team === 1 && g.plan[0]?.who !== 1) {
      const c = g.intercept(h, g.predict(0), 5.6, 0.1);
      if (c) { const dx = c.x - h.x, dz = c.z - h.z; if (Math.abs(dx) > 0.2) mx = Math.sign(dx); if (Math.abs(dz) > 0.2) my = -Math.sign(dz); }
      const bd = Math.hypot(g.ball.x - h.x, g.ball.z - h.z);
      press = bd < 1.2 + Math.hypot(g.ball.vx, g.ball.vz) * 0.3 && g.ball.z > 0;
    }
    return { mx, my, press, state: g.state, score: g.score.pts.join('-') + ' g' + g.score.games.join('-') };
  });
  await setKey('ArrowRight', s.mx > 0); await setKey('ArrowLeft', s.mx < 0);
  await setKey('ArrowUp', s.my > 0); await setKey('ArrowDown', s.my < 0);
  if (s.press) { await page.keyboard.press('KeyJ'); shots++; }
  if (t % 30 === 0) { await page.screenshot({ path: `${out}-${t / 10}.png` }); console.log(t / 10, s.state, s.score); }
  await page.waitForTimeout(100);
}
console.log('押した回数', shots);
await b.close();
