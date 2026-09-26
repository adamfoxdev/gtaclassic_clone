'use strict';
// Cars: arcade physics, collisions, traffic / police driving AI and rendering.

const CAR_TYPES = {
  sedan:  { name: 'Sedan',          w: 58, h: 28, max: 430, acc: 360, turn: 2.7, grip: 8,   hp: 220, mass: 1.0 },
  taxi:   { name: 'Taxi',           w: 58, h: 28, max: 440, acc: 370, turn: 2.7, grip: 8,   hp: 220, mass: 1.0 },
  sports: { name: 'Sports Car',     w: 62, h: 28, max: 660, acc: 620, turn: 3.0, grip: 9.5, hp: 180, mass: 0.9 },
  van:    { name: 'Van',            w: 70, h: 32, max: 360, acc: 280, turn: 2.3, grip: 7.5, hp: 300, mass: 1.5 },
  truck:  { name: 'Truck',          w: 98, h: 36, max: 320, acc: 230, turn: 1.9, grip: 7,   hp: 460, mass: 2.4 },
  police: { name: 'Police Cruiser', w: 62, h: 28, max: 600, acc: 560, turn: 2.9, grip: 9,   hp: 320, mass: 1.3 },
};
for (const k in CAR_TYPES) {
  const t = CAR_TYPES[k];
  t.kind = k;
  t.cr = t.h / 2;
  const n = Math.ceil(t.w / t.h);
  t.circ = [];
  for (let i = 0; i < n; i++) t.circ.push(-(t.w / 2 - t.cr) + i * (t.w - 2 * t.cr) / (n - 1));
}
const CAR_COLORS = [[196, 38, 38], [40, 88, 188], [226, 226, 226], [34, 34, 40], [58, 146, 70], [218, 134, 30],
  [124, 40, 146], [96, 96, 108], [176, 176, 60], [40, 156, 166], [146, 20, 32], [236, 196, 60], [210, 110, 150]];
const NO_INPUT = { throttle: 0, steer: 0, handbrake: false };

let _carId = 1;
class Car {
  constructor(kind, x, y, angle) {
    this.t = CAR_TYPES[kind]; this.kind = kind; this.id = _carId++;
    this.x = x; this.y = y; this.angle = angle;
    this.vx = 0; this.vy = 0; this.av = 0;
    this.hp = this.t.hp;
    this.driver = null; // null | 'ai' | 'cop' | 'player'
    this.ai = null;
    this.color = kind === 'taxi' ? [238, 188, 22] : kind === 'police' ? [236, 236, 240] : pick(CAR_COLORS);
    this.burnT = -1; this.dead = false; this.deadT = 0;
    this.brake = false; this.steerVis = 0; this.sirenPhase = Math.random() * 10;
    this.hitByPlayer = false; this.copsOut = false; this.smokeT = 0;
    this.skidL = null; this.skidR = null; this.input = NO_INPUT;
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  fwdSpeed() { return this.vx * Math.cos(this.angle) + this.vy * Math.sin(this.angle); }
  toWorld(lx, ly) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
  }
  toLocal(x, y) {
    const c = Math.cos(this.angle), s = Math.sin(this.angle), dx = x - this.x, dy = y - this.y;
    return [dx * c + dy * s, -dx * s + dy * c];
  }
  contains(x, y, pad = 0) {
    const [lx, ly] = this.toLocal(x, y);
    return Math.abs(lx) < this.t.w / 2 + pad && Math.abs(ly) < this.t.h / 2 + pad;
  }
  sirenOn() { return this.kind === 'police' && (this.driver === 'cop' || this.copsOut) && G.stars() > 0 && !this.dead; }

