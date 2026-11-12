# Progress log

## Status

| Milestone                                               | State       |
| ------------------------------------------------------- | ----------- |
| M1 scaffold, game loop, one hole, physics, aim, camera  | ✅ done     |
| M2 loader, obstacles, hazards, world 1                  | ✅ done     |
| M3 server, lobby, synced shots                          | ✅ done     |
| M4 co-op modes, ghosts, emotes, reconnect               | ✅ done     |
| M5 collectibles, progression, shop, achievements, daily | ✅ done |
| M6 remaining worlds, polish, audio, touch | ✅ done (incl. stretch world Space Station) |
| M7 perf, bug bash, tests, README, deploy | ✅ done |

| v1.1 graphics overhaul, 6 players, direct connection, desktop/iPhone packaging | ✅ done (see below) |
| v1.2 Planet Hopper roguelike mode + Clubhouse hub | ✅ done (see below) |
| v1.3 level variety, trinket levels, Windows fullscreen, fixes | ✅ done (see below) |
| v1.4 hole personalities, forks, water, tougher bosses, Ultra graphics, memory | ✅ done (see below) |
| v1.5 flowing set pieces (corkscrews, slides, loops, tunnels, drops, leaps, spring pads), curved forks, team-size hearts | ✅ done (see below) |
| v1.6 polish and bug fixes: seamless floors, difficulty ramp, camera fade, putter styles, putter sound, performance | ✅ done (see below) |
| v1.7 shorter invite codes, ready-up / loop / Slick Greens fixes, hole intro flyover, varied terrain, host kick, version on the menu | ✅ done (see below) |

**Next steps (not started):** real accounts/auth; persist rooms across server restarts; switch the client to the non-`compat` Rapier build (separate .wasm, ~1 MB smaller download); optional outline pass; hand-tuned pars from playtesting with humans (current pars are designer estimates, sanity-checked by the solver).

## M1 — done

- npm workspaces (`shared`, `server`, `client`), strict TS 6.0, ESLint, Prettier, Vitest config.
- Node was not installed on the dev machine; installed Node 26 via Homebrew.
- Shared `Simulation` (Rapier, fixed 60 Hz) + `Match` (rules) + course builder; client `LocalSession` interpolates.
- Client: toon renderer with sky gradient, fog, soft shadows, bloom + vignette; CourseView; BallView (rolling skin, hat, putter, trail, squash); CameraRig (orbit, pullback, overview, shake); AimView (power arrow with tick marks + reflecting preview); Controls (slingshot drag, keyboard ping-pong charge, gamepad); HUD; results with animated XP/stars.
- Verified in browser: menu → hole → putt → coin pickups → hole-in-one → results/level-up. No console errors.

## M2 — done

- Obstacle components: windmill, spinner (rotating gate), mover (blocking or carrying platform), bumper, teleporter, loop, plus zones: sand, ice, sticky, boost, conveyor, water, low gravity, one-way.
- Sunny Meadow (9 holes) designed as a tutorial curve; each hole has a tip.
- `npm run validate:courses`: greedy headless solver proves every hole is completable.
- Tests caught two bugs: platform carry flagged OOB (bounds ignored movers) and the loop's stepped rails kicking the ball. **Loop is now a scripted analytic ride** (energy-conserving, detaches if too slow at the top) — robust and deterministic.

## M3/M4 — done

- Server: `Lobby` (routing, tokens, rate limiting) + `Room` (members, host migration, reconnect window, 60 Hz Match, 20 Hz snapshots, events, server-side rewards). JSON store with atomic debounced writes.
- Protocol in `shared/src/protocol.ts`; both ends validate everything with zod. Snapshots carry a monotonic server tick (`st`) for clock sync plus the hole-local tick for the obstacle clock.
- Client `RemoteSession`: earliest-arrival clock filter, adaptive interpolation delay (110 ms + 2.5×jitter), 100 ms extrapolation cap, teleport snapping, events released at render time so sounds/particles line up with visuals.
- Dev network simulator: `?lag=150&jitter=30&loss=0.05`; `client/test/interp.test.ts` proves monotonic motion within 2 cm of truth under those conditions.
- Verified in two browser tabs: lobby, ready-up, parallel course to completion with rewards, relay turn passing, emotes, chat filter, reload-to-reconnect mid-hole.
- Bugs fixed: profile sync echo loop (no-op merges now silent); coin ledger not updated (regression test added).

