import { Game, LEVELS, pointLabel } from './game.js';
import { DT } from './physics.js';
import { View } from './view.js';
import { Input } from './input.js';
import { initAudio, sfx } from './audio.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const view = new View($('c'));
const input = new Input();
let game = null;
let paused = false;
let markerT = 0, marker = null;

// ---- 設定 ----
const settings = Object.assign({ level: 'normal', games: '3', golden: '1' }, JSON.parse(localStorage.getItem('padel3d.settings') || '{}'));
for (const seg of document.querySelectorAll('.seg')) {
  const key = seg.dataset.key;
  const sync = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.v === settings[key]));
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[key] = b.dataset.v;
    localStorage.setItem('padel3d.settings', JSON.stringify(settings));
    sync();
  });
  sync();
}

const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) input.bindTouch($('stick'), $('knob'), $('tShot'), $('tLob'), $('tDrop'));

function start() {
  initAudio();
  game = new Game({ level: settings.level, games: Number(settings.games), golden: settings.golden === '1', auto: params.has('auto') });
  $('title').classList.add('hidden');
  $('result').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('score').classList.remove('hidden');
  $('camBtn').classList.remove('hidden');
  $('touch').classList.toggle('hidden', !isTouch);
  $('hint').style.bottom = isTouch ? '230px' : '';
  paused = false;
  window.__game = game;
  drainEvents();
  updateScore();
}

function toTitle() {
  game = null;
  paused = false;
  $('pause').classList.add('hidden');
  $('result').classList.add('hidden');
  $('score').classList.add('hidden');
  $('camBtn').classList.add('hidden');
  $('touch').classList.add('hidden');
  $('title').classList.remove('hidden');
  $('hint').textContent = '';
  showMsg('', '', 0);
}

function setPause(on) {
  if (!game || game.over) return;
  paused = on;
  $('pause').classList.toggle('hidden', !on);
}

$('start').onclick = start;
$('again').onclick = start;
$('resTitleBtn').onclick = toTitle;
$('resume').onclick = () => setPause(false);
$('toTitle').onclick = toTitle;
$('bCam').onclick = () => { view.camMode = (view.camMode + 1) % 2; };
$('bPause').onclick = () => setPause(true);

// ---- メッセージ ----
let msgTimer = 0;
function showMsg(big, small = '', sec = 1.6) {
  $('msgBig').textContent = big;
  $('msgSmall').textContent = small;
  $('msg').classList.toggle('off', !big);
  msgTimer = sec;
}

function updateScore() {
  if (!game) return;
  const sc = game.score;
  const [a, b] = pointLabel(sc.pts[0], sc.pts[1], game.opt.golden);
  $('p0').textContent = a; $('p1').textContent = b;
  $('g0').textContent = sc.games[0]; $('g1').textContent = sc.games[1];
  const sv = game.server();
  $('srv0').textContent = sv.team === 0 ? '● サーブ' : '';
  $('srv1').textContent = sv.team === 1 ? '● サーブ' : '';
  const N = game.opt.games;
  const len = N === 1 ? '1 ゲーム' : N === 3 ? '3 ゲーム先取' : '1 セット';
  const gp = sc.pts[0] >= 3 && sc.pts[1] >= 3 && sc.pts[0] === sc.pts[1] && game.opt.golden ? '　ゴールデンポイント' : '';
  $('info').textContent = `${LEVELS[game.opt.level].name}・${len}${gp}`;
}

const KIND = { smash: 'スマッシュ', bandeja: 'バンデハ', lob: 'ロブ', volley: 'ボレー', drop: 'ドロップ', chiquita: 'チキータ', drive: 'ドライブ', weak: '', serve: '' };

