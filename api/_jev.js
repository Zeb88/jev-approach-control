// Shared by server.js (local) and api/jev.js (Vercel). Adds the key and model; the browser never sees the key.
// Files starting with "_" in api/ are not exposed as Vercel functions.
const crypto = require("crypto");

const SESSION_MS = (+process.env.SESSION_MINUTES || 10) * 60_000; // Jev time per browser
const COOLDOWN_S = 24 * 3600;  // cookie lifetime: one session per browser per day
const MAX_BODY = 64_000;       // bytes; a busy Jev ATC batch is ~10 KB
const IP_PER_MINUTE = +process.env.IP_MINUTE_LIMIT || 30;  // Jev ATC alone makes ~15/min
const IP_PER_DAY = +process.env.IP_DAILY_LIMIT || 300;     // ~2 full 10-minute sessions per IP

// Stateless session: the cookie holds its start time plus an HMAC, so it can't be forged or extended.
// Clearing cookies gets a fresh session, which is what the per-IP limit below is for.
const sign = (v) => crypto.createHmac("sha256", process.env.SESSION_SECRET || process.env.TYPESAFE_API_KEY || "dev").update(v).digest("base64url");
function session(cookie = "") {
  const m = cookie.match(/(?:^|;\s*)jev_session=(\d+)\.([\w-]+)/);
  const valid = m && m[2].length === sign(m[1]).length && crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(sign(m[1])));
  const start = valid ? +m[1] : Date.now();
  const headers = {};
  if (!valid) headers["Set-Cookie"] = `jev_session=${start}.${sign(String(start))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOLDOWN_S}`;
  const remaining = start + SESSION_MS - Date.now();
  headers["X-Session-Remaining"] = String(Math.max(0, Math.round(remaining / 1000)));
  return { remaining, headers };
}

// Fixed-window counters per IP. Upstash Redis (REST, no SDK) when configured, shared by every
// Vercel instance; otherwise in memory, which is exact for the local server but per-instance on Vercel.
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const memory = new Map(); // key -> { n, exp }
async function incr(keys) { // keys: [[key, ttlSeconds]] -> counts
  if (REDIS_URL) {
    const r = await fetch(`${REDIS_URL}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      body: JSON.stringify(keys.flatMap(([k, ttl]) => [["INCR", k], ["EXPIRE", k, String(ttl)]])),
    });
    if (!r.ok) throw new Error(`rate limiter ${r.status}`);
    return (await r.json()).filter((_, i) => i % 2 === 0).map((x) => x.result);
  }
  const now = Date.now();
  if (memory.size > 10_000) for (const [k, v] of memory) if (v.exp < now) memory.delete(k);
  return keys.map(([k, ttl]) => {
    const e = memory.get(k)?.exp > now ? memory.get(k) : { n: 0, exp: now + ttl * 1000 };
    e.n++; memory.set(k, e); return e.n;
  });
}
// IPv6 users typically control a whole /64, so count per /64 rather than per address.
function ipKey(ip) {
  ip = ip.replace(/^::ffff:(?=\d+\.)/, ""); // IPv4-mapped IPv6 -> plain IPv4
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("%")[0].split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(":") + "::/64";
}
async function rateLimit(rawIp) {
  const ip = ipKey(rawIp);
  const now = Date.now(), min = Math.floor(now / 60_000), day = Math.floor(now / 86_400_000);
  const [perMin, perDay] = await incr([[`rl:m:${ip}:${min}`, 60], [`rl:d:${ip}:${day}`, 86_400]]);
  if (perDay > IP_PER_DAY) return { retryAfter: Math.ceil(((day + 1) * 86_400_000 - now) / 1000), daily: true };
  if (perMin > IP_PER_MINUTE) return { retryAfter: Math.ceil(((min + 1) * 60_000 - now) / 1000) };
  return null;
}

async function handleJev(body, { cookie, ip } = {}) {
  const s = session(cookie);
  const reply = (status, obj, extra = {}) => ({ status, headers: { ...s.headers, ...extra }, body: JSON.stringify(obj) });
  if (s.remaining <= 0) return reply(429, { error: "session_expired", message: "Your Jev time is up. Come back tomorrow!" });
  const { state, questions } = body || {};
  if (!state || !questions || typeof questions !== "object") return reply(400, { error: "state and questions are required" });
  if (JSON.stringify(body).length > MAX_BODY) return reply(413, { error: "request too large" });
  let limited;
  try { limited = await rateLimit(ip || "unknown"); }
  catch (e) { console.error(e); return reply(503, { error: "rate_limiter_unavailable" }); } // fail closed: protect the credits
  if (limited) return reply(429, {
    error: "rate_limited", retry_after: limited.retryAfter,
    message: limited.daily ? "Daily Jev limit reached for your network. Come back tomorrow!" : "Too many Jev calls, slow down a moment.",
  }, { "Retry-After": String(limited.retryAfter) });
  const r = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });
  return { status: r.status, headers: s.headers, body: await r.text() };
}

module.exports = handleJev;
module.exports.ipKey = ipKey;