## M5 — done
- Collectibles: coins respawn per run; gems/golden balls persist per profile (shown translucent once found, duplicates pay coins); crates give a deterministic unowned cosmetic. Magnetic lean, particle bursts, pitch-rising pickup chime, HUD counter tweens.
- Profile: level/XP/coins (ledger: `coinsEarned`/`coinsSpent` so merges are safe), stars, best scores, stats, 25 achievements, 53 cosmetics across 6 slots.
- Screens: Locker & Shop (try-on 3D preview, buy/equip), Collection (silhouettes for missing gems/golden balls), Profile (stats + achievements).
- Daily challenge: seeded procedural hole (`shared/src/daily.ts`), played as a private server room, best-per-player leaderboard; offline fallback plays locally.

## M6 — done
- Worlds: Candy Canyon (sticky caramel, gumdrop bumpers, boost, loop, rail-less cloud path, teleporter-only green), Frozen Lagoon (ice zones, twin bridges, ice rink, drifting floe platform), Clockwork Factory (conveyors, pistons, gear spinners, pneumatic-tube teleporters, freight elevator), Space Station (stretch; 0.55 g, ramp jumps over the void, wormhole, bigger loop, gravity well). **45 holes, all solver-verified.**
- Polish: starfield for space, bloom threshold raised (only emissive things glow; fixed washed-out Frozen), touch-aware hints, mobile layout check at 375×812.

## M7 — done
- Perf (candy-6, busiest hole): ~1.0 ms median / 4.9 ms p95 CPU per frame (update+render); 161 draw calls / 68k tris on High, 93 / 34k on Low. Decor is instanced.
- Leaks: geometry/texture counts unchanged after 18 hole switches.
- Tests: 40 (physics, rules, progression, protocol, course data + solver spot-checks, lobby/room integration, latency interpolation). `npm run validate:courses` sweeps all 45 holes.
- Bug bash fixes: Esc couldn't resume (controls disabled while paused); solo sim kept running while paused; three r187 shadow-map deprecation.
- Production: vendor chunk split (app 94 KB gz, three 150 KB, rapier 1.67 MB), inline boot splash for instant first paint, single-process server (static + ws), path-traversal guarded, standalone server bundle verified from an empty dir. Dockerfile written (Docker not installed on the dev machine, so the image build itself is untested).

