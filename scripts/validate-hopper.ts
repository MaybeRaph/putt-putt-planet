/**
 * Proves Planet Hopper's procedural holes are completable: generates full runs for several seeds
 * (with a mix of omens) and runs the greedy solver on every stage.
 * Usage: npx tsx scripts/validate-hopper.ts [seedCount=4]
 */
import { HopperMatch, OMEN_IDS, SKELETON, initPhysics, solveHole, stageHole } from '../shared/src/index';

await initPhysics();
const seeds = Number(process.argv[2] ?? 4);
let failures = 0;
let over = 0;
let n = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const m = new HopperMatch({
    seed: seed * 7919,
    players: [{ id: 'p', name: 'P' }],
    upgrades: {},
    keepsakes: [],
  });
  console.log(`\nSeed ${seed * 7919} — worlds ${m.worlds.join(' → ')}`);
  for (let i = 0; i < SKELETON.length; i++) {
    const omen = SKELETON[i].kind === 'hole' && i % 3 === 1 ? OMEN_IDS[(seed + i) % OMEN_IDS.length] : null;
    const spec = m.makeSpec(i, omen, null, i % 2);
    const hole = stageHole(m.seed, i, spec);
    const t0 = performance.now();
    const r = solveHole(hole, { maxStrokes: hole.par + 5 });
    const ms = Math.round(performance.now() - t0);
    n++;
    if (!r.holed) failures++;
    else if (r.strokes > hole.par + 2) over++;
    const mark = !r.holed ? '❌' : r.strokes <= hole.par ? '✅' : r.strokes <= hole.par + 2 ? '🟡' : '🟠';
    console.log(
      `  ${mark} ${String(i).padStart(2)} ${spec.kind.padEnd(4)} d${String(spec.depth).padStart(2)} ${hole.name.padEnd(24)} ${(spec.omen ?? '').padEnd(6)} par ${hole.par}  solver ${r.holed ? r.strokes : 'DNF'}  (${ms} ms)`,
    );
  }
}
console.log(`\n${n} holes, ${failures} unsolved, ${over} more than par+2`);
if (failures) process.exit(1);
