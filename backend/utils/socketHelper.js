// Socket.IO 유틸리티
let io = null;

function setIO(ioInstance) {
  io = ioInstance;
}

function getIO() {
  return io;
}

// 재고 변경 실시간 알림
function emitInventoryUpdate(product) {
  if (io) {
    io.emit("inventory:update", {
      message: `${product.code} 재고가 변경되었습니다.`,
      product
    });
  }
}

// 승인 요청 알림
function emitApprovalRequest(approval, requester) {
  if (io) {
    io.emit("approval:new", {
      message: `${requester}님이 재고 조정을 요청했습니다.`,
      approval
    });
  }
}

// AI 알림
function emitAIAlert(alert) {
  if (io) {
    io.emit("ai:alert", alert);
  }
}

module.exports = {
  setIO,
  getIO,
  emitInventoryUpdate,
  emitApprovalRequest,
  emitAIAlert
};
