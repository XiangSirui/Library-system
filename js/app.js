/**
 * 阅享空间 · 社区共享图书馆
 * 图书借阅 + 单活动室预约
 */

const BOOKS = [
  { id: 'b1', title: '活着', author: '余华', category: '文学', isbn: '978-7-5063-4910-6', copies: 3, cover: 'cover-1', coverIsbn: '9787506349106' },
  { id: 'b2', title: '百年孤独', author: '加西亚·马尔克斯', category: '文学', isbn: '978-7-5442-5294-0', copies: 2, cover: 'cover-2', coverIsbn: '9780060883287' },
  { id: 'b3', title: '三体', author: '刘慈欣', category: '科幻', isbn: '978-7-5366-9293-0', copies: 4, cover: 'cover-3', coverIsbn: '9780765354063' },
  { id: 'b4', title: '人类简史', author: '尤瓦尔·赫拉利', category: '历史', isbn: '978-7-5086-4827-1', copies: 2, cover: 'cover-4', coverIsbn: '9780062316097' },
  { id: 'b5', title: '小王子', author: '圣-埃克苏佩里', category: '少儿', isbn: '978-7-0209-3254-0', copies: 5, cover: 'cover-5', coverIsbn: '9780156012195' },
  { id: 'b6', title: '围城', author: '钱钟书', category: '文学', isbn: '978-7-0200-0337-5', copies: 2, cover: 'cover-6', coverIsbn: '9787020003375' },
  { id: 'b7', title: '明朝那些事儿', author: '当年明月', category: '历史', isbn: '978-7-5057-3745-1', copies: 3, cover: 'cover-7', coverIsbn: '9787505717451' },
  { id: 'b8', title: '流浪地球', author: '刘慈欣', category: '科幻', isbn: '978-7-5442-6743-6', copies: 3, cover: 'cover-8', coverIsbn: '9787544267436' },
  { id: 'b9', title: '原则', author: '瑞·达利欧', category: '社科', isbn: '978-7-5086-5528-6', copies: 2, cover: 'cover-9', coverIsbn: '9787508655286' },
  { id: 'b10', title: '艺术的故事', author: '贡布里希', category: '艺术', isbn: '978-7-5388-3999-6', copies: 1, cover: 'cover-10', coverIsbn: '9780714832475' },
  { id: 'b11', title: '夏洛的网', author: 'E·B·怀特', category: '少儿', isbn: '978-7-5327-4567-8', copies: 4, cover: 'cover-11', coverIsbn: '9780064400558' },
  { id: 'b12', title: '平凡的世界', author: '路遥', category: '文学', isbn: '978-7-5063-6038-5', copies: 2, cover: 'cover-12', coverIsbn: '9787506360385' },
  { id: 'b13', title: '时间简史', author: '史蒂芬·霍金', category: '社科', isbn: '978-7-5357-2576-4', copies: 2, cover: 'cover-13', coverIsbn: '9780553380163' },
  { id: 'b14', title: '长安的荔枝', author: '马伯庸', category: '历史', isbn: '978-7-5594-4478-5', copies: 3, cover: 'cover-14', coverIsbn: '9787559444785' },
  { id: 'b15', title: '海底两万里', author: '儒勒·凡尔纳', category: '科幻', isbn: '978-7-5339-2345-6', copies: 2, cover: 'cover-15', coverIsbn: '9780141027159' },
  { id: 'b16', title: '设计中的设计', author: '原研哉', category: '艺术', isbn: '978-7-5086-1234-5', copies: 1, cover: 'cover-16', coverIsbn: '9787111211128' }
];

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
const MAX_BORROWS = 3;
const STORAGE_BORROWS = 'yuexiang_borrows';
const STORAGE_ROOM = 'yuexiang_room_bookings';
const STORAGE_USER = 'yuexiang_user';

let bookFilter = 'all';
let bookSearch = '';
let recordTab = 'borrows';
let borrowTab = 'active';
let roomTab = 'upcoming';
let selectedRoomSlot = null;
let selectedBook = null;

function getBookCoverFallback(book) {
  return `images/covers/${book.id}.svg`;
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
  return BOOKS.find(b => b.id === bookId);
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initBookFilters();
  initRecordTabs();
  initSubTabs();
  initModals();
  initForms();

  document.getElementById('heroBookCount').textContent = BOOKS.length + ' 本';
  renderBooks();
  renderRoomShowcase();
  renderBorrows();
  renderRoomBookings();
});

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

// ========== Storage ==========
function getBorrows() {
  try { return JSON.parse(localStorage.getItem(STORAGE_BORROWS)) || []; } catch { return []; }
}
function saveBorrows(list) { localStorage.setItem(STORAGE_BORROWS, JSON.stringify(list)); }

function getRoomBookings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_ROOM)) || []; } catch { return []; }
}
function saveRoomBookings(list) { localStorage.setItem(STORAGE_ROOM, JSON.stringify(list)); }

