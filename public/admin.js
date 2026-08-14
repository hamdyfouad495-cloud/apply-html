/* ═══════════════════════════════════════════════════════════════
   admin.js — Admin Dashboard with Discord OAuth, Roles & CSRF
   ═══════════════════════════════════════════════════════════════ */

let currentUser = null;
let allApplications = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 50;

/* ─── Icons (custom line-icon set, replaces raw emoji/symbols) ─── */
const ICONS = {
  check: '<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>',
  close: '<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m18 6-12 12"/><path d="m6 6 12 12"/></svg></span>',
  undo: '<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.51 13a9 9 0 1 0 2.13-9.36L3 7"/></svg></span>',
  chevronLeft: '<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></span>',
  chevronRight: '<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>'
};

/* ─── Auth ─── */
async function checkAuth() {
  try {
    const user = await apiGet('/api/auth/me');
    if (!user.authenticated) return false;

    currentUser = user;

    if (!user.isAdmin) {
      showToast('حسابك مش مسجل كأدمن في النظام', 'error');
      return false;
    }

    return true;
  } catch (err) {
    return false;
  }
}

function updateUserUI() {
  if (!currentUser) return;

  const avatar = document.getElementById('userAvatar');
  const name = document.getElementById('userName');
  const role = document.getElementById('userRole');

  if (avatar) {
    avatar.src = currentUser.avatar || '';
    avatar.style.display = currentUser.avatar ? 'block' : 'none';
  }
  if (name) name.textContent = currentUser.username || '';
  if (role) {
    role.textContent = currentUser.role === 'superadmin' ? 'سوبر أدمن' : 
                       currentUser.role === 'admin' ? 'أدمن' : 'مشرف';
    role.className = `badge ${currentUser.role === 'superadmin' ? 'badge-superadmin' : 'badge-admin'}`;
  }
}

async function handleLogout() {
  try {
    await apiPost('/api/auth/logout', {});
    currentUser = null;
    showToast('تم تسجيل الخروج', 'success');
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    showToast('خطأ في تسجيل الخروج', 'error');
  }
}

/* ─── Dashboard ─── */
function showDashboard() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('dashboardView').classList.remove('hidden');
  updateUserUI();
  loadStats();
  loadApplications();

  if (currentUser.role === 'superadmin') {
    document.getElementById('roleManager').classList.remove('hidden');
    loadAdminRoles();
  }
}

function showLogin() {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('dashboardView').classList.add('hidden');
}

/* ─── Stats ─── */
async function loadStats() {
  try {
    const stats = await apiGet('/api/stats');
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statPending').textContent = stats.pending;
    document.getElementById('statAccepted').textContent = stats.accepted;
    document.getElementById('statRejected').textContent = stats.rejected;
  } catch (err) {
    console.error('Stats error:', err);
  }
}

/* ─── Applications ─── */
async function loadApplications() {
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('loading');
  }

  try {
    const status = document.getElementById('statusFilter')?.value || 'all';
    const search = document.getElementById('searchInput')?.value || '';

    const data = await apiGet(`/api/applications?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&page=${currentPage}&limit=${ITEMS_PER_PAGE}`);

    allApplications = data.applications || [];
    renderTable();
    renderPagination(data.total, data.pages, data.currentPage);
  } catch (err) {
    showToast('تعذر تحميل الطلبات', 'error');
    console.error(err);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('loading');
    }
  }
}

function renderTable() {
  const tbody = document.getElementById('appsTableBody');
  const emptyState = document.getElementById('emptyState');

  if (!tbody) return;

  if (allApplications.length === 0) {
    tbody.innerHTML = '';
    emptyState?.classList.remove('hidden');
    return;
  }

  emptyState?.classList.add('hidden');

  const statusLabels = { pending: 'قيد المراجعة', accepted: 'مقبول', rejected: 'مرفوض' };
  const statusClasses = { pending: 'badge-pending', accepted: 'badge-accepted', rejected: 'badge-rejected' };

  tbody.innerHTML = allApplications.map(app => {
    const date = app.submittedAt ? new Date(app.submittedAt).toLocaleString('ar-SA') : '—';
    return `
      <tr data-id="${escapeHtml(app.id)}">
        <td><span class="badge ${statusClasses[app.status] || ''}">${statusLabels[app.status] || app.status}</span></td>
        <td><strong>${escapeHtml(app.name)}</strong></td>
        <td>${escapeHtml(app.age)}</td>
        <td>${escapeHtml(app.discordName)}</td>
        <td><code style="font-size:12px;background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:4px;">${escapeHtml(app.discordId)}</code></td>
        <td>${escapeHtml(app.country)}</td>
        <td>${escapeHtml(app.hours)} س</td>
        <td class="cell-experience" title="${escapeHtml(app.experience)}">${escapeHtml(app.experience)}</td>
        <td style="font-size:12px;white-space:nowrap;">${date}</td>
        <td>
          <div class="table-actions">
            <button class="btn-accept" data-action="accepted" ${app.status === 'accepted' ? 'disabled' : ''}>${ICONS.check} قبول</button>
            <button class="btn-reject" data-action="rejected" ${app.status === 'rejected' ? 'disabled' : ''}>${ICONS.close} رفض</button>
            ${app.status !== 'pending' ? `<button class="btn-reset" data-action="pending">${ICONS.undo} إعادة</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach event listeners
  tbody.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', handleAction);
  });
}

