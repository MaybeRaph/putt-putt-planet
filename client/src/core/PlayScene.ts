import * as THREE from 'three';
import {
  DEFAULT_LOADOUT,
  PHYSICS,
  REST_CRATES,
  REWARDS,
  SKELETON,
  type MatchEvent,
  type RewardId,
  type Vec3,
} from '@ppp/shared';
import type { Game } from './Game';
import type { Session } from './Session';
import { CourseView } from '../rendering/CourseView';
import { TIERS } from '../rendering/Renderer';
import { goldenTheme } from '../rendering/lighting';
import { BallView } from '../rendering/BallView';
import { CameraRig } from '../rendering/CameraRig';
import { AimView } from '../rendering/AimView';
import { HoleIntro, introBlockers, introPlan } from '../rendering/HoleIntro';
import { Particles } from '../rendering/Particles';
import { Controls, type HostAction } from '../input/Controls';
import { Hud } from '../ui/Hud';
import { pingReadout } from '../ui/ping';
import { h, scoreName } from '../ui/dom';
import { audio } from '../audio/Audio';

const v3 = (a: Vec3) => new THREE.Vector3(a[0], a[1], a[2]);

/**
 * The Playing state. Renders whatever the Session says (local or remote), turns input into
 * shots, and turns match events into feedback (sound, particles, camera, HUD).
 */
export class PlayScene {
  private view: CourseView | null = null;
  private readonly balls = new Map<string, BallView>();
  private readonly rig: CameraRig;
  /** After a splash or out of bounds: where the camera holds before following the ball again. */
  private hazardHold: { pos: THREE.Vector3; until: number } | null = null;
  private readonly aim = new AimView();
  private readonly particles = new Particles();
  private readonly controls: Controls;
  readonly hud: Hud;
  private loadedHole = -1;
  private slowmo = 0;
  private overviewOn = false;
  private readonly unsub: (() => void)[] = [];
  private debugEl: HTMLElement | null = null;
  private debugColliders = false;
  private teleportMode = false;
  private fpsAcc = { frames: 0, t: 0, fps: 0 };
  private emoteTimers = new Map<string, { emote: string; until: number }>();
  private lastCanShoot = false;
  private readonly fallbackFocus = new THREE.Vector3();
  private holeEndShown = false;
  private finished = false;
  /** Hole intro flyover in progress (camera only; the match runs on regardless). */
  private intro: HoleIntro | null = null;
  private introCardTimer = 0;
  /** Hole whose intro has been started (so it plays once per hole). */
  private introHole = -1;

  constructor(
    private readonly game: Game,
    readonly session: Session,
  ) {
    const r = game.renderer;
    this.rig = new CameraRig(r.camera);
    this.rig.reducedMotion = game.settings.reducedMotion;
    this.particles.scale = game.settings.quality === 'low' ? 0.5 : 1;
    r.scene.add(this.aim.root, this.particles.points);
    this.aim.palette = game.settings.palette;

    this.hud = new Hud(
      game.ui.hudLayer,
      session.course,
      {
        onOverview: () => this.onAction('overview'),
        onRescue: () => this.session.reposition(),
        onPause: () => this.onAction('pause'),
        onNext: () => this.session.advance(),
        onEmote: (e) => this.session.sendEmote(e),
        onChat: (t) => this.session.sendChat(t),
        onVote: (i) => this.session.hopperVote(i),
        onReroll: () => this.session.hopperReroll(),
      },
      session.kind === 'remote',
    );
    this.hud.palette = game.settings.palette;

    this.controls = new Controls(r.gl.domElement, r.camera, this.rig, game.settings, {
      canAim: () => this.session.canShoot() && !this.game.paused && !this.intro,
      ballPos: () => this.myBallView()?.pos ?? null,
      onShoot: (angle, power) => this.shoot(angle, power),
      onAction: (a) => this.onAction(a),
      onAimStart: () => this.hud.hideTip(),
    });

    this.unsub.push(
      session.bus.on('match', (ev) => this.onMatchEvent(ev)),
      session.bus.on('courseEnd', ({ score }) => {
        if (this.finished) return;
        this.finished = true;
        this.game.finishCourse(this.session, score);
      }),
      session.bus.on('chat', (c) => this.hud.chat(c.name, c.text)),
      session.bus.on('emote', (e) => {
        this.emoteTimers.set(e.from, { emote: e.emote, until: performance.now() + 2500 });
        audio.emote();
      }),
      session.bus.on('players', () => this.refreshScore()),
      session.bus.on('disconnected', ({ reason }) => this.hud.message(reason, 'bad', 4000)),
    );
    this.renderer.gl.domElement.addEventListener('pointerdown', this.onDebugClick);
    window.addEventListener('keydown', this.onIntroKey, true);
    window.addEventListener('pointerdown', this.onIntroTap, true);
    this.loadHole();
  }

