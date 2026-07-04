/**
 * 阅享空间 · 管理后台
 */

const PANEL_TITLES = {
  dashboard: '数据概览',
  books: '图书管理',
  borrows: '借阅记录',
  rooms: '活动室预约',
};

let borrowStatus = 'all';
let roomStatus = 'all';
let bookSearchTimer;
let borrowSearchTimer;
let roomSearchTimer;
let adminCalendarData = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const me = await apiRequest('/api/admin/me');
    document.getElementById('adminUserName').textContent = me.displayName || me.username;
  } catch {
    window.location.href = '/admin/login';
    return;
  }

  initNav();
  initBookModal();
  initFilters();
  await loadDashboard();
});

async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    window.location.href = '/admin/login';
    throw new Error('未登录');
  }
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function initNav() {
  document.querySelectorAll('.sidebar-nav .sidebar-link[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await apiRequest('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin/login';
  });
}

async function switchPanel(panel) {
  document.querySelectorAll('.sidebar-nav .sidebar-link').forEach(b => b.classList.remove('active'));
  document.querySelector(`.sidebar-link[data-panel="${panel}"]`)?.classList.add('active');
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${panel}`).classList.add('active');
  document.getElementById('panelTitle').textContent = PANEL_TITLES[panel] || '管理后台';

  if (panel === 'dashboard') await loadDashboard();
  else if (panel === 'books') await loadBooks();
  else if (panel === 'borrows') await loadBorrows();
  else if (panel === 'rooms') await loadRooms();
}

function initFilters() {
  document.getElementById('bookSearch').addEventListener('input', () => {
    clearTimeout(bookSearchTimer);
    bookSearchTimer = setTimeout(loadBooks, 300);
  });

  document.querySelectorAll('#borrowFilters .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#borrowFilters .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      borrowStatus = btn.dataset.status;
      loadBorrows();
    });
  });
  document.getElementById('borrowSearch').addEventListener('input', () => {
    clearTimeout(borrowSearchTimer);
    borrowSearchTimer = setTimeout(loadBorrows, 300);
  });

  document.querySelectorAll('#roomFilters .filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#roomFilters .filter-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      roomStatus = btn.dataset.status;
      loadRooms();
    });
  });
  document.getElementById('roomSearch').addEventListener('input', () => {
    clearTimeout(roomSearchTimer);
    roomSearchTimer = setTimeout(loadRooms, 300);
  });
}

async function loadDashboard() {
  const stats = await apiRequest('/api/admin/stats');
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card"><div class="stat-value">${stats.totalBooks}</div><div class="stat-label">书目种类</div></div>
    <div class="stat-card"><div class="stat-value">${stats.totalCopies}</div><div class="stat-label">馆藏总册数</div></div>
    <div class="stat-card"><div class="stat-value">${stats.availableCopies}</div><div class="stat-label">当前可借</div></div>
    <div class="stat-card"><div class="stat-value">${stats.activeBorrows}</div><div class="stat-label">借阅中</div></div>
    <div class="stat-card ${stats.overdueBorrows ? 'danger' : ''}"><div class="stat-value">${stats.overdueBorrows}</div><div class="stat-label">已逾期</div></div>
    <div class="stat-card"><div class="stat-value">${stats.returnedTotal}</div><div class="stat-label">累计归还</div></div>
    <div class="stat-card"><div class="stat-value">${stats.roomToday}</div><div class="stat-label">今日活动室预约</div></div>
    <div class="stat-card"><div class="stat-value">${stats.readerCount}</div><div class="stat-label">注册读者</div></div>
  `;

  const popular = document.getElementById('popularBooks');
  if (!stats.popularBooks.length) {
    popular.innerHTML = '<p class="empty-row">暂无借阅数据</p>';
    return;
  }
  popular.innerHTML = stats.popularBooks.map((b, i) => `
    <div class="popular-item">
      <span>${i + 1}. ${b.title} · ${b.author}</span>
      <span>${b.count} 次</span>
    </div>
  `).join('');
}