## v1.7 — invite codes, fixes, hole intros, scenery, kick (done)
- **Shorter invite codes** (`client/src/net/compactCode.ts`): a data-channel SDP is nearly all boilerplate, so only the ICE ufrag/pwd, the DTLS fingerprint, the role and the candidate addresses (IPv4, up to two global IPv6, mDNS names, public addresses) are packed into bytes, checksummed (CRC-16) and written in Base58 behind a `PPP2` prefix: ~190 characters instead of ~700, letters and digits only. Anything that doesn't fit (more than 15 addresses, an unusual fingerprint) falls back to the old `PPP1.` format, which is still read. The code is found inside a pasted chat message. Tests round-trip a realistic Windows 11 candidate set.
- **Ready-up fix** (a guest on Windows 11 couldn't ready up; not reproducible here, so this is the set of faults found by reading the path end to end). The host handles `ready` correctly, and the short codes are not involved (the report is against v1.6.0, which doesn't have them; once the link is open the code plays no part). What was wrong on the guest's side: (1) the guest lobby is ~860 px tall and the Ready button was its last element, so on a short window (a 1080p laptop at 150% scaling gives ~640 px) it was entirely below the fold; it is now pinned to the bottom of the window. (2) The lobby was rebuilt from scratch on every room update (at least every 3 s), which dropped any click that straddled a rebuild and closed the host's course menu; it now only updates pings unless something changed. (3) The Ready button decided from the room state it was drawn with, so a double-click could send ready then un-ready; it now reads the live state and ignores a second click within 0.4 s. (4) `NetClient` let a replaced transport's late `close` event mark the new link offline, stop its pings and (direct games) throw the player back to the menu; stale transports are now ignored. (5) Pasting a second invite left the first attempt's peer connection knocking for 15 minutes, and whichever link opened last took over; a new attempt now cancels the previous one. (6) `Room.broadcast` stopped at the first connection whose `send` threw; each send is now guarded.
- **Loop-the-loop invisible**: `CourseView` merges low floors into one static mesh per material and flushed that batch *before* adding obstacles, so the loop's own floor segments (role `floor`) were queued and never drawn. Raised segments outside Space escaped because raised floors are separate meshes, hence "sometimes". Obstacle floors are now always separate meshes (they also fade when they hide the ball).
- **Slick Greens on slopes**: with a Storm Compass at Lv2 the omen skipped every sloped floor (physics and look), which read as slopes not freezing, most often on Space, the last sector, where the compass has usually been levelled. The omen now covers every floor at every level: `slick` (no compass), `frost` (Lv1), `rime` (Lv2, a thin frost, rolling 0.62 × grip), nothing at Lv3. **Slide tuning**: `SLICK_GREEN_GRIP = 1.2` in `shared/src/config.ts` scales rolling resistance and drag of those three surfaces; a measured putt rolls ~17% less far than on ice. Ice patches and every other surface are unchanged.
- **Hole intro** (`client/src/rendering/HoleIntro.ts`): a 3–5 s flyover (length scales with the hole) along a Catmull-Rom curve through `hole.path`, tee to cup, then back along the hole, blending into the gameplay camera over the last stretch so the final frame is exactly the gameplay view. A card shows the hole's name and par. Any key or tap skips it (a 0.45 s glide, never a cut). It is presentation only: the match, turns and timers run as before, every client plays it when it loads the hole, and input is only held back locally while it runs. Reduced-motion shows the card without the camera move; `?nointro` turns it off.
- **Terrain** (`Landscape.ts`): beyond 16 m from the course each sector gets its own landforms on top of the old hills: meadow downs and a grass ridge, candy gumdrop mounds and sugar dunes, frozen stepped ice shelves and a knife ridge, clockwork mesas over a dune floor, space craters with raised rims, regolith dunes and a rim ridge. Strength, direction and palette shift per hole (seeded). Two unlit silhouette rings of far mountains (two draw calls) add depth; steep faces get strata bands. The near field is untouched, so nothing rises into the course or the camera's line.
- **Kick**: `kick{id}` (client → host) and `kicked{message}` (host → client). `Room.kick` checks on the host that the sender is the host and the target isn't; the player is removed from the room and from relay turns, told why, and (server rooms) can't rejoin with the code. Direct hosts close the link and can re-invite. UI: **✕ Remove** on other players' lobby cards and *Pause → Players*, host only, with a confirmation.
- **Version**: the root `package.json` is the single source; Vite injects it (`__APP_VERSION__`), the main menu shows it bottom-left, and a test fails if `desktop/package.json` or the lockfile disagree.

