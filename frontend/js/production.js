/**
 * production.js  —  ERP v8
 * BOM 관리 / 제품화(생산) / 판매 출고 / 재고 로그 / COGS 리포트
 *
 * 개선 사항:
 *  - 생산 실행 후 재고 탭 자동 갱신 (window.loadInventoryPage(true))
 *  - 판매 출고 후 재고 탭 자동 갱신
 *  - 탭 전환 시 중복 바인딩 방지 (_tabInit 플래그)
 *  - COGS 리포트 CSV 내보내기
 *  - 생산 로트 상세 모달
 */

import { apiGet, apiPost, apiPut } from "./api.js";
import { showToast, fmtMoney, showConfirm } from "./utils.js";

// ─────────────────────────────────────────────────
//  공통 유틸
// ─────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function getUser() {
  try { return JSON.parse(localStorage.getItem("authUser") || "{}"); }
  catch { return {}; }
}
function canEdit()  { const u = getUser(); return ["admin","manager"].includes(u.role); }
function canSell()  { const u = getUser(); return ["admin","manager","staff"].includes(u.role); }

function fmtDate(iso) {
  if (!iso) return "-";
  return iso.replace("T", " ").substring(0, 16);
}

function fmtPct(n) {
  return Number.isFinite(n) ? n.toFixed(1) + "%" : "-";
}

