// 試合の進行：選手、ルールの判定、得点、CPU の考え。描画は持たない（node でも動く）。
import * as P from './physics.js';

export const LEVELS = {
  easy:   { read: 1.9, name: 'よわい', skill: 0.2, speed: 4.3, reaction: 0.32, err: 1.0, lob: 0.3, aggr: 0.25, power: 0.85, letGo: 0.4 },
  normal: { read: 1.4, name: 'ふつう', skill: 0.45, speed: 5.0, reaction: 0.22, err: 0.7, lob: 0.35, aggr: 0.5, power: 1.0, letGo: 0.8 },
  // 味方の CPU は相手の強さによらず、ふつうとつよいの間
  partner: { read: 1.1, name: 'パートナー', skill: 0.55, speed: 5.3, reaction: 0.19, err: 0.55, lob: 0.4, aggr: 0.6, power: 1.0, letGo: 0.9 },
  hard:   { read: 0.95, name: 'つよい', skill: 0.7, speed: 5.7, reaction: 0.15, err: 0.45, lob: 0.4, aggr: 0.75, power: 1.1, letGo: 0.97 },
};
const HUMAN = { speed: 5.6, err: 0.3 };
const ACC = { human: 22, ai: 14 };  // 走りの加速度
const REACH = 1.35;           // ラケットが届く水平距離
const SWING_DUR = 0.42;

export const sgnOf = team => (team === 0 ? 1 : -1);    // 自分の側の z の符号
export const rightOf = team => (team === 0 ? 1 : -1);  // 自分から見た右の x の符号

