# Mayhem City

A top-down, open-world crime sandbox in the style of the classic 2D GTA games, built with plain HTML5 canvas and JavaScript. It has no dependencies, no build step and no image or audio files: every sprite is drawn procedurally and every sound is synthesized with WebAudio.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
npx http-server .   # or: python3 -m http.server
```

## Controls

| Key | Action |
| --- | --- |
| WASD / Arrows | Walk, or drive (accelerate, brake/reverse, steer) |
| Mouse | Aim and shoot (also from inside cars) |
| Numpad 1–9 (not 5) | Aim with the keyboard in 8 directions (8 = up, 9 = up-right, or press two together). Moving the mouse switches back to mouse aim |
| Numpad 0 | Shoot (hold for automatic fire) |
| F / Enter / Numpad Enter | Get in or out of a car. Jacks the car if someone is driving |
| Space | Handbrake / drift |
| X / Numpad . | Eject from a car. A hang glider opens at the top of the jump: A/D turn, W dives for speed, S pulls up. Press again to cut the glider loose |
| Shift | Sprint |
| 1–7, Q/E, Numpad −/+, mouse wheel | Switch weapon |
| H / M / P or Esc | Horn / mute / pause |

## Features

- **Procedural city**: a road grid with lanes, crosswalks, parks, ponds, plazas, parking lots and alleys, surrounded by water. Buildings are drawn in pseudo-3D and lean away from the camera.
- **Driving**: arcade physics with drifting, skid marks and tire smoke. Six vehicle types (sedan, taxi, sports car, van, truck, police cruiser). Crashes bounce and spin cars. Damage makes cars smoke, then burn, then explode.
- **Traffic AI**: cars follow right-hand lanes, turn at intersections, brake for cars and pedestrians, overtake blockages and panic when shot at.
- **Pedestrians**: they walk sidewalks, cross roads, idle, flee from gunfire and explosions, and catch fire.
- **Weapons**: fists, pistol, uzi, shotgun, flamethrower, rocket launcher and grenades, collected from crates around the city. Health and body-armor pickups are also scattered around.
- **Explosions**: fireballs, shockwaves, debris and scorch marks. Explosive barrels and exploding cars set off chain reactions.
- **Ejector seat and hang glider**: blast out of any car and glide over the city. Buildings have real heights: clip a wall and you bounce off, drop onto a roof and you skid across it. Fly too slowly and you stall. Explosions and burning cars create thermals that carry you up. Landing too fast hurts, and landing in the water is fatal. You can shoot and drop grenades from the air.
- **Wanted level**: crimes add heat, from 1 to 5 stars. Police cars path through the streets to chase and ram you, and cops get out to arrest you or shoot. Break line of sight to lose them. You get **BUSTED** or **WASTED** and respawn with a fee.
- **HUD**: money, wanted stars, weapon and ammo, health and armor, minimap, speedometer.

## Code layout

| File | Contents |
| --- | --- |
| `js/util.js` | Math and drawing helpers |
| `js/audio.js` | Synthesized sound effects, engine and siren |
| `js/world.js` | Map generation, tile queries, cached ground chunks, 3D buildings, trees |
| `js/effects.js` | Particles, decals, lights, floating text |
| `js/vehicles.js` | Car physics, collisions, traffic and police AI, car rendering |
| `js/peds.js` | Pedestrian, cop and player bodies and AI |
| `js/weapons.js` | Weapons, projectiles, explosions, barrels |
| `js/glider.js` | Ejector seat, glider flight, thermals, landing |
| `js/game.js` | Game state, input, spawning, wanted system, camera, HUD, main loop |
