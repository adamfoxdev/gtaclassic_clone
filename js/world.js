'use strict';
// City map: generation, tile queries, cached ground rendering and pseudo-3D buildings.

const T = 64;          // tile size in world pixels
const P = 14;          // grid period: 4 road tiles + 10 block tiles
const NB = 7;          // blocks per axis
const OFF = 4;         // water margin in tiles
const MW = OFF * 2 + NB * P + 4;
const CH = 8;          // tiles per cached ground chunk
const TL = { WATER: 0, ROAD: 1, SIDEWALK: 2, GRASS: 3, BUILDING: 4, LOT: 5, PLAZA: 6 };
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N

const roadStart = k => (OFF + k * P) * T;
// Right-hand traffic: lane centre (cross-axis coordinate) for a direction on road k.
function laneCoord(dir, k) { return roadStart(k) + ((dir === 0 || dir === 3) ? 3 * T : T); }
function inRoadSpan(t) { const r = t - OFF; return r >= 0 && r < NB * P + 4 && r % P < 4; }
const isSolidT = t => t === TL.BUILDING || t === TL.WATER;
const pedWalkable = t => t === TL.SIDEWALK || t === TL.GRASS || t === TL.LOT || t === TL.PLAZA;

const WALL_COLORS = [[150, 120, 100], [120, 112, 104], [172, 160, 138], [108, 120, 138], [146, 92, 80],
  [92, 102, 112], [182, 172, 150], [100, 112, 96], [160, 140, 110], [128, 100, 120]];
const ROOF_COLORS = [[84, 84, 90], [98, 92, 86], [72, 78, 84], [112, 102, 92], [64, 68, 74], [90, 96, 88]];