  update(dt, inp) {
    const t = this.t;
    if (this.dead) inp = NO_INPUT;
    const c = Math.cos(this.angle), s = Math.sin(this.angle);
    let vf = this.vx * c + this.vy * s, vr = -this.vx * s + this.vy * c;
    const th = inp.throttle;
    this.brake = false;
    if (th > 0) {
      if (vf < -10) { vf += t.acc * 2.2 * dt; this.brake = true; }
      else vf += t.acc * th * dt * Math.max(0, 1 - vf / t.max);
    } else if (th < 0) {
      if (vf > 10) { vf -= t.acc * 2.4 * dt; this.brake = true; }
      else vf -= t.acc * 0.7 * dt * Math.max(0, 1 + vf / (t.max * 0.35));
    } else {
      vf -= Math.sign(vf) * Math.min(Math.abs(vf), 90 * dt);
    }
    vf -= vf * 0.25 * dt;
    vr *= Math.exp(-(this.dead ? 4 : inp.handbrake ? 1.4 : t.grip) * dt);
    if (inp.handbrake) { vf -= Math.sign(vf) * Math.min(Math.abs(vf), 150 * dt); this.brake = true; }
    if (this.dead) vf *= Math.exp(-1.5 * dt);

    this.steerVis = lerp(this.steerVis, inp.steer, Math.min(1, dt * 10));
    this.angle += inp.steer * t.turn * dt * clamp(vf / 140, -1, 1) * (inp.handbrake ? 1.35 : 1);
    this.angle += this.av * dt;
    this.av *= Math.exp(-3.5 * dt);
    this.vx = c * vf - s * vr; this.vy = s * vf + c * vr;
    this.x += this.vx * dt; this.y += this.vy * dt;

    // Skid marks from the rear wheels.
    const sliding = !this.dead && (Math.abs(vr) > 110 || (inp.handbrake && Math.abs(vf) > 80) || (this.brake && Math.abs(vf) > 240));
    if (sliding) {
      const L = this.toWorld(-t.w * 0.32, -t.h * 0.42), R = this.toWorld(-t.w * 0.32, t.h * 0.42);
      if (this.skidL && dist(L[0], L[1], this.skidL[0], this.skidL[1]) > 5) {
        FX.skid(this.skidL[0], this.skidL[1], L[0], L[1]);
        FX.skid(this.skidR[0], this.skidR[1], R[0], R[1]);
        this.skidL = L; this.skidR = R;
        if (this.driver === 'player' && chance(0.3)) FX.smoke(L[0], L[1], 0.75, 0.6, 0.8);
      } else if (!this.skidL) { this.skidL = L; this.skidR = R; }
    } else this.skidL = this.skidR = null;

    if (this.burnT >= 0) {
      this.burnT -= dt;
      for (let i = 0; i < 2; i++) { const p = this.toWorld(rand(-t.w / 2, t.w / 2), rand(-t.h / 2, t.h / 2)); FX.fire(p[0], p[1], 1.2); }
      if (chance(0.3)) FX.smoke(this.x, this.y, 0.12, 1.2);
      if (this.burnT < 0) this.explodeNow();
    } else if (!this.dead) {
      const hpf = this.hp / t.hp;
      if (hpf < 0.45) {
        this.smokeT -= dt;
        if (this.smokeT <= 0) {
          const p = this.toWorld(t.w * 0.35, 0);
          FX.smoke(p[0], p[1], hpf < 0.2 ? 0.15 : 0.6, 0.8);
          this.smokeT = hpf < 0.2 ? 0.05 : 0.14;
        }
      }
    } else {
      this.deadT += dt;
      if (this.deadT < 25 && chance(dt * 4)) FX.smoke(this.x + rand(-10, 10), this.y + rand(-8, 8), 0.1, 1);
    }
    this.sirenPhase += dt;
  }

  damage(a, byPlayer, explosive) {
    if (this.dead) return;
    this.hp -= a;
    if (byPlayer) this.hitByPlayer = true;
    if (byPlayer && this.driver === 'ai' && this.ai) this.ai.panicT = rand(3, 6);
    if (byPlayer && this.driver === 'cop') addHeat(0.08);
    if (this.hp <= 0 && this.burnT < 0) {
      this.burnT = explosive ? rand(0.2, 0.6) : rand(2.2, 3.4);
      bailOut(this);
    }
  }

