"""阅享空间 · SQLite 数据库层"""

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
import random
import string
from werkzeug.security import generate_password_hash, check_password_hash

DB_PATH = os.path.join(os.path.dirname(__file__), 'library.db')

BORROW_DAYS = 30
MAX_BORROWS = 3
CLOSE_HOUR = 20
BOOKING_DAYS = 14

# 可选时段池（管理员从此列表中勾选开放）
ALL_TIME_SLOTS = [
    '08:00', '09:00', '10:00', '11:00', '12:00', '13:00',
    '14:00', '15:00', '16:00', '17:00', '18:00', '19:00',
]
# 兼容旧代码引用
TIME_SLOTS = ALL_TIME_SLOTS

SEED_BOOKS = [
    {'id': 'b1', 'title': '活着', 'author': '余华', 'category': '文学', 'isbn': '978-7-5063-4910-6', 'copies': 3, 'cover': 'cover-1', 'cover_isbn': '9787506349106'},
    {'id': 'b2', 'title': '百年孤独', 'author': '加西亚·马尔克斯', 'category': '文学', 'isbn': '978-7-5442-5294-0', 'copies': 2, 'cover': 'cover-2', 'cover_isbn': '9780060883287'},
    {'id': 'b3', 'title': '三体', 'author': '刘慈欣', 'category': '科幻', 'isbn': '978-7-5366-9293-0', 'copies': 4, 'cover': 'cover-3', 'cover_isbn': '9780765354063'},
    {'id': 'b4', 'title': '人类简史', 'author': '尤瓦尔·赫拉利', 'category': '历史', 'isbn': '978-7-5086-4827-1', 'copies': 2, 'cover': 'cover-4', 'cover_isbn': '9780062316097'},
    {'id': 'b5', 'title': '小王子', 'author': '圣-埃克苏佩里', 'category': '少儿', 'isbn': '978-7-0209-3254-0', 'copies': 5, 'cover': 'cover-5', 'cover_isbn': '9780156012195'},
    {'id': 'b6', 'title': '围城', 'author': '钱钟书', 'category': '文学', 'isbn': '978-7-0200-0337-5', 'copies': 2, 'cover': 'cover-6', 'cover_isbn': '9787020003375'},
    {'id': 'b7', 'title': '明朝那些事儿', 'author': '当年明月', 'category': '历史', 'isbn': '978-7-5057-3745-1', 'copies': 3, 'cover': 'cover-7', 'cover_isbn': '9787505717451'},
    {'id': 'b8', 'title': '流浪地球', 'author': '刘慈欣', 'category': '科幻', 'isbn': '978-7-5442-6743-6', 'copies': 3, 'cover': 'cover-8', 'cover_isbn': '9787544267436'},
    {'id': 'b9', 'title': '原则', 'author': '瑞·达利欧', 'category': '社科', 'isbn': '978-7-5086-5528-6', 'copies': 2, 'cover': 'cover-9', 'cover_isbn': '9787508655286'},
    {'id': 'b10', 'title': '艺术的故事', 'author': '贡布里希', 'category': '艺术', 'isbn': '978-7-5388-3999-6', 'copies': 1, 'cover': 'cover-10', 'cover_isbn': '9780714832475'},
    {'id': 'b11', 'title': '夏洛的网', 'author': 'E·B·怀特', 'category': '少儿', 'isbn': '978-7-5327-4567-8', 'copies': 4, 'cover': 'cover-11', 'cover_isbn': '9780064400558'},
    {'id': 'b12', 'title': '平凡的世界', 'author': '路遥', 'category': '文学', 'isbn': '978-7-5063-6038-5', 'copies': 2, 'cover': 'cover-12', 'cover_isbn': '9787506360385'},
    {'id': 'b13', 'title': '时间简史', 'author': '史蒂芬·霍金', 'category': '社科', 'isbn': '978-7-5357-2576-4', 'copies': 2, 'cover': 'cover-13', 'cover_isbn': '9780553380163'},
    {'id': 'b14', 'title': '长安的荔枝', 'author': '马伯庸', 'category': '历史', 'isbn': '978-7-5594-4478-5', 'copies': 3, 'cover': 'cover-14', 'cover_isbn': '9787559444785'},
    {'id': 'b15', 'title': '海底两万里', 'author': '儒勒·凡尔纳', 'category': '科幻', 'isbn': '978-7-5339-2345-6', 'copies': 2, 'cover': 'cover-15', 'cover_isbn': '9780141027159'},
    {'id': 'b16', 'title': '设计中的设计', 'author': '原研哉', 'category': '艺术', 'isbn': '978-7-5086-1234-5', 'copies': 1, 'cover': 'cover-16', 'cover_isbn': '9787111211128'},
]


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                category TEXT NOT NULL,
                isbn TEXT,
                copies INTEGER NOT NULL DEFAULT 1,
                cover TEXT,
                cover_isbn TEXT
            );

            CREATE TABLE IF NOT EXISTS borrows (
                id TEXT PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                book_id TEXT NOT NULL REFERENCES books(id),
                book_title TEXT NOT NULL,
                author TEXT NOT NULL,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                card TEXT,
                borrow_date TEXT NOT NULL,
                due_date TEXT NOT NULL,
                return_date TEXT,
                renewed INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'borrowed',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS room_bookings (
                id TEXT PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                date TEXT NOT NULL,
                time_slot TEXT NOT NULL,
                duration INTEGER NOT NULL,
                purpose TEXT NOT NULL,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                attendees INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'upcoming',
                volunteer_note TEXT,
                volunteer_image TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                phone TEXT PRIMARY KEY,
                name TEXT,
                card TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_borrows_book_status ON borrows(book_id, status);
            CREATE INDEX IF NOT EXISTS idx_borrows_phone ON borrows(phone);
            CREATE INDEX IF NOT EXISTS idx_room_date_status ON room_bookings(date, status);
            CREATE INDEX IF NOT EXISTS idx_room_phone ON room_bookings(phone);

            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS room_slot_settings (
                time_slot TEXT PRIMARY KEY,
                is_open INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS room_day_slots (
                date TEXT NOT NULL,
                time_slot TEXT NOT NULL,
                is_open INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (date, time_slot)
            );

            CREATE INDEX IF NOT EXISTS idx_room_day_slots_date ON room_day_slots(date);
        ''')

        admin_count = conn.execute('SELECT COUNT(*) FROM admins').fetchone()[0]
        if admin_count == 0:
            conn.execute(
                'INSERT INTO admins (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
                ('admin', generate_password_hash('admin123'), '管理员', datetime.now().isoformat())
            )

        # 默认时段模板：全部开放；已有库仅补全缺失时段
        for slot in ALL_TIME_SLOTS:
            conn.execute(
                'INSERT OR IGNORE INTO room_slot_settings (time_slot, is_open) VALUES (?, 1)',
                (slot,)
            )

        # 兼容旧库：补充志愿服务字段
        booking_cols = {
            r['name'] for r in conn.execute('PRAGMA table_info(room_bookings)').fetchall()
        }
        if 'volunteer_note' not in booking_cols:
            conn.execute('ALTER TABLE room_bookings ADD COLUMN volunteer_note TEXT')
        if 'volunteer_image' not in booking_cols:
            conn.execute('ALTER TABLE room_bookings ADD COLUMN volunteer_image TEXT')
        if 'checkout_at' not in booking_cols:
            conn.execute('ALTER TABLE room_bookings ADD COLUMN checkout_at TEXT')

        count = conn.execute('SELECT COUNT(*) FROM books').fetchone()[0]
        if count == 0:
            for book in SEED_BOOKS:
                conn.execute(
                    '''INSERT INTO books (id, title, author, category, isbn, copies, cover, cover_isbn)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                    (book['id'], book['title'], book['author'], book['category'],
                     book['isbn'], book['copies'], book['cover'], book['cover_isbn'])
                )


def generate_code(prefix):
    chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return prefix + ''.join(random.choice(chars) for _ in range(6))


def format_date(d):
    if isinstance(d, str):
        return d
    return d.strftime('%Y-%m-%d')


def row_to_book(row, borrowed_count=0):
    available = max(0, row['copies'] - borrowed_count)
    return {
        'id': row['id'],
        'title': row['title'],
        'author': row['author'],
        'category': row['category'],
        'isbn': row['isbn'],
        'copies': row['copies'],
        'cover': row['cover'],
        'coverIsbn': row['cover_isbn'],
        'borrowed': borrowed_count,
        'available': available,
    }


def list_books(category='all', search=''):
    with get_db() as conn:
        query = '''
            SELECT b.*,
                   COALESCE(active.cnt, 0) AS borrowed_count
            FROM books b
            LEFT JOIN (
                SELECT book_id, COUNT(*) AS cnt
                FROM borrows WHERE status = 'borrowed'
                GROUP BY book_id
            ) active ON active.book_id = b.id
            WHERE 1=1
        '''
        params = []
        if category and category != 'all':
            query += ' AND b.category = ?'
            params.append(category)
        if search:
            query += ' AND (b.title LIKE ? OR b.author LIKE ?)'
            like = f'%{search}%'
            params.extend([like, like])
        query += ' ORDER BY b.id'
        rows = conn.execute(query, params).fetchall()
        return [row_to_book(r, r['borrowed_count']) for r in rows]


def get_book(book_id):
    with get_db() as conn:
        row = conn.execute('''
            SELECT b.*, COALESCE(active.cnt, 0) AS borrowed_count
            FROM books b
            LEFT JOIN (
                SELECT book_id, COUNT(*) AS cnt
                FROM borrows WHERE status = 'borrowed' AND book_id = ?
                GROUP BY book_id
            ) active ON active.book_id = b.id
            WHERE b.id = ?
        ''', (book_id, book_id)).fetchone()
        if not row:
            return None
        return row_to_book(row, row['borrowed_count'])


def row_to_borrow(row):
    return {
        'id': row['id'],
        'code': row['code'],
        'bookId': row['book_id'],
        'bookTitle': row['book_title'],
        'author': row['author'],
        'name': row['name'],
        'phone': row['phone'],
        'card': row['card'] or '',
        'borrowDate': row['borrow_date'],
        'dueDate': row['due_date'],
        'returnDate': row['return_date'],
        'renewed': bool(row['renewed']),
        'status': row['status'],
        'createdAt': row['created_at'],
    }


def list_borrows(phone='', tab='active'):
    with get_db() as conn:
        query = 'SELECT * FROM borrows WHERE 1=1'
        params = []
        if phone:
            query += ' AND phone = ?'
            params.append(phone)
        if tab == 'active':
            query += " AND status = 'borrowed'"
        else:
            query += " AND status != 'borrowed'"
        query += ' ORDER BY created_at DESC'
        rows = conn.execute(query, params).fetchall()
        return [row_to_borrow(r) for r in rows]


def create_borrow(book_id, name, phone, card=''):
    with get_db() as conn:
        book = conn.execute('SELECT * FROM books WHERE id = ?', (book_id,)).fetchone()
        if not book:
            return None, '图书不存在'

        borrowed = conn.execute(
            "SELECT COUNT(*) FROM borrows WHERE book_id = ? AND status = 'borrowed'",
            (book_id,)
        ).fetchone()[0]
        if borrowed >= book['copies']:
            return None, '该图书已借完'

        active_user = conn.execute(
            "SELECT COUNT(*) FROM borrows WHERE phone = ? AND status = 'borrowed'",
            (phone,)
        ).fetchone()[0]
        if active_user >= MAX_BORROWS:
            return None, f'每人最多同时借阅 {MAX_BORROWS} 本'

        now = datetime.now()
        borrow_date = format_date(now)
        due_date = format_date(now + timedelta(days=BORROW_DAYS))
        record_id = str(int(now.timestamp() * 1000))
        code = generate_code('JY')

        conn.execute(
            '''INSERT INTO borrows
               (id, code, book_id, book_title, author, name, phone, card,
                borrow_date, due_date, renewed, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'borrowed', ?)''',
            (record_id, code, book_id, book['title'], book['author'],
             name, phone, card or None, borrow_date, due_date, now.isoformat())
        )

        upsert_user(conn, phone, name, card)
        row = conn.execute('SELECT * FROM borrows WHERE id = ?', (record_id,)).fetchone()
        return row_to_borrow(row), None


def return_borrow(borrow_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM borrows WHERE id = ?', (borrow_id,)).fetchone()
        if not row:
            return None, '借阅记录不存在'
        if row['status'] != 'borrowed':
            return None, '该图书已归还'
        return_date = format_date(datetime.now())
        conn.execute(
            "UPDATE borrows SET status = 'returned', return_date = ? WHERE id = ?",
            (return_date, borrow_id)
        )
        updated = conn.execute('SELECT * FROM borrows WHERE id = ?', (borrow_id,)).fetchone()
        return row_to_borrow(updated), None


def renew_borrow(borrow_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM borrows WHERE id = ?', (borrow_id,)).fetchone()
        if not row:
            return None, '借阅记录不存在'
        if row['status'] != 'borrowed':
            return None, '该图书已归还'
        if row['renewed']:
            return None, '该图书已续借过'
        due = datetime.strptime(row['due_date'], '%Y-%m-%d') + timedelta(days=BORROW_DAYS)
        conn.execute(
            'UPDATE borrows SET due_date = ?, renewed = 1 WHERE id = ?',
            (format_date(due), borrow_id)
        )
        updated = conn.execute('SELECT * FROM borrows WHERE id = ?', (borrow_id,)).fetchone()
        return row_to_borrow(updated), None


def row_to_room_booking(row):
    keys = row.keys()
    return {
        'id': row['id'],
        'code': row['code'],
        'date': row['date'],
        'timeSlot': row['time_slot'],
        'duration': row['duration'],
        'purpose': row['purpose'],
        'name': row['name'],
        'phone': row['phone'],
        'attendees': row['attendees'],
        'status': row['status'],
        'volunteerNote': row['volunteer_note'] if 'volunteer_note' in keys else '',
        'volunteerImage': row['volunteer_image'] if 'volunteer_image' in keys else '',
        'checkoutAt': row['checkout_at'] if 'checkout_at' in keys else '',
        'createdAt': row['created_at'],
    }


def _default_open_slots_from_conn(conn):
    rows = conn.execute(
        'SELECT time_slot FROM room_slot_settings WHERE is_open = 1 ORDER BY time_slot'
    ).fetchall()
    slots = [r['time_slot'] for r in rows]
    return slots if slots else list(ALL_TIME_SLOTS)


def _normalize_open_slots(open_slots):
    if not isinstance(open_slots, list):
        return None, '参数格式错误'
    selected = []
    for s in open_slots:
        slot = str(s).strip()
        if slot in ALL_TIME_SLOTS and slot not in selected:
            selected.append(slot)
    if not selected:
        return None, '请至少开放一个时段'
    return selected, None


def get_open_time_slots(date=None):
    """返回某日开放时段；未单独配置时用默认模板"""
    with get_db() as conn:
        if date:
            rows = conn.execute(
                'SELECT time_slot, is_open FROM room_day_slots WHERE date = ?',
                (date,)
            ).fetchall()
            if rows:
                open_set = {r['time_slot'] for r in rows if r['is_open']}
                return [s for s in ALL_TIME_SLOTS if s in open_set]
        return _default_open_slots_from_conn(conn)


def get_default_slot_settings():
    """默认时段模板（未单独配置的日期使用）"""
    with get_db() as conn:
        by_slot = {
            r['time_slot']: bool(r['is_open'])
            for r in conn.execute('SELECT time_slot, is_open FROM room_slot_settings').fetchall()
        }
    return {
        'allSlots': list(ALL_TIME_SLOTS),
        'openSlots': [s for s in ALL_TIME_SLOTS if by_slot.get(s, True)],
        'slots': [{'time': s, 'isOpen': by_slot.get(s, True)} for s in ALL_TIME_SLOTS],
    }


def set_default_open_slots(open_slots):
    selected, err = _normalize_open_slots(open_slots)
    if err:
        return None, err
    with get_db() as conn:
        for slot in ALL_TIME_SLOTS:
            conn.execute(
                '''INSERT INTO room_slot_settings (time_slot, is_open) VALUES (?, ?)
                   ON CONFLICT(time_slot) DO UPDATE SET is_open = excluded.is_open''',
                (slot, 1 if slot in selected else 0)
            )
    return get_default_slot_settings(), None


def get_day_slot_settings(date):
    """管理员：某日时段开放状态"""
    if not date:
        return None, '缺少日期'
    open_slots = get_open_time_slots(date)
    open_set = set(open_slots)
    with get_db() as conn:
        customized = conn.execute(
            'SELECT COUNT(*) FROM room_day_slots WHERE date = ?', (date,)
        ).fetchone()[0] > 0
    return {
        'date': date,
        'customized': customized,
        'allSlots': list(ALL_TIME_SLOTS),
        'openSlots': open_slots,
        'slots': [{'time': s, 'isOpen': s in open_set} for s in ALL_TIME_SLOTS],
    }, None


def set_day_open_slots(date, open_slots, apply_to_range=False):
    """管理员：设置某日开放时段；可选同步到未来可预约范围内所有日期"""
    if not date:
        return None, '缺少日期'
    selected, err = _normalize_open_slots(open_slots)
    if err:
        return None, err

    dates = [date]
    if apply_to_range:
        today = datetime.now()
        dates = [format_date(today + timedelta(days=i)) for i in range(BOOKING_DAYS + 1)]

    with get_db() as conn:
        for d in dates:
            conn.execute('DELETE FROM room_day_slots WHERE date = ?', (d,))
            for slot in ALL_TIME_SLOTS:
                conn.execute(
                    'INSERT INTO room_day_slots (date, time_slot, is_open) VALUES (?, ?, ?)',
                    (d, slot, 1 if slot in selected else 0)
                )
    return get_day_slot_settings(date)[0], None


def get_range_slot_settings(days=BOOKING_DAYS):
    """管理员：未来 N 天每日开放概况"""
    now = datetime.now()
    weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    result = []
    with get_db() as conn:
        for offset in range(days + 1):
            day = now + timedelta(days=offset)
            date_str = format_date(day)
            customized = conn.execute(
                'SELECT COUNT(*) FROM room_day_slots WHERE date = ?', (date_str,)
            ).fetchone()[0] > 0
            open_slots = get_open_time_slots(date_str)
            result.append({
                'date': date_str,
                'weekday': weekdays[day.weekday()],
                'displayDay': day.day,
                'displayMonth': day.month,
                'isToday': offset == 0,
                'customized': customized,
                'openSlots': open_slots,
                'openCount': len(open_slots),
            })
    return {
        'allSlots': list(ALL_TIME_SLOTS),
        'days': result,
    }


# 兼容旧命名
def get_slot_settings():
    return get_default_slot_settings()


def set_open_time_slots(open_slots):
    return set_default_open_slots(open_slots)


def get_booked_room_slots(date):
    return sorted(_occupied_slots_for_date(date))


def _slot_hour(time_slot):
    return int(time_slot.split(':')[0])


def _occupied_slots_from_rows(rows, open_slots=None):
    open_set = set(open_slots if open_slots is not None else ALL_TIME_SLOTS)
    occupied = set()
    for row in rows:
        start = _slot_hour(row['time_slot'])
        duration = row['duration']
        for i in range(duration):
            slot = f'{start + i:02d}:00'
            if slot in open_set or slot in ALL_TIME_SLOTS:
                occupied.add(slot)
    return occupied


def _occupied_slots_for_date(date):
    with get_db() as conn:
        return _occupied_slots_from_conn(conn, date)


def _occupied_slots_from_conn(conn, date):
    rows = conn.execute(
        "SELECT time_slot, duration FROM room_bookings WHERE date = ? AND status = 'upcoming'",
        (date,)
    ).fetchall()
    return _occupied_slots_from_rows(rows)


def _slot_statuses_for_date(date_str, occupied, open_slots, now=None, include_closed=False):
    now = now or datetime.now()
    today = format_date(now)
    current_hour = now.hour if date_str == today else -1
    open_set = set(open_slots)
    source = ALL_TIME_SLOTS if include_closed else open_slots
    statuses = []
    for slot in source:
        hour = _slot_hour(slot)
        if slot not in open_set:
            statuses.append({'time': slot, 'status': 'closed'})
        elif date_str == today and hour <= current_hour:
            statuses.append({'time': slot, 'status': 'past'})
        elif slot in occupied:
            statuses.append({'time': slot, 'status': 'booked'})
        else:
            statuses.append({'time': slot, 'status': 'free'})
    return statuses


def get_room_calendar(days=BOOKING_DAYS, include_details=False, include_closed=False):
    now = datetime.now()
    start_date = format_date(now)
    end_date = format_date(now + timedelta(days=days))
    weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    display_slots = list(ALL_TIME_SLOTS) if include_closed else None

    with get_db() as conn:
        rows = conn.execute(
            '''SELECT * FROM room_bookings
               WHERE date >= ? AND date <= ? AND status = 'upcoming'
               ORDER BY date, time_slot''',
            (start_date, end_date)
        ).fetchall()

    by_date = {}
    for row in rows:
        by_date.setdefault(row['date'], []).append(row)

    calendar_days = []
    union_open = set()
    for offset in range(days + 1):
        day = now + timedelta(days=offset)
        date_str = format_date(day)
        day_open = get_open_time_slots(date_str)
        union_open.update(day_open)
        day_rows = by_date.get(date_str, [])
        occupied = _occupied_slots_from_rows(day_rows)
        slots = _slot_statuses_for_date(date_str, occupied, day_open, now, include_closed=include_closed)
        free_count = sum(1 for s in slots if s['status'] == 'free')
        bookable_count = sum(1 for s in slots if s['status'] in ('free', 'booked', 'past'))

        day_data = {
            'date': date_str,
            'weekday': weekdays[day.weekday()],
            'displayDay': day.day,
            'displayMonth': day.month,
            'freeSlots': free_count,
            'totalSlots': bookable_count if bookable_count else len(day_open),
            'isToday': date_str == start_date,
            'isFull': free_count == 0,
            'openSlots': day_open,
            'slots': slots,
        }
        if include_details:
            day_data['bookings'] = [row_to_room_booking(r) for r in day_rows]
        calendar_days.append(day_data)

    if display_slots is None:
        display_slots = [s for s in ALL_TIME_SLOTS if s in union_open] or list(ALL_TIME_SLOTS)

    return {
        'startDate': start_date,
        'endDate': end_date,
        'bookingDays': days,
        'timeSlots': display_slots,
        'allSlots': list(ALL_TIME_SLOTS),
        'days': calendar_days,
    }


def list_room_bookings(phone='', tab='upcoming'):
    with get_db() as conn:
        query = "SELECT * FROM room_bookings WHERE 1=1"
        params = []
        if phone:
            query += ' AND phone = ?'
            params.append(phone)
        rows = conn.execute(query, params).fetchall()
        now = datetime.now()
        results = []
        for row in rows:
            end = datetime.strptime(f"{row['date']}T{row['time_slot']}", '%Y-%m-%dT%H:%M')
            end = end.replace(hour=end.hour + row['duration'])
            record = row_to_room_booking(row)
            is_past = row['status'] != 'upcoming' or end <= now
            if tab == 'upcoming':
                if row['status'] == 'upcoming' and end > now:
                    results.append(record)
            else:
                if row['status'] != 'upcoming' or end <= now:
                    results.append(record)
        results.sort(
            key=lambda r: datetime.strptime(f"{r['date']}T{r['timeSlot']}", '%Y-%m-%dT%H:%M'),
            reverse=True
        )
        return results


def create_room_booking(date, time_slot, duration, purpose, name, phone, attendees):
    open_slots = set(get_open_time_slots(date))
    if time_slot not in open_slots:
        return None, '该时段未开放预约'

    needed = []
    for i in range(duration):
        slot = f'{_slot_hour(time_slot) + i:02d}:00'
        needed.append(slot)
        if slot not in open_slots:
            return None, '所选时长超出开放时段，请调整'

    end_hour = _slot_hour(time_slot) + duration
    if end_hour > CLOSE_HOUR:
        return None, '超出闭馆时间'

    with get_db() as conn:
        occupied = _occupied_slots_from_conn(conn, date)
        for slot in needed:
            if slot in occupied:
                return None, '该时段已被预约'

        today_count = conn.execute(
            "SELECT COUNT(*) FROM room_bookings WHERE phone = ? AND date = ? AND status = 'upcoming'",
            (phone, date)
        ).fetchone()[0]
        if today_count >= 1:
            return None, '每人每日最多预约活动室 1 次'

        now = datetime.now()
        record_id = str(int(now.timestamp() * 1000))
        code = generate_code('HD')

        conn.execute(
            '''INSERT INTO room_bookings
               (id, code, date, time_slot, duration, purpose, name, phone, attendees,
                status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)''',
            (record_id, code, date, time_slot, duration, purpose, name, phone, attendees,
             now.isoformat())
        )
        upsert_user(conn, phone, name, None)
        row = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (record_id,)).fetchone()
        return row_to_room_booking(row), None


def checkout_room_booking(booking_id, volunteer_note='', volunteer_image='', phone=''):
    """签退：提交志愿服务照片与说明，状态改为 checked_out"""
    note = (volunteer_note or '').strip()
    image = (volunteer_image or '').strip()
    if not note:
        return None, '请填写社区花园志愿服务说明'
    if not image:
        return None, '请上传社区花园志愿服务照片'
    if len(note) < 5:
        return None, '志愿服务说明请至少填写 5 个字'

    with get_db() as conn:
        row = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (booking_id,)).fetchone()
        if not row:
            return None, '预约记录不存在'
        if row['status'] == 'cancelled':
            return None, '该预约已取消，无法签退'
        if row['status'] == 'checked_out':
            return None, '该预约已签退'
        if row['status'] != 'upcoming':
            return None, '当前状态不可签退'
        if phone and row['phone'] != phone:
            return None, '手机号与预约记录不匹配'

        start = datetime.strptime(f"{row['date']}T{row['time_slot']}", '%Y-%m-%dT%H:%M')
        if datetime.now() < start:
            return None, '活动开始后方可签退'

        now = datetime.now()
        conn.execute(
            '''UPDATE room_bookings
               SET status = 'checked_out',
                   volunteer_note = ?,
                   volunteer_image = ?,
                   checkout_at = ?
               WHERE id = ?''',
            (note, image, now.isoformat(), booking_id)
        )
        updated = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (booking_id,)).fetchone()
        return row_to_room_booking(updated), None


def cancel_room_booking(booking_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (booking_id,)).fetchone()
        if not row:
            return None, '预约记录不存在'
        if row['status'] != 'upcoming':
            return None, '仅未签退的有效预约可取消'
        booking_time = datetime.strptime(f"{row['date']}T{row['time_slot']}", '%Y-%m-%dT%H:%M')
        if (booking_time - datetime.now()).total_seconds() < 3600:
            return None, '开始前 1 小时内不可取消'
        conn.execute(
            "UPDATE room_bookings SET status = 'cancelled' WHERE id = ?",
            (booking_id,)
        )
        updated = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (booking_id,)).fetchone()
        return row_to_room_booking(updated), None


