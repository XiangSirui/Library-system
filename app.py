"""阅享空间 · Flask 本地服务端"""

import os
import uuid
from functools import wraps
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
import db

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'yuexiang-dev-secret-change-in-production')
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), 'static', 'uploads', 'volunteer')
ALLOWED_IMAGE_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.gif'}

db.init_db()
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _save_volunteer_image(file_storage):
    if not file_storage or not file_storage.filename:
        return None, '请上传社区花园志愿服务照片'
    filename = secure_filename(file_storage.filename)
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXT:
        return None, '图片格式仅支持 JPG / PNG / WEBP / GIF'
    new_name = f'{uuid.uuid4().hex}{ext}'
    path = os.path.join(UPLOAD_DIR, new_name)
    file_storage.save(path)
    return f'/static/uploads/volunteer/{new_name}', None


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('admin_id'):
            if request.path.startswith('/api/'):
                return jsonify({'error': '请先登录管理员账号'}), 401
            return redirect(url_for('admin_login_page'))
        return f(*args, **kwargs)
    return decorated


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/admin/login')
def admin_login_page():
    if session.get('admin_id'):
        return redirect(url_for('admin_dashboard'))
    return render_template('admin_login.html')


@app.route('/admin')
@admin_required
def admin_dashboard():
    return render_template('admin.html')


# ========== Public API ==========

@app.route('/api/books')
def api_books():
    category = request.args.get('category', 'all')
    search = request.args.get('search', '').strip()
    return jsonify(db.list_books(category, search))


@app.route('/api/books/<book_id>')
def api_book(book_id):
    book = db.get_book(book_id)
    if not book:
        return jsonify({'error': '图书不存在'}), 404
    return jsonify(book)


@app.route('/api/borrows', methods=['GET'])
def api_list_borrows():
    phone = request.args.get('phone', '').strip()
    tab = request.args.get('tab', 'active')
    return jsonify(db.list_borrows(phone, tab))


@app.route('/api/borrows', methods=['POST'])
def api_create_borrow():
    data = request.get_json(force=True, silent=True) or {}
    book_id = (data.get('bookId') or '').strip()
    name = (data.get('name') or '').strip()
    phone = (data.get('phone') or '').strip()
    card = (data.get('card') or '').strip()

    if not book_id or not name or not phone:
        return jsonify({'error': '请填写完整信息'}), 400
    if len(phone) != 11 or not phone.isdigit():
        return jsonify({'error': '请输入正确的手机号'}), 400

    record, err = db.create_borrow(book_id, name, phone, card)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(record), 201


@app.route('/api/borrows/<borrow_id>/return', methods=['POST'])
def api_return_borrow(borrow_id):
    record, err = db.return_borrow(borrow_id)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(record)


@app.route('/api/borrows/<borrow_id>/renew', methods=['POST'])
def api_renew_borrow(borrow_id):
    record, err = db.renew_borrow(borrow_id)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(record)


@app.route('/api/room/calendar')
def api_room_calendar():
    # 前台展示全部时段，未开放的标为 closed（灰色），不隐藏
    return jsonify(db.get_room_calendar(include_closed=True))


@app.route('/api/room/slots')
def api_room_slots():
    date = request.args.get('date', '').strip()
    if not date:
        return jsonify({'error': '缺少日期参数'}), 400
    open_slots = db.get_open_time_slots(date)
    return jsonify({
        'date': date,
        'bookedSlots': db.get_booked_room_slots(date),
        'openSlots': open_slots,
        'allSlots': list(db.ALL_TIME_SLOTS),
    })


@app.route('/api/room/stats')
def api_room_stats():
    return jsonify(db.room_stats_today())


@app.route('/api/room/bookings', methods=['GET'])
def api_list_room_bookings():
    phone = request.args.get('phone', '').strip()
    tab = request.args.get('tab', 'upcoming')
    return jsonify(db.list_room_bookings(phone, tab))


@app.route('/api/room/bookings', methods=['POST'])
def api_create_room_booking():
    # 支持 multipart（含图片）与 JSON
    if request.content_type and 'multipart/form-data' in request.content_type:
        date = (request.form.get('date') or '').strip()
        time_slot = (request.form.get('timeSlot') or '').strip()
        duration = int(request.form.get('duration') or 0)
        purpose = (request.form.get('purpose') or '').strip()
        name = (request.form.get('name') or '').strip()
        phone = (request.form.get('phone') or '').strip()
        attendees = int(request.form.get('attendees') or 0)
        volunteer_note = (request.form.get('volunteerNote') or '').strip()
        image_url, img_err = _save_volunteer_image(request.files.get('volunteerImage'))
        if img_err:
            return jsonify({'error': img_err}), 400
    else:
        data = request.get_json(force=True, silent=True) or {}
        date = (data.get('date') or '').strip()
        time_slot = (data.get('timeSlot') or '').strip()
        duration = int(data.get('duration') or 0)
        purpose = (data.get('purpose') or '').strip()
        name = (data.get('name') or '').strip()
        phone = (data.get('phone') or '').strip()
        attendees = int(data.get('attendees') or 0)
        volunteer_note = (data.get('volunteerNote') or '').strip()
        image_url = (data.get('volunteerImage') or '').strip()
        if not image_url:
            return jsonify({'error': '请上传社区花园志愿服务照片'}), 400

    if not all([date, time_slot, purpose, name, phone]) or duration < 1:
        return jsonify({'error': '请填写完整信息'}), 400
    if len(phone) != 11 or not phone.isdigit():
        return jsonify({'error': '请输入正确的手机号'}), 400

    record, err = db.create_room_booking(
        date, time_slot, duration, purpose, name, phone, attendees,
        volunteer_note=volunteer_note, volunteer_image=image_url,
    )
    if err:
        return jsonify({'error': err}), 400
    return jsonify(record), 201


