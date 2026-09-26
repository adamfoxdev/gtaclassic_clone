'use strict';
// Game state, input, player control, spawning, police/wanted system, camera, HUD and main loop.

const G = {
  cars: [], peds: [], proj: [], barrels: [], pickups: [], player: null,
  cam: { x: 0, y: 0, zoom: 1, shake: 0 },
  time: 0, heat: 0, lastSeen: -99, seen: false, seenT: 0, dispT: 0, money: 0, kills: 0,
  msgs: [], overT: 0, overKind: null, hurtFlash: 0, spawnT: 0,
  started: false, paused: false, view: { x0: 0, y0: 0, x1: 0, y1: 0 },
  W: 0, H: 0, dpr: 1, base: 1, S: 1, ctx: null, canvas: null, lastStars: 0,
  stars() { return Math.min(5, Math.floor(this.heat)); },
  running() { return this.started && !this.paused; },
};

const keys = {}, pressed = {};
const mouse = { sx: 0, sy: 0, wx: 0, wy: 0, down: false };
// Keyboard aiming on the number pad: direction keys point the gun, 0 fires.
const keyAim = { active: false, ang: 0 };
const NUMPAD_AIM = { Numpad1: [-1, 1], Numpad2: [0, 1], Numpad3: [1, 1], Numpad4: [-1, 0], Numpad6: [1, 0], Numpad7: [-1, -1], Numpad8: [0, -1], Numpad9: [1, -1] };

function updateKeyAim(p) {
  let dx = 0, dy = 0;
  for (const k in NUMPAD_AIM) if (keys[k]) { dx += NUMPAD_AIM[k][0]; dy += NUMPAD_AIM[k][1]; }
  if (dx || dy) {
    if (!keyAim.active) keyAim.ang = p.inCar ? p.inCar.angle : p.ang;
    keyAim.active = true;
    keyAim.ang = Math.atan2(dy, dx);
  } else if (keys.Numpad0 && !keyAim.active) {
    // Firing with 0 before choosing a direction shoots the way you're facing / driving.
    keyAim.active = true;
    keyAim.ang = p.inCar ? p.inCar.angle : p.ang;
  }
}

function inView(x, y, m = 0) { const v = G.view; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }

function addHeat(v) {
  if (G.overT > 0 || G.player.dead) return;
  G.heat = Math.min(5.99, G.heat + v * (G.seen ? 1.5 : 1));
  G.lastSeen = G.time;
}

function reward(x, y, amt) {
  G.money += amt;
  FX.popup(x, y - 14, `+$${amt}`);
}

function message(text, col = '#fff', t = 2.5) {
  G.msgs.push({ text, col, t });
  if (G.msgs.length > 4) G.msgs.shift();
}

// ---------- player ----------
function makePlayer(x, y) {
  const p = new Ped(x, y, 'player');
  p.shirt = [196, 64, 36]; p.pants = [36, 40, 60]; p.hair = [24, 18, 14]; p.skin = [224, 172, 120];
  p.hp = 100; p.armor = 0;
  p.weapons = { fist: Infinity, pistol: 48 };
  p.weapon = 'pistol';
  p.fireCd = 0;
  return p;
}

function playerHurt(amt, src) {
  const p = G.player;
  if (p.dead || G.overT > 0 || p.inCar) return;
  if (p.armor > 0) { const a = Math.min(p.armor, amt * 0.7); p.armor -= a; amt -= a; }
  p.hp -= amt;
  p.hitT = 0.12;
  G.hurtFlash = Math.min(0.6, G.hurtFlash + 0.25);
  if (src && src.kind !== 'fire') FX.blood(p.x, p.y, 3, Math.atan2(p.y - src.y, p.x - src.x));
  if (p.hp <= 0) wasted(src);
}

function wasted() {
  const p = G.player;
  if (p.dead || G.overT > 0) return;
  p.dead = true; p.hp = 0;
  if (p.inCar) { p.inCar.driver = null; p.inCar = null; }
  else {
    FX.bloodPool(p.x, p.y);
    FX.decal({ k: 'corpse', x: p.x, y: p.y, ang: rand(0, TAU), shirt: p.shirt, pants: p.pants, skin: p.skin, hair: p.hair, burnt: p.burnT > 0 });
  }
  G.overT = 4; G.overKind = 'wasted';
  Sfx.wasted();
}

function busted() {
  const p = G.player;
  if (p.dead || G.overT > 0) return;
  G.overT = 4; G.overKind = 'busted';
  if (p.inCar) { p.inCar.driver = null; p.inCar.input = NO_INPUT; }
  Sfx.bust();
}

