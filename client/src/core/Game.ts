import {
  COURSES,
  HopperMatch,
  buildRunSummary,
  hopperCourse,
  OMEN_IDS,
  SKELETON,
  stageHole,
  type OmenId,
  syncHopperHoles,
  dailyCourse,
  getCourse,
  initPhysics,
  type Course,
  type GameMode,
  type Grant,
  type RoomState,
  type S2CMsg,
  type ScoreState,
} from '@ppp/shared';
import { NetClient } from '../net/NetClient';
import { LocalHost } from '../net/LocalHost';
import { answerInvite } from '../net/p2p';
import { RemoteSession } from '../net/RemoteSession';
import type { SessionPlayer } from './Session';
import { Renderer } from '../rendering/Renderer';
import { MenuBackdrop } from '../rendering/MenuBackdrop';
import { UIRoot } from '../ui/UIRoot';
import { ProfileStore } from '../progression/ProfileStore';
import { loadSettings, saveSettings, type Settings } from './settings';
import { PlayScene } from './PlayScene';
import { LocalSession } from '../physics/LocalSession';
import type { Session } from './Session';
import { audio } from '../audio/Audio';
import { Screens } from '../ui/screens';

export type StateName = 'boot' | 'menu' | 'lobby' | 'loading' | 'playing' | 'results';

/**
 * Top-level state machine: Boot → Menu → (Lobby) → Loading → Playing → Results → Menu/Lobby.
 * Owns the long-lived systems (renderer, audio, settings, profile, network).
 */
export class Game {
  readonly renderer: Renderer;
  readonly ui: UIRoot;
  readonly settings: Settings;
  readonly profile = new ProfileStore();
  readonly screens: Screens;
  state: StateName = 'boot';
  scene: PlayScene | null = null;
  private backdrop: MenuBackdrop | null = null;
  paused = false;
  private last = performance.now();
  private frames = 0;
  private runStart = 0;
  readonly net: NetClient;
  room: RoomState | null = null;
  dailyBoard: Extract<S2CMsg, { t: 'dailyBoard' }> | null = null;
  serverDev = false;
  private lastResults: {
    course: Course;
    score: ScoreState;
    players: SessionPlayer[];
    online: boolean;
    daily: boolean;
  } | null = null;
  private profileSyncTimer = 0;

  constructor(container: HTMLElement) {
    this.settings = loadSettings();
    this.renderer = new Renderer(container);
    this.renderer.setQuality(this.settings.quality);
    this.ui = new UIRoot(container);
    this.screens = new Screens(this);
    this.net = new NetClient(() => this.profile.profile);
    this.net.bus.on('msg', (m) => this.onNet(m));
    this.net.bus.on('status', (st) => {
      if (st !== 'offline' || !this.room) return;
      if (this.net.kind === 'peer') {
        // A direct link can't be re-dialled: the host left or the network dropped.
        this.ui.toast('Lost connection to the host', 'bad', 4000);
        this.endDirect();
        this.room = null;
        this.goMenu();
      } else if (this.state === 'lobby') this.ui.toast('Connection lost — reconnecting…', 'bad');
    });
    // Keep the server copy of the profile in sync (debounced) while connected.
    this.profile.bus.on('changed', () => {
      if (this.net.status !== 'online') return;
      clearTimeout(this.profileSyncTimer);
      this.profileSyncTimer = window.setTimeout(() => {
        this.net.send({ t: 'profile', profile: this.profile.profile });
        if (this.room) this.net.send({ t: 'loadout', loadout: this.profile.loadout() });
      }, 400);
    });
    audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
    // Browsers need a gesture before audio can start.
    const unlock = () => {
      audio.unlock();
      audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
      if (this.state === 'menu') audio.playTheme(COURSES[0].theme, 1);
    };
    window.addEventListener('pointerdown', unlock, { once: false });
    window.addEventListener('keydown', unlock, { once: false });
  }

