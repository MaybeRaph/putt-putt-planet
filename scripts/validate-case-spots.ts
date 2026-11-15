/**
 * Checks that hidden cases (v1.11) land somewhere a player can actually get the ball to.
 * Forces a case onto generated Planet Hopper stages, then asks: from the tee or from anywhere the
 * normal line passes (where the solver's ball stops), is there one deliberate shot that rolls the
 * ball through the case? Reports where each case came from (a gem's spot or off the line).
 *
 * Usage: npx tsx scripts/validate-case-spots.ts [runs=3] [firstSeed=1] [--compare]
 */
import {
  CASE_PICKUP_RADIUS,
  EDGE_SPOTS,
  HopperMatch,
  PHYSICS,
  SKELETON,
  Simulation,
  TUCKED_SPOTS,
  hashString,
  initPhysics,
  offLineSpot,
  rng,
  solveHole,
  stageHole,
  type CaseSpotStyle,
  type Hole,
  type Vec3,
} from '../shared/src/index';
import { caseItem } from '../shared/src/courses/builder';

await initPhysics();
const runs = Number(process.argv[2] ?? 3);
const firstSeed = Number(process.argv[3] ?? 1);

/**
 * Does this shot roll the ball through the case? With `radius`, measures the pickup itself at that
 * radius (to compare against v1.11's first cut, which picked cases up like any item, at 0.5 m).
 */
function hits(hole: Hole, from: Vec3, angle: number, power: number, radius?: number): boolean {
  const sim = new Simulation(hole);
  sim.addBall('b', from);
  sim.shoot('b', Math.cos(angle), Math.sin(angle), power);
  const cs = hole.collectibles.find((c) => c.kind === 'case');
  let hit = false;
  let hazard = false;
  for (let t = 0; t < 1500 && !hit && !hazard; t++) {
    sim.step();
    for (const e of sim.events.splice(0)) {
      if (e.type === 'water' || e.type === 'oob') hazard = true;
      if (radius === undefined && e.type === 'collect' && e.item.includes(':case:')) hit = true;
    }
    const b = sim.getBall('b')!;
    if (radius !== undefined && cs) {
      const d = Math.hypot(b.pos[0] - cs.pos[0], b.pos[1] - cs.pos[1], b.pos[2] - cs.pos[2]);
      if (d < radius) hit = true;
    }
    if (b.phase === 'holed' || (b.phase === 'rest' && t > 2)) break;
  }
  sim.dispose();
  return hit;
}

/**
 * --compare: how hard off-line spots are. On the same holes, places a case with the first-cut
 * style (EDGE_SPOTS) and the shipped one (TUCKED_SPOTS), fires the full fan of shots from the tee
 * and every point of the solver's line, and reports the share that reach the case (lower = harder)
 * and whether any does.
 */
