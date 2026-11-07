"""Regression tests run against disposable databases and uploads only."""
import io
import os
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

# app.py initializes the DB on import, so isolate before importing it.
_STARTUP = tempfile.TemporaryDirectory(prefix='yuexiang-import-test-')
os.environ['LIBRARY_DB_PATH'] = str(Path(_STARTUP.name) / 'library.db')
os.environ['LIBRARY_UPLOAD_DIR'] = str(Path(_STARTUP.name) / 'uploads')

import app as server
import db
import identity
from PIL import Image


class MiniProgramApiTests(unittest.TestCase):
    phone = '13800000001'
    other_phone = '13800000002'

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='yuexiang-api-test-')
        self.addCleanup(self.temp.cleanup)
        db.DB_PATH = str(Path(self.temp.name) / 'library.db')
        server.UPLOAD_DIR = str(Path(self.temp.name) / 'uploads')
        Path(server.UPLOAD_DIR).mkdir()
        db.init_db()
        server.app.config.update(TESTING=True, SECRET_KEY='test-key-only')
        self.client = server.app.test_client()
        self.member_id = identity.member_for_wechat('test-app', 'reader-A')
        self.other_member_id = identity.member_for_wechat('test-app', 'reader-B')
        self.token, _ = identity.issue_session('member', self.member_id)
        self.other_token, _ = identity.issue_session('member', self.other_member_id)
        self.client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + self.token
        self.other_client = server.app.test_client()
        self.other_client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + self.other_token
        self.tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')

    def borrow(self, book_id='b1', phone=None):
        client = self.other_client if phone and phone != self.phone else self.client
        response = client.post('/api/borrows', json={
            'bookId': book_id, 'name': '测试读者', 'phone': phone or self.phone, 'card': 'TEST',
        })
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()

    def login(self):
        response = self.client.post('/api/admin/login', json={'username': 'admin', 'password': 'admin123'})
        self.assertEqual(response.status_code, 200)
        self.client.environ_base['HTTP_X_CSRF_TOKEN'] = response.get_json()['csrfToken']
        return response

    def room_data(self, **changes):
        data = dict(date=self.tomorrow, timeSlot='10:00', duration=2,
                    purpose='读书分享会', name='测试居民', phone=self.phone, attendees=10)
        data.update(changes)
        return data

    def room(self, **changes):
        response = self.client.post('/api/room/bookings', json=self.room_data(**changes))
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()

    def review(self, book_id='b1'):
        response = self.client.post('/api/reviews', json={
            'bookId': book_id, 'phone': self.phone, 'name': '测试读者',
            'rating': 5, 'content': '一本值得分享的好书，推荐给喜欢阅读的邻居。',
        })
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()

    @staticmethod
    def image_bytes():
        output = io.BytesIO()
        Image.new('RGB', (10, 10), '#447755').save(output, format='PNG')
        return output.getvalue()

    def checkout(self, booking_id, payload=None, **changes):
        data = dict(phone=self.phone, volunteerNote='在社区花园完成浇水与除草。',
                    volunteerImage=(io.BytesIO(payload if payload is not None else self.image_bytes()), 'volunteer.png'))
        data.update(changes)
        return self.client.post(f'/api/room/bookings/{booking_id}/checkout', data=data,
                                content_type='multipart/form-data')

    def start_room(self, record):
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        with db.get_db() as conn:
            conn.execute('UPDATE room_bookings SET date = ? WHERE id = ?', (yesterday, record['id']))

    def test_public_catalogue_and_web_routes_remain_available(self):
        for path in ('/', '/garden', '/admin/login'):
            self.assertEqual(self.client.get(path).status_code, 200)
        books = self.client.get('/api/books').get_json()
        self.assertEqual(len(books), 16)
        self.assertTrue(all(item['available'] == item['copies'] for item in books))
        result = self.client.get('/api/books?category=文学&search=活着').get_json()
        self.assertEqual([item['id'] for item in result], ['b1'])
        self.assertEqual(self.client.get('/api/books/no-such-book').status_code, 404)

    def test_personal_queries_ignore_forged_phone_and_require_identity(self):
        record = self.borrow()
        self.room()
        self.assertEqual(self.client.get('/api/borrows').get_json()[0]['id'], record['id'])
        self.assertEqual(self.other_client.get('/api/borrows', query_string={'phone': self.phone}).get_json(), [])
        for path in ('/api/borrows', '/api/room/bookings', '/api/user', '/api/reviews/mine', '/api/reviews/eligibility?book_id=b1'):
            self.assertEqual(server.app.test_client().get(path).status_code, 401)
        self.assertEqual(self.client.get('/api/user?phone=' + self.other_phone).get_json(), {'id': self.member_id})

    def test_borrow_renew_and_return_flow(self):
        record = self.borrow()
        path = '/api/borrows/' + record['id']
        self.assertEqual(self.client.get('/api/books/b1').get_json()['available'], 2)
        self.assertEqual(self.other_client.post(path + '/renew', json={'phone': self.phone}).status_code, 404)
        renewed = self.client.post(path + '/renew', json={'phone': self.phone}).get_json()
        self.assertTrue(renewed['renewed'])
        old_due = datetime.strptime(record['dueDate'], '%Y-%m-%d')
        self.assertEqual(renewed['dueDate'], (old_due + timedelta(days=30)).strftime('%Y-%m-%d'))
        self.assertEqual(self.client.post(path + '/renew', json={'phone': self.phone}).status_code, 400)
        self.assertEqual(self.other_client.post(path + '/return', json={'phone': self.phone}).status_code, 404)
        self.assertEqual(self.client.post(path + '/return', json={'phone': self.phone}).status_code, 200)
        self.assertEqual(self.client.get('/api/books/b1').get_json()['available'], 3)
        records = self.client.get('/api/borrows', query_string={'phone': self.phone, 'tab': 'history'}).get_json()
        self.assertEqual(records[0]['status'], 'returned')

    def test_legacy_return_without_identity_is_closed(self):
        record = self.borrow()
        self.assertEqual(server.app.test_client().post('/api/borrows/' + record['id'] + '/return', json={}).status_code, 401)

    def test_borrow_limits_and_unique_ids(self):
        records = [self.borrow(book_id) for book_id in ('b1', 'b2', 'b3')]
        self.assertEqual(len({record['id'] for record in records}), 3)
        self.assertEqual(self.client.post('/api/borrows', json={
            'bookId': 'b4', 'name': '测试', 'phone': self.phone,
        }).status_code, 400)
        self.borrow('b10', self.other_phone)
        self.assertEqual(self.client.post('/api/borrows', json={
            'bookId': 'b10', 'name': '测试', 'phone': '13800000003',
        }).status_code, 400)

    def test_review_eligibility_and_moderation_flow(self):
        self.assertFalse(self.client.get('/api/reviews/eligibility', query_string={
            'book_id': 'b1', 'phone': self.phone,
        }).get_json()['canReview'])
        self.borrow()
        self.assertTrue(self.client.get('/api/reviews/eligibility', query_string={
            'book_id': 'b1', 'phone': self.phone,
        }).get_json()['canReview'])
        review = self.review()
        self.assertEqual(review['status'], 'pending')
        self.assertEqual(self.client.get('/api/books/b1/reviews').get_json()['count'], 0)
        self.login()
        approved = self.client.post('/api/admin/reviews/' + review['id'] + '/approve', json={}).get_json()
        self.assertEqual(approved['status'], 'approved')
        public = self.client.get('/api/books/b1/reviews').get_json()
        self.assertEqual(public['count'], 1)
        self.assertNotIn('phone', public['reviews'][0])
        self.assertNotEqual(public['reviews'][0]['name'], '测试读者')
        rejected = self.client.post('/api/admin/reviews/' + review['id'] + '/reject',
                                    json={'reason': '请补充内容'}).get_json()
        self.assertEqual(rejected['status'], 'rejected')
        self.assertEqual(rejected['rejectReason'], '请补充内容')
        updated = self.client.put('/api/reviews/' + review['id'], json={
            'phone': self.phone, 'rating': 4, 'content': '补充阅读感受，细节让人深受启发，愿与邻居交流。',
        }).get_json()
        self.assertEqual(updated['status'], 'pending')
        self.assertEqual(updated['rating'], 4)
        self.assertEqual(self.other_client.delete('/api/reviews/' + review['id'],
                                           json={'phone': self.phone}).status_code, 404)
        self.assertEqual(self.client.delete('/api/reviews/' + review['id'],
                                           json={'phone': self.phone}).status_code, 200)

    def test_multiple_reviews_and_admin_delete(self):
        self.borrow()
        one, two = self.review(), self.review()
        self.assertNotEqual(one['id'], two['id'])
        self.assertEqual(len(self.client.get('/api/reviews/mine', query_string={'phone': self.phone}).get_json()), 2)
        self.login()
        self.assertEqual(self.client.delete('/api/admin/reviews/' + one['id'], json={}).status_code, 200)

    def test_room_calendar_and_booking_conflict(self):
        calendar = self.client.get('/api/room/calendar').get_json()
        self.assertEqual(len(calendar['days']), 15)
        self.assertEqual(len(calendar['allSlots']), 12)
        room = self.room()
        self.assertEqual(self.client.post('/api/room/bookings', json=self.room_data(phone=self.other_phone, timeSlot='11:00')).status_code, 400)
        self.assertEqual(self.client.post('/api/room/bookings', json=self.room_data(timeSlot='14:00')).status_code, 400)
        slots = self.client.get('/api/room/slots', query_string={'date': self.tomorrow}).get_json()
        self.assertIn('10:00', slots['bookedSlots'])
        self.assertIn('11:00', slots['bookedSlots'])
        self.assertEqual(self.other_client.post('/api/room/bookings/' + room['id'] + '/cancel',
                                         json={'phone': self.phone}).status_code, 404)
        self.assertEqual(self.client.post('/api/room/bookings/' + room['id'] + '/cancel',
                                         json={'phone': self.phone}).status_code, 200)
        self.room(timeSlot='10:00')

    def test_room_date_duration_capacity_validation(self):
        invalid = [
            {'date': '2026-99-99'}, {'date': '2026-1-2'},
            {'date': (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')},
            {'date': (datetime.now() + timedelta(days=15)).strftime('%Y-%m-%d')},
            {'timeSlot': '10:30'}, {'duration': 0}, {'duration': 4},
            {'duration': 'abc'}, {'duration': 1.5}, {'duration': True},
            {'attendees': 0}, {'attendees': 31}, {'attendees': 'many'}, {'attendees': []},
            {'phone': '123'}, {'name': []}, {'purpose': {}}, {'date': None},
        ]
        for change in invalid:
            with self.subTest(change=change):
                response = self.client.post('/api/room/bookings', json=self.room_data(**change))
                self.assertEqual(response.status_code, 400, response.get_json())
        self.assertEqual(self.client.get('/api/room/slots?date=not-a-date').status_code, 400)

    def test_admin_slot_management_and_closed_slots(self):
        self.login()
        response = self.client.put('/api/admin/room/slots', json={
            'date': self.tomorrow, 'openSlots': ['08:00', '09:00'], 'applyToRange': False,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['openSlots'], ['08:00', '09:00'])
        self.assertEqual(self.client.post('/api/room/bookings', json=self.room_data()).status_code, 400)
        self.assertEqual(self.client.post('/api/room/bookings', json=self.room_data(timeSlot='09:00', duration=2)).status_code, 400)
        self.room(timeSlot='08:00')
        response = self.client.put('/api/admin/room/slots', json={
            'date': self.tomorrow, 'openSlots': ['14:00'], 'applyToRange': True,
        })
        self.assertEqual(response.status_code, 200)
        calendar = self.client.get('/api/room/calendar').get_json()
        self.assertTrue(all(day['openSlots'] == ['14:00'] for day in calendar['days']))
        self.assertEqual(self.client.put('/api/admin/room/slots', json={
            'date': 'invalid', 'openSlots': ['08:00'],
        }).status_code, 400)

    def test_checkout_validates_before_saving(self):
        room = self.room()
        self.assertEqual(self.checkout(room['id']).status_code, 400)  # future activity
        self.assertEqual(list(Path(server.UPLOAD_DIR).iterdir()), [])
        self.start_room(room)
        self.assertEqual(self.other_client.post('/api/room/bookings/' + room['id'] + '/checkout', data={'phone': self.phone}).status_code, 404)
        self.assertEqual(self.checkout(room['id'], volunteerNote='少').status_code, 400)
        self.assertEqual(self.checkout(room['id'], payload=b'not an image').status_code, 400)
        self.assertEqual(list(Path(server.UPLOAD_DIR).iterdir()), [])
        response = self.checkout(room['id'])
        self.assertEqual(response.status_code, 200, response.get_json())
        record = response.get_json()
        self.assertEqual(record['status'], 'checked_out')
        self.assertTrue(record['volunteerImage'].endswith('.png'))
        self.assertEqual(len(list(Path(server.UPLOAD_DIR).iterdir())), 1)
        self.assertEqual(self.checkout(room['id']).status_code, 400)
        self.assertEqual(len(list(Path(server.UPLOAD_DIR).iterdir())), 1)

    def test_checkout_cleans_uploaded_file_on_racing_failure(self):
        room = self.room()
        self.start_room(room)
        with patch.object(db, 'checkout_room_booking', return_value=(None, '该预约已签退')):
            self.assertEqual(self.checkout(room['id']).status_code, 400)
        self.assertEqual(list(Path(server.UPLOAD_DIR).iterdir()), [])

    def test_checkout_rejects_forged_image_urls_and_large_uploads(self):
        room = self.room()
        self.start_room(room)
        response = self.client.post('/api/room/bookings/' + room['id'] + '/checkout', json={
            'phone': self.phone, 'volunteerNote': '社区花园志愿服务完成', 'volunteerImage': 'https://example.org/fake.png',
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(server.app.config['MAX_CONTENT_LENGTH'], 5 * 1024 * 1024)
        # Lower the same HTTP limit to avoid creating a multi-MB test-client temp file.
        with patch.dict(server.app.config, {'MAX_CONTENT_LENGTH': 64}):
            response = self.checkout(room['id'])
        self.assertEqual(response.status_code, 413)
        self.assertIn('error', response.get_json())
        self.assertEqual(list(Path(server.UPLOAD_DIR).iterdir()), [])

    def test_cancel_started_activity_fails_but_admin_can_cancel(self):
        room = self.room()
        self.start_room(room)
        self.assertEqual(self.client.post('/api/room/bookings/' + room['id'] + '/cancel',
                                         json={'phone': self.phone}).status_code, 400)
        self.login()
        response = self.client.post('/api/admin/room/bookings/' + room['id'] + '/cancel', json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['status'], 'cancelled')

    def test_admin_auth_cookie_and_logout(self):
        for path in ('/api/admin/me', '/api/admin/stats', '/api/admin/books',
                     '/api/admin/borrows', '/api/admin/room/calendar',
                     '/api/admin/room/bookings', '/api/admin/room/slots', '/api/admin/reviews'):
            self.assertEqual(self.client.get(path).status_code, 401, path)
        self.assertEqual(self.client.post('/api/admin/login', json={
            'username': 'admin', 'password': 'invalid',
        }).status_code, 401)
        # Native wx.request transports the Flask cookie manually.
        client = server.app.test_client(use_cookies=False)
        response = client.post('/api/admin/login', json={'username': 'admin', 'password': 'admin123'})
        cookie = response.headers['Set-Cookie'].split(';', 1)[0]
        self.assertEqual(client.get('/api/admin/me', headers={'Cookie': cookie}).status_code, 200)
        self.assertEqual(client.get('/api/admin/stats').status_code, 401)
        self.assertEqual(client.post('/api/admin/logout', json={}, headers={'Cookie': cookie, 'X-CSRF-Token': response.get_json()['csrfToken']}).status_code, 200)
        self.login()
        self.client.post('/api/admin/logout', json={})
        self.assertEqual(self.client.get('/api/admin/me').status_code, 401)

    def test_admin_book_crud_and_borrow_return(self):
        self.login()
        data = dict(title='测试图书', author='测试作者', category='文学', copies=2, isbn='TEST')
        response = self.client.post('/api/admin/books', json=data)
        self.assertEqual(response.status_code, 201)
        book = response.get_json()
        updated = self.client.put('/api/admin/books/' + book['id'], json={'title': '更新图书', 'copies': 3})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()['copies'], 3)
        self.assertEqual(self.client.delete('/api/admin/books/' + book['id'], json={}).status_code, 200)
        record = self.borrow()
        self.assertEqual(self.client.post('/api/admin/borrows/' + record['id'] + '/return', json={}).status_code, 200)
        stats = self.client.get('/api/admin/stats').get_json()
        self.assertEqual(stats['returnedTotal'], 1)
        self.assertEqual(stats['totalBooks'], 16)

    def test_concurrent_requests_cannot_double_book_or_overdraw_stock(self):
        def borrow_one(phone):
            client = server.app.test_client()
            client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + (self.token if phone == self.phone else self.other_token)
            return client.post('/api/borrows', json={
                'bookId': 'b10', 'name': '并发测试', 'phone': phone,
            }).status_code

        def reserve_one(phone):
            client = server.app.test_client()
            client.environ_base['HTTP_AUTHORIZATION'] = 'Bearer ' + (self.token if phone == self.phone else self.other_token)
            return client.post('/api/room/bookings', json=self.room_data(phone=phone)).status_code

        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual(sorted(executor.map(borrow_one, [self.phone, self.other_phone])), [201, 400])
            self.assertEqual(sorted(executor.map(reserve_one, [self.phone, self.other_phone])), [201, 400])

    def test_invalid_json_shapes_and_numbers_return_400(self):
        self.login()
        for endpoint in ('/api/borrows', '/api/room/bookings', '/api/reviews', '/api/admin/books'):
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.client.post(endpoint, json=['unexpected']).status_code, 400)
        for key, value in [('copies', 'abc'), ('copies', 1.5), ('copies', True), ('copies', 0), ('title', {})]:
            data = dict(title='测试', author='作者', category='文学', copies=1)
            data[key] = value
            self.assertEqual(self.client.post('/api/admin/books', json=data).status_code, 400)
        self.borrow()
        review = self.review()
        for value in ('abc', 2.5, True, [], 0, 6):
            self.assertEqual(self.client.put('/api/reviews/' + review['id'],
                                            json={'phone': self.phone, 'rating': value}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
