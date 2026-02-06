const express = require("express");
const router = express.Router();
const controller = require("../controllers/productController");

/* ❗ 순서 중요: 엑셀/바코드 → 일반 코드 */
router.get("/export.xlsx", controller.exportProductsExcel);
router.post("/import", controller.importProductsExcel);
router.get("/barcode/:barcode", controller.getProductByBarcode);

router.get("/", controller.listProducts);
router.get("/:code", controller.getProduct);

router.post("/", controller.createProduct);
router.put("/:code", controller.updateProduct);
router.delete("/:code", controller.deleteProduct);

router.post("/adjust", controller.adjustInventory);

module.exports = router;