if (process.argv.includes('--compare')) {
  const styles = { edge: EDGE_SPOTS, tucked: TUCKED_SPOTS } as const;
  // First cut: picked up like any item (0.5 m). Shipped: CASE_PICKUP_RADIUS.
  const radius = { edge: 0.5, tucked: CASE_PICKUP_RADIUS } as const;
  const acc = { edge: { n: 0, reached: 0, share: 0 }, tucked: { n: 0, reached: 0, share: 0 } };
  for (let seed = firstSeed; seed < firstSeed + runs; seed++) {
    const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
    for (let i = 0; i < SKELETON.length; i++) {
      if (SKELETON[i].kind === 'rest') continue;
      const plain = stageHole(seed, i, m.makeSpec(i, null, null, 0), 0);
      const starts: Vec3[] = [[plain.tee[0], plain.tee[1] + PHYSICS.ballRadius + 0.01, plain.tee[2]]];
      for (const s of solveHole(plain).shots) starts.push(s.pos);
      const row: string[] = [];
      for (const [name, style] of Object.entries(styles) as [keyof typeof styles, CaseSpotStyle][]) {
        const spot = offLineSpot(
          plain as unknown as Parameters<typeof offLineSpot>[0],
          plain.collectibles,
          rng(hashString(`hop-case:${seed}:${i}`)),
          style,
        );
        if (!spot) {
          row.push(`${name}: no spot`);
          continue;
        }
        const hole: Hole = {
          ...plain,
          collectibles: [caseItem(plain.id, 'meadow', spot[0], spot[1], spot[2])],
        };
        let hit = 0,
          tries = 0;
        for (const from of starts)
          for (let a = 0; a < 48; a++)
            for (const pw of [0.15, 0.25, 0.35, 0.48, 0.62, 0.78, 1]) {
              tries++;
              if (hits(hole, from, (a / 48) * Math.PI * 2, pw, radius[name])) hit++;
            }
        acc[name].n++;
        acc[name].share += hit / tries;
        if (hit) acc[name].reached++;
        row.push(`${name}: ${((hit / tries) * 100).toFixed(1)}% of shots${hit ? '' : ' (NOT REACHED)'}`);
      }
      console.log(`seed ${seed} stage ${String(i).padStart(2)} ${plain.name.padEnd(24)} ${row.join('   ')}`);
    }
  }
  for (const [name, a] of Object.entries(acc))
    console.log(
      `${name.padEnd(7)} ${a.n} spots, reachable ${a.reached}/${a.n}, mean share of shots that reach it ${((a.share / Math.max(1, a.n)) * 100).toFixed(2)}%`,
    );
  process.exit(0);
}

let total = 0,
  reached = 0,
  none = 0;
const bySource: Record<string, [number, number]> = { gem: [0, 0], offline: [0, 0] };
const misses: string[] = [];
for (let seed = firstSeed; seed < firstSeed + runs; seed++) {
  const m = new HopperMatch({ seed, players: [{ id: 'p', name: 'P' }], upgrades: {}, keepsakes: [] });
  for (let i = 0; i < SKELETON.length; i++) {
    if (SKELETON[i].kind === 'rest') continue;
    const spec = m.makeSpec(i, null, null, 0);
    const hole = stageHole(seed, i, spec, 1);
    const plain = stageHole(seed, i, spec, 0);
    const cs = hole.collectibles.find((c) => c.kind === 'case');
    const label = `seed ${seed} stage ${String(i).padStart(2)} ${spec.world.padEnd(9)} ${hole.name.padEnd(24)}`;
    if (!cs) {
      none++;
      console.log(`${label} no spot`);
      continue;
    }
    // A case that took a gem's place leaves one gem fewer than the plain hole.
    const src =
      plain.collectibles.filter((c) => c.kind === 'gem').length >
      hole.collectibles.filter((c) => c.kind === 'gem').length
        ? 'gem'
        : 'offline';
    total++;
    bySource[src][0]++;
    const starts: Vec3[] = [[hole.tee[0], hole.tee[1] + PHYSICS.ballRadius + 0.01, hole.tee[2]]];
    for (const s of solveHole(hole).shots) starts.push(s.pos);
    let ok = false;
    let tries = 0;
    outer: for (const from of starts)
      for (let a = 0; a < 48; a++)
        for (const pw of [0.15, 0.25, 0.35, 0.48, 0.62, 0.78, 1]) {
          tries++;
          if (hits(hole, from, (a / 48) * Math.PI * 2, pw)) {
            ok = true;
            break outer;
          }
        }
    if (ok) {
      reached++;
      bySource[src][1]++;
    } else misses.push(`${label} (${src})`);
    console.log(
      `${label} ${src.padEnd(7)} ${ok ? 'reachable' : 'NOT REACHED'} (${tries} shots tried from ${starts.length} spots on the line)`,
    );
  }
}
console.log(
  `\n${total} cases placed, ${none} stages without a spot. Reachable with one shot from the line: ${reached}/${total}` +
    `  (gem spots ${bySource.gem[1]}/${bySource.gem[0]}, off-line spots ${bySource.offline[1]}/${bySource.offline[0]})`,
);
if (misses.length) console.log(`Not reached:\n  ${misses.join('\n  ')}`);
