const express = require("express");
const router = express.Router();

const { listHistory, undoHistory } = require("../controllers/historyController");

router.get("/", listHistory);
router.post("/:id/undo", undoHistory);

module.exports = router;
