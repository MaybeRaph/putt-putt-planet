import type { Profile } from './profile';
import type { RunSummary } from './progression';

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  xp: number;
  coins: number;
  /** Evaluated after the run's stats were applied to the profile. */
  check: (p: Profile, run: RunSummary | null) => boolean;
}

const holesPlayed = (r: RunSummary | null) => r?.holes ?? [];

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'first_putt',
    name: 'First Steps',
    desc: 'Finish your first hole.',
    icon: '⛳',
    xp: 20,
    coins: 10,
    check: (p) => p.stats.holes >= 1,
  },
  {
    id: 'hole_in_one',
    name: 'Hole-in-One',
    desc: 'Sink a ball in a single stroke.',
    icon: '🎯',
    xp: 100,
    coins: 50,
    check: (p) => p.stats.holesInOne >= 1,
  },
  {
    id: 'ace_collector',
    name: 'Ace Collector',
    desc: 'Score 10 holes-in-one.',
    icon: '🃏',
    xp: 300,
    coins: 150,
    check: (p) => p.stats.holesInOne >= 10,
  },
  {
    id: 'bank_shot',
    name: 'Bank Shot',
    desc: 'Sink a ball after bouncing off a wall on the same stroke.',
    icon: '🎱',
    xp: 60,
    coins: 30,
    check: (p) => p.stats.bankShots >= 1,
  },
  {
    id: 'trick_shot',
    name: 'Trick Shot',
    desc: 'Sink a ball after 3+ bounces on the same stroke.',
    icon: '🪄',
    xp: 120,
    coins: 60,
    check: (_p, r) => holesPlayed(r).some((h) => !h.pickedUp && h.bankContacts >= 3),
  },
  {
    id: 'collector',
    name: 'Collector',
    desc: 'Find 10 gems.',
    icon: '💎',
    xp: 150,
    coins: 80,
    check: (p) => p.stats.gemsFound >= 10,
  },
  {
    id: 'golden_touch',
    name: 'Golden Touch',
    desc: 'Find a golden ball.',
    icon: '🏆',
    xp: 120,
    coins: 60,
    check: (p) => p.stats.goldenFound >= 1,
  },
  {
    id: 'no_water',
    name: 'Dry Feet',
    desc: 'Finish a course without any water or out-of-bounds penalty.',
    icon: '🦆',
    xp: 100,
    coins: 40,
    check: (_p, r) => !!r?.completed && holesPlayed(r).every((h) => h.penalties === 0),
  },
  {
    id: 'under_par_course',
    name: 'Under Par',
    desc: 'Finish a 9-hole course under par.',
    icon: '📉',
    xp: 150,
    coins: 60,
    check: (_p, r) => !!r?.completed && r.holes.length >= 9 && r.individualStrokes < r.individualPar,
  },
  {
    id: 'perfect_course',
    name: 'Perfection',
    desc: 'Earn all 3 stars on a course.',
    icon: '👑',
    xp: 200,
    coins: 100,
    check: (p) => Object.values(p.stars).some((s) => s.every(Boolean)),
  },
  {
    id: 'comeback',
    name: 'Comeback',
    desc: 'Finish a course at or under par after being +3 or worse.',
    icon: '🔄',
    xp: 150,
    coins: 60,
    check: (_p, r) => {
      if (!r?.completed) return false;
      let run = 0,
        worst = 0;
      for (const h of r.holes) {
        run += h.strokes - h.par;
        worst = Math.max(worst, run);
      }
      return worst >= 3 && run <= 0;
    },
  },
  {
    id: 'birdie_streak',
    name: 'Birdie Streak',
    desc: 'Go under par on 3 holes in a row.',
    icon: '🐦',
    xp: 120,
    coins: 50,
    check: (_p, r) => {
      let s = 0;
      for (const h of holesPlayed(r)) {
        s = h.strokes < h.par ? s + 1 : 0;
        if (s >= 3) return true;
      }
      return false;
    },
  },
  {
    id: 'eagle_eye',
    name: 'Eagle Eye',
    desc: 'Score 2 or more under par on a hole.',
    icon: '🦅',
    xp: 100,
    coins: 40,
    check: (_p, r) => holesPlayed(r).some((h) => !h.pickedUp && h.strokes <= h.par - 2),
  },
  {
    id: 'team_player',
    name: 'Team Player',
    desc: 'Complete a co-op course.',
    icon: '🤝',
    xp: 100,
    coins: 40,
    check: (p) => p.stats.coopCourses >= 1,
  },
  {
    id: 'relay_master',
    name: 'Relay Master',
    desc: 'Beat team par in Co-op Relay.',
    icon: '🏃',
    xp: 150,
    coins: 60,
    check: (_p, r) => !!r?.completed && r.mode === 'relay' && r.teamStrokes <= r.teamPar,
  },
  {
    id: 'piggy_bank',
    name: 'Piggy Bank',
    desc: 'Pick up 250 coins on the courses.',
    icon: '🐷',
    xp: 120,
    coins: 100,
    check: (p) => p.stats.coinsFound >= 250,
  },
  {
    id: 'unboxing',
    name: 'Unboxing',
    desc: 'Open 5 mystery crates.',
    icon: '🎁',
    xp: 100,
    coins: 40,
    check: (p) => p.stats.cratesOpened >= 5,
  },
  {
    id: 'daily_grind',
    name: 'Daily Grind',
    desc: 'Complete a daily challenge.',
    icon: '📅',
    xp: 60,
    coins: 30,
    check: (p) => p.stats.dailyPlayed >= 1,
  },
  {
    id: 'world_traveler',
    name: 'World Traveler',
    desc: 'Complete a course in 4 different worlds.',
    icon: '🌍',
    xp: 250,
    coins: 120,
    check: (p) => Object.values(p.stars).filter((s) => s[0]).length >= 4,
  },
  {
    id: 'frozen_master',
    name: 'Ice Cold',
    desc: 'Finish Frozen Lagoon at or under par.',
    icon: '🧊',
    xp: 200,
    coins: 80,
    check: (p) => !!p.stars.frozen?.[1],
  },
  {
    id: 'speed_demon',
    name: 'Speed Demon',
    desc: 'Finish a 9-hole course in under 4 minutes.',
    icon: '⚡',
    xp: 150,
    coins: 60,
    check: (_p, r) => !!r?.completed && r.holes.length >= 9 && r.playtimeSec < 240,
  },
  {
    id: 'marathon',
    name: 'Marathon',
    desc: 'Play 100 holes.',
    icon: '🏅',
    xp: 250,
    coins: 100,
    check: (p) => p.stats.holes >= 100,
  },
  {
    id: 'seasoned',
    name: 'Seasoned',
    desc: 'Reach level 10.',
    icon: '🎖',
    xp: 0,
    coins: 200,
    check: (p) => p.level >= 10,
  },
  {
    id: 'fashionista',
    name: 'Fashionista',
    desc: 'Own 25 cosmetics.',
    icon: '🕶',
    xp: 150,
    coins: 0,
    check: (p) => p.owned.length >= 25,
  },
  {
    id: 'chaos_agent',
    name: 'Chaos Agent',
    desc: 'Finish a course with Chaos Mode on.',
    icon: '💥',
    xp: 100,
    coins: 40,
    check: (_p, r) => !!r?.completed && !!r.chaos,
  },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
