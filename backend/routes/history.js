const express = require("express");
const router = express.Router();

const { listHistory, cancelHistory } = require("../controllers/historyController");

router.get("/", listHistory);
router.post("/:id/cancel", cancelHistory);

module.exports = router;
