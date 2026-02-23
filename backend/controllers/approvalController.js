const { readDB, writeDB, nowISO, genId } = require("../config/database");
const { getIO, emitInventoryUpdate } = require("../utils/socketHelper");
const { withTransaction, findUserIdByUsername, dbErrorMessage } = require("../config/postgres");

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
async function approveRequest(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({
      ok: false,
      message: "Only admin/manager can approve"
    });
  }

  const approvalId = Number(req.params.id);
  if (!Number.isInteger(approvalId)) {
    return res.status(400).json({ ok: false, message: "Invalid approval id" });
  }

  try {
    const data = await withTransaction(async (client) => {
      const approvalRes = await client.query(
        `SELECT a.id, a.product_id, a.type, a.delta, a.reason, a.status,
                a.requested_by, a.reviewed_by, a.requested_at, a.reviewed_at,
                p.code AS product_code, p.name AS product_name, p.qty_on_hand
           FROM approvals a
           JOIN products p ON p.id = a.product_id
          WHERE a.id = $1
          FOR UPDATE`,
        [approvalId]
      );

      if (approvalRes.rowCount === 0) {
        const err = new Error("Approval not found");
        err.status = 404;
        throw err;
      }

      const approval = approvalRes.rows[0];
      if (approval.status !== "PENDING") {
        const err = new Error(`Already ${String(approval.status).toLowerCase()}`);
        err.status = 400;
        throw err;
      }

      const baseQty = Number(approval.qty_on_hand);
      let nextQty = baseQty;
      const type = approval.type;
      const delta = Number(approval.delta);

      if (type === "IN") nextQty = baseQty + Math.abs(delta);
      else if (type === "OUT") nextQty = baseQty - Math.abs(delta);
      else if (type === "ADJUST") nextQty = baseQty + delta;

      if (nextQty < 0) {
        const err = new Error("Not enough stock");
        err.status = 400;
        throw err;
      }

      const appliedDelta = type === "IN" ? Math.abs(delta) : type === "OUT" ? -Math.abs(delta) : delta;
      const reviewerUserId = await findUserIdByUsername(client, auth.username);

      await client.query(
        `UPDATE products
            SET qty_on_hand = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [nextQty, approval.product_id]
      );

      await client.query(
        `INSERT INTO inventory_transactions
          (product_id, tx_type, qty_delta, memo, requested_by, approved_by, happened_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          approval.product_id,
          type,
          appliedDelta,
          `[승인됨] ${approval.reason || ""}`,
          approval.requested_by,
          reviewerUserId,
        ]
      );

      const updatedApprovalRes = await client.query(
        `UPDATE approvals
            SET status = 'APPROVED',
                reviewed_by = $2,
                reviewed_at = NOW()
          WHERE id = $1
        RETURNING id, product_id, type, delta, reason, status, requested_by, reviewed_by, requested_at, reviewed_at`,
        [approvalId, reviewerUserId]
      );

      return {
        approval: updatedApprovalRes.rows[0],
        product: {
          code: approval.product_code,
          name: approval.product_name,
          qty: nextQty,
          qty_on_hand: nextQty,
        },
      };
    });

    const io = req.io;
    if (io) {
      io.emit("inventory:update", {
        message: `${data.product.code} 재고가 변경되었습니다.`,
        product: data.product,
      });

      io.emit("approval:approved", {
        message: `${auth.username}님이 승인 요청을 승인했습니다.`,
        approval: data.approval,
      });
    }

    return res.json({
      ok: true,
      approval: data.approval,
      product: data.product,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ ok: false, message: err.message });
    }
    console.error("[POST /approvals/:id/approve]", err);
    return res.status(500).json({ ok: false, message: dbErrorMessage(err) });
  }
}

// 거부 처리
async function rejectRequest(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (!roleAllowed(auth.role, ["admin", "manager"])) {
    return res.status(403).json({
      ok: false,
      message: "Only admin/manager can reject"
    });
  }

  const approvalId = Number(req.params.id);
  if (!Number.isInteger(approvalId)) {
    return res.status(400).json({ ok: false, message: "Invalid approval id" });
  }

  const { rejectReason } = req.body || {};

  try {
    const approval = await withTransaction(async (client) => {
      const approvalRes = await client.query(
        `SELECT id, status FROM approvals WHERE id = $1 FOR UPDATE`,
        [approvalId]
      );

      if (approvalRes.rowCount === 0) {
        const err = new Error("Approval not found");
        err.status = 404;
        throw err;
      }

      if (approvalRes.rows[0].status !== "PENDING") {
        const err = new Error(`Already ${String(approvalRes.rows[0].status).toLowerCase()}`);
        err.status = 400;
        throw err;
      }

      const reviewerUserId = await findUserIdByUsername(client, auth.username);
      const updated = await client.query(
        `UPDATE approvals
            SET status = 'REJECTED',
                reviewed_by = $2,
                reviewed_at = NOW(),
                reason = COALESCE(NULLIF($3, ''), reason)
          WHERE id = $1
        RETURNING id, product_id, type, delta, reason, status, requested_by, reviewed_by, requested_at, reviewed_at`,
        [approvalId, reviewerUserId, rejectReason || ""]
      );
      return updated.rows[0];
    });

    const io = req.io;
    if (io) {
      io.emit("approval:rejected", {
        message: `${auth.username}님이 승인 요청을 거부했습니다.`,
        approval,
      });
    }

    return res.json({ ok: true, approval });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ ok: false, message: err.message });
    }
    console.error("[POST /approvals/:id/reject]", err);
    return res.status(500).json({ ok: false, message: dbErrorMessage(err) });
  }
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
