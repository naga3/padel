// three.js での描画。Game の状態を毎フレーム写すだけで、試合の中身には触らない。
import * as THREE from 'three';
import { W, L, SERVICE, NET_H, netHeight } from './physics.js';
import { sgnOf } from './game.js';

const TEAM_COLORS = [
  { shirt: 0x2f7fe0, shorts: 0x1d2c4a, trim: 0xffffff },
  { shirt: 0xe0483a, shorts: 0x3a1a1a, trim: 0xffe066 },
];
const SKIN = [0xf1c7a0, 0xd9a47c, 0xc58a62, 0xe8b893];

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4;
  return t;
}

export class View {
  constructor(canvas) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.camMode = 0;
    this.shake = 0;
    this.build();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 縦長の画面ではコートが収まるよう広角に
    this.camera.fov = w / h < 1 ? 70 : 48;
    this.camera.updateProjectionMatrix();
  }

  build() {
    const s = this.scene;
    // 空：夕暮れのグラデーション
    s.background = canvasTex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#0e1a33'); gr.addColorStop(0.55, '#3b4f80'); gr.addColorStop(0.8, '#e09a6a'); gr.addColorStop(1, '#2a2230');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    s.fog = new THREE.Fog(0x2a2f48, 35, 90);

    s.add(new THREE.HemisphereLight(0xbcd4ff, 0x3a3326, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1dd, 2.2);
    sun.position.set(7, 20, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    s.add(sun);

    // 地面（コートの外）
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    s.add(ground);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(2 * W + 4, 2 * L + 6), new THREE.MeshStandardMaterial({ color: 0x404756, roughness: 0.95 }));
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.005;
    apron.receiveShadow = true;
    s.add(apron);

    // 人工芝
    const turf = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#2d6db5'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 9000; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? 'rgba(20,60,120,0.35)' : 'rgba(90,150,220,0.25)';
        g.fillRect(Math.random() * w, Math.random() * h, 1, 2);
      }
    }, [6, 12]);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * L), new THREE.MeshStandardMaterial({ map: turf, roughness: 0.9 }));
    court.rotation.x = -Math.PI / 2;
    court.receiveShadow = true;
    s.add(court);

    // ライン
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f6fa });
    const line = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.004, z);
      s.add(m);
    };
    line(2 * W, 0.05, 0, SERVICE); line(2 * W, 0.05, 0, -SERVICE);
    line(0.05, 2 * SERVICE + 0.4, 0, 0);

    this.buildNet();
    this.buildWalls();
    this.buildLights();

    // 球
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), new THREE.MeshStandardMaterial({ color: 0xdcf53a, emissive: 0x3a4a00, roughness: 0.5 }));
    this.ball.castShadow = true;
    s.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    s.add(this.ballShadow);
    // 軌跡
    this.trailN = 14;
    this.trailPos = new Float32Array(this.trailN * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    const tc = new Float32Array(this.trailN * 3);
    for (let i = 0; i < this.trailN; i++) { const a = 1 - i / this.trailN; tc.set([0.9 * a, 1 * a, 0.3 * a], i * 3); }
    tg.setAttribute('color', new THREE.BufferAttribute(tc, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }));
    this.trail.frustumCulled = false;
    s.add(this.trail);
    this.trailInit = false;

    // 落下地点の目印
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.28, 32), new THREE.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.8, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.01;
    s.add(this.marker);
    // あなたの足元の輪
    this.youRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: 0x7fd4ff, transparent: true, opacity: 0.75, depthWrite: false }));
    this.youRing.rotation.x = -Math.PI / 2;
    this.youRing.position.y = 0.008;
    s.add(this.youRing);

    // 打った瞬間の光
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.add(this.flash);

    this.figures = [0, 1, 2, 3].map(i => this.buildFigure(i));
  }

  buildNet() {
    const s = this.scene;
    const netTex = canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(20,20,24,0.95)'; g.lineWidth = 3;
      for (let i = 0; i <= w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    }, [80, 7]);
    const geo = new THREE.PlaneGeometry(2 * W, 1, 40, 1);
    // ネットの上端を高さの式に合わせる
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setY(i, y > 0 ? netHeight(x) : 0);
    }
    geo.computeVertexNormals();
    const net = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 1 }));
    net.castShadow = true;
    s.add(net);
    const band = new THREE.Mesh(new THREE.BoxGeometry(2 * W, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    band.position.y = NET_H + 0.01;
    s.add(band);
    for (const x of [-W - 0.04, W + 0.04]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0), new THREE.MeshStandardMaterial({ color: 0x22252c, metalness: 0.6, roughness: 0.4 }));
      post.position.set(x, 0.5, 0);
      s.add(post);
    }
  }

  buildWalls() {
    const s = this.scene;
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
    const glassNear = glassMat.clone(); glassNear.opacity = 0.06;
    const meshTex = canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(30,32,38,1)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    }, [1, 1]);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.5, roughness: 0.5 });
    const meshMat = (w, h) => {
      const t = meshTex.clone(); t.needsUpdate = true; t.repeat.set(w * 6, h * 6);
      return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
    };
    // 面を 1 枚置く。axis 'z' は奥の壁（x 方向に広がる）、'x' は横の壁
    const panel = (axis, c, a0, a1, y0, y1, mat) => {
      const w = a1 - a0, h = y1 - y0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat === 'mesh' ? meshMat(w, h) : mat);
      if (axis === 'z') m.position.set((a0 + a1) / 2, (y0 + y1) / 2, c);
      else { m.position.set(c, (y0 + y1) / 2, (a0 + a1) / 2); m.rotation.y = Math.PI / 2; }
      s.add(m);
      return m;
    };
    const post = (x, z, h) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), frameMat);
      m.position.set(x, h / 2, z);
      m.castShadow = true;
      s.add(m);
    };
    for (const sz of [-1, 1]) {
      const near = sz > 0;   // カメラ側の壁は控えめに
      panel('z', sz * L, -W, W, 0, 3, near ? glassNear : glassMat);
      if (!near) {
        panel('z', sz * L, -W, W, 3, 4, 'mesh');
        for (let x = -W; x <= W + 0.01; x += 2) post(x, sz * L, 4);
      }
      for (const sx of [-1, 1]) {
        const xw = sx * W;
        panel('x', xw, sz > 0 ? 8 : -10, sz > 0 ? 10 : -8, 0, 3, near ? glassNear : glassMat);
        panel('x', xw, sz > 0 ? 6 : -8, sz > 0 ? 8 : -6, 0, 2, near ? glassNear : glassMat);
        if (!near) {
          panel('x', xw, -10, -8, 3, 4, 'mesh');
          panel('x', xw, -8, -6, 2, 3, 'mesh');
        } else {
          panel('x', xw, 6, 8, 2, 3, 'mesh');
        }
        panel('x', xw, sz > 0 ? 0 : -6, sz > 0 ? 6 : 0, 0, 3, 'mesh');
        for (const z of [0, 2, 4, 6, 8]) post(xw, sz * z, z >= 8 && !near ? 4 : 3);
        if (!near) post(xw, sz * 10, 4);
      }
    }
    // ガラスの縁（奥側だけ。ガラスがあることを見せる）
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.55 });
    const edge = (w, x, y, z, rotY = 0) => {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, 0.03), edgeMat);
      e.position.set(x, y, z); e.rotation.y = rotY; s.add(e);
    };
    edge(2 * W, 0, 3, -L);
    for (const sx of [-1, 1]) { edge(2, sx * W, 3, -9, Math.PI / 2); edge(2, sx * W, 2, -7, Math.PI / 2); }
    // 金網の上の手すり
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 12), frameMat);
      rail.position.set(sx * W, 3, -1);
      s.add(rail);
    }
  }

  buildLights() {
    const s = this.scene;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x30343d, metalness: 0.6, roughness: 0.4 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 2 });
    for (const sx of [-1, 1]) for (const z of [-L - 1, -1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7), poleMat);
      pole.position.set(sx * (W + 0.8), 3.5, z);
      s.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.8), lampMat);
      lamp.position.set(sx * (W + 0.5), 7, z);
      lamp.rotation.z = sx * 0.4;
      s.add(lamp);
    }
    // 遠くの観客席（ただの段）
    const standMat = new THREE.MeshStandardMaterial({ color: 0x353a4a, roughness: 1 });
    for (let i = 0; i < 4; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 1.2), standMat);
      st.position.set(0, 0.3 + i * 0.6, -L - 3 - i * 1.2);
      st.receiveShadow = true;
      s.add(st);
      for (const sx of [-1, 1]) {
        const ss = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 14), standMat);
        ss.position.set(sx * (W + 3 + i * 1.2), 0.3 + i * 0.6, -5);
        s.add(ss);
      }
    }
    // 観客：胴と頭だけの人
    const colors = [0xe8d5b0, 0x5577aa, 0xaa5544, 0x66aa77, 0xddcc55, 0x8866aa, 0xeeeeee, 0x334455];
    const spots = [];
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < 36; k++) if (Math.random() > 0.3) spots.push([-8 + k * 0.46, 0.6 + i * 0.6, -L - 3 - i * 1.2]);
      for (const sx of [-1, 1]) for (let k = 0; k < 28; k++) if (Math.random() > 0.4) spots.push([sx * (W + 3 + i * 1.2), 0.6 + i * 0.6, -11.5 + k * 0.45]);
    }
    const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 8), new THREE.MeshStandardMaterial({ roughness: 1 }), spots.length);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshStandardMaterial({ roughness: 1 }), spots.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    spots.forEach(([x, y, z], n) => {
      m.makeTranslation(x, y + 0.21, z); bodies.setMatrixAt(n, m);
      bodies.setColorAt(n, c.setHex(colors[(Math.random() * colors.length) | 0]));
      m.makeTranslation(x, y + 0.52, z); heads.setMatrixAt(n, m);
      heads.setColorAt(n, c.setHex(SKIN[(Math.random() * SKIN.length) | 0]));
    });
    s.add(bodies, heads);
  }

  // 人の形：前が +z、右手は -x 側
  buildFigure(i) {
    const team = i < 2 ? 0 : 1;
    const col = TEAM_COLORS[team];
    const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
    const shirt = std(col.shirt), shorts = std(col.shorts), skin = std(SKIN[i]), shoe = std(0xf0f0f0), hairM = std([0x2a1d14, 0x4a3020, 0x111111, 0x6b4a2a][i]);
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const add = (parent, geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
    };
    // 脚
    const legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(sx * 0.11, 0.9, 0); body.add(hip);
      add(hip, new THREE.CylinderGeometry(0.075, 0.065, 0.45), shorts, 0, -0.2, 0);
      const knee = new THREE.Group(); knee.position.set(0, -0.43, 0); hip.add(knee);
      add(knee, new THREE.CylinderGeometry(0.06, 0.05, 0.42), skin, 0, -0.21, 0);
      add(knee, new THREE.BoxGeometry(0.11, 0.07, 0.24), shoe, 0, -0.43, 0.04);
      legs.push({ hip, knee });
    }
    // 胴
    const torso = new THREE.Group(); torso.position.y = 0.92; body.add(torso);
    add(torso, new THREE.CylinderGeometry(0.2, 0.17, 0.58, 12), shirt, 0, 0.29, 0);
    add(torso, new THREE.BoxGeometry(0.36, 0.06, 0.2), std(col.trim), 0, 0.5, 0);
    add(torso, new THREE.SphereGeometry(0.115, 14, 10), skin, 0, 0.73, 0);
    add(torso, new THREE.SphereGeometry(0.12, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hairM, 0, 0.75, -0.01);
    // 腕
    const arms = [];
    for (const sx of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(sx * 0.24, 0.5, 0); torso.add(sh);
      add(sh, new THREE.CylinderGeometry(0.05, 0.045, 0.3), shirt, 0, -0.15, 0);
      const el = new THREE.Group(); el.position.set(0, -0.3, 0); sh.add(el);
      add(el, new THREE.CylinderGeometry(0.042, 0.038, 0.28), skin, 0, -0.14, 0);
      arms.push({ sh, el });
    }
    // ラケット（右手：-x 側の腕）
    const racket = new THREE.Group();
    racket.position.set(0, -0.3, 0);
    arms[0].el.add(racket);
    add(racket, new THREE.CylinderGeometry(0.018, 0.02, 0.14), std(0x111111), 0, -0.07, 0);
    const head = add(racket, new THREE.CylinderGeometry(0.14, 0.14, 0.035, 20), std(team === 0 ? 0x111827 : 0x1b1b1b), 0, -0.3, 0);
    head.scale.set(1, 1, 1.15);
    head.rotation.x = Math.PI / 2;
    const rim = add(racket, new THREE.TorusGeometry(0.142, 0.012, 6, 24), std(team === 0 ? 0x38bdf8 : 0xfacc15), 0, -0.3, 0);
    rim.scale.set(1, 1.15, 1);
    this.scene.add(root);
    return { root, body, torso, legs, arms, racket };
  }

  // ---- 毎フレーム ----
  render(game, dt, info = {}) {
    const b = game.ball;
    this.ball.position.set(b.x, b.y, b.z);
    this.ballShadow.position.set(b.x, 0.006, b.z);
    const hgt = Math.max(0, b.y);
    this.ballShadow.scale.setScalar(1 + hgt * 0.15);
    this.ballShadow.material.opacity = Math.max(0.12, 0.5 - hgt * 0.07);
    this.ballShadow.visible = Math.abs(b.x) < W + 3 && Math.abs(b.z) < L + 3;

    // 軌跡
    const tp = this.trailPos;
    if (!this.trailInit || game.state === 'ready') { for (let i = 0; i < this.trailN; i++) tp.set([b.x, b.y, b.z], i * 3); this.trailInit = true; }
    tp.copyWithin(3, 0, (this.trailN - 1) * 3);
    tp.set([b.x, b.y, b.z], 0);
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.visible = game.state === 'play' || game.state === 'dead';

    // 落下地点（こちらへ向かってくるときだけ）
    const m = info.marker;
    this.marker.visible = !!m;
    if (m) {
      this.marker.position.x = m.x; this.marker.position.z = m.z;
      this.marker.material.color.setHex(m.mine ? 0xffe14a : 0x9aa4b8);
      const pulse = 1 + Math.sin(performance.now() / 120) * 0.08;
      this.marker.scale.setScalar(pulse);
    }

    for (const p of game.players) this.pose(p, game, dt);
    const you = game.human;
    this.youRing.visible = you.human;
    this.youRing.position.x = you.x; this.youRing.position.z = you.z;

    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 6);
    this.flash.scale.setScalar(1 + (1 - this.flash.material.opacity) * 1.5);

    this.updateCamera(game, dt);
    this.renderer.render(this.scene, this.camera);
  }

  hitFlash(e) {
    this.flash.position.set(e.x, e.y, e.z);
    this.flash.material.opacity = 0.9;
    if (e.kind === 'smash') this.shake = 0.18;
  }

  pose(p, game, dt) {
    const f = this.figures[p.id];
    const s = sgnOf(p.team);
    f.root.position.set(p.x, 0, p.z);
    // 前を向く方向：チーム 0 は -z を向く
    f.root.rotation.y = (s > 0 ? Math.PI : 0) + p.face;
    const sp = Math.hypot(p.vx, p.vz);
    const run = Math.min(1, sp / 4.5);
    const ph = p.run * 2.6;
    const jump = p.jump > 0 ? Math.sin((p.jump / 0.35) * Math.PI) * 0.35 : 0;
    f.body.position.y = jump + Math.abs(Math.sin(ph)) * 0.05 * run - (1 - run) * 0.04;
    // 構え：少し前かがみ、膝を曲げる
    f.body.rotation.x = 0.12 + run * 0.15;
    for (let k = 0; k < 2; k++) {
      const a = Math.sin(ph + k * Math.PI) * 0.75 * run;
      f.legs[k].hip.rotation.x = a - 0.25 * (1 - run);
      f.legs[k].knee.rotation.x = Math.max(0, -Math.sin(ph + k * Math.PI)) * 1.1 * run + 0.4 * (1 - run);
    }
    // 腕：k=0 が右手（ラケット）
    const R = f.arms[0], Lf = f.arms[1];
    Lf.sh.rotation.set(-0.5 - Math.sin(ph) * 0.5 * run, 0, 0.25);
    Lf.el.rotation.set(-0.6, 0, 0);
    f.torso.rotation.set(0, 0, 0);
    // 待っている構え：ラケットを体の前に
    let shX = -0.8, shY = 0, shZ = -0.35, elX = -0.9, twist = 0;
    const sw = p.swing;
    if (sw) {
      const u = Math.max(0, Math.min(1, sw.t / 0.42));
      if (sw.kind === 'fore') {
        // 後ろに引いて → 前へ振り抜く（右側）
        const a = ease(u);
        twist = 0.9 - a * 1.8;
        shX = -1.2; shZ = -1.1 + a * 0.4; shY = 1.4 - a * 3.0; elX = -0.3;
      } else if (sw.kind === 'back') {
        const a = ease(u);
        twist = -1.0 + a * 1.8;
        shX = -1.1; shZ = 0.6 - a * 0.2; shY = -1.6 + a * 2.8; elX = -0.4;
      } else if (sw.kind === 'over') {
        const a = ease(u);
        shX = -2.9 + a * 2.6; shZ = -0.2; elX = -0.6 + a * 0.6; twist = 0.4 - a * 0.8;
        f.body.rotation.x = -0.1 + a * 0.35;
      } else if (sw.kind === 'serve') {
        // t < 0 は構え（球を落とす）、0 から振る
        const a = sw.t < 0 ? 0 : ease(u);
        twist = 0.5 - a * 1.1;
        shX = 0.6 - a * 2.2; shZ = -0.3; elX = -0.2;
      }
    }
    if (p.swing && p.swing.kind === 'serve' && p.swing.t < 0) {
      Lf.sh.rotation.set(-1.2 + (p.swing.t + 0.5) * 1.5, 0, 0.2);
    }
    f.torso.rotation.y = twist;
    R.sh.rotation.set(shX, shY, shZ, 'YXZ');
    R.el.rotation.set(elX, 0, 0);
  }

  updateCamera(game, dt) {
    const you = game.human;
    const c = this.camera;
    let pos, look;
    if (this.camMode === 0) {
      // 後ろから（中継のような高さ）
      pos = new THREE.Vector3(you.x * 0.25 + game.ball.x * 0.1, 7.2, 18.5);
      look = new THREE.Vector3(you.x * 0.15 + game.ball.x * 0.1, 0.2, -1.5);
    } else {
      // 低め：選手のうしろ
      pos = new THREE.Vector3(you.x * 0.6, 3.6, Math.max(you.z, 3) + 7.5);
      look = new THREE.Vector3(you.x * 0.3 + game.ball.x * 0.2, 1.0, -4);
    }
    if (!this.camPos) { this.camPos = pos.clone(); this.camLook = look.clone(); }
    const k = Math.min(1, dt * 3);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    c.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      c.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      c.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    c.lookAt(this.camLook);
  }
}

function ease(u) { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
