"""Per-reservation door codes; never included in lists or public calendars."""
import os
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from cryptography.fernet import Fernet, InvalidToken
import db
from identity import LoginError

SHANGHAI = timezone(timedelta(hours=8))

def now():
    return datetime.now(SHANGHAI)

def cipher():
    try:
        return Fernet(os.environ.get('DOOR_CODE_KEY', '').encode('ascii'))
    except (ValueError, TypeError, UnicodeError):
        raise LoginError('门锁密码服务尚未配置，请联系管理员', 503) from None

def init_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS room_access_codes (
            booking_id TEXT PRIMARY KEY REFERENCES room_bookings(id),
            ciphertext TEXT NOT NULL, updated_at INTEGER NOT NULL,
            updated_by TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS room_access_audit (
            id TEXT PRIMARY KEY, booking_id TEXT NOT NULL,
            admin_id TEXT NOT NULL, action TEXT NOT NULL, created_at INTEGER NOT NULL
        );
    """)

def booking(conn, booking_id, member_id=None):
    row = conn.execute('SELECT * FROM room_bookings WHERE id = ?', (booking_id,)).fetchone()
    if not row or (member_id is not None and row['owner_id'] != member_id):
        raise LoginError('预约不存在或不属于当前账户', 404)
    return row

def end_time(row):
    start = datetime.strptime(row['date'] + 'T' + row['time_slot'], '%Y-%m-%dT%H:%M').replace(tzinfo=SHANGHAI)
    return start + timedelta(hours=row['duration'])

def enabled(row):
    return row['status'] == 'upcoming' and now() < end_time(row)

def metadata(booking_id):
    with db.get_db() as conn:
        row = booking(conn, booking_id)
        saved = conn.execute('SELECT updated_at FROM room_access_codes WHERE booking_id = ?', (booking_id,)).fetchone()
        return {'configured': saved is not None, 'editable': enabled(row), 'expiresAt': end_time(row).isoformat()}

def set_code(booking_id, value, admin_id):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9A-Za-z*#]{4,32}', value):
        raise LoginError('请输入 4 至 32 位数字、字母、* 或 # 组成的门锁密码', 400)
    # Bind ciphertext to the reservation as well as authenticating it.
    ciphertext = cipher().encrypt((booking_id + '\n' + value).encode()).decode('ascii')
    with db.get_db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = booking(conn, booking_id)
        if not enabled(row):
            raise LoginError('预约已结束、取消或签退，不能设置门锁密码', 409)
        conn.execute('''INSERT INTO room_access_codes VALUES (?, ?, ?, ?)
            ON CONFLICT(booking_id) DO UPDATE SET ciphertext=excluded.ciphertext,
            updated_at=excluded.updated_at, updated_by=excluded.updated_by''',
            (booking_id, ciphertext, int(time.time()), str(admin_id)))
        audit(conn, booking_id, admin_id, 'set')
    return {'configured': True}

def remove_code(booking_id, admin_id):
    with db.get_db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        booking(conn, booking_id)
        conn.execute('DELETE FROM room_access_codes WHERE booking_id = ?', (booking_id,))
        audit(conn, booking_id, admin_id, 'remove')
    return {'configured': False}

def audit(conn, booking_id, admin_id, action):
    conn.execute('INSERT INTO room_access_audit VALUES (?, ?, ?, ?, ?)',
                 (uuid.uuid4().hex, booking_id, str(admin_id), action, int(time.time())))

def resident_code(booking_id, member_id):
    with db.get_db() as conn:
        row = booking(conn, booking_id, member_id)
        result = {'available': False, 'expiresAt': end_time(row).isoformat()}
        if not enabled(row):
            return dict(result, reason='预约已结束、取消或签退，门锁密码已隐藏')
        saved = conn.execute('SELECT ciphertext FROM room_access_codes WHERE booking_id = ?', (booking_id,)).fetchone()
        if not saved:
            return dict(result, reason='管理员尚未设置门锁密码，请联系空间管理员')
        try:
            plain = cipher().decrypt(saved['ciphertext'].encode('ascii')).decode()
            actual_id, value = plain.split('\n', 1)
            if actual_id != booking_id:
                raise InvalidToken()
        except (InvalidToken, ValueError, UnicodeError):
            raise LoginError('门锁密码暂时无法读取，请联系管理员重新设置', 503) from None
        return dict(result, available=True, password=value)