const World = {
  tiles: new Uint8Array(MW * MW),
  heights: new Float32Array(MW * MW), // building height per tile (0 = open ground)
  buildings: [], trees: [], spots: [], barrelSpots: [], walkTiles: [], lotLines: new Set(),
  chunks: new Map(), minimap: null, hospital: null, station: null,

  tile(tx, ty) { return (tx < 0 || ty < 0 || tx >= MW || ty >= MW) ? TL.WATER : this.tiles[ty * MW + tx]; },
  set(tx, ty, v) { if (tx >= 0 && ty >= 0 && tx < MW && ty < MW) this.tiles[ty * MW + tx] = v; },
  at(x, y) { return this.tile(Math.floor(x / T), Math.floor(y / T)); },
  solid(x, y) { return isSolidT(this.at(x, y)); },
  solidTile(tx, ty) { return isSolidT(this.tile(tx, ty)); },
  heightAt(x, y) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    return (tx < 0 || ty < 0 || tx >= MW || ty >= MW) ? 0 : this.heights[ty * MW + tx];
  },

  gen(seed) {
    const R = mulberry32(seed);
    this.tiles.fill(TL.WATER);
    const lo = OFF - 1, hi = OFF + NB * P + 4;
    for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) this.set(x, y, TL.SIDEWALK);
    for (let y = OFF; y < hi; y++) for (let x = OFF; x < hi; x++) if (inRoadSpan(x) || inRoadSpan(y)) this.set(x, y, TL.ROAD);

    const mid = NB / 2;
    for (let by = 0; by < NB; by++) for (let bx = 0; bx < NB; bx++) {
      const x0 = OFF + bx * P + 4, y0 = OFF + by * P + 4;
      const dc = Math.hypot(bx + 0.5 - mid, by + 0.5 - mid) / mid;
      const q = R();
      const type = q < 0.13 ? 'park' : q < 0.27 ? 'lot' : (q < 0.37 && dc < 0.75) ? 'plaza' : 'city';
      this.block(type, x0 + 1, y0 + 1, R, dc);
      // A couple of barrels on the block's sidewalk ring.
      for (let i = 0; i < 2; i++) if (R() < 0.45) {
        const side = Math.floor(R() * 4), o = 1 + Math.floor(R() * 8);
        const tx = side === 0 ? x0 + o : side === 1 ? x0 + 9 : side === 2 ? x0 + o : x0;
        const ty = side === 0 ? y0 : side === 1 ? y0 + o : side === 2 ? y0 + 9 : y0 + o;
        this.barrelSpots.push({ x: tx * T + 32, y: ty * T + 32 });
      }
    }

    for (let y = 0; y < MW; y++) for (let x = 0; x < MW; x++) {
      const t = this.tile(x, y);
      if (t === TL.SIDEWALK || t === TL.PLAZA) this.walkTiles.push([x, y]);
    }
    const nearest = (px, py) => {
      let best = null, bd = 1e9;
      for (const [x, y] of this.walkTiles) {
        if (this.tile(x, y) !== TL.SIDEWALK) continue;
        const d = Math.hypot(x - px, y - py);
        if (d < bd) { bd = d; best = { x: x * T + 32, y: y * T + 32 }; }
      }
      return best;
    };
    this.hospital = nearest(MW / 2, MW / 2);
    this.station = nearest(MW * 0.25, MW * 0.3);
    this.buildMinimap();
  },

  block(type, ix, iy, R, dc) {
    const S = 8;
    const rr = (a, b) => a + R() * (b - a);
    const ri = (a, b) => Math.floor(rr(a, b + 1));
    const rp = arr => arr[Math.floor(R() * arr.length)];
    const fill = (x, y, w, h, v) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, v); };
    const tree = (tx, ty, j = 12) => this.trees.push({ x: tx * T + 32 + rr(-j, j), y: ty * T + 32 + rr(-j, j), r: rr(16, 28), s: R() });
    const addB = (x, y, w, h, height) => {
      fill(x, y, w, h, TL.BUILDING);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.heights[(y + j) * MW + x + i] = height;
      const feats = [];
      if (height > 220 && w >= 3 && h >= 3 && R() < 0.6) feats.push({ t: 'heli' });
      else {
        const n = ri(1, 4);
        for (let i = 0; i < n; i++) {
          const fw = rr(12, 26), fh = rr(10, 20);
          feats.push({ t: 'ac', x: x * T + rr(10, w * T - fw - 10), y: y * T + rr(10, h * T - fh - 10), w: fw, h: fh });
        }
        if (R() < 0.35) feats.push({ t: 'tank', x: x * T + rr(24, w * T - 24), y: y * T + rr(24, h * T - 24) });
      }
      this.buildings.push({ x: x * T, y: y * T, w: w * T, h: h * T, height, color: rp(WALL_COLORS), roof: rp(ROOF_COLORS), lit: R(), feats });
    };

    if (type === 'city') {
      const hBase = lerp(300, 80, clamp(dc, 0, 1));
      const split = (x, y, w, h, d) => {
        if (d < 3 && (w >= 5 || h >= 5) && R() < 0.85) {
          const vert = w === h ? R() < 0.5 : w > h;
          const alley = R() < 0.45 ? 1 : 0;
          const len = vert ? w : h;
          const s = ri(2, len - 2 - alley);
          if (vert) {
            split(x, y, s, h, d + 1);
            if (alley) { fill(x + s, y, 1, h, TL.LOT); if (R() < 0.5) this.barrelSpots.push({ x: (x + s) * T + 32, y: (y + ri(0, h - 1)) * T + 32 }); }
            split(x + s + alley, y, w - s - alley, h, d + 1);
          } else {
            split(x, y, w, s, d + 1);
            if (alley) { fill(x, y + s, w, 1, TL.LOT); if (R() < 0.5) this.barrelSpots.push({ x: (x + ri(0, w - 1)) * T + 32, y: (y + s) * T + 32 }); }
            split(x, y + s + alley, w, h - s - alley, d + 1);
          }
        } else if (w * h <= 6 && R() < 0.2) {
          fill(x, y, w, h, TL.PLAZA);
          tree(x + (w - 1) / 2, y + (h - 1) / 2, 4);
        } else {
          addB(x, y, w, h, clamp(hBase * rr(0.55, 1.25), 50, 380));
        }
      };
      split(ix, iy, S, S, 0);
    } else if (type === 'park') {
      fill(ix, iy, S, S, TL.GRASS);
      fill(ix, iy + 3, S, 2, TL.PLAZA);
      fill(ix + 3, iy, 2, S, TL.PLAZA);
      if (R() < 0.4) fill(ix + (R() < 0.5 ? 0 : 5), iy + (R() < 0.5 ? 0 : 5), 3, 3, TL.WATER);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++)
        if (this.tile(ix + i, iy + j) === TL.GRASS && R() < 0.4) tree(ix + i, iy + j);
    } else if (type === 'lot') {
      fill(ix, iy, S, S, TL.LOT);
      for (const row of [0, 3, 4, 7]) {
        const ty = iy + row;
        for (let i = 0; i < S; i++) {
          const tx = ix + i;
          this.lotLines.add(ty * MW + tx);
          for (const k of [0, 1]) this.spots.push({ x: tx * T + 16 + k * 32, y: ty * T + 32, ang: (row === 0 || row === 4) ? Math.PI / 2 : -Math.PI / 2, car: null, cool: 0 });
        }
      }
      this.barrelSpots.push({ x: ix * T + 20, y: (iy + 1) * T + 40 });
      if (R() < 0.6) this.barrelSpots.push({ x: (ix + S) * T - 20, y: (iy + 5) * T + 40 });
    } else if (type === 'plaza') {
      fill(ix, iy, S, S, TL.PLAZA);
      addB(ix + 2, iy + 2, 4, 4, rr(300, 390));
      for (const [a, b] of [[0, 0], [7, 0], [0, 7], [7, 7], [3.5, 0], [3.5, 7], [0, 3.5], [7, 3.5]]) tree(ix + a, iy + b, 3);
    }
  },

  buildMinimap() {
    const c = document.createElement('canvas');
    c.width = c.height = MW;
    const g = c.getContext('2d');
    const img = g.createImageData(MW, MW);
    const cols = { 0: [29, 78, 120], 1: [52, 52, 56], 2: [140, 140, 134], 3: [61, 122, 51], 4: [176, 160, 128], 5: [80, 80, 86], 6: [160, 154, 136] };
    for (let i = 0; i < MW * MW; i++) {
      const col = cols[this.tiles[i]];
      img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.minimap = c;
  },

  // ---------- ground rendering (cached in chunk canvases, LRU) ----------
  getChunk(cx, cy) {
    const key = cx * 1000 + cy;
    let c = this.chunks.get(key);
    if (c) { this.chunks.delete(key); this.chunks.set(key, c); return c; }
    c = document.createElement('canvas');
    c.width = c.height = CH * T;
    const g = c.getContext('2d');
    for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) this.drawTile(g, cx * CH + i, cy * CH + j, i * T, j * T);
    this.chunks.set(key, c);
    if (this.chunks.size > 72) this.chunks.delete(this.chunks.keys().next().value);
    return c;
  },

  speckle(g, tx, ty, px, py, n, color, size = 2) {
    g.fillStyle = color;
    for (let i = 0; i < n; i++) g.fillRect(px + hash(tx, ty, i * 2 + 1) * (T - size), py + hash(tx, ty, i * 2 + 2) * (T - size), size, size);
  },

  drawTile(g, tx, ty, px, py) {
    const t = this.tile(tx, ty);
    switch (t) {
      case TL.WATER: {
        g.fillStyle = '#1d4e78'; g.fillRect(px, py, T, T);
        g.fillStyle = 'rgba(255,255,255,0.07)';
        for (let i = 0; i < 4; i++) g.fillRect(px + hash(tx, ty, i) * 44, py + hash(tx, ty, i + 7) * 60, 10 + hash(tx, ty, i + 3) * 12, 2);
        g.fillStyle = 'rgba(220,240,255,0.25)';
        if (this.tile(tx, ty - 1) !== TL.WATER) g.fillRect(px, py, T, 4);
        if (this.tile(tx, ty + 1) !== TL.WATER) g.fillRect(px, py + T - 4, T, 4);
        if (this.tile(tx - 1, ty) !== TL.WATER) g.fillRect(px, py, 4, T);
        if (this.tile(tx + 1, ty) !== TL.WATER) g.fillRect(px + T - 4, py, 4, T);
        break;
      }
      case TL.ROAD: {
        g.fillStyle = '#39393e'; g.fillRect(px, py, T, T);
        this.speckle(g, tx, ty, px, py, 14, 'rgba(0,0,0,0.18)');
        this.speckle(g, tx + 99, ty, px, py, 8, 'rgba(255,255,255,0.05)');
        const vr = inRoadSpan(tx), hr = inRoadSpan(ty);
        if (vr && hr) break;
        const lx = (tx - OFF) % P, ly = (ty - OFF) % P;
        if (vr) {
          const up = inRoadSpan(ty - 1) && this.tile(tx, ty - 1) === TL.ROAD, dn = inRoadSpan(ty + 1) && this.tile(tx, ty + 1) === TL.ROAD;
          if (up || dn) {
            const y0 = up ? py + 4 : py + T - 32;
            g.fillStyle = 'rgba(230,230,225,0.8)';
            for (let sx = 4; sx < T; sx += 16) g.fillRect(px + sx, y0, 8, 28);
          } else {
            g.fillStyle = '#d8b02a';
            if (lx === 1) g.fillRect(px + T - 4, py, 2, T);
            if (lx === 2) g.fillRect(px + 2, py, 2, T);
            g.fillStyle = 'rgba(230,230,225,0.45)';
            if (lx === 0) g.fillRect(px + 5, py, 2, T);
            if (lx === 3) g.fillRect(px + T - 7, py, 2, T);
          }
        } else if (hr) {
          const lf = inRoadSpan(tx - 1) && this.tile(tx - 1, ty) === TL.ROAD, rt = inRoadSpan(tx + 1) && this.tile(tx + 1, ty) === TL.ROAD;
          if (lf || rt) {
            const x0 = lf ? px + 4 : px + T - 32;
            g.fillStyle = 'rgba(230,230,225,0.8)';
            for (let sy = 4; sy < T; sy += 16) g.fillRect(x0, py + sy, 28, 8);
          } else {
            g.fillStyle = '#d8b02a';
            if (ly === 1) g.fillRect(px, py + T - 4, T, 2);
            if (ly === 2) g.fillRect(px, py + 2, T, 2);
            g.fillStyle = 'rgba(230,230,225,0.45)';
            if (ly === 0) g.fillRect(px, py + 5, T, 2);
            if (ly === 3) g.fillRect(px, py + T - 7, T, 2);
          }
        }
        break;
      }
      case TL.SIDEWALK: {
        g.fillStyle = '#8e8d88'; g.fillRect(px, py, T, T);
        this.speckle(g, tx, ty, px, py, 10, 'rgba(0,0,0,0.08)');
        g.fillStyle = 'rgba(0,0,0,0.12)';
        g.fillRect(px, py + 31, T, 2); g.fillRect(px + 31, py, 2, T);
        g.fillRect(px, py, T, 1); g.fillRect(px, py, 1, T);
        g.fillStyle = '#b3b1aa';
        if (this.tile(tx, ty - 1) === TL.ROAD) g.fillRect(px, py, T, 5);
        if (this.tile(tx, ty + 1) === TL.ROAD) g.fillRect(px, py + T - 5, T, 5);
        if (this.tile(tx - 1, ty) === TL.ROAD) g.fillRect(px, py, 5, T);
        if (this.tile(tx + 1, ty) === TL.ROAD) g.fillRect(px + T - 5, py, 5, T);
        break;
      }
      case TL.GRASS: {
        g.fillStyle = '#3d7a33'; g.fillRect(px, py, T, T);
        this.speckle(g, tx, ty, px, py, 22, 'rgba(20,50,15,0.35)', 3);
        this.speckle(g, tx + 50, ty, px, py, 16, 'rgba(120,180,80,0.3)', 2);
        break;
      }
      case TL.LOT: {
        g.fillStyle = '#46464b'; g.fillRect(px, py, T, T);
        this.speckle(g, tx, ty, px, py, 14, 'rgba(0,0,0,0.18)');
        if (this.lotLines.has(ty * MW + tx)) {
          g.fillStyle = 'rgba(235,235,230,0.75)';
          g.fillRect(px, py + 4, 2, T - 8); g.fillRect(px + 32, py + 4, 2, T - 8);
        }
        if (hash(tx, ty, 77) < 0.25) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(px + 20 + hash(tx, ty, 3) * 24, py + 20 + hash(tx, ty, 4) * 24, 9, 6, 0, 0, TAU); g.fill(); }
        break;
      }
      case TL.PLAZA: {
        g.fillStyle = '#a7a08f'; g.fillRect(px, py, T, T);
        g.fillStyle = 'rgba(0,0,0,0.07)';
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if ((i + j) % 2) g.fillRect(px + i * 16, py + j * 16, 16, 16);
        break;
      }
      case TL.BUILDING:
        g.fillStyle = '#26262a'; g.fillRect(px, py, T, T);
        break;
    }
  },

  // ---------- trees & buildings (drawn above entities) ----------
  drawTrees(ctx, cx, cy, v) {
    for (const t of this.trees) {
      if (t.x < v.x0 - 60 || t.x > v.x1 + 60 || t.y < v.y0 - 60 || t.y > v.y1 + 60) continue;
      const x = cx + (t.x - cx) * 1.06, y = cy + (t.y - cy) * 1.06;
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; circle(ctx, t.x + 9, t.y + 9, t.r);
      ctx.fillStyle = '#29561f'; circle(ctx, x, y, t.r);
      ctx.fillStyle = '#377328'; circle(ctx, x - t.r * 0.18, y - t.r * 0.2, t.r * 0.72);
      ctx.fillStyle = '#4b9136'; circle(ctx, x - t.r * 0.32, y - t.r * 0.34, t.r * 0.34);
    }
  },

  drawBuildings(ctx, cx, cy, v) {
    const list = [];
    for (const b of this.buildings) {
      const m = 40 + b.height * 0.5;
      if (b.x > v.x1 + m || b.x + b.w < v.x0 - m || b.y > v.y1 + m || b.y + b.h < v.y0 - m) continue;
      list.push(b);
    }
    list.sort((a, b) => a.height - b.height);
    for (const b of list) this.drawBuilding(ctx, b, cx, cy);
  },

  drawBuilding(ctx, b, cx, cy) {
    const s = 1 + b.height * 0.0012;
    const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    const X = x => cx + (x - cx) * s, Y = y => cy + (y - cy) * s;
    const rx0 = X(x0), ry0 = Y(y0), rx1 = X(x1), ry1 = Y(y1);
    const floors = Math.max(1, Math.round(b.height / 32));
    const lit = b.lit > 0.6;
    const face = (ax, ay, bx, by, arx, ary, brx, bry, f) => {
      ctx.fillStyle = rgb(b.color, f);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(brx, bry); ctx.lineTo(arx, ary); ctx.closePath(); ctx.fill();
      ctx.fillStyle = lit ? 'rgba(255,214,140,0.35)' : 'rgba(18,28,44,0.5)';
      for (let i = 0; i < floors; i++) {
        const t0 = (i + 0.28) / floors, t1 = (i + 0.72) / floors;
        ctx.beginPath();
        ctx.moveTo(lerp(ax, arx, t0), lerp(ay, ary, t0));
        ctx.lineTo(lerp(bx, brx, t0), lerp(by, bry, t0));
        ctx.lineTo(lerp(bx, brx, t1), lerp(by, bry, t1));
        ctx.lineTo(lerp(ax, arx, t1), lerp(ay, ary, t1));
        ctx.closePath(); ctx.fill();
      }
      const n = Math.floor(Math.hypot(bx - ax, by - ay) / 22);
      ctx.strokeStyle = rgb(b.color, f); ctx.lineWidth = 4;
      ctx.beginPath();
      for (let j = 1; j < n; j++) {
        const u = j / n;
        ctx.moveTo(lerp(ax, bx, u), lerp(ay, by, u));
        ctx.lineTo(lerp(arx, brx, u), lerp(ary, bry, u));
      }
      ctx.stroke();
    };
    if (cx < x0) face(x0, y0, x0, y1, rx0, ry0, rx0, ry1, 0.58);
    if (cx > x1) face(x1, y0, x1, y1, rx1, ry0, rx1, ry1, 0.78);
    if (cy < y0) face(x0, y0, x1, y0, rx0, ry0, rx1, ry0, 0.92);
    if (cy > y1) face(x0, y1, x1, y1, rx0, ry1, rx1, ry1, 0.68);

    ctx.save();
    ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
    ctx.fillStyle = rgb(b.roof); ctx.fillRect(x0, y0, b.w, b.h);
    ctx.strokeStyle = rgb(b.roof, 1.3); ctx.lineWidth = 5; ctx.strokeRect(x0 + 2.5, y0 + 2.5, b.w - 5, b.h - 5);
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(x0 + 5, y0 + 5, b.w - 10, 4); ctx.fillRect(x0 + 5, y0 + 5, 4, b.h - 10);
    for (const f of b.feats) {
      if (f.t === 'ac') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(f.x + 3, f.y + 3, f.w, f.h);
        ctx.fillStyle = '#a3a39e'; ctx.fillRect(f.x, f.y, f.w, f.h);
        ctx.fillStyle = '#6d6d69';
        for (let gx = f.x + 3; gx < f.x + f.w - 2; gx += 4) ctx.fillRect(gx, f.y + 2, 1.5, f.h - 4);
      } else if (f.t === 'tank') {
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(ctx, f.x + 4, f.y + 4, 14);
        ctx.fillStyle = '#7a5a3a'; circle(ctx, f.x, f.y, 14);
        ctx.fillStyle = '#5e4329'; circle(ctx, f.x, f.y, 8);
      } else if (f.t === 'heli') {
        const hx = x0 + b.w / 2, hy = y0 + b.h / 2, r = Math.min(b.w, b.h) * 0.3;
        ctx.fillStyle = '#4a4a4e'; circle(ctx, hx, hy, r);
        ctx.strokeStyle = '#e8c34a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(hx, hy, r - 6, 0, TAU); ctx.stroke();
        ctx.fillStyle = '#eee';
        ctx.fillRect(hx - r * 0.35, hy - r * 0.45, r * 0.16, r * 0.9);
        ctx.fillRect(hx + r * 0.19, hy - r * 0.45, r * 0.16, r * 0.9);
        ctx.fillRect(hx - r * 0.35, hy - r * 0.08, r * 0.7, r * 0.16);
      }
    }
    ctx.restore();
  },
};

