/**
 * Proves every hole is completable: runs the greedy solver on each hole and reports strokes vs par.
 * Usage: npm run validate:courses [-- courseId [holeNumber]]
 */
import { COURSES, initPhysics, solveHole } from '../shared/src/index';

await initPhysics();
const [courseFilter, holeFilter] = process.argv.slice(2);
let failures = 0;
for (const course of COURSES) {
  if (courseFilter && course.id !== courseFilter) continue;
  console.log(`\n${course.name}`);
  for (const [i, hole] of course.holes.entries()) {
    if (holeFilter && Number(holeFilter) !== i + 1) continue;
    const t0 = performance.now();
    const r = solveHole(hole);
    const ms = Math.round(performance.now() - t0);
    const mark = !r.holed ? '❌' : r.strokes <= hole.par ? '✅' : r.strokes <= hole.par + 2 ? '🟡' : '🟠';
    if (!r.holed) failures++;
    const path = r.shots
      .map((s) => `${(s.power * 100).toFixed(0)}%@${((s.angle * 180) / Math.PI).toFixed(0)}°`)
      .join(' ');
    console.log(
      `  ${mark} ${String(i + 1).padStart(2)} ${hole.name.padEnd(22)} par ${hole.par}  solver ${r.holed ? r.strokes : 'DNF'}  (${ms} ms)  ${path}`,
    );
  }
}
if (failures) {
  console.error(`\n${failures} hole(s) could not be completed by the solver`);
  process.exit(1);
}
