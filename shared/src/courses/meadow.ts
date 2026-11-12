import type { CourseInput } from '../schema';
import { block, coinLine, decor, item, makeHole, pillar, slab, wall, zone, WALL_T } from './builder';

const H = (n: number) => `meadow-${n}`;
const o = WALL_T / 2;

/** World 1 — tutorial-friendly. Each hole introduces one idea. */
export const meadow: CourseInput = {
  id: 'meadow',
  name: 'Sunny Meadow',
  world: 'meadow',
  description: 'Gentle greens and a friendly windmill. The perfect place to learn.',
  theme: {
    skyTop: '#4aa8ff',
    skyBottom: '#e3f4ff',
    fog: '#cfe8f7',
    fogNear: 35,
    fogFar: 110,
    floorA: '#5fbf4f',
    floorB: '#4fae42',
    wall: '#a8683a',
    wallTop: '#c98c55',
    block: '#e0a458',
    ground: '#6fb85c',
    water: '#3fa7e0',
    sun: '#fff4dc',
    sunIntensity: 2.4,
    ambient: '#dff1ff',
    decorKit: 'meadow',
    music: { root: 60, scale: 'major', bpm: 96 },
  },
  holes: [
    // 1 ─ straight, just learn to putt
    makeHole({
      id: H(1),
      name: 'First Putt',
      par: 2,
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      tip: 'Drag back from the ball and release to putt (or hold Space). Coins are free XP!',
      collectibles: coinLine(H(1), [3, 0, 0], [7, 0, 0], 4),
    }),
    // 2 ─ dogleg: walls are your friend
    makeHole({
      id: H(2),
      name: 'Dogleg',
      par: 2,
      points: [
        [0, 0, 0],
        [9, 0, 0],
        [9, 0, 7],
      ],
      tip: 'Bounce off the wall to turn the corner. Rotate the camera with right-drag or Q/E.',
      collectibles: [
        ...coinLine(H(2), [4, 0, 0], [8, 0, 0], 3),
        ...coinLine(H(2), [9, 0, 2.5], [9, 0, 4.5], 2),
      ],
    }),
    // 3 ─ ramps
    makeHole({
      id: H(3),
      name: 'Little Hill',
      par: 3,
      points: [
        [0, 0, 0],
        [4, 0, 0],
        [7, 0.7, 0],
        [11, 0.7, 0],
        [14, 0, 0],
        [18, 0, 0],
      ],
      tip: 'Uphill needs a firmer putt. Watch your speed coming down!',
      collectibles: [
        ...coinLine(H(3), [5, 0.35, 0], [6.5, 0.6, 0], 2),
        item(H(3), 'gem', 10.5, 0.7, -0.75),
        ...coinLine(H(3), [15, 0, 0], [16.5, 0, 0], 2),
      ],
    }),
    // 4 ─ sand
    makeHole({
      id: H(4),
      name: 'Sand Trap',
      par: 3,
      fairway: { width: 2.4 },
      points: [
        [0, 0, 0],
        [7, 0, 0],
        [7, 0, 7],
        [15, 0, 7],
      ],
      zones: [zone('sand', 11, 7, 2.2, 1.8, 0), zone('sand', 7, 2.2, 2.4, 1.4, 0)],
      tip: 'Sand grabs the ball. Find the gap or putt hard.',
      collectibles: [
        ...coinLine(H(4), [2, 0, 0], [5, 0, 0], 3),
        item(H(4), 'coin', 11, 0, 5.95),
        item(H(4), 'coin', 11, 0, 8.05),
      ],
      decor: [decor('rock', 3, -1.1, -2.2, 1.4), decor('rock', 12, -1.1, 9.4, 1.1)],
    }),
    // 5 ─ the windmill
    makeHole({
      id: H(5),
      name: 'The Windmill',
      par: 3,
      fairway: { width: 2.4 },
      points: [
        [0, 0, 0],
        [17, 0, 0],
      ],
      obstacles: [
        {
          type: 'windmill',
          id: 'wm',
          pos: [8.5, 0, 0],
          rotY: 0,
          speed: 1.1,
          baseWidth: 2.8,
          tunnelWidth: 0.8,
          phase: 0,
          bladeLength: 1.9,
        },
      ],
      tip: 'Time your putt between the blades. The tunnel is the only way through.',
      collectibles: [
        ...coinLine(H(5), [2, 0, 0], [5, 0, 0], 3),
        item(H(5), 'gem', 10.2, 0, -0.95),
        ...coinLine(H(5), [12, 0, 0], [14, 0, 0], 2),
      ],
    }),
    // 6 ─ water
    makeHole({
      id: H(6),
      name: 'Lily Pond',
      par: 3,
      fairway: { width: 2.4, noFloor: [1] },
      points: [
        [0, 0, 0],
        [6, 0, 0],
        [13, 0, 0],
        [19, 0, 0],
      ],
      solids: [slab(6, -0.45, 13, 0.45, 0, 'grass')],
      zones: [zone('water', 9.5, 0, 7, 2.4, 0)],
      tip: 'Splash = +1 stroke and back to your last spot. Stay on the bridge!',
      collectibles: [...coinLine(H(6), [7, 0, 0], [12, 0, 0], 5), item(H(6), 'gem', 18.4, 0, 0.9)],
    }),
    // 7 ─ bumper garden (open room), golden ball hidden behind the bumpers
    makeHole({
      id: H(7),
      name: 'Bumper Garden',
      par: 3,
      fairway: { width: 2, openEnd: true },
      points: [
        [0, 0, 0],
        [5, 0, 0],
      ],
      path: [
        [0, 0, 0],
        [5, 0, 0],
        [9, 0, 0],
        [11.5, 0, 2.5],
      ],
      cup: [11.5, 0, 2.5],
      solids: [
        slab(5, -4, 13, 4, 0),
        wall([5, 0, -4 - o], [13 + o, 0, -4 - o]),
        wall([13 + o, 0, -4 - o], [13 + o, 0, 4 + o]),
        wall([13 + o, 0, 4 + o], [5 - o, 0, 4 + o]),
        wall([5 - o, 0, 4 + o], [5 - o, 0, 1 + o]),
        wall([5 - o, 0, -1 - o], [5 - o, 0, -4 - o]),
        block(9, -1.5, 0.6, 2.4, 0, 0.5, 0, '#e0a458'),
      ],
      obstacles: [
        { type: 'bumper', id: 'b1', pos: [8, 0, 1.6], radius: 0.4, height: 0.4, strength: 1, phase: 0 },
        { type: 'bumper', id: 'b2', pos: [10.5, 0, 0.2], radius: 0.4, height: 0.4, strength: 1, phase: 0 },
        { type: 'bumper', id: 'b3', pos: [11, 0, -2.4], radius: 0.4, height: 0.4, strength: 1, phase: 0 },
        { type: 'bumper', id: 'b4', pos: [7, 0, -2.6], radius: 0.4, height: 0.4, strength: 1, phase: 0 },
      ],
      tip: 'Bumpers launch the ball. The golden ball is tucked away somewhere here…',
      collectibles: [
        item(H(7), 'golden', 12.3, 0, -3.3),
        ...coinLine(H(7), [6, 0, 0], [8, 0, 0], 3),
        item(H(7), 'coin', 6, 0, -3.3),
        item(H(7), 'coin', 12.3, 0, 3.3),
      ],
      decor: [decor('flower', 4, -1, -1.4), decor('flower', 4.4, -1, 1.5)],
    }),
    // 8 ─ spinner U-turn
    makeHole({
      id: H(8),
      name: 'Spin Cycle',
      par: 3,
      fairway: { width: 2.6 },
      points: [
        [0, 0, 0],
        [8, 0, 0],
        [8, 0, 7],
        [0, 0, 7],
      ],
      obstacles: [
        {
          type: 'spinner',
          id: 'sp',
          pos: [8, 0, 3.5],
          length: 2.3,
          arms: 2,
          speed: 1.3,
          height: 0.3,
          thickness: 0.18,
          phase: 0,
        },
      ],
      solids: [pillar(4, 3.5, 1.2, 0, 0.6, '#e0a458')],
      tip: 'Sneak past the spinner — or use it to swat the ball around the bend.',
      collectibles: [
        ...coinLine(H(8), [3, 0, 0], [6, 0, 0], 3),
        item(H(8), 'gem', 9.0, 0, -0.9),
        ...coinLine(H(8), [6, 0, 7], [3, 0, 7], 3),
      ],
    }),
    // 9 ─ finale: climb, turn, slide down past a moving block
    makeHole({
      id: H(9),
      name: 'Meadow Finale',
      par: 4,
      fairway: { width: 2.4 },
      points: [
        [0, 0, 0],
        [8, 0, 0],
        [12, 1, 0],
        [16, 1, 0],
        [16, 1, 6],
        [16, 0, 10],
        [16, 0, 15],
      ],
      obstacles: [
        {
          type: 'mover',
          id: 'mv',
          size: [0.9, 0.5, 0.5],
          from: [15.3, 0.25, 12.2],
          to: [16.7, 0.25, 12.2],
          period: 3.2,
          rotY: 0,
          role: 'block',
          phase: 0,
        },
      ],
      tip: 'Final hole! A firm putt up the ramp, then mind the sliding block.',
      collectibles: [
        ...coinLine(H(9), [3, 0, 0], [7, 0, 0], 3),
        item(H(9), 'crate', 16.8, 1, -0.8),
        ...coinLine(H(9), [16, 1, 2], [16, 1, 5], 3),
        ...coinLine(H(9), [16, 0, 10.8], [16, 0, 11.6], 2),
      ],
    }),
  ],
};