// Push a circle-shaped object (x, y) out of solid tiles. Returns true on contact.
function collideCircle(o, r) {
  let hit = false;
  const tx0 = Math.floor((o.x - r) / T), tx1 = Math.floor((o.x + r) / T);
  const ty0 = Math.floor((o.y - r) / T), ty1 = Math.floor((o.y + r) / T);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (!World.solidTile(tx, ty)) continue;
    const nx = clamp(o.x, tx * T, tx * T + T), ny = clamp(o.y, ty * T, ty * T + T);
    const dx = o.x - nx, dy = o.y - ny, d = Math.hypot(dx, dy);
    if (d >= r) continue;
    hit = true;
    if (d < 0.001) {
      const l = o.x - tx * T, rt = tx * T + T - o.x, u = o.y - ty * T, b = ty * T + T - o.y, m = Math.min(l, rt, u, b);
      if (m === l) o.x = tx * T - r; else if (m === rt) o.x = tx * T + T + r; else if (m === u) o.y = ty * T - r; else o.y = ty * T + T + r;
    } else { o.x += dx / d * (r - d); o.y += dy / d * (r - d); }
  }
  return hit;
}

function hasLOS(x0, y0, x1, y1) {
  const n = Math.ceil(dist(x0, y0, x1, y1) / 24);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (World.at(lerp(x0, x1, t), lerp(y0, y1, t)) === TL.BUILDING) return false;
  }
  return true;
}
