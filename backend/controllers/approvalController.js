const { readDB, writeDB, nowISO, genId } = require("../config/database");
const { getIO, emitInventoryUpdate } = require("../utils/socketHelper");

function requireAuth(req, res) {
  const username = req.headers["x-user"];
  const role = req.headers["x-role"];
  if (!username || !role) {
    res.status(401).json({ ok: false, message: "Missing auth headers" });
    return null;
  }
  return { username, role };
}

function roleAllowed(role, allowedRoles) {
  return allowedRoles.includes(role);
}

// 승인 요청 목록 조회
function listApprovals(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  
  // 승인 요청 목록 초기화 (없으면 생성)
  if (!db.approvals) db.approvals = [];

  // 역할별 필터링
  let approvals = db.approvals;
  if (auth.role === "staff") {
    // staff는 자기가 요청한 것만 조회
    approvals = db.approvals.filter(a => a.requestedBy === auth.username);
  }

  return res.json({ ok: true, approvals });
}

// 새로운 승인 요청 생성
function requestApproval(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { productCode, type, delta, memo, reason } = req.body || {};

  if (!productCode || !type || !delta) {
    return res.status(400).json({ 
      ok: false, 
      message: "productCode, type, delta required" 
    });
  }

  const db = readDB();
  if (!db.approvals) db.approvals = [];

  // 상품 존재 확인
  const product = db.products.find(p => p.code === productCode);
  if (!product) {
    return res.status(404).json({ ok: false, message: "Product not found" });
  }

  // 승인 요청 생성
  const approval = {
    id: genId("APR"),
    productCode,
    productName: product.name,
    type, // IN, OUT, ADJUST
    delta: Number(delta),
    memo: memo || "",
    reason: reason || "재고 조정 필요",
    requestedBy: auth.username,
    requestedAt: nowISO(),
    status: "pending", // pending, approved, rejected
    reviewedBy: null,
    reviewedAt: null,
    aiRecommendation: generateAIRecommendation(product, type, delta)
  };

  db.approvals.push(approval);
  writeDB(db);

  // 실시간 알림 전송 (admin/manager에게)
  const io = req.io;
  if (io) {
    io.emit("approval:new", {
      message: `${auth.username}님이 ${productCode} 재고 조정을 요청했습니다.`,
      approval
    });
  }

  return res.status(201).json({ ok: true, approval });
}

// 승인 처리
function approveRequest(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({ 
      ok: false, 
      message: "Only admin/manager can approve" 
    });
  }

  const approvalId = req.params.id;
  const db = readDB();

  if (!db.approvals) db.approvals = [];
  
  const approvalIdx = db.approvals.findIndex(a => a.id === approvalId);
  if (approvalIdx === -1) {
    return res.status(404).json({ ok: false, message: "Approval not found" });
  }

  const approval = db.approvals[approvalIdx];
  
  if (approval.status !== "pending") {
    return res.status(400).json({ 
      ok: false, 
      message: `Already ${approval.status}` 
    });
  }

  // 재고 조정 실행
  const productIdx = db.products.findIndex(p => p.code === approval.productCode);
  if (productIdx === -1) {
    return res.status(404).json({ ok: false, message: "Product not found" });
  }

  const product = db.products[productIdx];
  let nextQty = product.qty;

  if (approval.type === "IN") {
    nextQty = product.qty + Math.abs(approval.delta);
  } else if (approval.type === "OUT") {
    nextQty = product.qty - Math.abs(approval.delta);
  } else if (approval.type === "ADJUST") {
    nextQty = product.qty + approval.delta;
  }

  if (nextQty < 0) {
    return res.status(400).json({ 
      ok: false, 
      message: "Not enough stock" 
    });
  }

  // 재고 업데이트
  db.products[productIdx] = { ...product, qty: nextQty, updatedAt: nowISO() };

  // 이력 기록
  const appliedDelta = approval.type === "IN" 
    ? Math.abs(approval.delta) 
    : approval.type === "OUT" 
    ? -Math.abs(approval.delta) 
    : approval.delta;

  db.history.unshift({
    id: genId("H"),
    productCode: approval.productCode,
    type: approval.type,
    delta: appliedDelta,
    memo: `[승인됨] ${approval.memo}`,
    user: approval.requestedBy,
    approvedBy: auth.username,
    at: nowISO()
  });

  // 승인 상태 업데이트
  db.approvals[approvalIdx] = {
    ...approval,
    status: "approved",
    reviewedBy: auth.username,
    reviewedAt: nowISO()
  };

  writeDB(db);

  // 실시간 알림
  const io = req.io;
  if (io) {
    io.emit("inventory:update", {
      message: `${approval.productCode} 재고가 변경되었습니다.`,
      product: db.products[productIdx]
    });

    io.emit("approval:approved", {
      message: `${auth.username}님이 승인 요청을 승인했습니다.`,
      approval: db.approvals[approvalIdx]
    });
  }

  return res.json({ 
    ok: true, 
    approval: db.approvals[approvalIdx],
    product: db.products[productIdx]
  });
}

// 거부 처리
function rejectRequest(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({ 
      ok: false, 
      message: "Only admin/manager can reject" 
    });
  }

  const approvalId = req.params.id;
  const { rejectReason } = req.body || {};

  const db = readDB();
  if (!db.approvals) db.approvals = [];

  const approvalIdx = db.approvals.findIndex(a => a.id === approvalId);
  if (approvalIdx === -1) {
    return res.status(404).json({ ok: false, message: "Approval not found" });
  }

  const approval = db.approvals[approvalIdx];

  if (approval.status !== "pending") {
    return res.status(400).json({ 
      ok: false, 
      message: `Already ${approval.status}` 
    });
  }

  db.approvals[approvalIdx] = {
    ...approval,
    status: "rejected",
    reviewedBy: auth.username,
    reviewedAt: nowISO(),
    rejectReason: rejectReason || "관리자 판단에 의해 거부됨"
  };

  writeDB(db);

  // 실시간 알림
  const io = req.io;
  if (io) {
    io.emit("approval:rejected", {
      message: `${auth.username}님이 승인 요청을 거부했습니다.`,
      approval: db.approvals[approvalIdx]
    });
  }

  return res.json({ ok: true, approval: db.approvals[approvalIdx] });
}

// AI 추천 생성 (요약/탐지/추천만, 절대 자동 변경 금지)
function generateAIRecommendation(product, type, delta) {
  const recommendations = [];
  
  // 재고 부족 경고
  if (type === "OUT") {
    const afterQty = product.qty - Math.abs(delta);
    if (afterQty < product.safetyStock) {
      recommendations.push({
        level: "warning",
        message: "출고 후 안전재고 미달 예상",
        suggestion: "긴급 발주 검토 필요"
      });
    }
  }

  // 과다 입고 경고
  if (type === "IN") {
    const afterQty = product.qty + Math.abs(delta);
    if (afterQty > product.safetyStock * 3) {
      recommendations.push({
        level: "info",
        message: "재고가 안전재고의 3배 초과 예상",
        suggestion: "창고 공간 확보 필요"
      });
    }
  }

  // 기본 추천
  if (recommendations.length === 0) {
    recommendations.push({
      level: "success",
      message: "정상적인 재고 조정입니다",
      suggestion: "승인 권장"
    });
  }

  return {
    summary: `${product.name} (${product.code}) - ${type} ${delta}개`,
    currentStock: product.qty,
    safetyStock: product.safetyStock,
    recommendations
  };
}

module.exports = {
  listApprovals,
  requestApproval,
  approveRequest,
  rejectRequest
};