@app.route('/api/room/bookings/<booking_id>/cancel', methods=['POST'])
def api_cancel_room_booking(booking_id):
    record, err = db.cancel_room_booking(booking_id)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(record)


@app.route('/api/user')
def api_get_user():
    phone = request.args.get('phone', '').strip()
    if not phone:
        return jsonify({'error': '缺少手机号'}), 400
    user = db.get_user(phone)
    if not user:
        return jsonify({'name': '', 'phone': phone, 'card': ''})
    return jsonify(user)


# ========== Admin API ==========

@app.route('/api/admin/login', methods=['POST'])
def api_admin_login():
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    admin = db.verify_admin(username, password)
    if not admin:
        return jsonify({'error': '用户名或密码错误'}), 401
    session['admin_id'] = admin['id']
    session['admin_username'] = admin['username']
    session['admin_name'] = admin['displayName']
    return jsonify({'username': admin['username'], 'displayName': admin['displayName']})


@app.route('/api/admin/logout', methods=['POST'])
def api_admin_logout():
    session.clear()
    return jsonify({'ok': True})


@app.route('/api/admin/me')
def api_admin_me():
    if not session.get('admin_id'):
        return jsonify({'error': '未登录'}), 401
    return jsonify({
        'username': session.get('admin_username'),
        'displayName': session.get('admin_name'),
    })


@app.route('/api/admin/stats')
@admin_required
def api_admin_stats():
    return jsonify(db.get_admin_stats())


@app.route('/api/admin/books', methods=['GET'])
@admin_required
def api_admin_books():
    search = request.args.get('search', '').strip()
    return jsonify(db.list_books('all', search))


@app.route('/api/admin/books', methods=['POST'])
@admin_required
def api_admin_create_book():
    data = request.get_json(force=True, silent=True) or {}
    book, err = db.create_book(data)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(book), 201


@app.route('/api/admin/books/<book_id>', methods=['PUT'])
@admin_required
def api_admin_update_book(book_id):
    data = request.get_json(force=True, silent=True) or {}
    book, err = db.update_book(book_id, data)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(book)


@app.route('/api/admin/books/<book_id>', methods=['DELETE'])
@admin_required
def api_admin_delete_book(book_id):
    ok, err = db.delete_book(book_id)
    if not ok:
        return jsonify({'error': err}), 400
    return jsonify({'ok': True})


@app.route('/api/admin/borrows')
@admin_required
def api_admin_borrows():
    status = request.args.get('status', 'all')
    search = request.args.get('search', '').strip()
    return jsonify(db.list_all_borrows(status, search))


@app.route('/api/admin/borrows/<borrow_id>/return', methods=['POST'])
@admin_required
def api_admin_return_borrow(borrow_id):
    record, err = db.return_borrow(borrow_id)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(record)


@app.route('/api/admin/room/calendar')
@admin_required
def api_admin_room_calendar():
    return jsonify(db.get_room_calendar(include_details=True, include_closed=True))


@app.route('/api/admin/room/slots', methods=['GET'])
@admin_required
def api_admin_get_room_slots():
    date = request.args.get('date', '').strip()
    if date:
        result, err = db.get_day_slot_settings(date)
        if err:
            return jsonify({'error': err}), 400
        return jsonify(result)
    return jsonify(db.get_range_slot_settings())


@app.route('/api/admin/room/slots', methods=['PUT'])
@admin_required
def api_admin_set_room_slots():
    data = request.get_json(force=True, silent=True) or {}
    date = (data.get('date') or '').strip()
    open_slots = data.get('openSlots') or data.get('slots') or []
    apply_to_range = bool(data.get('applyToRange'))

    if not date:
        # 无日期时改默认模板（兼容旧调用）
        result, err = db.set_default_open_slots(open_slots)
    else:
        result, err = db.set_day_open_slots(date, open_slots, apply_to_range=apply_to_range)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(result)


@app.route('/api/admin/room/bookings')
@admin_required
def api_admin_room_bookings():
    status = request.args.get('status', 'all')
    search = request.args.get('search', '').strip()
    return jsonify(db.list_all_room_bookings(status, search))


@app.route('/api/admin/room/bookings/<booking_id>/cancel', methods=['POST'])
@admin_required
def api_admin_cancel_room(booking_id):
    record, err = db.admin_cancel_room_booking(booking_id)
    if err:
        return jsonify({'error': err}), 400
    return jsonify(record)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    print('=' * 50)
    print('  阅享空间 · 本地服务已启动')
    print(f'  浏览器打开: http://127.0.0.1:{port}')
    print('  管理: /admin/login')
    print('  账号: admin  密码: admin123')
    print('=' * 50)
    app.run(debug=debug, host='0.0.0.0', port=port, use_reloader=False)
