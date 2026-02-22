const express = require("express");
const router = express.Router();

const {
  listApprovals,
  requestApproval,
  approveRequest,
  rejectRequest
} = require("../controllers/approvalController");

// 승인 요청 목록 조회
router.get("/", listApprovals);

// 새로운 승인 요청 생성 (staff가 재고 조정 요청)
router.post("/request", requestApproval);

// 승인 처리 (admin/manager만)
router.post("/:id/approve", approveRequest);

// 거부 처리 (admin/manager만)
router.post("/:id/reject", rejectRequest);

module.exports = router;
