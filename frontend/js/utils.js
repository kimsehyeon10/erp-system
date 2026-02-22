export function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("active");

  if (isError) toast.classList.add("error");
  else toast.classList.remove("error");

  setTimeout(() => toast.classList.remove("active"), 2500);
}

export function fmtMoney(n) {
  const num = Number(n || 0);
  return num.toLocaleString() + "원";
}

export function badgeStatus(qty, safetyStock) {
  if (qty === 0) return { cls: "badge-danger", text: "품절" };
  if (qty < safetyStock) return { cls: "badge-warning", text: "재고부족" };
  return { cls: "badge-success", text: "정상" };
}

export function setActivePage(pageName) {
  document.querySelectorAll(".menu-item").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));

  const menu = document.querySelector(`.menu-item[data-page="${pageName}"]`);
  if (menu) menu.classList.add("active");

  const page = document.getElementById(pageName + "Page");
  if (page) page.classList.add("active");
}

// Custom confirm dialog
export function showConfirm(message, title = "확인") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const titleEl = document.getElementById("confirmModalTitle");
    const messageEl = document.getElementById("confirmModalMessage");
    const okBtn = document.getElementById("confirmOkBtn");
    const cancelBtn = document.getElementById("confirmCancelBtn");
    const closeBtn = document.getElementById("closeConfirmModal");

    // ✅ 모달 DOM이 없으면(또는 일부가 누락되면) 네이티브 confirm로 폴백
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn || !closeBtn) {
      const ok = window.confirm(`${title}\n\n${message}`);
      resolve(ok);
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add("active");

    const cleanup = () => {
      modal.classList.remove("active");
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
    };

    okBtn.onclick = () => {
      cleanup();
      resolve(true);
    };
    cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
    closeBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}