function respawn() {
  const p = G.player, wasBusted = G.overKind === 'busted';
  const at = wasBusted ? World.station : World.hospital;
  p.inCar = null; p.dead = false; p.hp = 100; p.armor = 0; p.burnT = 0;
  p.weapons = { fist: Infinity, pistol: 24 }; p.weapon = 'pistol';
  p.x = at.x; p.y = at.y;
  const fee = Math.floor(G.money * (wasBusted ? 0.2 : 0.1));
  G.money -= fee;
  G.heat = 0; G.overT = 0; G.overKind = null;
  for (const c of G.cars) if (c.ai && c.ai.mode === 'chase') { c.ai.mode = 'traffic'; c.ai.cruise = rand(170, 240); }
  G.peds = G.peds.filter(q => q.type !== 'cop' || dist(q.x, q.y, p.x, p.y) > 1400);
  G.cam.x = p.x; G.cam.y = p.y;
  message(wasBusted ? `Bailed out for $${fee}` : `Hospital bill: $${fee}`, '#ddd', 3);
}

function cycleWeapon(d) {
  const p = G.player;
  let i = WEAPON_ORDER.indexOf(p.weapon);
  for (let n = 0; n < WEAPON_ORDER.length; n++) {
    i = (i + d + WEAPON_ORDER.length) % WEAPON_ORDER.length;
    if (p.weapons[WEAPON_ORDER[i]] > 0) { p.weapon = WEAPON_ORDER[i]; return; }
  }
}

