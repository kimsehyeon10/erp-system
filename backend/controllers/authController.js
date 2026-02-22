const { readDB } = require("../config/database");

function login(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ ok: false, message: "username/password required" });
  }

  const db = readDB();
  const user = db.users.find((u) => u.username === username && u.password === password);

  if (!user) {
    return res.status(401).json({ ok: false, message: "Invalid credentials" });
  }

  // 간단 토큰(보안 목적 아님) - 향후 JWT로 교체 가능
  const token = Buffer.from(`${user.username}:${user.role}`).toString("base64");

  return res.json({
    ok: true,
    token,
    user: {
      username: user.username,
      role: user.role
    }
  });
}

module.exports = { login };
