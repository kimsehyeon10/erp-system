const XLSX = require("xlsx");
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

function normalizeUnit(unit) {
  const u = (unit || "ea").toString().trim().toLowerCase();
  if (u === "m") return "m";
  return "ea";
}

function normalizeCondition(condition) {
  return condition === "used" ? "used" : "new";
}

function normalizeType(type) {
  return type === "bom" ? "bom" : "standard";
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function canViewPrice(role) {
  return role === "admin" || role === "manager";
}

function canEditPrice(role) {
  return role === "admin" || role === "manager";
}

function sanitizeProductForRole(product, role) {
  const p = { ...product };
  if (!canViewPrice(role)) {
    delete p.price;
  }
  return p;
}

function assertBarcodeUnique(db, barcode, excludeCode = null) {
  const b = (barcode || "").toString().trim();
  if (!b) return { ok: true };
  const found = db.products.find((p) => (p.barcode || "") === b && p.code !== excludeCode);
  if (found) return { ok: false, message: "이미 사용 중인 바코드입니다." };
  return { ok: true };
}

function listProducts(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const items = db.products.map((p) => sanitizeProductForRole(p, auth.role));
  return res.json({ ok: true, products: items });
}

function getProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const code = req.params.code;
  const db = readDB();
  const product = db.products.find((p) => p.code === code);

  if (!product) return res.status(404).json({ ok: false, message: "Product not found" });

  return res.json({ ok: true, product: sanitizeProductForRole(product, auth.role) });
}

/** ✅ 바코드로 상품 조회 */
function getProductByBarcode(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const barcode = (req.params.barcode || "").toString().trim();
  if (!barcode) return res.status(400).json({ ok: false, message: "barcode required" });

  const db = readDB();
  const product = db.products.find((p) => (p.barcode || "") === barcode);

  if (!product) return res.status(404).json({ ok: false, message: "Product not found" });

  return res.json({ ok: true, product: sanitizeProductForRole(product, auth.role) });
}

function createProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({ ok: false, message: "No permission" });
  }

  const {
    code,
    name,
    category,
    unit,
    qty,
    price,
    safetyStock,
    image,

    // 신규 필드(있으면 저장, 없으면 기본값)
    location,
    spec,
    description,
    condition,
    type,
    barcode,
    bomItems,
  } = req.body || {};

  if (!code || !name) {
    return res.status(400).json({ ok: false, message: "code/name required" });
  }

  const db = readDB();

  const exists = db.products.some((p) => p.code === String(code).trim());
  if (exists) {
    return res.status(409).json({ ok: false, message: "Product code already exists" });
  }

  const uniq = assertBarcodeUnique(db, barcode);
  if (!uniq.ok) return res.status(409).json(uniq);

  const product = {
    id: genId("P"),
    code: String(code).trim(),
    name: String(name).trim(),
    category: category ? String(category).trim() : "미분류",
    unit: normalizeUnit(unit),
    qty: safeNumber(qty, 0),
    // ✅ price: 백엔드에서도 권한 강제
    price: canEditPrice(auth.role) ? safeNumber(price, 0) : 0,
    safetyStock: safetyStock === undefined ? 10 : safeNumber(safetyStock, 10),
    image: image ? String(image) : "",

    // ✅ 신규 필드
    location: location ? String(location) : "",
    spec: spec ? String(spec) : "",
    description: description ? String(description) : "",
    condition: normalizeCondition(condition),
    type: normalizeType(type),
    barcode: barcode ? String(barcode).trim() : "",
    bomItems: Array.isArray(bomItems) ? bomItems : [],

    updatedAt: nowISO(),
  };

  db.products.push(product);

  db.history.unshift({
    id: genId("H"),
    productCode: product.code,
    type: "CREATE",
    delta: product.qty,
    memo: "신규 등록",
    user: auth.username,
    at: nowISO(),
  });

  writeDB(db);
  return res.status(201).json({ ok: true, product: sanitizeProductForRole(product, auth.role) });
}

function updateProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({ ok: false, message: "No permission" });
  }

  const code = req.params.code;
  const payload = req.body || {};
  const db = readDB();

  const idx = db.products.findIndex((p) => p.code === code);
  if (idx === -1) {
    return res.status(404).json({ ok: false, message: "Product not found" });
  }

  const prev = db.products[idx];

  const nextBarcode = payload.barcode !== undefined ? String(payload.barcode || "").trim() : prev.barcode;
  const uniq = assertBarcodeUnique(db, nextBarcode, code);
  if (!uniq.ok) return res.status(409).json(uniq);

  const next = {
    ...prev,
    name: payload.name !== undefined ? String(payload.name || "").trim() : prev.name,
    category: payload.category !== undefined ? String(payload.category || "").trim() : prev.category,
    unit: payload.unit !== undefined ? normalizeUnit(payload.unit) : prev.unit,
    qty: payload.qty !== undefined ? safeNumber(payload.qty, 0) : prev.qty,
    safetyStock: payload.safetyStock !== undefined ? safeNumber(payload.safetyStock, 10) : prev.safetyStock,
    image: payload.image !== undefined ? String(payload.image || "") : prev.image,

    location: payload.location !== undefined ? String(payload.location || "") : (prev.location || ""),
    spec: payload.spec !== undefined ? String(payload.spec || "") : (prev.spec || ""),
    description: payload.description !== undefined ? String(payload.description || "") : (prev.description || ""),
    condition: payload.condition !== undefined ? normalizeCondition(payload.condition) : (prev.condition || "new"),
    type: payload.type !== undefined ? normalizeType(payload.type) : (prev.type || "standard"),
    barcode: nextBarcode,
    bomItems: payload.bomItems !== undefined ? (Array.isArray(payload.bomItems) ? payload.bomItems : []) : (prev.bomItems || []),

    // ✅ price 백엔드 강제
    price: payload.price !== undefined ? (canEditPrice(auth.role) ? safeNumber(payload.price, prev.price || 0) : (prev.price || 0)) : (prev.price || 0),

    updatedAt: nowISO(),
  };

  db.products[idx] = next;

  db.history.unshift({
    id: genId("H"),
    productCode: next.code,
    type: "UPDATE",
    delta: 0,
    memo: "상품 정보 수정",
    user: auth.username,
    at: nowISO(),
  });

  writeDB(db);
  return res.json({ ok: true, product: sanitizeProductForRole(next, auth.role) });
}

function deleteProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin"])) {
    return res.status(403).json({ ok: false, message: "No permission" });
  }

  const code = req.params.code;
  const db = readDB();
  const idx = db.products.findIndex((p) => p.code === code);

  if (idx === -1) {
    return res.status(404).json({ ok: false, message: "Product not found" });
  }

  const deleted = db.products[idx];
  db.products.splice(idx, 1);

  db.history.unshift({
    id: genId("H"),
    productCode: deleted.code,
    type: "DELETE",
    delta: -deleted.qty,
    memo: "상품 삭제",
    user: auth.username,
    at: nowISO(),
  });

  writeDB(db);
  return res.json({ ok: true, deleted: sanitizeProductForRole(deleted, auth.role) });
}

function adjustInventory(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager", "staff"])) {
    return res.status(403).json({ ok: false, message: "No permission" });
  }

  const { productCode, type, delta, memo } = req.body || {};
  if (!productCode || !type) {
    return res.status(400).json({ ok: false, message: "productCode/type required" });
  }

  const parsedDelta = Number(delta);
  if (!Number.isFinite(parsedDelta) || parsedDelta === 0) {
    return res.status(400).json({ ok: false, message: "delta must be a number and not 0" });
  }

  const db = readDB();
  const idx = db.products.findIndex((p) => p.code === productCode);
  if (idx === -1) {
    return res.status(404).json({ ok: false, message: "Product not found" });
  }

  const p = db.products[idx];
  let nextQty = p.qty;

  if (type === "IN") nextQty = p.qty + Math.abs(parsedDelta);
  else if (type === "OUT") nextQty = p.qty - Math.abs(parsedDelta);
  else if (type === "ADJUST") nextQty = p.qty + parsedDelta;
  else return res.status(400).json({ ok: false, message: "type must be IN|OUT|ADJUST" });

  if (nextQty < 0) return res.status(400).json({ ok: false, message: "Not enough stock" });

  db.products[idx] = { ...p, qty: nextQty, updatedAt: nowISO() };

  const appliedDelta =
    type === "IN" ? Math.abs(parsedDelta) : type === "OUT" ? -Math.abs(parsedDelta) : parsedDelta;

  db.history.unshift({
    id: genId("H"),
    productCode: p.code,
    type,
    delta: appliedDelta,
    memo: memo || "",
    user: auth.username,
    at: nowISO(),
  });

  writeDB(db);
  return res.json({ ok: true, product: sanitizeProductForRole(db.products[idx], auth.role) });
}

