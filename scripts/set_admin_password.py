"""Change an existing administrator password without starting the application.

Usage: python scripts/set_admin_password.py [--username admin]
The database location follows LIBRARY_DB_PATH / db.DB_PATH.
"""
import argparse
import getpass
from pathlib import Path
import sqlite3
import sys
import warnings

# Running a script directly places scripts/, not the repository root, on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db
from storage_lock import StorageLock
from werkzeug.security import generate_password_hash


def main(argv=None):
    parser = argparse.ArgumentParser(description='安全更新已有管理员密码（不会初始化或重建数据库）')
    parser.add_argument('--username', default='admin', help='已有管理员用户名，默认 admin')
    args = parser.parse_args(argv)
    username = args.username.strip()
    if not username:
        parser.error('用户名不能为空')

    if not Path(db.DB_PATH).is_file():
        print('数据库不存在，请先启动服务完成初始化，再设置密码。', file=sys.stderr)
        return 2

    try:
        with db.get_db() as conn:
            row = conn.execute('SELECT id FROM admins WHERE username = ?', (username,)).fetchone()
        if row is None:
            print('未找到该管理员，请先启动服务完成初始化并确认用户名。', file=sys.stderr)
            return 2

        # Do not fall back to echoed input on terminals without secure getpass support.
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            password = getpass.getpass('新密码（至少 12 位，输入不会显示）：')
            confirmation = getpass.getpass('再次输入新密码：')
        if len(password) < 12:
            print('密码至少需要 12 位，未修改密码。', file=sys.stderr)
            return 2
        if password != confirmation:
            print('两次输入不一致，未修改密码。', file=sys.stderr)
            return 2

        password_hash = generate_password_hash(password)
        del password, confirmation
        with StorageLock(), db.get_db() as conn:
            cursor = conn.execute(
                'UPDATE admins SET password_hash = ? WHERE id = ? AND username = ?',
                (password_hash, row['id'], username),
            )
            if cursor.rowcount != 1:
                print('管理员记录已变化，未修改密码，请重试。', file=sys.stderr)
                return 2
            if conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='auth_sessions'").fetchone():
                conn.execute("DELETE FROM auth_sessions WHERE kind = 'admin' AND subject_id = ?", (str(row['id']),))
        print('管理员密码已更新，原有管理员会话已失效。')
        return 0
    except (EOFError, getpass.GetPassWarning):
        print('当前终端不能安全读取密码，请在本机交互式终端运行。', file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print('\n已取消，未修改密码。', file=sys.stderr)
        return 130
    except sqlite3.Error:
        print('无法访问管理员数据，请确认数据库可写且已启动服务完成初始化。', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
