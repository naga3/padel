// CPU 同士で試合をさせて、ラリーの長さや決まり方を数える（描画なし）。
//   node tests/sim.mjs [level] [試合数]
import { Game } from '../src/game.js';
import { DT } from '../src/physics.js';

const level = process.argv[2] || 'normal';
const N = Number(process.argv[3] || 4);
const all = { points: 0, rallies: [], reasons: {}, wins: [0, 0], kinds: {} };
const t0 = Date.now();
for (let m = 0; m < N; m++) {
  const g = new Game({ level, games: 3, auto: true, seed: 1000 + m });
  let steps = 0;
  while (!g.over && steps < 240 * 60 * 30) {
    g.update(DT, {});
    for (const e of g.events) if (e.type === 'hit') all.kinds[e.kind] = (all.kinds[e.kind] || 0) + 1;
    g.events.length = 0;
    steps++;
  }
  all.points += g.stats.points;
  all.rallies.push(...g.stats.rallies);
  for (const [k, v] of Object.entries(g.stats.reasons)) all.reasons[k] = (all.reasons[k] || 0) + v;
  if (g.over) all.wins[g.winner]++;
  console.log(`試合${m + 1}: ${g.score.games.join('-')} ${g.over ? '' : '(終わらず)'} ${(steps * DT / 60).toFixed(1)}分`);
}
const r = all.rallies;
const avg = r.reduce((a, b) => a + b, 0) / r.length;
const hist = {};
for (const x of r) { const k = Math.min(x, 10); hist[k] = (hist[k] || 0) + 1; }
console.log('ポイント数', all.points, '勝ち', all.wins.join('-'));
console.log('ラリーの平均打数', avg.toFixed(2), '最長', Math.max(...r));
console.log('打数の分布', hist);
console.log('決まり方', all.reasons);
console.log('ショット', all.kinds);
console.log('計算時間', Date.now() - t0, 'ms');