## v1.6 — polish and bug fixes (done)
- **Seamless smooth floors**: every curve (`arc`), slide and corkscrew is one ribbon whose ends are cut square to the straight floor they meet (`ribbonEdges(path, w, dir0, dir1)`, `fairway({ smooth })` stops neighbouring boxes from overlapping into them). Ribbons can carry explicit edge lines (`Solid.left/right`, `strip()`). Fork swoops are a shared strip that splits exactly at the island tip into two lane strips; every cut is square to the leg (lane half-width `W / 2 / cos(slope)`), so pieces meet edge to edge. Before, overlapping boxes z-fought and left wedge-shaped pinholes on S-curves, worst on fork lanes. Slides are now an S that leaves and rejoins the leg tangentially. Test: smooth floors never overlap another floor.
- **Tunnels** skip bends tighter than the tube (it folded over itself on the inside) and anything within reach of another part of the course, above, below or alongside; slides get a wider tube so their taller rails stay inside.
- **Grass**: scenery used to be kept out of every solid's axis-aligned box, which cleared big squares round diagonal legs, curves and corkscrews. `client/src/rendering/footprint.ts` rasterises the exact footprint into a 0.2 m grid with a distance field: grass grows to the rails, and placement is O(1) per blade.
- **Slick Greens** with a Storm Compass turned the green to `metal`, barely different from grass; it now becomes `frost` (new surface, rolling 0.36) at Lv1, frost on the flats only at Lv2.
- **Gimme Clover** added a stroke, so it never saved one; the gimme is now free, reach 0.9 / 1.3 / 1.7 m. **Spring pads** didn't launch a ball that arrived in the air (the "already used" flag was set on entering the zone, not on launching); fixed and tested. Pads now bounce for every launch (on the `boost` event) rather than whenever a ball is near.
- **Difficulty**: measured par against the solver per stage (2 × 3 seeds, old and new generator): the margin grew from ~1.1 strokes early to ~2 late, so late holes were relatively easy, and a few long downhill holes were giveaways (par 7, solved in 2). Par is now the raw estimate tightened by `0.8·t`, clamped to 0.5–1.8 strokes above a solver-stroke estimate fitted on ~180 generated holes (`1.07 + 0.025·flat m + 0.03·downhill m + 0.12·sharp corners − 0.05·curves + 0.167·hazard points`, rms 0.8). Measured margins over the solver by quarter of the run: 0.83 / 1.38 / 1.71 / 1.61 (v1.5: 1.09 / 1.76 / 2.03 / 1.81). Holes have up to 8 legs and set pieces are commoner and earlier. Heart pools 3 / 6 / 12 / 16 / 22 / 27. The run model (v1.5 skill model shifted by the measured margins) gives an average solo player ~35%, duo ~34%, trio 36–51% (mixed / average skill), four ~41%; it is a model, not playtesting. Rare trinkets ×0.25 draft weight (was ×0.5), Mystery Box rare chance 40% (was 60%).
- **Variety**: Rolling Hills (bumps, humps, dips) and Thrill Ride (late rollercoasters; replaces Classic from depth 10) personalities, deck of 11 with step 4; double corkscrews (depth ≥ 9), steep chutes (2–2.7 m drop), **bumps** (`shape: 'dome'`, a spherical cap 9–18 cm high on one side of the green).
- **Camera** passes through rails and obstacles instead of lurching in; whatever stands between it and the ball (rails, blocks, machinery, raised terraces) fades to ~28% (`CourseView.updateOcclusion`).
- **Putters**: 12 styles with distinct heads (blade, mallet, twin fang, hockey stick, candy-cane crook, rocket, star wand, flamingo, croquet mallet…), two more free; looks only. **Putter sound**: a CC0 recording (inlined), pitched and levelled by power, with the old synth as fallback.
- **Performance**: low floors and earth skirts merge into one mesh per material; every rail shares one wood material (plank repeat baked into UVs); ice/frost materials are cached per hole instead of one canvas texture per floor.
- Fix: ribbon floors set `DoubleSide` on the shared cached floor-side material.