function getUser() {
  try { return JSON.parse(localStorage.getItem(STORAGE_USER)) || {}; } catch { return {}; }
}
function saveUser(u) { localStorage.setItem(STORAGE_USER, JSON.stringify(u)); }

function generateCode(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = prefix;
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ========== Book availability ==========
function getActiveBorrowsForBook(bookId) {
  return getBorrows().filter(b => b.bookId === bookId && b.status === 'borrowed');
}

function getAvailableCopies(book) {
  const borrowed = getActiveBorrowsForBook(book.id).length;
  return Math.max(0, book.copies - borrowed);
}

function getUserActiveBorrows(phone) {
  return getBorrows().filter(b => b.phone === phone && b.status === 'borrowed');
}

// ========== Render Books ==========
function renderBooks() {
  const grid = document.getElementById('booksGrid');
  const empty = document.getElementById('emptyBooks');

  let list = BOOKS.filter(b => {
    const matchCat = bookFilter === 'all' || b.category === bookFilter;
    const q = bookSearch.toLowerCase();
    const matchSearch = !q || b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  if (list.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  grid.innerHTML = list.map((book, i) => {
    const avail = getAvailableCopies(book);
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
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-book-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      bookFilter = btn.dataset.bookFilter;
      renderBooks();
    });
  });

  document.getElementById('bookSearch').addEventListener('input', e => {
    bookSearch = e.target.value.trim();
    renderBooks();
  });
}

// ========== Borrow Modal ==========
function openBorrowModal(bookId) {
  selectedBook = BOOKS.find(b => b.id === bookId);
  if (!selectedBook || getAvailableCopies(selectedBook) === 0) return;

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

function handleBorrowSubmit(e) {
  e.preventDefault();
  const bookId = document.getElementById('borrowBookId').value;
  const book = BOOKS.find(b => b.id === bookId);
  const name = document.getElementById('borrowName').value.trim();
  const phone = document.getElementById('borrowPhone').value.trim();
  const card = document.getElementById('borrowCard').value.trim();

  if (getAvailableCopies(book) === 0) {
    showToast('该图书已借完', 'error');
    return;
  }
  if (getUserActiveBorrows(phone).length >= MAX_BORROWS) {
    showToast(`每人最多同时借阅 ${MAX_BORROWS} 本`, 'error');
    return;
  }

  const borrowDate = new Date();
  const dueDate = addDays(borrowDate, BORROW_DAYS);
  const record = {
    id: Date.now().toString(),
    code: generateCode('JY'),
    bookId: book.id,
    bookTitle: book.title,
    author: book.author,
    name, phone, card,
    borrowDate: formatDate(borrowDate),
    dueDate: formatDate(dueDate),
    renewed: false,
    status: 'borrowed',
    createdAt: borrowDate.toISOString()
  };

  const list = getBorrows();
  list.push(record);
  saveBorrows(list);
  saveUser({ name, phone, card });

  closeModal('borrowModal');
  showSuccess('借阅成功', record.code, '请保存借阅码，到馆在前台取书', `
    <div><strong>图书：</strong>${book.title}</div>
    <div><strong>作者：</strong>${book.author}</div>
    <div><strong>借阅人：</strong>${name}</div>
    <div><strong>应还日期：</strong>${formatDateDisplay(record.dueDate)}</div>
  `);
  renderBooks();
  renderBorrows();
}

function returnBook(id) {
  if (!confirm('确认归还此书？')) return;
  const list = getBorrows().map(b => b.id === id ? { ...b, status: 'returned', returnDate: formatDate(new Date()) } : b);
  saveBorrows(list);
  showToast('归还成功');
  renderBooks();
  renderBorrows();
}

function renewBook(id) {
  const list = getBorrows();
  const record = list.find(b => b.id === id);
  if (!record || record.renewed) {
    showToast('该图书已续借过或不存在', 'error');
    return;
  }
  const newDue = addDays(new Date(record.dueDate + 'T00:00:00'), BORROW_DAYS);
  const updated = list.map(b => b.id === id ? { ...b, dueDate: formatDate(newDue), renewed: true } : b);
  saveBorrows(updated);
  showToast('续借成功，期限延长 30 天');
  renderBorrows();
}

// ========== Render Borrows ==========
function renderBorrows() {
  const list = document.getElementById('borrowsList');
  const empty = document.getElementById('emptyBorrows');
  const today = formatDate(new Date());

  let records = getBorrows().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  if (borrowTab === 'active') {
    records = records.filter(b => b.status === 'borrowed');
  } else {
    records = records.filter(b => b.status !== 'borrowed');
  }

  if (records.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
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
function renderRoomShowcase() {
  const today = formatDate(new Date());
  const bookedToday = getRoomBookings().filter(b => b.date === today && b.status === 'upcoming').length;
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
          <button class="btn btn-primary" id="openRoomModal">预约活动室</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('openRoomModal').addEventListener('click', openRoomModal);
}

function openRoomModal() {
  selectedRoomSlot = null;
  const user = getUser();
  document.getElementById('roomName').value = user.name || '';
  document.getElementById('roomPhone').value = user.phone || '';
  document.getElementById('roomPurpose').value = '';
  document.getElementById('roomAttendees').value = 10;

  const today = new Date();
  const dateInput = document.getElementById('roomDate');
  dateInput.min = formatDate(today);
  dateInput.max = formatDate(addDays(today, 14));
  dateInput.value = formatDate(today);

  renderRoomTimeSlots();
  updateRoomSummary();
  openModal('roomModal');
}

function getBookedRoomSlots(date) {
  return getRoomBookings()
    .filter(b => b.date === date && b.status === 'upcoming')
    .map(b => b.timeSlot);
}

function renderRoomTimeSlots() {
  const date = document.getElementById('roomDate').value;
  const booked = getBookedRoomSlots(date);
  const isToday = date === formatDate(new Date());
  const currentHour = new Date().getHours();

  document.getElementById('roomTimeSlots').innerHTML = TIME_SLOTS.map(slot => {
    const hour = parseInt(slot);
    const disabled = (isToday && hour <= currentHour) || booked.includes(slot);
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

function handleRoomSubmit(e) {
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
  if (getBookedRoomSlots(date).includes(selectedRoomSlot)) {
    showToast('该时段已被预约', 'error');
    renderRoomTimeSlots();
    return;
  }

  const todayCount = getRoomBookings().filter(b => b.phone === phone && b.date === date && b.status === 'upcoming').length;
  if (todayCount >= 1) { showToast('每人每日最多预约活动室 1 次', 'error'); return; }

  const record = {
    id: Date.now().toString(),
    code: generateCode('HD'),
    date, timeSlot: selectedRoomSlot, duration,
    purpose, name, phone, attendees,
    status: 'upcoming',
    createdAt: new Date().toISOString()
  };

  const list = getRoomBookings();
  list.push(record);
  saveRoomBookings(list);
  saveUser({ ...getUser(), name, phone });

  closeModal('roomModal');
  showSuccess('预约成功', record.code, '请保存预约码，到场时出示', `
    <div><strong>空间：</strong>${ACTIVITY_ROOM.name}</div>
    <div><strong>日期：</strong>${formatDateDisplay(date)}</div>
    <div><strong>时间：</strong>${selectedRoomSlot} – ${String(endHour).padStart(2,'0')}:00</div>
    <div><strong>用途：</strong>${purpose}</div>
    <div><strong>人数：</strong>${attendees} 人</div>
  `);
  renderRoomShowcase();
  renderRoomBookings();
}

function cancelRoomBooking(id) {
  const record = getRoomBookings().find(b => b.id === id);
  if (!record) return;
  const bookingTime = new Date(`${record.date}T${record.timeSlot}`);
  if ((bookingTime - new Date()) / 3600000 < 1) {
    showToast('开始前 1 小时内不可取消', 'error');
    return;
  }
  if (!confirm('确定取消此预约？')) return;
  saveRoomBookings(getRoomBookings().map(b => b.id === id ? { ...b, status: 'cancelled' } : b));
  showToast('预约已取消');
  renderRoomShowcase();
  renderRoomBookings();
}

function renderRoomBookings() {
  const list = document.getElementById('roomBookingsList');
  const empty = document.getElementById('emptyRoomBookings');
  const now = new Date();

  let records = getRoomBookings().sort((a, b) => {
    const da = new Date(`${a.date}T${a.timeSlot}`);
    const db = new Date(`${b.date}T${b.timeSlot}`);
    return db - da;
  });

  records = records.filter(b => {
    const end = new Date(`${b.date}T${b.timeSlot}`);
    end.setHours(end.getHours() + b.duration);
    if (roomTab === 'upcoming') return b.status === 'upcoming' && end > now;
    return b.status !== 'upcoming' || end <= now;
  });

  if (records.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = records.map(b => {
    const endHour = parseInt(b.timeSlot) + b.duration;
    const statusClass = b.status === 'cancelled' ? 'cancelled' : roomTab === 'past' ? 'completed' : 'upcoming';
    const statusText = b.status === 'cancelled' ? '已取消' : roomTab === 'past' ? '已完成' : '即将到来';
    const canCancel = b.status === 'upcoming' && roomTab === 'upcoming' && new Date(`${b.date}T${b.timeSlot}`) > now;

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
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-borrow-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      borrowTab = btn.dataset.borrowTab;
      renderBorrows();
    });
  });
  document.querySelectorAll('[data-room-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-room-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      roomTab = btn.dataset.roomTab;
      renderRoomBookings();
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
  document.getElementById('roomDate').addEventListener('change', () => { selectedRoomSlot = null; renderRoomTimeSlots(); updateRoomSummary(); });
  document.getElementById('roomDuration').addEventListener('change', updateRoomSummary);
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
