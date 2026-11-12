import { mergeProfiles, ProfileSchema, type Profile } from '../profile';

export interface DailyEntry {
  id: string;
  name: string;
  strokes: number;
}

export interface ProfileStoreLike {
  get(id: string): Profile | null;
  /** Merge an incoming copy into the stored one (monotonic, see mergeProfiles). */
  merge(incoming: Profile): Profile;
  put(p: Profile): void;
  flush(): void;
}

export interface DailyBoardLike {
  submit(date: string, entry: DailyEntry): void;
  top(date: string, n?: number): DailyEntry[];
  flush(): void;
}

export interface HostStorage {
  profiles: ProfileStoreLike;
  board: DailyBoardLike;
}

/** In-memory storage for a player hosting a direct game (nothing persists on the host). */
export class MemoryProfileStore implements ProfileStoreLike {
  private readonly map = new Map<string, Profile>();
  get(id: string): Profile | null {
    return this.map.get(id) ?? null;
  }
  merge(incoming: Profile): Profile {
    const parsed = ProfileSchema.parse(incoming);
    const existing = this.map.get(parsed.id);
    const merged = existing ? mergeProfiles(existing, parsed) : parsed;
    this.map.set(merged.id, merged);
    return merged;
  }
  put(p: Profile): void {
    this.map.set(p.id, p);
  }
  flush(): void {}
}

export class MemoryDailyBoard implements DailyBoardLike {
  private readonly days = new Map<string, DailyEntry[]>();
  submit(date: string, entry: DailyEntry): void {
    const list = this.days.get(date) ?? [];
    const mine = list.find((e) => e.id === entry.id);
    if (!mine) list.push(entry);
    else if (entry.strokes < mine.strokes) Object.assign(mine, entry);
    list.sort((a, b) => a.strokes - b.strokes);
    this.days.set(date, list);
  }
  top(date: string, n = 20): DailyEntry[] {
    return (this.days.get(date) ?? []).slice(0, n);
  }
  flush(): void {}
}

export const memoryStorage = (): HostStorage => ({ profiles: new MemoryProfileStore(), board: new MemoryDailyBoard() });