## v1.5 — flow, set pieces and team-size balance (done)
- **Team-size hearts** (`teamHearts` / `picnicHeal` / `secondWindHearts` in `HopperMatch.ts`): 4 / 7 / 10 / 12 / 14 / 16 max hearts for 1–6 players, Picnic heals 1 / 2 / 2 / 3 / 3 / 4, Second Wind 2 / 3 / 3 / 4 / 4 / 5. Three players is the reference (unchanged). A Monte Carlo of whole runs with modelled player skill put an average solo player at ~98% runs won under the old rules vs ~75% for an average trio; the new tables bring solo to ~74%.
- **Set pieces** (new specials in `generate.ts`): **spiral** (one full turn round a tower down 1.6–2 m; the run-out passes under the lead-in; the tower is the inner rail), **slide** (S-bend chute down 1.2–2.1 m with taller rails), **drop** (one or two ledges; the lower green tucks under the ledge), **leap** (kicker or **spring pad** up onto a higher ledge over water), **loop** (funnel rail into the entry lane, divider and stop rail, boost at low depth). Tunnels (`Hole.tunnels`, visual only) cover some sweeping corners, slides and quiet straights ≥ 3 m; they fade while a ball is inside and never block the camera or aim line.
- **Ribbon floors** (`shape: 'ribbon'`, `ribbonEdges` in `math.ts`): corkscrews and slides are one smooth strip, a Rapier trimesh with `FIX_INTERNAL_EDGES`. Tilted box segments left 1–2 cm lips at every joint, enough to launch a fast ball out of the spiral.
- **Spring pad** zone (`kind: 'spring'`): pops a grounded ball up at `strength` m/s once per visit, keeping its pace. From 3 m back the window is roughly 50–60% power.
- **Curved forks**: the lanes swoop apart (cosine profile) round the lagoon and back together; inner rails start exactly where the lanes stop sharing a floor, with a rock at each island tip. No more cross-bars or 90° corners. Corners next to forks can be rounded too.
- **Flow**: ~82% of corners are curves (bigger radii: 2.4–4.2 m for 90°, 3.5–6 m for 45°), slopes on curves get proper floor overlap, personalities Funhouse (loops, spirals, slides, tunnels) and Skyway (drops, leaps, jumps, terraces) replace Pinball. Deck step is now 4 (coprime with 9 personalities).
- **Clutter**: the bumper-field plaza is now a wide green with a boulder and two well-spaced bumpers; fork bumper lanes have 2 bumpers; two features share a stretch only if it is ≥ 9 m, they sit ~44% of it apart, and never two blockers (bumpers, pillars, spinners, movers, gates, windmills). Bumpers left meadow/space flavour lists. Tested: every spinner/windmill keeps > 0.6 m clear of other blockers.
- Solver: progress cap now uses the distance the ball actually rolled (spirals and loops travel far but end up close to where they started).

## v1.4 — variety, water, bosses, graphics and memory (done)
- **Hole personalities** (`holeArchetype` in `generate.ts`): classic, fork, switchback, long drive, summit, waterworks, gauntlet, pinball. Each tweaks leg count/length, width, special weights, hazard weights, corner rounding and the name. Stages walk a per-run shuffled deck three steps at a time, so neighbouring stages and the options of one route vote never share a personality.
- **Forked fairways** (`buildFork`): a ring round a lagoon (lane centres 8–13 m apart, lanes 10–17 m long) made of two cross-bars, two lane fairways and island walls. One lane is steady (sand, pillar slalom, big hill, bumpers) and swings out further; the other is quick but risky (narrow open bridge, jump, speed pads or ice beside open water, machinery) and holds the gem. The path (camera, rescue, solver) follows the steady lane. Leg placement now checks footprints (capsules with half widths) instead of a 4 m cell grid.
- **Water**: brooks crossing the fairway with one, two or a centre bridge; ponds in a wide green with an optional plank; lagoons inside forks; open-edge lanes. Water zones are kept clear of grass/trees.
- **Elevation**: new valley (dip) and climb (two ramps with a terrace) specials, ramps weighted up, and the Summit personality.
- **Bosses**: each planet's set piece (meadow brook + windmill, candy plaza, frozen pond, clockwork fork, space jump), planet heavy-machinery list, +20% machinery speed, extra open-water edges, narrower fairway, par = round(estimate − 1).
- **Trinket levels are rarer**: draft weight by current level 1 / 0.4 / 0.12.
- **Graphics/memory**: canvas has no MSAA backbuffer (it was wasted under post-processing); only the scene render target is multisampled; bloom at half res. High: 1.5× pixel ratio, 2048 shadows, half-res GTAO (was 2×, 4096, full res: well under half the GPU memory on a Retina screen, by estimate). New **Ultra** tier: 2× pixel ratio, 4096 shadows with soft edges, full-res GTAO, tilt-shift, denser grass and decor. High/Ultra add per-planet atmosphere motes (`Ambience.ts`, one draw call). Desktop disables the spellchecker.
- Builder fix: a short segment beside a sharp turn could produce a zero-length (NaN) rail; such rails are now skipped.
- Solver: progress along the path is capped at how far the ball actually moved (+1.5 m), so a ball parked beside a later leg behind a wall no longer looks like it is nearly at the cup (it got stuck in a fork corner next to the following leg).

