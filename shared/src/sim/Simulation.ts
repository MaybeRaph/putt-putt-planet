import RAPIER from '@dimforge/rapier3d-compat';
import { DT, PHYSICS, SURFACES, type SurfaceKind } from '../config';
import type { Collectible, Hole, Obstacle, Solid, Vec3, Zone } from '../schema';
import {
  clamp,
  dirVec,
  distXZ,
  domeCapPoints,
  inYawBox,
  quatFromEuler,
  rotateVec,
  solidRibbon,
} from '../math';
import { kinematicParts, obstaclePose, obstacleSolids } from './obstacles';

let ready: Promise<void> | null = null;
/** Must be awaited once before constructing a Simulation (loads the Rapier WASM). */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

export type BallPhase = 'rest' | 'moving' | 'sinking' | 'holed';

export interface BallState {
  id: string;
  pos: Vec3;
  vel: Vec3;
  phase: BallPhase;
  /** Last position where the ball came to rest (hazard resets go here). */
  lastRest: Vec3;
  surface: SurfaceKind;
  grounded: boolean;
}

export type SimEvent =
  | { type: 'shot'; ball: string; power: number }
  | { type: 'wall'; ball: string; speed: number }
  | { type: 'bumper'; ball: string; obstacle: string }
  | { type: 'land'; ball: string; speed: number }
  | { type: 'boost'; ball: string }
  | { type: 'teleport'; ball: string; obstacle: string }
  | { type: 'water'; ball: string }
  | { type: 'oob'; ball: string }
  | { type: 'lipout'; ball: string }
  | { type: 'sunk'; ball: string }
  | { type: 'holed'; ball: string }
  | { type: 'rest'; ball: string }
  | { type: 'stuck'; ball: string }
  | { type: 'collect'; ball: string; item: string };

const GROUP_WORLD = 0x0001;
const GROUP_BALL = 0x0002;
const GROUP_RAY = 0x0004;
const groups = (member: number, filter: number) => (member << 16) | filter;

interface ColliderInfo {
  role: 'floor' | 'wall' | 'block' | 'ball';
  surface: SurfaceKind;
  obstacle?: Obstacle;
}

interface BallInternal {
  state: BallState;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  preVel: Vec3;
  slowTime: number;
  moveTime: number;
  stuckAnchor: Vec3;
  stuckTimer: number;
  lipCooldown: number;
  teleCooldown: number;
  inBoost: boolean;
  /** Already launched by the spring pad it is on (cleared once it leaves the pad). */
  springFired: boolean;
  sinkT: number;
  sinkFrom: Vec3;
  /** Scripted ride through a loop-the-loop. */
  loop: { o: Extract<Obstacle, { type: 'loop' }>; phi: number; v: number } | null;
  loopCooldown: number;
}

export interface SimOptions {
  /** "Chaos mode": balls collide with each other. */
  ballsCollide?: boolean;
  /** Collectibles that exist in this run (ids). Defaults to all of the hole's collectibles. */
  activeCollectibles?: string[];
}

const PICKUP_RADIUS = 0.5;

export class Simulation {
  readonly hole: Hole;
  readonly world: RAPIER.World;
  tick = 0;
  readonly events: SimEvent[] = [];
  readonly activeItems: Map<string, Collectible>;
  readonly bounds: { min: Vec3; max: Vec3 };
  readonly killY: number;

  private readonly balls = new Map<string, BallInternal>();
  private readonly colliderInfo = new Map<number, ColliderInfo>();
  private readonly kinematic: { o: Obstacle; body: RAPIER.RigidBody }[] = [];
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly ballsCollide: boolean;

