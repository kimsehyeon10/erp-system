// routes/ledger.js
const express = require("express");
const router  = express.Router();
const { listLedger, getLedgerEntry } = require("../controllers/ledgerController");

router.get("/",    listLedger);
router.get("/:id", getLedgerEntry);

module.exports = router;
