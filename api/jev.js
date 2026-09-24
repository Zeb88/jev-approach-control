// Vercel serverless function: POST /api/jev
const handleJev = require("./_jev");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const ip = req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const r = await handleJev(req.body, { cookie: req.headers.cookie, ip });
    for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    res.status(r.status).setHeader("Content-Type", "application/json").send(r.body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
