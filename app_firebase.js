// app_firebase.js (ESM) — Firebase Firestore (Tiempo real)
// Requiere: habilitar Firestore en tu proyecto Firebase.
// Nota: para pruebas rápidas puedes usar reglas en "modo prueba". En producción, configura reglas seguras.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, setPersistence, browserLocalPersistence, browserSessionPersistence,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, runTransaction, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAUXX08Ba8HdyH2mLLPxQs8ApSe9Qul6uw",
  authDomain: "kiosquito-c4f14.firebaseapp.com",
  projectId: "kiosquito-c4f14",
  storageBucket: "kiosquito-c4f14.firebasestorage.app",
  messagingSenderId: "10924183142",
  appId: "1:10924183142:web:6f78268f4de7dd3a80a7a7"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let __unsubProducts = null;
let __unsubSalesToday = null;
let __unsubShift = null;

const col = {
  products: collection(db, "products"),
  sales: collection(db, "sales"),
  shifts: collection(db, "shifts"),
  inv: collection(db, "inv_movements"),
};

function tsToISO(ts) {
  try {
    if (!ts) return null;
    // Firestore Timestamp has toDate()
    if (typeof ts.toDate === "function") return ts.toDate().toISOString();
    return String(ts);
  } catch { return null; }
}

async function ensureSeededProducts() {
  const snap = await getDocs(col.products);
  if (!snap.empty) return;

  // bootstrap from seed_products.json
  const resp = await fetch("./seed_products.json");
  const seed = await resp.json();

  const batch = writeBatch(db);
  seed.forEach((p, idx) => {
    const id = `p_${idx + 1}`;
    batch.set(doc(col.products, id), {
      sku: String(p.sku || "").toUpperCase(),
      name: p.name,
      category: p.category || "General",
      price: Number(p.price || 0),
      cost: Number(p.cost ?? 0),
      stock: Number(p.stock || 0),
      active: p.active !== false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

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
  salesToday: [],
  cart: [],
  selectedInvProduct: null,
  shift: null
};

const ADMIN_EMAILS = ["admin@kiosquito.local"]; // agrega aquí más correos admin si quieres
const DEFAULT_DOMAIN = "kiosquito.local";
function toEmail(userOrEmail) {
  const s = String(userOrEmail || "").trim();
  if (!s) return "";
  if (s.includes("@")) return s.toLowerCase();
  return `${s.toLowerCase()}@${DEFAULT_DOMAIN}`;
}

const auth = getAuth(app);

function isAdminEmail(email) {
  const e = String(email || "").toLowerCase();
  return ADMIN_EMAILS.includes(e);
}

async function getOrCreateProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() || {};

  const email = String(user.email || "").toLowerCase();
  const username = (email.split("@")[0] || "usuario").toUpperCase();
  const role = isAdminEmail(email) ? "admin" : "seller";

  const profile = {
    uid: user.uid,
    email,
    username,
    role,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, profile, { merge: true });
  return profile;
}

function clearSubscriptions() {
  try { if (__unsubProducts) __unsubProducts(); } catch {}
  try { if (__unsubSalesToday) __unsubSalesToday(); } catch {}
  try { if (__unsubShift) __unsubShift(); } catch {}
  __unsubProducts = null;
  __unsubSalesToday = null;
  __unsubShift = null;
}

boot();

async function boot() {
  $("#year").textContent = String(new Date().getFullYear());
  startClock();
  wireUI();
  updateVisibility();

  onAuthStateChanged(auth, async (user) => {
    // Cleanup
    clearSubscriptions();
    state.cart = [];

    if (!user) {
      state.user = null;
      state.profile = null;
      updateVisibility();
      $("#loginPass").value = "";
      return;
    }

    state.user = { uid: user.uid, email: user.email || "" };
    try {
      state.profile = await getOrCreateProfile(user);
    } catch (e) {
      console.error(e);
      $("#authMsg").className = "msg err";
      $("#authMsg").textContent = "No se pudo cargar tu perfil (Firestore). Revisa reglas/permiso.";
      // Mantén sesión pero no cargues app
      state.profile = null;
      updateVisibility();
      return;
    }

    updateVisibility();

    // Seed sólo si eres admin (evita errores de permisos)
    if (state.profile?.role === "admin") {
      try { await ensureSeededProducts(); } catch (e) { console.warn("seed", e); }
    }

    await loadProducts();
    await refreshShift();
    renderPosResults();
    renderCart();
    renderProductsTable();
    renderInvResults();
    await loadTodaySales({ silent: true });
  });
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

  // Auth (Firebase)
  $("#btnLogin").onclick = async () => {
    $("#authMsg").className = "msg"; $("#authMsg").textContent = "";
    const u = ($("#loginEmail").value || "").trim();
    const p = $("#loginPass").value || "";
    const email = toEmail(u);
    if (!email || !p) {
      $("#authMsg").className = "msg err";
      $("#authMsg").textContent = "Escribe usuario y contraseña.";
      return;
    }

    try {
      const remember = $("#rememberMe")?.checked;
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, p);
      // onAuthStateChanged se encargará de cargar perfil y datos
    } catch (e) {
      console.error(e);
      const code = String(e?.code || "");
      const msg = String(e?.message || e || "");
      $("#authMsg").className = "msg err";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found" || msg.includes("auth/invalid-credential") || msg.includes("auth/wrong-password") || msg.includes("auth/user-not-found")) {
        $("#authMsg").textContent = "Usuario o contraseña incorrectos.";
      } else if (code === "auth/operation-not-allowed" || msg.includes("auth/operation-not-allowed")) {
        $("#authMsg").textContent = "Firebase Auth no está habilitado (activa Email/Password en Authentication → Método de acceso).";
      } else if (code === "auth/unauthorized-domain" || msg.includes("auth/unauthorized-domain")) {
        $("#authMsg").textContent = "Dominio no autorizado. Agrega tu dominio en Authentication → Configuración → Dominios autorizados.";
      } else if (code === "auth/network-request-failed" || msg.includes("auth/network-request-failed")) {
        $("#authMsg").textContent = "Error de red. Revisa tu conexión a internet y vuelve a intentar.";
      } else if (msg.includes("auth/too-many-requests")) {
        $("#authMsg").textContent = "Demasiados intentos. Intenta de nuevo en unos minutos.";
      } else {
        $("#authMsg").textContent = "No se pudo iniciar sesión. Revisa Firebase/Auth y tu conexión.";
      }
    }
  };

  $("#btnForgot").onclick = async () => {
    $("#authMsg").className = "msg"; $("#authMsg").textContent = "";
    const u = ($("#loginEmail").value || "").trim();
    const email = toEmail(u);
    if (!email) {
      $("#authMsg").className = "msg err";
      $("#authMsg").textContent = "Escribe tu usuario para enviar el correo de recuperación.";
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      $("#authMsg").className = "msg ok";
      $("#authMsg").textContent = "Listo: revisa tu correo para restablecer la contraseña.";
    } catch (e) {
      console.error(e);
      $("#authMsg").className = "msg err";
      $("#authMsg").textContent = "No se pudo enviar el correo. Verifica que el usuario exista en Firebase Auth.";
    }
  };

  $("#btnSignOut").onclick = async () => {
    try { await signOut(auth); } catch {}
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
  $("#btnResetDemo").onclick = async () => {
    if (!confirm("Esto borrará datos de DEMO en Firestore (ventas/cajas/movimientos/productos). ¿Continuar?")) return;
    try {
      const cols = [col.sales, col.shifts, col.inv, col.products];
      for (const c of cols) {
        const snap = await getDocs(c);
        if (snap.empty) continue;
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      state.cart = [];
      state.selectedInvProduct = null;
      state.salesToday = [];
      window.__today_sales = [];
      if (__unsubSalesToday) { try { __unsubSalesToday(); } catch {} __unsubSalesToday = null; }
      if (__unsubProducts) { try { __unsubProducts(); } catch {} __unsubProducts = null; }
      await boot();
      alert("Demo reiniciada ✅");
    } catch (e) {
      alert(e?.message || String(e));
    }
  };

  // Admin seed
  $("#btnSeed").onclick = async () => {
    $("#seedMsg").className = "msg"; $("#seedMsg").textContent = "";
    try {
      ensureLoggedIn();
      if (state.profile?.role !== "admin") throw new Error("Solo admin.");
      const resp = await fetch("./seed_products.json");
      const seed = await resp.json();
      await seedProducts(seed);
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
    $("#whoami").textContent = `${(state.profile?.username || state.user.email)} - ${roleLabel(role)}`;
    $$(".admin-only").forEach(el => el.classList.toggle("hidden", role !== "admin"));
    enforceRoleAccess();
  } else {
    $("#whoami").textContent = "";
    $$(".admin-only").forEach(el => el.classList.add("hidden"));
  }
}

function restoreSession() { /* Firebase Auth maneja la sesión */ }

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
  // Tiempo real: productos
  await ensureSeededProducts();

  if (__unsubProducts) return; // ya suscrito

  await new Promise((resolve) => {
    __unsubProducts = onSnapshot(col.products, (snap) => {
      const products = snap.docs.map(d => {
        const data = d.data() || {};
        return {
          id: d.id,
          sku: String(data.sku || "").toUpperCase(),
          name: data.name || "",
          category: data.category || "General",
          price: Number(data.price || 0),
          cost: Number(data.cost ?? 0),
          stock: Number(data.stock || 0),
          active: data.active !== false
        };
      });

      state.products = products.sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));
      renderProductsTable();
      renderPosResults();
      renderInvResults();

      resolve();
    }, (err) => {
      console.error(err);
      flash("No se pudo cargar productos (Firestore). Revisa reglas/Firestore.", "err");
      resolve();
    });
  });
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
  if (!state.user) {
    state.shift = null;
    if (__unsubShift) { try { __unsubShift(); } catch {} __unsubShift = null; }
    updateCashView();
    return;
  }

  const id = shiftIdForToday(state.user.uid);
  const ref = doc(col.shifts, id);

  if (__unsubShift) { try { __unsubShift(); } catch {} __unsubShift = null; }

  await new Promise((resolve) => {
    __unsubShift = onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        state.shift = null;
      } else {
        const d = snap.data() || {};
        state.shift = {
          id: snap.id,
          uid: d.uid,
          email: d.email,
          dateKey: d.dateKey,
          openingCash: Number(d.openingCash || 0),
          cashSales: Number(d.cashSales || 0),
          cardSales: Number(d.cardSales || 0),
          transferSales: Number(d.transferSales || 0),
          totalSales: Number(d.totalSales || 0),
          openedAt: tsToISO(d.openedAt) || d.openedAt || null,
          closedAt: tsToISO(d.closedAt) || d.closedAt || null,
          countedCash: d.countedCash == null ? null : Number(d.countedCash || 0),
        };
      }
      updateCashView();
      resolve();
    }, (err) => {
      console.error(err);
      flash("No se pudo leer la caja (Firestore).", "err");
      state.shift = null;
      updateCashView();
      resolve();
    });
  });
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

