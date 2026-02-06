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

function roleAllowed(role, allowedRoles) {
  return allowedRoles.includes(role);
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

/**
 * ✅ undo: IN/OUT/ADJUST 로그만 안전하게 롤백 (음수 재고 방지)
 * - admin/manager만 가능
 */
function undoHistory(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({ ok: false, message: "No permission (admin/manager only)" });
  }

  const historyId = req.params.id;
  const db = readDB();
  const hIdx = db.history.findIndex((x) => x.id === historyId);
  if (hIdx === -1) return res.status(404).json({ ok: false, message: "History not found" });

  const h = db.history[hIdx];

  if (h.undoneAt) {
    return res.status(400).json({ ok: false, message: "Already undone" });
  }

  if (!["IN", "OUT", "ADJUST"].includes(h.type)) {
    return res.status(400).json({ ok: false, message: "This history type cannot be undone yet" });
  }

  const productCode = h.productCode;
  const pIdx = db.products.findIndex((p) => p.code === productCode);
  if (pIdx === -1) return res.status(404).json({ ok: false, message: "Product not found" });

  const beforeQty = Number(db.products[pIdx].qty || 0);
  const delta = Number(h.delta || 0);
  if (!Number.isFinite(delta) || delta === 0) {
    return res.status(400).json({ ok: false, message: "Invalid delta" });
  }

  const afterQty = beforeQty - delta; // 반대로 적용
  if (afterQty < 0) {
    return res.status(400).json({ ok: false, message: "Undo would make stock negative" });
  }

  db.products[pIdx] = { ...db.products[pIdx], qty: afterQty, updatedAt: nowISO() };
  db.history[hIdx] = { ...h, undoneAt: nowISO(), undoneBy: auth.username };

  db.history.unshift({
    id: genId("H"),
    productCode,
    type: "UNDO",
    delta: -delta,
    memo: `undo ${h.type} (${historyId})`,
    user: auth.username,
    at: nowISO(),
    targetHistoryId: historyId,
    beforeQty,
    afterQty,
  });

  writeDB(db);
  return res.json({ ok: true, product: db.products[pIdx], undone: historyId });
}

module.exports = { listHistory, undoHistory };
