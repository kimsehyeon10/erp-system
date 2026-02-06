const { readDB, writeDB, nowISO, genId } = require("../config/database");

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
  const { productCode, type } = req.query;

  let items = db.history;

  if (productCode) items = items.filter((h) => h.productCode === productCode);
  if (type) items = items.filter((h) => h.type === type);

  return res.json({ ok: true, history: items });
}

function cancelHistory(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!["admin", "manager"].includes(auth.role)) {
    return res.status(403).json({ ok: false, message: "No permission" });
  }

  const historyId = req.params.id;
  const db = readDB();
  const idx = db.history.findIndex((h) => h.id === historyId);
  if (idx === -1) {
    return res.status(404).json({ ok: false, message: "History not found" });
  }

  const target = db.history[idx];
  if (!["IN", "OUT", "ADJUST"].includes(target.type)) {
    return res.status(400).json({ ok: false, message: "Only IN/OUT/ADJUST can be canceled" });
  }
  if (target.canceledAt) {
    return res.status(400).json({ ok: false, message: "Already canceled" });
  }

  const pIdx = db.products.findIndex((p) => p.code === target.productCode);
  if (pIdx === -1) {
    return res.status(404).json({ ok: false, message: "Product not found" });
  }

  const product = db.products[pIdx];
  const reverseDelta = -Number(target.delta || 0);
  const nextQty = Number(product.qty || 0) + reverseDelta;
  if (nextQty < 0) {
    return res.status(400).json({ ok: false, message: "Cannot cancel due to insufficient stock" });
  }

  db.products[pIdx] = { ...product, qty: nextQty, updatedAt: nowISO() };
  db.history[idx] = {
    ...target,
    canceledAt: nowISO(),
    canceledBy: auth.username,
  };

  db.history.unshift({
    id: genId("H"),
    productCode: target.productCode,
    type: "CANCEL",
    delta: reverseDelta,
    memo: `이력 취소: ${target.id}`,
    user: auth.username,
    at: nowISO(),
    canceledTargetId: target.id,
  });

  writeDB(db);
  return res.json({ ok: true, product: db.products[pIdx], canceledHistory: db.history[idx] });
}

module.exports = { listHistory, cancelHistory };