  explodeNow() {
    if (this.dead) return;
    this.dead = true; this.burnT = -1; this.copsOut = false;
    this.av += rand(-3, 3);
    const p = G.player;
    if (this.hitByPlayer) { reward(this.x, this.y, this.kind === 'police' ? 300 : 150); addHeat(this.kind === 'police' ? 1 : 0.35); }
    if (p.inCar === this) { this.driver = null; p.inCar = null; wasted(); }
    explode(this.x, this.y, this.hitByPlayer, 1.15, this);
  }
}

// Driver jumps out of a car that has caught fire (or is being stolen).
function bailOut(car, fleeFrom) {
  if (car.driver !== 'ai' && car.driver !== 'cop') return null;
  const kind = car.driver === 'cop' ? 'cop' : 'civ';
  const pos = exitPos(car, fleeFrom ? 1 : -1);
  const ped = new Ped(pos[0], pos[1], kind);
  if (car.driverLook) Object.assign(ped, car.driverLook);
  G.peds.push(ped);
  if (kind === 'civ') ped.flee(fleeFrom ? fleeFrom.x : car.x, fleeFrom ? fleeFrom.y : car.y);
  else { ped.alerted = true; if (!fleeFrom) ped.flee(car.x, car.y, 1.2); }
  car.driver = null; car.ai = null;
  return ped;
}

// Find a free spot beside a car for someone getting out.
function exitPos(car, pref = -1) {
  const t = car.t;
  const cand = [[0, pref * (t.h / 2 + 14)], [0, -pref * (t.h / 2 + 14)], [-(t.w / 2 + 14), 0], [t.w / 2 + 14, 0]];
  for (const [lx, ly] of cand) {
    const p = car.toWorld(lx, ly);
    if (World.solid(p[0], p[1])) continue;
    if (G.cars.some(o => o !== car && o.contains(p[0], p[1], 6))) continue;
    return p;
  }
  return car.toWorld(0, pref * (t.h / 2 + 14));
}

// ---------- collisions ----------
function carTileCollision(car) {
  const t = car.t, hw = t.w / 2, hh = t.h / 2;
  const pts = [[hw, hh], [hw, -hh], [-hw, hh], [-hw, -hh], [hw, 0], [-hw, 0], [0, hh], [0, -hh], [hw / 2, hh], [hw / 2, -hh], [-hw / 2, hh], [-hw / 2, -hh]];
  for (let iter = 0; iter < 3; iter++) {
    let best = null;
    for (const [lx, ly] of pts) {
      const [wx, wy] = car.toWorld(lx, ly);
      const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
      if (!World.solidTile(tx, ty)) continue;
      let m = null, mm = 1e9;
      const tryPush = (dx, dy) => { const a = Math.abs(dx) + Math.abs(dy); if (a < mm) { mm = a; m = [dx, dy]; } };
      if (!World.solidTile(tx - 1, ty)) tryPush(tx * T - wx, 0);
      if (!World.solidTile(tx + 1, ty)) tryPush((tx + 1) * T - wx, 0);
      if (!World.solidTile(tx, ty - 1)) tryPush(0, ty * T - wy);
      if (!World.solidTile(tx, ty + 1)) tryPush(0, (ty + 1) * T - wy);
      if (!m) continue;
      if (!best || mm > best.mag) best = { dx: m[0] + Math.sign(m[0]) * 0.3, dy: m[1] + Math.sign(m[1]) * 0.3, mag: mm, wx, wy };
    }
    if (!best) break;
    car.x += best.dx; car.y += best.dy;
    const nl = Math.hypot(best.dx, best.dy) || 1, nx = best.dx / nl, ny = best.dy / nl;
    const vn = car.vx * nx + car.vy * ny;
    if (vn < 0) {
      const imp = -vn;
      car.vx -= 1.3 * vn * nx; car.vy -= 1.3 * vn * ny;
      car.vx *= 0.92; car.vy *= 0.92;
      const rx = best.wx - car.x, ry = best.wy - car.y;
      car.av += (rx * ny - ry * nx) * imp * 0.0004;
      if (imp > 90) {
        car.damage((imp - 90) * 0.16, car.driver === 'player', false);
        FX.sparks(best.wx, best.wy, Math.atan2(ny, nx), 5);
        Sfx.crash(best.wx, best.wy, Math.min(1, imp / 300));
        if (car.driver === 'player') G.cam.shake += Math.min(10, imp / 40);
      }
    }
  }
}

