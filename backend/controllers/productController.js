const { readDB, writeDB, nowISO, genId } = require("../config/database");
const XLSX = require("xlsx");

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

function canViewPrice(role) {
  return roleAllowed(role, ["admin", "manager"]);
}

function normalizeUnit(unit) {
  const u = (unit || "ea").toString().trim().toLowerCase();
  if (u === "m") return "m";
  return "ea";
}

function normalizeCondition(condition) {
  const c = String(condition || "new").trim().toLowerCase();
  return c === "used" ? "used" : "new";
}

function normalizeProductType(productType) {
  const t = String(productType || "finished").trim().toLowerCase();
  return t === "bom" ? "bom" : "finished";
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapProductForRole(product, role) {
  if (canViewPrice(role)) return product;
  return { ...product, price: null };
}

function listProducts(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const products = db.products.map((p) => mapProductForRole(p, auth.role));
  return res.json({ ok: true, products });
}

function getProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const code = req.params.code;
  const db = readDB();
  const product = db.products.find((p) => p.code === code);

  if (!product) {
    return res.status(404).json({ ok: false, message: "Product not found" });
  }

  return res.json({ ok: true, product: mapProductForRole(product, auth.role) });
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
    location,
    spec,
    note,
    condition,
    productType,
    barcode
  } = req.body || {};
  if (!code || !name) {
    return res.status(400).json({ ok: false, message: "code/name required" });
  }

  const db = readDB();
  const exists = db.products.some((p) => p.code === code);
  if (exists) {
    return res.status(409).json({ ok: false, message: "Product code already exists" });
  }

  const product = {
    id: genId("P"),
    code: String(code).trim(),
    barcode: String(barcode || code).trim(),
    name: String(name).trim(),
    category: category ? String(category).trim() : "미분류",
    unit: normalizeUnit(unit),
    qty: safeNumber(qty, 0),
    price: safeNumber(price, 0),
    safetyStock: safetyStock === undefined ? 10 : safeNumber(safetyStock, 10),
    location: String(location || "").trim(),
    spec: String(spec || "").trim(),
    note: String(note || "").trim(),
    condition: normalizeCondition(condition),
    productType: normalizeProductType(productType),
    image: image ? String(image) : "",
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
  return res.status(201).json({ ok: true, product: mapProductForRole(product, auth.role) });
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

  const next = {
    ...prev,
    barcode: payload.barcode !== undefined ? String(payload.barcode || "").trim() : (prev.barcode || prev.code),
    name: payload.name !== undefined ? String(payload.name).trim() : prev.name,
    category: payload.category !== undefined ? String(payload.category).trim() : prev.category,
    unit: payload.unit !== undefined ? normalizeUnit(payload.unit) : prev.unit,
    price: payload.price !== undefined ? safeNumber(payload.price, prev.price) : prev.price,
    safetyStock:
      payload.safetyStock !== undefined ? safeNumber(payload.safetyStock, prev.safetyStock) : prev.safetyStock,
    location: payload.location !== undefined ? String(payload.location || "").trim() : (prev.location || ""),
    spec: payload.spec !== undefined ? String(payload.spec || "").trim() : (prev.spec || ""),
    note: payload.note !== undefined ? String(payload.note || "").trim() : (prev.note || ""),
    condition: payload.condition !== undefined ? normalizeCondition(payload.condition) : normalizeCondition(prev.condition),
    productType: payload.productType !== undefined ? normalizeProductType(payload.productType) : normalizeProductType(prev.productType),
    image: payload.image !== undefined ? String(payload.image || "") : prev.image,
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
  return res.json({ ok: true, product: mapProductForRole(next, auth.role) });
}

function deleteProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin"])) {
    return res.status(403).json({ ok: false, message: "Only admin can delete" });
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
  return res.json({ ok: true, deleted: mapProductForRole(deleted, auth.role) });
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
  return res.json({ ok: true, product: mapProductForRole(db.products[idx], auth.role) });
}

function exportProductsExcel(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const rows = db.products.map((p) => ({
    code: p.code,
    barcode: p.barcode || p.code,
    name: p.name,
    category: p.category || "",
    unit: p.unit || "ea",
    qty: p.qty || 0,
    price: p.price || 0,
    safetyStock: p.safetyStock ?? 10,
    location: p.location || "",
    spec: p.spec || "",
    note: p.note || "",
    condition: p.condition || "new",
    productType: p.productType || "finished",
    image: p.image || ""
  }));

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ["code", "barcode", "name", "category", "unit", "qty", "price", "safetyStock", "location", "spec", "note", "condition", "productType", "image"]
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "products");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");
  return res.send(buf);
}