## v1.3 — level variety and fixes (done)
- Generator rewrite (`shared/src/hopper/generate.ts`): legs in 8 directions (±90° and ±45° turns), most corners rounded into arcs, and per-leg **specials**: ramps (±0.5/±0.9), humps, kicker **jumps** over a water gap (low gravity over long gaps / in space, sometimes a boost pad), **split lanes** (centre rail, a different feature in each lane), **pinball plazas**, and a **wormhole** shortcut on long holes. Per-planet hazard flavour (candy sticky, frozen ice, clockwork gates/movers). Zones/obstacles now take any heading (rotY) instead of assuming axis-aligned fairways. `fairway()` floor overlap at a joint is now `w/2·tan(θ/2)` so shallow arc joints don't poke out past the rails (90° corners unchanged).
- Trinket **levels** (in-run only): drafts offer level-ups of owned trinkets up to Lv3 (`levels` on the run state; shaping trinkets are encoded as one copy per level in the stage spec so clients regenerate identical holes). Matching co-op keepsakes stack.
- Fixes: locker opened from the lobby no longer closes on every room update (`screens.inLobbySub`); Copy button copies through the OS clipboard in the desktop app (or the selected textarea in browsers) instead of `navigator.clipboard`; ice is a mid-blue semi-gloss (was near-white, which bloomed on High) and High-preset bloom is turned well down (strength 0.28 → 0.12, threshold 0.92 → 1.2); Fog Bank fog is ~3× denser, uses real distances and turns the sky to fog; Clubhouse shows undiscovered trinkets as grey silhouettes (no more `?`/`∅` tiles; click an equipped keepsake to unequip).
- Desktop: F11 / Alt+Enter toggle fullscreen (borderless on Windows), plus *Settings → Display*; remembered between launches (`userData/display.json`).

## v1.2 — Planet Hopper (done)
- `shared/src/hopper/`: `defs.ts` (trinkets, omens, rewards, upgrades, run skeleton, zod schemas), `generate.ts` (seeded hole generator + Wishing Green), `HopperMatch.ts` (Match subclass: hearts, forks, votes, rerolls, rest crates, boss rewards), `rewards.ts` (XP + stardust banking, upgrades, keepsakes).
- Match gained protected rule hooks (hazard penalty, gimme on rest, holed-stroke adjust, collect, hole complete). Holes gained `theme`, `cupScale`, `powerScale`, `wind` (all defaulted, so existing courses are unchanged).
- Network: holes are not sent. Clients regenerate them from the run seed + per-stage spec carried in `score.hopper` / `matchStart.hopper` (test: host and guest hole JSON hashes match). New messages `hopperVote`, `hopperReroll`; new events `note`, `hopper`.
- Verified: solver completes 38/38 stages over two full seeded runs including bosses and every omen; solo run in the browser (fork, trinket draft, boss, rest stop crate, defeat, stardust banked); co-op run over a direct connection (shared hearts, vote chips, tie-break, identical geometry, rewards on both sides); phone layout.
- Rest-stop "holes" are excluded from hole XP, so a wish can't count as a hole-in-one.