// ─────────────────────────────────────────────────
//  탭 전환
// ─────────────────────────────────────────────────
function setProdTab(tabName) {
  document.querySelectorAll(".prod-tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".prod-tab-panel").forEach(p => p.classList.remove("active"));
  const btn   = document.querySelector(`.prod-tab-btn[data-tab="${tabName}"]`);
  const panel = document.getElementById(`prodTab_${tabName}`);
  if (btn)   btn.classList.add("active");
  if (panel) panel.classList.add("active");
}

// ─────────────────────────────────────────────────
//  BOM 관리 탭
// ─────────────────────────────────────────────────
async function loadBomTab() {
  const data = await apiGet("/products");
  const bomProducts = (data.products || []).filter(p => p.productType === "bom" || p.type === "bom");
  const allProducts = data.products || [];

  const sel = el("bomProductSelect");
  sel.innerHTML = `<option value="">-- BOM 상품 선택 (유형=BOM인 상품만) --</option>` +
    bomProducts.map(p => `<option value="${p.code}">${p.code} - ${p.name}</option>`).join("");

  el("bomSaveBtn").disabled  = !canEdit();
  el("bomAddRowBtn").disabled = !canEdit();

  // 중복 바인딩 방지
  sel.onchange = async () => {
    const code = sel.value;
    if (!code) { el("bomTableBody").innerHTML = ""; return; }
    try {
      const res = await apiGet(`/production/bom/${code}`);
      renderBomRows(res.data.bomItems || [], allProducts);
    } catch (e) { showToast(e.message, true); }
  };

  el("bomAddRowBtn").onclick = () => {
    if (!canEdit()) return;
    addBomRow({}, allProducts);
  };

  el("bomSaveBtn").onclick = async () => {
    if (!canEdit()) { showToast("권한 없음", true); return; }
    const code = sel.value;
    if (!code) { showToast("BOM 상품을 선택하세요", true); return; }
    const rows = Array.from(el("bomTableBody").querySelectorAll("tr"));
    const bomItems = rows.map(tr => ({
      componentCode: tr.querySelector(".bom-comp-code").value.trim(),
      qtyPerUnit:    Number(tr.querySelector(".bom-comp-qty").value),
    })).filter(item => item.componentCode && item.qtyPerUnit > 0);

    try {
      await apiPut(`/production/bom/${code}`, { bomItems });
      showToast("✅ BOM 저장 완료");
    } catch (e) { showToast(e.message, true); }
  };
}

function renderBomRows(items, allProducts) {
  const tbody = el("bomTableBody");
  tbody.innerHTML = "";
  items.forEach(item => addBomRow(item, allProducts));
}

function addBomRow(item = {}, allProducts = []) {
  const tbody = el("bomTableBody");
  const tr = document.createElement("tr");
  const opts = allProducts.map(p =>
    `<option value="${p.code}" ${p.code === item.componentCode ? "selected" : ""}>${p.code} - ${p.name}</option>`
  ).join("");
  tr.innerHTML = `
    <td><select class="bom-comp-code" style="width:100%"><option value=""></option>${opts}</select></td>
    <td><input class="bom-comp-qty" type="number" min="0.001" step="0.001" value="${item.qtyPerUnit || 1}" style="width:90px"/></td>
    <td><button type="button" class="btn-small btn-cancel bom-del-row">삭제</button></td>
  `;
  tr.querySelector(".bom-del-row").onclick = () => tr.remove();
  tbody.appendChild(tr);
}

// ─────────────────────────────────────────────────
//  생산 실행 탭
// ─────────────────────────────────────────────────
async function loadProduceTab() {
  const data = await apiGet("/products");
  const bomProducts = (data.products || []).filter(p => p.productType === "bom" || p.type === "bom");

  const sel = el("produceProductSelect");
  sel.innerHTML = `<option value="">-- 완제품 선택 --</option>` +
    bomProducts.map(p =>
      `<option value="${p.code}">${p.code} - ${p.name} (재고: ${p.qty}${p.unit || "개"})</option>`
    ).join("");

  el("produceBtn").disabled = !canEdit();

  sel.onchange = async () => {
    const code = sel.value;
    if (!code) { el("produceNeedDiv").innerHTML = ""; return; }
    await renderProducePreview(code, data.products, Number(el("produceQty").value) || 1);
  };
  el("produceQty").oninput = async () => {
    const code = sel.value;
    if (code) await renderProducePreview(code, data.products, Number(el("produceQty").value) || 1);
  };

  el("produceBtn").onclick = async () => {
    if (!canEdit()) { showToast("권한 없음", true); return; }
    const code = sel.value;
    const qty  = Number(el("produceQty").value);
    const memo = el("produceMemo").value.trim();
    if (!code)    { showToast("완제품을 선택하세요", true); return; }
    if (qty <= 0) { showToast("생산 수량은 0 초과여야 합니다", true); return; }

    const confirmed = await showConfirm(`${code} ${qty}개 생산하시겠습니까?`, "생산 확인");
    if (!confirmed) return;

    el("produceBtn").disabled = true;
    try {
      const res = await apiPost("/production/produce", { productCode: code, qty, memo });
      showToast(`✅ ${res.message}`);
      el("produceQty").value = 1;
      el("produceMemo").value = "";
      el("produceNeedDiv").innerHTML = "";
      sel.value = "";
      await loadProduceTab();
      await loadLotsTab();
      // 재고 탭 자동 갱신
      if (typeof window.loadInventoryPage === "function") window.loadInventoryPage(true);
      if (typeof window.loadProductsPage  === "function") window.loadProductsPage(true);
    } catch (e) {
      showToast(e.message, true);
    } finally {
      el("produceBtn").disabled = !canEdit();
    }
  };
}

async function renderProducePreview(code, allProducts, qty) {
  const div = el("produceNeedDiv");
  try {
    const res = await apiGet(`/production/bom/${code}`);
    const bom = res.data.bomItems || [];
    if (bom.length === 0) {
      div.innerHTML = `<p style="color:var(--warning,#f59e0b)">⚠️ BOM이 설정되지 않았습니다.</p>`;
      el("produceBtn").disabled = true;
      return;
    }

    let html = `<table class="prod-preview-table"><thead><tr>
      <th>구성품</th><th>단위소요</th><th>필요수량</th><th>현재재고</th><th>상태</th>
    </tr></thead><tbody>`;

    let canProduce = true;
    for (const item of bom) {
      const comp   = allProducts.find(p => p.code === item.componentCode);
      const needed = item.qtyPerUnit * qty;
      const stock  = comp ? comp.qty : 0;
      const ok     = stock >= needed;
      if (!ok) canProduce = false;
      html += `<tr>
        <td>${comp ? comp.name : item.componentCode}</td>
        <td>${item.qtyPerUnit}</td>
        <td><strong>${needed}</strong></td>
        <td>${stock}</td>
        <td>${ok
          ? '<span style="color:var(--success,#22c55e)">✔ 충분</span>'
          : '<span style="color:var(--danger,#ef4444)">✘ 부족</span>'}</td>
      </tr>`;
    }
    html += `</tbody></table>`;
    if (!canProduce) html += `<p style="color:var(--danger,#ef4444);margin-top:8px">⛔ 원자재 재고 부족으로 생산 불가</p>`;
    div.innerHTML = html;
    el("produceBtn").disabled = !canProduce || !canEdit();
  } catch (e) {
    div.innerHTML = `<p style="color:var(--danger,#ef4444)">${e.message}</p>`;
  }
}

// ─────────────────────────────────────────────────
//  생산 로트 탭
// ─────────────────────────────────────────────────
async function loadLotsTab() {
  try {
    const qFrom = el("lotsFrom")?.value || "";
    const qTo   = el("lotsTo")?.value   || "";
    const params = new URLSearchParams();
    if (qFrom) params.set("from", qFrom);
    if (qTo)   params.set("to",   qTo);

    const res  = await apiGet(`/production/lots?${params}`);
    const lots = res.data || [];
    const tbody = el("lotsTableBody");
    if (lots.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-secondary)">생산 기록이 없습니다</td></tr>`;
      return;
    }
    tbody.innerHTML = lots.map(l => `
      <tr class="lot-row" data-id="${l.id}" style="cursor:pointer" title="클릭하면 상세보기">
        <td style="font-size:11px;color:var(--text-secondary)">${l.id}</td>
        <td>${l.productCode}</td>
        <td>${l.producedQty}</td>
        <td>${fmtMoney(l.unitCost)}</td>
        <td>${fmtMoney(l.totalCost)}</td>
        <td>${l.memo || "-"}</td>
        <td>${l.userId}</td>
        <td>${fmtDate(l.timestamp)}</td>
      </tr>
    `).join("");

    // 로트 행 클릭 → BOM 스냅샷 상세
    tbody.querySelectorAll(".lot-row").forEach(tr => {
      tr.onclick = () => {
        const lot = lots.find(l => l.id === tr.dataset.id);
        if (lot) showLotDetail(lot);
      };
    });
  } catch (e) { showToast(e.message, true); }
}

