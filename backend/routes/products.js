const express = require("express");
const router = express.Router();

const {
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
} = require("../controllers/productController");

// ✅ 순서 중요: /:code 보다 먼저 와야 합니다.
router.get("/export.xlsx", exportProductsExcel);
router.post("/import", importProductsExcel);

// 바코드 조회 (/:code보다 앞에 위치)
router.get("/barcode/:barcode", getProductByBarcode);
// 바코드 사용 가능 여부 체크 (프론트 사전 검증용)
router.get("/check-barcode/:barcode", checkBarcodeAvailable);


router.get("/", listProducts);
router.get("/:code", getProduct);

router.post("/", createProduct);
router.put("/:code", updateProduct);
router.delete("/:code", deleteProduct);

router.post("/adjust", adjustInventory);

module.exports = router;