  async start(): Promise<void> {
    this.ui.setLoading('Warming up the greens…');
    document.getElementById('boot')?.remove();
    console.info(`[boot] quality ${this.settings.quality}`);
    await initPhysics();
    console.info('[boot] physics ready');
    this.ui.setLoading(null);
    requestAnimationFrame(this.frame);
    // Dev shortcut: ?course=meadow&hole=5 jumps straight into a hole.
    const q = new URLSearchParams(location.search);
    const dev = q.get('course') ? COURSES.find((c) => c.id === q.get('course')) : undefined;
    // Dev shortcut: ?hopStage=12&seed=31&omen=fog previews one generated Planet Hopper stage.
    const hopStage = q.get('hopStage');
    if (dev) this.startLocal(dev, 'solo', Number(q.get('hole') ?? 1) - 1);
    else if (hopStage !== null) {
      const m = new HopperMatch({ seed: Number(q.get('seed') ?? 1), players: [{ id: 'dev', name: 'Dev' }], upgrades: {}, keepsakes: [] });
      const i = Math.max(0, Math.min(SKELETON.length - 1, Number(hopStage)));
      const omen = (OMEN_IDS as readonly string[]).includes(q.get('omen') ?? '') ? (q.get('omen') as OmenId) : null;
      const hole = stageHole(m.seed, i, m.makeSpec(i, omen, null, Number(q.get('variant') ?? 0)));
      this.startLocal({ ...hopperCourse(m.seed, [hole]), id: 'hopper-preview' }, 'solo');
    } else this.goMenu();
    // Invite links: ?join=ABC123
    const join = q.get('join');
    if (join) void this.joinRoom(join);
    else if (this.net.token) void this.connect().catch(() => undefined); // resume a dropped room
  }