def upsert_user(conn, phone, name, card):
    now = datetime.now().isoformat()
    existing = conn.execute('SELECT * FROM users WHERE phone = ?', (phone,)).fetchone()
    if existing:
        conn.execute(
            'UPDATE users SET name = ?, card = COALESCE(?, card), updated_at = ? WHERE phone = ?',
            (name, card, now, phone)
        )
    else:
        conn.execute(
            'INSERT INTO users (phone, name, card, updated_at) VALUES (?, ?, ?, ?)',
            (phone, name, card, now)
        )


def get_user(phone):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM users WHERE phone = ?', (phone,)).fetchone()
        if not row:
            return None
        return {'name': row['name'] or '', 'phone': row['phone'], 'card': row['card'] or ''}


def room_stats_today():
    today = format_date(datetime.now())
    open_slots = get_open_time_slots(today)
    occupied = _occupied_slots_for_date(today)
    now = datetime.now()
    free = 0
    for slot in open_slots:
        hour = _slot_hour(slot)
        if hour <= now.hour:
            continue
        if slot not in occupied:
            free += 1
    booked_open = sum(1 for s in open_slots if s in occupied and _slot_hour(s) > now.hour)
    return {
        'date': today,
        'bookedCount': booked_open,
        'openCount': len(open_slots),
        'freeSlots': free,
    }


