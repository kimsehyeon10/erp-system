/**
 * productController.js  ―  ERP v6  (엑셀 이미지 I/O 수정판)
 *
 * 주요 변경 사항 (엑셀 기능만):
 *  - exportProductsExcel : cleanImageValue() 로 오염된 DB 이미지 값 정제 후 ExcelJS 임베딩
 *  - importProductsExcel : getImages() 에서 nativeRow 매핑 버그 수정
 *                          (img.range.tl.nativeRow 는 정수이므로 rowNum-1 과 직접 비교)
 *                          image_url 컬럼의 Base64 → 파일 저장 경로 수정
 */

"use strict";

const { readDB, writeDB, nowISO, genId } = require("../config/database");
const { createLedgerEntry } = require("./ledgerController");
const { withTransaction, findUserIdByUsername, dbErrorMessage } = require("../config/postgres");
const XLSX   = require("xlsx");          // SheetJS (가져오기 메타데이터용 폴백)
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

// ─────────────────────────── 상수 ────────────────────────────
const ALLOWED_CATEGORIES = [
  "전자기기", "주변기기", "가전제품", "사무용품",
  "소모품",  "원자재",   "완제품",   "기타",
];

// ─────────────────────── 공통 헬퍼 ───────────────────────────

/**
 * DB에 잘못 저장된 이미지 값을 정제한다.
 *
 * 오염 패턴:
 *   "http://localhost:5000/uploads/data:image/webp;base64,XXXX"
 *    → "data:image/webp;base64,XXXX"
 *
 *   "http://localhost:5000/uploads/foo.jpg"
 *    → "foo.jpg"
 *
 * 정상 패턴:
 *   "data:image/..."  → 그대로 반환
 *   "foo.jpg"         → 그대로 반환
 *   "/uploads/foo"    → 그대로 반환
 *   "https://ext.com" → 그대로 반환
 */
function cleanImageValue(raw) {
  if (!raw) return "";
  const v = String(raw).trim();
  if (!v) return "";

  // ① 이미 올바른 Base64 Data URL
  if (v.startsWith("data:image/")) return v;

  // ② http(s):// 형태 검사
  if (v.startsWith("http://") || v.startsWith("https://")) {
    // "http://서버/uploads/data:image/..." 오염 패턴
    const dataIdx = v.indexOf("data:image/");
    if (dataIdx !== -1) return v.substring(dataIdx);

    // "http://서버/uploads/파일명.ext" → 파일명만
    const uploadsIdx = v.indexOf("/uploads/");
    if (uploadsIdx !== -1) {
      const after = v.substring(uploadsIdx + "/uploads/".length);
      if (after && !after.includes("/")) return after;
    }

    // 진짜 외부 URL
    return v;
  }

  // ③ 파일명 / /uploads/파일명
  return v;
}

/**
 * DB의 image 값에서 { buffer, extension } 을 추출한다.
 *
 * 지원 형태:
 *   1) "data:image/jpeg;base64,..."  → Base64 직접 디코딩
 *   2) "foo.jpg" / "/uploads/foo.jpg" → 서버 uploads 폴더 파일 읽기
 *   3) 진짜 외부 http URL            → null 반환 (임베딩 불가)
 */
function resolveImageBuffer(imageValue, uploadsDir) {
  if (!imageValue || typeof imageValue !== "string") return null;

  const val = cleanImageValue(imageValue.trim());
  if (!val) return null;

  try {
    // Case 1: Base64 Data URL
    if (val.startsWith("data:image/")) {
      const m = /^data:(image\/[^;]+);base64,(.+)$/i.exec(val);
      if (!m) return null;
      const mime = m[1].toLowerCase();
      let ext = "jpeg";
      if (mime.includes("png"))  ext = "png";
      else if (mime.includes("gif"))  ext = "gif";
      else if (mime.includes("webp")) ext = "webp";
      const buf = Buffer.from(m[2], "base64");
      if (buf.length === 0) return null;
      return { buffer: buf, extension: ext };
    }

    // Case 2 & 3: 파일명 / 경로
    if (val.startsWith("http://") || val.startsWith("https://")) return null;

    const fileName = path.basename(val);
    if (!fileName || fileName.includes("\\")) return null;

    const filePath = path.join(uploadsDir, fileName);
    if (!fs.existsSync(filePath)) return null;

    const buf = fs.readFileSync(filePath);
    if (buf.length === 0) return null;

    let ext = path.extname(fileName).replace(".", "").toLowerCase();
    if (ext === "jpg") ext = "jpeg";
    if (!["jpeg", "png", "gif", "webp"].includes(ext)) return null;

    return { buffer: buf, extension: ext };
  } catch {
    return null;
  }
}