  private readonly frame = (now: number): void => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'playing' && this.scene) this.scene.update(dt);
    else this.backdrop?.update(dt);
    this.renderer.render(dt);
    if (this.frames++ === 2) console.info(`[boot] rendering (${this.renderer.gl.info.render.calls} draw calls last pass)`);
    requestAnimationFrame(this.frame);
  };

  // ------------------------------------------------------------------------------------------
  // Transitions
  // ------------------------------------------------------------------------------------------

  private showBackdrop(): void {
    if (!this.backdrop) {
      this.backdrop = new MenuBackdrop(this.renderer);
      const c = COURSES[Math.floor(Math.random() * COURSES.length)];
      this.backdrop.show(c, Math.floor(Math.random() * c.holes.length));
    }
  }

  private hideBackdrop(): void {
    this.backdrop?.dispose();
    this.backdrop = null;
  }

  private endScene(): void {
    this.scene?.dispose();
    this.scene = null;
    this.ui.clearHud();
    this.paused = false;
    this.ui.showOverlay(null);
  }

  goMenu(screen: 'main' | 'courses' = 'main'): void {
    this.endScene();
    this.state = 'menu';
    this.showBackdrop();
    if (audio.ctx) audio.playTheme(COURSES[0].theme, 1);
    if (screen === 'courses') this.screens.courseSelect();
    else this.screens.mainMenu();
  }

  /** Start a solo / offline game on a course (or a custom set of holes, e.g. the daily). */
  startLocal(course: Course, mode: GameMode = 'solo', startHole = 0): void {
    this.state = 'loading';
    this.ui.showScreen(null);
    this.ui.setLoading(`Loading ${course.name}…`);
    // Let the loading overlay paint before building the scene.
    setTimeout(() => {
      this.hideBackdrop();
      const p = this.profile.profile;
      const session = new LocalSession(
        course,
        mode,
        p.id,
        p.name,
        this.profile.loadout(),
        course.holes,
        startHole,
      );
      this.beginPlaying(session);
      this.ui.setLoading(null);
    }, 30);
  }

  /** Start a solo Planet Hopper run (the Clubhouse's "Start run"). */
  startHopper(): void {
    this.state = 'loading';
    this.ui.showScreen(null);
    this.ui.setLoading('Charting a course across the planets…');
    setTimeout(() => {
      this.hideBackdrop();
      const p = this.profile.profile;
      const match = new HopperMatch({
        seed: Math.floor(Math.random() * 2 ** 31),
        players: [{ id: p.id, name: p.name }],
        upgrades: p.hopper.upgrades,
        keepsakes: [p.hopper.keepsake],
      });
      const course = hopperCourse(match.seed, match.cfg.holes);
      const session = new LocalSession(course, 'hopper', p.id, p.name, this.profile.loadout(), course.holes, 0, match);
      this.beginPlaying(session);
      this.ui.setLoading(null);
    }, 30);
  }

  beginPlaying(session: Session): void {
    this.pendingGrant = null;
    this.endScene();
    this.hideBackdrop();
    this.ui.showScreen(null);
    this.state = 'playing';
    this.runStart = performance.now();
    this.scene = new PlayScene(this, session);
  }

  /** Course finished. Local sessions apply rewards here; remote ones get them from the server. */
  finishCourse(session: Session, score: ScoreState): void {
    const playtime = (performance.now() - this.runStart) / 1000;
    let grant: Grant | null = null;
    if (session instanceof LocalSession && session.match instanceof HopperMatch) {
      grant = this.profile.applyHopperRun(session.match, playtime);
    } else if (session instanceof LocalSession) {
      const daily = session.mode === 'daily' ? session.course.id.replace('daily-', '') : undefined;
      const run = buildRunSummary(session.match, session.localPlayerId, session.course.id, playtime, daily);
      grant = this.profile.applyRun(run, daily ? null : session.course);
    }
    this.showResults(session, score, grant);
  }

  showResults(session: Session, score: ScoreState, grant: Grant | null): void {
    const players = session.players();
    const course = session.course;
    const online = session.kind === 'remote';
    this.endScene();
    this.state = 'results';
    this.showBackdrop();
    if (!grant && this.pendingGrant) {
      grant = this.pendingGrant;
      this.pendingGrant = null;
    }
    this.lastResults = {
      course,
      score,
      players,
      online: online && session.mode !== 'daily',
      daily: session.mode === 'daily',
    };
    this.screens.results(course, score, players, grant, this.lastResults.online, this.lastResults.daily);
  }

  togglePause(force?: boolean): void {
    if (this.state !== 'playing') return;
    this.paused = force ?? !this.paused;
    if (this.paused) this.screens.pause();
    else this.ui.showOverlay(null);
  }

  // ------------------------------------------------------------------------------------------
  // Online
  // ------------------------------------------------------------------------------------------

  /** Guest side: the invite we are currently answering (its link may still be connecting). */
  private directAttempt: { cancel: () => void } | null = null;
  /** Hosting a direct (serverless) game in this client, if any. */
  localHost: LocalHost | null = null;
  /** LAN server addresses when hosting on the local network (desktop app). */
  lanAddresses: string[] = [];
  /** Room we last asked to join, so a lost join can be repeated (see sayHelloAgain). */
  private joinCode: string | null = null;
  private lastRehello = 0;

  /**
   * The host answered "Say hello first": it never got our hello (and so not our joinRoom either),
   * and it will ignore everything else we send, Ready included, until it does. Say it again.
   */
  private sayHelloAgain(): void {
    const now = performance.now();
    if (now - this.lastRehello < 1500) return; // every ping draws the same error until it lands
    this.lastRehello = now;
    const code = this.room?.code ?? this.joinCode;
    console.warn(`[net] the host doesn't know us yet: saying hello again${code ? `, then joining ${code}` : ''}`);
    this.net.hello();
    if (code) this.net.send({ t: 'joinRoom', code });
  }

  /** Point the client back at the dedicated server and drop any direct-play state. */
  private endDirect(): void {
    this.directAttempt?.cancel();
    this.directAttempt = null;
    this.localHost?.shutdown();
    this.localHost = null;
    this.lanAddresses = [];
    void window.pppNative?.stopLanServer?.();
    if (!this.net.isDefaultServer) this.net.useTarget({ kind: 'server', url: NetClient.defaultServerUrl() });
  }

  private useDefaultServer(): void {
    if (this.localHost || !this.net.isDefaultServer) this.endDirect();
  }

  /** Host a direct game: the room runs inside this client; friends join with invite codes. */
  async hostDirect(): Promise<void> {
    this.endDirect();
    const host = new LocalHost();
    host.hostName = this.profile.profile.name;
    this.localHost = host;
    this.net.useTarget({ kind: 'loopback', open: host.openLoopback });
    await this.net.connect();
    this.net.send({ t: 'createRoom' });
  }

  /** Guest side of a direct game: returns the reply code, then joins once the host accepts it. */
  async joinDirect(inviteCode: string): Promise<{ reply: string; hostName: string; connected: Promise<void> }> {
    // Only one attempt at a time: a second invite pasted while the first link is still trying
    // would otherwise leave two links racing, and whichever opened last stole the connection.
    this.endDirect();
    const attempt = await answerInvite(inviteCode);
    this.directAttempt?.cancel();
    this.directAttempt = attempt;
    const { reply, invite, channel } = attempt;
    const connected = channel.then(async (dc) => {
      if (this.directAttempt !== attempt) return;
      console.info('[direct] link to the host is open, joining the room');
      this.net.useTarget({ kind: 'peer', channel: dc });
      await this.net.connect(8000);
      this.joinCode = invite.room ?? null;
      if (invite.room) this.net.send({ t: 'joinRoom', code: invite.room });
    });
    return { reply, hostName: invite.host ?? 'your friend', connected };
  }

  /** Join a game server at an address (LAN host or self-hosted server). */
  async joinAddress(address: string, code: string): Promise<void> {
    this.endDirect();
    this.net.useTarget({ kind: 'server', url: NetClient.addressUrl(address) });
    try {
      await this.connect();
      this.joinCode = code.trim().toUpperCase();
      this.net.send({ t: 'joinRoom', code: this.joinCode });
    } catch (e) {
      this.ui.toast(`${(e as Error).message}. Check the address and that you're on the same network.`, 'bad', 5000);
      this.endDirect();
    }
  }

  /** Desktop app only: run the game server for the local network and host a room on it. */
  async hostLan(): Promise<void> {
    const native = window.pppNative;
    if (!native?.startLanServer) return this.ui.toast('LAN hosting is available in the desktop app', 'bad');
    this.endDirect();
    this.ui.setLoading('Starting local network server…');
    try {
      const { port, addresses } = await native.startLanServer();
      this.lanAddresses = addresses.map((a) => (port === 8787 ? a : `${a}:${port}`));
      this.net.useTarget({ kind: 'server', url: `ws://127.0.0.1:${port}/ws` });
      await this.net.connect();
      this.net.send({ t: 'createRoom' });
    } catch (e) {
      this.ui.toast((e as Error).message, 'bad');
      this.endDirect();
    } finally {
      this.ui.setLoading(null);
    }
  }

  async connect(): Promise<void> {
    this.ui.setLoading(this.net.kind === 'server' && this.net.isDefaultServer ? 'Connecting to the server…' : 'Connecting…');
    try {
      await this.net.connect();
    } finally {
      this.ui.setLoading(null);
    }
  }

  async createRoom(): Promise<void> {
    this.useDefaultServer();
    try {
      await this.connect();
      this.net.send({ t: 'createRoom' });
    } catch (e) {
      this.ui.toast((e as Error).message, 'bad');
    }
  }

  async joinRoom(code: string): Promise<void> {
    this.useDefaultServer();
    try {
      await this.connect();
      this.joinCode = code.trim().toUpperCase();
      this.net.send({ t: 'joinRoom', code: this.joinCode });
    } catch (e) {
      this.ui.toast((e as Error).message, 'bad');
    }
  }

  private onNet(m: S2CMsg): void {
    switch (m.t) {
      case 'joined':
        if (this.localHost) this.localHost.roomCode = m.code;
        break;
      case 'welcome':
        this.serverDev = m.dev;
        this.profile.mergeFrom(m.profile);
        break;
      case 'profile':
        this.profile.mergeFrom(m.profile);
        break;
      case 'room': {
        const wasNull = !this.room;
        this.room = m.room;
        if (m.room.phase === 'lobby' && (this.state === 'lobby' || (wasNull && this.state === 'menu'))) {
          // Locker open from the lobby: keep it (the lobby redraws when the player goes back).
          if (this.state === 'lobby' && this.screens.inLobbySub) break;
          this.returnToLobby();
        }
        break;
      }
      case 'kicked': {
        // Removed by the host: back to the menu with a message that stays until dismissed.
        const direct = this.net.kind !== 'server' || !this.net.isDefaultServer;
        this.room = null;
        this.joinCode = null;
        this.screens.inLobbySub = false;
        if (this.net.kind === 'server') this.net.token = null;
        if (direct) {
          this.net.disconnect();
          this.endDirect();
        }
        this.goMenu();
        this.screens.notice('Removed from the game', m.message);
        break;
      }
      case 'left':
        this.room = null;
        this.joinCode = null;
        this.screens.inLobbySub = false;
        if (this.state === 'lobby') this.screens.multiplayer();
        break;
      case 'matchStart': {
        let course = m.daily ? dailyCourse(m.daily) : getCourse(m.courseId);
        if (m.hopper) {
          course = hopperCourse(m.hopper.seed);
          syncHopperHoles(course, m.hopper.seed, m.hopper.stages);
        }
        if (!course) return;
        if (this.scene?.session instanceof RemoteSession) return; // resume: the session realigns itself
        const session = new RemoteSession(this.net, course, m.mode, this.profile.profile.id, m, this.room);
        this.beginPlaying(session);
        break;
      }
      case 'rewards':
        this.profile.mergeFrom(m.profile);
        if (this.state === 'results' && this.lastResults) {
          const r = this.lastResults;
          this.screens.results(r.course, r.score, r.players, m.grant, r.online, r.daily);
        } else this.pendingGrant = m.grant;
        break;
      case 'dailyBoard':
        this.dailyBoard = m;
        this.screens.onDailyBoard();
        break;
      case 'error':
        if (m.code === 'no_hello') {
          this.sayHelloAgain();
          break;
        }
        if (this.state === 'playing' && this.scene) this.scene.hud.message(m.message, 'bad', 2500);
        else this.ui.toast(m.message, 'bad');
        break;
      default:
        break;
    }
  }

  private pendingGrant: Grant | null = null;

  /** Leave the online room and go back to the main menu. */
  leaveOnline(): void {
    this.net.send({ t: 'leaveRoom' });
    this.room = null;
    this.joinCode = null;
    if (this.net.kind === 'server') this.net.token = null;
    if (this.net.kind !== 'server' || !this.net.isDefaultServer) {
      this.net.disconnect();
      this.endDirect();
    }
    this.goMenu();
  }

  returnToLobby(): void {
    if (!this.room) {
      this.goMenu();
      return;
    }
    if (this.state !== 'lobby') {
      this.endScene();
      this.showBackdrop();
    }
    this.state = 'lobby';
    this.screens.lobby();
  }

  async startDaily(): Promise<void> {
    this.useDefaultServer();
    try {
      await this.connect();
      this.net.send({ t: 'dailyStart' });
    } catch {
      this.ui.toast('Server offline — playing the daily locally (no leaderboard)', 'info', 4000);
      this.startLocal(dailyCourse(), 'daily');
    }
  }

  applySettings(): void {
    saveSettings(this.settings);
    this.renderer.setQuality(this.settings.quality);
    audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
    if (this.scene) {
      this.scene.hud.palette = this.settings.palette;
    }
  }
}
