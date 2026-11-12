import {
  RULES,
  COURSES,
  dailyCourse,
  dateKey,
  WORLD_GATES,
  MODE_INFO,
  COSMETIC_BY_ID,
  achievementName,
  ACHIEVEMENTS,
  COSMETICS,
  SLOT_LABELS,
  isOwned,
  type Cosmetic,
  type CosmeticSlot,
  starsTotal,
  worldUnlocked,
  xpToNext,
  type Course,
  type Grant,
  type ScoreState,
  SKELETON,
  TRINKETS,
  TRINKET_IDS,
  UPGRADES,
  UPGRADE_IDS,
  OMENS,
  dustBalance,
  upgradeRank,
} from '@ppp/shared';
import { WORLD_LABEL, heartsEl, trinketChip } from './HopperHud';
import type { Game } from '../core/Game';
import type { SessionPlayer } from '../core/Session';
import { ACTION_LABELS, DEFAULT_KEYS, keyLabel, type Action } from '../core/settings';
import { h, clear, tweenNumber, relScore } from './dom';
import { scorecard } from './Hud';
import { audio } from '../audio/Audio';
import { LockerPreview } from './LockerPreview';
import type { LocalHost } from '../net/LocalHost';
import { APP_VERSION } from '../version';

const WORLD_EMOJI: Record<string, string> = {
  meadow: '🌻',
  candy: '🍭',
  frozen: '❄️',
  clockwork: '⚙️',
  space: '🪐',
};

/** All menu screens. Each method renders one screen into the UI root. */
export class Screens {
  constructor(private readonly game: Game) {}

  private get p() {
    return this.game.profile.profile;
  }

  private header(title: string, back?: () => void): HTMLElement {
    return h(
      'div',
      { class: 'screen-header' },
      back ? h('button', { class: 'btn back', onclick: back }, '← Back') : null,
      h('h2', {}, title),
      this.profileChip(),
    );
  }

  profileChip(): HTMLElement {
    const p = this.p;
    const need = xpToNext(p.level);
    return h(
      'div',
      { class: 'profile-chip' },
      h('div', { class: 'lvl' }, String(p.level)),
      h(
        'div',
        { class: 'pc-body' },
        h('div', { class: 'pc-name' }, p.name),
        h('div', { class: 'xpbar' }, h('i', { style: `width:${(p.xp / need) * 100}%` })),
      ),
      h('div', { class: 'pc-stats' }, h('span', {}, `🪙 ${p.coins}`), h('span', {}, `⭐ ${starsTotal(p)}`)),
    );
  }

  // ------------------------------------------------------------------------------------------