# ========== Admin ==========

def verify_admin(username, password):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM admins WHERE username = ?', (username,)).fetchone()
        if not row or not check_password_hash(row['password_hash'], password):
            return None
        return {
            'id': row['id'],
            'username': row['username'],
            'displayName': row['display_name'] or row['username'],
        }


def get_admin_stats():
    today = format_date(datetime.now())
    with get_db() as conn:
        total_books = conn.execute('SELECT COUNT(*) FROM books').fetchone()[0]
        total_copies = conn.execute('SELECT COALESCE(SUM(copies), 0) FROM books').fetchone()[0]
        active_borrows = conn.execute(
            "SELECT COUNT(*) FROM borrows WHERE status = 'borrowed'"
        ).fetchone()[0]
        overdue_borrows = conn.execute(
            "SELECT COUNT(*) FROM borrows WHERE status = 'borrowed' AND due_date < ?",
            (today,)
        ).fetchone()[0]
        returned_total = conn.execute(
            "SELECT COUNT(*) FROM borrows WHERE status = 'returned'"
        ).fetchone()[0]
        room_upcoming = conn.execute(
            "SELECT COUNT(*) FROM room_bookings WHERE status = 'upcoming'"
        ).fetchone()[0]
        room_today = conn.execute(
            "SELECT COUNT(*) FROM room_bookings WHERE date = ? AND status = 'upcoming'",
            (today,)
        ).fetchone()[0]
        reader_count = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]

        popular = conn.execute('''
            SELECT book_title, author, COUNT(*) AS cnt
            FROM borrows GROUP BY book_id ORDER BY cnt DESC LIMIT 5
        ''').fetchall()

        return {
            'totalBooks': total_books,
            'totalCopies': total_copies,
            'activeBorrows': active_borrows,
            'overdueBorrows': overdue_borrows,
            'returnedTotal': returned_total,
            'availableCopies': max(0, total_copies - active_borrows),
            'roomUpcoming': room_upcoming,
            'roomToday': room_today,
            'readerCount': reader_count,
            'popularBooks': [
                {'title': r['book_title'], 'author': r['author'], 'count': r['cnt']}
                for r in popular
            ],
        }


