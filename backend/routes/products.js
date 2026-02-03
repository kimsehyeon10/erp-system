const express = require("express");
const router = express.Router();

const {
  listProducts,
  getProduct,
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

router.get("/", listProducts);
router.get("/:code", getProduct);

router.post("/", createProduct);
router.put("/:code", updateProduct);
router.delete("/:code", deleteProduct);

router.post("/adjust", adjustInventory);

module.exports = router;