function toggleCar() {
  const p = G.player;
  if (p.inCar) {
    const car = p.inCar;
    const pos = exitPos(car, -1);
    p.x = pos[0]; p.y = pos[1];
    car.driver = null; car.input = NO_INPUT;
    p.inCar = null;
    Sfx.door(p.x, p.y);
    return;
  }
  let best = null, bd = 1e9;
  for (const c of G.cars) {
    if (c.dead) continue;
    const [lx, ly] = c.toLocal(p.x, p.y);
    const ox = Math.max(0, Math.abs(lx) - c.t.w / 2), oy = Math.max(0, Math.abs(ly) - c.t.h / 2);
    const d = Math.hypot(ox, oy);
    if (d < 30 && d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  if (best.driver === 'ai' || best.driver === 'cop') {
    const wasCop = best.driver === 'cop';
    const ped = bailOut(best, p);
    if (ped) { ped.x = p.x + rand(-6, 6); ped.y = p.y + rand(-6, 6); collideCircle(ped, ped.r); }
    addHeat(wasCop ? 1.2 : 0.2);
    message(wasCop ? 'Stole a police car!' : 'Car jacked!', '#ffcc33', 2);
  } else if (best.kind === 'police') addHeat(0.6);
  best.driver = 'player'; best.ai = null; best.copsOut = false; best.input = NO_INPUT;
  if (best.spot) { best.spot.car = null; best.spot.cool = 40; best.spot = null; }
  p.inCar = best; p.burnT = 0;
  Sfx.door(best.x, best.y);
  message(best.t.name, '#9df', 1.6);
}

function updatePlayer(dt) {
  const p = G.player;
  if (p.dead || G.overT > 0) return;
  for (let i = 1; i <= 7; i++) if (pressed['Digit' + i]) { const wk = WEAPON_ORDER[i - 1]; if (p.weapons[wk] > 0) p.weapon = wk; }
  if (pressed.KeyQ || pressed.NumpadSubtract) cycleWeapon(-1);
  if (pressed.KeyE || pressed.NumpadAdd) cycleWeapon(1);
  if (pressed.KeyF || pressed.Enter || pressed.NumpadEnter) toggleCar();
  updateKeyAim(p);
  const aim = keyAim.active ? keyAim.ang : Math.atan2(mouse.wy - p.y, mouse.wx - p.x);
  if (p.inCar) {
    const car = p.inCar;
    car.input = {
      throttle: ((keys.KeyW || keys.ArrowUp) ? 1 : 0) - ((keys.KeyS || keys.ArrowDown) ? 1 : 0),
      steer: ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0),
      handbrake: !!keys.Space,
    };
    if (pressed.KeyH) Sfx.horn(car.x, car.y);
  } else {
    let mx = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
    let my = ((keys.KeyS || keys.ArrowDown) ? 1 : 0) - ((keys.KeyW || keys.ArrowUp) ? 1 : 0);
    const l = Math.hypot(mx, my);
    if (l > 0) {
      const sp = (keys.ShiftLeft || keys.ShiftRight) ? 200 : 135;
      p.moveDir(Math.atan2(my, mx), sp, dt);
    } else { p.moving = false; p.vx = p.vy = 0; }
    p.ang = aim;
  }
  if (p.inCar) { p.x = p.inCar.x; p.y = p.inCar.y; p.vx = p.inCar.vx; p.vy = p.inCar.vy; p.ang = aim; }

  p.fireCd -= dt;
  if ((mouse.down || keys.Numpad0) && p.fireCd <= 0 && p.weapons[p.weapon] > 0) {
    const w = WEAPONS[p.weapon];
    fireWeapon(p, p.weapon, aim);
    p.fireCd = w.rate;
    if (p.weapon !== 'fist') {
      p.weapons[p.weapon]--;
      if (p.weapons[p.weapon] <= 0) { delete p.weapons[p.weapon]; cycleWeapon(-1); }
    }
  }

  for (const pk of G.pickups) {
    if (pk.hidden || pk.gone) continue;
    if (dist(p.x, p.y, pk.x, pk.y) > (p.inCar ? 36 : 22)) continue;
    collect(pk);
  }
}

function collect(pk) {
  const p = G.player;
  if (pk.kind === 'weapon') {
    const w = WEAPONS[pk.wk];
    p.weapons[pk.wk] = (p.weapons[pk.wk] || 0) + pk.amount;
    if (p.weapon === 'fist' || p.weapon === 'pistol' || !p.weapons[p.weapon]) p.weapon = pk.wk;
    message(`${w.name} +${pk.amount}`, w.col);
  } else if (pk.kind === 'health') {
    if (p.hp >= 100) return;
    p.hp = Math.min(100, p.hp + 50); message('Health', '#f66');
  } else if (pk.kind === 'armor') {
    if (p.armor >= 100) return;
    p.armor = Math.min(100, p.armor + 50); message('Body Armor', '#6af');
  } else if (pk.kind === 'money') {
    reward(pk.x, pk.y, pk.amount);
  }
  Sfx.pickup();
  if (pk.temp) pk.gone = true;
  else { pk.hidden = true; pk.t = 35; }
}

function updatePickups(dt) {
  for (const pk of G.pickups) {
    if (pk.temp) { pk.temp -= dt; if (pk.temp <= 0) pk.gone = true; continue; }
    if (pk.hidden) { pk.t -= dt; if (pk.t <= 0 && !inView(pk.x, pk.y, 50)) pk.hidden = false; }
  }
  G.pickups = G.pickups.filter(pk => !pk.gone);
}

// ---------- spawning ----------
function roadSpawn(minR, maxR, ignoreView) {
  const c = G.cam;
  for (let tries = 0; tries < 16; tries++) {
    const vertical = chance(0.5);
    const dir = vertical ? pick([1, 3]) : pick([0, 2]);
    const camCross = vertical ? c.x : c.y, camAlong = vertical ? c.y : c.x;
    const k = clamp(Math.round((camCross / T - OFF - 2) / P) + randi(-2, 2), 0, NB);
    const cross = laneCoord(dir, k);
    const along = camAlong + rand(-maxR, maxR);
    if (along < roadStart(0) + T || along > roadStart(NB) + 3 * T) continue;
    if (inRoadSpan(Math.floor(along / T))) continue;
    const x = vertical ? cross : along, y = vertical ? along : cross;
    const d = dist(x, y, c.x, c.y);
    if (d < minR || d > maxR) continue;
    if (!ignoreView && inView(x, y, 90)) continue;
    if (G.cars.some(o => Math.abs(o.x - x) < 90 && Math.abs(o.y - y) < 90)) continue;
    return { x, y, dir, k };
  }
  return null;
}

function spawnTraffic(ignoreView) {
  const s = roadSpawn(ignoreView ? 150 : 700, 1500, ignoreView);
  if (!s) return;
  const q = Math.random();
  const kind = q < 0.36 ? 'sedan' : q < 0.5 ? 'taxi' : q < 0.62 ? 'sports' : q < 0.78 ? 'van' : q < 0.92 ? 'truck' : 'police';
  const car = new Car(kind, s.x, s.y, s.dir * Math.PI / 2);
  car.driver = kind === 'police' ? 'cop' : 'ai';
  car.ai = makeAI('traffic', s.dir, s.k);
  if (kind === 'police' && G.stars() > 0) { car.ai.mode = 'chase'; car.ai.cruise = 9999; }
  car.vx = Math.cos(car.angle) * 150; car.vy = Math.sin(car.angle) * 150;
  car.driverLook = { shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKINS), hair: pick(HAIRS) };
  if (car.driver === 'cop') car.driverLook = null;
  G.cars.push(car);
}

function spawnPolice() {
  const s = roadSpawn(900, 1500, false);
  if (!s) return;
  const car = new Car('police', s.x, s.y, s.dir * Math.PI / 2);
  car.driver = 'cop';
  car.ai = makeAI('chase', s.dir, s.k);
  if (G.stars() >= 4) { car.hp = car.t.hp * 1.5; }
  car.vx = Math.cos(car.angle) * 250; car.vy = Math.sin(car.angle) * 250;
  G.cars.push(car);
}