function renderPagination(total, pages, current) {
  const container = document.getElementById('pagination');
  if (!container) return;

  if (pages <= 1) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  let html = '';

  // Prev (RTL layout: "previous page" points toward the start, visually right-pointing)
  html += `<button ${current === 1 ? 'disabled' : ''} onclick="changePage(${current - 1})">${ICONS.chevronRight}</button>`;

  // Pages
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= current - 1 && i <= current + 1)) {
      html += `<button class="${i === current ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
    } else if (i === current - 2 || i === current + 2) {
      html += `<span style="color:var(--text-muted);padding:0 4px;">...</span>`;
    }
  }

  // Next
  html += `<button ${current === pages ? 'disabled' : ''} onclick="changePage(${current + 1})">${ICONS.chevronLeft}</button>`;

  container.innerHTML = html;
}

window.changePage = function(page) {
  currentPage = page;
  loadApplications();
};

async function handleAction(e) {
  const btn = e.currentTarget;
  const row = btn.closest('tr');
  const id = row.dataset.id;
  const action = btn.dataset.action;

  row.querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    await apiPatch(`/api/applications/${id}`, { status: action, _csrf: csrfToken });

    showToast(action === 'accepted' ? 'تم القبول بنجاح' : 
              action === 'rejected' ? 'تم الرفض' : 'تمت إعادة المراجعة', 'success');

    await loadStats();
    await loadApplications();
  } catch (err) {
    showToast(err.message || 'حدث خطأ', 'error');
    row.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

/* ─── Export ─── */
function exportCSV() {
  window.location.href = '/api/export';
}

/* ─── Role Manager ─── */
async function loadAdminRoles() {
  try {
    const roles = await apiGet('/api/admin/roles');
    const container = document.getElementById('roleList');
    if (!container) return;

    if (roles.length === 0) {
      container.innerHTML = '<p class="text-muted text-center" style="padding:20px;">مفيش أدمنز مسجلين غيرك</p>';
      return;
    }

    container.innerHTML = roles.map(role => `
      <div class="role-item">
        <div class="role-item-info">
          <img src="${escapeHtml(role.user.avatar || '')}" alt="" class="role-item-avatar" onerror="this.style.display='none'">
          <div>
            <div style="font-weight:700;font-size:14px;">${escapeHtml(role.user.username)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(role.user.discordId)}</div>
          </div>
          <span class="badge ${role.role === 'admin' ? 'badge-admin' : 'badge-pending'}">
            ${role.role === 'admin' ? 'أدمن' : 'مشرف'}
          </span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="removeAdmin('${role.id}')">
          <span class="icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </span>
          <span>حذف</span>
        </button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Role load error:', err);
  }
}

async function addAdmin() {
  const discordId = document.getElementById('newAdminDiscordId')?.value.trim();
  const role = document.getElementById('newAdminRole')?.value;

  if (!discordId || !/^\d{15,20}$/.test(discordId)) {
    showToast('آيدي ديسكورد غير صحيح', 'error');
    return;
  }

  try {
    await apiPost('/api/admin/roles', { discordId, role, _csrf: csrfToken });
    showToast('تم إضافة الأدمن بنجاح', 'success');
    document.getElementById('newAdminDiscordId').value = '';
    await loadAdminRoles();
  } catch (err) {
    showToast(err.message || 'تعذر الإضافة', 'error');
  }
}

window.removeAdmin = async function(id) {
  if (!confirm('متأكد إنك عايز تمسح الأدمن ده؟')) return;

  try {
    await apiDelete(`/api/admin/roles/${id}`);
    showToast('تم الحذف', 'success');
    await loadAdminRoles();
  } catch (err) {
    showToast(err.message || 'تعذر الحذف', 'error');
  }
};

/* ─── Init ─── */
document.addEventListener('DOMContentLoaded', async () => {
  // Check URL params for errors
  const params = new URLSearchParams(window.location.search);
  if (params.get('error') === 'auth_failed') {
    showLogin();
    const errEl = document.getElementById('loginError');
    if (errEl) {
      errEl.textContent = 'فشل تسجيل الدخول. حاول مرة أخرى.';
      errEl.style.display = 'block';
    }
    return;
  }

  const isAuth = await checkAuth();
  if (isAuth) {
    showDashboard();
  } else {
    showLogin();
  }

  // Event listeners
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('refreshBtn')?.addEventListener('click', loadApplications);
  document.getElementById('exportBtn')?.addEventListener('click', exportCSV);
  document.getElementById('searchInput')?.addEventListener('input', debounce(loadApplications, 400));
  document.getElementById('statusFilter')?.addEventListener('change', () => { currentPage = 1; loadApplications(); });
  document.getElementById('addAdminBtn')?.addEventListener('click', addAdmin);
});

function debounce(fn, ms) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