  constructor(hole: Hole, opts: SimOptions = {}) {
    this.hole = hole;
    this.ballsCollide = !!opts.ballsCollide;
    this.world = new RAPIER.World({ x: 0, y: PHYSICS.gravity, z: 0 });
    this.world.timestep = DT;
    this.eventQueue = new RAPIER.EventQueue(true);
    const active = new Set(opts.activeCollectibles ?? hole.collectibles.map((c) => c.id));
    this.activeItems = new Map(hole.collectibles.filter((c) => active.has(c.id)).map((c) => [c.id, c]));

    const allSolids: Solid[] = [...hole.solids];
    for (const o of hole.obstacles) {
      const solids = obstacleSolids(o);
      for (const s of solids) this.addStatic(s, o);
      allSolids.push(...solids);
    }
    for (const s of hole.solids) this.addStatic(s);
    for (const o of hole.obstacles) this.addKinematic(o);

    // Moving platforms and teleporter pads extend the playable area.
    for (const o of hole.obstacles) {
      if (o.type === 'mover')
        for (const c of [o.from, o.to])
          allSolids.push({
            shape: 'box',
            role: 'block',
            center: c,
            size: o.size,
            rot: [0, 0, 0],
            surface: 'grass',
          });
      if (o.type === 'teleporter')
        for (const c of [o.a, o.b])
          allSolids.push({
            shape: 'box',
            role: 'block',
            center: c,
            size: [1, 0.2, 1],
            rot: [0, 0, 0],
            surface: 'grass',
          });
    }
    this.bounds = computeBounds(allSolids);
    // Out of bounds just below the lowest green: a ball that drops off an edge resets quickly.
    const floorTops = hole.solids.filter((s) => s.role === 'floor').map((s) => computeBounds([s]).max[1]);
    this.killY = (floorTops.length ? Math.min(...floorTops) : this.bounds.min[1]) - 0.6;
  }

  // ------------------------------------------------------------------------------------------
  // Construction
  // ------------------------------------------------------------------------------------------

  private addStatic(s: Solid, obstacle?: Obstacle): void {
    const ribbon = s.shape === 'ribbon';
    const dome = s.shape === 'dome';
    const desc = ribbon
      ? ribbonColliderDesc(s)
      : dome
        ? domeColliderDesc(s)
        : solidColliderDesc(s.shape as 'box', s.size);
    const q = ribbon || dome ? [0, 0, 0, 1] : quatFromEuler(s.rot[0], s.rot[1], s.rot[2]);
    desc
      .setTranslation(...((ribbon || dome ? [0, 0, 0] : s.center) as [number, number, number]))
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
      .setFriction(0)
      .setRestitution(s.restitution ?? defaultRestitution(s.role, s.surface))
      .setCollisionGroups(groups(GROUP_WORLD, 0xffff));
    const c = this.world.createCollider(desc);
    this.colliderInfo.set(c.handle, { role: s.role, surface: s.surface, obstacle });
  }

