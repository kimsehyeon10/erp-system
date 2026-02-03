import { apiGet } from "./api.js";
import { showToast } from "./utils.js";

let cachedHistory = [];

function renderTable(items) {
  const tbody = document.getElementById("historyTableBody");
  tbody.innerHTML = "";

  items.forEach((h) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(h.at).toLocaleString()}</td>
      <td>${h.productCode}</td>
      <td>${h.type}</td>
      <td>${h.delta > 0 ? "+" : ""}${h.delta}</td>
      <td>${h.user}</td>
      <td>${h.memo || ""}</td>
    `;
    tbody.appendChild(tr);
  });
}

function applyFilters() {
  const term = document.getElementById("historySearch").value.trim().toLowerCase();
  const type = document.getElementById("historyTypeFilter").value;

  const filtered = cachedHistory.filter((h) => {
    const matchSearch = `${h.productCode}`.toLowerCase().includes(term);
    const matchType = !type || h.type === type;
    return matchSearch && matchType;
  });

  renderTable(filtered);
}

export async function loadHistoryPage(force = false) {
  try {
    if (force || cachedHistory.length === 0) {
      const data = await apiGet("/history");
      cachedHistory = data.history || [];
    }

    renderTable(cachedHistory);

    document.getElementById("historySearch").oninput = applyFilters;
    document.getElementById("historyTypeFilter").onchange = applyFilters;
  } catch (err) {
    showToast(err.message, true);
  }
}
