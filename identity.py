"""WeChat identities, revocable sessions and audit trails. Secrets never leave the server."""
import hashlib
import json
import os
import secrets
import time
import uuid
from urllib.parse import urlencode
from urllib.request import urlopen, Request
from urllib.error import URLError
import db

TABLES = {'borrows': 'borrows', 'rooms': 'room_bookings', 'reviews': 'book_reviews'}

class LoginError(Exception):
    def __init__(self, message, status=401):
        super().__init__(message)
        self.status = status

def init_schema(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS members (
            id TEXT PRIMARY KEY, appid TEXT NOT NULL, openid TEXT NOT NULL,
            created_at INTEGER NOT NULL, UNIQUE(appid, openid)
        );
        CREATE TABLE IF NOT EXISTS auth_sessions (
            token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, subject_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_expiry ON auth_sessions(expires_at);
        CREATE TABLE IF NOT EXISTS auth_rate_limits (
            key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS identity_audit (
            id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, member_id TEXT NOT NULL,
            record_kind TEXT NOT NULL, record_id TEXT NOT NULL, reason TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
    """)
    import room_access
    room_access.init_schema(conn)
    for table in TABLES.values():
        columns = {row['name'] for row in conn.execute('PRAGMA table_info(' + table + ')')}
        if 'owner_id' not in columns:
            conn.execute('ALTER TABLE ' + table + ' ADD COLUMN owner_id TEXT REFERENCES members(id)')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_' + table + '_owner ON ' + table + '(owner_id)')

def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()

def rate_limit(kind, address, limit=10, window=60):
    now = int(time.time())
    key = digest(kind + ':' + (address or 'unknown'))
    with db.get_db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('DELETE FROM auth_rate_limits WHERE reset_at <= ?', (now,))
        row = conn.execute('SELECT count FROM auth_rate_limits WHERE key = ?', (key,)).fetchone()
        if row and row['count'] >= limit:
            raise LoginError('操作过于频繁，请稍后再试', 429)
        conn.execute('INSERT INTO auth_rate_limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1', (key, now + window))

def exchange_code(code):
    appid = os.environ.get('WECHAT_APP_ID', '')
    secret = os.environ.get('WECHAT_APP_SECRET', '')
    if not appid or not secret:
        raise LoginError('微信登录尚未配置，请联系空间管理员', 503)
    if not isinstance(code, str) or not code.strip() or len(code) > 256:
        raise LoginError('请重新发起微信登录', 400)
    url = 'https://api.weixin.qq.com/sns/jscode2session?' + urlencode({
        'appid': appid, 'secret': secret, 'js_code': code,
        'grant_type': 'authorization_code'
    })
    try:
        with urlopen(Request(url, headers={'Accept': 'application/json'}), timeout=8) as response:
            result = json.loads(response.read(16384))
    except (URLError, OSError, ValueError):
        # Never propagate the upstream URL: it contains AppSecret and a login code.
        raise LoginError('暂时无法连接微信登录服务，请稍后重试', 502) from None
    if not isinstance(result, dict):
        raise LoginError('微信登录服务返回异常，请稍后重试', 502)
    if result.get('errcode'):
        raise LoginError('微信登录凭证无效或已过期，请重新登录')
    openid = result.get('openid')
    if not isinstance(openid, str) or not openid or len(openid) > 128:
        raise LoginError('微信登录服务返回异常，请稍后重试', 502)
    return appid, openid

def member_for_wechat(appid, openid):
    with db.get_db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        conn.execute('INSERT OR IGNORE INTO members VALUES (?, ?, ?, ?)', (uuid.uuid4().hex, appid, openid, int(time.time())))
        return conn.execute('SELECT id FROM members WHERE appid = ? AND openid = ?', (appid, openid)).fetchone()['id']

def issue_session(kind, subject, lifetime=604800):
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with db.get_db() as conn:
        conn.execute('DELETE FROM auth_sessions WHERE expires_at <= ?', (now,))
        conn.execute('INSERT INTO auth_sessions VALUES (?, ?, ?, ?, ?)', (digest(token), kind, str(subject), now + lifetime, now))
    return token, now + lifetime

def session_subject(token, kind):
    if not token or len(token) > 256:
        return None
    with db.get_db() as conn:
        row = conn.execute('SELECT subject_id FROM auth_sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?', (digest(token), kind, int(time.time()))).fetchone()
        if not row:
            return None
        table = 'members' if kind == 'member' else 'admins'
        exists = conn.execute('SELECT id FROM ' + table + ' WHERE id = ?', (row['subject_id'],)).fetchone()
        return row['subject_id'] if exists else None

def revoke(token):
    with db.get_db() as conn:
        conn.execute('DELETE FROM auth_sessions WHERE token_hash = ?', (digest(token or ''),))

def owns(kind, record_id, member_id):
    with db.get_db() as conn:
        return conn.execute('SELECT 1 FROM ' + TABLES[kind] + ' WHERE id = ? AND owner_id = ?', (record_id, member_id)).fetchone() is not None

def photo_owned(filename, member_id):
    with db.get_db() as conn:
        return conn.execute('SELECT 1 FROM room_bookings WHERE owner_id = ? AND volunteer_image = ?', (member_id, '/static/uploads/volunteer/' + filename)).fetchone() is not None

def link_legacy(kind, record_id, member_id, reason, admin_id):
    if kind not in TABLES or not isinstance(reason, str) or not 5 <= len(reason.strip()) <= 300:
        raise LoginError('请选择记录类型并填写至少 5 字的核验说明', 400)
    with db.get_db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if not conn.execute('SELECT 1 FROM members WHERE id = ?', (member_id,)).fetchone():
            raise LoginError('账户编号不存在，请让读者先微信登录', 400)
        row = conn.execute('SELECT owner_id FROM ' + TABLES[kind] + ' WHERE id = ?', (record_id,)).fetchone()
        if not row:
            raise LoginError('记录不存在', 404)
        if row['owner_id']:
            raise LoginError('该记录已有所属账户，不允许重新绑定', 409)
        conn.execute('UPDATE ' + TABLES[kind] + ' SET owner_id = ? WHERE id = ? AND owner_id IS NULL', (member_id, record_id))
        conn.execute('INSERT INTO identity_audit VALUES (?, ?, ?, ?, ?, ?, ?)', (uuid.uuid4().hex, str(admin_id), member_id, kind, record_id, reason.strip(), int(time.time())))
