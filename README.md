# パデル 3D

遊ぶ: https://naga3.github.io/padel/

ブラウザで遊ぶ 3D のパデル。あなたと CPU のパートナーで、CPU の 2 人と対戦する。three.js 製。

```
npm install
npm run dev      # http://127.0.0.1:5173/
npm run build    # dist/ に静的ファイル（GitHub Pages などにそのまま置ける）
```

## 操作
- 移動: ←↑↓→ / WASD
- 打つ: J / スペース（頭より高い球はスマッシュ）
- ロブ: K（高い球ではバンデハ）
- ドロップ: L
- 打つ瞬間の ←→ で左右の角、↑ で深く強く
- 視点: V　一時停止: Esc（一時停止中にもう一度 Esc でタイトルへ）
- ゲームパッド、スマホのタッチにも対応

## 中身
- `src/physics.js` 球とコート（床・ガラス・金網・ネット）の物理、狙った所に落とす初速の計算
- `src/game.js` ルールの判定、得点、CPU の考え（描画なし。node で動く）
- `src/view.js` three.js の描画　`src/main.js` 画面と進行　`src/input.js` 入力　`src/audio.js` 効果音（WebAudio で合成）

## 確かめ方
- `node tests/sim.mjs [easy|normal|hard] [試合数]` CPU 同士の試合を回して、ラリーの長さと決まり方を数える
- `node tests/human-bot.mjs [level]` 人の操作（移動キーと J）をまねるボットで、人の側の打ち方を確かめる
- `?auto&start` を URL に付けると、あなたの選手も CPU が動かす観戦モードで始まる
