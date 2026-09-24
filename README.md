# Jev Approach Control

A small air traffic control sim for a single runway (27). Give radio calls in plain English, or hand the frequency to **Jev**, [TypeSafe's](https://docs.typesafe.ai/) decision model, and watch it sequence, space and land the traffic.

- **You as controller:** type calls like `United 701 turn left heading 180, descend and maintain 4000, reduce speed 210` or `turn 20 degrees right`. Jev turns the text into typed commands: callsign, heading, turn direction, relative turn, altitude, speed, and approach and landing clearances. You vector arrivals onto a 30° intercept, clear them for the ILS, then clear them to land. Without a landing clearance they go around.
- **STARs:** arrivals enter on four made-up standard arrival routes (KEEPR, MARLO, PIKES, ROWAN ONE), descending via fixes with altitude and speed constraints. The streams merge at the holding fixes ALPHA and BRAVO, which work like real clearance limits and holding stacks.
- **Jev as controller:** click **Jev ATC**. Arrivals are vectored into a real traffic pattern: downwind, then base, then a 30° intercept onto the localizer and a 3° glideslope. Every 4 s Jev makes the sequencing decisions: clear each arrival past its clearance limit or let it hold, which aircraft leaves the bottom of a holding stack, extend the downwind or turn base (its spacing tool, targeting 5 mi in trail), traffic avoidance, speed, and landing clearance. Routine calls such as joining the downwind, the intercept vector and the approach clearance are made by code, and appear as `ATC →` in the log; Jev's decisions appear as `JEV →`.

The full list of parameters (flight model, landing window, separation, Jev questions, confidence thresholds) is on the in-game **How it works** page (`/info`, source in [info.html](info.html)).

Created by [Zeb88](https://github.com/Zeb88). MIT licensed, see [LICENSE](LICENSE).

> **Unofficial demo, not affiliated with or endorsed by TypeSafe AI. Jev is TypeSafe's model, used here through its public API.**

## Files

| File | Purpose |
|---|---|
| `index.html` | The game: radar, flight model, Jev questions (plain JS, no build step) |
| `info.html` | How-it-works page |
| `api/_jev.js` | Calls `POST https://api.typesafe.ai/v1/systemone` with the API key; shared by both servers below |
| `api/jev.js` | Vercel serverless function for `POST /api/jev` |
| `server.js` | Local dev server: serves the pages and `/api/jev`, reads `.env` |
| `vercel.json` / `.vercelignore` | Vercel config (`/info` → `info.html`; never upload `.env` or `server.js`) |
| `.env.example` | Every environment variable, with defaults |
| `package.json` | `npm start`, Node version; no dependencies |
| `LICENSE` | MIT |

No npm dependencies. The API key only lives on the server; the browser talks to `/api/jev`.

## Run locally

Requires Node 18+ and a TypeSafe API key from [console.typesafe.ai/keys](https://console.typesafe.ai/keys).

```bash
cp .env.example .env     # then paste your key after TYPESAFE_API_KEY=
npm start                # or: node server.js
```

Open http://localhost:3000. Opening `index.html` directly as a file won't work, because the radio calls need the `/api/jev` endpoint. Use `PORT=4000 node server.js` for a different port.

## Deploy to Vercel

Vercel serves `index.html` and `info.html` as static files and runs `api/jev.js` as a serverless function. No framework or build step is needed.

### Option A: Vercel CLI

```bash
npm i -g vercel
vercel                                   # first run: link/create the project, accept the defaults
vercel env add TYPESAFE_API_KEY          # paste your key; select Production (and Preview if you want)
# Dashboard: Storage → Create Database → Upstash for Redis → connect it to this project
# (for the IP rate limit; it adds the KV_REST_API_* env vars)
vercel --prod                            # deploy with the key and Redis in place
```

### Option B: Git + dashboard

1. Push the repo to GitHub, GitLab or Bitbucket. `.env` is in `.gitignore`, so the key won't be committed.
2. In Vercel: **Add New… → Project**, then import the repo. Set **Framework Preset** to **Other**, and leave the build command and output directory empty.
3. **Settings → Environment Variables:** add `TYPESAFE_API_KEY`.
4. **Storage → Create Database → Upstash for Redis** (free tier), and connect it to the project. This adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which the IP rate limit needs to work across Vercel instances.
5. Deploy. Environment variables only apply to new deployments, so redeploy if you added the key afterwards.

### Check the deployment

```bash
curl -X POST https://<your-app>.vercel.app/api/jev \
  -H "Content-Type: application/json" \
  -d '{"state":"Speedbird 406 reduce speed by 30","questions":{"q":{"type":"noul","instructions":"Is this a speed instruction?"}}}'
```

A JSON answer such as `{"answers":{"q":{"type":"noul","noul":0.98}}}` means it's working. A `401` means the key is missing or wrong in the Vercel environment variables.

### Notes

- **Cost and abuse:** `/api/jev` is limited to 5 minutes per browser plus a per-IP rate limit (see [Usage limit](#usage-limit-protecting-your-credits)). Connect Upstash Redis, or the IP limit only applies per function instance. For a private deployment, add [Vercel deployment protection](https://vercel.com/docs/security/deployment-protection).
- Optionally set `SESSION_MINUTES` and `SESSION_SECRET` in the Vercel environment variables. `vercel env add` works the same way as for the key.
- **Jev ATC traffic:** each call batches every aircraft into one request, about every 4 s while Jev ATC is on, per open browser tab.
- **Latency:** a 5-aircraft Jev ATC batch took 0.25–0.75 s in testing, well within Vercel's default function timeout.

## Usage limit (protecting your credits)

Each browser gets **5 minutes of Jev time**. The clock starts at its first Jev call and the allowance renews after 24 hours. It's enforced on the server in `api/_jev.js`:

- The first call sets a signed, HttpOnly cookie holding the session start time. Once the time is up, `/api/jev` returns `429` and never calls TypeSafe. Reloading the page doesn't reset it.
- Requests over 64 KB are rejected with `413`.
- The page shows a `Jev time m:ss` countdown next to the score and disables the Jev ATC button and the radio input at 0:00. The radar keeps running.

The cookie alone can be reset by clearing cookies or opening a private window, so there's also a **per-IP rate limit**:

- **30 requests per minute** per IP. Jev ATC makes about 15 a minute, so this only blocks scripts that fire requests fast. The page waits out the `Retry-After` time and carries on.
- **300 requests per day** per IP. That's about 4 full sessions, leaving room for a household or office sharing one IP. The count resets at 00:00 UTC. Once it's reached, the page switches Jev off for the day.
- Counters are stored in **Upstash Redis** when it's configured, which is needed on Vercel because function instances don't share memory. Without it they're kept in memory: exact for `node server.js`, but only per instance on Vercel.
- If Redis is configured but unreachable, `/api/jev` returns `503` instead of calling Jev.
- On Vercel the IP comes from `x-real-ip` / `x-forwarded-for`, which Vercel sets itself. The local server uses the socket address, so forwarded headers can't be spoofed.

| Env var | Default | Purpose |
|---|---|---|
| `SESSION_MINUTES` | `5` | Jev time per browser per day |
| `SESSION_SECRET` | the API key | HMAC secret used to sign the session cookie |
| `IP_MINUTE_LIMIT` | `30` | Requests per IP per minute |
| `IP_DAILY_LIMIT` | `300` | Requests per IP per day (UTC) |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | – | Upstash Redis REST credentials. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work |

Setting a spending limit in the TypeSafe console is the final backstop.

## Tuning

Constants near the top of the `<script>` in `index.html`:

- `TURN_RATE`: turn rate in degrees per second
- `MI`: pixels per mile
- `RWY`: runway position

`JEV_ATC_CONF` (further down) is the minimum confidence before a Jev ATC decision is applied.