function collideCars(a, b) {
  const R = (a.t.w + b.t.w) / 2;
  if (Math.abs(a.x - b.x) > R || Math.abs(a.y - b.y) > R) return;
  let best = null;
  const ca = Math.cos(a.angle), sa = Math.sin(a.angle), cb = Math.cos(b.angle), sb = Math.sin(b.angle);
  for (const oa of a.t.circ) {
    const ax = a.x + ca * oa, ay = a.y + sa * oa;
    for (const ob of b.t.circ) {
      const bx = b.x + cb * ob, by = b.y + sb * ob;
      const d = Math.hypot(bx - ax, by - ay), o = a.t.cr + b.t.cr - d;
      if (o > 0 && (!best || o > best.o)) best = { o, nx: d > 0 ? (bx - ax) / d : 1, ny: d > 0 ? (by - ay) / d : 0, px: (ax + bx) / 2, py: (ay + by) / 2 };
    }
  }
  if (!best) return;
  const ia = 1 / (a.t.mass * (a.dead ? 1.5 : 1)), ib = 1 / (b.t.mass * (b.dead ? 1.5 : 1));
  const { nx, ny } = best;
  const sep = best.o / (ia + ib);
  a.x -= nx * sep * ia; a.y -= ny * sep * ia;
  b.x += nx * sep * ib; b.y += ny * sep * ib;
  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn >= 0) return;
  const j = -1.3 * vn / (ia + ib);
  a.vx -= j * nx * ia; a.vy -= j * ny * ia;
  b.vx += j * nx * ib; b.vy += j * ny * ib;
  const rax = best.px - a.x, ray = best.py - a.y, rbx = best.px - b.x, rby = best.py - b.y;
  a.av += (rax * -ny - ray * -nx) * j * ia * 0.00035;
  b.av += (rbx * ny - rby * nx) * j * ib * 0.00035;
  const imp = -vn;
  if (imp > 70) {
    const dmg = (imp - 70) * 0.14;
    const pa = a.driver === 'player', pb = b.driver === 'player';
    a.damage(dmg * ia / (ia + ib) * 2, pb, false);
    b.damage(dmg * ib / (ia + ib) * 2, pa, false);
    FX.sparks(best.px, best.py, Math.atan2(ny, nx) + Math.PI / 2, 6);
    Sfx.crash(best.px, best.py, Math.min(1, imp / 300));
    if (pa || pb) {
      G.cam.shake += Math.min(12, imp / 35);
      const other = pa ? b : a;
      if (other.driver === 'cop') addHeat(0.15);
      if (other.ai && other.driver === 'ai' && chance(0.5)) Sfx.horn(other.x, other.y);
    }
  }
}

// Cars run over / push pedestrians and barrels.
function carPedCollisions() {
  for (const car of G.cars) {
    const t = car.t, hw = t.w / 2, hh = t.h / 2, reach = hw + 12;
    const sp = car.speed;
    for (const p of G.peds) {
      if (p.dead || p.inCar) continue;
      if (Math.abs(p.x - car.x) > reach || Math.abs(p.y - car.y) > reach) continue;
      const [lx, ly] = car.toLocal(p.x, p.y);
      const ox = hw + p.r - Math.abs(lx), oy = hh + p.r - Math.abs(ly);
      if (ox <= 0 || oy <= 0) continue;
      if (sp > 110 && !car.dead) {
        const byPlayer = car.driver === 'player';
        const dmg = p.type === 'player' ? (sp - 80) * 0.35 : sp;
        p.damage(dmg, { player: byPlayer, x: car.x - car.vx * 0.2, y: car.y - car.vy * 0.2, kind: 'car' });
        if (p.type === 'player') { const [wx, wy] = car.toWorld(lx, ly + Math.sign(ly || 1) * oy); p.x = wx; p.y = wy; }
        car.vx *= 0.97; car.vy *= 0.97;
        if (byPlayer && p.dead) G.cam.shake += 3;
      } else {
        // Push the pedestrian out along the shallowest local axis.
        let nlx = lx, nly = ly;
        if (ox < oy) nlx = Math.sign(lx || 1) * (hw + p.r); else nly = Math.sign(ly || 1) * (hh + p.r);
        const [wx, wy] = car.toWorld(nlx, nly);
        p.x = wx; p.y = wy;
        collideCircle(p, p.r);
        if (sp > 40 && p.type === 'civ' && p.state !== 'flee') p.flee(car.x, car.y);
      }
    }
    for (const br of G.barrels) {
      if (br.dead || Math.abs(br.x - car.x) > reach || Math.abs(br.y - car.y) > reach) continue;
      if (!car.contains(br.x, br.y, 10)) continue;
      if (sp > 130) { br.byPlayer = car.driver === 'player'; if (br.fuse < 0) br.fuse = 0.01; }
      else {
        const a = Math.atan2(br.y - car.y, br.x - car.x);
        br.x += Math.cos(a) * 3; br.y += Math.sin(a) * 3;
        collideCircle(br, 10);
      }
    }
  }
}