function updateCashView() {
  // Actualiza UI de Caja según el estado de la apertura/cierre (state.shift)
  try { renderShiftSummary(); } catch (e) { console.warn(e); }

  const openInput = $("#openCash");
  const openBtn = $("#btnOpenShift");
  const closeInput = $("#countedCash");
  const closeBtn = $("#btnCloseShift");
  const openMsg = $("#openMsg");
  const closeMsg = $("#closeMsg");

  const shift = state.shift;

  const setDisabled = (el, v) => { if (el) el.disabled = !!v; };
  const setValueIfEmpty = (el, v) => {
    if (!el) return;
    if (el.value === "" || el.value == null) el.value = (v == null ? "" : String(v));
  };

  if (!shift) {
    // No hay apertura hoy
    setDisabled(openInput, false);
    setDisabled(openBtn, false);
    setDisabled(closeInput, true);
    setDisabled(closeBtn, true);
    if (openMsg) openMsg.textContent = "";
    if (closeMsg) closeMsg.textContent = "";
    return;
  }

  // Sí hay turno/shift hoy
  const isClosed = !!shift.closedAt;

  // Mantener valores visibles
  if (openInput) openInput.value = String(Number(shift.openingCash || 0));
  setValueIfEmpty(closeInput, shift.countedCash);

  // Si está cerrado, bloquear acciones
  if (isClosed) {
    setDisabled(openInput, true);
    setDisabled(openBtn, true);
    setDisabled(closeInput, true);
    setDisabled(closeBtn, true);
    if (openMsg) openMsg.textContent = "Caja cerrada hoy.";
    if (closeMsg) closeMsg.textContent = "Caja cerrada hoy.";
    return;
  }

  // Abierto
  setDisabled(openInput, true);
  setDisabled(openBtn, true);
  setDisabled(closeInput, false);
  setDisabled(closeBtn, false);
  if (openMsg) openMsg.textContent = "Caja abierta.";
  if (closeMsg) closeMsg.textContent = "";
}