function showLotDetail(lot) {
  el("ledgerDetailContent").textContent = JSON.stringify({
    lotId:       lot.id,
    productCode: lot.productCode,
    producedQty: lot.producedQty,
    unitCost:    lot.unitCost,
    totalCost:   lot.totalCost,
    bomSnapshot: lot.bomSnapshot,
    memo:        lot.memo,
    timestamp:   lot.timestamp,
    userId:      lot.userId,
  }, null, 2);
  el("ledgerDetailId").textContent = `생산로트 ${lot.id}`;
  el("ledgerDetailModal").classList.add("active");
}

// ─────────────────────────────────────────────────
//  판매 출고 탭
// ─────────────────────────────────────────────────
async function loadSaleTab() {
  const data = await apiGet("/products");
  const allProducts = data.products || [];

  const sel = el("saleProductSelect");
  sel.innerHTML = `<option value="">-- 상품 선택 --</option>` +
    allProducts.map(p =>
      `<option value="${p.code}">${p.code} - ${p.name} (재고: ${p.qty}${p.unit || "개"})</option>`
    ).join("");

  el("saleBtn").disabled = !canSell();

  el("saleBtn").onclick = async () => {
    if (!canSell()) { showToast("권한 없음", true); return; }
    const code      = sel.value;
    const qty       = Number(el("saleQty").value);
    const salePrice = Number(el("salePriceInput").value || 0);
    const memo      = el("saleMemo").value.trim();
    if (!code)    { showToast("상품을 선택하세요", true); return; }
    if (qty <= 0) { showToast("판매 수량은 0 초과여야 합니다", true); return; }

    const confirmed = await showConfirm(`${code} ${qty}개 판매 출고하시겠습니까?`, "판매 확인");
    if (!confirmed) return;

    el("saleBtn").disabled = true;
    try {
      const res = await apiPost("/production/sale", { productCode: code, qty, salePrice, memo });
      showToast(`✅ ${res.message}`);
      el("saleQty").value        = 1;
      el("salePriceInput").value = "";
      el("saleMemo").value       = "";
      sel.value = "";
      await loadSaleTab();
      // 재고 탭 자동 갱신
      if (typeof window.loadInventoryPage === "function") window.loadInventoryPage(true);
      if (typeof window.loadProductsPage  === "function") window.loadProductsPage(true);
    } catch (e) {
      showToast(e.message, true);
    } finally {
      el("saleBtn").disabled = !canSell();
    }
  };

  await loadSalesListTab();
}