  private addKinematic(o: Obstacle): void {
    const parts = kinematicParts(o);
    if (!parts) return;
    const pose = obstaclePose(o, 0);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(pose.p[0], pose.p[1], pose.p[2])
        .setRotation({ x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] }),
    );
    const role = o.type === 'mover' && o.role === 'floor' ? 'floor' : 'block';
    for (const part of parts) {
      const desc = solidColliderDesc(part.shape, part.size)
        .setTranslation(part.offset[0], part.offset[1], part.offset[2])
        .setRotation({ x: part.rot[0], y: part.rot[1], z: part.rot[2], w: part.rot[3] })
        .setFriction(0)
        .setRestitution(role === 'floor' ? PHYSICS.floorRestitution : 0.6)
        .setCollisionGroups(groups(GROUP_WORLD, 0xffff));
      const c = this.world.createCollider(desc, body);
      this.colliderInfo.set(c.handle, { role, surface: 'metal', obstacle: o });
    }
    this.kinematic.push({ o, body });
  }

  addBall(id: string, pos?: Vec3): BallState {
    const p = pos ?? this.teePosition(this.balls.size);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p[0], p[1], p[2])
        .lockRotations()
        .setCcdEnabled(true)
        .setCanSleep(false)
        .setGravityScale(0),
    );
    const filter = GROUP_WORLD | (this.ballsCollide ? GROUP_BALL : 0);
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(PHYSICS.ballRadius)
        .setMass(PHYSICS.ballMass)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setCollisionGroups(groups(GROUP_BALL, filter))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.colliderInfo.set(collider.handle, { role: 'ball', surface: 'grass' });
    const state: BallState = {
      id,
      pos: [...p],
      vel: [0, 0, 0],
      phase: 'rest',
      lastRest: [...p],
      surface: 'grass',
      grounded: true,
    };
    this.balls.set(id, {
      state,
      body,
      collider,
      preVel: [0, 0, 0],
      slowTime: 0,
      moveTime: 0,
      stuckAnchor: [...p],
      stuckTimer: 0,
      lipCooldown: 0,
      teleCooldown: 0,
      inBoost: false,
      springFired: false,
      sinkT: 0,
      sinkFrom: [...p],
      loop: null,
      loopCooldown: 0,
    });
    return state;
  }

  removeBall(id: string): void {
    const b = this.balls.get(id);
    if (!b) return;
    this.colliderInfo.delete(b.collider.handle);
    this.world.removeRigidBody(b.body);
    this.balls.delete(id);
  }

  /** Tee spot, with small lateral offsets when several balls share the tee in chaos mode. */
  teePosition(index: number): Vec3 {
    const t = this.hole.tee;
    const y = t[1] + PHYSICS.ballRadius + 0.01;
    if (!this.ballsCollide || index === 0) return [t[0], y, t[2]];
    // Chaos mode (balls collide): up to 6 balls in two rows of three that fit a 2-unit fairway.
    const a = this.hole.path[1] ?? this.hole.cup;
    const fwdAngle = Math.atan2(a[2] - t[2], a[0] - t[0]);
    const fwd = dirVec(fwdAngle);
    const side = dirVec(fwdAngle + Math.PI / 2);
    const lateral = [0, 0.38, -0.38][index % 3];
    const back = index >= 3 ? 0.42 : 0;
    return [t[0] + side[0] * lateral - fwd[0] * back, y, t[2] + side[2] * lateral - fwd[2] * back];
  }

  // ------------------------------------------------------------------------------------------
  // Queries / commands
  // ------------------------------------------------------------------------------------------

  getBall(id: string): BallState | undefined {
    return this.balls.get(id)?.state;
  }

  ballIds(): string[] {
    return [...this.balls.keys()];
  }

  get time(): number {
    return this.tick * DT;
  }

  anyMoving(): boolean {
    for (const b of this.balls.values())
      if (b.state.phase === 'moving' || b.state.phase === 'sinking') return true;
    return false;
  }

  /** Shot speed for a normalised power value (shared with the aim preview). */
  static shotSpeed(power: number): number {
    const p = clamp(power, 0, 1);
    return PHYSICS.maxShotSpeed * Math.pow(p, PHYSICS.powerCurve);
  }

  /** Strike the ball. Returns false if the shot is invalid (ball not at rest, etc.). */
  shoot(id: string, dirX: number, dirZ: number, power: number): boolean {
    const b = this.balls.get(id);
    if (!b || b.state.phase !== 'rest') return false;
    if (!Number.isFinite(dirX) || !Number.isFinite(dirZ) || !Number.isFinite(power)) return false;
    const l = Math.hypot(dirX, dirZ);
    if (l < 1e-6) return false;
    const p = clamp(power, 0, 1);
    if (p < PHYSICS.minPower) return false;
    const speed = Simulation.shotSpeed(p) * this.hole.powerScale;
    b.body.setLinvel({ x: (dirX / l) * speed, y: 0, z: (dirZ / l) * speed }, true);
    b.body.setGravityScale(this.hole.gravityScale, true);
    b.state.phase = 'moving';
    b.state.lastRest = [...b.state.pos];
    b.slowTime = 0;
    b.moveTime = 0;
    b.stuckTimer = 0;
    b.stuckAnchor = [...b.state.pos];
    this.events.push({ type: 'shot', ball: id, power: p });
    return true;
  }

  /** Jump the obstacle clock (teleports machinery; used by tools/tests, not gameplay). */
  setTick(tick: number): void {
    this.tick = tick;
    for (const k of this.kinematic) {
      const pose = obstaclePose(k.o, tick * DT);
      k.body.setTranslation({ x: pose.p[0], y: pose.p[1], z: pose.p[2] }, true);
      k.body.setRotation({ x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] }, true);
    }
  }

  /** Put a ball at a position, at rest (hazard reset, rescue, debug teleport). */
  placeBall(id: string, pos: Vec3): void {
    const b = this.balls.get(id);
    if (!b) return;
    b.body.setEnabled(true);
    b.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setGravityScale(0, true);
    b.state.pos = [...pos];
    b.state.vel = [0, 0, 0];
    b.state.phase = 'rest';
    b.state.lastRest = [...pos];
    b.slowTime = 0;
    b.inBoost = false;
    b.springFired = false;
  }

  /** Remove a ball from play (picked up after hitting the stroke limit). */
  pickUp(id: string): void {
    const b = this.balls.get(id);
    if (!b) return;
    b.state.phase = 'holed';
    b.body.setEnabled(false);
  }

  // ------------------------------------------------------------------------------------------
  // Stepping
  // ------------------------------------------------------------------------------------------

  step(): void {
    const tNext = (this.tick + 1) * DT;
    // 1. Drive kinematic machinery to its pose at the end of this step.
    for (const k of this.kinematic) {
      const pose = obstaclePose(k.o, tNext);
      k.body.setNextKinematicTranslation({ x: pose.p[0], y: pose.p[1], z: pose.p[2] });
      k.body.setNextKinematicRotation({ x: pose.q[0], y: pose.q[1], z: pose.q[2], w: pose.q[3] });
    }

    // 2. Custom forces (rolling resistance, surfaces, zones, cup).
    for (const b of this.balls.values()) this.preStep(b);

    // 3. Physics.
    this.world.step(this.eventQueue);

    // 4. Collision events.
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const i1 = this.colliderInfo.get(h1);
      const i2 = this.colliderInfo.get(h2);
      if (!i1 || !i2) return;
      const [ballInfoHandle, other] = i1.role === 'ball' ? [h1, i2] : [h2, i1];
      if (other.role === 'ball') return;
      const ball = this.findBallByCollider(ballInfoHandle);
      if (!ball || ball.state.phase !== 'moving') return;
      this.onContact(ball, other);
    });

    // 5. Post-step: hazards, cup, settle.
    for (const b of this.balls.values()) this.postStep(b);
    this.tick++;
  }

  private findBallByCollider(handle: number): BallInternal | undefined {
    for (const b of this.balls.values()) if (b.collider.handle === handle) return b;
    return undefined;
  }

  private groundProbe(b: BallInternal): { info: ColliderInfo; ny: number } | null {
    const t = b.body.translation();
    const ray = new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(
      ray,
      PHYSICS.ballRadius + 0.09,
      true,
      undefined,
      groups(GROUP_RAY, GROUP_WORLD),
    );
    if (!hit) return null;
    const info = this.colliderInfo.get(hit.collider.handle);
    if (!info || info.role === 'ball') return null;
    return { info, ny: hit.normal.y };
  }

  private zonesAt(p: Vec3): Zone[] {
    const out: Zone[] = [];
    for (const z of this.hole.zones) if (inYawBox(p, z.center, z.size, z.rotY)) out.push(z);
    return out;
  }

  private preStep(b: BallInternal): void {
    const s = b.state;
    if (s.phase === 'holed' || s.phase === 'sinking') return;
    if (b.loop) {
      this.rideLoop(b);
      return;
    }
    const t = b.body.translation();
    const pos: Vec3 = [t.x, t.y, t.z];
    const lv = b.body.linvel();
    let v: Vec3 = [lv.x, lv.y, lv.z];

    // Moving platforms carry the ball (both resting and rolling).
    const ground = this.groundProbe(b);
    if (ground?.info.obstacle?.type === 'mover' && ground.info.role === 'floor') {
      const o = ground.info.obstacle;
      const a = obstaclePose(o, this.tick * DT).p;
      const c = obstaclePose(o, (this.tick + 1) * DT).p;
      b.body.setTranslation({ x: t.x + c[0] - a[0], y: t.y + c[1] - a[1], z: t.z + c[2] - a[2] }, true);
    }

    if (s.phase === 'rest') {
      b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.preVel = [0, 0, 0];
      return;
    }

    const zones = this.zonesAt(pos);
    let surface: SurfaceKind = ground?.info.surface ?? 'grass';
    let gravity = this.hole.gravityScale;
    let boosted = false;
    let sprung = false;
    for (const z of zones) {
      if (z.kind === 'sand' || z.kind === 'ice' || z.kind === 'sticky') surface = z.kind;
      else if (z.kind === 'lowGravity') gravity = z.strength;
      else if (z.kind === 'conveyor' && ground) {
        const d = dirVec(z.dir);
        v = [v[0] + d[0] * z.strength * DT, v[1], v[2] + d[2] * z.strength * DT];
      } else if (z.kind === 'boost' && ground) {
        boosted = true;
        const d = dirVec(z.dir);
        const along = v[0] * d[0] + v[2] * d[2];
        if (along < z.strength) {
          const add = Math.min(z.strength - along, 60 * DT);
          v = [v[0] + d[0] * add, v[1], v[2] + d[2] * add];
        }
        if (!b.inBoost) this.events.push({ type: 'boost', ball: s.id });
      } else if (z.kind === 'spring') {
        sprung = true;
        // Launch pad: pops a rolling ball straight up (once per visit), keeping its pace. A ball
        // that hops onto the pad still gets launched as soon as it touches down on it.
        const padTop = z.center[1] - z.size[1] / 2 + 0.05;
        const low = pos[1] - padTop < PHYSICS.ballRadius + 0.14 && v[1] < 1.2;
        if (!b.springFired && (ground || low) && v[1] < z.strength) {
          v = [v[0], z.strength, v[2]];
          b.springFired = true;
          this.events.push({ type: 'boost', ball: s.id });
        }
      } else if (z.kind === 'oneWay') {
        const d = dirVec(z.dir);
        const along = v[0] * d[0] + v[2] * d[2];
        if (along < 0) {
          v = [v[0] - 1.6 * along * d[0], v[1], v[2] - 1.6 * along * d[2]];
          this.events.push({ type: 'wall', ball: s.id, speed: -along });
        }
      }
    }
    b.inBoost = boosted;
    if (!sprung) b.springFired = false;
    s.surface = surface;
    s.grounded = !!ground;
    b.body.setGravityScale(gravity, true);

    const sp = SURFACES[surface];
    const wind = this.hole.wind;
    // Only pushes balls that are really rolling, so a slow ball can still settle.
    if ((wind[0] || wind[1]) && Math.hypot(v[0], v[2]) > 0.6)
      v = [v[0] + wind[0] * DT, v[1], v[2] + wind[1] * DT];
    if (ground) {
      // Rolling resistance acts along the velocity, scaled by how flat the ground is.
      const speed = Math.hypot(v[0], v[1], v[2]);
      if (speed > 1e-5) {
        const dec = Math.min(speed, sp.rolling * DT * ground.ny);
        const k = (speed - dec) / speed;
        v = [v[0] * k, v[1] * k, v[2] * k];
      }
      const dk = Math.max(0, 1 - sp.drag * DT);
      v = [v[0] * dk, v[1], v[2] * dk];
    } else {
      const dk = 1 - PHYSICS.airDrag * DT;
      v = [v[0] * dk, v[1], v[2] * dk];
    }
    const hs = Math.hypot(v[0], v[2]);
    if (hs > PHYSICS.highSpeed) {
      const k = Math.max(0, 1 - (PHYSICS.highSpeedDrag * (hs - PHYSICS.highSpeed) * DT) / hs);
      v = [v[0] * k, v[1], v[2] * k];
    }
    const total = Math.hypot(v[0], v[1], v[2]);
    if (total > PHYSICS.maxSpeed) v = v.map((c) => (c * PHYSICS.maxSpeed) / total) as Vec3;

    // Cup: pull, sink or lip out.
    const cup = this.hole.cup;
    const dCup = distXZ(pos, cup);
    const onCupLevel = Math.abs(pos[1] - (cup[1] + PHYSICS.ballRadius)) < 0.2;
    b.lipCooldown = Math.max(0, b.lipCooldown - DT);
    const cupR = PHYSICS.cupRadius * this.hole.cupScale;
    if (onCupLevel && dCup < PHYSICS.cupPullRadius * this.hole.cupScale) {
      const hsp = Math.hypot(v[0], v[2]);
      if (dCup < cupR) {
        if (hsp < PHYSICS.sinkSpeed) {
          s.phase = 'sinking';
          b.sinkT = 0;
          b.sinkFrom = pos;
          b.body.setEnabled(false);
          this.events.push({ type: 'sunk', ball: s.id });
          return;
        } else if (b.lipCooldown <= 0) {
          // Lip out: deflect based on how off-centre the ball crossed the cup.
          const cx = cup[0] - pos[0],
            cz = cup[2] - pos[2];
          const crossZ = v[0] * cz - v[2] * cx;
          const ang = (crossZ > 0 ? -1 : 1) * (0.35 + 0.5 * (dCup / cupR));
          const c = Math.cos(ang),
            sn = Math.sin(ang);
          const nx = v[0] * c - v[2] * sn;
          const nz = v[0] * sn + v[2] * c;
          v = [nx * PHYSICS.lipOutSpeedKeep, v[1] + 1.2, nz * PHYSICS.lipOutSpeedKeep];
          b.lipCooldown = 0.4;
          this.events.push({ type: 'lipout', ball: s.id });
        }
      } else if (hsp < 3) {
        const k = (PHYSICS.cupPull * DT) / Math.max(dCup, 1e-3);
        v = [v[0] + (cup[0] - pos[0]) * k, v[1], v[2] + (cup[2] - pos[2]) * k];
      }
    }

    b.preVel = v;
    b.body.setLinvel({ x: v[0], y: v[1], z: v[2] }, true);
  }

  private onContact(b: BallInternal, other: ColliderInfo): void {
    const v = b.preVel;
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (other.obstacle?.type === 'bumper') {
      const o = other.obstacle;
      const t = b.body.translation();
      const nx = t.x - o.pos[0],
        nz = t.z - o.pos[2];
      const l = Math.hypot(nx, nz) || 1;
      const lv = b.body.linvel();
      const boost = PHYSICS.bumperBoost * o.strength;
      b.body.setLinvel({ x: lv.x + (nx / l) * boost, y: lv.y, z: lv.z + (nz / l) * boost }, true);
      this.events.push({ type: 'bumper', ball: b.state.id, obstacle: o.id });
      return;
    }
    if (other.role === 'floor') {
      if (v[1] < -2.2) this.events.push({ type: 'land', ball: b.state.id, speed: -v[1] });
      return;
    }
    if (speed > 0.8) this.events.push({ type: 'wall', ball: b.state.id, speed });
  }

  private postStep(b: BallInternal): void {
    const s = b.state;
    if (s.phase === 'holed' || b.loop) return;
    if (s.phase === 'sinking') {
      b.sinkT += DT;
      const k = Math.min(1, b.sinkT / 0.28);
      const cup = this.hole.cup;
      s.pos = [
        b.sinkFrom[0] + (cup[0] - b.sinkFrom[0]) * k,
        b.sinkFrom[1] - 0.32 * k * k,
        b.sinkFrom[2] + (cup[2] - b.sinkFrom[2]) * k,
      ];
      s.vel = [0, 0, 0];
      if (k >= 1) {
        s.phase = 'holed';
        this.events.push({ type: 'holed', ball: s.id });
      }
      return;
    }

    const t = b.body.translation();
    const lv = b.body.linvel();
    s.pos = [t.x, t.y, t.z];
    s.vel = [lv.x, lv.y, lv.z];

    if (s.phase === 'rest') {
      // Pushed by machinery or another ball?
      if (Math.hypot(lv.x, lv.y, lv.z) > 0.6) {
        s.phase = 'moving';
        b.body.setGravityScale(this.hole.gravityScale, true);
        b.slowTime = 0;
        b.moveTime = 0;
      }
    }
    // Hazards apply to resting balls too (a platform can carry one into the water).
    if (this.checkHazards(b)) return;
    if (s.phase !== 'moving') return;

    // Loop-the-loop entry.
    b.loopCooldown = Math.max(0, b.loopCooldown - DT);
    if (b.loopCooldown <= 0) {
      for (const o of this.hole.obstacles) {
        if (o.type !== 'loop') continue;
        const f = dirVec(o.rotY),
          sd = dirVec(o.rotY + Math.PI / 2);
        const d: Vec3 = [s.pos[0] - o.pos[0], s.pos[1] - o.pos[1], s.pos[2] - o.pos[2]];
        const along = d[0] * f[0] + d[2] * f[2];
        const side = d[0] * sd[0] + d[2] * sd[2];
        const vf = lv.x * f[0] + lv.z * f[2];
        if (
          along > -0.05 &&
          along < 0.35 &&
          Math.abs(side) < o.width / 2 &&
          Math.abs(d[1] - PHYSICS.ballRadius) < 0.2 &&
          vf > 2
        ) {
          b.loop = { o, phi: 0, v: Math.hypot(lv.x, lv.z) };
          b.body.setEnabled(false);
          return;
        }
      }
    }

    // Teleporters.
    b.teleCooldown = Math.max(0, b.teleCooldown - DT);
    if (b.teleCooldown <= 0) {
      for (const o of this.hole.obstacles) {
        if (o.type !== 'teleporter') continue;
        if (distXZ(s.pos, o.a) < o.radius && Math.abs(s.pos[1] - o.a[1] - PHYSICS.ballRadius) < 0.4) {
          const d = dirVec(o.exitDir);
          const speed = Math.max(2.5, Math.hypot(lv.x, lv.z));
          const np: Vec3 = [o.b[0] + d[0] * 0.45, o.b[1] + PHYSICS.ballRadius + 0.02, o.b[2] + d[2] * 0.45];
          b.body.setTranslation({ x: np[0], y: np[1], z: np[2] }, true);
          b.body.setLinvel({ x: d[0] * speed, y: 0, z: d[2] * speed }, true);
          s.pos = np;
          b.teleCooldown = PHYSICS.teleportCooldown;
          this.events.push({ type: 'teleport', ball: s.id, obstacle: o.id });
          break;
        }
      }
    }

    // Collectibles (generous magnetic radius).
    for (const [id, c] of this.activeItems) {
      const dx = s.pos[0] - c.pos[0],
        dy = s.pos[1] - c.pos[1],
        dz = s.pos[2] - c.pos[2];
      if (dx * dx + dy * dy + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
        this.activeItems.delete(id);
        this.events.push({ type: 'collect', ball: s.id, item: id });
      }
    }

    // Settling.
    b.moveTime += DT;
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const ground = this.groundProbe(b);
    const settleSpeed = PHYSICS.settleSpeed * SURFACES[s.surface].settle;
    if (ground && speed < settleSpeed) {
      b.slowTime += DT;
      const flat = ground.ny > PHYSICS.settleFlatness;
      if ((flat && b.slowTime > PHYSICS.settleTime) || b.slowTime > 1.0) {
        this.toRest(b);
        this.events.push({ type: 'rest', ball: s.id });
        return;
      }
    } else {
      b.slowTime = 0;
    }

    // Stuck: moving for a while without getting anywhere (e.g. rocking in a trough).
    b.stuckTimer += DT;
    if (b.stuckTimer > PHYSICS.stuckTime) {
      const dx = s.pos[0] - b.stuckAnchor[0],
        dz = s.pos[2] - b.stuckAnchor[2];
      if (Math.hypot(dx, dz) < PHYSICS.stuckDistance) {
        this.toRest(b);
        this.events.push({ type: 'stuck', ball: s.id });
        return;
      }
      b.stuckTimer = 0;
      b.stuckAnchor = [...s.pos];
    }
    if (b.moveTime > PHYSICS.maxShotTime) {
      this.toRest(b);
      this.events.push({ type: 'stuck', ball: s.id });
    }
  }

  /**
   * Analytic ride around a loop: speed from energy conservation (plus a little friction), the
   * ball detaches if the track can no longer hold it (too slow at the top) or rolls back if it
   * runs out of speed on the way up. Deterministic and immune to collider seams.
   */
  private rideLoop(b: BallInternal): void {
    const L = b.loop!;
    const o = L.o;
    const rho = o.radius - PHYSICS.ballRadius;
    const g = Math.abs(PHYSICS.gravity) * this.hole.gravityScale;
    const f = dirVec(o.rotY),
      sd = dirVec(o.rotY + Math.PI / 2);
    const lateral = o.shift / (Math.PI * 2);
    const at = (phi: number): Vec3 => {
      const k1 = o.radius * Math.sin(phi),
        k2 = o.radius - rho * Math.cos(phi),
        k3 = lateral * phi;
      return [o.pos[0] + f[0] * k1 + sd[0] * k3, o.pos[1] + k2, o.pos[2] + f[2] * k1 + sd[2] * k3];
    };
    const tangent = (phi: number, v: number): Vec3 => [
      v * (f[0] * Math.cos(phi)) + sd[0] * lateral * (v / rho),
      v * Math.sin(phi),
      v * (f[2] * Math.cos(phi)) + sd[2] * lateral * (v / rho),
    ];
    const release = (vel: Vec3) => {
      const p = b.state.pos;
      b.body.setEnabled(true);
      b.body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true);
      b.body.setLinvel({ x: vel[0], y: vel[1], z: vel[2] }, true);
      b.loop = null;
      b.loopCooldown = 0.5;
    };
    // energy: v^2 = v0^2 - 2 g rho (1 - cos phi), integrated incrementally with friction
    const phi0 = L.phi;
    L.phi += (L.v * DT) / rho;
    const dh = rho * (Math.cos(phi0) - Math.cos(L.phi));
    const v2 = L.v * L.v - 2 * g * dh;
    L.v = v2 > 0 ? Math.sqrt(v2) * (1 - 0.12 * DT) : 0;
    b.state.vel = tangent(L.phi, L.v);
    if (L.phi >= Math.PI * 2) {
      const end = at(Math.PI * 2);
      b.state.pos = [end[0], o.pos[1] + PHYSICS.ballRadius + 0.005, end[2]];
      release([f[0] * L.v, 0, f[2] * L.v]);
      return;
    }
    b.state.pos = at(L.phi);
    const normal = (L.v * L.v) / rho + g * Math.cos(L.phi);
    if (L.v <= 0.05 || normal < 0) release(b.state.vel); // fall off / roll back
  }

  private toRest(b: BallInternal): void {
    b.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.body.setGravityScale(0, true);
    b.state.vel = [0, 0, 0];
    b.state.phase = 'rest';
    b.slowTime = 0;
    b.springFired = false;
  }

  /** Water and out-of-bounds: reset to the last rest spot. Returns true if a reset happened. */
  private checkHazards(b: BallInternal): boolean {
    const s = b.state;
    const p = s.pos;
    const oob =
      p[1] < this.killY ||
      p[0] < this.bounds.min[0] - 1 ||
      p[0] > this.bounds.max[0] + 1 ||
      p[2] < this.bounds.min[2] - 1 ||
      p[2] > this.bounds.max[2] + 1;
    let water = false;
    if (!oob) {
      for (const z of this.hole.zones) {
        if (z.kind === 'water' && inYawBox(p, z.center, z.size, z.rotY)) {
          water = true;
          break;
        }
      }
    }
    if (!oob && !water) return false;
    this.events.push({ type: water ? 'water' : 'oob', ball: s.id });
    this.placeBall(s.id, s.lastRest);
    return true;
  }

  /** Release WASM memory. */
  dispose(): void {
    this.eventQueue.free();
    this.world.free();
    this.balls.clear();
  }
}

