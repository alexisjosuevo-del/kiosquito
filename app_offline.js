// app_offline.js (ESM) — Demo sin Firebase
// Guarda todo en localStorage para poder ver la interfaz y probar flujos.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const money = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n || 0));
const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const nowISO = () => new Date().toISOString();

const formatDateTime = (d = new Date()) => {
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

let __clockTimer = null;
function startClock() {
  const el = $("#clock");
  if (!el) return;
  const tick = () => { el.textContent = formatDateTime(new Date()); };
  tick();
  if (__clockTimer) clearInterval(__clockTimer);
  __clockTimer = setInterval(tick, 1000);
}

function roleLabel(role) {
  if (role === "admin") return "Admin";
  if (role === "seller") return "Vendedor";
  return role || "sin-rol";
}

function allowedTabs(role) {
  return role === "admin"
    ? ["pos", "cash", "products", "inventory", "reports", "admin"]
    : ["pos", "cash"];
}

function switchToTab(name) {
  const btn = $$(".tab").find(b => b.dataset.tab === name);
  if (!btn) return;
  $$(".tab").forEach(b => b.classList.toggle("active", b === btn));
  $$(".tabpane").forEach(p => p.classList.add("hidden"));
  const pane = $(`#tab-${name}`);
  if (pane) pane.classList.remove("hidden");
}

function enforceRoleAccess() {
  if (!state.user) return;
  const role = state.profile?.role || "";
  const allowed = new Set(allowedTabs(role));
  const activeBtn = $$(".tab").find(b => b.classList.contains("active"));
  const active = activeBtn?.dataset?.tab || "pos";
  if (!allowed.has(active)) switchToTab("pos");
}

function flash(msg, type = "err") {
  const el = $("#posMsg") || $("#authMsg");
  if (!el) { alert(msg); return; }
  el.className = `msg ${type === "ok" ? "ok" : "err"}`;
  el.textContent = msg;
  window.clearTimeout(el.__t);
  el.__t = window.setTimeout(() => {
    if (el.textContent === msg) { el.className = "msg"; el.textContent = ""; }
  }, 2600);
}

let __qtyResolver = null;
function openQtyModal(maxStock = null) {
  const modal = $("#qtyModal");
  const input = $("#qtyInput");
  const hint = $("#qtyHint");
  if (!modal || !input) return Promise.resolve(1);

  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  input.value = "1";
  input.min = "1";
  if (Number.isFinite(maxStock)) input.max = String(maxStock);
  else input.removeAttribute("max");
  hint.textContent = Number.isFinite(maxStock) ? `Máximo disponible: ${maxStock}` : "";

  setTimeout(() => input.focus(), 0);

  return new Promise(resolve => { __qtyResolver = resolve; });
}

function closeQtyModal(val = null) {
  const modal = $("#qtyModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
  const r = __qtyResolver;
  __qtyResolver = null;
  if (r) r(val);
}


const LS = {
  user: "kioskito_user",
  products: "kioskito_products",
  sales: "kioskito_sales",
  shifts: "kioskito_shifts",
  inv: "kioskito_inventory_movements"
};

let state = {
  user: null,
  profile: null,
  products: [],
  cart: [],
  selectedInvProduct: null,
  shift: null
};

const DEMO_USERS = [
  { username: "admin", password: "1234", role: "admin", uid: "admin", email: "admin" },
  { username: "vendedor", password: "1234", role: "seller", uid: "vendedor", email: "vendedor" }
];

boot();

async function boot() {
  $("#year").textContent = String(new Date().getFullYear());
  startClock();
  wireUI();
  restoreSession();
  await loadProducts();
  await refreshShift();
  renderPosResults();
  renderCart();
  renderProductsTable();
  renderInvResults();
  await loadTodaySales({ silent: true });
  updateVisibility();
}

function wireUI() {
  // Tabs
  $$(".tab").forEach(btn => {
    btn.onclick = () => {
      const name = btn.dataset.tab;
      const role = state.profile?.role || "";
      const allowed = new Set(allowedTabs(role));
      if (state.user && !allowed.has(name)) {
        flash("Acceso restringido para tu perfil.", "err");
        enforceRoleAccess();
        return;
      }
      switchToTab(name);
    };
  });

  // Modal cantidad
  $("#btnQtyCancel").onclick = () => closeQtyModal(null);
  $("#btnQtyOk").onclick = () => {
    const max = Number($("#qtyInput").max || Infinity);
    const q = Math.floor(Number($("#qtyInput").value || 1));
    if (!Number.isFinite(q) || q <= 0) { flash("Cantidad inválida.", "err"); return; }
    if (Number.isFinite(max) && q > max) { flash(`Máximo disponible: ${max}`, "err"); return; }
    closeQtyModal(q);
  };
  $("#qtyInput").onkeydown = (e) => {
    if (e.key === "Enter") $("#btnQtyOk").click();
    if (e.key === "Escape") closeQtyModal(null);
  };
  $("#qtyModal").onclick = (e) => {
    if (e.target && e.target.id === "qtyModal") closeQtyModal(null);
  };

  // Auth
  $("#btnLogin").onclick = () => {
    $("#authMsg").className = "msg"; $("#authMsg").textContent = "";
    const u = ($("#loginEmail").value || "").trim();
    const p = $("#loginPass").value || "";
    const found = DEMO_USERS.find(x => x.username === u && x.password === p);
    if (!found) {
      $("#authMsg").className = "msg err";
      $("#authMsg").textContent = "Usuario o contraseña incorrectos.";
      return;
    }
    state.user = { uid: found.uid, email: found.email };
    state.profile = { role: found.role };
    if ($("#rememberMe")?.checked) {
      localStorage.setItem(LS.user, JSON.stringify({ username: found.username, role: found.role }));
    } else {
      localStorage.removeItem(LS.user);
    }
    updateVisibility();
    enforceRoleAccess();
  };

  $("#btnForgot").onclick = () => {
    $("#authMsg").className = "msg";
    $("#authMsg").textContent = "Demo offline: usa admin / 1234";
  };

  $("#btnSignOut").onclick = () => {
    localStorage.removeItem(LS.user);
    state.user = null;
    state.profile = null;
    state.cart = [];
    updateVisibility();
    $("#loginPass").value = "";
    $("#loginEmail").focus();
  };

  // POS
  $("#posSearch").oninput = () => renderPosResults();
  $("#btnClearCart").onclick = () => { state.cart = []; renderCart(); };
  $("#btnCheckout").onclick = async () => {
    $("#posMsg").className = "msg"; $("#posMsg").textContent = "";
    try {
      ensureLoggedIn();
      await ensureShiftOpen();
      const method = $("#payMethod").value;
      const note = $("#saleNote").value.trim();
      if (!state.cart.length) throw new Error("El carrito está vacío.");
      await createSale({ method, note });
      state.cart = [];
      $("#saleNote").value = "";
      renderCart();
      await refreshShift();
      $("#posMsg").className = "msg ok";
      $("#posMsg").textContent = `Venta registrada ✅ • ${formatDateTime(new Date())} • ${state.user.email}`;
    } catch (e) {
      $("#posMsg").className = "msg err";
      $("#posMsg").textContent = e?.message || String(e);
    }
  };

  // Cash
  $("#btnOpenShift").onclick = async () => {
    $("#openMsg").className = "msg"; $("#openMsg").textContent = "";
    try {
      ensureLoggedIn();
      const openingCash = Number($("#openCash").value || 0);
      await openShift({ openingCash });
      await refreshShift();
      $("#openMsg").className = "msg ok";
      $("#openMsg").textContent = "Caja abierta ✅";
    } catch (e) {
      $("#openMsg").className = "msg err";
      $("#openMsg").textContent = e?.message || String(e);
    }
  };

  $("#btnCloseShift").onclick = async () => {
    $("#closeMsg").className = "msg"; $("#closeMsg").textContent = "";
    try {
      ensureLoggedIn();
      const countedCash = Number($("#countedCash").value || 0);
      await closeShift({ countedCash });
      await refreshShift();
      $("#closeMsg").className = "msg ok";
      $("#closeMsg").textContent = "Caja cerrada ✅";
    } catch (e) {
      $("#closeMsg").className = "msg err";
      $("#closeMsg").textContent = e?.message || String(e);
    }
  };

  // Products
  $("#btnReloadProducts").onclick = async () => {
    await loadProducts();
    renderProductsTable();
    renderPosResults();
    renderInvResults();
  };
  $("#prodSearch").oninput = () => renderProductsTable();

  // Inventory
  $("#invSearch").oninput = () => renderInvResults();
  $("#btnApplyInv").onclick = async () => {
    $("#invMsg").className = "msg"; $("#invMsg").textContent = "";
    try {
      ensureLoggedIn();
      if (!state.selectedInvProduct) throw new Error("Selecciona un producto.");
      const type = $("#invType").value;
      const qty = Number($("#invQty").value || 0);
      if (!Number.isFinite(qty) || qty === 0) throw new Error("Ingresa una cantidad distinta de 0.");
      const reason = $("#invReason").value.trim();
      await applyInventory({ productId: state.selectedInvProduct.id, type, qty, reason });
      $("#invQty").value = "";
      $("#invReason").value = "";
      await loadProducts();
      renderInvResults();
      renderProductsTable();
      renderPosResults();
      $("#invMsg").className = "msg ok";
      $("#invMsg").textContent = "Movimiento aplicado ✅";
    } catch (e) {
      $("#invMsg").className = "msg err";
      $("#invMsg").textContent = e?.message || String(e);
    }
  };

  // Reports
  $("#btnLoadToday").onclick = async () => {
    $("#repMsg").className = "msg"; $("#repMsg").textContent = "";
    try { await loadTodaySales(); } catch(e) {
      $("#repMsg").className = "msg err"; $("#repMsg").textContent = e?.message || String(e);
    }
  };
  $("#btnExportToday").onclick = () => exportTodayCSV();
  $("#btnResetDemo").onclick = () => {
    localStorage.removeItem(LS.products);
    localStorage.removeItem(LS.sales);
    localStorage.removeItem(LS.shifts);
    localStorage.removeItem(LS.inv);
    state.cart = [];
    state.selectedInvProduct = null;
    boot();
  };

  // Admin seed
  $("#btnSeed").onclick = async () => {
    $("#seedMsg").className = "msg"; $("#seedMsg").textContent = "";
    try {
      ensureLoggedIn();
      if (state.profile?.role !== "admin") throw new Error("Solo admin.");
      const resp = await fetch("./seed_products.json");
      const seed = await resp.json();
      seedProducts(seed);
      await loadProducts();
      renderProductsTable();
      renderPosResults();
      renderInvResults();
      $("#seedMsg").className = "msg ok";
      $("#seedMsg").textContent = `Productos cargados: ${seed.length}`;
    } catch(e) {
      $("#seedMsg").className = "msg err";
      $("#seedMsg").textContent = e?.message || String(e);
    }
  };
}

function updateVisibility() {
  const logged = !!state.user;

  $("#authView").classList.toggle("hidden", logged);
  $("#appView").classList.toggle("hidden", !logged);
  $("#btnSignOut").classList.toggle("hidden", !logged);
  $("#topbar").classList.toggle("hidden", !logged);
  $("#footer").classList.toggle("hidden", !logged);

  if (logged) {
    const role = state.profile?.role || "sin-rol";
    $("#whoami").textContent = `${state.user.email} - ${roleLabel(role)}`;
    $$(".admin-only").forEach(el => el.classList.toggle("hidden", role !== "admin"));
    enforceRoleAccess();
  } else {
    $("#whoami").textContent = "";
    $$(".admin-only").forEach(el => el.classList.add("hidden"));
  }
}

function restoreSession() {
  const s = localStorage.getItem(LS.user);
  if (!s) return;
  try {
    const data = JSON.parse(s);
    if (!data?.username) return;
    const found = DEMO_USERS.find(x => x.username === data.username);
    if (!found) return;
    state.user = { uid: found.uid, email: found.email };
    state.profile = { role: found.role };
  } catch {}
}

function ensureLoggedIn() {
  if (!state.user) throw new Error("Inicia sesión.");
}

function readJSON(key, fallback) {
  const v = localStorage.getItem(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
function writeJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

async function loadProducts() {
  let products = readJSON(LS.products, null);
  if (!products || !Array.isArray(products) || !products.length) {
    // bootstrap from seed
    const resp = await fetch("./seed_products.json");
    const seed = await resp.json();
    products = seed.map((p, idx) => ({
      id: `p_${idx+1}`,
      sku: String(p.sku || "").toUpperCase(),
      name: p.name,
      price: Number(p.price || 0),
      stock: Number(p.stock || 0),
      active: p.active !== false
    }));
    writeJSON(LS.products, products);
  }
  state.products = products.sort((a,b) => (a.name||"").localeCompare(b.name||"", "es"));
}

function filterProducts(term) {
  const q = (term || "").toLowerCase().trim();
  return state.products
    .filter(p => p.active !== false)
    .filter(p => !q || (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q));
}

function renderPosResults() {
  const term = $("#posSearch").value;
  const list = filterProducts(term).slice(0, 30);
  const el = $("#posResults");
  el.innerHTML = "";
  if (!list.length) {
    el.innerHTML = `<div class="item muted">Sin resultados.</div>`;
    return;
  }
  list.forEach(p => {
    const stock = Number(p.stock || 0);
    const disabled = stock <= 0 ? "opacity:.55; pointer-events:none" : "";
    const badge = stock <= 0 ? `<span class="badge">Sin stock</span>` : `<span class="badge">Stock: ${stock}</span>`;
    const row = document.createElement("div");
    row.className = "item";
    row.style = disabled;
    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(p.name)}</strong> <span class="badge">${escapeHtml(p.sku || "")}</span></div>
        <div class="muted small">${money(p.price || 0)} • ${badge}</div>
      </div>
      <button class="btn btn-ghost">Agregar</button>
    `;
    row.querySelector("button").onclick = async () => {
      const qty = await openQtyModal(Number(p.stock || 0));
      if (!qty) return;
      addToCart(p.id, qty);
    };
    el.appendChild(row);
  });
}

function addToCart(productId, qty = 1) {
  const p = state.products.find(x => x.id === productId);
  if (!p) return;
  const existing = state.cart.find(x => x.productId === productId);
  if (existing) existing.qty += Number(qty || 1);
  else state.cart.push({ productId, qty: Number(qty || 1) });
  renderCart();
}

function renderCart() {
  const el = $("#cart");
  el.innerHTML = "";
  let subtotal = 0;
  if (!state.cart.length) {
    el.innerHTML = `<div class="item muted">Carrito vacío.</div>`;
  } else {
    state.cart.forEach(line => {
      const p = state.products.find(x => x.id === line.productId);
      if (!p) return;
      const price = Number(p.price || 0);
      const lineTotal = price * line.qty;
      subtotal += lineTotal;

      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div>
          <div><strong>${escapeHtml(p.name)}</strong></div>
          <div class="muted small">${money(price)} c/u</div>
        </div>
        <div class="row right">
          <button class="btn btn-ghost kbd" title="Quitar 1">-</button>
          <span class="kbd">x${line.qty}</span>
          <button class="btn btn-ghost kbd" title="Agregar 1">+</button>
          <button class="btn btn-ghost" title="Eliminar">🗑️</button>
        </div>
      `;
      const btns = row.querySelectorAll("button");
      btns[0].onclick = () => { line.qty = Math.max(1, line.qty - 1); renderCart(); };
      btns[1].onclick  = () => { line.qty += 1; renderCart(); };
      btns[2].onclick   = () => { state.cart = state.cart.filter(x => x !== line); renderCart(); };
      el.appendChild(row);
    });
  }

  $("#cartSubtotal").textContent = money(subtotal);
  $("#cartTotal").textContent = money(subtotal);
}

function shiftIdForToday(uid) {
  return `${uid}_${todayKey()}`;
}

async function refreshShift() {
  if (!state.user) { state.shift = null; renderShiftSummary(); return; }
  const shifts = readJSON(LS.shifts, {});
  const id = shiftIdForToday(state.user.uid);
  state.shift = shifts[id] || null;
  renderShiftSummary();
}

function renderShiftSummary() {
  const hint = $("#posShiftHint");
  const sum = $("#shiftSummary");
  if (!state.shift) {
    hint.textContent = "Caja: cerrada (sin apertura hoy).";
    sum.textContent = "Sin apertura hoy.";
    return;
  }
  hint.textContent = state.shift.closedAt ? "Caja: cerrada (hoy)." : "Caja: abierta (hoy).";

  const opening = Number(state.shift.openingCash || 0);
  const cashSales = Number(state.shift.cashSales || 0);
  const expected = opening + cashSales;
  const counted = Number(state.shift.countedCash || 0);
  const diff = (state.shift.closedAt) ? (counted - expected) : null;

  sum.innerHTML = `
    <div class="summary">
      <div class="pill">Inicio: <strong>${money(opening)}</strong></div>
      <div class="pill">Ventas efectivo: <strong>${money(cashSales)}</strong></div>
      <div class="pill">Esperado: <strong>${money(expected)}</strong></div>
      ${state.shift.closedAt ? `<div class="pill">Contado: <strong>${money(counted)}</strong></div>` : ""}
      ${state.shift.closedAt ? `<div class="pill">Diferencia: <strong>${money(diff)}</strong></div>` : ""}
    </div>
  `;
}

async function ensureShiftOpen() {
  await refreshShift();
  if (!state.shift || state.shift.closedAt) throw new Error("La caja no está abierta. Ve a 'Caja' y abre con efectivo inicial.");
}

async function openShift({ openingCash }) {
  const shifts = readJSON(LS.shifts, {});
  const id = shiftIdForToday(state.user.uid);
  if (shifts[id] && !shifts[id].closedAt) throw new Error("La caja ya está abierta hoy.");

  shifts[id] = {
    id,
    uid: state.user.uid,
    email: state.user.email,
    dateKey: todayKey(),
    openingCash: Number(openingCash || 0),
    cashSales: 0,
    cardSales: 0,
    transferSales: 0,
    totalSales: 0,
    openedAt: nowISO(),
    closedAt: null,
    countedCash: null
  };
  writeJSON(LS.shifts, shifts);
}

async function closeShift({ countedCash }) {
  const shifts = readJSON(LS.shifts, {});
  const id = shiftIdForToday(state.user.uid);
  if (!shifts[id] || shifts[id].closedAt) throw new Error("No hay caja abierta para cerrar.");
  shifts[id].countedCash = Number(countedCash || 0);
  shifts[id].closedAt = nowISO();
  writeJSON(LS.shifts, shifts);
}

async function createSale({ method, note }) {
  // validate stock
  const items = state.cart.map(line => {
    const p = state.products.find(x => x.id === line.productId);
    const price = Number(p?.price || 0);
    return {
      productId: line.productId,
      sku: p?.sku || null,
      name: p?.name || null,
      price,
      qty: Number(line.qty || 1),
      lineTotal: price * Number(line.qty || 1)
    };
  });
  const total = items.reduce((a, b) => a + Number(b.lineTotal || 0), 0);

  // decrement stock
  for (const it of items) {
    const p = state.products.find(x => x.id === it.productId);
    if (!p) throw new Error("Producto no encontrado.");
    if (Number(p.stock || 0) < it.qty) throw new Error(`Stock insuficiente: ${it.name} (hay ${Number(p.stock||0)}).`);
  }
  items.forEach(it => {
    const p = state.products.find(x => x.id === it.productId);
    p.stock = Number(p.stock || 0) - it.qty;
  });
  writeJSON(LS.products, state.products);

  // write movements
  const inv = readJSON(LS.inv, []);
  items.forEach(it => inv.push({
    id: `m_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    productId: it.productId, sku: it.sku, name: it.name,
    type: "out", qty: it.qty, reason: "venta",
    createdAt: nowISO(), uid: state.user.uid, email: state.user.email, dateKey: todayKey()
  }));
  writeJSON(LS.inv, inv);

  // create sale
  const sales = readJSON(LS.sales, []);
  const sale = {
    id: `s_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    uid: state.user.uid,
    email: state.user.email,
    dateKey: todayKey(),
    shiftId: shiftIdForToday(state.user.uid),
    method,
    note: note || null,
    items,
    total,
    createdAt: nowISO()
  };
  sales.unshift(sale);
  writeJSON(LS.sales, sales);

  // update shift totals
  const shifts = readJSON(LS.shifts, {});
  const sid = shiftIdForToday(state.user.uid);
  const sh = shifts[sid];
  sh.totalSales = Number(sh.totalSales || 0) + total;
  if (method === "cash") sh.cashSales = Number(sh.cashSales || 0) + total;
  if (method === "card") sh.cardSales = Number(sh.cardSales || 0) + total;
  if (method === "transfer") sh.transferSales = Number(sh.transferSales || 0) + total;
  shifts[sid] = sh;
  writeJSON(LS.shifts, shifts);

  await loadProducts();
  renderPosResults();
  renderProductsTable();
  renderInvResults();
}

function renderProductsTable() {
  const term = ($("#prodSearch").value || "").toLowerCase().trim();
  const list = state.products
    .filter(p => !term || (p.name || "").toLowerCase().includes(term) || (p.sku || "").toLowerCase().includes(term));

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>SKU</th><th>Producto</th><th>Precio</th><th>Stock</th><th>Activo</th><th>Acción</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");

  list.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.sku || "")}</td>
      <td>${escapeHtml(p.name || "")}</td>
      <td><input data-k="price" data-id="${p.id}" type="number" step="0.01" value="${Number(p.price || 0)}" /></td>
      <td><span class="badge">${Number(p.stock || 0)}</span></td>
      <td>
        <select data-k="active" data-id="${p.id}">
          <option value="true" ${p.active !== false ? "selected" : ""}>Sí</option>
          <option value="false" ${p.active === false ? "selected" : ""}>No</option>
        </select>
      </td>
      <td><button class="btn btn-ghost" data-save="${p.id}">Guardar</button></td>
    `;
    tbody.appendChild(tr);
  });

  const wrap = $("#productsTable");
  wrap.innerHTML = "";
  wrap.appendChild(table);

  wrap.querySelectorAll("button[data-save]").forEach(btn => {
    btn.onclick = async () => {
      try {
        ensureLoggedIn();
        const id = btn.dataset.save;
        const priceEl = wrap.querySelector(`input[data-id="${id}"][data-k="price"]`);
        const activeEl = wrap.querySelector(`select[data-id="${id}"][data-k="active"]`);
        const price = Number(priceEl.value || 0);
        const active = (activeEl.value === "true");

        const p = state.products.find(x => x.id === id);
        p.price = price;
        p.active = active;
        writeJSON(LS.products, state.products);

        $("#prodMsg").className = "msg ok";
        $("#prodMsg").textContent = "Producto actualizado ✅";
        renderPosResults();
        renderInvResults();
      } catch(e) {
        $("#prodMsg").className = "msg err";
        $("#prodMsg").textContent = e?.message || String(e);
      }
    };
  });
}

function renderInvResults() {
  const term = ($("#invSearch").value || "").toLowerCase().trim();
  const list = state.products
    .filter(p => !term || (p.name || "").toLowerCase().includes(term) || (p.sku || "").toLowerCase().includes(term))
    .slice(0, 30);

  const el = $("#invResults");
  el.innerHTML = "";
  if (!list.length) {
    el.innerHTML = `<div class="item muted">Sin resultados.</div>`;
    return;
  }
  list.forEach(p => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(p.name)}</strong> <span class="badge">${escapeHtml(p.sku || "")}</span></div>
        <div class="muted small">Stock: ${Number(p.stock || 0)}</div>
      </div>
      <button class="btn btn-ghost">Elegir</button>
    `;
    row.querySelector("button").onclick = () => {
      state.selectedInvProduct = p;
      $("#invSelectedHint").innerHTML = `Seleccionado: <strong>${escapeHtml(p.name)}</strong> • Stock: <strong>${Number(p.stock || 0)}</strong>`;
    };
    el.appendChild(row);
  });
}