def list_all_borrows(status='all', search=''):
    with get_db() as conn:
        query = 'SELECT * FROM borrows WHERE 1=1'
        params = []
        if status == 'active':
            query += " AND status = 'borrowed'"
        elif status == 'overdue':
            query += " AND status = 'borrowed' AND due_date < ?"
            params.append(format_date(datetime.now()))
        elif status == 'returned':
            query += " AND status = 'returned'"
        if search:
            query += ' AND (book_title LIKE ? OR name LIKE ? OR phone LIKE ? OR code LIKE ?)'
            like = f'%{search}%'
            params.extend([like, like, like, like])
        query += ' ORDER BY created_at DESC'
        rows = conn.execute(query, params).fetchall()
        today = format_date(datetime.now())
        results = []
        for r in rows:
            item = row_to_borrow(r)
            item['overdue'] = r['status'] == 'borrowed' and r['due_date'] < today
            results.append(item)
        return results


def list_all_room_bookings(status='all', search=''):
    with get_db() as conn:
        query = 'SELECT * FROM room_bookings WHERE 1=1'
        params = []
        if status == 'upcoming':
            query += " AND status = 'upcoming'"
        elif status == 'cancelled':
            query += " AND status = 'cancelled'"
        elif status == 'checked_out':
            query += " AND status = 'checked_out'"
        elif status == 'past':
            query += " AND status IN ('cancelled', 'checked_out')"
        if search:
            query += ' AND (purpose LIKE ? OR name LIKE ? OR phone LIKE ? OR code LIKE ?)'
            like = f'%{search}%'
            params.extend([like, like, like, like])
        query += ' ORDER BY date DESC, time_slot DESC'
        rows = conn.execute(query, params).fetchall()
        return [row_to_room_booking(r) for r in rows]


