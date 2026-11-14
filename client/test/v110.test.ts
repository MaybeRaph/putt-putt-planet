import { describe, expect, it } from 'vitest';
import { COURSES } from '@ppp/shared';
import { NODE_R, islandOutline, mapLayout, smoothPath, type MapMode, type Pt } from '../src/ui/WorldMap';

/** Distance from a point to an axis-aligned rectangle (0 inside). */
function rectDist(p: Pt, x: number, y: number, w: number, h: number): number {
  const dx = Math.max(x - p.x, 0, p.x - (x + w));
  const dy = Math.max(y - p.y, 0, p.y - (y + h));
  return Math.hypot(dx, dy);
}

describe('v1.10 Play Solo world map layout', () => {
  const counts = COURSES.map((c) => c.holes.length);

  for (const mode of ['wide', 'tall'] as MapMode[]) {
    describe(mode, () => {
      const L = mapLayout(mode, counts);

      it('has one island per world and one stepping stone per hole', () => {
        expect(L.islands).toHaveLength(COURSES.length);
        L.islands.forEach((isl, i) => expect(isl.nodes).toHaveLength(COURSES[i].holes.length));
      });

      it('keeps every stone on its island and inside the map', () => {
        for (const isl of L.islands)
          for (const n of isl.nodes) {
            const e = Math.hypot((n.x - isl.cx) / isl.rx, (n.y - isl.cy) / isl.ry);
            expect(e).toBeLessThan(0.92);
            expect(n.x).toBeGreaterThan(NODE_R);
            expect(n.x).toBeLessThan(L.w - NODE_R);
            expect(n.y).toBeGreaterThan(NODE_R);
            expect(n.y).toBeLessThan(L.h - NODE_R);
          }
      });

      it('spaces stones evenly with room to tap each one', () => {
        for (const isl of L.islands) {
          const gaps = isl.nodes
            .slice(1)
            .map((n, j) => Math.hypot(n.x - isl.nodes[j].x, n.y - isl.nodes[j].y));
          const min = Math.min(...gaps),
            max = Math.max(...gaps);
          expect(min).toBeGreaterThan(NODE_R * 2 + 12);
          // Equal along the path; straight-line gaps are a little shorter across the tight bends.
          expect(max / min).toBeLessThan(1.6);
          // Non-neighbouring stones on the winding path never touch either.
          isl.nodes.forEach((a, j) =>
            isl.nodes.forEach((b, k) => {
              if (k > j) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(NODE_R * 2 + 4);
            }),
          );
        }
      });

      it('keeps the world badge, name sign and stars clear of the path', () => {
        L.islands.forEach((isl, i) => {
          const { x: bx, y: by } = isl.badge;
          const nameW = Math.max(116, COURSES[i].name.length * 11 + 32);
          for (const n of isl.nodes) {
            expect(Math.hypot(n.x - bx, n.y - by)).toBeGreaterThan(NODE_R + 34);
            // Sign (shifted inwards at the map edge in the real drawing, so test the worst case).
            expect(rectDist(n, bx - nameW / 2, by + 36, nameW, 30)).toBeGreaterThan(NODE_R - 2);
            expect(rectDist(n, bx - 40, by + 66, 80, 24)).toBeGreaterThan(NODE_R - 2);
          }
        });
      });

      it('lays islands out in play order without overlapping', () => {
        for (let i = 1; i < L.islands.length; i++) {
          const a = L.islands[i - 1],
            b = L.islands[i];
          if (mode === 'wide') expect(b.cx).toBeGreaterThan(a.cx);
          else expect(b.cy).toBeGreaterThan(a.cy);
          // Each path leaves its island on the side facing the next one.
          const exit = a.nodes.at(-1)!,
            entry = b.nodes[0];
          const d = (p: Pt, c: { cx: number; cy: number }) => Math.hypot(p.x - c.cx, p.y - c.cy);
          expect(d(exit, b)).toBeLessThan(d(a.nodes[0], b));
          expect(d(entry, a)).toBeLessThan(d(b.nodes.at(-1)!, a));
        }
      });
    });
  }

  it('draws faceted islands and smooth trails', () => {
    const o = islandOutline(1, 150, 118);
    expect(o).toHaveLength(17);
    for (const p of o) expect(Math.hypot(p.x / 150, p.y / 118)).toBeGreaterThan(0.8);
    const d = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 0 },
    ]);
    expect(d.startsWith('M0.0 0.0')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
  });
});