/**
 * ✅ 엑셀 내보내기 (기존 유지)
 */
function exportProductsExcel(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();

  // ✅ staff는 가격 보기 금지(백엔드 차단)
  if (!canViewPrice(auth.role)) {
    return res.status(403).json({ ok: false, message: "No permission to export price" });
  }

  const rows = db.products.map((p) => ({
    code: p.code,
    name: p.name,
    category: p.category || "",
    unit: p.unit || "ea",
    qty: p.qty || 0,
    price: p.price || 0,
    safetyStock: p.safetyStock ?? 10,
    image: p.image || "",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "products");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");
  return res.send(buf);
}

/**
 * ✅ 엑셀 가져오기 (기존 유지 + 안전)
 */
function importProductsExcel(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({ ok: false, message: "No permission" });
  }

  if (!req.file) {
    return res.status(400).json({ ok: false, message: "No file uploaded" });
  }

  const db = readDB();

  const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  let inserted = 0;
  let updated = 0;
  let adjusted = 0;

  rows.forEach((r) => {
    const code = String(r.code || r.상품코드 || "").trim();
    const name = String(r.name || r.상품명 || "").trim();
    if (!code || !name) return;

    const idx = db.products.findIndex((p) => p.code === code);

    if (idx === -1) {
      const product = {
        id: genId("P"),
        code,
        name,
        category: String(r.category || r.카테고리 || "미분류").trim(),
        unit: normalizeUnit(r.unit || r.단위 || "ea"),
        qty: safeNumber(r.qty || r.재고 || 0, 0),
        price: safeNumber(r.price || r.가격 || 0, 0),
        safetyStock: safeNumber(r.safetyStock || r.안전재고 || 10, 10),
        image: String(r.image || r.이미지 || "").trim(),
        updatedAt: nowISO(),
      };

      db.products.push(product);
      inserted++;

      db.history.unshift({
        id: genId("H"),
        productCode: code,
        type: "CREATE",
        delta: product.qty,
        memo: "엑셀 import 신규 등록",
        user: auth.username,
        at: nowISO(),
      });
      return;
    }

    const prev = db.products[idx];
    const next = {
      ...prev,
      name,
      category: String(r.category || r.카테고리 || prev.category || "미분류").trim(),
      unit: normalizeUnit(r.unit || r.단위 || prev.unit || "ea"),
      price: safeNumber(r.price || r.가격 || prev.price || 0, 0),
      safetyStock: safeNumber(r.safetyStock || r.안전재고 || prev.safetyStock || 10, 10),
      image: (r.image || r.이미지) !== "" ? String(r.image || r.이미지 || "") : prev.image,
      updatedAt: nowISO(),
    };

    // qty가 들어오면 ADJUST 로그로 남김
    const nextQty = safeNumber(r.qty || r.재고 || prev.qty || 0, prev.qty || 0);
    const delta = nextQty - safeNumber(prev.qty, 0);
    if (delta !== 0) {
      next.qty = nextQty;
      adjusted++;
      db.history.unshift({
        id: genId("H"),
        productCode: prev.code,
        type: "ADJUST",
        delta,
        memo: "엑셀 import 수량 반영",
        user: auth.username,
        at: nowISO(),
      });
    }

    db.products[idx] = next;
    updated++;

    db.history.unshift({
      id: genId("H"),
      productCode: prev.code,
      type: "UPDATE",
      delta: 0,
      memo: "엑셀 import 업데이트",
      user: auth.username,
      at: nowISO(),
    });
  });

  writeDB(db);
  return res.json({ ok: true, inserted, updated, adjusted });
}

module.exports = {
  listProducts,
  getProduct,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustInventory,
  exportProductsExcel,
  importProductsExcel,
};