  mainMenu(): void {
    const g = this.game;
    const el = h(
      'div',
      { class: 'screen main-menu' },
      h('div', { class: 'top-right' }, this.profileChip()),
      h(
        'div',
        { class: 'logo' },
        h('span', { class: 'l1' }, 'Putt-Putt'),
        h('span', { class: 'l2' }, 'Planet'),
      ),
      h(
        'div',
        { class: 'menu-buttons' },
        h('button', { class: 'btn primary big', onclick: () => this.courseSelect() }, '⛳ Play Solo'),
        h('button', { class: 'btn big hopper-btn', onclick: () => this.clubhouse() }, '🪐 Planet Hopper', h('small', {}, 'roguelike run')),
        h('button', { class: 'btn big', onclick: () => this.multiplayer() }, '👥 Play with Friends'),
        h('button', { class: 'btn big', onclick: () => this.daily() }, '📅 Daily Challenge'),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: () => this.locker() }, '🎽 Locker & Shop'),
          h('button', { class: 'btn', onclick: () => this.collection() }, '💎 Collection'),
        ),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', onclick: () => this.profileScreen() }, '🏅 Profile'),
          h('button', { class: 'btn', onclick: () => this.settings(() => this.mainMenu()) }, '⚙️ Settings'),
        ),
      ),
      h('div', { class: 'version-tag', title: 'Game version' }, `v${APP_VERSION}`),
      h(
        'div',
        { class: 'footer-hint' },
        matchMedia('(pointer: coarse)').matches
          ? 'Drag back from the ball to putt · drag elsewhere to look around · pinch to zoom'
          : 'Drag back from the ball to putt · Space to charge · right-drag to orbit · T overview',
      ),
    );
    g.ui.showScreen(el);
  }

  courseSelect(onPick?: (c: Course) => void, title = 'Choose a course'): void {
    const p = this.p;
    const cards = COURSES.map((c) => {
      const unlocked = worldUnlocked(p, c.world);
      const stars = p.stars[c.id] ?? [false, false, false];
      const gate = WORLD_GATES[c.world];
      const par = c.holes.reduce((a, h) => a + h.par, 0);
      return h(
        'button',
        {
          class: `course-card ${unlocked ? '' : 'locked'}`,
          style: `--sky:${c.theme.skyTop};--floor:${c.theme.floorA}`,
          disabled: !unlocked,
          onclick: () => (onPick ? onPick(c) : this.game.startLocal(c)),
        },
        h('div', { class: 'cc-emoji' }, WORLD_EMOJI[c.world] ?? '⛳'),
        h('div', { class: 'cc-name' }, c.name),
        h('div', { class: 'cc-desc' }, c.description),
        h(
          'div',
          { class: 'cc-meta' },
          `${c.holes.length} holes · Par ${par}${p.best[c.id] ? ` · Best ${p.best[c.id]}` : ''}`,
        ),
        h(
          'div',
          { class: 'cc-stars' },
          ...stars.map((s, i) =>
            h(
              'span',
              { class: s ? 'on' : '', title: ['Complete', 'Par or better', 'All gems & golden ball'][i] },
              '★',
            ),
          ),
        ),
        !unlocked ? h('div', { class: 'cc-lock' }, `🔒 Level ${gate.level} or ${gate.stars} ⭐`) : null,
      );
    });
    this.game.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header(title, () => this.mainMenu()),
        h('div', { class: 'course-grid' }, ...cards),
      ),
    );
  }

  // ------------------------------------------------------------------------------------------
  // Multiplayer
  // ------------------------------------------------------------------------------------------

  multiplayer(): void {
    const g = this.game;
    if (g.room) return g.returnToLobby();
    const code = h('input', {
      class: 'text code-input',
      maxlength: 6,
      placeholder: 'ABC123',
      autocapitalize: 'characters',
      spellcheck: false,
    });
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    const join = () =>
      code.value.length === 6
        ? void g.joinRoom(code.value)
        : g.ui.toast('Room codes have 6 characters', 'bad');
    code.addEventListener('keydown', (e) => e.key === 'Enter' && join());
    const lan = !!window.pppNative?.startLanServer;
    g.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header('Play with Friends', () => this.mainMenu()),
        h('h3', { class: 'section-title' }, '🔗 Direct connection — no server needed'),
        h(
          'div',
          { class: 'mp-grid' },
          h(
            'div',
            { class: 'panel mp-card' },
            h('h3', {}, '🏠 Host a direct game'),
            h('p', { class: 'muted' }, 'The game runs on your device. Send each friend an invite code (up to 5 friends), they send back a reply code. Works across the internet and on the same Wi-Fi.'),
            h('button', { class: 'btn primary big', onclick: () => void g.hostDirect() }, 'Host direct game'),
          ),
          h(
            'div',
            { class: 'panel mp-card' },
            h('h3', {}, '📨 Join with an invite code'),
            h('p', { class: 'muted' }, 'Paste the invite code your host sent you.'),
            h('button', { class: 'btn primary big', onclick: () => this.joinDirect() }, 'Enter invite code'),
          ),
          h(
            'div',
            { class: 'panel mp-card' },
            h('h3', {}, '📡 Local network'),
            h('p', { class: 'muted' }, lan ? "Host on this computer's network, or join a host by its address." : "Join a friend's desktop game by its network address."),
            lan ? h('button', { class: 'btn big', onclick: () => void g.hostLan() }, 'Host on local network') : null,
            h('button', { class: 'btn', onclick: () => this.joinAddress() }, 'Join by address'),
          ),
        ),
        h('h3', { class: 'section-title' }, '🌍 Online server'),
        h(
          'div',
          { class: 'mp-grid' },
          h(
            'div',
            { class: 'panel mp-card' },
            h('h3', {}, '🏠 Create a room'),
            h('p', { class: 'muted' }, 'Uses the online game server. Share the 6-letter code with up to 5 friends.'),
            h('button', { class: 'btn big', onclick: () => void g.createRoom() }, 'Create room'),
          ),
          h(
            'div',
            { class: 'panel mp-card' },
            h('h3', {}, '🔑 Join a room'),
            h('p', { class: 'muted' }, 'Enter the room code your friend gave you.'),
            h('div', { class: 'row' }, code, h('button', { class: 'btn primary', onclick: join }, 'Join')),
          ),
        ),
        h(
          'div',
          { class: 'panel mp-modes' },
          ...(['relay', 'parallel', 'versus', 'hopper'] as const).map((m) =>
            h('div', {}, h('b', {}, MODE_INFO[m].label), ' — ', MODE_INFO[m].desc),
          ),
        ),
      ),
    );
  }

  /** Copy + (on phones) share-sheet buttons for a code. */
  private codeBox(code: string, label: string): HTMLElement {
    const ta = h('textarea', { class: 'code-box', readonly: true, rows: 3, spellcheck: false }, code);
    ta.addEventListener('focus', () => ta.select());
    const copy = async () => {
      // Copy exactly the code text (no formatting): the desktop app uses the OS clipboard;
      // browsers copy the selected textarea, the same path as selecting it and pressing Cmd/Ctrl+C.
      const text = code.trim();
      try {
        if (window.pppNative?.copyText) await window.pppNative.copyText(text);
        else {
          ta.focus();
          ta.select();
          ta.setSelectionRange(0, ta.value.length);
          let ok = false;
          try {
            ok = document.execCommand('copy');
          } catch {
            ok = false;
          }
          if (!ok) {
            if (!navigator.clipboard) throw new Error('no clipboard');
            await navigator.clipboard.writeText(text);
          }
        }
        this.game.ui.toast('Copied!', 'good');
      } catch {
        ta.focus();
        ta.select();
        this.game.ui.toast('Press Ctrl/Cmd+C to copy');
      }
    };
    return h(
      'div',
      { class: 'code-wrap' },
      ta,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small primary', onclick: () => void copy() }, '📋 Copy'),
        typeof navigator.share === 'function'
          ? h('button', { class: 'btn small', onclick: () => void navigator.share({ title: 'Putt-Putt Planet', text: `${label}\n${code}` }).catch(() => undefined) }, '📤 Share')
          : null,
      ),
    );
  }

  /** Guest flow for a direct game: paste invite -> send back reply -> wait for the host. */
  joinDirect(): void {
    const g = this.game;
    const input = h('textarea', { class: 'code-box', rows: 4, placeholder: 'PPP2…', spellcheck: false });
    const step2 = h('div', { class: 'join-step2' });
    const go = h('button', { class: 'btn primary big' }, 'Next ▶');
    go.onclick = async () => {
      go.setAttribute('disabled', '');
      go.textContent = 'Preparing…';
      try {
        const { reply, hostName, connected } = await g.joinDirect(input.value);
        clear(step2);
        step2.append(
          h('h3', {}, `Step 2 — send this reply code back to ${hostName}`),
          this.codeBox(reply, 'My Putt-Putt Planet reply code (paste it in your invite):'),
          h('div', { class: 'waiting' }, h('div', { class: 'spinner small' }), `Waiting for ${hostName} to paste your reply code… keep this screen open`),
        );
        go.textContent = 'Code ready';
        await connected;
      } catch (e) {
        go.removeAttribute('disabled');
        go.textContent = 'Next ▶';
        g.ui.toast((e as Error).message, 'bad', 5000);
      }
    };
    g.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header('Join a direct game', () => this.multiplayer()),
        h('div', { class: 'panel join-direct' }, h('h3', {}, 'Step 1 — paste the invite code from your host'), input, go, step2),
        h('p', { class: 'muted center small on-dark' }, 'Your devices connect directly to each other. If it fails on different networks, try the same Wi-Fi.'),
      ),
    );
  }

  joinAddress(): void {
    const g = this.game;
    const addr = h('input', { class: 'text', placeholder: '192.168.1.20', spellcheck: false, value: localStorage.getItem('ppp.lastAddress') ?? '' });
    const code = h('input', { class: 'text code-input', maxlength: 6, placeholder: 'ABC123', autocapitalize: 'characters', spellcheck: false });
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    const go = () => {
      if (!addr.value.trim() || code.value.length !== 6) return g.ui.toast('Enter the address and the 6-letter room code', 'bad');
      try {
        localStorage.setItem('ppp.lastAddress', addr.value.trim());
      } catch {
        /* ignore */
      }
      void g.joinAddress(addr.value, code.value);
    };
    g.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header('Join by address', () => this.multiplayer()),
        h(
          'div',
          { class: 'panel join-direct' },
          h('p', { class: 'muted' }, "Your host's desktop game shows its address and room code in the lobby."),
          h('label', { class: 'setting' }, h('span', {}, 'Host address'), addr),
          h('label', { class: 'setting' }, h('span', {}, 'Room code'), code),
          h('button', { class: 'btn primary big', onclick: go }, 'Join ▶'),
        ),
      ),
    );
  }

  private invitePanelEl: HTMLElement | null = null;
  private invitePanelHost: LocalHost | null = null;

  /** Host-side invite manager for direct games (persistent across lobby refreshes). */
  private invitePanel(host: LocalHost): HTMLElement {
    if (this.invitePanelEl && this.invitePanelHost === host) return this.invitePanelEl;
    const g = this.game;
    const list = h('div', { class: 'invites' });
    const rows = new Map<number, HTMLElement>();
    const render = () => {
      for (const inv of host.invites()) {
        let row = rows.get(inv.id);
        if (!row) {
          row = h('div', { class: 'invite' });
          rows.set(inv.id, row);
          list.prepend(row);
        }
        if (row.dataset.state === inv.state && row.dataset.code === String(!!inv.code)) continue;
        row.dataset.state = inv.state;
        row.dataset.code = String(!!inv.code);
        clear(row);
        const title = h('div', { class: 'invite-title' }, `Invite #${inv.id}`, inv.name ? ` — ${inv.name}` : '');
        if (inv.state === 'waiting') {
          const reply = h('textarea', { class: 'code-box', rows: 2, placeholder: "Paste your friend's reply code", spellcheck: false });
          const ok = h('button', { class: 'btn small primary' }, 'Connect');
          ok.onclick = () => host.acceptReply(inv.id, reply.value).catch((e: Error) => g.ui.toast(e.message, 'bad', 5000));
          row.append(
            title,
            h('div', { class: 'small muted' }, '1. Send this invite code to one friend:'),
            this.codeBox(inv.code, "Join my Putt-Putt Planet game! Open the game → Play with Friends → Enter invite code, and paste:"),
            h('div', { class: 'small muted' }, '2. Paste the reply code they send back:'),
            h('div', { class: 'row' }, reply, ok),
          );
        } else if (inv.state === 'connecting') row.append(title, h('div', { class: 'waiting' }, h('div', { class: 'spinner small' }), 'Connecting… (can take up to a minute)'));
        else if (inv.state === 'connected') row.append(title, h('div', { class: 'ok' }, `✓ Connected${inv.name ? `: ${inv.name}` : ''}`));
        else
          row.append(
            title,
            h('div', { class: 'bad' }, inv.state === 'failed' ? "Couldn't connect. Make sure your friend kept the join screen open, then create a new invite. Some networks (mobile hotspots, school/office Wi-Fi) block direct links." : 'Disconnected'),
            h('button', { class: 'btn small', onclick: () => { host.cancelInvite(inv.id); rows.get(inv.id)?.remove(); rows.delete(inv.id); } }, 'Remove'),
          );
      }
    };
    host.bus.on('invites', render);
    const create = h('button', { class: 'btn primary' }, '➕ Create invite code');
    create.onclick = async () => {
      create.setAttribute('disabled', '');
      create.textContent = 'Creating…';
      try {
        await host.createInvite();
      } catch (e) {
        g.ui.toast((e as Error).message, 'bad');
      } finally {
        create.removeAttribute('disabled');
        create.textContent = '➕ Create invite code';
      }
    };
    this.invitePanelEl = h(
      'div',
      { class: 'panel invite-panel' },
      h('h3', {}, '🔗 Direct game — you are the host'),
      h('p', { class: 'muted small' }, 'One invite code per friend. Keep this game open while you play: it is the server.'),
      create,
      list,
    );
    this.invitePanelHost = host;
    return this.invitePanelEl;
  }

  /** True while a lobby sub-screen (the locker) is open: room updates must not replace it. */
  inLobbySub = false;

  /** What the lobby on screen was drawn from (everything except pings). */
  private lobbyKey = '';
  private lastReadyClick = 0;

  /** A message that stays until dismissed (e.g. "the host removed you"). */
  notice(title: string, text: string): void {
    const g = this.game;
    g.ui.showOverlay(
      h(
        'div',
        { class: 'modal notice' },
        h('h2', {}, title),
        h('p', { class: 'center' }, text),
        h('button', { class: 'btn primary', onclick: () => g.ui.showOverlay(null) }, 'OK'),
      ),
    );
  }

  /** Host only: ask before removing a player. `back` re-opens whatever was underneath. */
  private confirmKick(id: string, name: string, back?: () => void): void {
    const g = this.game;
    const close = () => (back ? back() : g.ui.showOverlay(null));
    g.ui.showOverlay(
      h(
        'div',
        { class: 'modal notice' },
        h('h2', {}, `Remove ${name}?`),
        h('p', { class: 'center muted' }, 'They will be disconnected from this game.'),
        h(
          'div',
          { class: 'row' },
          h(
            'button',
            {
              class: 'btn danger',
              onclick: () => {
                g.net.send({ t: 'kick', id });
                close();
              },
            },
            '✕ Remove',
          ),
          h('button', { class: 'btn', onclick: close }, 'Cancel'),
        ),
      ),
    );
  }

  /** Pause menu (online host): the players, each with a Remove button. */
  private playersModal(): void {
    const g = this.game;
    const room = g.room;
    if (!room) return this.pause();
    const me = g.profile.profile.id;
    g.ui.showOverlay(
      h(
        'div',
        { class: 'modal' },
        h('h2', {}, 'Players'),
        ...room.players.map((p) =>
          h(
            'div',
            { class: 'kick-row' },
            h('span', {}, p.id === room.hostId ? '👑 ' : '', p.name, p.connected ? '' : ' (reconnecting…)'),
            p.id !== me
              ? h('button', { class: 'btn small danger', onclick: () => this.confirmKick(p.id, p.name, () => this.playersModal()) }, '✕ Remove')
              : h('small', { class: 'muted' }, 'you'),
          ),
        ),
        h('button', { class: 'btn', onclick: () => this.pause() }, 'Back'),
      ),
    );
  }

  lobby(): void {
    const g = this.game;
    this.inLobbySub = false;
    const room = g.room;
    if (!room) return this.multiplayer();
    const me = g.profile.profile.id;
    const isHost = room.hostId === me;
    const meP = room.players.find((p) => p.id === me);
    // The host re-sends the room every few seconds (fresh pings). Rebuilding the whole screen each
    // time swallowed clicks that straddled a rebuild and closed open menus, so when nothing but
    // the pings changed, just update those in place.
    const key = JSON.stringify([
      { ...room, players: room.players.map((p) => ({ ...p, ping: 0 })) },
      me,
      g.net.kind,
      g.lanAddresses,
      !!g.localHost,
      this.p.level,
      starsTotal(this.p),
    ]);
    const shown = g.ui.screenLayer.querySelector('.screen.lobby');
    if (shown && key === this.lobbyKey) {
      shown.querySelectorAll<HTMLElement>('.lp-ping').forEach((el, i) => {
        const p = room.players[i];
        if (p) el.textContent = p.connected ? `${p.ping} ms` : 'reconnecting…';
      });
      return;
    }
    this.lobbyKey = key;
    const course = COURSES.find((c) => c.id === room.courseId) ?? COURSES[0];
    const link = `${location.origin}${location.pathname}?join=${room.code}`;
    const players = h(
      'div',
      { class: 'lobby-players' },
      ...room.players.map((p) => {
        const ball = COSMETIC_BY_ID.get(p.loadout.ball ?? '');
        const hat = COSMETIC_BY_ID.get(p.loadout.hat ?? '');
        return h(
          'div',
          { class: `lp ${p.connected ? '' : 'dc'} ${p.id === me ? 'me' : ''}` },
          h('i', { class: 'swatch big', style: `background:${ball?.color ?? '#fff'}` }),
          h(
            'div',
            { class: 'lp-name' },
            p.id === room.hostId ? '👑 ' : '',
            p.name,
            h('small', {}, ` Lv ${p.level}${hat && hat.id !== 'hat.none' ? ` · ${hat.name}` : ''}`),
          ),
          h('div', { class: 'lp-ping' }, p.connected ? `${p.ping} ms` : 'reconnecting…'),
          h(
            'div',
            { class: `lp-ready ${p.ready || p.id === room.hostId ? 'on' : ''}` },
            p.id === room.hostId ? 'Host' : p.ready ? 'Ready ✓' : 'Not ready',
          ),
          // Host only, and never on the host's own card.
          isHost && p.id !== me
            ? h(
                'button',
                { class: 'btn small danger lp-kick', title: `Remove ${p.name} from the game`, onclick: () => this.confirmKick(p.id, p.name) },
                '✕ Remove',
              )
            : null,
        );
      }),
      ...Array.from({ length: RULES.maxPlayers - room.players.length }, () =>
        h('div', { class: 'lp empty' }, 'Waiting for a friend…'),
      ),
    );
    const hopper = room.mode === 'hopper';
    const modeBtns = (['relay', 'parallel', 'versus', 'hopper'] as const).map((m) =>
      h(
        'button',
        {
          class: `btn mode ${room.mode === m ? 'selected' : ''}`,
          disabled: !isHost,
          onclick: () => g.net.send({ t: 'configure', courseId: room.courseId, mode: m, chaos: room.chaos }),
        },
        h('b', {}, MODE_INFO[m].label),
        h('small', {}, MODE_INFO[m].desc),
      ),
    );
    const courseSel = h(
      'select',
      {
        disabled: !isHost,
        onchange: (e: Event) =>
          g.net.send({
            t: 'configure',
            courseId: (e.target as HTMLSelectElement).value,
            mode: room.mode as 'relay',
            chaos: room.chaos,
          }),
      },
      ...COURSES.map((c) =>
        h(
          'option',
          { value: c.id, selected: c.id === room.courseId, disabled: !worldUnlocked(this.p, c.world) },
          `${WORLD_EMOJI[c.world] ?? ''} ${c.name}${worldUnlocked(this.p, c.world) ? '' : ' 🔒'}`,
        ),
      ),
    );
    const chaos = h(
      'label',
      { class: 'setting' },
      h('span', {}, '💥 Chaos mode (balls collide)'),
      h('input', {
        type: 'checkbox',
        checked: room.chaos,
        disabled: !isHost || room.mode === 'relay' || hopper,
        onchange: (e: Event) =>
          g.net.send({
            t: 'configure',
            courseId: room.courseId,
            mode: room.mode as 'relay',
            chaos: (e.target as HTMLInputElement).checked,
          }),
      }),
    );
    const allReady = room.players.every((p) => p.id === room.hostId || p.ready || !p.connected);
    const refresh = !!g.ui.screenLayer.querySelector('.screen.lobby');
    g.ui.showScreen(
      h(
        'div',
        { class: 'screen lobby' },
        this.header('Lobby', () => g.leaveOnline()),
        g.localHost
          ? this.invitePanel(g.localHost)
          : h(
              'div',
              { class: 'room-code panel' },
              h('div', { class: 'muted' }, g.lanAddresses.length ? 'Local network game — friends use "Join by address"' : 'Room code'),
              h('div', { class: 'code' }, room.code),
              g.lanAddresses.length
                ? h('div', { class: 'lan-addr' }, 'Address: ', h('b', {}, g.lanAddresses.join('  or  ')))
                : g.net.kind === 'peer'
                  ? h('div', { class: 'muted small' }, 'Direct game')
                  : h(
                      'button',
                      {
                        class: 'btn small',
                        onclick: () => {
                          void navigator.clipboard?.writeText(link).then(
                            () => g.ui.toast('Invite link copied!', 'good'),
                            () => g.ui.toast(link),
                          );
                        },
                      },
                      '🔗 Copy invite link',
                    ),
            ),
        players,
        h(
          'div',
          { class: 'panel lobby-config' },
          h('h3', {}, isHost ? 'Game settings' : 'Game settings (host decides)'),
          hopper ? null : h('label', { class: 'setting' }, h('span', {}, 'Course'), courseSel),
          h('div', { class: 'modes' }, ...modeBtns),
          hopper ? null : chaos,
          h(
            'div',
            { class: 'muted' },
            hopper
              ? `🪐 ${SKELETON.length} procedurally generated stages across 4 planets · shared hearts · the host's Clubhouse upgrades apply, and everyone's keepsake joins the team`
              : `${course.holes.length} holes · Par ${course.holes.reduce((a, x) => a + x.par, 0)}`,
          ),
        ),
        // Pinned to the bottom of the window: on short windows (laptops with display scaling) the
        // Ready button used to sit below the fold, where a guest could miss it entirely.
        h(
          'div',
          { class: 'row center lobby-actions' },
          isHost
            ? h(
                'button',
                { class: 'btn primary big', disabled: !allReady, onclick: () => g.net.send({ t: 'start' }) },
                allReady ? '▶ Start game' : 'Waiting for players to ready up…',
              )
            : h(
                'button',
                {
                  class: `btn big ready-btn ${meP?.ready ? '' : 'primary'}`,
                  onclick: () => {
                    // Decide from the room as it is now (not as it was when this button was drawn),
                    // and ignore the second half of a double-click so it can't undo the first.
                    const now = performance.now();
                    if (now - this.lastReadyClick < 400) return;
                    this.lastReadyClick = now;
                    const cur = g.room?.players.find((p) => p.id === g.profile.profile.id);
                    const ready = !cur?.ready;
                    console.info(`[lobby] ready -> ${ready} (link ${g.net.status}, in room: ${!!cur})`);
                    if (g.net.status !== 'online') g.ui.toast('Not connected to the host — leave and join again', 'bad', 4000);
                    g.net.send({ t: 'ready', ready });
                  },
                },
                meP?.ready ? 'Not ready' : '✓ Ready!',
              ),
          h('button', { class: 'btn', onclick: () => {
            this.locker(() => g.returnToLobby());
            this.inLobbySub = true;
          } }, '🎽 Locker'),
        ),
      ),
      !refresh,
    );
  }

  // ------------------------------------------------------------------------------------------
  // Daily challenge
  // ------------------------------------------------------------------------------------------

  private dailyBoardEl: HTMLElement | null = null;

  daily(): void {
    const g = this.game;
    const course = dailyCourse();
    const hole = course.holes[0];
    this.dailyBoardEl = h(
      'div',
      { class: 'daily-board' },
      h('div', { class: 'muted' }, 'Loading leaderboard…'),
    );
    g.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header('Daily Challenge', () => this.mainMenu()),
        h(
          'div',
          { class: 'panel daily-card' },
          h('div', { class: 'daily-date' }, `📅 ${dateKey()}`),
          h(
            'div',
            {},
            `${WORLD_EMOJI[course.world] ?? ''} A brand new hole every day · Par ${hole.par} · ${hole.obstacles.length} obstacles`,
          ),
          this.p.daily.date === dateKey() && this.p.daily.best !== null
            ? h('div', {}, `Your best today: ${this.p.daily.best} strokes`)
            : null,
          h(
            'button',
            { class: 'btn primary big', onclick: () => void g.startDaily() },
            '⛳ Play today’s hole',
          ),
        ),
        h('div', { class: 'panel' }, h('h3', {}, '🏆 Today’s leaderboard'), this.dailyBoardEl),
      ),
    );
    void g.connect().then(
      () => g.net.send({ t: 'dailyBoard' }),
      () =>
        this.dailyBoardEl &&
        (clear(this.dailyBoardEl),
        this.dailyBoardEl.append(
          h(
            'div',
            { class: 'muted' },
            'Server offline — leaderboard unavailable. You can still play locally.',
          ),
        )),
    );
  }

  onDailyBoard(): void {
    const b = this.game.dailyBoard;
    if (!b || !this.dailyBoardEl || !this.dailyBoardEl.isConnected) return;
    clear(this.dailyBoardEl);
    if (!b.entries.length)
      this.dailyBoardEl.append(h('div', { class: 'muted' }, 'No scores yet today. Be the first!'));
    b.entries.forEach((e, i) =>
      this.dailyBoardEl!.append(
        h(
          'div',
          { class: `board-row ${e.id === this.p.id ? 'me' : ''}` },
          h('span', {}, ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`),
          h('span', { class: 'nm' }, e.name),
          h('b', {}, `${e.strokes} (${relScore(e.strokes, b.par)})`),
        ),
      ),
    );
  }
  // ------------------------------------------------------------------------------------------
  // Locker & shop
  // ------------------------------------------------------------------------------------------

  locker(back: () => void = () => this.mainMenu(), slot: CosmeticSlot = 'ball'): void {
    const g = this.game;
    const preview = new LockerPreview();
    preview.setLoadout(g.profile.loadout());
    preview.focus(slot);
    const tryLabel = h('div', { class: 'try-label hidden' });
    const showTry = (name: string | null) => {
      tryLabel.classList.toggle('hidden', !name);
      if (name) tryLabel.textContent = `Trying on: ${name}`;
    };
    const grid = h('div', { class: 'item-grid' });
    const tabs = h('div', { class: 'tabs' });
    const coinsEl = h('div', { class: 'locker-coins' });
    let current = slot;
    const unlockText = (c: Cosmetic): string => {
      switch (c.unlock.type) {
        case 'level':
          return `Reach level ${c.unlock.level}`;
        case 'shop':
          return `${c.unlock.price} 🪙`;
        case 'achievement':
          return `🏅 ${achievementName(c.unlock.id)}`;
        case 'crate':
          return '🎁 Mystery crates';
        default:
          return '';
      }
    };
    const render = () => {
      const p = this.p;
      coinsEl.textContent = `🪙 ${p.coins}`;
      clear(tabs);
      for (const sl of Object.keys(SLOT_LABELS) as CosmeticSlot[])
        tabs.append(
          h(
            'button',
            {
              class: `btn small tab ${sl === current ? 'selected' : ''}`,
              onclick: () => {
                current = sl;
                preview.setLoadout(g.profile.loadout());
                preview.focus(sl);
                showTry(null);
                render();
              },
            },
            SLOT_LABELS[sl],
          ),
        );
      clear(grid);
      const loadout = g.profile.loadout();
      for (const c of COSMETICS.filter((x) => x.slot === current)) {
        const owned = isOwned(p, c.id);
        const equipped = loadout[c.slot] === c.id;
        const canBuy = !owned && c.unlock.type === 'shop' && p.coins >= c.unlock.price;
        const card = h(
          'button',
          {
            class: `item ${owned ? 'owned' : 'locked'} ${equipped ? 'equipped' : ''}`,
            onclick: () => {
              if (owned) {
                g.profile.equip(c.slot, c.id);
                preview.setLoadout(g.profile.loadout());
                preview.play(c.slot, c.id);
                showTry(null);
                render();
              } else if (c.unlock.type === 'shop') {
                if (!canBuy) return g.ui.toast('Not enough coins yet — collect more on the courses!', 'bad');
                if (!confirm(`Buy ${c.name} for ${c.unlock.price} coins?`)) return;
                const err = g.profile.buy(c.id);
                if (err) return g.ui.toast(err, 'bad');
                audio.ui('buy');
                g.profile.equip(c.slot, c.id);
                preview.setLoadout(g.profile.loadout());
                preview.play(c.slot, c.id);
                showTry(null);
                g.ui.toast(`Unlocked ${c.name}!`, 'good');
                render();
              } else {
                // Try it on without owning it.
                preview.setLoadout({ ...g.profile.loadout(), [c.slot]: c.id });
                preview.play(c.slot, c.id);
                showTry(c.name);
              }
            },
          },
          h('i', {
            class: `swatch big pat-${c.pattern ?? 'solid'}`,
            style: `background:${c.pattern === 'rainbow' ? 'linear-gradient(90deg,#ff5252,#ffeb3b,#69f0ae,#40c4ff,#e040fb)' : c.color2 ? `linear-gradient(135deg, ${c.color} 50%, ${c.color2} 50%)` : c.color}`,
          }),
          h('div', { class: 'item-name' }, c.name),
          h('div', { class: 'item-sub' }, equipped ? '✓ Equipped' : owned ? 'Owned' : unlockText(c)),
        );
        grid.append(card);
      }
    };
    render();
    g.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header('Locker & Shop', back),
        h(
          'div',
          { class: 'locker' },
          h(
            'div',
            { class: 'panel locker-preview' },
            h('div', { class: 'locker-stage' }, preview.canvas, tryLabel),
            h('button', { class: 'btn small', onclick: () => preview.replay() }, '▶ Replay effect'),
            coinsEl,
            h('div', { class: 'muted small' }, 'Click an item to equip it. Locked items can be tried on.'),
          ),
          h('div', { class: 'locker-items' }, tabs, grid),
        ),
      ),
    );
    // Register cleanup only after the screen is shown: showScreen() runs pending leave hooks,
    // so registering earlier disposed this preview immediately (blank preview bug).
    g.ui.onLeave(() => preview.dispose());
  }

  // ------------------------------------------------------------------------------------------
  // Collection
  // ------------------------------------------------------------------------------------------

  collection(): void {
    const p = this.p;
    const found = new Set(p.collected);
    const worlds = COURSES.map((c) => {
      const items = c.holes.flatMap((hole, i) =>
        hole.collectibles
          .filter((x) => x.kind === 'gem' || x.kind === 'golden')
          .map((x) => ({ x, hole: i + 1 })),
      );
      const n = items.filter((i) => found.has(i.x.id)).length;
      return h(
        'div',
        { class: 'panel coll-world' },
        h(
          'div',
          { class: 'coll-head' },
          h('b', {}, `${WORLD_EMOJI[c.world] ?? ''} ${c.name}`),
          h('span', {}, `${n}/${items.length}`),
        ),
        h(
          'div',
          { class: 'coll-grid' },
          ...items.map(({ x, hole }) => {
            const have = found.has(x.id);
            return h(
              'div',
              {
                class: `coll ${have ? 'have' : 'missing'} ${x.kind}`,
                title: have
                  ? `${x.kind === 'golden' ? 'Golden ball' : 'Gem'} — hole ${hole}`
                  : `Somewhere on hole ${hole}…`,
              },
              h('span', { class: 'ico' }, x.kind === 'golden' ? '🏆' : '💎'),
              h('small', {}, `H${hole}`),
            );
          }),
        ),
      );
    });
    const owned = COSMETICS.filter((c) => isOwned(p, c.id)).length;
    this.game.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header('Collection', () => this.mainMenu()),
        h(
          'div',
          { class: 'panel coll-summary' },
          h('span', {}, `💎 Gems ${p.stats.gemsFound}`),
          h('span', {}, `🏆 Golden balls ${p.stats.goldenFound}`),
          h('span', {}, `🪙 Coins picked up ${p.stats.coinsFound}`),
          h('span', {}, `🎁 Crates ${p.stats.cratesOpened}`),
          h('span', {}, `🎽 Cosmetics ${owned}/${COSMETICS.length}`),
        ),
        ...worlds,
      ),
    );
  }

  // ------------------------------------------------------------------------------------------
  // Profile & achievements
  // ------------------------------------------------------------------------------------------

  profileScreen(): void {
    const p = this.p;
    const st = p.stats;
    const mins = Math.round(st.playtimeSec / 60);
    const stat = (label: string, v: string | number) =>
      h('div', { class: 'stat' }, h('b', {}, String(v)), h('span', {}, label));
    const achs = ACHIEVEMENTS.map((a) => {
      const have = p.achievements.includes(a.id);
      return h(
        'div',
        { class: `ach ${have ? 'have' : ''}` },
        h('div', { class: 'ach-ico' }, a.icon),
        h('div', {}, h('b', {}, a.name), h('div', { class: 'muted small' }, a.desc)),
      );
    });
    this.game.ui.showScreen(
      h(
        'div',
        { class: 'screen' },
        this.header('Profile', () => this.mainMenu()),
        h(
          'div',
          { class: 'panel stats-grid' },
          stat('Level', p.level),
          stat('Stars', starsTotal(p)),
          stat('Holes played', st.holes),
          stat('Strokes', st.strokes),
          stat('Holes-in-one', st.holesInOne),
          stat('Under par holes', st.underPar),
          stat('Courses finished', st.coursesCompleted),
          stat('Co-op courses', st.coopCourses),
          stat('Splashes / OOB', st.waterHits),
          stat('Bank shots', st.bankShots),
          stat('Playtime', `${mins} min`),
          stat('Achievements', `${p.achievements.length}/${ACHIEVEMENTS.length}`),
        ),
        h('div', { class: 'ach-grid' }, ...achs),
        h(
          'div',
          { class: 'muted center small' },
          `Guest ID ${p.id} — progress is saved on this device and synced to the server when you play online.`,
        ),
      ),
    );
  }

  // ------------------------------------------------------------------------------------------

  pause(): void {
    const g = this.game;
    const online = g.scene?.session.kind === 'remote';
    g.ui.showOverlay(
      h(
        'div',
        { class: 'modal pause' },
        h('h2', {}, 'Paused'),
        online ? h('p', { class: 'muted' }, 'The game keeps running for your friends.') : null,
        h('button', { class: 'btn primary', onclick: () => g.togglePause(false) }, '▶ Resume'),
        g.scene
          ? h(
              'button',
              {
                class: 'btn',
                onclick: () =>
                  g.scene &&
                  g.ui.showOverlay(
                    h(
                      'div',
                      { class: 'modal wide' },
                      scorecard(g.scene.session.course, g.scene.session.score(), g.scene.session.players()),
                      h('button', { class: 'btn', onclick: () => this.pause() }, 'Back'),
                    ),
                  ),
              },
              '📋 Scorecard',
            )
          : null,
        h('button', { class: 'btn', onclick: () => this.settings(() => this.pause(), true) }, '⚙️ Settings'),
        online && g.room && g.room.hostId === g.profile.profile.id && g.room.players.length > 1
          ? h('button', { class: 'btn', onclick: () => this.playersModal() }, '👥 Players')
          : null,
        h(
          'button',
          { class: 'btn danger', onclick: () => (online ? this.game.leaveOnline() : g.goMenu()) },
          online ? '🚪 Leave game' : '🏠 Quit to menu',
        ),
      ),
    );
  }

  settings(back: () => void, asOverlay = false): void {
    const g = this.game;
    const s = g.settings;
    const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'camSensitivity', min = 0, max = 1) =>
      h(
        'label',
        { class: 'setting' },
        h('span', {}, label),
        h('input', {
          type: 'range',
          min,
          max,
          step: 0.05,
          value: s[key],
          oninput: (e: Event) => {
            s[key] = Number((e.target as HTMLInputElement).value);
            g.applySettings();
          },
        }),
      );
    const select = <K extends 'quality' | 'palette'>(label: string, key: K, opts: [Settings[K], string][]) =>
      h(
        'label',
        { class: 'setting' },
        h('span', {}, label),
        h(
          'select',
          {
            onchange: (e: Event) => {
              (s[key] as string) = (e.target as HTMLSelectElement).value;
              g.applySettings();
            },
          },
          ...opts.map(([v, l]) => h('option', { value: v, selected: s[key] === v }, l)),
        ),
      );
    const toggle = (label: string, key: 'reducedMotion' | 'invertY' | 'showFps') =>
      h(
        'label',
        { class: 'setting' },
        h('span', {}, label),
        h('input', {
          type: 'checkbox',
          checked: s[key],
          onchange: (e: Event) => {
            s[key] = (e.target as HTMLInputElement).checked;
            g.applySettings();
          },
        }),
      );
    const keys = h('div', { class: 'keymap' });
    const renderKeys = () => {
      clear(keys);
      for (const a of Object.keys(ACTION_LABELS) as Action[]) {
        const btn = h('button', { class: 'btn small key' }, keyLabel(s.keys[a]));
        btn.onclick = () => {
          btn.textContent = 'Press a key…';
          const onKey = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            window.removeEventListener('keydown', onKey, true);
            if (e.code !== 'Escape') {
              // swap if already bound
              for (const other of Object.keys(s.keys) as Action[])
                if (s.keys[other] === e.code) s.keys[other] = s.keys[a];
              s.keys[a] = e.code;
              g.applySettings();
            }
            renderKeys();
          };
          window.addEventListener('keydown', onKey, true);
        };
        keys.append(h('div', { class: 'keyrow' }, h('span', {}, ACTION_LABELS[a]), btn));
      }
      keys.append(
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              s.keys = { ...DEFAULT_KEYS };
              g.applySettings();
              renderKeys();
            },
          },
          'Reset keys',
        ),
      );
    };
    renderKeys();
    const name = h('input', { class: 'text', value: this.p.name, maxlength: 20 });
    name.addEventListener('change', () => g.profile.setName(name.value));
    const body = h(
      'div',
      { class: 'settings-grid' },
      h(
        'div',
        { class: 'col' },
        h('h3', {}, 'Player'),
        h('label', { class: 'setting' }, h('span', {}, 'Display name'), name),
        h('h3', {}, 'Audio'),
        slider('Master volume', 'master'),
        slider('Music', 'music'),
        slider('Sound effects', 'sfx'),
        h('h3', {}, 'Graphics'),
        this.displayModeSetting(),
        select('Quality', 'quality', [
          ['low', 'Low (mobile)'],
          ['medium', 'Medium'],
          ['high', 'High'],
          ['ultra', 'Ultra'],
        ]),
        toggle('Show FPS', 'showFps'),
        h('h3', {}, 'Accessibility'),
        toggle('Reduced motion', 'reducedMotion'),
        select('Aim colours', 'palette', [
          ['default', 'Default'],
          ['colorblind', 'Colour-blind friendly'],
          ['contrast', 'High contrast'],
        ]),
        slider('Camera sensitivity', 'camSensitivity', 0.3, 2),
        toggle('Invert camera Y', 'invertY'),
      ),
      h('div', { class: 'col' }, h('h3', {}, 'Controls (click to remap)'), keys),
    );
    const el = h('div', { class: asOverlay ? 'modal wide' : 'screen' }, this.header('Settings', back), body);
    if (asOverlay) g.ui.showOverlay(el);
    else g.ui.showScreen(el);
  }

  /** Windowed / fullscreen (borderless) picker: desktop app via the shell, browsers via the Fullscreen API. */
  private displayModeSetting(): HTMLElement {
    const native = window.pppNative;
    const sel = h(
      'select',
      {},
      h('option', { value: 'windowed' }, 'Windowed'),
      h('option', { value: 'fullscreen' }, native ? 'Fullscreen (borderless)' : 'Fullscreen'),
    ) as HTMLSelectElement;
    const sync = (mode: string) => (sel.value = mode);
    if (native?.getDisplayMode) void native.getDisplayMode().then(sync);
    else sync(document.fullscreenElement ? 'fullscreen' : 'windowed');
    sel.onchange = async () => {
      const mode = sel.value === 'fullscreen' ? 'fullscreen' : 'windowed';
      try {
        if (native?.setDisplayMode) sync(await native.setDisplayMode(mode));
        else if (mode === 'fullscreen') await document.documentElement.requestFullscreen();
        else if (document.fullscreenElement) await document.exitFullscreen();
      } catch {
        sync(document.fullscreenElement ? 'fullscreen' : 'windowed');
        this.game.ui.toast('Fullscreen is not available here', 'bad');
      }
    };
    return h(
      'label',
      { class: 'setting', title: 'Shortcut: F11 or Alt+Enter' },
      h('span', {}, 'Display (F11)'),
      sel,
    );
  }

  // ------------------------------------------------------------------------------------------

  results(
    course: Course,
    score: ScoreState,
    players: SessionPlayer[],
    grant: Grant | null,
    online: boolean,
    isDaily = false,
  ): void {
    if (score.hopper) return this.hopperResults(score, players, grant, online);
    const g = this.game;
    const me = g.profile.profile.id;
    const entrant = score.mode === 'relay' ? 'team' : me;
    const card = score.card[entrant] ?? [];
    const total = card.reduce<number>((a, b) => a + (b ?? 0), 0);
    const par = score.pars.reduce((a, b) => a + b, 0);
    const starsEl = h(
      'div',
      { class: 'res-stars' },
      ...[0, 1, 2].map((i) =>
        h('span', { class: 'star', title: ['Complete', 'Par or better', 'All gems & golden ball'][i] }, '★'),
      ),
    );
    const xpNum = h('b', {}, '0');
    const coinNum = h('b', {}, '0');
    const levelEl = h('div', { class: 'lvl big' }, String(grant?.startLevel ?? this.p.level));
    const bar = h('i', { style: `width:${grant ? (grant.startXp / xpToNext(grant.startLevel)) * 100 : 0}%` });
    const lines = h('div', { class: 'res-lines' });
    const unlocks = h('div', { class: 'res-unlocks' });
    const winner =
      score.mode === 'versus'
        ? [...score.entrants].sort(
            (a, b) =>
              (score.card[a] ?? []).reduce<number>((x, y) => x + (y ?? 0), 0) -
              (score.card[b] ?? []).reduce<number>((x, y) => x + (y ?? 0), 0),
          )[0]
        : null;
    const el = h(
      'div',
      { class: 'screen results' },
      h('h1', { class: 'res-title' }, score.phase === 'courseEnd' ? 'Course complete!' : 'Results'),
      h('div', { class: 'res-sub' }, `${course.name} · ${MODE_INFO[score.mode].label}`),
      winner
        ? h('div', { class: 'res-winner' }, `🏆 ${players.find((p) => p.id === winner)?.name ?? '?'} wins!`)
        : null,
      h(
        'div',
        { class: 'res-total' },
        `${total} stroke${total === 1 ? '' : 's'} `,
        h('span', { class: 'rel' }, `(${relScore(total, score.mode === 'relay' ? par : par)})`),
      ),
      score.mode !== 'daily' ? starsEl : null,
      scorecard(course, score, players),
      h(
        'div',
        { class: 'res-rewards panel' },
        grant
          ? [
              h(
                'div',
                { class: 'res-level' },
                levelEl,
                h('div', { class: 'xpbar big' }, bar),
                h(
                  'div',
                  { class: 'res-nums' },
                  h('span', {}, '+', xpNum, ' XP'),
                  h('span', {}, '+', coinNum, ' 🪙'),
                ),
              ),
              lines,
              unlocks,
            ]
          : h(
              'div',
              { class: 'muted' },
              online || isDaily ? 'Waiting for rewards from the server…' : 'No rewards',
            ),
      ),
      h(
        'div',
        { class: 'row center' },
        online
          ? h('button', { class: 'btn primary', onclick: () => g.returnToLobby() }, '↩ Back to lobby')
          : isDaily
            ? h('button', { class: 'btn primary', onclick: () => this.daily() }, '🏆 Leaderboard')
            : h(
                'button',
                { class: 'btn primary', onclick: () => g.startLocal(course, 'solo') },
                '🔁 Play again',
              ),
        h(
          'button',
          { class: 'btn', onclick: () => (online ? g.leaveOnline() : g.goMenu('courses')) },
          online ? '🏠 Leave' : '⛳ Courses',
        ),
        !online ? h('button', { class: 'btn', onclick: () => g.goMenu() }, '🏠 Menu') : null,
      ),
    );
    g.ui.showScreen(el);
    if (grant) void this.animateGrant(grant, starsEl, xpNum, coinNum, levelEl, bar, lines, unlocks);
  }

  // ------------------------------------------------------------------------------------------
  // Planet Hopper: Clubhouse hub + run results
  // ------------------------------------------------------------------------------------------

  /** The hub between runs: bank stardust into permanent upgrades, pick a keepsake, start a run. */
  clubhouse(): void {
    const g = this.game;
    const hp = this.p.hopper;
    const dust = dustBalance(hp);
    const upgrades = UPGRADE_IDS.map((id) => {
      const u = UPGRADES[id];
      const rank = upgradeRank(hp, id);
      const cost = u.costs[rank];
      const maxed = cost === undefined;
      return h(
        'div',
        { class: `club-card ${maxed ? 'maxed' : ''}` },
        h('div', { class: 'cc-icon' }, u.icon),
        h('div', { class: 'cc-name' }, u.name),
        h('div', { class: 'cc-desc' }, u.desc),
        h('div', { class: 'cc-pips' }, ...u.costs.map((_, i) => h('i', { class: i < rank ? 'on' : '' }))),
        h(
          'button',
          {
            class: `btn small ${maxed ? '' : 'primary'}`,
            disabled: maxed || dust < cost,
            onclick: () => {
              const err = g.profile.buyUpgrade(id);
              if (err) g.ui.toast(err, 'bad');
              else {
                audio.fanfare(false);
                g.ui.toast(`${u.icon} ${u.name} upgraded!`, 'good');
                this.clubhouse();
              }
            },
          },
          maxed ? 'Maxed' : `✨ ${cost}`,
        ),
      );
    });
    const discovered = TRINKET_IDS.filter((t) => hp.discovered.includes(t));
    // Shelf of every trinket: found ones can be equipped (click again to take it off);
    // undiscovered ones show as greyed-out silhouettes.
    const keepsakes = h(
      'div',
      { class: 'keepsakes' },
      ...TRINKET_IDS.map((t) => {
        const found = discovered.includes(t);
        const on = hp.keepsake === t;
        return h(
          'button',
          {
            class: `keepsake ${on ? 'selected' : ''} ${found ? '' : 'locked'}`,
            disabled: !found,
            title: found
              ? `${TRINKETS[t].name} — ${TRINKETS[t].desc}${on ? ' (click to unequip)' : ''}`
              : 'Not discovered yet: find it during a run',
            onclick: () => {
              g.profile.setKeepsake(on ? null : t);
              this.clubhouse();
            },
          },
          TRINKETS[t].icon,
        );
      }),
    );
    const kept = hp.keepsake && hp.keepsake in TRINKETS ? TRINKETS[hp.keepsake as keyof typeof TRINKETS] : null;
    g.ui.showScreen(
      h(
        'div',
        { class: 'screen clubhouse' },
        this.header('🪐 The Clubhouse', () => this.mainMenu()),
        h(
          'div',
          { class: 'club-hero panel' },
          h(
            'div',
            { class: 'club-intro' },
            h('h3', {}, 'Planet Hopper'),
            h(
              'p',
              { class: 'muted' },
              'Hop across four planets of brand-new holes that get harder the deeper you go. The team shares its hearts: over par costs hearts, birdies win them back. Pick routes at every fork, collect trinkets, beat each sector\'s boss hole, and rest at the Wishing Green. Stardust you collect is banked here, even when the run ends.',
            ),
            h(
              'div',
              { class: 'club-stats' },
              h('span', { class: 'dust-big' }, `✨ ${dust}`),
              h('span', {}, `Runs ${hp.runs}`),
              h('span', {}, `Wins ${hp.wins}`),
              h('span', {}, `Best stage ${hp.bestStage}/${SKELETON.length}`),
            ),
          ),
          h(
            'div',
            { class: 'club-go' },
            h('button', { class: 'btn primary big', onclick: () => g.startHopper() }, '▶ Start solo run'),
            h(
              'button',
              {
                class: 'btn big',
                onclick: () => {
                  this.multiplayer();
                  g.ui.toast('Host or join a game, then choose Planet Hopper in the lobby', 'info', 4500);
                },
              },
              '👥 Co-op run',
            ),
            h('div', { class: 'muted small' }, kept ? `Keepsake: ${kept.icon} ${kept.name}` : 'No keepsake equipped'),
          ),
        ),
        h('h3', { class: 'section-title' }, '🌟 Upgrades (permanent)'),
        h('div', { class: 'club-grid' }, ...upgrades),
        h('h3', { class: 'section-title' }, `🎒 Keepsake — start every run with one trinket you've found (${discovered.length}/${TRINKET_IDS.length})`),
        h('div', { class: 'panel' }, keepsakes),
        h('h3', { class: 'section-title' }, '🌩️ Omens you may meet'),
        h(
          'div',
          { class: 'panel omen-list' },
          ...Object.values(OMENS).map((o) => h('div', {}, h('b', {}, `${o.icon} ${o.name}`), ' — ', o.desc)),
        ),
      ),
    );
  }

  private hopperResults(score: ScoreState, players: SessionPlayer[], grant: Grant | null, online: boolean): void {
    const g = this.game;
    const hs = score.hopper!;
    const won = hs.result === 'won';
    const cleared = hs.stage + (won ? 1 : 0);
    const spec = hs.stages[hs.stage];
    const starsEl = h('div', { class: 'hidden' }, h('span'), h('span'), h('span'));
    const xpNum = h('b', {}, '0');
    const coinNum = h('b', {}, '0');
    const levelEl = h('div', { class: 'lvl big' }, String(grant?.startLevel ?? this.p.level));
    const bar = h('i', { style: `width:${grant ? (grant.startXp / xpToNext(grant.startLevel)) * 100 : 0}%` });
    const lines = h('div', { class: 'res-lines' });
    const unlocks = h('div', { class: 'res-unlocks' });
    const strokes = score.entrants.map((e) => {
      const card = score.card[e] ?? [];
      const tot = card.reduce<number>((a, b) => a + (b ?? 0), 0);
      const par = card.reduce<number>((a, b, i) => a + (b == null ? 0 : (score.pars[i] ?? 0)), 0);
      return h('div', { class: 'row' }, h('span', {}, players.find((p) => p.id === e)?.name ?? '?'), h('b', {}, `${tot} strokes (${relScore(tot, par)})`));
    });
    g.ui.showScreen(
      h(
        'div',
        { class: `screen results hopper-results ${won ? 'won' : 'lost'}` },
        h('h1', { class: 'res-title' }, won ? '🏆 Every planet conquered!' : '💔 Run over'),
        h(
          'div',
          { class: 'res-sub' },
          won
            ? `All ${SKELETON.length} stages cleared`
            : `Reached stage ${hs.stage + 1} of ${SKELETON.length} · ${WORLD_LABEL[spec?.world ?? 'meadow'] ?? ''} sector`,
        ),
        h(
          'div',
          { class: 'panel hop-summary' },
          h('div', { class: 'row' }, h('span', {}, 'Hearts'), heartsEl(Math.max(0, hs.hearts), hs.maxHearts)),
          h('div', { class: 'row' }, h('span', {}, 'Stages cleared'), h('b', {}, String(cleared))),
          h('div', { class: 'row' }, h('span', {}, 'Stardust found'), h('b', {}, `✨ ${hs.dust}`)),
          h(
            'div',
            { class: 'row' },
            h('span', {}, 'Trinkets'),
            hs.trinkets.length ? h('span', {}, ...hs.trinkets.map((t) => trinketChip(t, true, hs.levels?.[t] ?? 1))) : h('span', { class: 'muted' }, 'none'),
          ),
          ...strokes,
        ),
        h(
          'div',
          { class: 'res-rewards panel' },
          grant
            ? [
                grant.dust !== undefined
                  ? h('div', { class: 'res-dust' }, `✨ ${grant.dust} stardust banked in the Clubhouse`)
                  : null,
                h(
                  'div',
                  { class: 'res-level' },
                  levelEl,
                  h('div', { class: 'xpbar big' }, bar),
                  h('div', { class: 'res-nums' }, h('span', {}, '+', xpNum, ' XP'), h('span', {}, '+', coinNum, ' 🪙')),
                ),
                lines,
                unlocks,
              ]
            : h('div', { class: 'muted' }, online ? 'Waiting for rewards from the host…' : 'No rewards'),
        ),
        h(
          'div',
          { class: 'row center' },
          online
            ? h('button', { class: 'btn primary', onclick: () => g.returnToLobby() }, '↩ Back to lobby')
            : h('button', { class: 'btn primary', onclick: () => g.startHopper() }, '🔁 New run'),
          online
            ? h('button', { class: 'btn', onclick: () => g.leaveOnline() }, '🏠 Leave')
            : h('button', { class: 'btn', onclick: () => { g.goMenu(); this.clubhouse(); } }, '🪐 Clubhouse'),
          !online ? h('button', { class: 'btn', onclick: () => g.goMenu() }, '🏠 Menu') : null,
        ),
      ),
    );
    if (grant) void this.animateGrant(grant, starsEl, xpNum, coinNum, levelEl, bar, lines, unlocks);
  }

  /** Stars pop in, XP bar fills (with level-ups), then reward lines and unlocks. */
  async animateGrant(
    grant: Grant,
    starsEl: HTMLElement,
    xpNum: HTMLElement,
    coinNum: HTMLElement,
    levelEl: HTMLElement,
    bar: HTMLElement,
    lines: HTMLElement,
    unlocks: HTMLElement,
  ): Promise<void> {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, this.game.settings.reducedMotion ? 0 : ms));
    await wait(400);
    for (let i = 0; i < 3; i++) {
      if (grant.stars[i]) {
        starsEl.children[i].classList.add('on');
        audio.pickup('gem');
        await wait(350);
      }
    }
    for (const x of grant.xpItems)
      lines.append(h('div', { class: 'line' }, h('span', {}, x.label), h('b', {}, `+${x.xp} XP`)));
    for (const c of grant.coinItems)
      lines.append(h('div', { class: 'line coin' }, h('span', {}, c.label), h('b', {}, `+${c.coins} 🪙`)));
    void tweenNumber(coinNum, 0, grant.coinsTotal, 900);
    // Fill XP bar through every level gained.
    let level = grant.startLevel;
    let xp = grant.startXp;
    let remaining = grant.xpTotal;
    void tweenNumber(xpNum, 0, grant.xpTotal, 1200, () => audio.xpTick());
    while (remaining > 0) {
      const need = xpToNext(level);
      const add = Math.min(remaining, need - xp);
      xp += add;
      remaining -= add;
      bar.style.transition = this.game.settings.reducedMotion ? 'none' : 'width 0.6s ease-out';
      bar.style.width = `${(xp / need) * 100}%`;
      await wait(650);
      if (xp >= need) {
        level++;
        xp = 0;
        levelEl.textContent = String(level);
        levelEl.classList.add('pop');
        audio.levelUp();
        this.game.ui.toast(`Level up! You are now level ${level}`, 'good');
        bar.style.transition = 'none';
        bar.style.width = '0%';
        await wait(150);
      }
    }
    for (const id of grant.achievements)
      unlocks.append(h('div', { class: 'unlock ach' }, `🏅 Achievement: ${achievementName(id)}`));
    for (const id of grant.unlocked) {
      const c = COSMETIC_BY_ID.get(id);
      if (c)
        unlocks.append(
          h(
            'div',
            { class: 'unlock' },
            h('i', { class: 'swatch', style: `background:${c.color}` }),
            `New ${c.slot}: ${c.name}`,
          ),
        );
    }
    if (grant.newCollectibles.length)
      unlocks.append(
        h(
          'div',
          { class: 'unlock' },
          `💎 ${grant.newCollectibles.length} new collectible${grant.newCollectibles.length > 1 ? 's' : ''} added to your collection`,
        ),
      );
  }
}

type Settings = import('../core/settings').Settings;