// ---------- driving AI ----------
function makeAI(mode, dir, road) {
  return { mode, dir, road, plan: null, stuckT: 0, reverseT: 0, revSteer: 0, waitT: 0, overtakeT: 0,
    cruise: mode === 'chase' ? 9999 : rand(170, 240), losT: 0, los: false, direct: false, panicT: 0 };
}

function snapToRoad(car, target) {
  const ai = car.ai;
  const kv = clamp(Math.round((car.x / T - OFF - 2) / P), 0, NB), kh = clamp(Math.round((car.y / T - OFF - 2) / P), 0, NB);
  const dv = Math.abs(car.x - (roadStart(kv) + 2 * T)), dh = Math.abs(car.y - (roadStart(kh) + 2 * T));
  if (dv < dh) { ai.road = kv; ai.dir = (target ? target.y - car.y : Math.sin(car.angle)) >= 0 ? 1 : 3; }
  else { ai.road = kh; ai.dir = (target ? target.x - car.x : Math.cos(car.angle)) >= 0 ? 0 : 2; }
  ai.plan = null;
}

// Lane following on the road grid. Picks turns at intersections (randomly, or towards `target`).
function followRoad(car, ai, vf, target) {
  const d = ai.dir, dv = DIRS[d], sign = dv[0] + dv[1], horiz = dv[0] !== 0;
  const along = horiz ? car.x : car.y;
  let cross = laneCoord(d, ai.road);
  if (ai.overtakeT > 0) cross += (horiz ? -dv[0] : dv[1]) * 64;
  let maxSpeed = 1e9;
  if (!ai.plan) {
    const j = sign > 0 ? Math.floor((along / T - OFF) / P) + 1 : Math.floor((along / T - OFF - 4) / P);
    if (j < 0 || j > NB) {
      ai.dir = (d + 2) % 4;
      return { tx: car.x - dv[0] * 80, ty: car.y - dv[1] * 80, maxSpeed: 80 };
    }
    const opts = [];
    if (j + sign >= 0 && j + sign <= NB) opts.push(d);
    for (const nd of [(d + 1) % 4, (d + 3) % 4]) {
      const ns = DIRS[nd][0] + DIRS[nd][1];
      if (ai.road + ns >= 0 && ai.road + ns <= NB) opts.push(nd);
    }
    let nd = d;
    if (target) {
      const ix = horiz ? roadStart(j) + 2 * T : roadStart(ai.road) + 2 * T;
      const iy = horiz ? roadStart(ai.road) + 2 * T : roadStart(j) + 2 * T;
      const tx = target.x - ix, ty = target.y - iy, tl = Math.hypot(tx, ty) || 1;
      let bs = -9;
      for (const o of opts) { const sc = (DIRS[o][0] * tx + DIRS[o][1] * ty) / tl + rand(0, 0.25); if (sc > bs) { bs = sc; nd = o; } }
    } else nd = opts.includes(d) && chance(0.5) ? d : pick(opts);
    const js = roadStart(j);
    ai.plan = { j, nd, at: nd === d ? (sign > 0 ? js + 4 * T : js) : laneCoord(nd, j) };
  }
  const pl = ai.plan;
  if (pl.nd === d) {
    if (sign * (along - pl.at) > 0) ai.plan = null;
  } else {
    const rem = sign * (pl.at - along);
    const lead = clamp(Math.abs(vf) * 0.1, 6, 36);
    if (rem < lead) { ai.dir = pl.nd; ai.road = pl.j; ai.plan = null; }
    else if (rem < 170) maxSpeed = pl.nd === (d + 1) % 4 ? 105 : 140;
  }
  const L = 90;
  return { tx: horiz ? car.x + sign * L : cross, ty: horiz ? cross : car.y + sign * L, maxSpeed };
}