function gauss(rnd) {
  return Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function pointLabel(a, b, golden) {
  const N = ['0', '15', '30', '40'];
  if (a >= 3 && b >= 3) {
    if (golden || a === b) return a === b ? (golden ? ['40', '40'] : ['デュース', '']) : ['40', '40'];
    return a > b ? ['AD', ''] : ['', 'AD'];
  }
  return [N[Math.min(a, 3)], N[Math.min(b, 3)]];
}

export class Game {
  // opt: { level, games (1|3|6), golden, auto (人も CPU に任せる), seed }
  constructor(opt = {}) {
    this.opt = { level: 'normal', games: 3, golden: true, auto: false, ...opt };
    this.lv = LEVELS[this.opt.level];
    this.lvPartner = this.opt.auto ? this.lv : LEVELS.partner;
    let s = (this.opt.seed ?? (Math.random() * 2 ** 31)) >>> 0;
    this.rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const mk = (id, team, side, name, human) => ({
      id, team, side, name, human, x: 0, z: 0, vx: 0, vz: 0, face: 0,
      swing: null, req: null, plan: null, react: 0, run: 0, jump: 0,
    });
    this.players = [
      mk(0, 0, 'R', 'あなた', !this.opt.auto),
      mk(1, 0, 'L', 'パートナー', false),
      mk(2, 1, 'R', 'CPU 1', false),
      mk(3, 1, 'L', 'CPU 2', false),
    ];
    this.ball = P.makeBall();
    this.score = { pts: [0, 0], games: [0, 0], gameNo: 0, secondServe: false };
    this.events = [];
    this.stats = { points: 0, hits: 0, rallies: [], reasons: {} };
    this.time = 0;
    this.teamMode = ['back', 'back'];
    this.plan = [null, null];   // チームごとの球の予測
    this.newPoint();
  }

  get human() { return this.players[0]; }
  lvOf(p) { return p.team === 0 ? this.lvPartner : this.lv; }
  emit(type, data = {}) { this.events.push({ type, ...data }); }

  server() { return this.players[[0, 2, 1, 3][this.score.gameNo % 4]]; }
  mate(p) { return this.players.find(q => q.team === p.team && q !== p); }
  opps(team) { return this.players.filter(q => q.team !== team); }

  // ---- 得点 ----
  newPoint() {
    const sv = this.server();
    const parity = (this.score.pts[0] + this.score.pts[1]) % 2;
    const ss = sgnOf(sv.team), rs = -ss;
    const sx = rightOf(sv.team) * (parity === 0 ? 1 : -1);  // サーバーの立つ x の符号
    const rt = 1 - sv.team;
    const recv = this.players.find(q => q.team === rt && q.side === (parity === 0 ? 'R' : 'L'));
    const place = (p, x, z) => { p.x = x; p.z = z; p.vx = p.vz = 0; p.swing = null; p.req = null; p.plan = null; };
    place(sv, sx * 1.6, ss * 8.6);
    place(this.mate(sv), -sx * 2.6, ss * 3.4);
    place(recv, -sx * 2.6, rs * 8.9);
    place(this.mate(recv), sx * 2.6, rs * 6.6);
    for (const p of this.players) p.face = 0;
    this.serveInfo = { sv, recv, sx, boxX: -sx };
    this.rally = { team: sv.team, crossed: false, bounces: 0, serve: true, netTouch: false, shot: 0, hits: 0, kind: 'serve' };
    Object.assign(this.ball, { x: sv.x + rightOf(sv.team) * 0.35, y: 1.0, z: sv.z - ss * 0.3, vx: 0, vy: 0, vz: 0, out: false });
    this.teamMode = [sv.team === 0 ? 'net' : 'back', sv.team === 1 ? 'net' : 'back'];
    this.state = 'ready';
    this.stateT = 0;
    this.emit('ready', { humanServes: sv.human, second: this.score.secondServe });
  }

  pointTo(team, reason) {
    if (this.state !== 'play') return;
    this.state = 'dead';
    this.stateT = 0;
    this.stats.points++;
    this.stats.rallies.push(this.rally.hits);
    this.stats.reasons[reason] = (this.stats.reasons[reason] || 0) + 1;
    const sc = this.score;
    sc.secondServe = false;
    sc.pts[team]++;
    const [a, b] = [sc.pts[team], sc.pts[1 - team]];
    let gameWon = a >= 4 && a - b >= (this.opt.golden ? 1 : 2);
    let matchWon = false;
    if (gameWon) {
      sc.games[team]++;
      sc.pts = [0, 0];
      sc.gameNo++;
      const g = sc.games[team], h = sc.games[1 - team], N = this.opt.games;
      matchWon = N === 6 ? (g >= 6 && g - h >= 2) || g === 7 : g >= N;
    }
    this.emit('point', { team, reason, gameWon, matchWon });
    if (matchWon) { this.winner = team; this.over = true; }
  }

  fault(reason) {
    if (this.state !== 'play') return;
    if (this.score.secondServe) { this.pointTo(1 - this.rally.team, 'ダブルフォールト'); return; }
    this.state = 'dead';
    this.stateT = 0;
    this.score.secondServe = true;
    this.faultPending = true;
    this.emit('fault', { reason });
  }

  let() {
    if (this.state !== 'play') return;
    this.state = 'dead';
    this.stateT = 0;
    this.faultPending = true;
    this.emit('let');
  }

  // ---- 球に起きたことの判定 ----
  onBall(type, info) {
    if (this.state !== 'play') return;
    const r = this.rally, b = this.ball;
    const side = b.z > 0 ? 0 : 1;   // 球のある側のチーム
    const opp = 1 - r.team;
    if (type === 'cross') {
      if (!r.crossed && side === opp) r.crossed = true;
      else if (r.crossed && r.bounces >= 1 && side === r.team) this.pointTo(r.team, '球がこちらへ戻ってきた');
    } else if (type === 'net') {
      if (r.serve) r.netTouch = true;
      this.emit('net');
    } else if (type === 'floor') {
      this.emit('floor', { v: info });
      if (!r.crossed) {
        if (r.serve) this.fault(r.netTouch ? 'ネット' : 'フォールト');
        else this.pointTo(opp, r.netTouch || Math.abs(b.z) < 1.5 ? 'ネット' : 'ミス');
      } else if (r.bounces === 0) {
        if (r.serve) {
          const inBox = Math.abs(b.z) < P.SERVICE + P.R && b.x * this.serveInfo.boxX > -P.R;
          if (!inBox) { this.fault('フォールト'); return; }
          if (r.netTouch) { this.let(); return; }
        }
        r.bounces = 1;
        r.bounceAt = { x: b.x, z: b.z };
      } else {
        this.pointTo(r.team, r.serve ? 'サービスエース' : 'ツーバウンド');
      }
    } else if (type === 'wall') {
      this.emit('wall', info);
      if (r.crossed && r.bounces === 0) {
        if (r.serve) this.fault('フォールト');
        else this.pointTo(opp, 'ノーバウンドで壁');
      } else if (r.serve && r.bounces >= 1 && info.mat === 'mesh') {
        this.fault('金網に当たった');
      }
    } else if (type === 'out') {
      if (r.crossed && r.bounces >= 1) this.pointTo(r.team, 'コートの外へ');
      else if (r.serve) this.fault('フォールト');
      else this.pointTo(opp, 'アウト');
    }
  }

  // ---- 打てるかどうか ----
  canHit(p) {
    if (this.state !== 'play') return null;
    const r = this.rally, b = this.ball;
    if (r.team === p.team || !r.crossed || r.bounces >= 2) return null;
    if (r.serve && r.bounces < 1) return null;
    if (b.z * sgnOf(p.team) <= 0) return null;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    const over = b.y > 2.2;
    if (b.y < 0.1 || b.y > (d < 1.0 ? 2.95 : 2.35) || d > (p.human ? REACH : REACH - 0.15)) return null;
    const dn = Math.hypot(b.x + b.vx * 0.02 - p.x, b.z + b.vz * 0.02 - p.z);
    return { d, dn, over };
  }

  // 打つ。shot: { kind, target {x,z}, speed | apex, clear }
  hit(p, shot) {
    const b = this.ball, r = this.rally;
    const v = P.solveShot(b, shot.target, shot);
    b.vx = v.vx; b.vy = v.vy; b.vz = v.vz;
    const volley = r.bounces === 0;
    r.team = p.team; r.crossed = false; r.bounces = 0; r.serve = false; r.netTouch = false;
    r.shot++; r.hits++; r.kind = shot.kind; r.hitter = p.id;
    this.stats.hits++;
    this.lastHit = this.time;
    const rel = (b.x - p.x) * rightOf(p.team);
    p.swing = { t: 0, kind: shot.kind === 'smash' || shot.kind === 'bandeja' || b.y > 1.9 ? 'over' : rel >= 0 ? 'fore' : 'back' };
    p.req = null;
    p.plan = null;
    if (p.swing.kind === 'over' && b.y > 2.3) p.jump = 0.35;
    // 打ったあとの陣形
    const deep = Math.abs(p.z) > 6.3;
    if (['serve', 'lob', 'smash', 'volley', 'bandeja', 'chiquita', 'drop'].includes(shot.kind) || !deep) this.teamMode[p.team] = 'net';
    else this.teamMode[p.team] = 'back';
    if (shot.kind === 'lob' || shot.kind === 'smash') this.teamMode[1 - p.team] = 'back';
    this.plan = [null, null];
    this.emit('hit', { p: p.id, kind: shot.kind, power: Math.hypot(v.vx, v.vz), volley, x: b.x, y: b.y, z: b.z });
  }

  // ---- ショットの組み立て ----
  gapX(team, spread) {
    const os = this.opps(team);
    let best = 0, bs = -1;
    for (let x = -3.8; x <= 3.8; x += 0.4) {
      const s = Math.min(...os.map(o => Math.abs(o.x - x))) + this.rnd() * spread;
      if (s > bs) { bs = s; best = x; }
    }
    return best;
  }

  aiShot(p) {
    const b = this.ball, lv = this.lvOf(p), rnd = this.rnd;
    const os = sgnOf(1 - p.team);
    const depth = Math.abs(p.z);
    const os2 = this.opps(p.team);
    const oppNet = os2.reduce((s, o) => s + Math.abs(o.z), 0) / 2 < 5.2;
    const volley = this.rally.bounces === 0;
    let shot;
    if (b.y > 2.15 && depth < 8) {
      if (depth < 6 && rnd() < lv.aggr) shot = { kind: 'smash', speed: 22 + 5 * rnd(), clear: 0.15, depth: 6 + 2 * rnd(), wideish: true };
      else shot = { kind: 'bandeja', speed: 13 + 2 * rnd(), clear: 0.5, depth: 7.6 + 0.8 * rnd() };
    } else if (volley && depth < 5.5) {
      if (b.y > 1.1 && rnd() < 0.4 + 0.5 * lv.aggr) {
        // 高い球は決めにいく：角度をつけて短く、か、強く深く
        shot = rnd() < 0.5
          ? { kind: 'volley', speed: 15 + 4 * rnd(), clear: 0.15, depth: 3.2 + rnd(), wide: true }
          : { kind: 'volley', speed: 19 + 5 * rnd(), clear: 0.15, depth: 7 + rnd() };
      } else if (!oppNet && rnd() < 0.15 * lv.aggr + 0.05) shot = { kind: 'drop', speed: 7, clear: 0.25, depth: 2 + rnd() };
      else shot = { kind: 'volley', speed: 10 + 3 * rnd(), clear: 0.3, depth: 6.8 + 1.2 * rnd() };
    } else if (oppNet && rnd() < lv.lob) {
      shot = { kind: 'lob', apex: 6.2 + 1.3 * rnd(), depth: 7.6 + 0.9 * rnd() };
    } else if (oppNet) {
      shot = { kind: 'chiquita', speed: 10 + 2 * rnd(), clear: 0.12, depth: 4 + 1.2 * rnd() };
    } else {
      shot = { kind: 'drive', speed: (15 + 4 * rnd()) * lv.power, clear: 0.35, depth: 6.8 + 1.5 * rnd() };
    }
    if (shot.speed) shot.speed *= shot.kind === 'drive' ? 1 : lv.power;
    // 苦しい体勢だと、浮いた甘い球になりやすい
    const c0 = this.canHit(p);
    const vin = Math.hypot(b.vx, b.vy, b.vz);
    const overhead = shot.kind === 'smash' || shot.kind === 'bandeja';
    const pressure = clamp((vin - 11) / 14, 0, 1) * 0.6 + (c0 && c0.d > 1.05 ? 0.3 : 0)
      + (Math.hypot(p.vx, p.vz) > 3.5 ? 0.25 : 0) + (b.y < 0.4 ? 0.3 : 0) + (b.y > 1.9 && !overhead ? 0.2 : 0);
    if (!overhead && rnd() < pressure * (1.05 - lv.skill)) {
      shot = rnd() < 0.5
        ? { kind: 'weak', speed: 8 + 3 * rnd(), clear: 0.9 + 0.9 * rnd(), depth: 4 + 3 * rnd() }
        : { kind: 'weak', apex: 3.6 + 1.2 * rnd(), depth: 5 + 2.5 * rnd() };
    }
    const r = rnd();
    let tx = shot.wide ? (rnd() < 0.5 ? -1 : 1) * 4.3 : shot.wideish ? (rnd() < 0.5 ? -1 : 1) * 3.6 : r < 0.55 ? this.gapX(p.team, 1.5) : r < 0.75 ? (rnd() - 0.5) * 1.5 : -p.x * 0.8;
    // 打ちにくい球ほどぶれる
    let err = lv.err;
    const c = this.canHit(p);
    if (b.y < 0.35 || (b.y > 1.9 && shot.kind !== 'smash' && shot.kind !== 'bandeja')) err *= 1.6;
    if (c && c.d > 1.15) err *= 1.4;
    if (Math.hypot(p.vx, p.vz) > 3) err *= 1.3;
    if (shot.kind === 'smash') err *= 1.2;
    return this.finishShot(shot, tx, os * shot.depth, err);
  }

  finishShot(shot, tx, tz, err) {
    const rnd = this.rnd;
    tx = clamp(tx, -4.5, 4.5) + gauss(rnd) * err;
    tz = tz + gauss(rnd) * err * 0.9;
    shot.target = { x: tx, z: tz };
    if (shot.clear !== undefined) {
      // ネットにかけるのはたまに。打ちにくい球ほど増える
      shot.clear = Math.max(0.03, shot.clear + gauss(rnd) * err * 0.1);
      if (rnd() < 0.04 * err) shot.clear = -0.2;
    }
    if (shot.apex) shot.apex += gauss(rnd) * err * 0.5;
    return shot;
  }

  // 人のショット。kind: 'shot' | 'lob' | 'drop'
  // aim.x: 左右の角を狙う（右が +）、aim.y > 0（↑）: 深く強く
  humanShot(p, kind, aim, quality) {
    const b = this.ball;
    const os = sgnOf(1 - p.team);
    const volley = this.rally.bounces === 0;
    const depth = Math.abs(p.z);
    const up = aim.y > 0.3;
    const high = b.y > 2.15 && depth < 8;
    let shot;
    if (kind === 'lob') {
      // 高い球でロブのボタン → 置きにいくバンデハ
      shot = high ? { kind: 'bandeja', speed: 14, clear: 0.5, depth: 7.8 } : { kind: 'lob', apex: 6.6, depth: up ? 8.4 : 7.9 };
    } else if (kind === 'drop') {
      shot = { kind: volley ? 'drop' : 'chiquita', speed: volley ? 7 : 10, clear: 0.2, depth: volley ? 2.2 : 4 };
    } else if (high) {
      shot = { kind: 'smash', speed: up ? 27 : 23, clear: 0.15, depth: 7 };
      if (up) quality *= 1.3;
    } else if (volley && depth < 5.5) {
      shot = { kind: 'volley', speed: up ? 19 : 15, clear: 0.15, depth: up ? 7.8 : 6 };
    } else {
      shot = { kind: 'drive', speed: up ? 20 : 16.5, clear: 0.35, depth: up ? 8 : 7 };
    }
    // 左右を押していればそちらの角へ、押していなければ相手のいない所へ
    const tx = Math.abs(aim.x) > 0.3 ? Math.sign(aim.x) * 3.6 * rightOf(p.team) : this.gapX(p.team, 0.5) * 0.6;
    return this.finishShot(shot, tx, os * shot.depth, HUMAN.err * quality);
  }

  serveShot(p, aimX) {
    const si = this.serveInfo;
    const rs = sgnOf(1 - p.team);
    const err = p.human ? 0.18 : this.lvOf(p).err * 0.35;
    const second = this.score.secondServe;
    let tx = si.boxX * 2.4 + (aimX || 0) * 1.6 * rightOf(p.team);
    if (!p.human) tx = si.boxX * (1.2 + this.rnd() * 2.6);
    tx = si.boxX > 0 ? clamp(tx, 0.6, 4.4) : clamp(tx, -4.4, -0.6);
    const shot = { kind: 'serve', speed: second ? 11 : 13.5, clear: second ? 0.45 : 0.3, depth: 5.3 + this.rnd() * 0.6 };
    shot.target = { x: tx + gauss(this.rnd) * err, z: rs * shot.depth + gauss(this.rnd) * err };
    if (second) shot.target.z -= rs * 0.6;
    return shot;
  }

  // ---- 球の行き先の予測（CPU が使う） ----
  predict(team) {
    const b = { ...this.ball };
    const r = { ...this.rally };
    const out = [];
    let end = null, t = 0;
    const ev = (type, info) => {
      const side = b.z > 0 ? 0 : 1;
      if (type === 'cross') {
        if (!r.crossed && side !== r.team) r.crossed = true;
        else if (r.crossed && r.bounces >= 1) end = 'back';
      } else if (type === 'floor') {
        if (!r.crossed) end = 'theirFault';
        else if (r.bounces === 0) {
          if (r.serve && !(Math.abs(b.z) < P.SERVICE && b.x * this.serveInfo.boxX > 0)) end = 'theirFault';
          r.bounces = 1;
          r.bx = b.x; r.bz = b.z;
        } else end = 'twoBounce';
      } else if (type === 'wall') {
        if (r.crossed && r.bounces === 0) end = 'theirFault';
      } else if (type === 'out') {
        end = r.crossed && r.bounces >= 1 ? 'out' : 'theirFault';
      }
    };
    const rnd = () => 0.5;
    for (let i = 0; i < 900 && !end; i++) {
      P.stepBall(b, P.DT, ev, rnd);
      t += P.DT;
      if (i % 3 === 0) {
        const legal = r.crossed && (!r.serve || r.bounces >= 1) && b.z * sgnOf(team) > 0 && r.team !== team;
        out.push({ t, x: b.x, y: b.y, z: b.z, legal, bounces: r.bounces });
      }
    }
    return { samples: out, end, bounce: r.bx !== undefined ? { x: r.bx, z: r.bz } : null };
  }

  intercept(p, pred, speed, react) {
    let fb = null;
    const rx = rightOf(p.team), s = sgnOf(p.team);
    for (const q of pred.samples) {
      if (!q.legal || q.y < 0.2 || q.y > 2.75) continue;
      let best = null;
      for (const hand of [1, -1]) {
        const x = clamp(q.x - hand * rx * 0.65, -4.75, 4.75);
        const z = clamp(q.z + s * 0.15, s > 0 ? 1.5 : -9.75, s > 0 ? 9.75 : -1.5);
        const d = Math.hypot(x - p.x, z - p.z);
        if (!best || d < best.d) best = { x, z, d };
      }
      const need = react + best.d / speed + 0.1;
      const slack = q.t - need;
      const comfy = (q.y >= 0.35 && q.y <= 1.75) || (q.y >= 2.15 && Math.abs(q.z) < 7.5);
      const c = { t: q.t, x: best.x, z: best.z, bx: q.x, by: q.y, bz: q.z, slack };
      if (slack >= 0 && comfy) return c;
      if (q.y <= 2.4 && (!fb || slack > fb.slack)) fb = c;
    }
    return fb;
  }

  homeOf(p) {
    const s = sgnOf(p.team);
    const z = s * (this.teamMode[p.team] === 'net' ? 3.2 : 7.7);
    let sideX;
    const mate = this.mate(p);
    if (mate.human) sideX = mate.x > 0 ? -1 : 1;  // 人と反対側を守る
    else sideX = (p.side === 'R' ? 1 : -1) * rightOf(p.team);
    return { x: clamp(sideX * 2.4 + this.ball.x * 0.25, -4.5, 4.5), z };
  }

  // チームの誰が取りに行くかを決める
  planTeam(team) {
    const pred = this.predict(team);
    const ps = this.players.filter(p => p.team === team);
    const shot = this.rally.shot;
    let cur = this.plan[team];
    if (cur && cur.shot !== shot) cur = null;
    const res = { shot, pred, who: cur ? cur.who : null, at: {}, time: this.time };
    for (const p of ps) {
      const sp = p.human ? HUMAN.speed : this.lvOf(p).speed;
      res.at[p.id] = this.intercept(p, pred, sp, 0);
    }
    // 相手のミスになる球は見送る
    if (pred.end === 'theirFault' && (!cur || cur.letGo)) {
      if (cur?.letGo || this.rnd() < this.lvOf(ps[0]).letGo) { res.who = null; res.letGo = true; this.plan[team] = res; return res; }
    }
    if (res.who === null || (res.at[res.who] && res.at[res.who].slack < -0.3)) {
      const [a, b] = ps;
      const ca = res.at[a.id], cb = res.at[b.id];
      if (a.human || b.human) {
        const h = a.human ? a : b, m = a.human ? b : a;
        const c = res.at[m.id] || res.at[h.id];
        if (c) {
          const mid = (h.x + m.x) / 2;
          res.who = Math.sign(c.bx - mid) === Math.sign(m.x - mid) || !res.at[h.id] ? m.id : h.id;
        }
      } else if (ca || cb) {
        const score = c => (c ? (c.slack >= 0 ? -c.t : c.slack * 4 - 10) : -99);
        res.who = score(ca) >= score(cb) ? a.id : b.id;
      }
    }
    this.plan[team] = res;
    return res;
  }

  // ---- 1 刻みの更新 ----
  update(dt, input = {}) {
    this.time += dt;
    this.stateT += dt;
    const b = this.ball;

    if (this.state === 'ready') {
      const sv = this.serveInfo.sv;
      if (sv.human) {
        // サーブ前はサービスラインの後ろで左右に動ける
        const sx = this.serveInfo.sx;
        sv.x = clamp(sv.x + (input.mx || 0) * 3 * dt, sx > 0 ? 0.4 : -4.4, sx > 0 ? 4.4 : -0.4);
        Object.assign(b, { x: sv.x + rightOf(sv.team) * 0.35, y: 1.0, z: sv.z - sgnOf(sv.team) * 0.3, vx: 0, vy: 0, vz: 0 });
        if ((input.shot || input.lob || input.drop) && this.stateT > 0.25) this.startToss();
      } else if (this.stateT > 1.1) this.startToss();
    } else if (this.state === 'toss') {
      P.stepBall(b, dt, () => {}, this.rnd);
      if (this.tossBounced && b.vy < 0.4) {
        const sv = this.serveInfo.sv;
        const shot = this.serveShot(sv, sv.human ? input.mx : 0);
        this.state = 'play';
        this.hit(sv, shot);
        this.rally.serve = true;
        this.rally.kind = 'serve';
        this.rally.hits = 0;
      }
      if (b.y <= P.R + 0.001) this.tossBounced = true;
    } else if (this.state === 'play') {
      P.stepBall(b, dt, (t, i) => this.onBall(t, i), this.rnd);
      if (this.time - this.lastHit > 6) this.pointTo(1 - this.rally.team, '時間切れ');
    } else if (this.state === 'dead') {
      P.stepBall(b, dt, () => {}, this.rnd);
      if (this.stateT > 1.8 && !this.over) {
        this.faultPending = false;
        this.newPoint();
      }
    }

    for (const p of this.players) this.updatePlayer(p, dt, input);
  }

  startToss() {
    const sv = this.serveInfo.sv;
    this.state = 'toss';
    this.stateT = 0;
    this.tossBounced = false;
    Object.assign(this.ball, { x: sv.x + rightOf(sv.team) * 0.4, y: 1.15, z: sv.z - sgnOf(sv.team) * 0.35, vx: 0, vy: 0.5, vz: 0 });
    sv.swing = { t: -0.5, kind: 'serve' };
    this.emit('toss');
  }

  updatePlayer(p, dt, input) {
    if (p.swing) { p.swing.t += dt; if (p.swing.t > SWING_DUR) p.swing = null; }
    if (p.jump > 0) p.jump = Math.max(0, p.jump - dt);
    let tx = p.x, tz = p.z, speed;
    const s = sgnOf(p.team);

    if (p.human) {
      speed = HUMAN.speed;
      if (this.state === 'play' || this.state === 'dead') {
        tx = p.x + (input.mx || 0) * 10;
        tz = p.z - (input.my || 0) * 10;
      }
      if (input.shot || input.lob || input.drop) p.req = { kind: input.lob ? 'lob' : input.drop ? 'drop' : 'shot', t: 0.6 };
      if (p.req) {
        const c = this.canHit(p);
        if (c && (c.d < 0.85 || c.dn > c.d || this.ball.y < 0.3 && this.ball.vy < 0)) {
          const q = 1 + (c.d > 1.1 ? 1.2 : 0) + (this.ball.y < 0.3 ? 0.8 : 0);
          this.hit(p, this.humanShot(p, p.req.kind, { x: input.mx || 0, y: input.my || 0 }, q));
        } else {
          p.req.t -= dt;
          if (p.req.t <= 0) { p.req = null; if (!p.swing && this.state === 'play') p.swing = { t: 0, kind: 'fore', whiff: true }; }
        }
      }
    } else {
      speed = this.lvOf(p).speed;
      const target = this.aiTarget(p, dt);
      tx = target.x; tz = target.z;
    }

    // 走る（加速度に上限）
    const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
    let wx = 0, wz = 0;
    if (dist > 0.03) {
      const v = Math.min(speed, dist * (p.human ? 1 : 5));
      wx = dx / dist * v; wz = dz / dist * v;
    }
    if (p.human && (this.state === 'play' || this.state === 'dead')) {
      const m = Math.hypot(input.mx || 0, input.my || 0);
      if (m > 1) { wx /= m; wz /= m; }
    }
    if (this.state === 'ready' || this.state === 'toss') { wx = wz = 0; }
    const ax = wx - p.vx, az = wz - p.vz, am = Math.hypot(ax, az), lim = (p.human ? ACC.human : ACC.ai) * dt;
    const k = am > lim ? lim / am : 1;
    p.vx += ax * k; p.vz += az * k;
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.x = clamp(p.x, -4.75, 4.75);
    p.z = s > 0 ? clamp(p.z, 0.4, 9.7) : clamp(p.z, -9.7, -0.4);
    p.run += Math.hypot(p.vx, p.vz) * dt;
    // 向き：基本はネット側、球のほうへ少しひねる
    const want = clamp((this.ball.x - p.x) * 0.25, -0.7, 0.7) * -s;
    p.face += (want - p.face) * Math.min(1, dt * 6);
  }

  aiTarget(p, dt) {
    if (this.state !== 'play') {
      if (this.state === 'dead') return this.homeOf(p);
      return { x: p.x, z: p.z };
    }
    const r = this.rally;
    if (r.team === p.team) { p.react = this.lvOf(p).reaction; return this.homeOf(p); }
    // 球が向かってくる：反応の遅れのあとでチームの予定を立て直す
    if (p.readShot !== r.shot) {
      // 球の読みは最初ずれていて、近づくにつれて合ってくる
      p.readShot = r.shot;
      const rd = this.lvOf(p).read;
      p.readOff = { x: gauss(this.rnd) * rd, z: gauss(this.rnd) * rd };
    }
    if (p.react > 0) { p.react -= dt; return p.plan ? { x: p.plan.x, z: p.plan.z } : { x: p.x, z: p.z }; }
    let plan = this.plan[p.team];
    if (!plan || plan.shot !== r.shot || this.time - plan.time > 0.1) {
      plan = this.planTeam(p.team);
    }
    if (plan.who === p.id && plan.at[p.id]) {
      p.plan = plan.at[p.id];
      const c = this.canHit(p);
      if (c && (c.d < 0.85 || c.dn > c.d || (this.ball.y < 0.3 && this.ball.vy < 0))) {
        this.hit(p, this.aiShot(p));
        return this.homeOf(p);
      }
      const left = Math.min(1.2, Math.max(0, p.plan.t - (this.time - plan.time)));
      return { x: p.plan.x + p.readOff.x * left, z: p.plan.z + p.readOff.z * left };
    }
    p.plan = null;
    return this.homeOf(p);
  }
}