function copsExit(car) {
  const n = G.peds.filter(q => q.type === 'cop' && !q.dead).length;
  car.driver = null; car.ai = null; car.copsOut = true; car.input = NO_INPUT;
  if (n > 14) return;
  for (const side of [-1, 1]) {
    const pos = exitPos(car, side);
    const cop = new Ped(pos[0], pos[1], 'cop');
    cop.alerted = true;
    cop.fireCd = rand(0.4, 1);
    G.peds.push(cop);
  }
  Sfx.door(car.x, car.y);
}

function spawnTick(initial) {
  const c = G.cam, p = G.player, pc = p.inCar;
  const stars = G.stars();
  G.peds = G.peds.filter(q => {
    if (q === p) return true;
    const d = dist(q.x, q.y, c.x, c.y);
    return d < (q.type === 'cop' && stars > 0 ? 2400 : 1700);
  });
  G.cars = G.cars.filter(car => {
    if (car === pc) return true;
    const d = dist(car.x, car.y, c.x, c.y);
    const keep = d < (car.driver === 'cop' && stars > 0 ? 2800 : car.dead ? 1600 : 2000);
    if (!keep && car.spot) { car.spot.car = null; car.spot.cool = 20; }
    return keep;
  });

  let civs = 0, traffic = 0;
  for (const q of G.peds) if (q.type === 'civ') civs++;
  for (const car of G.cars) if (car.driver === 'ai' || (car.driver === 'cop' && car.ai && car.ai.mode === 'traffic')) traffic++;

  for (let tries = 0; civs < 70 && tries < (initial ? 400 : 25); tries++) {
    const a = rand(0, TAU), r = initial ? rand(60, 1400) : rand(750, 1400);
    const x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
    if (!initial && inView(x, y, 60)) continue;
    const t = World.at(x, y);
    if (t !== TL.SIDEWALK && t !== TL.PLAZA && t !== TL.GRASS) continue;
    G.peds.push(new Ped(x, y, 'civ'));
    civs++;
  }
  for (let tries = 0; traffic < 28 && tries < (initial ? 60 : 4); tries++) { const n = G.cars.length; spawnTraffic(initial); if (G.cars.length > n) traffic++; }

  for (const s of World.spots) {
    if (s.cool > 0) { s.cool -= 0.5; continue; }
    if (s.car) continue;
    if (Math.abs(s.x - c.x) > 1500 || Math.abs(s.y - c.y) > 1500) continue;
    if (!initial && inView(s.x, s.y, 80)) continue;
    if (chance(0.4)) {
      const car = new Car(pick(['sedan', 'sedan', 'sports', 'taxi', 'sedan', 'sports']), s.x, s.y, s.ang + (chance(0.5) ? Math.PI : 0));
      car.spot = s; s.car = car;
      G.cars.push(car);
    } else s.cool = 30;
  }
}

// ---------- police / wanted level ----------
function updateHeat(dt) {
  const p = G.player;
  G.seenT -= dt;
  if (G.seenT <= 0) {
    G.seenT = 0.3;
    G.seen = false;
    if (!p.dead && G.overT <= 0) {
      for (const c of G.cars) {
        if (c.driver !== 'cop' || c.dead) continue;
        const d = dist(c.x, c.y, p.x, p.y);
        if (d < 650 && hasLOS(c.x, c.y, p.x, p.y)) {
          G.seen = true;
          if (G.stars() > 0 && c.ai && c.ai.mode !== 'chase') { c.ai.mode = 'chase'; c.ai.cruise = 9999; }
        }
      }
      if (!G.seen) for (const q of G.peds) if (q.type === 'cop' && !q.dead && dist(q.x, q.y, p.x, p.y) < 550 && hasLOS(q.x, q.y, p.x, p.y)) { G.seen = true; break; }
    }
    if (G.seen && G.heat >= 1) G.lastSeen = G.time;
  }
  if (G.heat > 0 && G.time - G.lastSeen > 6) G.heat = Math.max(0, G.heat - 0.14 * dt);
  const st = G.stars();
  if (st > G.lastStars) Sfx.star();
  if (st === 0 && G.lastStars > 0) {
    for (const c of G.cars) if (c.ai && c.ai.mode === 'chase') { c.ai.mode = 'traffic'; c.ai.cruise = rand(170, 240); c.ai.plan = null; }
    message('Lost the cops', '#9f9', 2);
  }
  G.lastStars = st;

  if (st > 0 && !p.dead && G.overT <= 0) {
    G.dispT -= dt;
    if (G.dispT <= 0) {
      G.dispT = 1.5;
      const want = [0, 1, 2, 3, 5, 7][st];
      let n = 0;
      for (const c of G.cars) if (c.driver === 'cop' && c.ai && c.ai.mode === 'chase') n++;
      if (n < want) spawnPolice();
    }
    if (!p.inCar) {
      for (const c of G.cars) {
        if (c.driver === 'cop' && c.ai && c.ai.mode === 'chase' && c.ai.los && c.speed < 70 && dist(c.x, c.y, p.x, p.y) < 200) copsExit(c);
      }
    }
  }
}