  private get renderer() {
    return this.game.renderer;
  }

  private myBallView(): BallView | undefined {
    return this.balls.get(this.session.myEntrant());
  }

  // ------------------------------------------------------------------------------------------
  // Hole lifecycle
  // ------------------------------------------------------------------------------------------

  private loadHole(): void {
    const idx = this.session.holeIndex;
    if (idx < 0 || idx === this.loadedHole) return;
    this.loadedHole = idx;
    this.holeEndShown = false;
    this.view?.dispose();
    for (const b of this.balls.values()) b.dispose();
    this.balls.clear();
    this.particles.clear();

    const course = this.session.course;
    const hole = course.holes[idx];
    // Rendered at golden hour (the course files keep their daytime colours).
    const theme = goldenTheme(hole.theme ?? course.theme);
    const tier = TIERS[this.renderer.quality];
    this.view = new CourseView(hole, theme, {
      decorDensity: tier.decor,
      grass: tier.grass,
      ownedItems: this.game.profile.ownedCollectibles(),
    });
    this.view.syncItems(this.session.activeItems());
    this.renderer.scene.add(this.view.root);
    this.renderer.applyTheme(theme);
    this.renderer.fitShadow(this.view.bounds.min, this.view.bounds.max);
    this.rig.bounds = this.view.bounds;
    if (this.debugColliders) this.view.toggleColliderDebug(true);

    const tee = v3(hole.tee);
    this.rig.frame(tee, v3(hole.path[1] ?? hole.cup));
    this.controls.aimAngle = this.rig.yaw;
    this.overviewOn = false;
    this.rig.overview = false;
    this.hud.setHole(idx, this.session.score());
    this.hud.hideSummary();
    this.refreshScore();
    const layers = this.session.players().filter((p) => p.connected).length;
    audio.playTheme(theme, Math.max(1, layers));
    for (let i = 0; i < 3; i++) this.hud.removeLabel(`crate:${i}`);
    this.startIntro();
  }

  // ------------------------------------------------------------------------------------------
  // Hole intro
  // ------------------------------------------------------------------------------------------

  /**
   * Flyover + name card at the start of a hole. Purely local presentation: every player gets it
   * when their client loads the hole, and skipping it changes nothing for anyone else.
   */
  private startIntro(force = false): void {
    this.endIntro();
    const idx = this.loadedHole;
    const course = this.session.course;
    const hole = course.holes[idx];
    const score = this.session.score();
    // Only for a fresh hole: someone rejoining mid-hole goes straight to their ball.
    // (Online, the hole-start event arrives before the new scores, so that event forces it.)
    const fresh =
      force ||
      (score.phase === 'playing' &&
        this.session.obstacleTime() < 3 &&
        Object.values(score.strokesThisHole).every((n) => !n));
    if (!hole) return;
    const plan = introPlan({
      courseId: course.id,
      holeIndex: idx,
      fresh,
      reducedMotion: this.game.settings.reducedMotion,
      disabled: new URLSearchParams(location.search).has('nointro'),
    });
    if (plan === 'none') return;
    this.introHole = idx;
    const kicker =
      course.id === 'hopper'
        ? 'Planet Hopper'
        : this.session.mode === 'daily'
          ? 'Daily Challenge'
          : `Hole ${idx + 1} of ${course.holes.length}`;
    // Reduced motion: no camera move, just the card for a moment (it never blocks play).
    const fly = plan === 'fly';
    this.hud.showIntro(kicker, hole.name, hole.par, fly);
    if (fly) this.intro = new HoleIntro(hole.path, introBlockers(hole));
    else this.introCardTimer = window.setTimeout(() => this.hud.hideIntro(), 2200);
  }

