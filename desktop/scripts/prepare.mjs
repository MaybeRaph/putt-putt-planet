/* global console */
// Copies the app-flavoured web build (relative asset paths) and the server bundle into the desktop package.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const app = path.join(here, '..', 'app');
const web = path.join(root, 'client', 'dist-app');
const server = path.join(root, 'server', 'dist', 'server.js');
for (const [p, hint] of [[web, 'npm run build:app'], [server, 'npm run build -w server']])
  if (!fs.existsSync(p)) throw new Error(`Missing ${p} — run \`${hint}\` from the repo root first`);
fs.rmSync(app, { recursive: true, force: true });
fs.cpSync(web, app, { recursive: true });
fs.mkdirSync(path.join(here, '..', 'resources'), { recursive: true });
fs.copyFileSync(server, path.join(here, '..', 'resources', 'server.mjs'));
console.log('desktop: copied web build and server bundle');
