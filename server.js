// Serves the game and proxies radio calls to Jev so the API key never reaches the browser.
const http = require("http");
const fs = require("fs");
const path = require("path");
const handleJev = require("./api/_jev");

// Load .env (Node 18 has no --env-file). Real env vars win.
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch {}

const KEY = process.env.TYPESAFE_API_KEY;
if (!KEY) console.warn("TYPESAFE_API_KEY not set — radio commands will fail.");

http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/jev") {
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > 100_000) return req.destroy(); }
    try {
      const r = await handleJev(JSON.parse(body), { cookie: req.headers.cookie, ip: req.socket.remoteAddress });
      res.writeHead(r.status, { ...r.headers, "Content-Type": "application/json" });
      res.end(r.body);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }
  // Only two pages, so no static file router (and no path traversal to worry about).
  res.writeHead(200, { "Content-Type": "text/html" });
  fs.createReadStream(path.join(__dirname, req.url.startsWith("/info") ? "info.html" : "index.html")).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log(`ATC sim on http://localhost:${process.env.PORT || 3000}`));