async function loadBooks() {
  const search = document.getElementById('bookSearch').value.trim();
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  const books = await apiRequest(`/api/admin/books${qs}`);
  const tbody = document.getElementById('booksTableBody');

  if (!books.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">暂无图书</td></tr>';
    return;
  }

  tbody.innerHTML = books.map(b => `
    <tr>
      <td>${b.id}</td>
      <td><strong>${esc(b.title)}</strong></td>
      <td>${esc(b.author)}</td>
      <td>${esc(b.category)}</td>
      <td>${b.copies}</td>
      <td>${b.borrowed}</td>
      <td>${b.available}</td>
      <td class="table-actions">
        <button class="btn btn-outline btn-sm" data-edit="${b.id}">编辑</button>
        <button class="btn btn-danger btn-sm" data-del="${b.id}">删除</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openEditBook(btn.dataset.edit, books));
  });
  tbody.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', () => deleteBook(btn.dataset.del));
  });
}

async function loadBorrows() {
  const search = document.getElementById('borrowSearch').value.trim();
  const params = new URLSearchParams({ status: borrowStatus });
  if (search) params.set('search', search);
  const records = await apiRequest(`/api/admin/borrows?${params}`);
  const tbody = document.getElementById('borrowsTableBody');

  if (!records.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">暂无记录</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    let statusClass = 'returned', statusText = '已归还';
    if (r.status === 'borrowed') {
      statusClass = r.overdue ? 'overdue' : 'active';
      statusText = r.overdue ? '已逾期' : '借阅中';
    }
    return `
      <tr>
        <td><code>${r.code}</code></td>
        <td>${esc(r.bookTitle)}</td>
        <td>${esc(r.name)}</td>
        <td>${r.phone}</td>
        <td>${r.borrowDate}</td>
        <td>${r.dueDate}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td class="table-actions">
          ${r.status === 'borrowed' ? `<button class="btn btn-primary btn-sm" data-return="${r.id}">确认归还</button>` : '—'}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-return]').forEach(btn => {
    btn.addEventListener('click', () => adminReturn(btn.dataset.return));
  });
}