// ---------- camera ----------
function updateCamera(dt) {
  const p = G.player, c = G.cam;
  let tx = p.x, ty = p.y, zt = 1;
  if (p.inCar) { tx += p.inCar.vx * 0.45; ty += p.inCar.vy * 0.45; zt = clamp(1 - p.inCar.speed / 1300, 0.6, 1); }
  const k = Math.min(1, dt * 4);
  c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
  c.zoom += (zt - c.zoom) * Math.min(1, dt * 1.5);
  c.shake = Math.min(30, c.shake) * Math.exp(-6 * dt);
  computeView();
}

function computeView() {
  const c = G.cam;
  G.S = G.base * c.zoom;
  G.view = { x0: c.x - G.W / 2 / G.S, y0: c.y - G.H / 2 / G.S, x1: c.x + G.W / 2 / G.S, y1: c.y + G.H / 2 / G.S };
  mouse.wx = (mouse.sx * G.dpr - G.W / 2) / G.S + c.x;
  mouse.wy = (mouse.sy * G.dpr - G.H / 2) / G.S + c.y;
}

// ---------- main update ----------
function update(dt) {
  G.time += dt;
  updatePlayer(dt);

  for (const car of G.cars) {
    let inp = NO_INPUT;
    if (car.driver === 'player') inp = G.overT > 0 ? NO_INPUT : car.input;
    else if ((car.driver === 'ai' || car.driver === 'cop') && car.ai) inp = aiDrive(car, dt);
    car.update(dt, inp);
    carTileCollision(car);
  }
  const cars = G.cars;
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) collideCars(cars[i], cars[j]);
  carPedCollisions();
  if (G.player.inCar) { G.player.x = G.player.inCar.x; G.player.y = G.player.inCar.y; }

  for (let i = 0; i < G.peds.length; i++) G.peds[i].update(dt);
  updateProjectiles(dt);
  updateBarrels(dt);
  updatePickups(dt);
  FX.update(dt);
  G.peds = G.peds.filter(p => !p.dead || p === G.player);

  updateHeat(dt);
  G.spawnT -= dt;
  if (G.spawnT <= 0) { G.spawnT = 0.5; spawnTick(false); }
  updateCamera(dt);

  if (G.overT > 0) { G.overT -= dt; if (G.overT <= 0) respawn(); }
  G.hurtFlash = Math.max(0, G.hurtFlash - dt);
  for (const m of G.msgs) m.t -= dt;
  G.msgs = G.msgs.filter(m => m.t > 0);
  for (const k in pressed) delete pressed[k];
}

// ---------- rendering ----------
function render() {
  const ctx = G.ctx, W = G.W, H = G.H, c = G.cam;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1d4e78'; ctx.fillRect(0, 0, W, H);
  if (!G.player) return;
  computeView();
  const S = G.S;
  const shx = (Math.random() - 0.5) * c.shake, shy = (Math.random() - 0.5) * c.shake;
  const cx = c.x + shx, cy = c.y + shy, v = G.view;
  ctx.setTransform(S, 0, 0, S, W / 2 - cx * S, H / 2 - cy * S);

  const CS = CH * T, NC = Math.ceil(MW / CH);
  const i0 = Math.max(0, Math.floor(v.x0 / CS)), i1 = Math.min(NC - 1, Math.floor(v.x1 / CS));
  const j0 = Math.max(0, Math.floor(v.y0 / CS)), j1 = Math.min(NC - 1, Math.floor(v.y1 / CS));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ctx.drawImage(World.getChunk(i, j), i * CS, j * CS, CS + 1, CS + 1);

  FX.drawGround(ctx, v);
  drawPickups(ctx);
  drawBarrels(ctx);
  for (const p of G.peds) if (!p.dead && !p.inCar && inView(p.x, p.y, 20)) drawPed(ctx, p);
  for (const car of G.cars) if (inView(car.x, car.y, 60)) drawCar(ctx, car);
  drawProjectiles(ctx);
  FX.drawParticles(ctx, v);
  World.drawTrees(ctx, c.x, c.y, v);
  World.drawBuildings(ctx, c.x, c.y, v);
  FX.drawHigh(ctx, v);
  FX.drawPopups(ctx);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHUD(ctx);
}

