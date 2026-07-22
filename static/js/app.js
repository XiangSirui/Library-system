/**
 * 阅享空间 · 社区共享图书馆
 * 前端 + Flask API 联调版
 */
let books = [];
const ACTIVITY_ROOM = {
  id: 'community-room',
  name: '社区共享活动室',
  desc: '本馆唯一的公共活动空间，配备投影、音响与白板，适合读书分享会、社区讲座、小型聚会等活动。可容纳 30 人。',
  capacity: 30,
  features: ['投影仪', '音响系统', '白板', '活动桌椅', '免费 WiFi']
};
const ALL_TIME_SLOTS = [
  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',
  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'
];
let TIME_SLOTS = [...ALL_TIME_SLOTS];
let openRoomSlots = [...ALL_TIME_SLOTS];
const CLOSE_HOUR = 20;
const BORROW_DAYS = 30;
const BOOKING_DAYS = 14;
const STORAGE_USER = 'yuexiang_user';
let bookFilter = 'all';
let bookSearch = '';
let recordTab = 'borrows';
let borrowTab = 'active';
let roomTab = 'upcoming';
let selectedRoomSlot = null;
let selectedBook = null;
let bookedRoomSlots = [];
// ========== API ==========
async function apiRequest(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}
async function fetchBooks() {
  const params = new URLSearchParams();
  if (bookFilter !== 'all') params.set('category', bookFilter);
  if (bookSearch) params.set('search', bookSearch);
  const qs = params.toString();
  books = await apiRequest(`/api/books${qs ? '?' + qs : ''}`);
}
// ========== Init ==========
document.addEventListener('DOMContentLoaded', async () => {
  initNav();
  initBookFilters();
  initRecordTabs();
  initSubTabs();
  initModals();
  initForms();
  initRecordsPhone();
  initRoomCalendar(openRoomBookingForm);
  const user = getUser();
  if (user.phone) {
    document.getElementById('recordsPhone').value = user.phone;
  }
  try {
    await refreshAll();
  } catch (err) {
    showToast(err.message || '加载失败，请确认后端已启动', 'error');
  }
});
async function refreshAll() {
  await fetchBooks();
  document.getElementById('heroBookCount').textContent = books.length + ' 本';
  renderBooks();
  await renderRoomShowcase();
  await renderBorrows();
  await renderRoomBookings();
  await renderMyRecordsReviews();
}
function initNav() {
  const scrollToBooks = () => document.getElementById('books').scrollIntoView({ behavior: 'smooth' });
  document.getElementById('quickBorrowBtn').addEventListener('click', scrollToBooks);
  document.getElementById('heroBorrowBtn').addEventListener('click', scrollToBooks);
  document.getElementById('mobileQuickBorrow').addEventListener('click', () => { closeMobileMenu(); scrollToBooks(); });
  document.getElementById('emptyBorrowBtn').addEventListener('click', scrollToBooks);
  document.getElementById('emptyRoomBtn').addEventListener('click', () => {
    document.getElementById('activity-room').scrollIntoView({ behavior: 'smooth' });
  });
  const menu = document.getElementById('mobileMenu');
  document.getElementById('mobileMenuBtn').addEventListener('click', () => menu.classList.toggle('open'));
  document.querySelectorAll('.mobile-link').forEach(l => l.addEventListener('click', closeMobileMenu));
}
function closeMobileMenu() {
  document.getElementById('mobileMenu').classList.remove('open');
}
function initRecordsPhone() {
  const input = document.getElementById('recordsPhone');
  const btn = document.getElementById('recordsPhoneBtn');
  const query = async () => {
    const phone = input.value.trim();
    if (phone && (phone.length !== 11 || !/^\d+$/.test(phone))) {
      showToast('请输入正确的手机号', 'error');
      return;
    }
    if (phone) saveUser({ ...getUser(), phone });
    try {
      await renderBorrows();
      await renderRoomBookings();
      await renderMyRecordsReviews();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };
  btn.addEventListener('click', query);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') query(); });
}
// ========== User (localStorage) ==========
function getUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_USER)) || {}; } catch { return {}; }
}
function saveUser(u) { localStorage.setItem(STORAGE_USER, JSON.stringify(u)); }
function getRecordsPhone() {
  return document.getElementById('recordsPhone').value.trim() || getUser().phone || '';
}
function getBookCoverFallback(book) {
  return `/static/images/covers/${book.id}.svg`;
}
function getBookCoverRemote(book) {
  const isbn = book.coverIsbn || book.isbn.replace(/-/g, '');
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
}
function bookCoverImg(book, className = 'book-cover-img') {
  const fallback = getBookCoverFallback(book);
  const remote = getBookCoverRemote(book);
  return `<img class="${className}" src="${fallback}" alt="${book.title} - ${book.author}" loading="lazy" data-fallback="${fallback}" data-remote="${remote}">`;
}
function bindCoverFallback(root = document) {
  root.querySelectorAll('.book-cover-img[data-fallback]').forEach(img => {
    if (img.dataset.bound) return;
    img.dataset.bound = '1';
    img.addEventListener('error', () => {
      if (img.src !== img.dataset.fallback) {
        img.src = img.dataset.fallback;
      }
    });
    if (img.dataset.remote) {
      const probe = new Image();
      probe.onload = () => { img.src = img.dataset.remote; };
      probe.src = img.dataset.remote;
    }
  });
}
function findBook(bookId) {
  return books.find(b => b.id === bookId);
}
// ========== Render Books ==========
function renderBooks() {
  const grid = document.getElementById('booksGrid');
  const empty = document.getElementById('emptyBooks');
  if (books.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  grid.innerHTML = books.map((book, i) => {
    const avail = book.available ?? 0;
    const status = avail === 0 ? 'full' : avail <= 1 ? 'limited' : 'available';
    const statusText = avail === 0 ? '已借完' : `可借 ${avail} 本`;
    return `
      <article class="book-card" style="animation-delay:${i * 0.05}s">
        <div class="book-cover ${book.cover}">
          ${bookCoverImg(book)}
          <span class="book-category">${book.category}</span>
        </div>
        <div class="book-body">
          <h3 class="book-title">${book.title}</h3>
          <p class="book-author">${book.author}</p>
          <p class="book-isbn">ISBN ${book.isbn}</p>
          <div class="book-footer">
            <span class="availability">
              <span class="availability-dot ${status}"></span>${statusText}
            </span>
            <div class="book-actions">
              <button class="btn btn-outline btn-sm" data-reviews="${book.id}">书评</button>
              <button class="btn btn-primary btn-sm" data-borrow="${book.id}" ${avail === 0 ? 'disabled' : ''}>
                ${avail === 0 ? '已借完' : '借阅'}
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');
  grid.querySelectorAll('[data-borrow]').forEach(btn => {
    btn.addEventListener('click', () => openBorrowModal(btn.dataset.borrow));
  });
  grid.querySelectorAll('[data-reviews]').forEach(btn => {
    btn.addEventListener('click', () => openReviewsModal(btn.dataset.reviews));
  });
  bindCoverFallback(grid);
}
function initBookFilters() {
  document.querySelectorAll('[data-book-filter]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-book-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      bookFilter = btn.dataset.bookFilter;
      try {
        await fetchBooks();
        renderBooks();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });
  let searchTimer;
  document.getElementById('bookSearch').addEventListener('input', e => {
    bookSearch = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        await fetchBooks();
        renderBooks();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }, 300);
  });
}
// ========== Borrow Modal ==========
function openBorrowModal(bookId) {
  selectedBook = books.find(b => b.id === bookId);
  if (!selectedBook || (selectedBook.available ?? 0) === 0) return;
  document.getElementById('borrowBookId').value = bookId;
  document.getElementById('borrowBookPreview').innerHTML = `
    ${bookCoverImg(selectedBook, 'preview-cover-img')}
    <div class="preview-info">
      <h3>${selectedBook.title}</h3>
      <p>${selectedBook.author} · ${selectedBook.category}</p>
    </div>
  `;
  bindCoverFallback(document.getElementById('borrowBookPreview'));
  const user = getUser();
  document.getElementById('borrowName').value = user.name || '';
  document.getElementById('borrowPhone').value = user.phone || '';
  document.getElementById('borrowCard').value = user.card || '';
  const due = addDays(new Date(), BORROW_DAYS);
  document.getElementById('borrowSummary').innerHTML =
    `借阅期限 <strong>${BORROW_DAYS} 天</strong>，请于 <strong>${formatDateDisplay(formatDate(due))}</strong> 前归还<br>到馆后凭借阅码在前台取书`;
  openModal('borrowModal');
}
async function handleBorrowSubmit(e) {
  e.preventDefault();
  const bookId = document.getElementById('borrowBookId').value;
  const book = books.find(b => b.id === bookId);
  const name = document.getElementById('borrowName').value.trim();
  const phone = document.getElementById('borrowPhone').value.trim();
  const card = document.getElementById('borrowCard').value.trim();
  try {
    const record = await apiRequest('/api/borrows', {
      method: 'POST',
      body: JSON.stringify({ bookId, name, phone, card }),
    });
    saveUser({ name, phone, card });
    document.getElementById('recordsPhone').value = phone;
    closeModal('borrowModal');
    showSuccess('借阅成功', record.code, '请保存借阅码，到馆在前台取书', `
      <div><strong>图书：</strong>${book.title}</div>
      <div><strong>作者：</strong>${book.author}</div>
      <div><strong>借阅人：</strong>${name}</div>
      <div><strong>应还日期：</strong>${formatDateDisplay(record.dueDate)}</div>
    `);
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
async function returnBook(id) {
  if (!confirm('确认归还此书？')) return;
  try {
    await apiRequest(`/api/borrows/${id}/return`, { method: 'POST' });
    showToast('归还成功');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
async function renewBook(id) {
  try {
    await apiRequest(`/api/borrows/${id}/renew`, { method: 'POST' });
    showToast('续借成功，期限延长 30 天');
    await renderBorrows();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
// ========== Render Borrows ==========
async function renderBorrows() {
  const list = document.getElementById('borrowsList');
  const empty = document.getElementById('emptyBorrows');
  const phone = getRecordsPhone();
  const today = formatDate(new Date());
  if (!phone) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = '请在上方输入手机号查看您的借阅记录';
    return;
  }
  const records = await apiRequest(`/api/borrows?phone=${encodeURIComponent(phone)}&tab=${borrowTab}`);
  if (records.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = '去馆藏选一本心仪的书吧';
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = records.map(b => {
    const book = findBook(b.bookId);
    const overdue = b.status === 'borrowed' && b.dueDate < today;
    const statusClass = b.status === 'returned' ? 'completed' : overdue ? 'cancelled' : 'upcoming';
    const statusText = b.status === 'returned' ? '已归还' : overdue ? '已逾期' : '借阅中';
    return `
      <div class="record-item">
        ${book ? bookCoverImg(book, 'record-cover-img') : '<div class="record-cover-sm cover-1"></div>'}
        <div class="record-info">
          <div class="record-title">${b.bookTitle}</div>
          <div class="record-meta">
            <span>${b.author}</span>
            <span>借阅 ${formatDateDisplay(b.borrowDate)}</span>
            <span>应还 ${formatDateDisplay(b.dueDate)}</span>
            <span class="booking-code">${b.code}</span>
          </div>
        </div>
        <span class="booking-status ${statusClass}">${statusText}</span>
        <div class="record-actions">
          <button class="btn btn-outline btn-sm" data-write-review="${b.bookId}">写书评</button>
          ${b.status === 'borrowed' ? `
            ${!b.renewed ? `<button class="btn btn-outline btn-sm" data-renew="${b.id}">续借</button>` : ''}
            <button class="btn btn-primary btn-sm" data-return="${b.id}">归还</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
  list.querySelectorAll('[data-return]').forEach(btn => btn.addEventListener('click', () => returnBook(btn.dataset.return)));
  list.querySelectorAll('[data-renew]').forEach(btn => btn.addEventListener('click', () => renewBook(btn.dataset.renew)));
  list.querySelectorAll('[data-write-review]').forEach(btn => {
    btn.addEventListener('click', () => openWriteReviewModal(btn.dataset.writeReview));
  });
  bindCoverFallback(list);
}
// ========== Activity Room ==========
async function renderRoomShowcase() {
  const stats = await apiRequest('/api/room/stats');
  const slotsLeft = stats.freeSlots != null
    ? stats.freeSlots
    : Math.max(0, (stats.openCount || TIME_SLOTS.length) - (stats.bookedCount || 0));
  document.getElementById('roomShowcase').innerHTML = `
    <div class="room-card">
      <div class="room-card-visual">
        <div class="room-gradient"></div>
        <span class="room-icon">🏠</span>
        <span class="room-capacity-badge">容纳 ${ACTIVITY_ROOM.capacity} 人</span>
      </div>
      <div class="room-card-body">
        <h3>${ACTIVITY_ROOM.name}</h3>
        <p class="room-desc">${ACTIVITY_ROOM.desc}</p>
        <div class="space-card-features">
          ${ACTIVITY_ROOM.features.map(f => `<span class="feature-tag">${f}</span>`).join('')}
        </div>
        <div class="room-card-footer">
          <div class="availability">
            <span class="availability-dot ${slotsLeft > 3 ? 'available' : slotsLeft > 0 ? 'limited' : 'full'}"></span>
            今日 ${slotsLeft > 0 ? `剩余 ${slotsLeft} 个时段` : '时段已满'}
          </div>
          <button class="btn btn-primary" id="openRoomModal">查看日历并预约</button>
        </div>
      </div>
      <div class="room-card-notices">
        <p class="room-booking-notice">📅 仅开放未来 <strong>14 天（两周）</strong>内预约 · 点击按钮查看占用情况</p>
        <p class="room-booking-notice room-volunteer-notice">🪴 使用结束后请<strong>签退</strong>，并提交社区花园志愿服务照片与说明</p>
      </div>
    </div>
  `;
  document.getElementById('openRoomModal').addEventListener('click', openRoomCalendar);
}
function openRoomBookingForm(date, timeSlot) {
  selectedRoomSlot = timeSlot;
  const user = getUser();
  document.getElementById('roomName').value = user.name || '';
  document.getElementById('roomPhone').value = user.phone || '';
  document.getElementById('roomPurpose').value = '';
  document.getElementById('roomAttendees').value = 10;
  document.getElementById('roomDuration').value = '2';
  document.getElementById('roomDate').value = date;
  document.getElementById('roomDateDisplay').textContent = formatDateDisplay(date);
  loadRoomTimeSlots();
  updateRoomSummary();
  openModal('roomModal');
}
async function loadRoomTimeSlots() {
  const date = document.getElementById('roomDate').value;
  const data = await apiRequest(`/api/room/slots?date=${encodeURIComponent(date)}`);
  bookedRoomSlots = data.bookedSlots || [];
  TIME_SLOTS = data.allSlots?.length ? data.allSlots : [...ALL_TIME_SLOTS];
  openRoomSlots = data.openSlots || [...ALL_TIME_SLOTS];
  renderRoomTimeSlots();
}
function renderRoomTimeSlots() {
  const date = document.getElementById('roomDate').value;
  const booked = bookedRoomSlots;
  const isToday = date === formatDate(new Date());
  const currentHour = new Date().getHours();
  const duration = parseInt(document.getElementById('roomDuration').value) || 1;
  const openSet = new Set(openRoomSlots);
  document.getElementById('roomTimeSlots').innerHTML = TIME_SLOTS.map(slot => {
    const hour = parseInt(slot);
    const past = isToday && hour <= currentHour;
    const closed = !openSet.has(slot);
    const startBooked = booked.includes(slot);
    let overlap = false;
    let durationClosed = false;
    for (let i = 0; i < duration; i++) {
      const checkSlot = `${String(hour + i).padStart(2, '0')}:00`;
      if (booked.includes(checkSlot)) overlap = true;
      if (!openSet.has(checkSlot)) durationClosed = true;
    }
    const endHour = hour + duration;
    const overClose = endHour > CLOSE_HOUR;
    const disabled = past || closed || startBooked || overlap || overClose || durationClosed;
    let cls = 'time-slot';
    if (closed) cls += ' closed';
    else if (past || startBooked || overlap || overClose || durationClosed) cls += ' disabled';
    if (selectedRoomSlot === slot && !disabled) cls += ' selected';
    const label = closed ? `${slot}` : slot;
    return `<button type="button" class="${cls}" data-slot="${slot}" ${disabled ? 'disabled' : ''} title="${closed ? '未开放' : past ? '已过期' : startBooked || overlap ? '已占用' : slot}">${label}</button>`;
  }).join('');
  document.getElementById('roomTimeSlots').querySelectorAll('.time-slot:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedRoomSlot = btn.dataset.slot;
      renderRoomTimeSlots();
      updateRoomSummary();
    });
  });
}
function updateRoomSummary() {
  const summary = document.getElementById('roomSummary');
  const date = document.getElementById('roomDate').value;
  const duration = parseInt(document.getElementById('roomDuration').value);
  if (selectedRoomSlot && date) {
    const endHour = parseInt(selectedRoomSlot) + duration;
    if (endHour > CLOSE_HOUR) {
      summary.innerHTML = '<span style="color:var(--color-danger)">⚠ 超出闭馆时间（20:00），请调整</span>';
      summary.classList.add('visible');
      return;
    }
    summary.innerHTML = `预约 <strong>${ACTIVITY_ROOM.name}</strong><br>${formatDateDisplay(date)} · ${selectedRoomSlot} – ${String(endHour).padStart(2,'0')}:00 · ${duration} 小时`;
    summary.classList.add('visible');
  } else {
    summary.classList.remove('visible');
  }
}
async function handleRoomSubmit(e) {
  e.preventDefault();
  if (!selectedRoomSlot) { showToast('请选择时段', 'error'); return; }
  const date = document.getElementById('roomDate').value;
  const duration = parseInt(document.getElementById('roomDuration').value);
  const purpose = document.getElementById('roomPurpose').value.trim();
  const name = document.getElementById('roomName').value.trim();
  const phone = document.getElementById('roomPhone').value.trim();
  const attendees = parseInt(document.getElementById('roomAttendees').value);
  const endHour = parseInt(selectedRoomSlot) + duration;
  if (endHour > CLOSE_HOUR) { showToast('超出闭馆时间', 'error'); return; }
  try {
    const record = await apiRequest('/api/room/bookings', {
      method: 'POST',
      body: JSON.stringify({
        date,
        timeSlot: selectedRoomSlot,
        duration,
        purpose,
        name,
        phone,
        attendees,
      }),
    });
    saveUser({ ...getUser(), name, phone });
    document.getElementById('recordsPhone').value = phone;
    closeModal('roomModal');
    showSuccess('预约成功', record.code, '请保存预约码，到场时出示；活动结束后请在「我的记录」签退', `
      <div><strong>空间：</strong>${ACTIVITY_ROOM.name}</div>
      <div><strong>日期：</strong>${formatDateDisplay(date)}</div>
      <div><strong>时间：</strong>${selectedRoomSlot} – ${String(endHour).padStart(2,'0')}:00</div>
      <div><strong>用途：</strong>${purpose}</div>
      <div><strong>人数：</strong>${attendees} 人</div>
    `);
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
    await loadRoomTimeSlots();
  }
}
async function cancelRoomBooking(id) {
  if (!confirm('确定取消此预约？')) return;
  try {
    await apiRequest(`/api/room/bookings/${id}/cancel`, { method: 'POST' });
    showToast('预约已取消');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
function openCheckoutModal(booking) {
  const endHour = parseInt(booking.timeSlot) + booking.duration;
  document.getElementById('checkoutBookingId').value = booking.id;
  document.getElementById('volunteerNote').value = '';
  document.getElementById('volunteerImage').value = '';
  document.getElementById('volunteerPreview').classList.add('hidden');
  document.getElementById('checkoutSummary').innerHTML = `
    <div><strong>空间：</strong>${ACTIVITY_ROOM.name}</div>
    <div><strong>日期：</strong>${formatDateDisplay(booking.date)}</div>
    <div><strong>时间：</strong>${booking.timeSlot} – ${String(endHour).padStart(2,'0')}:00</div>
    <div><strong>用途：</strong>${booking.purpose}</div>
    <div><strong>预约码：</strong>${booking.code}</div>
  `;
  openModal('checkoutModal');
}
async function handleCheckoutSubmit(e) {
  e.preventDefault();
  const bookingId = document.getElementById('checkoutBookingId').value;
  const volunteerNote = document.getElementById('volunteerNote').value.trim();
  const volunteerFile = document.getElementById('volunteerImage').files[0];
  const phone = getRecordsPhone() || getUser().phone || '';
  if (!volunteerFile) { showToast('请上传社区花园志愿服务照片', 'error'); return; }
  if (!volunteerNote || volunteerNote.length < 5) { showToast('请填写志愿服务说明（至少 5 字）', 'error'); return; }
  try {
    const formData = new FormData();
    formData.append('volunteerNote', volunteerNote);
    formData.append('volunteerImage', volunteerFile);
    if (phone) formData.append('phone', phone);
    const res = await fetch(`/api/room/bookings/${bookingId}/checkout`, { method: 'POST', body: formData });
    const record = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(record.error || '签退失败');
    closeModal('checkoutModal');
    showSuccess('签退成功', record.code, '感谢您提交志愿服务材料', `
      <div><strong>志愿服务说明：</strong>${volunteerNote}</div>
    `);
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}
async function renderRoomBookings() {
  const list = document.getElementById('roomBookingsList');
  const empty = document.getElementById('emptyRoomBookings');
  const phone = getRecordsPhone();
  const now = new Date();
  if (!phone) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = '请在上方输入手机号查看您的预约记录';
    return;
  }
  const records = await apiRequest(`/api/room/bookings?phone=${encodeURIComponent(phone)}&tab=${roomTab}`);
  if (records.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = '预约共享活动室，举办您的社区活动';
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = records.map(b => {
    const endHour = parseInt(b.timeSlot) + b.duration;
    const bookingTime = new Date(`${b.date}T${b.timeSlot}`);
    let statusClass = 'upcoming';
    let statusText = '待使用';
    if (b.status === 'cancelled') {
      statusClass = 'cancelled';
      statusText = '已取消';
    } else if (b.status === 'checked_out') {
      statusClass = 'completed';
      statusText = '已签退';
    } else if (roomTab === 'past' || bookingTime <= now) {
      statusClass = 'upcoming';
      statusText = '待签退';
    }
    const canCancel = b.status === 'upcoming' && roomTab === 'upcoming' && bookingTime > now;
    const canCheckout = b.status === 'upcoming' && bookingTime <= now;
    return `
      <div class="record-item">
        <div class="record-icon">🏠</div>
        <div class="record-info">
          <div class="record-title">${ACTIVITY_ROOM.name}</div>
          <div class="record-meta">
            <span>${b.purpose}</span>
            <span>${formatDateDisplay(b.date)} ${b.timeSlot}–${String(endHour).padStart(2,'0')}:00</span>
            <span>${b.attendees} 人</span>
            <span class="booking-code">${b.code}</span>
            ${b.status === 'checked_out' ? '<span>志愿服务已提交</span>' : ''}
          </div>
        </div>
        <span class="booking-status ${statusClass}">${statusText}</span>
        <div class="record-actions">
          ${canCheckout ? `<button class="btn btn-primary btn-sm" data-checkout-room="${b.id}">签退</button>` : ''}
          ${canCancel ? `<button class="btn btn-danger btn-sm" data-cancel-room="${b.id}">取消</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  list.querySelectorAll('[data-cancel-room]').forEach(btn => {
    btn.addEventListener('click', () => cancelRoomBooking(btn.dataset.cancelRoom));
  });
  list.querySelectorAll('[data-checkout-room]').forEach(btn => {
    const booking = records.find(r => r.id === btn.dataset.checkoutRoom);
    btn.addEventListener('click', () => openCheckoutModal(booking));
  });
}
// ========== Tabs ==========
function initRecordTabs() {
  document.querySelectorAll('[data-record-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-record-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      recordTab = btn.dataset.recordTab;
      document.getElementById('borrowsPanel').classList.toggle('hidden', recordTab !== 'borrows');
      document.getElementById('reviewsPanel')?.classList.toggle('hidden', recordTab !== 'reviews');
      document.getElementById('roomPanel').classList.toggle('hidden', recordTab !== 'room');
      if (recordTab === 'reviews') {
        try { await renderMyRecordsReviews(); } catch (err) { showToast(err.message, 'error'); }
      }
    });
  });
}
function initSubTabs() {
  document.querySelectorAll('[data-borrow-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-borrow-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      borrowTab = btn.dataset.borrowTab;
      try { await renderBorrows(); } catch (err) { showToast(err.message, 'error'); }
    });
  });
  document.querySelectorAll('[data-room-tab]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-room-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      roomTab = btn.dataset.roomTab;
      try { await renderRoomBookings(); } catch (err) { showToast(err.message, 'error'); }
    });
  });
}
// ========== Modals ==========
function initModals() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay.id); });
  });
  document.getElementById('successClose').addEventListener('click', () => closeModal('successModal'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => closeModal(m.id));
  });
}
function initForms() {
  document.getElementById('borrowForm').addEventListener('submit', handleBorrowSubmit);
  document.getElementById('reviewForm')?.addEventListener('submit', handleReviewSubmit);
  document.getElementById('roomForm').addEventListener('submit', handleRoomSubmit);
  document.getElementById('checkoutForm')?.addEventListener('submit', handleCheckoutSubmit);
  document.getElementById('openWriteReviewBtn')?.addEventListener('click', () => {
    const bookId = document.getElementById('reviewBookId').value;
    if (bookId) openWriteReviewModal(bookId);
  });
  document.getElementById('loadMyReviewsBtn')?.addEventListener('click', () => loadMyReviewsInModal());
  document.getElementById('myReviewsPhone')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadMyReviewsInModal();
  });
  document.querySelectorAll('[data-rating-star]').forEach(btn => {
    btn.addEventListener('click', () => setReviewRating(Number(btn.dataset.ratingStar)));
  });
  document.getElementById('reviewPhone')?.addEventListener('blur', async () => {
    const bookId = document.getElementById('writeReviewBookId')?.value;
    if (!bookId || !document.getElementById('writeReviewModal')?.classList.contains('active')) return;
    const phone = document.getElementById('reviewPhone').value.trim();
    const hint = document.getElementById('reviewEligibilityHint');
    if (!phone || phone.length !== 11) {
      hint.textContent = '请填写借阅时使用的手机号；仅借过本书的读者可发表读后感。';
      hint.className = 'form-summary visible warn';
      return;
    }
    try {
      const elig = await apiRequest(
        `/api/reviews/eligibility?book_id=${encodeURIComponent(bookId)}&phone=${encodeURIComponent(phone)}`
      );
      const tip = reviewEligibilityHint(elig);
      hint.textContent = tip.text;
      hint.className = tip.warn ? 'form-summary visible warn' : 'form-summary visible';
    } catch (err) {
      hint.textContent = err.message;
      hint.className = 'form-summary visible warn';
    }
  });
  document.getElementById('roomDuration').addEventListener('change', () => {
    renderRoomTimeSlots();
    updateRoomSummary();
  });
  document.getElementById('volunteerImage')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    const box = document.getElementById('volunteerPreview');
    const img = document.getElementById('volunteerPreviewImg');
    if (!file) {
      box.classList.add('hidden');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片不能超过 5MB', 'error');
      e.target.value = '';
      box.classList.add('hidden');
      return;
    }
    img.src = URL.createObjectURL(file);
    box.classList.remove('hidden');
  });
}
function openModal(id) {
  document.getElementById(id).classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (!document.querySelector('.modal-overlay.active')) document.body.style.overflow = '';
}
function showSuccess(title, code, hint, detailsHtml) {
  document.getElementById('successTitle').textContent = title;
  document.getElementById('successCodeLine').innerHTML = code ? `凭证码：<strong>${code}</strong>` : '';
  document.getElementById('successHint').textContent = hint;
  document.getElementById('successDetails').innerHTML = detailsHtml;
  openModal('successModal');
}
// ========== Utils ==========
function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDateDisplay(str) {
  const d = new Date(str + 'T00:00:00');
  const w = ['周日','周一','周二','周三','周四','周五','周六'];
  return `${d.getMonth()+1}月${d.getDate()}日 ${w[d.getDay()]}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast${type === 'error' ? ' error' : ''}`;
  t.textContent = msg;
  document.getElementById('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ========== Book Reviews ==========

function starsHtml(rating) {
  const n = Math.round(Number(rating) || 0);
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

function setReviewRating(n) {
  document.getElementById('reviewRating').value = String(n);
  document.querySelectorAll('[data-rating-star]').forEach(btn => {
    const v = Number(btn.dataset.ratingStar);
    btn.classList.toggle('active', v <= n);
    btn.setAttribute('aria-pressed', v === n ? 'true' : 'false');
  });
}

async function openReviewsModal(bookId) {
  const book = books.find(b => b.id === bookId) || await apiRequest(`/api/books/${bookId}`);
  if (!book) return;

  document.getElementById('reviewBookId').value = bookId;
  document.getElementById('reviewsBookPreview').innerHTML = `
    ${bookCoverImg(book, 'preview-cover-img')}
    <div class="preview-info">
      <h3>${book.title}</h3>
      <p>${book.author} · ${book.category}</p>
    </div>
  `;
  bindCoverFallback(document.getElementById('reviewsBookPreview'));

  const listEl = document.getElementById('reviewsList');
  const summaryEl = document.getElementById('reviewsSummary');
  listEl.innerHTML = '<p class="reviews-loading">加载中…</p>';
  summaryEl.textContent = '';

  const phone = getRecordsPhone() || getUser().phone || '';
  const phoneInput = document.getElementById('myReviewsPhone');
  if (phoneInput) phoneInput.value = phone;

  openModal('reviewsModal');

  try {
    const data = await apiRequest(`/api/books/${bookId}/reviews`);
    if (data.count > 0) {
      summaryEl.textContent = `平均 ${data.avgRating} 分 · ${data.count} 条公开读后感`;
    } else {
      summaryEl.textContent = '暂无公开读后感，借阅后可写下你的感想';
    }

    if (!data.reviews.length) {
      listEl.innerHTML = '<p class="reviews-empty">还没有通过审核的书评</p>';
    } else {
      listEl.innerHTML = data.reviews.map(r => `
        <article class="review-item">
          <div class="review-item-head">
            <strong>${escapeHtml(r.name)}</strong>
            <span class="review-stars">${starsHtml(r.rating)}</span>
          </div>
          <p class="review-content">${escapeHtml(r.content)}</p>
          <time class="review-time">${(r.createdAt || '').slice(0, 10)}</time>
        </article>
      `).join('');
    }
  } catch (err) {
    listEl.innerHTML = `<p class="reviews-empty">${escapeHtml(err.message)}</p>`;
  }

  await loadMyReviewsInModal();
}

function reviewStatusMeta(status) {
  if (status === 'pending') return { cls: 'pending', text: '审核中' };
  if (status === 'rejected') return { cls: 'rejected', text: '未通过' };
  return { cls: 'approved', text: '已通过' };
}

function renderMyReviewCards(reviews, { showBook = false } = {}) {
  return reviews.map(r => {
    const st = reviewStatusMeta(r.status);
    return `
      <article class="review-item my-review-item">
        <div class="review-item-head">
          <div>
            ${showBook ? `<strong class="my-review-book">${escapeHtml(r.bookTitle || '')}</strong>` : '<strong>我的书评</strong>'}
            <span class="review-status-badge ${st.cls}">${st.text}</span>
          </div>
          <span class="review-stars">${starsHtml(r.rating)}</span>
        </div>
        <p class="review-content">${escapeHtml(r.content)}</p>
        ${r.rejectReason ? `<p class="review-reject-reason">驳回原因：${escapeHtml(r.rejectReason)}</p>` : ''}
        <div class="my-review-footer">
          <time class="review-time">${(r.updatedAt || r.createdAt || '').slice(0, 16).replace('T', ' ')}</time>
          <div class="record-actions">
            <button type="button" class="btn btn-outline btn-sm" data-edit-review="${r.id}" data-book-id="${r.bookId}">修改</button>
            <button type="button" class="btn btn-outline btn-sm danger-text" data-delete-review="${r.id}">删除</button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

function bindMyReviewActions(root) {
  root.querySelectorAll('[data-edit-review]').forEach(btn => {
    btn.addEventListener('click', () => openEditReviewModal(btn.dataset.editReview, btn.dataset.bookId));
  });
  root.querySelectorAll('[data-delete-review]').forEach(btn => {
    btn.addEventListener('click', () => deleteMyReview(btn.dataset.deleteReview));
  });
}

async function loadMyReviewsInModal() {
  const bookId = document.getElementById('reviewBookId')?.value;
  const listEl = document.getElementById('myReviewsList');
  if (!listEl || !bookId) return;

  const phone = (document.getElementById('myReviewsPhone')?.value || '').trim()
    || getRecordsPhone()
    || getUser().phone
    || '';

  if (document.getElementById('myReviewsPhone') && phone) {
    document.getElementById('myReviewsPhone').value = phone;
  }

  if (!phone || phone.length !== 11) {
    listEl.innerHTML = '<p class="reviews-empty">请输入手机号后点击查询，查看你在本书下的书评</p>';
    return;
  }

  listEl.innerHTML = '<p class="reviews-loading">加载中…</p>';
  try {
    const reviews = await apiRequest(
      `/api/reviews/mine?phone=${encodeURIComponent(phone)}&book_id=${encodeURIComponent(bookId)}`
    );
    if (!reviews.length) {
      listEl.innerHTML = '<p class="reviews-empty">你还没有为本书写过书评</p>';
      return;
    }
    listEl.innerHTML = renderMyReviewCards(reviews);
    bindMyReviewActions(listEl);
  } catch (err) {
    listEl.innerHTML = `<p class="reviews-empty">${escapeHtml(err.message)}</p>`;
  }
}

async function renderMyRecordsReviews() {
  const list = document.getElementById('myRecordsReviewsList');
  const empty = document.getElementById('emptyMyReviews');
  if (!list || !empty) return;

  const phone = getRecordsPhone();
  if (!phone) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = '请在上方输入手机号查看你的书评';
    return;
  }

  try {
    const reviews = await apiRequest(`/api/reviews/mine?phone=${encodeURIComponent(phone)}`);
    if (!reviews.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      empty.querySelector('p').textContent = '借阅图书后，可在图书卡片「书评」中写下读后感';
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = renderMyReviewCards(reviews, { showBook: true });
    bindMyReviewActions(list);
  } catch (err) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = err.message;
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function reviewEligibilityHint(elig) {
  if (!elig.canReview) {
    return { text: elig.reason || '暂不可发表读后感', warn: true };
  }
  const parts = ['请文明分享读后感，提交后经管理员审核通过才会公开展示。同一本书可多次发表。'];
  if (elig.myReviewCount > 0) {
    parts.push(`你已为本书提交过 ${elig.myReviewCount} 条书评。`);
  }
  if (elig.pendingCount > 0) {
    parts.push(`其中 ${elig.pendingCount} 条正在审核中。`);
  }
  return { text: parts.join(''), warn: false };
}

function setWriteReviewMode(mode) {
  const isEdit = mode === 'edit';
  document.getElementById('writeReviewTag').textContent = isEdit ? 'Edit' : 'Write';
  document.getElementById('writeReviewTitle').textContent = isEdit ? '修改读后感' : '写读后感';
  document.getElementById('writeReviewSubtitle').textContent = isEdit
    ? '修改后将重新进入审核，通过后才会公开展示'
    : '借阅过本书后可提交，管理员审核通过后展示';
  document.getElementById('reviewSubmitBtn').textContent = isEdit ? '保存并重新提交审核' : '提交审核';
  document.getElementById('reviewPhone').readOnly = isEdit;
}

async function openWriteReviewModal(bookId) {
  const book = books.find(b => b.id === bookId) || await apiRequest(`/api/books/${bookId}`).catch(() => null);
  if (!book) {
    showToast('图书不存在', 'error');
    return;
  }

  const user = getUser();
  const phone = document.getElementById('recordsPhone')?.value.trim()
    || document.getElementById('myReviewsPhone')?.value.trim()
    || user.phone
    || '';
  const name = user.name || '';

  setWriteReviewMode('create');
  document.getElementById('writeReviewId').value = '';
  document.getElementById('writeReviewBookId').value = bookId;
  document.getElementById('writeReviewPreview').innerHTML = `
    ${bookCoverImg(book, 'preview-cover-img')}
    <div class="preview-info">
      <h3>${book.title}</h3>
      <p>${book.author} · ${book.category}</p>
    </div>
  `;
  bindCoverFallback(document.getElementById('writeReviewPreview'));

  document.getElementById('reviewName').value = name;
  document.getElementById('reviewPhone').value = phone;
  document.getElementById('reviewContent').value = '';
  setReviewRating(5);

  const hint = document.getElementById('reviewEligibilityHint');
  hint.textContent = '正在检查借阅资格…';
  hint.className = 'form-summary visible';

  closeModal('reviewsModal');
  openModal('writeReviewModal');

  if (!phone || phone.length !== 11) {
    hint.textContent = '请填写借阅时使用的手机号；仅借过本书的读者可发表读后感。';
    return;
  }

  try {
    const elig = await apiRequest(
      `/api/reviews/eligibility?book_id=${encodeURIComponent(bookId)}&phone=${encodeURIComponent(phone)}`
    );
    const tip = reviewEligibilityHint(elig);
    hint.textContent = tip.text;
    hint.className = tip.warn ? 'form-summary visible warn' : 'form-summary visible';
  } catch (err) {
    hint.textContent = err.message;
    hint.classList.add('warn');
  }
}

async function openEditReviewModal(reviewId, bookId) {
  const phone = (document.getElementById('myReviewsPhone')?.value || '').trim()
    || getRecordsPhone()
    || getUser().phone
    || '';
  if (!phone || phone.length !== 11) {
    showToast('请先填写手机号', 'error');
    return;
  }

  try {
    const mine = await apiRequest(
      `/api/reviews/mine?phone=${encodeURIComponent(phone)}${bookId ? `&book_id=${encodeURIComponent(bookId)}` : ''}`
    );
    const review = mine.find(r => r.id === reviewId);
    if (!review) {
      showToast('未找到该书评', 'error');
      return;
    }

    const book = books.find(b => b.id === review.bookId)
      || await apiRequest(`/api/books/${review.bookId}`).catch(() => null);
    if (!book) {
      showToast('图书不存在', 'error');
      return;
    }

    setWriteReviewMode('edit');
    document.getElementById('writeReviewId').value = review.id;
    document.getElementById('writeReviewBookId').value = review.bookId;
    document.getElementById('writeReviewPreview').innerHTML = `
      ${bookCoverImg(book, 'preview-cover-img')}
      <div class="preview-info">
        <h3>${book.title}</h3>
        <p>${book.author} · ${book.category}</p>
      </div>
    `;
    bindCoverFallback(document.getElementById('writeReviewPreview'));

    document.getElementById('reviewName').value = review.name || '';
    document.getElementById('reviewPhone').value = phone;
    document.getElementById('reviewContent').value = review.content || '';
    setReviewRating(review.rating || 5);

    const hint = document.getElementById('reviewEligibilityHint');
    hint.className = 'form-summary visible';
    hint.textContent = review.status === 'rejected' && review.rejectReason
      ? `上次未通过：${review.rejectReason}。修改后将重新提交审核。`
      : '修改后将重新进入审核，通过后才会公开展示。';

    closeModal('reviewsModal');
    openModal('writeReviewModal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteMyReview(reviewId) {
  const phone = (document.getElementById('myReviewsPhone')?.value || '').trim()
    || getRecordsPhone()
    || getUser().phone
    || '';
  if (!phone || phone.length !== 11) {
    showToast('请先填写手机号', 'error');
    return;
  }
  if (!confirm('确认删除这条书评？删除后不可恢复。')) return;

  try {
    await apiRequest(`/api/reviews/${reviewId}`, {
      method: 'DELETE',
      body: JSON.stringify({ phone }),
    });
    showToast('已删除');
    if (document.getElementById('reviewsModal')?.classList.contains('active')) {
      await loadMyReviewsInModal();
      const bookId = document.getElementById('reviewBookId')?.value;
      if (bookId) {
        const data = await apiRequest(`/api/books/${bookId}/reviews`);
        const listEl = document.getElementById('reviewsList');
        const summaryEl = document.getElementById('reviewsSummary');
        summaryEl.textContent = data.count > 0
          ? `平均 ${data.avgRating} 分 · ${data.count} 条公开读后感`
          : '暂无公开读后感，借阅后可写下你的感想';
        listEl.innerHTML = data.reviews.length
          ? data.reviews.map(r => `
              <article class="review-item">
                <div class="review-item-head">
                  <strong>${escapeHtml(r.name)}</strong>
                  <span class="review-stars">${starsHtml(r.rating)}</span>
                </div>
                <p class="review-content">${escapeHtml(r.content)}</p>
                <time class="review-time">${(r.createdAt || '').slice(0, 10)}</time>
              </article>
            `).join('')
          : '<p class="reviews-empty">还没有通过审核的书评</p>';
      }
    }
    await renderMyRecordsReviews();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleReviewSubmit(e) {
  e.preventDefault();
  const bookId = document.getElementById('writeReviewBookId').value;
  const reviewId = document.getElementById('writeReviewId').value.trim();
  const name = document.getElementById('reviewName').value.trim();
  const phone = document.getElementById('reviewPhone').value.trim();
  const rating = Number(document.getElementById('reviewRating').value || 0);
  const content = document.getElementById('reviewContent').value.trim();

  try {
    if (reviewId) {
      await apiRequest(`/api/reviews/${reviewId}`, {
        method: 'PUT',
        body: JSON.stringify({ phone, name, rating, content }),
      });
      showToast('已保存，将重新审核');
    } else {
      await apiRequest('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ bookId, name, phone, rating, content }),
      });
      showToast('已提交，审核通过后将公开展示');
    }
    saveUser({ ...getUser(), name, phone });
    if (document.getElementById('recordsPhone')) {
      document.getElementById('recordsPhone').value = phone;
    }
    if (document.getElementById('myReviewsPhone')) {
      document.getElementById('myReviewsPhone').value = phone;
    }
    closeModal('writeReviewModal');
    await renderMyRecordsReviews();
    if (bookId) await openReviewsModal(bookId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}