  private endIntro(): void {
    clearTimeout(this.introCardTimer);
    this.intro = null;
    this.hud.hideIntro();
  }

  private readonly onIntroKey = (e: KeyboardEvent): void => {
    if (!this.intro || this.game.paused || this.game.ui.overlayOpen) return;
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || /^F\d+$/.test(e.key)) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    // The key only skips: it must not also charge a shot, pause or open chat.
    e.stopPropagation();
    e.preventDefault();
    this.intro.skip();
  };

  private readonly onIntroTap = (): void => {
    if (!this.intro || this.game.paused || this.game.ui.overlayOpen) return;
    this.intro.skip();
  };

  private ensureBallView(id: string): BallView {
    let b = this.balls.get(id);
    if (b) return b;
    const players = this.session.players();
    const owner =
      id === 'team' ? (players.find((p) => p.isHost) ?? players[0]) : players.find((p) => p.id === id);
    const mine = id === this.session.myEntrant();
    const ghost = !mine && this.session.mode !== 'relay';
    b = new BallView(id, owner?.loadout ?? DEFAULT_LOADOUT, ghost);
    this.balls.set(id, b);
    this.renderer.scene.add(b.root, b.trailMesh);
    return b;
  }

  private refreshScore(): void {
    this.hud.updateScore(this.session.score(), this.session.myEntrant(), this.session.players());
  }

  // ------------------------------------------------------------------------------------------
  // Input
  // ------------------------------------------------------------------------------------------

  private shoot(angle: number, power: number): void {
    const dx = Math.cos(angle),
      dz = Math.sin(angle);
    this.session.shoot(dx, dz, power);
    // Instant local feedback (hides network latency for remote sessions).
    audio.putt(power);
    const me = this.myBallView();
    me?.swing();
    me?.impact(0.3 + power * 0.4);
    if (power > 0.8) this.rig.shake(0.08 * power);
    if (me)
      this.particles.burst(me.pos.clone().setY(me.pos.y - PHYSICS.ballRadius), {
        count: 10,
        colors: ['#d7ccc8', '#ffffff'],
        speed: 1.2,
        spread: 0.3,
        life: 0.5,
        size: 0.08,
      });
    this.controls.cancelAim();
  }

  private onAction(a: HostAction): void {
    switch (a) {
      case 'overview':
        this.overviewOn = !this.overviewOn;
        this.rig.overview = this.overviewOn;
        break;
      case 'rescue':
        this.session.reposition();
        break;
      case 'pause':
        this.game.togglePause();
        break;
      case 'emote':
        this.hud.toggleWheel();
        break;
      case 'chat':
        this.hud.toggleChat();
        break;
      case 'scoreboard':
        this.hud.showFullBoard(true, this.session.score(), this.session.players());
        break;
      case 'scoreboardUp':
        this.hud.showFullBoard(false);
        break;
      case 'debug':
        this.toggleDebug();
        break;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Events -> feedback
  // ------------------------------------------------------------------------------------------

  private nameOf(entrantOrPlayer: string): string {
    if (entrantOrPlayer === 'team') return 'Team';
    return this.session.players().find((p) => p.id === entrantOrPlayer)?.name ?? 'Someone';
  }

  private onMatchEvent(ev: MatchEvent): void {
    const mine = 'entrant' in ev && ev.entrant === this.session.myEntrant();
    const bv = 'entrant' in ev ? this.balls.get(ev.entrant) : undefined;
    const rm = this.game.settings.reducedMotion;
    switch (ev.type) {
      case 'holeStart':
        this.loadHole();
        if (this.introHole !== this.loadedHole) this.startIntro(true);
        break;
      case 'shot':
        if (!mine) audio.putt(ev.power * 0.6); // own shots already played instantly on input
        if (!mine) bv?.swing();
        break;
      case 'wall':
        audio.wall(ev.speed);
        bv?.impact(Math.min(1, ev.speed / 9));
        if (ev.speed > 7) this.rig.shake(0.04);
        if (bv)
          this.particles.burst(bv.pos, {
            count: Math.min(10, Math.round(ev.speed)),
            colors: ['#ffffff', '#fff3c4'],
            speed: 1.5,
            spread: 1,
            life: 0.35,
            size: 0.06,
            gravity: -2,
          });
        break;
      case 'land':
        audio.land(ev.speed);
        bv?.impact(Math.min(1, ev.speed / 6));
        if (bv)
          this.particles.burst(bv.pos.clone().setY(bv.pos.y - PHYSICS.ballRadius), {
            count: 8,
            colors: ['#d7ccc8'],
            speed: 1,
            spread: 0.2,
            life: 0.5,
            size: 0.08,
          });
        break;
      case 'bumper':
        audio.bumper();
        this.view?.pulseBumper(ev.obstacle);
        bv?.impact(1);
        this.rig.shake(0.1);
        if (bv)
          this.particles.burst(bv.pos, {
            count: 16,
            colors: ['#ff4f8b', '#fff176'],
            speed: 3,
            spread: 1,
            life: 0.4,
            size: 0.08,
          });
        break;
      case 'boost':
        audio.boost();
        if (bv) this.view?.pulseSpring(bv.pos);
        if (bv)
          this.particles.burst(bv.pos, {
            count: 14,
            colors: ['#ff9f1c', '#ffe066'],
            speed: 2,
            spread: 0.5,
            life: 0.5,
            size: 0.09,
          });
        break;
      case 'teleport':
        audio.teleport();
        if (bv)
          this.particles.burst(bv.pos, {
            count: 24,
            colors: ['#7c4dff', '#00e5ff', '#ffffff'],
            speed: 2.5,
            spread: 1,
            life: 0.6,
            size: 0.1,
            gravity: 0,
          });
        break;
      case 'water':
      case 'oob': {
        if (ev.type === 'water') audio.splash();
        else audio.poof();
        if (bv)
          this.particles.burst(bv.pos, {
            count: 26,
            colors: ev.type === 'water' ? ['#4fc3f7', '#ffffff', '#81d4fa'] : ['#bdbdbd', '#ffffff'],
            speed: 3,
            spread: 0.4,
            up: 2,
            life: 0.7,
            size: 0.1,
          });
        if (mine) this.hud.message(ev.type === 'water' ? 'Splash! +1' : 'Out of bounds! +1', 'bad');
        // The camera lingers on the splash for a beat, then glides back to the ball's reset spot
        // (it used to whip straight across the course), and the ball pops back in.
        if (mine && bv) this.hazardHold = { pos: bv.pos.clone(), until: performance.now() + 650 };
        if (bv) bv.respawn();
        else
          this.hud.feed(
            `${this.nameOf(ev.entrant)} ${ev.type === 'water' ? 'went for a swim' : 'flew out of bounds'} (+1)`,
          );
        break;
      }
      case 'lipout':
        audio.lipOut();
        if (mine) this.hud.message('Lip out!', 'bad', 1000);
        break;
      case 'sunk':
        audio.cup();
        if (bv)
          this.particles.burst(v3(this.session.course.holes[this.session.holeIndex].cup).setY(bv.pos.y), {
            count: 12,
            colors: ['#ffffff', '#c8e6c9'],
            speed: 1.5,
            spread: 0.3,
            life: 0.5,
            size: 0.08,
          });
        break;
      case 'note':
        this.hud.message(ev.text, ev.tone, 2600);
        this.hud.feed(ev.text);
        if (ev.tone === 'epic') audio.fanfare(false);
        break;
      case 'hopper':
        break;
      case 'entrantDone': {
        if (this.isRestStop()) break;
        const ace = ev.strokes === 1;
        if (bv && !rm) bv.celebrate();
        const cup = v3(this.session.course.holes[this.session.holeIndex].cup);
        if (ace) this.holeInOneFx(cup, bv?.loadout.hio ?? 'hio.confetti');
        else if (ev.strokes <= ev.par)
          this.particles.burst(cup.clone().setY(cup.y + 0.3), {
            count: 40,
            colors: ['#ffeb3b', '#ff4081', '#40c4ff', '#69f0ae'],
            speed: 3.5,
            spread: 0.35,
            up: 2,
            life: 1.2,
            size: 0.1,
            gravity: -5,
          });
        if (mine || this.session.mode === 'relay') {
          const name = scoreName(ev.strokes, ev.par);
          this.hud.message(name, ace ? 'epic' : ev.strokes <= ev.par ? 'good' : 'info', 2200);
          if (ace) audio.fanfare(true);
          else if (ev.strokes < ev.par) audio.fanfare(false);
          else if (ev.strokes - ev.par >= 3) audio.sad();
        } else {
          this.hud.feed(`${this.nameOf(ev.entrant)}: ${scoreName(ev.strokes, ev.par)}`);
        }
        break;
      }
      case 'strokeLimit':
        if (mine) this.hud.message('Stroke limit — ball picked up', 'bad', 2000);
        break;
      case 'rescueOffered':
        if (mine) this.hud.showTip('Stuck? Press R (or ⛑ Rescue) for a free reposition.');
        break;
      case 'collect':
        break;
      case 'collected': {
        const pos = this.view?.collect(ev.item);
        audio.pickup(ev.kind);
        this.hud.collect(ev.kind);
        if (pos) {
          const colors =
            ev.kind === 'coin'
              ? ['#ffd23f', '#fff59d']
              : ev.kind === 'gem'
                ? ['#2ee6d6', '#b2fff8', '#ffffff']
                : ev.kind === 'golden'
                  ? ['#ffc400', '#ffffff', '#fff59d']
                  : ['#8e5cf7', '#ffd23f'];
          this.particles.burst(pos, {
            count: ev.kind === 'coin' ? 10 : 30,
            colors,
            speed: ev.kind === 'coin' ? 1.8 : 3,
            spread: 1,
            life: 0.6,
            size: 0.08,
            gravity: -3,
          });
        }
        if (ev.kind !== 'coin') {
          const label = { gem: 'Gem found! 💎', golden: 'GOLDEN BALL! 🏆', crate: 'Mystery crate! 🎁' }[
            ev.kind
          ];
          this.hud.message(label, 'epic', 1800);
          if (ev.kind === 'golden') this.rig.shake(0.12);
        }
        break;
      }
      case 'turn': {
        const myTurn = ev.player === this.session.localPlayerId;
        this.hud.turn(myTurn ? 'Your turn!' : `${this.nameOf(ev.player)}'s turn`, myTurn);
        if (myTurn) audio.turn();
        break;
      }
      case 'holeComplete':
        this.holeEndShown = true;
        this.hud.hideTurn();
        this.hud.holeSummary(
          this.session.score(),
          this.session.myEntrant(),
          this.session.players(),
          this.canAdvance(),
        );
        break;
      case 'courseComplete':
        break;
      default:
        break;
    }
    if (ev.type !== 'wall' && ev.type !== 'land') this.refreshScore();
  }

  /** A Planet Hopper rest stop (the run's skeleton is fixed and hole i is stage i). */
  private isRestStop(index = this.loadedHole): boolean {
    return this.session.course.id === 'hopper' && SKELETON[index]?.kind === 'rest';
  }

  /** Rest stop crate labels and the wind gauge (Planet Hopper). */
  private updateHopperWorld(): void {
    const hs = this.session.score().hopper;
    const hopper = this.hud.hopper;
    if (!hs || !hopper) return;
    const spec = hs.stages[hs.stage];
    const hole = this.session.course.holes[this.loadedHole];
    const items = this.session.activeItems();
    if (spec?.kind === 'rest' && spec.crates && hole)
      spec.crates.forEach((rw: RewardId, i) => {
        const alive = hole.collectibles.some(
          (c) => c.kind === 'crate' && items.has(c.id) && c.id.endsWith(`:rest${i}:${rw}`),
        );
        const p = REST_CRATES[i];
        this.hud.label(
          `crate:${i}`,
          `${REWARDS[rw].icon} ${REWARDS[rw].name}`,
          alive && !hs.choice ? new THREE.Vector3(p[0], 1.1, p[2]) : null,
          this.renderer.camera,
          'name-label crate-label',
        );
      });
    const w = hole?.wind ?? [0, 0];
    const m = Math.hypot(w[0], w[1]);
    if (m > 0.01) {
      // Project the wind direction onto the screen: compare it with the camera's facing.
      const cam = this.renderer.camera;
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      const camYaw = Math.atan2(fwd.z, fwd.x);
      const windYaw = Math.atan2(w[1], w[0]);
      hopper.setWind(windYaw - camYaw - Math.PI / 2, m);
    } else hopper.setWind(null);
  }

  private canAdvance(): boolean {
    if (this.session.kind === 'local') return true;
    return !!this.session.players().find((p) => p.id === this.session.localPlayerId)?.isHost;
  }

  private holeInOneFx(at: THREE.Vector3, fx: string): void {
    this.rig.shake(0.2);
    const p = this.particles;
    const up = at.clone().setY(at.y + 0.3);
    switch (fx) {
      case 'hio.fireworks':
        for (let i = 0; i < 5; i++)
          setTimeout(() => {
            const c = ['#ff5252', '#ffeb3b', '#40c4ff', '#69f0ae', '#e040fb'][i];
            p.burst(
              up
                .clone()
                .add(
                  new THREE.Vector3(
                    (Math.random() - 0.5) * 3,
                    2.5 + Math.random() * 1.5,
                    (Math.random() - 0.5) * 3,
                  ),
                ),
              { count: 60, colors: [c, '#ffffff'], speed: 4, spread: 1, life: 1.2, size: 0.1, gravity: -2 },
            );
          }, i * 220);
        break;
      case 'hio.hearts':
        p.burst(up, {
          count: 70,
          colors: ['#ff4081', '#ff80ab', '#f50057'],
          speed: 3,
          spread: 0.4,
          up: 3,
          life: 1.6,
          size: 0.16,
          gravity: -1,
        });
        break;
      case 'hio.stars':
        p.burst(up, {
          count: 90,
          colors: ['#ffd740', '#ffffff', '#fff59d'],
          speed: 6,
          spread: 1,
          life: 1.0,
          size: 0.1,
          gravity: 0,
          drag: 3,
        });
        break;
      case 'hio.bubbles':
        p.burst(up, {
          count: 60,
          colors: ['#80d8ff', '#e1f5fe', '#b3e5fc'],
          speed: 1.5,
          spread: 0.5,
          up: 1,
          life: 2.5,
          size: 0.2,
          gravity: 1.2,
        });
        break;
      default:
        p.burst(up, {
          count: 140,
          colors: ['#ff5252', '#ffeb3b', '#40c4ff', '#69f0ae', '#e040fb', '#ffffff'],
          speed: 5,
          spread: 0.35,
          up: 3,
          life: 1.8,
          size: 0.11,
          gravity: -4,
        });
    }
  }

  // ------------------------------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.controls.enabled = !this.game.paused;
    this.controls.update(dt);
    // Solo games freeze while paused; online games keep running for everyone else.
    if (!(this.game.paused && this.session.kind === 'local')) this.session.update(dt);
    if (this.session.holeIndex !== this.loadedHole) this.loadHole();
    const view = this.view;
    if (!view) return;

    const rm = this.game.settings.reducedMotion;
    const balls = this.session.renderBalls();
    const myId = this.session.myEntrant();
    const positions: THREE.Vector3[] = [];
    const seen = new Set<string>();
    for (const b of balls) {
      seen.add(b.id);
      const bv = this.ensureBallView(b.id);
      const pos = v3(b.pos);
      bv.update(pos, v3(b.vel), dt, b.phase === 'holed', rm);
      if (b.phase !== 'holed') positions.push(pos);
      // labels for other players' balls
      if (b.id !== myId && b.id !== 'team')
        this.hud.label(
          `n:${b.id}`,
          this.nameOf(b.id),
          b.phase === 'holed' ? null : pos.clone().setY(pos.y + 0.45),
          this.renderer.camera,
        );
    }
    for (const [id, bv] of this.balls)
      if (!seen.has(id)) {
        bv.dispose();
        this.balls.delete(id);
        this.hud.removeLabel(`n:${id}`);
      }
    // Emote bubbles above the emoting player's ball
    const now = performance.now();
    for (const [pid, e] of this.emoteTimers) {
      const entrant = this.session.mode === 'relay' ? 'team' : pid;
      const bv = this.balls.get(entrant);
      if (now > e.until || !bv) {
        this.hud.label(`e:${pid}`, '', null, this.renderer.camera);
        if (now > e.until) this.emoteTimers.delete(pid);
        continue;
      }
      this.hud.label(
        `e:${pid}`,
        e.emote,
        bv.pos.clone().setY(bv.pos.y + 0.75),
        this.renderer.camera,
        'emote-bubble',
      );
    }

    const t = this.session.obstacleTime();
    view.update(t, dt, positions);
    this.particles.update(dt);
    this.view?.syncItems(this.session.activeItems());

    // Camera follows my ball, or the first unfinished ball when I'm done (spectate).
    const me = balls.find((b) => b.id === myId);
    let focus: THREE.Vector3;
    if (this.hazardHold && performance.now() < this.hazardHold.until) focus = this.hazardHold.pos;
    else if (me && me.phase !== 'holed') focus = v3(me.pos);
    else {
      const other = balls.find((b) => b.phase !== 'holed');
      focus = other
        ? v3(other.pos)
        : this.fallbackFocus.copy(v3(this.session.course.holes[this.loadedHole].cup));
    }
    this.rig.update(dt, focus);
    if (this.intro) {
      // The rig has just placed the gameplay camera; the intro blends the flyover into it.
      // Paused: the flyover waits where it is.
      this.intro.update(
        this.game.paused ? 0 : dt,
        this.rig.camera,
        this.rig.camera.position.clone(),
        this.rig.lookPoint,
      );
      if (this.intro.done) this.endIntro();
    }
    // Anything between the camera and the ball fades so you can always see your shot (during
    // the flyover: whatever hides the spot being shown).
    view.updateOcclusion(
      this.rig.camera.position,
      this.intro && this.intro.blend < 0.5 ? this.intro.look : focus,
      dt,
    );

    // Slow-mo on a final putt approaching the cup (local only).
    if (this.session.kind === 'local' && !rm && me && me.phase === 'moving') {
      const cup = this.session.course.holes[this.loadedHole].cup;
      const d = Math.hypot(me.pos[0] - cup[0], me.pos[2] - cup[2]);
      const sp = Math.hypot(me.vel[0], me.vel[2]);
      const toward = (cup[0] - me.pos[0]) * me.vel[0] + (cup[2] - me.pos[2]) * me.vel[2] > 0;
      if (d < 1.1 && d > 0.25 && sp < PHYSICS.sinkSpeed * 1.1 && sp > 0.6 && toward) this.slowmo = 0.5;
    }
    this.slowmo = Math.max(0, this.slowmo - dt);
    this.session.timeScale = this.slowmo > 0 ? 0.4 : 1;

    // Aim visuals
    const canShoot = this.session.canShoot() && !this.game.paused;
    const myView = this.myBallView();
    if (canShoot && myView) {
      this.aim.show(
        myView.pos,
        this.controls.aimAngle,
        this.controls.aiming ? this.controls.power : 0,
        view.colliders,
      );
      myView.showPutter(true, this.controls.aimAngle, this.controls.aiming ? this.controls.power : 0);
    } else {
      this.aim.hide();
      myView?.showPutter(false);
    }
    this.hud.setMeter(this.controls.aiming && canShoot, this.controls.power);
    if (canShoot && !this.lastCanShoot && this.session.mode !== 'relay') this.refreshScore();
    this.lastCanShoot = canShoot;

    this.updateHopperWorld();
    this.updateDebug(dt, balls);
  }

  // ------------------------------------------------------------------------------------------
  // Debug overlay (` key): FPS, physics/net stats, colliders, teleport, reload
  // ------------------------------------------------------------------------------------------

  private toggleDebug(): void {
    if (this.debugEl) {
      this.debugEl.remove();
      this.debugEl = null;
      this.teleportMode = false;
      return;
    }
    const stats = h('pre', { class: 'dbg-stats' });
    this.debugEl = h(
      'div',
      { class: 'debug panel' },
      h('div', { class: 'dbg-title' }, 'Debug'),
      stats,
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          checked: this.debugColliders,
          onchange: (e: Event) => {
            this.debugColliders = (e.target as HTMLInputElement).checked;
            this.view?.toggleColliderDebug(this.debugColliders);
          },
        }),
        ' Show colliders',
      ),
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          onchange: (e: Event) => (this.teleportMode = (e.target as HTMLInputElement).checked),
        }),
        ' Click to teleport ball',
      ),
      h('button', { class: 'btn small', onclick: () => this.reloadHole() }, 'Reload hole'),
    );
    this.game.ui.hudLayer.append(this.debugEl);
  }

  private reloadHole(): void {
    this.loadedHole = -1;
    this.loadHole();
  }

  private readonly onDebugClick = (e: PointerEvent): void => {
    if (!this.teleportMode || !this.view) return;
    const r = this.renderer.gl.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      this.renderer.camera,
    );
    const hit = ray
      .intersectObject(this.view.root, true)
      .find(
        (x) =>
          x.face &&
          x.face.normal.clone().transformDirection(x.object.matrixWorld).y > 0.6 &&
          !(x.object instanceof THREE.InstancedMesh),
      );
    if (hit) {
      this.session.debugTeleport([hit.point.x, hit.point.y + PHYSICS.ballRadius + 0.02, hit.point.z]);
      e.stopPropagation();
    }
  };

  private updateDebug(dt: number, balls: ReturnType<Session['renderBalls']>): void {
    this.fpsAcc.frames++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t >= 0.5) {
      this.fpsAcc.fps = Math.round(this.fpsAcc.frames / this.fpsAcc.t);
      this.fpsAcc.frames = 0;
      this.fpsAcc.t = 0;
      this.game.ui.setFps(this.game.settings.showFps ? this.fpsAcc.fps : null);
      const net = this.game.net;
      this.game.ui.setPing(
        pingReadout(this.game.settings.showPing, this.session.kind === 'remote', net.status, net.rtt),
      );
      // The Tab board shows everyone's ping: keep it live while it is open.
      if (this.hud.fullBoardOpen) this.hud.showFullBoard(true, this.session.score(), this.session.players());
    }
    if (!this.debugEl) return;
    const me = balls.find((b) => b.id === this.session.myEntrant());
    const info = this.renderer.gl.info;
    const lines = [
      `fps ${this.fpsAcc.fps}  draw calls ${info.render.calls}  tris ${info.render.triangles}`,
      `geometries ${info.memory.geometries}  textures ${info.memory.textures}`,
      me
        ? `ball ${me.pos.map((v) => v.toFixed(2)).join(', ')}  |v| ${Math.hypot(...me.vel).toFixed(2)}  ${me.phase}`
        : 'ball -',
      `obstacle t ${this.session.obstacleTime().toFixed(2)}s  timeScale ${this.session.timeScale}`,
      ...Object.entries(this.session.netStats()).map(([k, v]) => `${k}: ${v}`),
    ];
    (this.debugEl.querySelector('.dbg-stats') as HTMLElement).textContent = lines.join('\n');
  }

  /** Graphics quality changed: swap the scenery for the new tier now, not on the next hole. */
  refreshGraphics(): void {
    const tier = TIERS[this.renderer.quality];
    this.view?.rebuildScenery(tier.decor, tier.grass);
    this.particles.scale = this.renderer.quality === 'low' ? 0.5 : 1;
  }

  dispose(): void {
    this.unsub.forEach((u) => u());
    this.renderer.gl.domElement.removeEventListener('pointerdown', this.onDebugClick);
    window.removeEventListener('keydown', this.onIntroKey, true);
    window.removeEventListener('pointerdown', this.onIntroTap, true);
    clearTimeout(this.introCardTimer);
    this.controls.dispose();
    this.view?.dispose();
    for (const b of this.balls.values()) b.dispose();
    this.balls.clear();
    this.aim.root.removeFromParent();
    this.particles.points.removeFromParent();
    this.particles.points.geometry.dispose();
    (this.particles.points.material as THREE.Material).dispose();
    this.hud.dispose();
    // The FPS / ping readouts belong to the game screen.
    this.game.ui.setFps(null);
    this.game.ui.setPing(null);
    this.debugEl?.remove();
    this.session.dispose();
  }
}
