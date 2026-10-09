// 画面を撮って確かめる。node tools/shot.mjs <url の後ろ> <出力の接頭辞> <撮る秒（カンマ区切り）>
import { chromium } from '/home/naga3/src/etc/slime-lab/node_modules/playwright-core/index.mjs';
const [q = '', out = '/tmp/padel', times = '1'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await b.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('ERR', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text()); });
await page.goto('http://127.0.0.1:5199/' + q);
let t0 = 0;
for (const t of times.split(',').map(Number)) {
  await page.waitForTimeout((t - t0) * 1000); t0 = t;
  await page.screenshot({ path: `${out}-${t}.png` });
  const s = await page.evaluate(() => window.__game ? { state: __game.state, score: __game.score, hits: __game.stats.hits } : null);
  console.log(t, JSON.stringify(s));
}
await b.close();