def admin_cancel_room_booking(booking_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (booking_id,)).fetchone()
        if not row:
            return None, '预约记录不存在'
        if row['status'] != 'upcoming':
            return None, '该预约已取消或已签退'
        conn.execute(
            "UPDATE room_bookings SET status = 'cancelled' WHERE id = ?",
            (booking_id,)
        )
        updated = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (booking_id,)).fetchone()
        return row_to_room_booking(updated), None


def next_book_id():
    with get_db() as conn:
        rows = conn.execute("SELECT id FROM books WHERE id LIKE 'b%'").fetchall()
        max_num = 0
        for r in rows:
            try:
                max_num = max(max_num, int(r['id'][1:]))
            except ValueError:
                pass
        return f'b{max_num + 1}'


def create_book(data):
    title = (data.get('title') or '').strip()
    author = (data.get('author') or '').strip()
    category = (data.get('category') or '').strip()
    isbn = (data.get('isbn') or '').strip()
    copies = int(data.get('copies') or 1)
    cover_isbn = (data.get('coverIsbn') or isbn.replace('-', '')).strip()

    if not title or not author or not category:
        return None, '请填写书名、作者和分类'
    if copies < 1:
        return None, '册数至少为 1'

    book_id = next_book_id()
    cover_num = int(book_id[1:]) if book_id[1:].isdigit() else 1
    cover = f'cover-{cover_num}'

    with get_db() as conn:
        conn.execute(
            '''INSERT INTO books (id, title, author, category, isbn, copies, cover, cover_isbn)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (book_id, title, author, category, isbn, copies, cover, cover_isbn or None)
        )
    return get_book(book_id), None


def update_book(book_id, data):
    book = get_book(book_id)
    if not book:
        return None, '图书不存在'

    title = (data.get('title') or book['title']).strip()
    author = (data.get('author') or book['author']).strip()
    category = (data.get('category') or book['category']).strip()
    isbn = (data.get('isbn') if 'isbn' in data else book['isbn']) or ''
    copies = int(data.get('copies') if data.get('copies') is not None else book['copies'])
    cover_isbn = (data.get('coverIsbn') if 'coverIsbn' in data else book.get('coverIsbn')) or ''

    if copies < 1:
        return None, '册数至少为 1'

    with get_db() as conn:
        borrowed = conn.execute(
            "SELECT COUNT(*) FROM borrows WHERE book_id = ? AND status = 'borrowed'",
            (book_id,)
        ).fetchone()[0]
        if copies < borrowed:
            return None, f'册数不能少于当前借出数量（{borrowed} 本）'

        conn.execute(
            '''UPDATE books SET title=?, author=?, category=?, isbn=?, copies=?, cover_isbn=?
               WHERE id=?''',
            (title, author, category, isbn, copies, cover_isbn or None, book_id)
        )
        conn.execute(
            'UPDATE borrows SET book_title=?, author=? WHERE book_id=?',
            (title, author, book_id)
        )
    return get_book(book_id), None


def delete_book(book_id):
    with get_db() as conn:
        book = conn.execute('SELECT id FROM books WHERE id = ?', (book_id,)).fetchone()
        if not book:
            return False, '图书不存在'
        active = conn.execute(
            "SELECT COUNT(*) FROM borrows WHERE book_id = ? AND status = 'borrowed'",
            (book_id,)
        ).fetchone()[0]
        if active > 0:
            return False, f'该图书有 {active} 本尚未归还，无法删除'
        conn.execute('DELETE FROM borrows WHERE book_id = ?', (book_id,))
        conn.execute('DELETE FROM books WHERE id = ?', (book_id,))
        return True, None