function solidColliderDesc(shape: 'box' | 'cylinder', size: Vec3): RAPIER.ColliderDesc {
  return shape === 'box'
    ? RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
    : RAPIER.ColliderDesc.cylinder(size[1] / 2, size[0] / 2);
}

/**
 * A dome is the convex hull of its visible cap (world space). It used to be the whole sphere the
 * cap is cut from, which is ~3x wider than the cap and reaches 1.5 m below the green: hidden under
 * a solid green, but sticking out past rails, ledges and gaps as an invisible bulge.
 */
function domeColliderDesc(s: Solid): RAPIER.ColliderDesc {
  const pts = domeCapPoints(s.center, s.size);
  const v = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => v.set(p, i * 3));
  const hull = RAPIER.ColliderDesc.convexHull(v);
  if (!hull) throw new Error('dome hull failed');
  return hull;
}

/** Top surface of a ribbon as a triangle mesh (internal edges smoothed so seams can't kick). */
function ribbonColliderDesc(s: Solid): RAPIER.ColliderDesc {
  const { left, right } = solidRibbon(s);
  const n = left.length;
  const v = new Float32Array(n * 6);
  left.forEach((p, i) => v.set(p, i * 6));
  right.forEach((p, i) => v.set(p, i * 6 + 3));
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2,
      r0 = i * 2 + 1,
      l1 = i * 2 + 2,
      r1 = i * 2 + 3;
    idx.push(r0, l0, l1, r0, l1, r1);
  }
  return RAPIER.ColliderDesc.trimesh(v, new Uint32Array(idx), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
}