## v1.1 — done
- Locker bug fixed: the preview renderer was disposed the instant it was created (cleanup hook registered before `showScreen`, which runs pending hooks). Preview now stages per slot (rolling ball/trail, hat/putter close-up, replayable victory/hole-in-one).
- Graphics: PBR-stylised materials + sky IBL, ACES, cloud/sun sky shader, terrain with cliffs and mountains, rock spires, 45k wind-swaying grass blades, richer pines, wood-plank rails, dimpled clear-coat ball, fresnel water, GTAO + bloom + grade. Measured ~1.8 ms/frame on High on an M-series Mac. OOB now triggers 0.6 below the lowest green (terrain sits just under the course).
- 6 players: room cap, two-row chaos tee layout (test: 6 colliding balls on every tee of all 45 holes stay put), lobby slots.
- Direct connection: P2P (WebRTC + copy/paste codes, host runs the room in-process) and join-by-address (LAN server from the desktop app). Verified in two browser tabs: handshake, lobby, a parallel hole with the host tab in the background (60 Hz held), chat, host leaving.
- Packaging: Electron (mac universal DMG/zip, Windows NSIS installer/zip), Capacitor iOS project (compiles for the Simulator SDK). Procedural app icon.

## Decisions (simplest option that keeps game feel)

- **Ball physics:** rotation-locked sphere, zero friction; rolling resistance/drag/settling are our own code (`config.PHYSICS`, `SURFACES`). Much easier to tune than Rapier friction on a sphere.
- **Cup:** detection-based (no hole in the collider). Lip-out = deflection + speed loss when crossing faster than `sinkSpeed`.
- **Surfaces as zones**, not collider patches, to avoid seam bumps.
- **JSON store instead of SQLite** (native addon friction on Node 26) — see ARCHITECTURE.md.
- **Courses are TS data validated by zod** at load (and in tests), written with builder helpers (`fairway()` builds floors, ramps, mitred walls).
- Daily challenge is played through the server (authoritative leaderboard) and falls back to local play offline.

## Tuning notes

- `maxShotSpeed 17`, `powerCurve 1.35` (fine control on short putts), grass `rolling 1.15 / drag 0.32` → 50% power ≈ 9 units.
- `sinkSpeed 4.4`: a firm putt still drops; full-power shots lip out.

## Known issues (v1.1)
- Desktop/iOS builds are unsigned/ad-hoc signed: first launch shows OS warnings (see README). iOS device installs need the user's Apple team selected in Xcode.
- No iOS Simulator runtime was installed on the build machine, so the iPhone app was compiled but not run in a simulator.
- Direct play can fail on symmetric NATs (no TURN relay, by design: no servers).
- v1.1.1 fix: direct play between different home networks failed whenever the host took more than ~15 s to paste the reply code (the guest's browser abandons ICE checks after 15 s of silence, and the host's router drops the guest's packets until the host starts sending). Candidates are now stripped from the codes' SDP and re-added with fresh foundations whenever checks give up (`keepKnocking` in `p2p.ts`), so both sides keep punching until connected. Code generation also stops ~1.2 s after the public address is found instead of waiting out the 4 s gathering timeout.

## Known issues

- Guest profiles are client-held and pushed on `hello`; a tampered localStorage profile can be merged into the server copy. Acceptable for guest-only play; with real auth the server should stop accepting client progress.
- Rooms live in memory: a server restart (including `tsx watch` reloads in dev) closes all rooms.
- In a hidden browser tab rendering pauses, so remote events queue until the tab is visible again (then flush).
- Not verified by a human playtest at full frame rate: development checks ran in an embedded browser pane that was hidden (throttled to ~2 fps), so animation smoothness was verified by tests/metrics rather than by eye.
- Rapier's `-compat` build inlines its WASM (1.67 MB gzipped); the boot splash covers the download.
- Pars are designer estimates; the greedy solver is superhuman (it aces many holes), so it only proves completability, not difficulty.