/**
 * Base64 Data URL을 uploads 폴더에 파일로 저장한다.
 * 반환: "/uploads/파일명" 또는 ""
 */
function saveDataImageToUploads(dataUrl, uploadsDir) {
  try {
    const m = /^data:(image\/[^;]+);base64,(.+)$/i.exec(String(dataUrl || "").trim());
    if (!m) return "";
    const mime = m[1].toLowerCase();
    const b64  = m[2];
    const ext  = mime.includes("png")  ? "png"
               : mime.includes("webp") ? "webp"
               : mime.includes("gif")  ? "gif"
               : "jpg";

    const buf = Buffer.from(b64, "base64");
    if (buf.length > 10 * 1024 * 1024) return ""; // 10MB 초과 거부

    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const name     = `excel_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${ext}`;
    const filePath = path.join(uploadsDir, name);
    fs.writeFileSync(filePath, buf);
    return `/uploads/${name}`;
  } catch {
    return "";
  }
}

// ─────────────────────── 인증/권한 ───────────────────────────

function requireAuth(req, res) {
  const username = req.headers["x-user"];
  const role     = req.headers["x-role"];
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

function mapProductForRole(product, role) {
  if (canViewPrice(role)) return product;
  return { ...product, price: null };
}

// ─────────────────────── 실시간 브로드캐스트 ─────────────────

function emitInventoryUpdate(req, payload) {
  try {
    if (req.io) req.io.emit("inventory:update", payload);
  } catch { /* 실시간은 부가 기능 */ }
}

// ─────────────────────── 유효성 검사 ─────────────────────────

function validateCategory(category) {
  if (!category) return "기타";
  const n = String(category).trim();
  return ALLOWED_CATEGORIES.includes(n) ? n : "기타";
}

function isBarcodeUnique(barcode, excludeCode = null) {
  if (!barcode) return true;
  const db = readDB();
  return !db.products.some(p => p.barcode === barcode && p.code !== excludeCode);
}

function normalizeUnit(unit) {
  const u = (unit || "ea").toString().trim().toLowerCase();
  return u === "m" ? "m" : "ea";
}

function normalizeCondition(condition) {
  return String(condition || "new").trim().toLowerCase() === "used" ? "used" : "new";
}

function normalizeProductType(productType) {
  return String(productType || "finished").trim().toLowerCase() === "bom" ? "bom" : "finished";
}

function safeNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ──────────────────── CRUD 컨트롤러 ──────────────────────────

function listProducts(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const db       = readDB();
  const products = db.products.map(p => mapProductForRole(p, auth.role));
  return res.json({ ok: true, products });
}

function getProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const db      = readDB();
  const product = db.products.find(p => p.code === req.params.code);
  if (!product) return res.status(404).json({ ok: false, message: "Product not found" });
  return res.json({ ok: true, product: mapProductForRole(product, auth.role) });
}

function getProductByBarcode(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const barcode = req.params.barcode;
  if (!barcode) return res.status(400).json({ ok: false, message: "Barcode required" });
  const db      = readDB();
  const product = db.products.find(p => p.barcode === barcode || p.code === barcode);
  if (!product)  return res.status(404).json({ ok: false, message: `상품을 찾을 수 없습니다 (바코드: ${barcode})` });
  return res.json({ ok: true, product: mapProductForRole(product, auth.role) });
}

function checkBarcodeAvailable(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  const barcode     = (req.params.barcode || "").toString().trim();
  if (!barcode) return res.status(400).json({ ok: false, message: "Barcode required" });
  const excludeCode = (req.query.excludeCode || "").toString().trim() || null;
  return res.json({ ok: true, barcode, available: isBarcodeUnique(barcode, excludeCode) });
}

function createProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin", "manager"]))
    return res.status(403).json({ ok: false, message: "No permission" });

  const { code, name, category, unit, qty, price, safetyStock, image,
          location, spec, note, condition, productType, barcode } = req.body || {};

  if (!code || !name) return res.status(400).json({ ok: false, message: "code/name required" });

  const db = readDB();
  if (db.products.some(p => p.code === code))
    return res.status(409).json({ ok: false, message: "Product code already exists" });

  const barcodeValue = barcode ? String(barcode).trim() : String(code).trim();
  if (!isBarcodeUnique(barcodeValue))
    return res.status(409).json({ ok: false, message: "이미 사용 중인 바코드는 등록할 수 없습니다." });

  const product = {
    id: genId("P"),
    code:        String(code).trim(),
    barcode:     barcodeValue,
    name:        String(name).trim(),
    category:    validateCategory(category),
    unit:        normalizeUnit(unit),
    qty:         safeNumber(qty, 0),
    price:       safeNumber(price, 0),
    safetyStock: safetyStock === undefined ? 10 : safeNumber(safetyStock, 10),
    location:    String(location || "").trim(),
    spec:        String(spec    || "").trim(),
    note:        String(note    || "").trim(),
    condition:   normalizeCondition(condition),
    productType: normalizeProductType(productType),
    image:       image ? String(image) : "",
    updatedAt:   nowISO(),
  };

  db.products.push(product);
  db.history.unshift({ id: genId("H"), productCode: product.code, type: "CREATE",
    delta: product.qty, memo: "신규 등록", user: auth.username, at: nowISO() });
  writeDB(db);
  emitInventoryUpdate(req, { message: `상품 등록: ${product.code} (${product.name})`,
    productCode: product.code, kind: "CREATE", at: nowISO() });
  return res.status(201).json({ ok: true, product: mapProductForRole(product, auth.role) });
}

function updateProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin", "manager"]))
    return res.status(403).json({ ok: false, message: "No permission" });

  const code    = req.params.code;
  const payload = req.body || {};
  const db      = readDB();
  const idx     = db.products.findIndex(p => p.code === code);
  if (idx === -1) return res.status(404).json({ ok: false, message: "Product not found" });

  const prev = db.products[idx];

  if (payload.barcode !== undefined) {
    const nb = String(payload.barcode || "").trim();
    if (nb && !isBarcodeUnique(nb, code))
      return res.status(409).json({ ok: false, message: "이미 사용 중인 바코드는 등록할 수 없습니다." });
  }

  const categoryValue = payload.category !== undefined ? validateCategory(payload.category) : prev.category;

  const next = {
    ...prev,
    barcode:     payload.barcode     !== undefined ? String(payload.barcode || "").trim() : (prev.barcode || prev.code),
    name:        payload.name        !== undefined ? String(payload.name).trim()          : prev.name,
    category:    categoryValue,
    unit:        payload.unit        !== undefined ? normalizeUnit(payload.unit)           : prev.unit,
    price:       payload.price       !== undefined ? safeNumber(payload.price, prev.price) : prev.price,
    safetyStock: payload.safetyStock !== undefined ? safeNumber(payload.safetyStock, prev.safetyStock) : prev.safetyStock,
    location:    payload.location    !== undefined ? String(payload.location || "").trim() : (prev.location || ""),
    spec:        payload.spec        !== undefined ? String(payload.spec    || "").trim()  : (prev.spec    || ""),
    note:        payload.note        !== undefined ? String(payload.note    || "").trim()  : (prev.note    || ""),
    condition:   payload.condition   !== undefined ? normalizeCondition(payload.condition)   : normalizeCondition(prev.condition),
    productType: payload.productType !== undefined ? normalizeProductType(payload.productType) : normalizeProductType(prev.productType),
    image:       payload.image       !== undefined ? String(payload.image  || "")          : prev.image,
    updatedAt:   nowISO(),
  };

  db.products[idx] = next;

  const compareFields = [
    { key: "name", label: "상품명" }, { key: "barcode", label: "바코드" },
    { key: "category", label: "카테고리" }, { key: "unit", label: "단위" },
    { key: "price", label: "가격" }, { key: "safetyStock", label: "안전재고" },
    { key: "location", label: "위치" }, { key: "spec", label: "규격" },
    { key: "note", label: "비고" }, { key: "condition", label: "상태" },
    { key: "productType", label: "유형" },
  ];
  const changes = [], changedFields = {};
  compareFields.forEach(({ key, label }) => {
    if (prev[key] !== next[key]) {
      changes.push(`${label}: ${prev[key]} → ${next[key]}`);
      changedFields[key] = { before: prev[key], after: next[key] };
    }
  });

  db.history.unshift({
    id: genId("H"), productCode: next.code, type: "UPDATE", delta: 0,
    memo: changes.length > 0 ? `상품 정보 수정 (${changes.join(", ")})` : "상품 정보 수정",
    user: auth.username, at: nowISO(), beforeState: changedFields,
  });

  writeDB(db);
  emitInventoryUpdate(req, { message: `상품 수정: ${next.code} (${next.name})`,
    productCode: next.code, kind: "UPDATE", at: nowISO() });
  return res.json({ ok: true, product: mapProductForRole(next, auth.role) });
}

