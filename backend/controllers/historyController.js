const { readDB } = require("../config/database");

function requireAuth(req, res) {
  const username = req.headers["x-user"];
  const role = req.headers["x-role"];

  if (!username || !role) {
    res.status(401).json({ ok: false, message: "Missing auth headers (x-user, x-role)" });
    return null;
  }

  return { username, role };
}

function listHistory(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();

  // 쿼리 필터 지원
  const { productCode, type } = req.query;

  let items = db.history;

  if (productCode) {
    items = items.filter((h) => h.productCode === productCode);
  }

  if (type) {
    items = items.filter((h) => h.type === type);
  }

  return res.json({ ok: true, history: items });
}

module.exports = { listHistory };
