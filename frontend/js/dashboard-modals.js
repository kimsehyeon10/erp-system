// dashboard-modals.js - 대시보드 모달 관리

let dashboardProductsData = []; // 전역 데이터 저장

// 모달 열기/닫기 함수들
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'block';
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

// API에서 상품 데이터 가져오기
async function fetchProductsData() {
  try {
    // API 모듈을 동적으로 import
    const apiModule = await import('./api.js');
    const data = await apiModule.apiGet('/products');
    return data.products || [];
  } catch (err) {
    console.error('상품 데이터 로드 실패:', err);
    return [];
  }
}

// 1. 전체 상품 목록 모달 렌더링
function renderAllProductsModal(products) {
  const listContainer = document.getElementById('allProductsList');
  if (!listContainer) return;

  if (!products || products.length === 0) {
    listContainer.innerHTML = '<p style="text-align:center; padding:20px; color:#666;">상품이 없습니다</p>';
    return;
  }

  const html = products.map(p => {
    const qty = Number(p.qty || 0);
    const safetyStock = Number(p.safetyStock || 0);
    
    let statusClass = 'normal';
    let statusText = '정상';
    if (qty < safetyStock) {
      statusClass = 'critical';
      statusText = '긴급';
    } else if (qty < safetyStock * 2) {
      statusClass = 'warning';
      statusText = '부족';
    }

    return `
      <div class="product-item">
        <div class="product-item-left">
          <div class="product-item-code">${p.code || '-'}</div>
          <div class="product-item-name">${p.name || '-'}</div>
          <div class="product-item-info">
            <span class="product-category">${p.category || '기타'}</span>
            <span class="product-qty">재고: ${qty}개</span>
          </div>
        </div>
        <span class="status-badge ${statusClass}">${statusText}</span>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = html;
}

// 2. 재고 상세 모달 렌더링
function renderStockDetailModal(products) {
  const listContainer = document.getElementById('stockDetailList');
  if (!listContainer) return;

  if (!products || products.length === 0) {
    listContainer.innerHTML = '<p style="text-align:center; padding:20px; color:#666;">상품이 없습니다</p>';
    return;
  }

  // 총 재고와 상품 수 업데이트
  const totalStock = products.reduce((sum, p) => sum + Number(p.qty || 0), 0);
  const totalProducts = products.length;
  
  const totalStockEl = document.getElementById('modalTotalStock');
  const totalProductsEl = document.getElementById('modalTotalProducts');
  
  if (totalStockEl) totalStockEl.textContent = `${totalStock}개`;
  if (totalProductsEl) totalProductsEl.textContent = `${totalProducts}개`;

  // 재고량 기준으로 정렬
  const sortedProducts = [...products].sort((a, b) => Number(b.qty || 0) - Number(a.qty || 0));

  const html = sortedProducts.map(p => {
    const qty = Number(p.qty || 0);
    const maxQty = Math.max(...products.map(p => Number(p.qty || 0)));
    const percentage = maxQty > 0 ? (qty / maxQty * 100) : 0;

    return `
      <div class="stock-detail-item">
        <div class="stock-detail-header">
          <div>
            <div class="stock-detail-title">${p.name || '-'}</div>
            <div class="stock-detail-code">(${p.code || '-'})</div>
          </div>
          <div class="stock-detail-qty">${qty}개</div>
        </div>
        <div class="stock-progress-bar" style="width: ${percentage}%"></div>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = html;
}

// 3. 부족한 재고 목록 모달 렌더링
function renderLowStockModal(products) {
  const listContainer = document.getElementById('lowStockList');
  if (!listContainer) return;

  if (!products || products.length === 0) {
    listContainer.innerHTML = '<p style="text-align:center; padding:20px; color:#666;">상품이 없습니다</p>';
    return;
  }

  // 안전재고 미달 상품만 필터링
  const lowStockProducts = products.filter(p => {
    const qty = Number(p.qty || 0);
    const safetyStock = Number(p.safetyStock || 0);
    return qty < safetyStock;
  });

  if (lowStockProducts.length === 0) {
    listContainer.innerHTML = '<p style="text-align:center; padding:20px; color:#10b981; font-weight:600;">✓ 모든 상품이 안전재고를 충족하고 있습니다</p>';
    return;
  }

  const html = lowStockProducts.map(p => {
    const qty = Number(p.qty || 0);
    const safetyStock = Number(p.safetyStock || 0);
    const optimalStock = safetyStock * 2;
    const shortage = safetyStock - qty;

    let statusClass = 'critical';
    let statusText = '긴급';

    return `
      <div class="low-stock-item">
        <div class="low-stock-item-content">
          <div class="low-stock-item-header">
            <div>
              <div class="low-stock-item-title">${p.name || '-'}</div>
            </div>
            <span class="status-badge ${statusClass}">${statusText}</span>
          </div>
          <div class="low-stock-item-info">
            상품코드: ${p.code || '-'}<br>
            카테고리: ${p.category || '기타'}
          </div>
          <div class="low-stock-item-stats">
            <span>현재 재고: <span class="text-red">${qty}개</span></span>
            <span>필요 재고: <span class="text-orange">${safetyStock}개</span></span>
            <span>부족: <span class="text-red">${shortage}개</span></span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  listContainer.innerHTML = html;
}

// 모달 이벤트 리스너 등록
export function initDashboardModals() {
  // 통계 카드 클릭 이벤트
  const statCardAllProducts = document.getElementById('statCardAllProducts');
  const statCardTotalQty = document.getElementById('statCardTotalQty');
  const statCardLowStock = document.getElementById('statCardLowStock');

  if (statCardAllProducts) {
    statCardAllProducts.addEventListener('click', async () => {
      // API에서 최신 데이터 가져오기
      const products = await fetchProductsData();
      renderAllProductsModal(products);
      openModal('allProductsModal');
    });
  }

  if (statCardTotalQty) {
    statCardTotalQty.addEventListener('click', async () => {
      // API에서 최신 데이터 가져오기
      const products = await fetchProductsData();
      renderStockDetailModal(products);
      openModal('stockDetailModal');
    });
  }

  if (statCardLowStock) {
    statCardLowStock.addEventListener('click', async () => {
      // API에서 최신 데이터 가져오기
      const products = await fetchProductsData();
      renderLowStockModal(products);
      openModal('lowStockModal');
    });
  }

  // 닫기 버튼 이벤트
  const closeAllProductsBtn = document.getElementById('closeAllProductsModal');
  const closeStockDetailBtn = document.getElementById('closeStockDetailModal');
  const closeLowStockBtn = document.getElementById('closeLowStockModal');

  if (closeAllProductsBtn) {
    closeAllProductsBtn.addEventListener('click', () => closeModal('allProductsModal'));
  }
  if (closeStockDetailBtn) {
    closeStockDetailBtn.addEventListener('click', () => closeModal('stockDetailModal'));
  }
  if (closeLowStockBtn) {
    closeLowStockBtn.addEventListener('click', () => closeModal('lowStockModal'));
  }

  // 모달 외부 클릭 시 닫기
  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
      e.target.style.display = 'none';
    }
  });
}

// 데이터 업데이트 함수 (외부에서 호출)
export function updateDashboardModalsData(products) {
  dashboardProductsData = products || [];
}

// window에 함수 등록 (index.html의 차트 스크립트에서 사용)
if (typeof window !== 'undefined') {
  window.updateDashboardModalsData = updateDashboardModalsData;
}
