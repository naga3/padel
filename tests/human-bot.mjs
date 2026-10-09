// 人の操作（移動キーと J）をまねるボットで、人の側の打ち方が働くか確かめる。
//   node tests/human-bot.mjs [level] [試合数]
import { Game } from '../src/game.js';
import { DT } from '../src/physics.js';

const level = process.argv[2] || 'normal';
const N = Number(process.argv[3] || 3);
let tot = { pts: 0, won: 0, humanHits: 0, whiffs: 0, rallies: [] };
for (let m = 0; m < N; m++) {
  const g = new Game({ level, games: 3, seed: 500 + m });
  const h = g.human;
  let pressCd = 0;
  for (let i = 0; i < 240 * 60 * 20 && !g.over; i++) {
    const inp = { mx: 0, my: 0 };
    if (g.state === 'ready' && g.serveInfo.sv === h && g.stateT > 0.6) inp.shot = true;
    if (g.state === 'play' && g.rally.team === 1) {
      const pred = g.predict(0);
      const plan = g.planTeam(0);
      const c = g.intercept(h, pred, 5.6, 0.15);
      if (plan.who === 0 && c) {
        const dx = c.x - h.x, dz = c.z - h.z, d = Math.hypot(dx, dz);
        if (d > 0.15) { inp.mx = dx / d; inp.my = -dz / d; }
        // 球が近づいたら少し早めに押す
        const bd = Math.hypot(g.ball.x - h.x, g.ball.z - h.z);
        const bs = Math.hypot(g.ball.vx, g.ball.vz); if (pressCd <= 0 && bd < 1.2 + bs * 0.3 && g.ball.z > 0) { inp.shot = true; pressCd = 0.6; }
      }
    } else if (g.state === 'play') {
      const home = g.homeOf(h); const dx = home.x - h.x, dz = home.z - h.z, d = Math.hypot(dx, dz);
      if (d > 0.3) { inp.mx = dx / d; inp.my = -dz / d; }
    }
    pressCd -= DT;
    g.update(DT, inp);
    for (const e of g.events) {
      if (e.type === 'hit' && e.p === 0) tot.humanHits++;
      if (e.type === 'point') { tot.pts++; if (e.team === 0) tot.won++; }
    }
    if (h.swing?.whiff && h.swing.t === DT) tot.whiffs++;
    g.events.length = 0;
  }
  tot.rallies.push(...g.stats.rallies);
  console.log(`試合${m + 1}: ${g.score.games.join('-')} 決まり方`, g.stats.reasons);
}
const avg = tot.rallies.reduce((a, b) => a + b, 0) / tot.rallies.length;
console.log(`ポイント ${tot.won}/${tot.pts} 人が打った数 ${tot.humanHits} 空振り ${tot.whiffs} ラリー平均 ${avg.toFixed(1)}`);
