"""Production configuration and request authorization for every client."""
import os
import posixpath
import secrets
from datetime import timedelta
from functools import wraps
from urllib.parse import urlparse
from flask import abort, g, jsonify, request, session
from werkzeug.middleware.proxy_fix import ProxyFix
import db
import identity
from storage_lock import StorageLock

def configure(app):
    production = os.environ.get('LIBRARY_ENV') == 'production'
    app.config['PRODUCTION'] = production
    app.secret_key = os.environ.get('SECRET_KEY') or (None if production else 'yuexiang-dev-secret-change-in-production')
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
                      SESSION_COOKIE_SECURE=production, PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
                      MAX_CONTENT_LENGTH=5 * 1024 * 1024)
    if production:
        required = ('SECRET_KEY', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET', 'PUBLIC_BASE_URL', 'LIBRARY_DB_PATH', 'LIBRARY_UPLOAD_DIR', 'DOOR_CODE_KEY')
        if any(not os.environ.get(name) for name in required):
            raise RuntimeError('Production environment is incomplete; see deploy/app.env.example')
        if len(app.secret_key) < 32 or app.secret_key == 'yuexiang-dev-secret-change-in-production':
            raise RuntimeError('Production SECRET_KEY must be a new random value of at least 32 characters')
        from room_access import cipher
        cipher()
        public = urlparse(os.environ['PUBLIC_BASE_URL'])
        if public.scheme != 'https' or not public.hostname or public.path not in ('', '/') or public.username or public.query or public.fragment:
            raise RuntimeError('PUBLIC_BASE_URL must be an HTTPS origin')
        for key in ('LIBRARY_DB_PATH', 'LIBRARY_UPLOAD_DIR'):
            if not os.path.isabs(os.environ[key]):
                raise RuntimeError(key + ' must be an absolute persistent path')
        app.config['PUBLIC_HOST'] = public.netloc
    if os.environ.get('TRUST_PROXY') == '1':
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    @app.errorhandler(identity.LoginError)
    def login_error(error):
        return jsonify({'error': str(error)}), error.status

    @app.before_request
    def guards():
        # Static fallback must never expose private uploads, even via ../ or encoded aliases.
        if request.endpoint == 'static':
            filename = posixpath.normpath((request.view_args or {}).get('filename', '').replace('\\', '/'))
            if filename == 'uploads' or filename.startswith('uploads/'):
                abort(404)
        if production and request.host != app.config['PUBLIC_HOST'] and request.path != '/healthz':
            abort(400)
        if session.get('admin_id'):
            actual = identity.session_subject(session.get('admin_session'), 'admin')
            if actual != str(session['admin_id']):
                session.clear()
        if request.path.startswith('/api/admin/') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if not request.is_json:
                raise identity.LoginError('管理请求必须为 JSON', 415)
            origin = request.headers.get('Origin')
            if origin and origin != request.host_url.rstrip('/'):
                raise identity.LoginError('请求来源不匹配', 403)
            if request.path != '/api/admin/login':
                if not session.get('admin_id'):
                    raise identity.LoginError('请先登录管理员账号')
                supplied = request.headers.get('X-CSRF-Token', '')
                if not supplied or not secrets.compare_digest(supplied, session.get('csrf_token', '')):
                    raise identity.LoginError('会话校验失败，请重新登录', 403)
        if request.path in ('/api/auth/wechat', '/api/admin/login'):
            identity.rate_limit(request.path, request.remote_addr, window=300)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            lock = StorageLock()
            try:
                lock.acquire()
            except TimeoutError:
                raise identity.LoginError('正在进行数据维护，请稍后再试', 503) from None
            g.storage_lock = lock

    @app.teardown_request
    def unlock(error=None):
        lock = g.pop('storage_lock', None)
        if lock:
            lock.release()

    @app.after_request
    def headers(response):
        if request.path.startswith('/api/') or request.path.startswith('/static/uploads/'):
            response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['X-Frame-Options'] = 'DENY'
        if production:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

def bearer():
    header = request.headers.get('Authorization', '')
    return header[7:] if header.startswith('Bearer ') else ''

def require_member(kind=None, record_arg=None):
    def decorate(function):
        @wraps(function)
        def wrapped(*args, **kwargs):
            member = identity.session_subject(bearer(), 'member')
            if not member:
                raise identity.LoginError('请先在微信小程序中登录')
            g.member_id = member
            if kind and not identity.owns(kind, kwargs[record_arg], member):
                raise identity.LoginError('记录不存在或不属于当前账户', 404)
            return function(*args, **kwargs)
        return wrapped
    return decorate