// Distance to the nearest thing in the car's path, or null.
function obstacleAhead(car, vf) {
  const c = Math.cos(car.angle), s = Math.sin(car.angle), hw = car.t.w / 2, hh = car.t.h / 2;
  const look = hw + 30 + Math.max(0, vf) * 0.6;
  let best = null;
  for (const o of G.cars) {
    if (o === car) continue;
    const dx = o.x - car.x, dy = o.y - car.y;
    if (Math.abs(dx) > look + 60 || Math.abs(dy) > look + 60) continue;
    const al = dx * c + dy * s;
    if (al <= 0) continue;
    const rel = o.angle - car.angle;
    const latExt = o.t.h / 2 + (o.t.w - o.t.h) / 2 * Math.abs(Math.sin(rel));
    const alExt = o.t.h / 2 + (o.t.w - o.t.h) / 2 * Math.abs(Math.cos(rel));
    if (Math.abs(-dx * s + dy * c) > hh + latExt + 4) continue;
    const gap = al - hw - alExt;
    if (gap < look - hw && (best === null || gap < best)) best = gap;
  }
  for (const p of G.peds) {
    if (p.dead || p.inCar) continue;
    const dx = p.x - car.x, dy = p.y - car.y;
    if (Math.abs(dx) > look || Math.abs(dy) > look) continue;
    const al = dx * c + dy * s;
    if (al <= 0 || Math.abs(-dx * s + dy * c) > hh + 12) continue;
    const gap = al - hw - 8;
    if (gap < look - hw && (best === null || gap < best)) best = gap;
  }
  return best;
}

function aiDrive(car, dt) {
  const ai = car.ai, t = car.t, p = G.player;
  const inp = { throttle: 0, steer: 0, handbrake: false };
  if (car.burnT >= 0) return inp;
  if (ai.reverseT > 0) { ai.reverseT -= dt; inp.throttle = -1; inp.steer = ai.revSteer; return inp; }
  const vf = car.fwdSpeed();
  const chasing = ai.mode === 'chase' && !p.dead && G.stars() > 0;
  const tgt = p.inCar || p;
  let tx, ty, desired = chasing ? t.max : ai.cruise;
  let dToT = 1e9;
  if (chasing) {
    dToT = dist(car.x, car.y, tgt.x, tgt.y);
    ai.losT -= dt;
    if (ai.losT <= 0) { ai.losT = 0.25; ai.los = dToT < 700 && hasLOS(car.x, car.y, tgt.x, tgt.y); }
  }
  if (chasing && ai.los && dToT < 520) {
    ai.direct = true;
    const lead = p.inCar ? 0.35 : 0;
    tx = tgt.x + (tgt.vx || 0) * lead; ty = tgt.y + (tgt.vy || 0) * lead;
    if (!p.inCar) desired = clamp((dToT - 80) * 2.2, 0, t.max);
  } else {
    if (ai.direct) { ai.direct = false; snapToRoad(car, chasing ? tgt : null); }
    const r = followRoad(car, ai, vf, chasing ? tgt : null);
    tx = r.tx; ty = r.ty;
    desired = chasing ? Math.min(t.max * 0.9, r.maxSpeed * 1.7) : Math.min(desired, r.maxSpeed);
  }
  if (ai.panicT > 0) { ai.panicT -= dt; desired = Math.max(desired * 1.6, 380); }

  const da = angDiff(car.angle, Math.atan2(ty - car.y, tx - car.x));
  inp.steer = clamp(da * 2.8, -1, 1);
  if (Math.abs(da) > 1.0) desired = Math.min(desired, chasing ? 230 : 120);

  if (!chasing && ai.panicT <= 0 && ai.overtakeT <= 0) {
    const gap = obstacleAhead(car, vf);
    if (gap !== null) desired = Math.min(desired, Math.max(0, (gap - 14) * 2.5));
    if (gap !== null && desired < 15) {
      ai.waitT += dt;
      if (ai.waitT > 4) { ai.waitT = 0; ai.overtakeT = 2.5; if (car.driver === 'ai' && chance(0.5)) Sfx.horn(car.x, car.y); }
    } else ai.waitT = Math.max(0, ai.waitT - dt);
  }
  if (ai.overtakeT > 0) ai.overtakeT -= dt;

  if (vf < desired - 8) inp.throttle = 1;
  else if (vf > desired + 25) inp.throttle = -1;

  if (inp.throttle > 0 && Math.abs(vf) < 20) {
    ai.stuckT += dt;
    if (ai.stuckT > (chasing ? 0.8 : 2)) {
      ai.stuckT = 0; ai.reverseT = rand(0.6, 1.1);
      ai.revSteer = -Math.sign(inp.steer || (Math.random() - 0.5));
    }
  } else ai.stuckT = Math.max(0, ai.stuckT - dt * 0.5);
  return inp;
}