function drainEvents() {
  for (const e of game.events) {
    switch (e.type) {
      case 'hit':
        sfx(e.kind === 'smash' ? 'smash' : 'hit', e.power / 16);
        view.hitFlash(e);
        break;
      case 'floor': sfx('floor', e.v / 6); break;
      case 'wall': sfx(e.mat === 'glass' ? 'glass' : 'mesh'); break;
      case 'net': sfx('net'); break;
      case 'toss': sfx('toss'); break;
      case 'fault':
        showMsg('フォールト', e.reason !== 'フォールト' ? e.reason : 'セカンドサーブ');
        sfx('sigh');
        break;
      case 'let':
        showMsg('レット', 'ネットに触れたのでサーブをやり直し');
        break;
      case 'point': {
        const mine = e.team === 0;
        if (e.matchWon) {
          showMsg(mine ? '勝ち！' : '負け…', e.reason, 2.5);
          sfx(mine ? 'cheer' : 'sigh');
          setTimeout(() => showResult(), 1800);
        } else if (e.gameWon) {
          showMsg(mine ? 'ゲーム獲得！' : 'ゲームを取られた', e.reason, 2);
          sfx(mine ? 'cheer' : 'sigh');
          sfx('chime');
        } else {
          showMsg(mine ? 'ポイント！' : '失点', e.reason);
          sfx(mine ? 'cheer' : 'sigh');
        }
        updateScore();
        break;
      }
      case 'ready':
        updateScore();
        if (e.humanServes) $('hint').textContent = (e.second ? 'セカンドサーブ　' : '') + (isTouch ? '「打つ」でサーブ' : 'J / スペースでサーブ（←→ で狙いと立ち位置）');
        else $('hint').textContent = e.second ? 'セカンドサーブ' : '';
        break;
    }
    if (e.type === 'hit' || e.type === 'toss') $('hint').textContent = '';
  }
  game.events.length = 0;
}

function showResult() {
  if (!game) return;
  const w = game.winner === 0;
  $('resTitle').textContent = w ? '勝ち！' : '負け…';
  $('resSub').textContent = `ゲーム ${game.score.games[0]} - ${game.score.games[1]}（相手：${LEVELS[game.opt.level].name}）`;
  $('result').classList.remove('hidden');
  showMsg('', '', 0);
}

// こちらに向かってくる球の落下地点
function computeMarker() {
  const r = game.rally;
  if (game.state !== 'play' || r.team === 0 || r.bounces > 0 || !game.human.human) return null;
  const pred = game.predict(0);
  if (!pred.bounce || pred.bounce.z <= 0) return null;
  const plan = game.plan[0];
  const mine = !(plan && plan.shot === r.shot && plan.who === 1);
  return { x: pred.bounce.x, z: pred.bounce.z, mine };
}

// ---- ループ ----
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (input.pressed('Escape', 'KeyP')) {
    if (game && !game.over) {
      if (!paused) setPause(true);
      else if (input.pressed('Escape')) toTitle();
      else setPause(false);
    } else if (game && game.over) toTitle();
  }
  if (input.pressed('KeyV') && game) view.camMode = (view.camMode + 1) % 2;
  if (!game && input.pressed('Enter', 'Space')) start();
  else if (game && game.over && !$('result').classList.contains('hidden') && input.pressed('Enter')) start();

  if (game && !paused) {
    const inp = input.read();
    acc += dt;
    let first = true;
    while (acc >= DT) {
      game.update(DT, first ? inp : { mx: inp.mx, my: inp.my });
      first = false;
      acc -= DT;
    }
    drainEvents();
    markerT -= dt;
    if (markerT <= 0) { marker = computeMarker(); markerT = 0.05; }
    if (game.state !== 'play') marker = null;
  }
  input.endFrame();

  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').classList.add('off'); }

  if (game) view.render(game, dt, { marker });
  else {
    // タイトル画面の後ろでは CPU 同士の試合を流す
    if (!view.demo) view.demo = new Game({ auto: true, level: 'normal' });
    const d = view.demo;
    for (let t = 0; t < dt; t += DT) d.update(DT, {});
    d.events.length = 0;
    if (d.over) view.demo = null;
    view.render(d, dt, {});
  }
}
requestAnimationFrame(frame);

if (params.has('start')) start();