async function loadSalesListTab() {
  try {
    const res   = await apiGet("/production/sales");
    const sales = res.data || [];
    const tbody = el("salesListTableBody");
    if (sales.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-secondary)">판매 기록이 없습니다</td></tr>`;
      return;
    }
    tbody.innerHTML = sales.map(s => `
      <tr>
        <td>${s.productCode}</td>
        <td>${s.qty}</td>
        <td>${fmtMoney(s.salePrice)}</td>
        <td>${fmtMoney(s.revenue)}</td>
        <td>${fmtMoney(s.cogs)}</td>
        <td style="color:${s.grossProfit >= 0 ? "var(--success,#22c55e)" : "var(--danger,#ef4444)"};font-weight:600">${fmtMoney(s.grossProfit)}</td>
        <td>${fmtDate(s.timestamp)}</td>
      </tr>
    `).join("");
  } catch (e) { showToast(e.message, true); }
}

// ─────────────────────────────────────────────────
//  재고 로그 탭
// ─────────────────────────────────────────────────
let ledgerFilter = { type: "", sku: "", from: "", to: "" };

async function loadLedgerTab() {
  // 필터 이벤트 바인딩 (중복 방지: onchange/oninput 재할당은 자동으로 덮어씀)
  el("ledgerTypeFilter").onchange = () => { ledgerFilter.type = el("ledgerTypeFilter").value; fetchLedger(); };
  el("ledgerSkuFilter").oninput   = () => { ledgerFilter.sku  = el("ledgerSkuFilter").value.trim(); };
  el("ledgerFromFilter").onchange = () => { ledgerFilter.from = el("ledgerFromFilter").value; fetchLedger(); };
  el("ledgerToFilter").onchange   = () => { ledgerFilter.to   = el("ledgerToFilter").value; fetchLedger(); };
  el("ledgerSearchBtn").onclick   = fetchLedger;
  await fetchLedger();
}