// ---------- rendering ----------
function drawCar(ctx, car) {
  const t = car.t, w = t.w, h = t.h, hw = w / 2, hh = h / 2, k = t.kind;
  ctx.save();
  ctx.translate(car.x, car.y); ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; rrect(ctx, -hw + 3, -hh + 4, w, h, 7); ctx.fill();

  // Wheels (front pair steers).
  ctx.fillStyle = '#111';
  const wx = hw - (k === 'truck' ? 16 : 13);
  for (const sy of [-1, 1]) {
    ctx.fillRect(-wx - 6, sy * hh - 3, 12, 6);
    if (k === 'truck') ctx.fillRect(-wx + 10, sy * hh - 3, 12, 6);
    ctx.save(); ctx.translate(wx, sy * hh); ctx.rotate(car.steerVis * 0.45); ctx.fillRect(-6, -3, 12, 6); ctx.restore();
  }

  const dead = car.dead, hpf = clamp(car.hp / t.hp, 0, 1);
  const f = dead ? 1 : 0.62 + 0.38 * Math.min(1, hpf * 1.6);
  const col = dead ? [40, 36, 34] : car.color;
  const body = rgb(col, f), dark = rgb(col, f * 0.7), light = rgb(col, f * 1.2);
  const glass = dead ? '#151515' : '#1c2a3a';

  if (k === 'truck') {
    ctx.fillStyle = dead ? '#2c2a28' : '#cbcbc5'; rrect(ctx, -hw, -hh, w - 30, h, 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let x = -hw + 8; x < hw - 36; x += 10) ctx.fillRect(x, -hh + 2, 2, h - 4);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(-hw + 2, -hh + 2, w - 34, 3);
    ctx.fillStyle = body; rrect(ctx, hw - 28, -hh + 2, 28, h - 4, 5); ctx.fill();
    ctx.fillStyle = light; ctx.fillRect(hw - 26, -hh + 4, 12, h - 8);
    ctx.fillStyle = glass; ctx.fillRect(hw - 12, -hh + 5, 6, h - 10);
  } else {
    ctx.fillStyle = body; rrect(ctx, -hw, -hh, w, h, k === 'van' ? 5 : 8); ctx.fill();
    ctx.fillStyle = dark; ctx.fillRect(-hw + 4, hh - 5, w - 8, 3);
    ctx.fillStyle = light; ctx.fillRect(-hw + 4, -hh + 2, w - 8, 2);
    if (k === 'police' && !dead) {
      ctx.fillStyle = '#1a1a22';
      ctx.fillRect(w * 0.24, -hh + 1, hw - w * 0.24 - 3, h - 2);
      ctx.fillRect(-hw + 3, -hh + 1, hw - w * 0.36 - 3, h - 2);
    }
    let ws0, ws1, r0, r1, rw0;
    if (k === 'sports') { ws1 = w * 0.2; ws0 = 0; r0 = -w * 0.18; r1 = 0; rw0 = -w * 0.3; }
    else if (k === 'van') { ws1 = w * 0.4; ws0 = w * 0.28; r0 = -w * 0.46; r1 = w * 0.28; rw0 = null; }
    else { ws1 = w * 0.22; ws0 = w * 0.06; r0 = -w * 0.22; r1 = w * 0.06; rw0 = -w * 0.34; }
    // windshield
    ctx.fillStyle = glass;
    ctx.beginPath(); ctx.moveTo(ws1, -hh + 5); ctx.lineTo(ws1, hh - 5); ctx.lineTo(ws0, hh - 3); ctx.lineTo(ws0, -hh + 3); ctx.closePath(); ctx.fill();
    if (!dead) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(ws0 + 3, -hh + 5, 2, h * 0.35); }
    // rear window
    if (rw0 !== null) {
      ctx.fillStyle = glass;
      ctx.beginPath(); ctx.moveTo(rw0, -hh + 5); ctx.lineTo(rw0, hh - 5); ctx.lineTo(r0, hh - 3); ctx.lineTo(r0, -hh + 3); ctx.closePath(); ctx.fill();
    }
    // roof
    ctx.fillStyle = k === 'police' && !dead ? '#f2f2f4' : light;
    rrect(ctx, r0, -hh + 4, r1 - r0, h - 8, 3); ctx.fill();
    ctx.fillStyle = glass; ctx.fillRect(r0 + 2, -hh + 2, r1 - r0 - 4, 2); ctx.fillRect(r0 + 2, hh - 4, r1 - r0 - 4, 2);
    if (k === 'sports' && !dead) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillRect(-hw + 2, -4, w - 4, 2.5); ctx.fillRect(-hw + 2, 1.5, w - 4, 2.5);
    }
    if (k === 'taxi' && !dead) {
      ctx.fillStyle = '#222'; ctx.fillRect(r0 + (r1 - r0) / 2 - 5, -7, 10, 14);
      ctx.fillStyle = '#fff4b0'; ctx.fillRect(r0 + (r1 - r0) / 2 - 3.5, -5.5, 7, 11);
    }
    if (k === 'police' && !dead) {
      const on = car.sirenOn(), ph = Math.floor(car.sirenPhase * 8) % 2;
      const mx = r0 + (r1 - r0) / 2;
      ctx.fillStyle = on && ph ? '#ff2a2a' : '#7a1010'; ctx.fillRect(mx - 3, -hh + 4, 6, hh - 5);
      ctx.fillStyle = on && !ph ? '#3a6bff' : '#10207a'; ctx.fillRect(mx - 3, 1, 6, hh - 5);
      if (on) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = ph ? 'rgba(255,40,40,0.35)' : 'rgba(60,100,255,0.35)';
        circle(ctx, mx, ph ? -hh / 2 : hh / 2, 26);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
  if (!dead) {
    ctx.fillStyle = '#fff6c4';
    ctx.fillRect(hw - 3, -hh + 3, 3, 6); ctx.fillRect(hw - 3, hh - 9, 3, 6);
    ctx.fillStyle = car.brake ? '#ff3030' : '#8a1414';
    ctx.fillRect(-hw, -hh + 3, 3, 6); ctx.fillRect(-hw, hh - 9, 3, 6);
    if (car.brake) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,40,40,0.25)'; circle(ctx, -hw, -hh + 6, 7); circle(ctx, -hw, hh - 6, 7);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (hpf < 0.65) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      const n = hpf < 0.35 ? 5 : 3;
      for (let i = 0; i < n; i++) ellipse(ctx, (hash(car.id, i, 1) - 0.5) * w * 0.8, (hash(car.id, i, 2) - 0.5) * h * 0.7, 3 + hash(car.id, i, 3) * 5, 2 + hash(car.id, i, 4) * 3);
    }
  }
  ctx.restore();
}
