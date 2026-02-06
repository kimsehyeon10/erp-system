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