function defaultRestitution(role: Solid['role'], surface: SurfaceKind): number {
  if (role === 'floor') return SURFACES[surface].restitution;
  return surface === 'rubber' ? 0.95 : PHYSICS.wallRestitution;
}

export function computeBounds(solids: Solid[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of solids) {
    if (s.shape === 'dome') {
      const a = s.size[0] / 2;
      for (let i = 0; i < 3; i++) {
        const lo = i === 1 ? s.center[1] - 0.05 : s.center[i] - a;
        const hi = i === 1 ? s.center[1] + s.size[1] : s.center[i] + a;
        min[i] = Math.min(min[i], lo);
        max[i] = Math.max(max[i], hi);
      }
      continue;
    }
    if (s.shape === 'ribbon') {
      const { left, right } = solidRibbon(s);
      for (const p of [...left, ...right])
        for (const dy of [0, -s.size[1]])
          for (let i = 0; i < 3; i++) {
            const v = p[i] + (i === 1 ? dy : 0);
            min[i] = Math.min(min[i], v);
            max[i] = Math.max(max[i], v);
          }
      continue;
    }
    const q = quatFromEuler(s.rot[0], s.rot[1], s.rot[2]);
    for (const sx of [-0.5, 0.5])
      for (const sy of [-0.5, 0.5])
        for (const sz of [-0.5, 0.5]) {
          const c = rotateVec(q, [s.size[0] * sx, s.size[1] * sy, s.size[2] * sz]);
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], s.center[i] + c[i]);
            max[i] = Math.max(max[i], s.center[i] + c[i]);
          }
        }
  }
  return { min, max };
}