async function ensureShiftOpen() {
  await refreshShift();
  if (!state.shift || state.shift.closedAt) throw new Error("La caja no está abierta. Ve a 'Caja' y abre con efectivo inicial.");
}

async function openShift({ openingCash }) {
  ensureLoggedIn();
  const id = shiftIdForToday(state.user.uid);
  const ref = doc(col.shifts, id);
  const snap = await getDoc(ref);
  if (snap.exists() && !(snap.data()?.closedAt)) throw new Error("La caja ya está abierta hoy.");

  await setDoc(ref, {
    id,
    uid: state.user.uid,
    email: state.user.email,
    username: state.profile?.username || null,
    role: state.profile?.role || null,
    dateKey: todayKey(),
    openingCash: Number(openingCash || 0),
    cashSales: 0,
    cardSales: 0,
    transferSales: 0,
    totalSales: 0,
    openedAt: serverTimestamp(),
    closedAt: null,
    countedCash: null,
    updatedAt: serverTimestamp(),
  });
}

async function closeShift({ countedCash }) {
  ensureLoggedIn();
  const id = shiftIdForToday(state.user.uid);
  const ref = doc(col.shifts, id);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data()?.closedAt) throw new Error("No hay caja abierta para cerrar.");

  await updateDoc(ref, {
    countedCash: Number(countedCash || 0),
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function createSale({ method, note }) {
  ensureLoggedIn();
  await ensureShiftOpen();

  // validate stock
  const items = state.cart.map(line => {
    const p = state.products.find(x => x.id === line.productId);
    if (!p) throw new Error("Producto no encontrado.");
    const price = Number(p.price || 0);
    const qty = Number(line.qty || 0);
    if (qty <= 0) throw new Error("Cantidad inválida.");
    if (Number(p.stock || 0) < qty) throw new Error(`Stock insuficiente: ${p.name}`);
    return { productId: p.id, sku: p.sku, name: p.name, price, qty, lineTotal: price * qty };
  });

  const total = items.reduce((a, x) => a + Number(x.lineTotal || 0), 0);
  const dateKey = todayKey();
  const shiftId = shiftIdForToday(state.user.uid);

  const saleRef = doc(col.sales); // id auto
  const shiftRef = doc(col.shifts, shiftId);

  await runTransaction(db, async (tx) => {
    // shift must exist and open
    const shSnap = await tx.get(shiftRef);
    if (!shSnap.exists()) throw new Error("Abre la caja antes de vender.");
    if (shSnap.data()?.closedAt) throw new Error("La caja está cerrada.");

    // update stock per product
    for (const it of items) {
      const pRef = doc(col.products, it.productId);
      const pSnap = await tx.get(pRef);
      if (!pSnap.exists()) throw new Error("Producto no encontrado en Firestore.");
      const cur = Number(pSnap.data()?.stock || 0);
      if (cur < it.qty) throw new Error(`Stock insuficiente: ${it.name}`);
      tx.update(pRef, { stock: cur - it.qty, updatedAt: serverTimestamp() });
    }

    // create sale
    tx.set(saleRef, {
      uid: state.user.uid,
      email: state.user.email,
      username: state.profile?.username || null,
      role: state.profile?.role || null,
      dateKey,
      shiftId,
      method,
      note: note || null,
      items: items.map(({ productId, sku, name, price, qty }) => ({ productId, sku, name, price, qty })),
      total,
      createdAt: serverTimestamp(),
    });

    // update shift totals
    const sh = shSnap.data() || {};
    const next = {
      totalSales: Number(sh.totalSales || 0) + total,
      cashSales: Number(sh.cashSales || 0),
      cardSales: Number(sh.cardSales || 0),
      transferSales: Number(sh.transferSales || 0),
      updatedAt: serverTimestamp(),
    };
    if (method === "cash") next.cashSales += total;
    if (method === "card") next.cardSales += total;
    if (method === "transfer") next.transferSales += total;

    tx.update(shiftRef, next);
  });

  // UI update happens via listeners (products/sales/shift)
}

function renderProductsTable() {
  const term = ($("#prodSearch").value || "").toLowerCase().trim();
  const list = state.products
    .filter(p => !term || (p.name || "").toLowerCase().includes(term) || (p.sku || "").toLowerCase().includes(term));

  const profitLabel = (price, cost) => {
    const pr = Number(price || 0);
    const co = Number(cost || 0);
    const gain = pr - co;
    const pct = pr > 0 ? (gain / pr) * 100 : null;
    return `${money(gain)}${pct == null ? "" : ` (${pct.toFixed(1)}%)`}`;
  };

  const table = document.createElement("table");
  table.innerHTML = `
    <thead>
      <tr>
        <th>SKU</th>
        <th>Producto</th>
        <th>Precio</th>
        <th>Costo real</th>
        <th>Ganancia</th>
        <th>Stock</th>
        <th>Activo</th>
        <th>Acción</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector("tbody");

  list.forEach(p => {
    const tr = document.createElement("tr");
    const price = Number(p.price || 0);
    const cost = Number(p.cost || 0);
    tr.innerHTML = `
      <td>${escapeHtml(p.sku || "")}</td>
      <td>${escapeHtml(p.name || "")}</td>
      <td><input data-k="price" data-id="${p.id}" type="number" step="0.01" value="${price}" /></td>
      <td><input data-k="cost" data-id="${p.id}" type="number" step="0.01" value="${cost}" /></td>
      <td><span class="pill" data-profit="${p.id}">${escapeHtml(profitLabel(price, cost))}</span></td>
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

  const updateProfit = (id) => {
    const priceEl = wrap.querySelector(`input[data-id="${id}"][data-k="price"]`);
    const costEl  = wrap.querySelector(`input[data-id="${id}"][data-k="cost"]`);
    const profitEl = wrap.querySelector(`[data-profit="${id}"]`);
    if (!priceEl || !costEl || !profitEl) return;
    profitEl.textContent = profitLabel(Number(priceEl.value || 0), Number(costEl.value || 0));
  };

  wrap.querySelectorAll('input[data-k="price"], input[data-k="cost"]').forEach(inp => {
    inp.oninput = () => updateProfit(inp.dataset.id);
  });

  wrap.querySelectorAll("button[data-save]").forEach(btn => {
    btn.onclick = async () => {
      try {
        ensureLoggedIn();
        const id = btn.dataset.save;
        const priceEl = wrap.querySelector(`input[data-id="${id}"][data-k="price"]`);
        const costEl  = wrap.querySelector(`input[data-id="${id}"][data-k="cost"]`);
        const activeEl = wrap.querySelector(`select[data-id="${id}"][data-k="active"]`);
        const price = Number(priceEl.value || 0);
        const cost = Number(costEl.value || 0);
        const active = (activeEl.value === "true");

        const p = state.products.find(x => x.id === id);
        p.price = price;
        p.cost = cost;
        p.active = active;
        await updateDoc(doc(col.products, id), { price, cost, active, updatedAt: serverTimestamp() });

        $("#prodMsg").className = "msg ok";
        $("#prodMsg").textContent = "Producto actualizado ✅";
        renderPosResults();
        renderCart();
        renderInvResults();
        renderProductsTable();
      } catch (e) {
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

  const pick = (p) => {
    state.selectedInvProduct = p;
    $("#invSelectedHint").innerHTML =
      `Seleccionado: <strong>${escapeHtml(p.name || "")}</strong> <span class="badge">${escapeHtml(p.sku || "")}</span> • Stock: <strong>${Number(p.stock || 0)}</strong>`;
  };

  const edit = async (p) => {
    try { ensureLoggedIn(); } catch (e) { alert(e?.message || String(e)); return; }

    const name = window.prompt("Editar nombre del producto:", p.name || "");
    if (name === null) return;

    const sku = window.prompt("Editar SKU:", (p.sku || "").toUpperCase());
    if (sku === null) return;
    const skuU = String(sku || "").trim().toUpperCase();
    if (!skuU) { alert("SKU inválido."); return; }
    const dup = state.products.some(x => x.id !== p.id && String(x.sku || "").toUpperCase() === skuU);
    if (dup) { alert("Ese SKU ya existe. Usa uno diferente."); return; }

    const priceStr = window.prompt("Precio (venta):", String(Number(p.price || 0)));
    if (priceStr === null) return;
    const price = Number(priceStr || 0);
    if (!Number.isFinite(price) || price < 0) { alert("Precio inválido."); return; }

    const costStr = window.prompt("Costo real:", String(Number(p.cost || 0)));
    if (costStr === null) return;
    const cost = Number(costStr || 0);
    if (!Number.isFinite(cost) || cost < 0) { alert("Costo inválido."); return; }

    const stockStr = window.prompt("Stock:", String(Number(p.stock || 0)));
    if (stockStr === null) return;
    const stock = Number(stockStr || 0);
    if (!Number.isFinite(stock) || stock < 0) { alert("Stock inválido."); return; }

    const active = window.confirm("¿Producto ACTIVO? (Aceptar = Sí / Cancelar = No)");

    p.name = String(name || "").trim();
    p.sku = skuU;
    p.price = price;
    p.cost = cost;
    p.stock = Math.floor(stock);
    p.active = active;

    state.products = state.products.sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"));
     await updateDoc(doc(col.products, p.id), { name: p.name, sku: p.sku, price: p.price, cost: p.cost, stock: p.stock, active: p.active, updatedAt: serverTimestamp() });

    if (state.selectedInvProduct?.id === p.id) pick(p);

    flash("Producto editado ✅", "ok");
    renderPosResults();
    renderCart();
    renderProductsTable();
    renderInvResults();
  };

  // "Eliminar" en Inventario: SOLO elimina el stock (no borra el producto)
  const remove = async (p) => {
    try { ensureLoggedIn(); } catch (e) { alert(e?.message || String(e)); return; }

    const cur = Number(p.stock || 0);
    const ok = window.confirm(
      `¿Eliminar el stock de "${p.name}" (${p.sku})?\n\n` +
      `Stock actual: ${cur}\n` +
      `Esto pondrá el stock en 0. El producto NO se elimina.`
    );
    if (!ok) return;

    try {
      await applyInventory({
        productId: p.id,
        type: "set",
        qty: 0,
        reason: "Eliminar stock (reset a 0)"
      });
    } catch (e) {
      alert(e?.message || String(e));
      return;
    }

    if (state.selectedInvProduct?.id === p.id) pick(p);

    flash("Stock eliminado (0) 🗑️", "ok");
    renderPosResults();
    renderCart();
    renderProductsTable();
    renderInvResults();
  };

  list.forEach(p => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <div>
        <div><strong>${escapeHtml(p.name)}</strong> <span class="badge">${escapeHtml(p.sku || "")}</span></div>
        <div class="muted small">Stock: ${Number(p.stock || 0)}</div>
      </div>
      <div style="margin-left:auto; display:flex; gap:.5rem; flex-wrap:wrap; justify-content:flex-end;">
        <button class="btn btn-ghost" data-act="pick">Elegir</button>
        <button class="btn btn-ghost" data-act="edit">Editar</button>
        <button class="btn btn-ghost" data-act="del">Eliminar</button>
      </div>
    `;

    row.querySelector('[data-act="pick"]').onclick = () => pick(p);
    row.querySelector('[data-act="edit"]').onclick = () => edit(p);
    row.querySelector('[data-act="del"]').onclick = () => remove(p);

    el.appendChild(row);
  });
}

async function applyInventory({ productId, type, qty, reason }) {
  ensureLoggedIn();
  const p = state.products.find(x => x.id === productId);
  if (!p) throw new Error("Producto no encontrado.");

  const pRef = doc(col.products, productId);
  const mvRef = doc(col.inv);

  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(pRef);
    if (!pSnap.exists()) throw new Error("Producto no encontrado en Firestore.");
    const cur = Number(pSnap.data()?.stock || 0);
    let next = cur;
    if (type === "in") next = cur + qty;
    if (type === "out") next = cur - qty;
    if (type === "set") next = qty;
    if (next < 0) throw new Error("El stock no puede quedar negativo.");

    tx.update(pRef, { stock: next, updatedAt: serverTimestamp() });
    tx.set(mvRef, {
      productId,
      sku: String(pSnap.data()?.sku || "").toUpperCase(),
      name: pSnap.data()?.name || "",
      type,
      qty,
      reason: reason || null,
      uid: state.user.uid,
      email: state.user.email,
      dateKey: todayKey(),
      createdAt: serverTimestamp(),
    });
  });

  // UI se actualiza por listener de productos
}

async function seedProducts(seed) {
  // Reemplaza todo el catálogo en Firestore (demo)
  const snap = await getDocs(col.products);
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));

  seed.forEach((p, idx) => {
    const id = `p_${idx + 1}`;
    batch.set(doc(col.products, id), {
      sku: String(p.sku || "").toUpperCase(),
      name: p.name,
      category: p.category || "General",
      price: Number(p.price || 0),
      cost: Number(p.cost ?? 0),
      stock: Number(p.stock || 0),
      active: p.active !== false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
}

async function loadTodaySales({ silent=false } = {}) {
  const dateKey = todayKey();

  if (__unsubSalesToday) {
    // ya suscrito; solo re-render
  } else {
    const constraints = [where("dateKey", "==", dateKey)];
    if ((state.profile?.role || "seller") !== "admin") constraints.push(where("uid", "==", state.user.uid));
    const q = query(col.sales, ...constraints);
    await new Promise((resolve) => {
      __unsubSalesToday = onSnapshot(q, (snap) => {
        const sales = snap.docs.map(d => {
          const data = d.data() || {};
          return {
            id: d.id,
            uid: data.uid,
            email: data.email,
            dateKey: data.dateKey,
            shiftId: data.shiftId,
            method: data.method,
            note: data.note || null,
            items: Array.isArray(data.items) ? data.items : [],
            total: Number(data.total || 0),
            createdAt: tsToISO(data.createdAt) || data.createdAt || null
          };
        });

        // sort client-side by createdAt desc
        sales.sort((a,b) => String(b.createdAt||"").localeCompare(String(a.createdAt||"")));

        state.salesToday = sales.slice(0, 250);
        window.__today_sales = state.salesToday;
        if (!silent) flash("Ventas actualizadas (tiempo real) ✅", "ok");

        // render report
        renderTodayReport();
        resolve();
      }, (err) => {
        console.error(err);
        $("#repMsg").className = "msg err";
        $("#repMsg").textContent = "No se pudo leer ventas (Firestore).";
        resolve();
      });
    });
  }

  // render with current state
  window.__today_sales = state.salesToday || [];
  renderTodayReport();
}

function renderTodayReport() {
  const sales = window.__today_sales || [];
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
    <div class="card">
      <div class="row between">
        <div>
          <div class="muted small">Fecha</div>
          <div><strong>${todayKey()}</strong></div>
        </div>
        <div class="pill">Ventas: <strong>${sales.length}</strong></div>
      </div>
      <div class="grid3 mt">
        <div class="stat">
          <div class="muted small">Total</div>
          <div class="big">${money(total)}</div>
        </div>
        <div class="stat">
          <div class="muted small">Efectivo</div>
          <div class="big">${money(cash)}</div>
        </div>
        <div class="stat">
          <div class="muted small">Tarjeta/Transfer</div>
          <div class="big">${money(card + transfer)}</div>
        </div>
      </div>
      <div class="muted small mt">Detalle por usuario</div>
      <div class="list mt">
        ${Array.from(byUser.entries()).sort((a,b)=>b[1]-a[1]).map(([u, t]) => `
          <div class="item row between">
            <div>${escapeHtml(u)}</div>
            <div><strong>${money(t)}</strong></div>
          </div>
        `).join("") || `<div class="item muted">Sin ventas.</div>`}
      </div>
    </div>
  `;

  // table
  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Hora</th>
        <th>Usuario</th>
        <th>Método</th>
        <th class="right">Total</th>
        <th>Items</th>
        <th>Nota</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");
  sales.forEach(s => {
    const items = (s.items || []).map(i => `${i.name} x${i.qty}`).join(" • ");
    const time = (s.createdAt || "").replace("T"," ").slice(0,19);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${escapeHtml(time)}</td>
      <td>${escapeHtml(s.email || s.uid)}</td>
      <td>${escapeHtml(methodLabel(s.method))}</td>
      <td class="right"><strong>${money(s.total)}</strong></td>
      <td class="muted small">${escapeHtml(items)}</td>
      <td class="muted small">${escapeHtml(s.note || "")}</td>
    `;
    tbody.appendChild(tr);
  });

  const wrap = $("#salesTable");
  wrap.innerHTML = "";
  wrap.appendChild(table);
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
