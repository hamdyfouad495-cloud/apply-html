/* ═══════════════════════════════════════════════════════════════
   app.js — Core Utilities & Shared Functions
   ═══════════════════════════════════════════════════════════════ */

const STORAGE_KEY = 'applicant_discord_id';
let csrfToken = null;

/* ─── Utilities ─── */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  if (!toast || !toastMessage) return;

  toastMessage.textContent = message;
  toast.className = `toast show ${type}`;

  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 5000);
}

/* ─── CSRF Token ─── */
async function fetchCsrfToken() {
  try {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    csrfToken = data.csrfToken;
  } catch (err) {
    console.warn('Failed to fetch CSRF token:', err);
  }
}

// Guarantees a token exists before a mutating request fires, instead of
// racing the page-load fetch (which could still be in flight on a fast click).
async function ensureCsrfToken() {
  if (!csrfToken) await fetchCsrfToken();
  return csrfToken;
}

/* ─── API Helpers ─── */
async function apiGet(url) {
  const headers = {};
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(url, { headers, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function apiPost(url, body) {
  await ensureCsrfToken();
  const headers = { 'Content-Type': 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include'
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function apiPatch(url, body) {
  await ensureCsrfToken();
  const headers = { 'Content-Type': 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
    credentials: 'include'
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

async function apiDelete(url) {
  await ensureCsrfToken();
  const headers = {};
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const res = await fetch(url, {
    method: 'DELETE',
    headers,
    credentials: 'include'
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.data = data;
    throw err;
  }
  return data;
}

/* ─── Site Config ───
   Edit these with your real links — they currently point nowhere.
   Used by [data-link] elements (see support.html) and the navbar brand name. */
const SITE_CONFIG = {
  serverName: 'سيرفر الديسكورد',
  links: {
    support: 'https://discord.gg/your-invite-code',
    github: 'https://github.com/your-org/your-repo'
  }
};

function hydrateSiteLinks() {
  document.querySelectorAll('[data-link]').forEach((el) => {
    const key = el.dataset.link;
    const href = SITE_CONFIG.links[key];
    if (href) el.href = href;
  });

  const nameEl = document.querySelector('[data-server-name]');
  if (nameEl && SITE_CONFIG.serverName) nameEl.textContent = SITE_CONFIG.serverName;
}

/* ─── Branding ─── */
async function hydrateBranding() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    const user = await res.json();

    // Update nav if logged in
    if (user.authenticated) {
      const navLinks = document.querySelector('.nav-links');
      if (navLinks && !document.getElementById('navUserMenu')) {
        const adminLink = navLinks.querySelector('a[href="admin.html"]');
        if (adminLink) {
          adminLink.innerHTML = `<img src="${escapeHtml(user.avatar || '')}" style="width:24px;height:24px;border-radius:50%;vertical-align:middle;margin-left:6px;"> الأدمن`;
        }
      }
    }
  } catch (e) {}
}

/* ─── Status Banner ─── */
const STATUS_ICONS = {
  pending: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
  accepted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>',
  rejected: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>'
};

const STATUS_CONFIG = {
  pending: { icon: STATUS_ICONS.pending, title: 'طلبك قيد المراجعة', text: 'استلمنا طلبك وهيتم مراجعته من الإدارة قريبًا. تابع الصفحة دي للتحديث.', color: 'warning' },
  accepted: { icon: STATUS_ICONS.accepted, title: 'تم قبولك!', text: 'مبروك، تم قبول طلب انضمامك. أهلاً بيك معانا في السيرفر.', color: 'success' },
  rejected: { icon: STATUS_ICONS.rejected, title: 'تم رفض طلبك', text: 'للأسف تم رفض طلبك في الوقت الحالي. تقدر تتواصل مع الدعم الفني.', color: 'danger' }
};

function renderStatusBanner(banner, status, name) {
  const info = STATUS_CONFIG[status];
  if (!info || !banner) return;
  const title = name ? `${info.title} يا ${name}` : info.title;
  banner.className = `status-banner ${status}`;
  banner.innerHTML = `
    <div class="status-icon">${info.icon}</div>
    <div class="status-content">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(info.text)}</p>
    </div>
  `;
}

async function hydrateStatusBanner() {
  const banner = document.getElementById('statusBanner');
  if (!banner) return;

  const savedId = localStorage.getItem(STORAGE_KEY);
  if (!savedId) return;

  try {
    const app = await apiGet(`/api/applications/discord/${savedId}/status`);
    renderStatusBanner(banner, app.status, app.name);
    banner.classList.remove('hidden');

    const form = document.getElementById('applyForm');
    if (form) form.classList.add('hidden');
  } catch (err) {
    // No application found or error
  }
}

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', () => {
  fetchCsrfToken();
  hydrateSiteLinks();
});
