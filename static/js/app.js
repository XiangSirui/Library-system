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



const TIME_SLOTS = [

  '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',

  '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'

];



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

            <button class="btn btn-primary btn-sm" data-borrow="${book.id}" ${avail === 0 ? 'disabled' : ''}>

              ${avail === 0 ? '已借完' : '借阅'}

            </button>

          </div>

        </div>

      </article>

    `;

  }).join('');



  grid.querySelectorAll('[data-borrow]').forEach(btn => {

    btn.addEventListener('click', () => openBorrowModal(btn.dataset.borrow));

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

  bindCoverFallback(list);

}



// ========== Activity Room ==========

async function renderRoomShowcase() {

  const stats = await apiRequest('/api/room/stats');

  const bookedToday = stats.bookedCount;

  const slotsLeft = TIME_SLOTS.length - bookedToday;



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

        <p class="room-booking-notice">📅 仅开放未来 <strong>14 天（两周）</strong>内预约 · 点击按钮查看占用情况</p>

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

  renderRoomTimeSlots();

}



function renderRoomTimeSlots() {

  const date = document.getElementById('roomDate').value;

  const booked = bookedRoomSlots;

  const isToday = date === formatDate(new Date());

  const currentHour = new Date().getHours();

  const duration = parseInt(document.getElementById('roomDuration').value) || 1;



  document.getElementById('roomTimeSlots').innerHTML = TIME_SLOTS.map(slot => {

    const hour = parseInt(slot);

    const past = isToday && hour <= currentHour;

    const startBooked = booked.includes(slot);

    let overlap = false;

    for (let i = 0; i < duration; i++) {

      const checkSlot = `${String(hour + i).padStart(2, '0')}:00`;

      if (booked.includes(checkSlot)) overlap = true;

    }

    const endHour = hour + duration;

    const overClose = endHour > CLOSE_HOUR;

    const disabled = past || startBooked || overlap || overClose;

    let cls = 'time-slot';

    if (disabled) cls += ' disabled';

    if (selectedRoomSlot === slot) cls += ' selected';

    return `<button type="button" class="${cls}" data-slot="${slot}" ${disabled ? 'disabled' : ''}>${slot}</button>`;

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

        date, timeSlot: selectedRoomSlot, duration,

        purpose, name, phone, attendees,

      }),

    });



    saveUser({ ...getUser(), name, phone });

    document.getElementById('recordsPhone').value = phone;



    closeModal('roomModal');

    showSuccess('预约成功', record.code, '请保存预约码，到场时出示', `

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

    const statusClass = b.status === 'cancelled' ? 'cancelled' : roomTab === 'past' ? 'completed' : 'upcoming';

    const statusText = b.status === 'cancelled' ? '已取消' : roomTab === 'past' ? '已完成' : '即将到来';

    const bookingTime = new Date(`${b.date}T${b.timeSlot}`);

    const canCancel = b.status === 'upcoming' && roomTab === 'upcoming' && bookingTime > now;



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

          </div>

        </div>

        <span class="booking-status ${statusClass}">${statusText}</span>

        <div class="record-actions">

          ${canCancel ? `<button class="btn btn-danger btn-sm" data-cancel-room="${b.id}">取消</button>` : ''}

        </div>

      </div>

    `;

  }).join('');



  list.querySelectorAll('[data-cancel-room]').forEach(btn => {

    btn.addEventListener('click', () => cancelRoomBooking(btn.dataset.cancelRoom));

  });

}



// ========== Tabs ==========

function initRecordTabs() {

  document.querySelectorAll('[data-record-tab]').forEach(btn => {

    btn.addEventListener('click', () => {

      document.querySelectorAll('[data-record-tab]').forEach(b => b.classList.remove('active'));

      btn.classList.add('active');

      recordTab = btn.dataset.recordTab;

      document.getElementById('borrowsPanel').classList.toggle('hidden', recordTab !== 'borrows');

      document.getElementById('roomPanel').classList.toggle('hidden', recordTab !== 'room');

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

  document.getElementById('roomForm').addEventListener('submit', handleRoomSubmit);

  document.getElementById('roomDuration').addEventListener('change', () => {

    renderRoomTimeSlots();

    updateRoomSummary();

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


