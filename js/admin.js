/**
 * TSATSAKPORNU POS - ADMIN MANAGEMENT & PERFORMANCE DASHBOARD
 * Calculates Net Profit, COGS, Revenue, Salesperson Performance Leaderboards, Inventory CRUD, and Sales Audit.
 */

class AdminService {
  constructor() {
    this.sales = [];
    this.products = [];
    this.selectedPeriod = 'all'; // 'today', 'week', 'month', 'all'
    this.chartInstance = null;
    this.salespersonChartInstance = null;
    this.inventorySearchQuery = '';
    this.salesAuditSearchQuery = '';
  }

  async init() {
    await this.refresh();
  }

  async refresh() {
    this.sales = await window.dataService.getSales();
    this.products = await window.dataService.getProducts();
    this.renderMetrics();
    this.renderSalespersonPerformance();
    this.renderCharts();
    this.renderInventoryTable();
    this.renderSalesAudit();
  }

  setPeriod(period) {
    this.selectedPeriod = period;
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.period === period);
    });
    this.renderMetrics();
    this.renderSalespersonPerformance();
    this.renderCharts();
  }

  getFilteredSales() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    return this.sales.filter(s => {
      const saleDate = new Date(s.created_at);
      if (this.selectedPeriod === 'today') {
        return saleDate.toISOString().slice(0, 10) === todayStr;
      } else if (this.selectedPeriod === 'week') {
        return saleDate >= sevenDaysAgo;
      } else if (this.selectedPeriod === 'month') {
        return saleDate >= thirtyDaysAgo;
      }
      return true; // 'all'
    });
  }

  /* ================= 1. FINANCIAL METRICS & NET PROFIT ================= */
  renderMetrics() {
    const filtered = this.getFilteredSales();

    let totalRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let totalOrders = filtered.length;

    for (const sale of filtered) {
      totalRevenue += Number(sale.total_revenue) || 0;
      totalCost += Number(sale.total_cost) || 0;
      totalProfit += Number(sale.net_profit) || 0;
    }

    const marginPercent = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100).toFixed(1) : '0.0';

    // Update DOM
    const revEl = document.getElementById('metricTotalRevenue');
    const costEl = document.getElementById('metricTotalCost');
    const profitEl = document.getElementById('metricNetProfit');
    const marginEl = document.getElementById('metricMarginPercent');
    const ordersEl = document.getElementById('metricTotalOrders');

    if (revEl) revEl.textContent = `₵${totalRevenue.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (costEl) costEl.textContent = `₵${totalCost.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (profitEl) profitEl.textContent = `₵${totalProfit.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (marginEl) marginEl.textContent = `${marginPercent}% Margin`;
    if (ordersEl) ordersEl.textContent = totalOrders.toString();

    // Inventory status summary
    const lowStockCount = this.products.filter(p => p.stock > 0 && p.stock <= (p.min_stock_alert || 5)).length;
    const outStockCount = this.products.filter(p => p.stock <= 0).length;
    const stockAlertEl = document.getElementById('metricStockAlerts');
    if (stockAlertEl) {
      stockAlertEl.innerHTML = `
        <span class="badge ${outStockCount > 0 ? 'badge-danger' : 'badge-success'}">${outStockCount} Out</span>
        <span class="badge ${lowStockCount > 0 ? 'badge-warning' : 'badge-success'}">${lowStockCount} Low</span>
      `;
    }
  }

  /* ================= 2. SALESPERSON PERFORMANCE TRACKING ================= */
  renderSalespersonPerformance() {
    const container = document.getElementById('salespersonPerformanceTable');
    if (!container) return;

    const filtered = this.getFilteredSales();

    // Group stats by salesperson
    const spMap = {};

    for (const sale of filtered) {
      const spKey = sale.salesperson_name || 'Unassigned Cashier';
      if (!spMap[spKey]) {
        spMap[spKey] = {
          name: spKey,
          id: sale.salesperson_id,
          totalRevenue: 0,
          totalCost: 0,
          netProfit: 0,
          ordersCount: 0,
          itemsCount: 0
        };
      }
      spMap[spKey].totalRevenue += Number(sale.total_revenue) || 0;
      spMap[spKey].totalCost += Number(sale.total_cost) || 0;
      spMap[spKey].netProfit += Number(sale.net_profit) || 0;
      spMap[spKey].ordersCount += 1;
      if (sale.items) {
        spMap[spKey].itemsCount += sale.items.reduce((acc, it) => acc + (it.quantity || 0), 0);
      }
    }

    const performanceList = Object.values(spMap).sort((a, b) => b.netProfit - a.netProfit);
    const overallProfit = performanceList.reduce((sum, sp) => sum + sp.netProfit, 0);

    if (performanceList.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <h4>No salesperson data for this period</h4>
          <p>Sales made by your staff will show individual performance, profit contribution, and rankings here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Salesperson</th>
              <th>Transactions</th>
              <th>Units Sold</th>
              <th>Total Revenue</th>
              <th>Net Profit Generated</th>
              <th>Avg Order Value</th>
              <th>Profit Share</th>
            </tr>
          </thead>
          <tbody>
            ${performanceList.map((sp, idx) => {
              const aov = sp.ordersCount > 0 ? (sp.totalRevenue / sp.ordersCount) : 0;
              const profitShare = overallProfit > 0 ? ((sp.netProfit / overallProfit) * 100).toFixed(1) : '0';
              const rankClass = idx === 0 ? 'top-1' : idx === 1 ? 'top-2' : idx === 2 ? 'top-3' : '';
              const rankIcon = idx === 0 ? '👑' : `#${idx + 1}`;

              return `
                <tr>
                  <td><span class="rank-badge ${rankClass}">${rankIcon}</span></td>
                  <td>
                    <div class="salesperson-cell">
                      <div class="salesperson-avatar">${sp.name.slice(0, 2).toUpperCase()}</div>
                      <div>
                        <div style="font-weight:700; color:var(--ink);">${sp.name}</div>
                        <div style="font-size:11px; color:var(--muted);">${sp.ordersCount} sales recorded</div>
                      </div>
                    </div>
                  </td>
                  <td class="mono" style="font-weight:600;">${sp.ordersCount}</td>
                  <td class="mono">${sp.itemsCount}</td>
                  <td class="mono" style="font-weight:700; color:var(--primary);">₵${sp.totalRevenue.toFixed(2)}</td>
                  <td class="mono" style="font-weight:700; color:var(--profit); font-size:14px;">
                    ₵${sp.netProfit.toFixed(2)}
                  </td>
                  <td class="mono">₵${aov.toFixed(2)}</td>
                  <td>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <div style="flex:1; background:var(--line); height:6px; border-radius:10px; overflow:hidden; min-width:60px;">
                        <div style="width:${profitShare}%; background:var(--profit); height:100%;"></div>
                      </div>
                      <span class="mono" style="font-size:11.5px; font-weight:700;">${profitShare}%</span>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ================= 3. CHARTS RENDERING ================= */
  renderCharts() {
    if (!window.Chart) return;

    // Financial Breakdown Bar Chart
    const barCanvas = document.getElementById('profitBreakdownChart');
    if (barCanvas) {
      const filtered = this.getFilteredSales();
      
      // Aggregate by recent 7 dates or periods
      const dateMap = {};
      filtered.forEach(s => {
        const d = new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        if (!dateMap[d]) dateMap[d] = { revenue: 0, cost: 0, profit: 0 };
        dateMap[d].revenue += Number(s.total_revenue) || 0;
        dateMap[d].cost += Number(s.total_cost) || 0;
        dateMap[d].profit += Number(s.net_profit) || 0;
      });

      const labels = Object.keys(dateMap).slice(-7);
      const revData = labels.map(l => dateMap[l].revenue);
      const costData = labels.map(l => dateMap[l].cost);
      const profitData = labels.map(l => dateMap[l].profit);

      if (this.chartInstance) {
        this.chartInstance.destroy();
      }

      this.chartInstance = new window.Chart(barCanvas, {
        type: 'bar',
        data: {
          labels: labels.length ? labels : ['No Data'],
          datasets: [
            {
              label: 'Revenue (₵)',
              data: revData.length ? revData : [0],
              backgroundColor: '#0A39D9',
              borderRadius: 6
            },
            {
              label: 'Cost (₵)',
              data: costData.length ? costData : [0],
              backgroundColor: '#D97706',
              borderRadius: 6
            },
            {
              label: 'Net Profit (₵)',
              data: profitData.length ? profitData : [0],
              backgroundColor: '#059669',
              borderRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Inter', size: 11 } } },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ₵${ctx.raw.toFixed(2)}`
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: { grid: { color: '#E2E8F0' } }
          }
        }
      });
    }

    // Salesperson Doughnut Chart
    const pieCanvas = document.getElementById('salespersonDoughnutChart');
    if (pieCanvas) {
      const filtered = this.getFilteredSales();
      const spMap = {};
      filtered.forEach(s => {
        const name = s.salesperson_name || 'Staff';
        spMap[name] = (spMap[name] || 0) + (Number(s.net_profit) || 0);
      });

      const spLabels = Object.keys(spMap);
      const spValues = Object.values(spMap);

      if (this.salespersonChartInstance) {
        this.salespersonChartInstance.destroy();
      }

      this.salespersonChartInstance = new window.Chart(pieCanvas, {
        type: 'doughnut',
        data: {
          labels: spLabels.length ? spLabels : ['No Sales'],
          datasets: [{
            data: spValues.length ? spValues : [1],
            backgroundColor: ['#0A39D9', '#0284C7', '#059669', '#7C3AED', '#D97706', '#DB2777']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10.5 } } },
            tooltip: {
              callbacks: {
                label: (ctx) => ` Profit: ₵${Number(ctx.raw).toFixed(2)}`
              }
            }
          }
        }
      });
    }
  }

  /* ================= 4. PRODUCT & INVENTORY MANAGEMENT (WITH COST & SELLING PRICE) ================= */
  setInventorySearch(q) {
    this.inventorySearchQuery = q || '';
    this.renderInventoryTable();
  }

  renderInventoryTable() {
    const container = document.getElementById('adminInventoryTable');
    if (!container) return;

    let list = this.products;
    if (this.inventorySearchQuery) {
      const q = this.inventorySearchQuery.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku && p.sku.toLowerCase().includes(q)));
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📦</div>
          <h4>No inventory items found</h4>
          <p>Click "Add New Product" to stock your shop.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Item / SKU</th>
              <th>Category</th>
              <th>Cost Price (₵)</th>
              <th>Selling Price (₵)</th>
              <th>Unit Profit</th>
              <th>Gross Margin</th>
              <th>Stock Level</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(p => {
              const cost = Number(p.cost_price) || 0;
              const sell = Number(p.selling_price) || 0;
              const unitProfit = sell - cost;
              const margin = sell > 0 ? ((unitProfit / sell) * 100).toFixed(1) : '0';
              
              const isOutOfStock = p.stock <= 0;
              const isLowStock = p.stock > 0 && p.stock <= (p.min_stock_alert || 5);
              
              let stockBadge = `<span class="badge badge-success">${p.stock} units</span>`;
              if (isOutOfStock) {
                stockBadge = `<span class="badge badge-danger">0 - Out of Stock</span>`;
              } else if (isLowStock) {
                stockBadge = `<span class="badge badge-warning">${p.stock} units (Low)</span>`;
              }

              return `
                <tr>
                  <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                      <div style="width:36px; height:36px; border-radius:6px; background:var(--surface-alt); border:1px solid var(--line); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
                        ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%; height:100%; object-fit:cover;">` : `<span style="font-size:18px;">📦</span>`}
                      </div>
                      <div>
                        <div style="font-weight:700; color:var(--ink);">${p.name}</div>
                        <div style="font-size:11px; color:var(--muted);" class="mono">${p.sku || 'No SKU'}</div>
                      </div>
                    </div>
                  </td>
                  <td><span class="badge badge-info">${p.category || 'General'}</span></td>
                  <td class="mono" style="color:var(--cost); font-weight:600;">₵${cost.toFixed(2)}</td>
                  <td class="mono" style="color:var(--primary); font-weight:700;">₵${sell.toFixed(2)}</td>
                  <td class="mono" style="color:var(--profit); font-weight:700;">+₵${unitProfit.toFixed(2)}</td>
                  <td><span class="badge badge-success">${margin}%</span></td>
                  <td class="mono">${stockBadge}</td>
                  <td>
                    <div style="display:flex; gap:6px;">
                      <button class="btn btn-ghost btn-sm" onclick='window.adminService.openProductModal("${p.id}")'>✏️ Edit</button>
                      <button class="btn btn-danger btn-sm" onclick='window.adminService.deleteProduct("${p.id}")'>🗑️</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  openProductModal(productId = null) {
    const product = productId ? this.products.find(p => p.id === productId) : null;
    const isEdit = !!product;

    const title = isEdit ? 'Edit Product' : 'Add New Product';
    const cost = product ? Number(product.cost_price) : 0;
    const sell = product ? Number(product.selling_price) : 0;
    const stock = product ? Number(product.stock) : 0;
    const minAlert = product ? Number(product.min_stock_alert) : 5;
    const imgUrl = product?.image_url || '';

    const modalHtml = `
      <form id="productForm" onsubmit="return window.adminService.handleSaveProduct(event, '${productId || ''}')">
        <div class="field">
          <label>Product Name *</label>
          <input type="text" id="prodName" required placeholder="e.g. Milo 400g Tin" value="${product ? product.name : ''}">
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="field">
            <label>Category *</label>
            <select id="prodCategory">
              <option value="Beverages" ${product?.category==='Beverages'?'selected':''}>Beverages</option>
              <option value="Groceries" ${product?.category==='Groceries'?'selected':''}>Groceries</option>
              <option value="Toiletries" ${product?.category==='Toiletries'?'selected':''}>Toiletries</option>
              <option value="School & Office" ${product?.category==='School & Office'?'selected':''}>School & Office</option>
              <option value="Provisions" ${product?.category==='Provisions'?'selected':''}>Provisions</option>
              <option value="General" ${product?.category==='General'?'selected':''}>General</option>
            </select>
          </div>
          <div class="field">
            <label>SKU / Barcode</label>
            <input type="text" id="prodSku" placeholder="e.g. BEV-001" value="${product ? (product.sku||'') : ''}">
          </div>
        </div>

        <!-- Product Image Upload -->
        <div class="field" style="background:var(--surface-alt); padding:10px 12px; border-radius:var(--radius-md); border:1px solid var(--line);">
          <label style="margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
            <span>📸 Product Image</span>
            <span style="font-size:11px; color:var(--muted);">Optional</span>
          </label>
          <div style="display:flex; gap:12px; align-items:center;">
            <div id="prodImgPreview" style="width:48px; height:48px; border-radius:6px; border:1px dashed var(--line); background:var(--surface); display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
              ${imgUrl ? `<img src="${imgUrl}" style="width:100%; height:100%; object-fit:cover;">` : `<span style="font-size:20px;">🖼️</span>`}
            </div>
            <div style="flex:1;">
              <input type="file" id="prodImgFile" accept="image/*" style="font-size:12px;" onchange="window.adminService.previewProductImage(this)">
              <input type="hidden" id="prodExistingImgUrl" value="${imgUrl}">
              <div class="hint">Upload product image file (PNG, JPG, WebP)</div>
            </div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div class="field">
            <label>Cost Price (₵) *</label>
            <input type="number" step="0.01" min="0" id="prodCostPrice" required placeholder="0.00" value="${cost > 0 ? cost : ''}" oninput="window.adminService.updateMarginPreview()">
            <div class="hint">What you pay supplier</div>
          </div>
          <div class="field">
            <label>Selling Price (₵) *</label>
            <input type="number" step="0.01" min="0" id="prodSellingPrice" required placeholder="0.00" value="${sell > 0 ? sell : ''}" oninput="window.adminService.updateMarginPreview()">
            <div class="hint">Price cashier charges customer</div>
          </div>
        </div>

        <div class="margin-preview-box">
          <div>
            <div style="font-size:11px; font-weight:700; color:var(--muted); text-transform:uppercase;">Live Profit Margin</div>
            <div style="font-size:12px; color:var(--ink-soft);" id="marginSubtext">Enter prices to compute</div>
          </div>
          <div class="margin-calc-val" id="marginCalcVal">₵0.00 (0.0%)</div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:16px;">
          <div class="field">
            <label>Current Stock Quantity *</label>
            <input type="number" min="0" id="prodStock" required placeholder="0" value="${stock}">
          </div>
          <div class="field">
            <label>Low Stock Alert Level</label>
            <input type="number" min="1" id="prodMinAlert" required placeholder="5" value="${minAlert}">
          </div>
        </div>

        <div style="display:flex; gap:10px; margin-top:24px;">
          <button type="submit" id="saveProdBtn" class="btn btn-primary btn-block">${isEdit ? 'Save Changes' : 'Add Item to Inventory'}</button>
          <button type="button" class="btn btn-ghost" onclick="window.app.closeModal()">Cancel</button>
        </div>
      </form>
    `;

    window.app.openModal(title, modalHtml);
    this.updateMarginPreview();
  }

  previewProductImage(input) {
    const preview = document.getElementById('prodImgPreview');
    if (!preview || !input.files || !input.files[0]) return;

    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.innerHTML = `<img src="${e.target.result}" style="width:100%; height:100%; object-fit:cover;">`;
    };
    reader.readAsDataURL(file);
  }

  updateMarginPreview() {
    const costInput = document.getElementById('prodCostPrice');
    const sellInput = document.getElementById('prodSellingPrice');
    const calcVal = document.getElementById('marginCalcVal');
    const subtext = document.getElementById('marginSubtext');

    if (!costInput || !sellInput || !calcVal) return;

    const cost = parseFloat(costInput.value) || 0;
    const sell = parseFloat(sellInput.value) || 0;
    const profit = sell - cost;
    const margin = sell > 0 ? ((profit / sell) * 100).toFixed(1) : '0.0';
    const markup = cost > 0 ? ((profit / cost) * 100).toFixed(1) : '0.0';

    calcVal.textContent = `+₵${profit.toFixed(2)} (${margin}%)`;
    calcVal.style.color = profit >= 0 ? 'var(--profit)' : 'var(--danger)';

    if (subtext) {
      subtext.textContent = `Markup: ${markup}% · Unit profit: ₵${profit.toFixed(2)}`;
    }
  }

  async handleSaveProduct(ev, existingId) {
    ev.preventDefault();

    const saveBtn = document.getElementById('saveProdBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Saving product...';
    }

    const name = document.getElementById('prodName').value.trim();
    const category = document.getElementById('prodCategory').value;
    const sku = document.getElementById('prodSku').value.trim();
    const costPrice = parseFloat(document.getElementById('prodCostPrice').value) || 0;
    const sellingPrice = parseFloat(document.getElementById('prodSellingPrice').value) || 0;
    const stock = parseInt(document.getElementById('prodStock').value) || 0;
    const minAlert = parseInt(document.getElementById('prodMinAlert').value) || 5;
    
    // Handle image upload
    const fileInput = document.getElementById('prodImgFile');
    const existingImgUrl = document.getElementById('prodExistingImgUrl')?.value || '';
    let finalImgUrl = existingImgUrl;

    if (fileInput && fileInput.files && fileInput.files[0]) {
      try {
        const uploadedUrl = await window.dataService.uploadProductImage(fileInput.files[0]);
        if (uploadedUrl) {
          finalImgUrl = uploadedUrl;
        }
      } catch (uploadErr) {
        console.error('Image upload failed:', uploadErr);
      }
    }

    if (!name) {
      window.app.showToast('Please enter a product name', 'error');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = existingId ? 'Save Changes' : 'Add Item to Inventory';
      }
      return false;
    }

    const payload = {
      id: existingId || null,
      name,
      category,
      sku,
      image_url: finalImgUrl,
      cost_price: costPrice,
      selling_price: sellingPrice,
      stock,
      min_stock_alert: minAlert
    };

    await window.dataService.saveProduct(payload);
    await this.refresh();
    if (window.posService) {
      await window.posService.refreshProducts();
      window.posService.render();
    }

    window.app.closeModal();
    window.app.showToast(existingId ? 'Product updated successfully' : 'New product added to inventory', 'success');
    return false;
  }

  async deleteProduct(productId) {
    const product = this.products.find(p => p.id === productId);
    if (!confirm(`Are you sure you want to remove "${product?.name || 'this item'}" from inventory?`)) return;

    await window.dataService.deleteProduct(productId);
    await this.refresh();
    if (window.posService) {
      await window.posService.refreshProducts();
      window.posService.render();
    }
    window.app.showToast('Product removed from inventory', 'info');
  }

  /* ================= 5. SALES AUDIT TRAIL ================= */
  setSalesAuditSearch(q) {
    this.salesAuditSearchQuery = q || '';
    this.renderSalesAudit();
  }

  renderSalesAudit() {
    const container = document.getElementById('adminSalesAuditTable');
    if (!container) return;

    let list = this.getFilteredSales();

    if (this.salesAuditSearchQuery) {
      const q = this.salesAuditSearchQuery.toLowerCase();
      list = list.filter(s => 
        s.salesperson_name.toLowerCase().includes(q) || 
        s.customer_name.toLowerCase().includes(q) ||
        s.payment_method.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q)
      );
    }

    if (list.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🧾</div>
          <h4>No sales records found</h4>
          <p>Completed transactions will be logged here with profit breakdowns.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Receipt ID</th>
              <th>Salesperson</th>
              <th>Customer</th>
              <th>Revenue (₵)</th>
              <th>Cost (₵)</th>
              <th>Net Profit (₵)</th>
              <th>Payment</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(s => {
              const rev = Number(s.total_revenue) || 0;
              const cost = Number(s.total_cost) || 0;
              const profit = Number(s.net_profit) || 0;

              return `
                <tr>
                  <td class="mono">${new Date(s.created_at).toLocaleDateString('en-GB')} ${new Date(s.created_at).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}</td>
                  <td class="mono" style="font-size:11.5px; font-weight:700;">#${s.id.slice(-8).toUpperCase()}</td>
                  <td><strong>${s.salesperson_name}</strong></td>
                  <td>${s.customer_name || 'Walk-in'}</td>
                  <td class="mono" style="font-weight:700; color:var(--primary);">₵${rev.toFixed(2)}</td>
                  <td class="mono" style="color:var(--cost);">₵${cost.toFixed(2)}</td>
                  <td class="mono" style="font-weight:700; color:var(--profit);">+₵${profit.toFixed(2)}</td>
                  <td><span class="badge badge-info" style="text-transform:uppercase;">${s.payment_method}</span></td>
                  <td>
                    <button class="btn btn-ghost btn-sm" onclick='window.posService.showReceiptModal(${JSON.stringify(s).replace(/'/g, "&apos;")})'>
                      Receipt
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  /* ================= 6. RESET ALL DATA (FRESH START) ================= */
  async resetAllData() {
    if (!confirm('⚠️ RESET ALL DATA?\n\nThis will permanently delete:\n• All products & inventory\n• All sales records & receipts\n• All KPI / analytics data\n\nThis cannot be undone. Continue?')) return;

    if (!confirm('🔴 FINAL CONFIRMATION\n\nAre you absolutely sure? All existing data will be erased so you can start fresh with new products and accurate KPIs.')) return;

    await window.dataService.resetAllData();
    await this.refresh();
    if (window.posService) {
      await window.posService.refreshProducts();
      window.posService.render();
    }

    window.app.showToast('✅ All data has been reset. You can now add your real products and start selling!', 'success');
  }
}

window.adminService = new AdminService();
