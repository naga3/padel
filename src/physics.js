// コートと球の物理。描画とは切り離してあり、node でも動く。
// 座標: x = 横（-5..5）、y = 高さ、z = 縦（-10..10）。z > 0 があなたのチームの側。

export const W = 5;            // コート幅の半分（10m）
export const L = 10;           // コート長さの半分（20m）
export const SERVICE = 6.95;   // ネットからサービスラインまで
export const NET_H = 0.88;     // ネットの高さ（中央）
export const NET_H_POST = 0.92;
export const G = 9.81;
export const R = 0.04;         // 球の半径（見た目より少し大きめ）
export const DT = 1 / 240;     // 物理の刻み

const E_FLOOR = 0.74, F_FLOOR = 0.86;  // 反発係数、接線方向に残る割合
const E_GLASS = 0.7, F_GLASS = 0.9;
const E_MESH = 0.3, F_MESH = 0.65;

export const BACK = { glass: 3, top: 4 };

export function netHeight(x) {
  const t = Math.min(1, Math.abs(x) / W);
  return NET_H + (NET_H_POST - NET_H) * t * t;
}

// 横の壁：奥から 2m はガラス 3m＋金網 1m、次の 2m はガラス 2m＋金網 1m、中央は金網 3m
export function sideWallAt(z) {
  const a = Math.abs(z);
  if (a > 8) return { glass: 3, top: 4 };
  if (a > 6) return { glass: 2, top: 3 };
  return { glass: 0, top: 3 };
}

export function makeBall() {
  return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, out: false };
}

function bounceWall(b, axis, mat, rnd) {
  const e = mat === 'glass' ? E_GLASS : E_MESH;
  const f = mat === 'glass' ? F_GLASS : F_MESH;
  if (axis === 'z') { b.vz = -b.vz * e; b.vx *= f; b.vy *= f; }
  else { b.vx = -b.vx * e; b.vz *= f; b.vy *= f; }
  if (mat === 'mesh') {  // 金網は跳ね方が読めない
    const s = Math.hypot(b.vx, b.vy, b.vz) * 0.25;
    b.vy += (rnd() - 0.5) * s;
    if (axis === 'z') b.vx += (rnd() - 0.5) * s; else b.vz += (rnd() - 0.5) * s;
  }
}

// 1 刻み進める。起きたことは ev(type, info) で知らせる。
//   'net' / 'cross'(新しい側の z の符号) / 'floor'(衝突速度) / 'wall'({mat}) / 'out'
export function stepBall(b, dt, ev, rnd = Math.random) {
  const pz = b.z, py = b.y;
  b.vy -= G * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;

  if (b.out) {  // コートの外：床だけ
    if (b.y < R && b.vy < 0) { b.y = R; b.vy = -b.vy * 0.6; b.vx *= 0.8; b.vz *= 0.8; }
    return;
  }

  // ネット
  if (pz !== 0 && (pz > 0) !== (b.z > 0)) {
    const f = pz / (pz - b.z);
    const yc = py + (b.y - py) * f;
    if (yc - R < netHeight(b.x)) {
      const s = Math.sign(pz);
      b.z = s * (R + 0.01);
      b.vz = -b.vz * 0.12; b.vx *= 0.5; b.vy = Math.min(b.vy, 0) * 0.4;
      ev('net');
    } else {
      ev('cross', Math.sign(b.z));
    }
  }

  // 奥の壁
  if (Math.abs(b.z) > L - R) {
    const s = Math.sign(b.z);
    if (b.y < BACK.top) {
      const mat = b.y < BACK.glass ? 'glass' : 'mesh';
      b.z = s * (L - R) - (b.z - s * (L - R));
      bounceWall(b, 'z', mat, rnd);
      ev('wall', { mat, axis: 'z' });
    } else { b.out = true; ev('out'); return; }
  }

  // 横の壁
  if (Math.abs(b.x) > W - R) {
    const s = Math.sign(b.x);
    const w = sideWallAt(b.z);
    if (b.y < w.top) {
      const mat = b.y < w.glass ? 'glass' : 'mesh';
      b.x = s * (W - R) - (b.x - s * (W - R));
      bounceWall(b, 'x', mat, rnd);
      ev('wall', { mat, axis: 'x' });
    } else { b.out = true; ev('out'); return; }
  }

  // 床
  if (b.y < R) {
    b.y = R;
    if (b.vy < 0) {
      const impact = -b.vy;
      b.vy = impact * E_FLOOR;
      b.vx *= F_FLOOR; b.vz *= F_FLOOR;
      if (b.vy < 0.5) b.vy = 0;
      if (impact > 0.3) ev('floor', impact);
    }
    if (b.vy === 0) { b.vx *= 0.995; b.vz *= 0.995; }
  }
}

// from の位置から、床の target (x, z) に落ちる初速を求める。
//   opt.speed: 水平方向の速さ（m/s）、opt.clear: ネットの上に空ける高さ
//   opt.apex: 指定すると、その高さまで上がる山なりの球（ロブ）にする
export function solveShot(from, target, opt) {
  const dx = target.x - from.x, dz = target.z - from.z;
  const D = Math.max(0.3, Math.hypot(dx, dz));
  const y0 = from.y;
  let T, vy;
  if (opt.apex) {
    vy = Math.sqrt(2 * G * Math.max(0.2, opt.apex - y0));
    T = (vy + Math.sqrt(vy * vy + 2 * G * (y0 - R))) / G;
  } else {
    T = D / opt.speed;
    // ネットを越えるのに必要な滞空時間
    if (from.z * target.z < 0) {
      const f = Math.abs(from.z) / Math.abs(from.z - target.z);
      const xn = from.x + dx * f;
      const h = netHeight(xn) + R + (opt.clear ?? 0.3);
      const need = 2 * (h - y0 * (1 - f) - R * f) / (G * f * (1 - f));
      if (need > 0) T = Math.max(T, Math.sqrt(need));
    }
    T = Math.min(T, 3);
    vy = (R - y0 + G * T * T / 2) / T;
  }
  return { vx: dx / T, vy, vz: dz / T, T };
}
