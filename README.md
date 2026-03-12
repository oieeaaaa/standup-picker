# Who's Next? — Standup Picker

A standup facilitator picker: create a room, invite your team, roll the dice to pick two players, and they play Rock Paper Scissors. The loser becomes the next facilitator.

**Features:**

- Create a room and share the link; players join with name and avatar.
- Host can set the current facilitator (excluded from the roll).
- **Proxy players:** Host can add absent team members so they can still be selected. Choose “Computer plays for them” for RPS to be decided automatically, or play on their behalf when they’re picked.
- Roll the dice → two players are chosen → RPS (with tie-break) → loser is the next facilitator.

---

## Running locally

```bash
npm install
npm start
```

Then open **http://localhost:3000** (or the port shown in the console). To use a fixed port:

```bash
PORT=3737 npm start
```

For development with auto-reload:

```bash
npm run dev
```

To share quickly without deploying (creates a temporary public URL via Cloudflare Tunnel):

```bash
npm run tunnel
```

---

## Deploying (production)

The app is a single Node server: static files and Socket.IO are served from the same process. No database or tunnel is required.

1. Set environment variables:
   - **PORT** — port to listen on (e.g. `3000` or your platform’s default).
   - **NODE_ENV** — set to `production` in production.

2. Start the server:
   ```bash
   npm install --production
   npm start
   ```

3. **Health check:** Use **GET /health** for load balancers or monitoring. It returns `200` and `{ "ok": true }`.

4. **Behind a reverse proxy:** The app uses `trust proxy`, so it works behind nginx, Caddy, or a platform proxy. Point the proxy at your Node port and serve the app on one origin (same host for static assets and Socket.IO).

Example platforms that work well: **Render**, **Railway**, **Fly.io**, **Koyeb**, or a VPS (e.g. systemd + nginx). Configure the service to run `node server.js` and set `PORT` (and optionally `NODE_ENV=production`).

### Deploy on Koyeb

1. Push this repo to **GitHub** (or GitLab).
2. Sign in at [koyeb.com](https://www.koyeb.com) → **Create Web Service**.
3. Connect your Git provider and select the `standup-picker` repository.
4. Koyeb will detect Node.js from `package.json`. Use the default build; run command is `npm start`.
5. Set **Port** to `3000` (or leave default if Koyeb sets `PORT` for you).
6. (Optional) Set **NODE_ENV** to `production` in Variables.
7. Deploy. Your app will get a URL like `https://your-app-<org>.koyeb.app` with HTTPS and WebSockets supported.

---

## Scripts

| Script     | Description                                      |
| ---------- | ------------------------------------------------- |
| `npm start` | Run server (uses `PORT` from env, default 3000)  |
| `npm run dev` | Run with `--watch` on port 3737                 |
| `npm run tunnel` | Run server + cloudflared for a temporary public URL |
