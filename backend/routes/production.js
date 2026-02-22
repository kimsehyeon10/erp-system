// routes/production.js
const express = require("express");
const router  = express.Router();
const {
  getBom, saveBom,
  produce, listLots,
  sale, listSales,
  cogsReport,
} = require("../controllers/productionController");

// BOM
router.get("/bom/:productCode",  getBom);
router.put("/bom/:productCode",  saveBom);

// 생산
router.post("/produce",   produce);
router.get("/lots",       listLots);

// 판매
router.post("/sale",      sale);
router.get("/sales",      listSales);

// COGS 리포트
router.get("/cogs-report", cogsReport);

module.exports = router;