function drawPickups(ctx) {
  const t = G.time;
  for (const pk of G.pickups) {
    if (pk.hidden || !inView(pk.x, pk.y, 20)) continue;
    if (pk.temp && pk.temp < 4 && (t * 8 % 1) < 0.5) continue;
    const bob = Math.sin(t * 4 + pk.x) * 2, s = 11;
    ctx.save(); ctx.translate(pk.x, pk.y + bob);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,200,${0.12 + Math.sin(t * 5) * 0.06})`; circle(ctx, 0, 0, 20);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-s + 3, -s + 4, s * 2, s * 2);
    if (pk.kind === 'weapon') {
      ctx.fillStyle = '#2b2b30'; ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.strokeStyle = WEAPONS[pk.wk].col; ctx.lineWidth = 2; ctx.strokeRect(-s + 1, -s + 1, s * 2 - 2, s * 2 - 2);
      ctx.fillStyle = WEAPONS[pk.wk].col; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(PICKUP_LETTER[pk.wk], 0, 1);
    } else if (pk.kind === 'health') {
      ctx.fillStyle = '#f4f4f4'; ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.fillStyle = '#d22'; ctx.fillRect(-3, -8, 6, 16); ctx.fillRect(-8, -3, 16, 6);
    } else if (pk.kind === 'armor') {
      ctx.fillStyle = '#2a4f9a'; ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.fillStyle = '#cfe0ff';
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, -5); ctx.lineTo(5, 4); ctx.lineTo(0, 8); ctx.lineTo(-5, 4); ctx.lineTo(-7, -5); ctx.closePath(); ctx.fill();
    } else if (pk.kind === 'money') {
      ctx.fillStyle = '#3c8a3a'; ctx.fillRect(-s, -7, s * 2, 14);
      ctx.fillStyle = '#bff0a8'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1);
    }
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
}

function starPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

function outlinedText(ctx, text, x, y, fill, lw = 4) {
  ctx.lineWidth = lw; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill; ctx.fillText(text, x, y);
}

function drawHUD(ctx) {
  const W = G.W, H = G.H, u = Math.max(0.7, Math.min(W, H) / 820), p = G.player;
  const font = (px) => `bold ${Math.round(px * u)}px "Trebuchet MS", Arial, sans-serif`;
  const pad = 18 * u;

  if (G.hurtFlash > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    g.addColorStop(0, 'rgba(200,0,0,0)'); g.addColorStop(1, `rgba(200,0,0,${G.hurtFlash})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  // Money + wanted stars (top right)
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.font = font(34);
  outlinedText(ctx, '$' + String(Math.max(0, G.money)).padStart(8, '0'), W - pad, pad, '#7dff6a', 5 * u);
  const st = G.stars(), flash = !G.seen && st > 0 && (G.time * 3 % 1) < 0.5;
  for (let i = 0; i < 5; i++) {
    const x = W - pad - 16 * u - i * 36 * u, y = pad + 62 * u;
    starPath(ctx, x, y, 15 * u);
    const on = 4 - i < st;
    ctx.fillStyle = on ? (flash ? '#886a10' : '#ffd23a') : 'rgba(0,0,0,0.35)';
    ctx.fill(); ctx.lineWidth = 2.5 * u; ctx.strokeStyle = on ? '#000' : 'rgba(255,255,255,0.35)'; ctx.stroke();
  }
  ctx.font = font(14);
  outlinedText(ctx, `KILLS ${G.kills}`, W - pad, pad + 84 * u, '#ddd', 3 * u);

  // Weapon + health (top left)
  ctx.textAlign = 'left';
  const w = WEAPONS[p.weapon];
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; rrect(ctx, pad, pad, 230 * u, 88 * u, 8 * u); ctx.fill();
  ctx.font = font(20);
  outlinedText(ctx, w.name.toUpperCase(), pad + 12 * u, pad + 8 * u, w.col || '#eee', 4 * u);
  ctx.font = font(26);
  const ammo = p.weapons[p.weapon];
  outlinedText(ctx, ammo === Infinity ? '∞' : String(ammo || 0), pad + 12 * u, pad + 32 * u, '#fff', 4 * u);
  const bw = 206 * u, bx = pad + 12 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(bx, pad + 66 * u, bw, 7 * u);
  ctx.fillStyle = p.hp < 30 && (G.time * 4 % 1) < 0.5 ? '#ff8080' : '#e23b3b'; ctx.fillRect(bx, pad + 66 * u, bw * clamp(p.hp / 100, 0, 1), 7 * u);
  if (p.armor > 0) { ctx.fillStyle = '#4b8cff'; ctx.fillRect(bx, pad + 75 * u, bw * clamp(p.armor / 100, 0, 1), 5 * u); }

  // Messages
  ctx.font = font(18);
  G.msgs.forEach((m, i) => { ctx.globalAlpha = clamp(m.t, 0, 1); outlinedText(ctx, m.text, pad, pad + (100 + i * 26) * u, m.col, 4 * u); });
  ctx.globalAlpha = 1;

  // Vehicle info (bottom right)
  if (p.inCar) {
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.font = font(34);
    outlinedText(ctx, `${Math.round(Math.abs(p.inCar.fwdSpeed()) * 0.36)} km/h`, W - pad, H - pad - 22 * u, '#fff', 5 * u);
    ctx.font = font(16);
    const hpf = clamp(p.inCar.hp / p.inCar.t.hp, 0, 1);
    outlinedText(ctx, `${p.inCar.t.name.toUpperCase()}  ${Math.round(hpf * 100)}%`, W - pad, H - pad, p.inCar.burnT >= 0 ? '#f63' : hpf < 0.35 ? '#fa3' : '#ccc', 3 * u);
  }

  drawMinimap(ctx, pad, H - pad - 170 * u, 170 * u);

  // Crosshair
  if (!p.dead && G.overT <= 0) {
    let mx = mouse.sx * G.dpr, my = mouse.sy * G.dpr;
    if (keyAim.active) {
      // Park the crosshair a fixed distance out along the keyboard aim direction.
      const R = (p.inCar ? p.inCar.t.w / 2 + 110 : 110);
      mx = G.W / 2 + (p.x + Math.cos(keyAim.ang) * R - G.cam.x) * G.S;
      my = G.H / 2 + (p.y + Math.sin(keyAim.ang) * R - G.cam.y) * G.S;
    }
    const r = 9 * u;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 4 * u;
    for (const col of ['rgba(0,0,0,0.7)', '#fff']) {
      ctx.strokeStyle = col; ctx.lineWidth = col === '#fff' ? 1.6 * u : 4 * u;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, TAU);
      ctx.moveTo(mx - r * 1.8, my); ctx.lineTo(mx - r * 0.6, my); ctx.moveTo(mx + r * 0.6, my); ctx.lineTo(mx + r * 1.8, my);
      ctx.moveTo(mx, my - r * 1.8); ctx.lineTo(mx, my - r * 0.6); ctx.moveTo(mx, my + r * 0.6); ctx.lineTo(mx, my + r * 1.8);
      ctx.stroke();
    }
  }

  if (G.overT > 0) {
    const a = clamp((4 - G.overT) * 1.5, 0, 1);
    ctx.fillStyle = `rgba(0,0,0,${a * 0.45})`; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `italic ${font(96)}`;
    ctx.globalAlpha = a;
    outlinedText(ctx, G.overKind === 'busted' ? 'BUSTED' : 'WASTED', W / 2, H / 2, G.overKind === 'busted' ? '#4b8cff' : '#e8322b', 10 * u);
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = 'alphabetic';
}