function deleteProduct(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin"]))
    return res.status(403).json({ ok: false, message: "Only admin can delete" });

  const code = req.params.code;
  const db   = readDB();
  const idx  = db.products.findIndex(p => p.code === code);
  if (idx === -1) return res.status(404).json({ ok: false, message: "Product not found" });

  const deleted = db.products[idx];
  db.products.splice(idx, 1);
  db.history.unshift({ id: genId("H"), productCode: deleted.code, type: "DELETE",
    delta: -deleted.qty, memo: "상품 삭제", user: auth.username, at: nowISO() });
  writeDB(db);
  emitInventoryUpdate(req, { message: `상품 삭제: ${deleted.code} (${deleted.name})`,
    productCode: deleted.code, kind: "DELETE", at: nowISO() });
  return res.json({ ok: true, deleted: mapProductForRole(deleted, auth.role) });
}

function adjustInventory(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin", "manager", "staff"]))
    return res.status(403).json({ ok: false, message: "No permission" });

  const { productCode, type, delta, memo } = req.body || {};
  if (!productCode || !type) return res.status(400).json({ ok: false, message: "productCode/type required" });

  const parsedDelta = Number(delta);
  if (!Number.isFinite(parsedDelta) || parsedDelta === 0)
    return res.status(400).json({ ok: false, message: "delta must be a number and not 0" });

  (async () => {
    try {
      const result = await withTransaction(async (client) => {
        const productRes = await client.query(
          `SELECT id, code, name, category, safety_stock, qty_on_hand, created_at, updated_at
             FROM products
            WHERE code = $1
            FOR UPDATE`,
          [productCode]
        );

        if (productRes.rowCount === 0) {
          const err = new Error("Product not found");
          err.status = 404;
          throw err;
        }

        const p = productRes.rows[0];
        let nextQty = Number(p.qty_on_hand);

        if (type === "IN") nextQty = Number(p.qty_on_hand) + Math.abs(parsedDelta);
        else if (type === "OUT") nextQty = Number(p.qty_on_hand) - Math.abs(parsedDelta);
        else if (type === "ADJUST") nextQty = Number(p.qty_on_hand) + parsedDelta;
        else {
          const err = new Error("type must be IN|OUT|ADJUST");
          err.status = 400;
          throw err;
        }

        if (nextQty < 0) {
          const err = new Error("Not enough stock");
          err.status = 400;
          throw err;
        }

        const appliedDelta = type === "IN" ? Math.abs(parsedDelta) : type === "OUT" ? -Math.abs(parsedDelta) : parsedDelta;
        await client.query(
          `UPDATE products
              SET qty_on_hand = $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [nextQty, p.id]
        );

        const requestedByUserId = await findUserIdByUsername(client, auth.username);
        await client.query(
          `INSERT INTO inventory_transactions
            (product_id, tx_type, qty_delta, memo, requested_by, happened_at)
           VALUES
            ($1, $2, $3, $4, $5, NOW())`,
          [p.id, type, appliedDelta, memo || "", requestedByUserId]
        );

        return {
          id: p.id,
          code: p.code,
          name: p.name,
          category: p.category,
          safetyStock: Number(p.safety_stock || 0),
          qty: nextQty,
          qty_on_hand: nextQty,
          createdAt: p.created_at,
          updatedAt: new Date().toISOString(),
          appliedDelta,
        };
      });

      emitInventoryUpdate(req, {
        message: `재고 ${type}: ${result.code} (${result.name}) ${result.appliedDelta > 0 ? "+" : ""}${result.appliedDelta}`,
        productCode: result.code,
        kind: type,
        delta: result.appliedDelta,
        at: nowISO(),
      });

      return res.json({ ok: true, product: mapProductForRole(result, auth.role) });
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ ok: false, message: err.message });
      }
      console.error("[POST /products/adjust]", err);
      return res.status(500).json({ ok: false, message: dbErrorMessage(err) });
    }
  })();
}

// ═══════════════════════════════════════════════════════════════
//  엑셀 내보내기 (EXPORT)
//
//  변경 사항:
//   ① cleanImageValue() 로 오염된 "http://서버/uploads/data:image/..." 정제
//   ② resolveImageBuffer() 결과가 null 일 때 명확한 경고 로그 (조용한 실패 방지)
//   ③ 이미지 열 너비/행 높이 일관 설정
//   ④ image_url 컬럼: 외부 URL 이면 텍스트, 아니면 "[이미지 임베딩됨]" 안내 표시
// ═══════════════════════════════════════════════════════════════
async function exportProductsExcel(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  let ExcelJS;
  try { ExcelJS = require("exceljs"); }
  catch { return res.status(500).json({ ok: false, message: "exceljs 패키지가 없습니다. npm install exceljs" }); }

  const db         = readDB();
  const uploadsDir = path.join(__dirname, "..", "uploads");
  const workbook   = new ExcelJS.Workbook();
  const ws         = workbook.addWorksheet("products");

  // ── 열 정의 ──────────────────────────────────────────────
  ws.columns = [
    { header: "image",       key: "image",       width: 18 },
    { header: "image_url",   key: "image_url",   width: 50 },
    { header: "code",        key: "code",        width: 16 },
    { header: "barcode",     key: "barcode",     width: 20 },
    { header: "name",        key: "name",        width: 28 },
    { header: "category",    key: "category",    width: 16 },
    { header: "unit",        key: "unit",        width: 8  },
    { header: "qty",         key: "qty",         width: 10 },
    { header: "price",       key: "price",       width: 12 },
    { header: "safetyStock", key: "safetyStock", width: 12 },
    { header: "location",    key: "location",    width: 18 },
    { header: "spec",        key: "spec",        width: 22 },
    { header: "note",        key: "note",        width: 30 },
    { header: "condition",   key: "condition",   width: 10 },
    { header: "productType", key: "productType", width: 10 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font      = { bold: true, name: "Arial", size: 11 };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height    = 22;
  headerRow.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };

  let imageCount = 0;

  let rowIdx = 2;
  for (const p of db.products) {
    const mapped = mapProductForRole(p, auth.role);

    // ① 이미지 값 정제
    const cleanedImage = cleanImageValue(p.image || "");

    // ② image_url 컬럼 텍스트 결정
    //    - 외부 HTTP URL → URL 텍스트 그대로
    //    - Base64 / 로컬파일 → "[이미지 임베딩됨]" 안내
    //    - 이미지 없음    → ""
    let imageUrlText = "";
    if (cleanedImage) {
      if (cleanedImage.startsWith("http://") || cleanedImage.startsWith("https://")) {
        imageUrlText = cleanedImage;           // 외부 URL → 텍스트
      } else {
        imageUrlText = "[이미지 임베딩됨]";    // Base64/파일 → 안내
      }
    }

    ws.addRow({
      image:       "",
      image_url:   imageUrlText,
      code:        mapped.code        || "",
      barcode:     mapped.barcode     || mapped.code || "",
      name:        mapped.name        || "",
      category:    mapped.category    || "",
      unit:        mapped.unit        || "",
      qty:         Number(mapped.qty         || 0),
      price:       Number(mapped.price       || 0),
      safetyStock: Number(mapped.safetyStock || 0),
      location:    mapped.location    || "",
      spec:        mapped.spec        || "",
      note:        mapped.note        || "",
      condition:   mapped.condition   || "",
      productType: mapped.productType || "",
    });

    // ③ 이미지 임베딩 ─────────────────────────────────────
    //    resolveImageBuffer 내부에서 cleanImageValue 재호출하므로
    //    오염된 DB 값도 올바르게 처리됨
    const imgData = resolveImageBuffer(p.image, uploadsDir);
    if (imgData) {
      try {
        const imgId = workbook.addImage({ buffer: imgData.buffer, extension: imgData.extension });
        ws.getRow(rowIdx).height = 90;
        ws.addImage(imgId, {
          tl:     { col: 0.1, row: rowIdx - 1 + 0.1 },
          ext:    { width: 110, height: 110 },
          editAs: "oneCell",
        });
        imageCount++;
      } catch (imgErr) {
        console.warn(`[exportExcel] 이미지 임베딩 실패 (code=${p.code}):`, imgErr.message);
      }
    } else if (cleanedImage) {
      // 이미지 값은 있지만 파일/Base64 해석 실패 → 로그만 남김
      console.warn(`[exportExcel] 이미지 해석 불가 (code=${p.code}): ${cleanedImage.substring(0, 60)}`);
    }

    rowIdx++;
  }

  console.log(`[exportExcel] ${db.products.length}개 상품, ${imageCount}개 이미지 임베딩`);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename=products.xlsx");

  try {
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[exportExcel] write 실패:", err);
    if (!res.headersSent) res.status(500).json({ ok: false, message: "Excel export failed" });
  }
}

// ═══════════════════════════════════════════════════════════════
//  엑셀 가져오기 (IMPORT)
//
//  핵심 버그 수정:
//   ① nativeRow 매핑 오류 수정
//      ws.getImages() → img.range.tl.nativeRow 는 0-based 정수
//      eachRow() rowNum 은 1-based
//      → 데이터 첫 행(rowNum=2) 의 nativeRow = 1 이어야 함
//      기존 코드: embeddedImageByRow[nativeRow]  key = nativeRow (0-based)
//               rowNum-1 과 비교 → rowNum=2 → key=1 → nativeRow=1 → 일치 ✓
//      BUT: 이미지 tl 이 헤더 행(nativeRow=0) 에 걸치는 경우 skip 처리 정확히
//
//   ② image_url 컬럼 "[이미지 임베딩됨]" 텍스트를 import 시 무시하도록 처리
//
//   ③ 임베딩 이미지가 없고 image_url 도 없을 때 기존 이미지 유지 (merge 모드)
// ═══════════════════════════════════════════════════════════════
async function importProductsExcel(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin", "manager"]))
    return res.status(403).json({ ok: false, message: "No permission (admin/manager only)" });

  const mode = (req.query.mode || "merge").toString().toLowerCase();
  const { base64 } = req.body || {};
  if (!base64 || typeof base64 !== "string")
    return res.status(400).json({ ok: false, message: "base64 required" });

  let buffer;
  try { buffer = Buffer.from(base64, "base64"); }
  catch { return res.status(400).json({ ok: false, message: "Invalid base64" }); }

  let ExcelJS;
  try { ExcelJS = require("exceljs"); }
  catch { return res.status(500).json({ ok: false, message: "exceljs 패키지가 없습니다." }); }

  const uploadsDir = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    console.error("[importExcel] load 실패:", err);
    return res.status(400).json({ ok: false, message: "유효하지 않은 엑셀 파일입니다." });
  }

  const ws = workbook.getWorksheet(1);
  if (!ws) return res.status(400).json({ ok: false, message: "엑셀에 시트가 없습니다." });

  // ── 헤더 → 컬럼 인덱스 매핑 ─────────────────────────────
  const colMap = {};
  ws.getRow(1).eachCell((cell, colNum) => {
    const key = String(cell.value || "").trim().toLowerCase();
    if (key) colMap[key] = colNum;
  });

  // ── 임베딩 이미지 → 데이터 행 번호(0-based nativeRow) 매핑 ──
  //
  //  ExcelJS Anchor.nativeRow : 0-based 정수
  //    헤더 행 = nativeRow 0
  //    데이터 첫 행(rowNum=2) = nativeRow 1
  //
  //  eachRow rowNum : 1-based
  //    헤더 = rowNum 1
  //    데이터 첫 행 = rowNum 2  → nativeRow = rowNum - 1 = 1  ✓
  //
  //  따라서 key = nativeRow(정수), 조회 시 nativeRow = rowNum - 1
  //
  const embeddedImageByRow = {}; // key: nativeRow(0-based 정수)

  for (const img of ws.getImages()) {
    try {
      // tl.nativeRow 는 정수 (Anchor 클래스에서 Math.floor 처리됨)
      const nativeRow = img.range.tl.nativeRow;

      // 헤더 행(nativeRow=0) 에 걸친 이미지는 무시
      if (nativeRow < 1) continue;

      const imgInfo = workbook.getImage(img.imageId);
      if (imgInfo && imgInfo.buffer && !embeddedImageByRow[nativeRow]) {
        embeddedImageByRow[nativeRow] = {
          buffer:    imgInfo.buffer,
          extension: ((imgInfo.extension || "jpeg").replace("jpg", "jpeg")),
        };
      }
    } catch (e) {
      console.warn("[importExcel] 이미지 파싱 실패:", e.message);
    }
  }

  const imgRowCount = Object.keys(embeddedImageByRow).length;
  console.log(`[importExcel] 감지된 임베딩 이미지: ${imgRowCount}개`);

  // ── 행별 데이터 추출 ─────────────────────────────────────
  const getCell = (row, key) => {
    const col = colMap[key.toLowerCase()];
    if (!col) return "";
    const cell = row.getCell(col);
    const v    = cell.value;
    if (v === null || v === undefined) return "";
    if (typeof v === "object" && v.result !== undefined) return String(v.result);
    return String(v);
  };

  const rows = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // 헤더 건너뜀

    // ── 이미지 경로 결정 ────────────────────────────────
    let imagePath = "";

    // 1순위: 임베딩 이미지  (nativeRow = rowNum - 1)
    const nativeRow = rowNum - 1;
    const embImg    = embeddedImageByRow[nativeRow];

    if (embImg) {
      try {
        const ext      = (embImg.extension || "jpeg") === "jpeg" ? "jpg" : (embImg.extension || "jpg");
        const safeName = `excel_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${ext}`;
        const filePath = path.join(uploadsDir, safeName);
        fs.writeFileSync(filePath, embImg.buffer);
        imagePath = `/uploads/${safeName}`; // DB에는 브라우저가 접근 가능한 URL 경로로 저장
        console.log(`[importExcel] 이미지 저장: ${safeName} (row ${rowNum})`);
      } catch (e) {
        console.warn(`[importExcel] 이미지 저장 실패 (row ${rowNum}):`, e.message);
      }
    }

    // 2순위: image_url 컬럼 텍스트 (임베딩 없을 때만)
    if (!imagePath) {
      const rawUrl = getCell(row, "image_url").trim();

      // "[이미지 임베딩됨]", "[BASE64_IMAGE]", "OMITTED" 등 안내 텍스트 무시
      const isPlaceholder = /\[이미지|BASE64|OMITTED/i.test(rawUrl);

      if (rawUrl && !isPlaceholder) {
        const urlVal = cleanImageValue(rawUrl);

        if (urlVal.startsWith("data:image/")) {
          // Base64 Data URL → 파일로 저장, saveDataImageToUploads는 '/uploads/파일명' 반환
          const saved = saveDataImageToUploads(urlVal, uploadsDir);
          if (saved) imagePath = saved; // '/uploads/파일명' 그대로 사용 (path.basename 제거)
        } else if (urlVal.startsWith("http://") || urlVal.startsWith("https://")) {
          // 외부 HTTP URL → URL 그대로 저장
          imagePath = urlVal;
        } else {
          // 파일명 또는 /uploads/파일명 형태 → /uploads/ prefix 보장
          const fn = path.basename(urlVal);
          if (fn) imagePath = `/uploads/${fn}`;
        }
      }
    }

    rows.push({
      code:        getCell(row, "code").trim(),
      barcode:     (getCell(row, "barcode") || getCell(row, "code")).trim(),
      name:        getCell(row, "name").trim(),
      category:    getCell(row, "category").trim() || "미분류",
      unit:        normalizeUnit(getCell(row, "unit")),
      qty:         safeNumber(getCell(row, "qty"), 0),
      price:       safeNumber(getCell(row, "price"), 0),
      safetyStock: getCell(row, "safetystock") === "" ? 10 : safeNumber(getCell(row, "safetystock"), 10),
      location:    getCell(row, "location").trim(),
      spec:        getCell(row, "spec").trim(),
      note:        getCell(row, "note").trim(),
      condition:   normalizeCondition(getCell(row, "condition")),
      productType: normalizeProductType(getCell(row, "producttype")),
      image:       imagePath,
    });
  });

  const cleaned = rows.filter(r => r.code && r.name);
  if (cleaned.length === 0)
    return res.status(400).json({ ok: false, message: "유효한 행이 없습니다 (code/name 필요)" });

  const db = readDB();
  let created = 0, updated = 0, adjusted = 0;

  if (mode === "replace") {
    const nextProducts = cleaned.map(r => ({
      id: genId("P"), code: r.code, barcode: r.barcode, name: r.name,
      category: r.category, unit: r.unit, qty: r.qty, price: r.price,
      safetyStock: r.safetyStock, location: r.location, spec: r.spec, note: r.note,
      condition: r.condition, productType: r.productType, image: r.image, updatedAt: nowISO(),
    }));
    db.history.unshift({ id: genId("H"), productCode: "*", type: "UPDATE", delta: 0,
      memo: `엑셀 replace import: ${nextProducts.length}개`, user: auth.username, at: nowISO() });
    db.products = nextProducts;
    writeDB(db);
    return res.json({ ok: true, mode, created: nextProducts.length, updated: 0, adjusted: 0 });
  }

  // merge 모드
  for (const r of cleaned) {
    const idx = db.products.findIndex(p => p.code === r.code);

    if (idx === -1) {
      // 신규 등록
      db.products.push({
        id: genId("P"), code: r.code, barcode: r.barcode, name: r.name,
        category: r.category, unit: r.unit, qty: r.qty, price: r.price,
        safetyStock: r.safetyStock, location: r.location, spec: r.spec, note: r.note,
        condition: r.condition, productType: r.productType, image: r.image, updatedAt: nowISO(),
      });
      db.history.unshift({ id: genId("H"), productCode: r.code, type: "CREATE",
        delta: r.qty, memo: "엑셀 import 생성", user: auth.username, at: nowISO() });
      created++;
      continue;
    }

    // 기존 상품 업데이트
    const prev    = db.products[idx];
    const prevQty = safeNumber(prev.qty, 0);
    const nextQty = safeNumber(r.qty, prevQty);
    const delta   = nextQty - prevQty;

    // ⚠️ image 처리: 엑셀에 이미지가 없으면(imagePath="") 기존 이미지 유지
    const imageValue = r.image !== "" ? r.image : prev.image;

    db.products[idx] = {
      ...prev,
      barcode: r.barcode, name: r.name, category: r.category, unit: r.unit,
      price: r.price, safetyStock: r.safetyStock, location: r.location, spec: r.spec,
      note: r.note, condition: r.condition, productType: r.productType,
      image: imageValue, qty: nextQty, updatedAt: nowISO(),
    };

    if (delta !== 0) {
      adjusted++;
      db.history.unshift({ id: genId("H"), productCode: prev.code, type: "ADJUST",
        delta, memo: "엑셀 import 수량 반영", user: auth.username, at: nowISO() });
    }

    db.history.unshift({ id: genId("H"), productCode: prev.code, type: "UPDATE",
      delta: 0, memo: "엑셀 import 업데이트", user: auth.username, at: nowISO() });
    updated++;
  }

  writeDB(db);
  console.log(`[importExcel] created=${created}, updated=${updated}, adjusted=${adjusted}`);
  return res.json({ ok: true, mode, created, updated, adjusted });
}

// ─────────────────── module.exports ───────────────────────────
module.exports = {
  listProducts,
  getProduct,
  getProductByBarcode,
  checkBarcodeAvailable,
  createProduct,
  updateProduct,
  deleteProduct,
  adjustInventory,
  exportProductsExcel,
  importProductsExcel,
};
