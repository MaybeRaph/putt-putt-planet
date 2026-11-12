import fs from 'node:fs';
import path from 'node:path';
import { ProfileSchema, mergeProfiles, type DailyBoardLike, type DailyEntry, type Profile, type ProfileStoreLike } from '@ppp/shared';

/**
 * Tiny JSON-file persistence with debounced, atomic writes (write temp + rename).
 * Interface is deliberately narrow so it can be swapped for SQLite/Postgres later.
 */
class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null;
  constructor(
    private readonly file: string,
    public data: T,
  ) {
    try {
      if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch (err) {
      console.warn(`[store] could not read ${file}, starting fresh`, err);
    }
  }

  save(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 500);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

export class ProfileStore implements ProfileStoreLike {
  private readonly db: JsonFile<Record<string, unknown>>;

  constructor(dir: string) {
    this.db = new JsonFile(path.join(dir, 'profiles.json'), {});
  }

  get(id: string): Profile | null {
    const raw = this.db.data[id];
    if (!raw) return null;
    const p = ProfileSchema.safeParse(raw);
    return p.success ? p.data : null;
  }

  /** Merge an incoming copy into the stored one (monotonic, see mergeProfiles). */
  merge(incoming: Profile): Profile {
    const existing = this.get(incoming.id);
    const merged = existing ? mergeProfiles(existing, incoming) : incoming;
    this.put(merged);
    return merged;
  }

  put(p: Profile): void {
    this.db.data[p.id] = p;
    this.db.save();
  }

  flush(): void {
    this.db.flush();
  }
}

/** Best strokes per player per day. Old days are pruned after a week. */
export class DailyBoard implements DailyBoardLike {
  private readonly db: JsonFile<Record<string, DailyEntry[]>>;

  constructor(dir: string) {
    this.db = new JsonFile(path.join(dir, 'daily.json'), {});
  }

  submit(date: string, entry: DailyEntry): void {
    const list = (this.db.data[date] ??= []);
    const mine = list.find((e) => e.id === entry.id);
    if (!mine) list.push(entry);
    else if (entry.strokes < mine.strokes) Object.assign(mine, entry);
    else mine.name = entry.name;
    list.sort((a, b) => a.strokes - b.strokes);
    const keys = Object.keys(this.db.data).sort();
    while (keys.length > 7) delete this.db.data[keys.shift()!];
    this.db.save();
  }

  top(date: string, n = 20): DailyEntry[] {
    return (this.db.data[date] ?? []).slice(0, n);
  }

  flush(): void {
    this.db.flush();
  }
}