async function applyInventory({ productId, type, qty, reason }) {
  const p = state.products.find(x => x.id === productId);
  if (!p) throw new Error("Producto no encontrado.");
  const cur = Number(p.stock || 0);
  let next = cur;
  if (type === "in") next = cur + qty;
  if (type === "out") next = cur - qty;
  if (type === "set") next = qty;
  if (next < 0) throw new Error("El stock no puede quedar negativo.");
  p.stock = next;
  writeJSON(LS.products, state.products);

  const inv = readJSON(LS.inv, []);
  inv.unshift({
    id: `m_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    productId, sku: p.sku, name: p.name,
    type, qty, reason: reason || null,
    createdAt: nowISO(), uid: state.user.uid, email: state.user.email, dateKey: todayKey()
  });
  writeJSON(LS.inv, inv);
}

function seedProducts(seed) {
  let products = readJSON(LS.products, []);
  const bySku = new Map(products.map(p => [String(p.sku||"").toUpperCase(), p]));
  let maxN = products.reduce((m,p)=>Math.max(m, Number(String(p.id||"").split("_")[1])||0), 0);
  seed.forEach(s => {
    const sku = String(s.sku||"").toUpperCase();
    if (!sku || !s.name) return;
    const ex = bySku.get(sku);
    if (ex) {
      ex.name = ex.name || s.name;
      ex.active = ex.active !== false;
    } else {
      maxN += 1;
      products.push({
        id: `p_${maxN}`,
        sku,
        name: s.name,
        price: Number(s.price || 0),
        stock: Number(s.stock || 0),
        active: s.active !== false
      });
    }
  });
  writeJSON(LS.products, products);
}

async function loadTodaySales({ silent=false } = {}) {
  const dateKey = todayKey();
  const sales = readJSON(LS.sales, []).filter(s => s.dateKey === dateKey).slice(0, 250);

  const total = sales.reduce((a, s) => a + Number(s.total || 0), 0);
  const cash = sales.filter(s => s.method === "cash").reduce((a, s) => a + Number(s.total || 0), 0);
  const card = sales.filter(s => s.method === "card").reduce((a, s) => a + Number(s.total || 0), 0);
  const transfer = sales.filter(s => s.method === "transfer").reduce((a, s) => a + Number(s.total || 0), 0);

  const byUser = new Map();
  for (const s of sales) {
    const k = s.email || s.uid;
    byUser.set(k, (byUser.get(k) || 0) + Number(s.total || 0));
  }

  $("#reportSummary").innerHTML = `
    <div class="pill">Ventas hoy: <strong>${money(total)}</strong></div>
    <div class="pill">Efectivo: <strong>${money(cash)}</strong></div>
    <div class="pill">Tarjeta: <strong>${money(card)}</strong></div>
    <div class="pill">Transferencia: <strong>${money(transfer)}</strong></div>
    <div class="pill">Usuarios: <strong>${byUser.size}</strong></div>
  `;

  renderSalesTable(sales);
  window.__today_sales = sales;

  if (!silent) {
    $("#repMsg").className = "msg ok";
    $("#repMsg").textContent = `Cargadas ${sales.length} ventas de hoy.`;
  }
}

function renderSalesTable(sales) {
  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>Hora</th><th>Usuario</th><th>Método</th><th>Total</th><th>Items</th><th>Nota</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  sales.forEach(s => {
    const created = s.createdAt ? new Date(s.createdAt) : null;
    const time = created ? created.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";
    const items = Array.isArray(s.items) ? s.items.map(i => `${i.qty}x ${i.name}`).join(", ") : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(time)}</td>
      <td>${escapeHtml(s.email || s.uid || "")}</td>
      <td>${escapeHtml(s.method || "")}</td>
      <td><strong>${money(s.total || 0)}</strong></td>
      <td>${escapeHtml(items)}</td>
      <td>${escapeHtml(s.note || "")}</td>
    `;
    tbody.appendChild(tr);
  });

  const wrap = $("#salesTable");
  wrap.innerHTML = "";
  wrap.appendChild(table);
}

function exportTodayCSV() {
  const rows = window.__today_sales || [];
  const head = ["dateKey","time","email","method","total","items","note"];
  const lines = [head.join(",")];

  rows.forEach(s => {
    const time = s.createdAt || "";
    const items = Array.isArray(s.items) ? s.items.map(i => `${i.qty}x ${i.name}`).join(" | ") : "";
    const vals = [
      s.dateKey || "",
      time,
      s.email || s.uid || "",
      s.method || "",
      Number(s.total || 0).toFixed(2),
      items,
      (s.note || "").replaceAll("\n"," ").replaceAll("\r"," ")
    ].map(csvEscape);
    lines.push(vals.join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ventas_${todayKey()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[,"\n]/.test(s)) return `"${s.replaceAll('"','""')}"`;
  return s;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