async function fetchLedger() {
  try {
    const params = new URLSearchParams();
    if (ledgerFilter.type) params.set("type", ledgerFilter.type);
    if (ledgerFilter.sku)  params.set("sku",  ledgerFilter.sku);
    if (ledgerFilter.from) params.set("from", ledgerFilter.from);
    if (ledgerFilter.to)   params.set("to",   ledgerFilter.to);
    params.set("limit", 200);

    const res = await apiGet(`/ledger?${params}`);
    const { items = [], total = 0 } = res.data || {};
    el("ledgerTotal").textContent = `총 ${total}건`;

    const tbody = el("ledgerTableBody");
    if (items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-secondary)">로그가 없습니다</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map(e => {
      const sign  = e.qtyChange > 0 ? "+" : "";
      const color = e.qtyChange > 0 ? "var(--success,#22c55e)" : "var(--danger,#ef4444)";
      const badge = `badge badge-ledger-${e.type.toLowerCase()}`;
      return `<tr class="ledger-row" data-id="${e.id}">
        <td style="font-size:11px">${fmtDate(e.timestamp)}</td>
        <td><span class="${badge}">${e.type}</span></td>
        <td>${e.sku}</td>
        <td style="color:${color};font-weight:700">${sign}${e.qtyChange}</td>
        <td>${e.qtyBefore}</td>
        <td>${e.qtyAfter}</td>
        <td>${e.reason || "-"}</td>
        <td>${e.userId || "-"}</td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll(".ledger-row").forEach(tr => {
      tr.onclick = () => showLedgerDetail(items.find(e => e.id === tr.dataset.id));
    });
  } catch (e) { showToast(e.message, true); }
}

function showLedgerDetail(entry) {
  if (!entry) return;
  el("ledgerDetailContent").textContent = JSON.stringify(entry, null, 2);
  el("ledgerDetailId").textContent      = entry.id;
  el("ledgerDetailModal").classList.add("active");
}

// ─────────────────────────────────────────────────
//  COGS 리포트 탭
// ─────────────────────────────────────────────────
let _lastCogsData = null;

async function loadCogsTab() {
  el("cogsReportBtn").onclick    = fetchCogsReport;
  el("cogsExportCsvBtn").onclick = exportCogsCsv;
  await fetchCogsReport();
}

async function fetchCogsReport() {
  try {
    const from   = el("cogsFrom").value;
    const to     = el("cogsTo").value;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to)   params.set("to",   to);

    const res  = await apiGet(`/production/cogs-report?${params}`);
    const data = res.data || {};
    _lastCogsData = data;
    const s    = data.summary || {};

    el("cogsRevenue").textContent     = fmtMoney(s.totalRevenue     || 0);
    el("cogsCogs").textContent        = fmtMoney(s.totalCogs        || 0);
    el("cogsGrossProfit").textContent = fmtMoney(s.totalGrossProfit || 0);
    el("cogsMargin").textContent      = fmtPct(parseFloat(s.grossMarginPct));
    el("cogsProdCost").textContent    = fmtMoney(s.totalProductionCost || 0);
    el("cogsProdQty").textContent     = (s.totalProducedQty  || 0) + "개";
    el("cogsSaleQty").textContent     = (s.totalSaleQty      || 0) + "개";

    const tbody = el("cogsByProductBody");
    const byP   = data.byProduct || [];
    if (byP.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-secondary)">데이터 없음</td></tr>`;
    } else {
      tbody.innerHTML = byP.map(p => {
        const margin = p.revenue > 0 ? (p.grossProfit / p.revenue * 100).toFixed(1) + "%" : "-";
        return `<tr>
          <td>${p.productCode}</td>
          <td>${p.productName}</td>
          <td>${p.qty}</td>
          <td>${fmtMoney(p.revenue)}</td>
          <td>${fmtMoney(p.cogs)}</td>
          <td style="color:${p.grossProfit >= 0 ? "var(--success,#22c55e)" : "var(--danger,#ef4444)"};font-weight:600">
            ${fmtMoney(p.grossProfit)} <small style="font-weight:400;font-size:11px">(${margin})</small>
          </td>
        </tr>`;
      }).join("");
    }
  } catch (e) { showToast(e.message, true); }
}

function exportCogsCsv() {
  if (!_lastCogsData) { showToast("먼저 조회하세요", true); return; }
  const byP = _lastCogsData.byProduct || [];
  const rows = [
    ["코드", "상품명", "판매수량", "매출(원)", "COGS(원)", "매출이익(원)", "이익률(%)"],
    ...byP.map(p => [
      p.productCode, p.productName, p.qty,
      p.revenue, p.cogs, p.grossProfit,
      p.revenue > 0 ? (p.grossProfit / p.revenue * 100).toFixed(1) : 0,
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `cogs_report_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("✅ CSV 내보내기 완료");
}

// ─────────────────────────────────────────────────
//  메인 진입점 (auth.js에서 호출)
// ─────────────────────────────────────────────────
export async function loadProductionPage() {
  // 탭 버튼 이벤트 (매번 재바인딩 — onlick 덮어쓰기로 중복 방지)
  document.querySelectorAll(".prod-tab-btn").forEach(btn => {
    btn.onclick = async () => {
      const tab = btn.dataset.tab;
      setProdTab(tab);
      if      (tab === "bom")     await loadBomTab();
      else if (tab === "produce") await loadProduceTab();
      else if (tab === "lots")    await loadLotsTab();
      else if (tab === "sale")    await loadSaleTab();
      else if (tab === "ledger")  await loadLedgerTab();
      else if (tab === "cogs")    await loadCogsTab();
    };
  });

  // 레저 상세 모달 닫기
  const closeModal = () => el("ledgerDetailModal")?.classList.remove("active");
  el("closeLedgerDetailModal")?.addEventListener("click", closeModal);
  el("ledgerDetailModal")?.addEventListener("click", e => {
    if (e.target === el("ledgerDetailModal")) closeModal();
  });

  // 기본 탭: BOM 관리
  setProdTab("bom");
  await loadBomTab();
}

// socket.js의 syncAllTabs에서 자동 갱신 지원
window.loadProductionPage = loadProductionPage;