function importProductsExcel(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({ ok: false, message: "No permission (admin/manager only)" });
  }

  const mode = (req.query.mode || "merge").toString().toLowerCase();
  const { base64 } = req.body || {};

  if (!base64 || typeof base64 !== "string") {
    return res.status(400).json({ ok: false, message: "base64 required" });
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return res.status(400).json({ ok: false, message: "Invalid base64" });
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return res.status(400).json({ ok: false, message: "Invalid excel file" });
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return res.status(400).json({ ok: false, message: "Excel has no sheets" });
  }

  const ws = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  const cleaned = rows
    .map((r) => ({
      code: String(r.code || "").trim(),
      barcode: String(r.barcode || r.code || "").trim(),
      name: String(r.name || "").trim(),
      category: String(r.category || "").trim() || "미분류",
      unit: normalizeUnit(r.unit),
      qty: safeNumber(r.qty, 0),
      price: safeNumber(r.price, 0),
      safetyStock: r.safetyStock === "" ? 10 : safeNumber(r.safetyStock, 10),
      location: String(r.location || "").trim(),
      spec: String(r.spec || "").trim(),
      note: String(r.note || "").trim(),
      condition: normalizeCondition(r.condition),
      productType: normalizeProductType(r.productType),
      image: r.image ? String(r.image) : ""
    }))
    .filter((r) => r.code && r.name);

  if (cleaned.length === 0) {
    return res.status(400).json({ ok: false, message: "No valid rows (need code/name)" });
  }

  const db = readDB();
  let created = 0;
  let updated = 0;
  let adjusted = 0;

  if (mode === "replace") {
    const nextProducts = cleaned.map((r) => ({
      id: genId("P"),
      code: r.code,
      barcode: r.barcode,
      name: r.name,
      category: r.category,
      unit: r.unit,
      qty: r.qty,
      price: r.price,
      safetyStock: r.safetyStock,
      location: r.location,
      spec: r.spec,
      note: r.note,
      condition: r.condition,
      productType: r.productType,
      image: r.image,
      updatedAt: nowISO()
    }));

    db.history.unshift({
      id: genId("H"),
      productCode: "*",
      type: "UPDATE",
      delta: 0,
      memo: `엑셀 replace import: ${nextProducts.length} rows`,
      user: auth.username,
      at: nowISO(),
    });

    db.products = nextProducts;
    writeDB(db);
    return res.json({ ok: true, mode, created: nextProducts.length, updated: 0, adjusted: 0 });
  }

  cleaned.forEach((r) => {
    const idx = db.products.findIndex((p) => p.code === r.code);
    if (idx === -1) {
      const product = {
        id: genId("P"),
        code: r.code,
        barcode: r.barcode,
        name: r.name,
        category: r.category,
        unit: r.unit,
        qty: r.qty,
        price: r.price,
        safetyStock: r.safetyStock,
        location: r.location,
        spec: r.spec,
        note: r.note,
        condition: r.condition,
        productType: r.productType,
        image: r.image,
        updatedAt: nowISO()
      };
      db.products.push(product);
      created++;

      db.history.unshift({
        id: genId("H"),
        productCode: product.code,
        type: "CREATE",
        delta: product.qty,
        memo: "엑셀 import 생성",
        user: auth.username,
        at: nowISO(),
      });
      return;
    }

    const prev = db.products[idx];
    const next = {
      ...prev,
      barcode: r.barcode,
      name: r.name,
      category: r.category,
      unit: r.unit,
      price: r.price,
      safetyStock: r.safetyStock,
      location: r.location,
      spec: r.spec,
      note: r.note,
      condition: r.condition,
      productType: r.productType,
      image: r.image,
      updatedAt: nowISO()
    };

    const prevQty = safeNumber(prev.qty, 0);
    const nextQty = safeNumber(r.qty, prevQty);
    const delta = nextQty - prevQty;

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
        at: nowISO()
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
  return res.json({ ok: true, mode, created, updated, adjusted });
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustInventory,
  exportProductsExcel,
  importProductsExcel,
};