function drawMinimap(ctx, x, y, size) {
  const p = G.player, span = 44;
  ctx.save();
  rrect(ctx, x, y, size, size, 10); ctx.fillStyle = '#1d4e78'; ctx.fill();
  ctx.clip();
  const tx = p.x / T - span / 2, ty = p.y / T - span / 2, k = size / span;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(World.minimap, tx, ty, span, span, x, y, size, size);
  ctx.imageSmoothingEnabled = true;
  const toM = (wx, wy) => [x + (wx / T - tx) * k, y + (wy / T - ty) * k];
  for (const pk of G.pickups) {
    if (pk.hidden || pk.temp) continue;
    const [mx, my] = toM(pk.x, pk.y);
    ctx.fillStyle = pk.kind === 'weapon' ? WEAPONS[pk.wk].col : pk.kind === 'health' ? '#f55' : '#58f';
    ctx.fillRect(mx - 2, my - 2, 4, 4);
  }
  for (const c of G.cars) {
    if (c.driver !== 'cop' || c.dead) continue;
    const [mx, my] = toM(c.x, c.y);
    ctx.fillStyle = (G.time * 4 % 1) < 0.5 ? '#f33' : '#36f'; circle(ctx, mx, my, 3.5);
  }
  for (const q of G.peds) {
    if (q.type !== 'cop' || q.dead || G.stars() === 0) continue;
    const [mx, my] = toM(q.x, q.y);
    ctx.fillStyle = '#9bf'; ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
  }
  const [hx, hy] = toM(World.hospital.x, World.hospital.y);
  ctx.fillStyle = '#fff'; ctx.fillRect(hx - 4, hy - 4, 8, 8); ctx.fillStyle = '#d22'; ctx.fillRect(hx - 1, hy - 3, 2, 6); ctx.fillRect(hx - 3, hy - 1, 6, 2);
  const [px, py] = toM(p.x, p.y);
  const a = p.inCar ? p.inCar.angle : p.ang;
  ctx.save(); ctx.translate(px, py); ctx.rotate(a);
  ctx.fillStyle = '#ffd23a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  rrect(ctx, x, y, size, size, 10); ctx.stroke();
}

// ---------- setup ----------
function resize() {
  G.dpr = Math.min(window.devicePixelRatio || 1, 2);
  G.W = G.canvas.width = Math.floor(innerWidth * G.dpr);
  G.H = G.canvas.height = Math.floor(innerHeight * G.dpr);
  G.base = Math.sqrt(G.W * G.H) / 1050;
  if (G.player) computeView();
}

