import type { CourseInput, Obstacle } from '../schema';
import { coinLine, fairway, item, makeHole, pillar, room, zone } from './builder';

const H = (n: number) => `space-${n}`;
const G = 0.55; // station gravity
const rock = (id: string, x: number, z: number, r = 0.4): Obstacle => ({
  type: 'bumper',
  id,
  pos: [x, 0, z],
  radius: r,
  height: 0.45,
  strength: 0.8,
  phase: 0,
});

/** World 5 (stretch) — low gravity: balls fly further off ramps and float over gaps. */
export const space: CourseInput = {
  id: 'space',
  name: 'Space Station',
  world: 'space',
  description: 'Low gravity, wormholes and the void. Long jumps, soft landings.',
  theme: {
    skyTop: '#05051a',
    skyBottom: '#2a1a5e',
    fog: '#160f38',
    fogNear: 45,
    fogFar: 160,
    floorA: '#4a4f8a',
    floorB: '#3f4479',
    wall: '#7c4dff',
    wallTop: '#b388ff',
    block: '#00bcd4',
    ground: '#1a1838',
    water: '#000010',
    sun: '#d6dcff',
    sunIntensity: 2.0,
    ambient: '#a3a8ff',
    decorKit: 'space',
    music: { root: 50, scale: 'pentatonic', bpm: 92 },
  },
  holes: [
    // Ramp jump over the void.
    makeHole({
      id: H(1),
      name: 'Moonwalk',
      par: 2,
      gravityScale: G,
      fairway: false,
      points: [
        [0, 0, 0],
        [5, 0, 0],
        [7, 0.6, 0],
        [10.5, 0, 0],
        [16, 0, 0],
      ],
      solids: [
        ...fairway(
          [
            [0, 0, 0],
            [5, 0, 0],
            [7, 0.6, 0],
          ],
          { width: 2.2, openEnd: true },
        ),
        ...fairway(
          [
            [10.5, 0, 0],
            [16, 0, 0],
          ],
          { width: 2.6, openStart: true },
        ),
      ],
      tip: 'Low gravity! Launch off the ramp and float over the gap.',
      collectibles: [...coinLine(H(1), [7.8, 1.0, 0], [9.7, 0.8, 0], 3), item(H(1), 'gem', 15.4, 0, 1.05)],
    }),
    makeHole({
      id: H(2),
      name: 'Wormhole',
      par: 2,
      gravityScale: G,
      fairway: false,
      points: [
        [0, 0, 0],
        [6, 0, 0],
      ],
      cup: [7, 0, 6],
      path: [
        [0, 0, 0],
        [5, 0, 0],
        [1, 0, 6],
        [7, 0, 6],
      ],
      solids: [
        ...fairway(
          [
            [0, 0, 0],
            [6, 0, 0],
          ],
          { width: 2 },
        ),
        ...fairway(
          [
            [0, 0, 6],
            [8, 0, 6],
          ],
          { width: 2.2 },
        ),
      ],
      obstacles: [
        { type: 'teleporter', id: 'wh', a: [5, 0, 0], b: [0.4, 0, 6], exitDir: 0, radius: 0.45, phase: 0 },
      ],
      tip: 'Roll into the wormhole. It comes out somewhere interesting.',
      collectibles: [
        ...coinLine(H(2), [1.5, 0, 0], [3.5, 0, 0], 3),
        ...coinLine(H(2), [2.5, 0, 6], [5, 0, 6], 2),
      ],
    }),
    makeHole({
      id: H(3),
      name: 'Zero-G Loop',
      par: 3,
      gravityScale: G,
      fairway: false,
      points: [
        [0, 0, -0.6],
        [6, 0, -0.6],
        [6, 0, 0.6],
        [14, 0, 0.6],
      ],
      solids: [
        ...fairway(
          [
            [0, 0, -0.6],
            [6.2, 0, -0.6],
          ],
          { width: 1.1, openEnd: true },
        ),
        ...fairway(
          [
            [5.6, 0, 0.6],
            [14, 0, 0.6],
          ],
          { width: 1.1, openStart: true },
        ),
      ],
      obstacles: [
        {
          type: 'loop',
          id: 'loop',
          pos: [6, 0, -0.6],
          rotY: 0,
          radius: 1.3,
          width: 0.9,
          shift: 1.2,
          segments: 32,
          phase: 0,
        },
      ],
      tip: 'A bigger loop — but gravity is weaker up here.',
      collectibles: [...coinLine(H(3), [1.5, 0, -0.6], [4, 0, -0.6], 3), item(H(3), 'crate', 13.4, 0, 1.0)],
    }),
    makeHole({
      id: H(4),
      name: 'Asteroid Field',
      par: 3,
      gravityScale: G,
      fairway: { width: 2, openEnd: true },
      points: [
        [0, 0, 0],
        [4, 0, 0],
      ],
      path: [
        [0, 0, 0],
        [4, 0, 0],
        [12, 0, 1],
      ],
      cup: [12.4, 0, 1.4],
      solids: room(4, -3.5, 14, 3.5, 0, [{ side: 'xmin', from: -1, to: 1 }]),
      obstacles: [
        rock('a1', 6.5, -0.8),
        rock('a2', 7.5, 1.5, 0.5),
        rock('a3', 9, -1.8),
        rock('a4', 9.6, 0.4, 0.35),
        rock('a5', 11.2, -0.6),
        rock('a6', 12, 2.8, 0.3),
        rock('a7', 11, 2.2, 0.3),
      ],
      tip: 'Asteroids bounce you around. Find a clean line.',
      collectibles: [item(H(4), 'golden', 13.4, 0, -3), ...coinLine(H(4), [5, 0, 2.8], [8, 0, 2.8], 3)],
    }),
    makeHole({
      id: H(5),
      name: 'Orbit',
      par: 3,
      gravityScale: G,
      fairway: { width: 2.8 },
      points: [
        [0, 0, 0],
        [7, 0, 0],
        [7, 0, 7],
        [0, 0, 7],
      ],
      obstacles: [
        {
          type: 'spinner',
          id: 'o1',
          pos: [7, 0, 0],
          length: 2.6,
          arms: 2,
          speed: 0.9,
          height: 0.3,
          thickness: 0.18,
          phase: 0,
        },
        {
          type: 'spinner',
          id: 'o2',
          pos: [7, 0, 7],
          length: 2.6,
          arms: 2,
          speed: -0.9,
          height: 0.3,
          thickness: 0.18,
          phase: 1.2,
        },
      ],
      solids: [pillar(3.5, 3.5, 3, 0, 0.5, '#00bcd4')],
      tip: 'Two satellites orbit the corners.',
      collectibles: [...coinLine(H(5), [7, 0, 2.5], [7, 0, 4.5], 3), item(H(5), 'gem', 7.9, 0, 3.5)],
    }),
    // Gravity well: a low-gravity column carries the ball over a long void.
    makeHole({
      id: H(6),
      name: 'Gravity Well',
      par: 3,
      gravityScale: 0.8,
      fairway: false,
      points: [
        [0, 0, 0],
        [5, 0, 0],
        [7.5, 0.8, 0],
        [13, 0, 0],
        [18, 0, 0],
      ],
      solids: [
        ...fairway(
          [
            [0, 0, 0],
            [5, 0, 0],
            [7.5, 0.8, 0],
          ],
          { width: 2.2, openEnd: true },
        ),
        ...fairway(
          [
            [13, 0, 0],
            [18, 0, 0],
          ],
          { width: 2.6, openStart: true },
        ),
      ],
      zones: [
        zone('lowGravity', 10.2, 0, 5.4, 2.6, -2, { strength: 0.2, h: 6 }),
        zone('boost', 3.6, 0, 1.2, 2.2, 0, { dir: 0, strength: 9 }),
      ],
      tip: 'The purple field nearly cancels gravity. Float across!',
      collectibles: [...coinLine(H(6), [9, 1.8, 0], [11.5, 1.6, 0], 3), item(H(6), 'gem', 17.4, 0, -1.05)],
    }),
    makeHole({
      id: H(7),
      name: 'Docking Bay',
      par: 3,
      gravityScale: G,
      fairway: false,
      points: [
        [0, 0, 0],
        [6, 0, 0],
        [12, 0, 0],
        [17, 0, 0],
      ],
      solids: [
        ...fairway(
          [
            [0, 0, 0],
            [6, 0, 0],
          ],
          { width: 2.2, openEnd: true },
        ),
        ...fairway(
          [
            [12, 0, 0],
            [17, 0, 0],
          ],
          { width: 2.2, openStart: true },
        ),
      ],
      obstacles: [
        {
          type: 'mover',
          id: 'shuttle',
          size: [2, 0.3, 2],
          from: [7, -0.15, 0],
          to: [11, -0.15, 0],
          period: 6,
          rotY: 0,
          role: 'floor',
          phase: 0,
        },
      ],
      tip: 'Hop on the shuttle, ride it to the far dock.',
      collectibles: [...coinLine(H(7), [2, 0, 0], [4.5, 0, 0], 3), item(H(7), 'coin', 14, 0, 0)],
    }),
    // Solar wind: a sideways conveyor pushes towards the open (rail-less) edge.
    makeHole({
      id: H(8),
      name: 'Solar Wind',
      par: 3,
      gravityScale: G,
      fairway: { width: 2.8, openRight: [1] },
      points: [
        [0, 0, 0],
        [5, 0, 0],
        [12, 0, 0],
        [16, 0, 0],
      ],
      zones: [zone('conveyor', 8.5, 0, 7, 2.8, 0, { dir: -Math.PI / 2, strength: 2.2 })],
      tip: 'Solar wind blows towards the void. Aim upwind!',
      collectibles: [...coinLine(H(8), [6, 0, 1], [11, 0, 1], 4)],
    }),
    makeHole({
      id: H(9),
      name: 'Mission Control',
      par: 4,
      gravityScale: G,
      fairway: false,
      points: [
        [0, 0, 0],
        [7, 0, 0],
        [7, 0, 6],
        [13, 0, 6],
      ],
      cup: [13, 0, 6],
      path: [
        [0, 0, 0],
        [6, 0, 0],
        [7, 0, 2],
        [7, 0, 6],
        [13, 0, 6],
      ],
      solids: [
        ...fairway(
          [
            [0, 0, 0],
            [7, 0, 0],
            [7, 0, 6],
            [14, 0, 6],
          ],
          { width: 2.4 },
        ),
      ],
      obstacles: [
        rock('r1', 3.5, 0.5),
        rock('r2', 5, -0.6),
        {
          type: 'spinner',
          id: 's',
          pos: [7, 0, 3],
          length: 2.4,
          arms: 3,
          speed: 1.1,
          height: 0.3,
          thickness: 0.18,
          phase: 0,
        },
        rock('r3', 10.5, 6.5, 0.32),
      ],
      zones: [zone('lowGravity', 10, 6, 2, 2.4, 0, { strength: 0.3, h: 2 })],
      tip: 'The final mission: asteroids, a satellite, then the landing zone.',
      collectibles: [
        ...coinLine(H(9), [1.5, 0, 0], [2.5, 0, 0], 2),
        item(H(9), 'coin', 7.8, 0, 5.2),
        item(H(9), 'coin', 12, 0, 6.9),
      ],
    }),
  ],
};
