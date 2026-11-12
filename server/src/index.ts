import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Lobby, NET, initPhysics, type Conn } from '@ppp/shared';
import { DailyBoard, ProfileStore } from './store';

/**
 * HTTP + WebSocket server.
 *  - GET /health            -> "ok"
 *  - GET /*                 -> static client build (production, when STATIC_DIR exists)
 *  - WS  /ws                -> game protocol
 * Env: PORT (default 8787), DATA_DIR (default ./data), STATIC_DIR, DEV=1 (debug messages allowed)
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(here, '..', 'data'));
const STATIC_DIR = path.resolve(process.env.STATIC_DIR ?? path.join(here, '..', '..', 'client', 'dist'));
const DEV = process.env.DEV === '1';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

await initPhysics();
const lobby = new Lobby({ profiles: new ProfileStore(DATA_DIR), board: new DailyBoard(DATA_DIR) }, DEV);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`ok rooms=${lobby.rooms.size} online=${lobby.online.size}`);
    return;
  }
  if (!fs.existsSync(STATIC_DIR)) {
    res.writeHead(404);
    res.end('Client not built. In development run `npm run dev` and open http://localhost:5173');
    return;
  }
  // Static hosting with SPA fallback, guarded against path traversal.
  let file = path.join(STATIC_DIR, path.normalize(decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: NET.maxMessageBytes });

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = {
    id: null,
    profile: null,
    room: null,
    bucket: NET.maxMessagesPerSec,
    lastRefill: Date.now(),
    sendRaw: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: (code, reason) => ws.close(code, reason),
  };
  let alive = true;
  ws.on('pong', () => (alive = true));
  const hb = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 10000);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return ws.close(1003, 'text only');
    if (!lobby.onMessage(conn, data.toString())) ws.close(1008, 'protocol violation');
  });
  ws.on('close', () => {
    clearInterval(hb);
    lobby.onClose(conn);
  });
  ws.on('error', () => ws.terminate());
});

server.listen(PORT, () => {
  console.log(`⛳ Putt-Putt Planet server on :${PORT}  (ws path /ws, data ${DATA_DIR}${DEV ? ', DEV' : ''})`);
});

const shutdown = () => {
  lobby.shutdown();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