async function loadRooms() {
  await loadAdminRoomSchedule();
  const search = document.getElementById('roomSearch').value.trim();
  const params = new URLSearchParams({ status: roomStatus });
  if (search) params.set('search', search);
  const records = await apiRequest(`/api/admin/room/bookings?${params}`);
  const tbody = document.getElementById('roomsTableBody');

  if (!records.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="8">暂无预约</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(r => {
    const endHour = parseInt(r.timeSlot) + r.duration;
    let statusClass = 'upcoming', statusText = '有效';
    if (r.status === 'cancelled') { statusClass = 'cancelled'; statusText = '已取消'; }
    else if (r.status !== 'upcoming') { statusClass = 'returned'; statusText = '已完成'; }
    return `
      <tr>
        <td><code>${r.code}</code></td>
        <td>${r.date}</td>
        <td>${r.timeSlot}–${String(endHour).padStart(2,'0')}:00</td>
        <td>${esc(r.purpose)}</td>
        <td>${esc(r.name)}<br><small>${r.phone}</small></td>
        <td>${r.attendees}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        <td class="table-actions">
          ${r.status === 'upcoming' ? `<button class="btn btn-danger btn-sm" data-cancel="${r.id}">取消预约</button>` : '—'}
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', () => adminCancelRoom(btn.dataset.cancel));
  });
}

function initBookModal() {
  document.getElementById('addBookBtn').addEventListener('click', () => openAddBook());
  document.getElementById('bookForm').addEventListener('submit', handleBookSubmit);

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.getElementById('bookModal').addEventListener('click', e => {
    if (e.target.id === 'bookModal') closeModal('bookModal');
  });
}

function openAddBook() {
  document.getElementById('bookModalTitle').textContent = '添加图书';
  document.getElementById('editBookId').value = '';
  document.getElementById('bookTitle').value = '';
  document.getElementById('bookAuthor').value = '';
  document.getElementById('bookCategory').value = '文学';
  document.getElementById('bookCopies').value = 1;
  document.getElementById('bookIsbn').value = '';
  openModal('bookModal');
}

function openEditBook(id, books) {
  const b = books.find(x => x.id === id);
  if (!b) return;
  document.getElementById('bookModalTitle').textContent = '编辑图书';
  document.getElementById('editBookId').value = b.id;
  document.getElementById('bookTitle').value = b.title;
  document.getElementById('bookAuthor').value = b.author;
  document.getElementById('bookCategory').value = b.category;
  document.getElementById('bookCopies').value = b.copies;
  document.getElementById('bookIsbn').value = b.isbn || '';
  openModal('bookModal');
}

async function handleBookSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editBookId').value;
  const payload = {
    title: document.getElementById('bookTitle').value.trim(),
    author: document.getElementById('bookAuthor').value.trim(),
    category: document.getElementById('bookCategory').value,
    copies: parseInt(document.getElementById('bookCopies').value),
    isbn: document.getElementById('bookIsbn').value.trim(),
  };

  try {
    if (id) {
      await apiRequest(`/api/admin/books/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('图书已更新');
    } else {
      await apiRequest('/api/admin/books', { method: 'POST', body: JSON.stringify(payload) });
      showToast('图书已添加');
    }
    closeModal('bookModal');
    await loadBooks();
    if (document.getElementById('panel-dashboard').classList.contains('active')) {
      await loadDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteBook(id) {
  if (!confirm('确定删除该图书？相关历史借阅记录也会一并删除。')) return;
  try {
    await apiRequest(`/api/admin/books/${id}`, { method: 'DELETE' });
    showToast('图书已删除');
    await loadBooks();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminReturn(id) {
  if (!confirm('确认该图书已归还？')) return;
  try {
    await apiRequest(`/api/admin/borrows/${id}/return`, { method: 'POST' });
    showToast('归还成功');
    await loadBorrows();
    await loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function adminCancelRoom(id) {
  if (!confirm('确定取消该预约？')) return;
  try {
    await apiRequest(`/api/admin/room/bookings/${id}/cancel`, { method: 'POST' });
    showToast('预约已取消');
    await loadRooms();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAdminRoomSchedule() {
  const wrap = document.getElementById('adminRoomSchedule');
  const tip = document.getElementById('adminScheduleTip');
  tip.classList.add('hidden');

  try {
    adminCalendarData = await apiRequest('/api/admin/room/calendar');
    const data = adminCalendarData;
    const slots = data.timeSlots;

    let html = '<div class="admin-schedule-grid">';
    html += '<div class="head"></div>';
    slots.forEach(s => { html += `<div class="head">${s.replace(':00', '')}</div>`; });

    data.days.forEach(day => {
      const rowCls = day.isToday ? 'today-row' : '';
      html += `<div class="date-label ${rowCls}">${day.displayMonth}/${day.displayDay}<small>${day.weekday}</small></div>`;
      day.slots.forEach(slot => {
        const booking = findBookingAtSlot(day, slot.time);
        const title = booking
          ? `${slot.time} 已约 · ${booking.purpose} · ${booking.name}`
          : slot.time;
        if (slot.status === 'booked' && booking) {
          html += `<button type="button" class="admin-schedule-cell booked" data-bid="${booking.id}" title="${escAttr(title)}"></button>`;
        } else {
          html += `<div class="admin-schedule-cell ${slot.status}" title="${escAttr(title)}"></div>`;
        }
      });
    });
    html += '</div>';
    wrap.innerHTML = html;

    wrap.querySelectorAll('.admin-schedule-cell.booked').forEach(cell => {
      cell.addEventListener('click', () => {
        const b = findAdminBookingById(cell.dataset.bid);
        if (!b) return;
        tip.classList.remove('hidden');
        tip.innerHTML = `
          <strong>${b._date} ${b.timeSlot}</strong>（${b.duration} 小时）· 预约码 <code>${b.code}</code><br>
          用途：${esc(b.purpose)} · 联系人：${esc(b.name)}（${b.phone}）· ${b.attendees} 人
          <button type="button" class="btn btn-danger btn-sm" style="margin-left:0.5rem" data-cancel-cal="${b.id}">取消预约</button>
        `;
        tip.querySelector('[data-cancel-cal]')?.addEventListener('click', () => adminCancelRoom(b.id));
      });
    });
  } catch (err) {
    wrap.innerHTML = `<p class="empty-row">${esc(err.message)}</p>`;
  }
}

function findBookingAtSlot(day, slotTime) {
  if (!day.bookings) return null;
  const hour = parseInt(slotTime);
  return day.bookings.find(b => {
    const start = parseInt(b.timeSlot);
    return hour >= start && hour < start + b.duration;
  }) || null;
}

function findAdminBookingById(id) {
  if (!adminCalendarData) return null;
  for (const day of adminCalendarData.days) {
    const b = (day.bookings || []).find(x => x.id === id);
    if (b) return { ...b, _date: day.date };
  }
  return null;
}

function escAttr(str) {
  return String(str || '').replace(/"/g, '&quot;');
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast${type === 'error' ? ' error' : ''}`;
  t.textContent = msg;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