function initWorld() {
  World.gen(20260926);
  const h = World.hospital;
  G.player = makePlayer(h.x, h.y);
  G.peds.push(G.player);
  G.cam.x = h.x; G.cam.y = h.y;
  computeView();

  // A getaway car waiting next to the start.
  const s = roadSpawn(80, 400, true);
  if (s) { const car = new Car('sports', s.x, s.y, s.dir * Math.PI / 2); car.color = [230, 60, 30]; G.cars.push(car); }

  for (const b of World.barrelSpots) G.barrels.push({ x: b.x, y: b.y, hp: 20, fuse: -1, dead: false, respawnT: 0, spot: b, byPlayer: false });

  const kinds = [['weapon', 'pistol', 20], ['weapon', 'uzi', 16], ['weapon', 'shotgun', 14], ['weapon', 'flamer', 9], ['weapon', 'rocket', 9],
    ['weapon', 'grenade', 11], ['health', null, 10], ['armor', null, 8]];
  const total = kinds.reduce((a, k) => a + k[2], 0);
  const R = mulberry32(7);
  const tiles = World.walkTiles;
  const placed = [];
  for (let n = 0; n < 90; n++) {
    let q = R() * total, k = kinds[0];
    for (const kk of kinds) { if (q < kk[2]) { k = kk; break; } q -= kk[2]; }
    const [tx, ty] = tiles[Math.floor(R() * tiles.length)];
    const x = tx * T + 32, y = ty * T + 32;
    if (placed.some(o => dist(o[0], o[1], x, y) < 300)) continue;
    placed.push([x, y]);
    G.pickups.push({ x, y, kind: k[0], wk: k[1], amount: k[1] ? WEAPONS[k[1]].pick : 0 });
  }
  // Guaranteed goodies near the start.
  const near = tiles.filter(([tx, ty]) => { const d = dist(tx * T, ty * T, h.x, h.y); return d > 120 && d < 500; });
  ['uzi', 'rocket', 'shotgun', 'grenade', 'flamer'].forEach((wk, i) => {
    const [tx, ty] = near[Math.floor((i + 0.5) / 5 * near.length)];
    G.pickups.push({ x: tx * T + 32, y: ty * T + 32, kind: 'weapon', wk, amount: WEAPONS[wk].pick });
  });

  spawnTick(true);
}

function setupInput() {
  addEventListener('keydown', e => {
    if (!keys[e.code]) pressed[e.code] = true;
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code) || e.code.startsWith('Numpad')) e.preventDefault();
    // Start or resume from the keyboard too.
    if (!G.running() && ['Enter', 'NumpadEnter', 'Numpad0'].includes(e.code)) { e.preventDefault(); document.getElementById('play').click(); for (const k in pressed) delete pressed[k]; return; }
    if (e.code === 'KeyM') Sfx.toggleMute();
    if ((e.code === 'KeyP' || e.code === 'Escape') && G.started) setPaused(!G.paused);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; if (G.started) setPaused(true); });
  const c = G.canvas;
  c.addEventListener('mousemove', e => { mouse.sx = e.clientX; mouse.sy = e.clientY; keyAim.active = false; });
  c.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; Sfx.init(); });
  addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  c.addEventListener('contextmenu', e => e.preventDefault());
  c.addEventListener('wheel', e => { if (G.running()) cycleWeapon(e.deltaY > 0 ? 1 : -1); e.preventDefault(); }, { passive: false });
  addEventListener('resize', resize);
}

function setPaused(v) {
  G.paused = v;
  const ov = document.getElementById('overlay');
  ov.classList.toggle('hidden', !v);
  document.getElementById('play').textContent = v ? 'RESUME' : 'PLAY';
  document.getElementById('tagline').textContent = v ? 'PAUSED' : 'A top-down open-world crime sandbox';
  mouse.down = false;
}

function start() {
  G.canvas = document.getElementById('game');
  G.ctx = G.canvas.getContext('2d');
  resize();
  setupInput();
  initWorld();
  mouse.sx = innerWidth / 2 + 60; mouse.sy = innerHeight / 2;
  document.getElementById('play').addEventListener('click', () => {
    Sfx.init();
    G.started = true;
    setPaused(false);
    for (const k in pressed) delete pressed[k];
  });
  let last = performance.now(), acc = 0;
  const step = 1 / 60;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (G.running()) {
      acc += dt;
      let n = 0;
      while (acc >= step && n < 5) { update(step); acc -= step; n++; }
      if (n === 5) acc = 0;
    }
    render();
    Sfx.update();
  }
  requestAnimationFrame(frame);
}

window.addEventListener('load', start);
