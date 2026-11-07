import io
from contextlib import closing
import json
import os
from pathlib import Path
import time
import unittest
from unittest.mock import patch
from urllib.error import URLError
from flask import Flask
import test_miniprogram_api as base
import identity
import db
import app as server
from runtime_security import configure
from scripts.backup_restore import backup, restore, verify

class IdentitySecurityTests(unittest.TestCase):
    phone = base.MiniProgramApiTests.phone
    other_phone = base.MiniProgramApiTests.other_phone
    setUp = base.MiniProgramApiTests.setUp
    borrow = base.MiniProgramApiTests.borrow
    login = base.MiniProgramApiTests.login
    room_data = base.MiniProgramApiTests.room_data
    room = base.MiniProgramApiTests.room
    review = base.MiniProgramApiTests.review
    start_room = base.MiniProgramApiTests.start_room
    checkout = base.MiniProgramApiTests.checkout
    image_bytes = staticmethod(base.MiniProgramApiTests.image_bytes)

    def test_wechat_login_uses_server_identity_not_client_openid(self):
        client = server.app.test_client()
        with patch.object(identity, 'exchange_code', return_value=('test-app', 'verified-reader')) as exchange:
            result = client.post('/api/auth/wechat', json={'code': 'one-use-code', 'openid': 'forged', 'userId': self.member_id})
        self.assertEqual(result.status_code, 200)
        exchange.assert_called_once_with('one-use-code')
        data = result.get_json()
        self.assertNotEqual(data['user']['id'], self.member_id)
        self.assertEqual(set(data['user']), {'id'})
        self.assertNotIn('openid', data)
        self.assertNotIn('session_key', data)
        self.assertGreater(data['expiresAt'], time.time())
        self.assertEqual(client.get('/api/auth/me', headers={'Authorization': 'Bearer ' + data['token']}).get_json(), data['user'])
        with db.get_db() as conn:
            row = conn.execute('SELECT token_hash FROM auth_sessions WHERE subject_id = ?', (data['user']['id'],)).fetchone()
        self.assertNotEqual(row['token_hash'], data['token'])
        self.assertEqual(row['token_hash'], identity.digest(data['token']))

    def test_invalid_code_and_missing_credentials_never_create_mock_login(self):
        client = server.app.test_client()
        for value in (None, [], {}, '', 'x' * 257):
            self.assertEqual(client.post('/api/auth/wechat', json={'code': value}).status_code, 400)
        with patch.dict(os.environ, {'WECHAT_APP_ID': '', 'WECHAT_APP_SECRET': ''}):
            result = client.post('/api/auth/wechat', json={'code': 'valid-format'})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('token', result.get_json())
        with patch.object(identity, 'exchange_code', side_effect=identity.LoginError('Expired code')):
            self.assertEqual(client.post('/api/auth/wechat', json={'code': 'expired'}).status_code, 401)

    def test_provider_request_discards_session_key_and_hides_secrets_on_failure(self):
        secret = 'test-secret-that-must-not-be-returned'
        response = io.BytesIO(json.dumps({'openid': 'verified', 'session_key': 'private-key'}).encode())
        with patch.dict(os.environ, {'WECHAT_APP_ID': 'test-app', 'WECHAT_APP_SECRET': secret}), patch.object(identity, 'urlopen', return_value=response) as upstream:
            self.assertEqual(identity.exchange_code('code'), ('test-app', 'verified'))
            self.assertEqual(upstream.call_args.kwargs['timeout'], 8)
            self.assertTrue(upstream.call_args.args[0].full_url.startswith('https://api.weixin.qq.com/sns/jscode2session?'))
        with patch.dict(os.environ, {'WECHAT_APP_ID': 'test-app', 'WECHAT_APP_SECRET': secret}), patch.object(identity, 'urlopen', side_effect=URLError(secret)):
            with self.assertRaises(identity.LoginError) as caught:
                identity.exchange_code('code')
            self.assertNotIn(secret, str(caught.exception))

    def test_tokens_expire_logout_revokes_and_admin_cookie_is_not_member_login(self):
        self.assertEqual(self.client.get('/api/auth/me').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 200)
        self.assertEqual(self.client.get('/api/borrows').status_code, 401)
        self.assertEqual(self.other_client.get('/api/borrows').status_code, 200)
        with db.get_db() as conn:
            conn.execute('UPDATE auth_sessions SET expires_at = 0 WHERE token_hash = ?', (identity.digest(self.other_token),))
        self.assertEqual(self.other_client.get('/api/auth/me').status_code, 401)
        self.login()
        self.assertEqual(self.client.get('/api/admin/stats').status_code, 200)
        self.assertEqual(self.client.get('/api/borrows').status_code, 401)

    def test_forged_phone_and_owner_cannot_steal_records_or_review_eligibility(self):
        record = self.borrow()
        result = self.other_client.post('/api/borrows', json={'bookId': 'b2', 'name': 'Other', 'phone': self.phone, 'ownerId': self.member_id})
        self.assertEqual(result.status_code, 201)
        self.assertEqual(result.get_json()['ownerId'], self.other_member_id)
        own = self.other_client.get('/api/borrows?phone=' + self.phone).get_json()
        self.assertEqual(len(own), 1)
        self.assertNotEqual(own[0]['id'], record['id'])
        self.assertFalse(self.other_client.get('/api/reviews/eligibility?book_id=b1&phone=' + self.phone).get_json()['canReview'])
        for action in ('return', 'renew'):
            self.assertEqual(self.other_client.post('/api/borrows/' + record['id'] + '/' + action, json={'phone': self.phone}).status_code, 404)
        review = self.review()
        self.assertEqual(self.other_client.put('/api/reviews/' + review['id'], json={'phone': self.phone, 'rating': 1}).status_code, 404)
        self.assertEqual(self.other_client.delete('/api/reviews/' + review['id'], json={'phone': self.phone}).status_code, 404)

    def test_phone_filters_only_records_already_owned_by_wechat_user(self):
        first = self.borrow()
        second = self.client.post('/api/borrows', json={'bookId': 'b2', 'name': 'Reader', 'phone': self.other_phone}).get_json()
        self.assertEqual([r['id'] for r in self.client.get('/api/borrows?phone=' + self.phone).get_json()], [first['id']])
        self.assertEqual([r['id'] for r in self.client.get('/api/borrows?phone=' + self.other_phone).get_json()], [second['id']])
        self.assertEqual(self.other_client.get('/api/borrows?phone=' + self.phone).get_json(), [])
        self.room()
        self.assertEqual(self.client.get('/api/room/bookings?phone=' + self.other_phone).get_json(), [])
        self.review()
        self.assertEqual(self.client.get('/api/reviews/mine?phone=' + self.other_phone).get_json(), [])
        self.assertEqual(self.client.get('/api/borrows?phone=bad').status_code, 400)

    def test_limits_follow_identity_even_if_contact_phone_changes(self):
        for index, book in enumerate(('b1', 'b2', 'b3')):
            result = self.client.post('/api/borrows', json={'bookId': book, 'name': 'Reader', 'phone': '1380000000' + str(index)})
            self.assertEqual(result.status_code, 201)
        self.assertEqual(self.client.post('/api/borrows', json={'bookId': 'b4', 'name': 'Reader', 'phone': '13999999999'}).status_code, 400)
        self.room()
        self.assertEqual(self.client.post('/api/room/bookings', json=self.room_data(timeSlot='14:00', phone=self.other_phone)).status_code, 400)

    def test_legacy_records_need_audited_admin_binding_and_cannot_be_rebound(self):
        record, error = db.create_borrow('b1', 'Legacy', self.phone)
        self.assertIsNone(error)
        db.init_db()
        self.assertEqual(self.client.get('/api/borrows?phone=' + self.phone).get_json(), [])
        request = {'kind': 'borrows', 'recordId': record['id'], 'memberId': self.member_id, 'reason': 'Checked original library card in person'}
        self.assertEqual(self.client.post('/api/admin/legacy-link', json=request).status_code, 401)
        self.login()
        result = self.client.post('/api/admin/legacy-link', json=request)
        self.assertEqual(result.status_code, 200, result.get_json())
        self.assertEqual(self.client.get('/api/borrows').get_json()[0]['id'], record['id'])
        self.assertEqual(self.client.post('/api/admin/legacy-link', json={**request, 'memberId': self.other_member_id}).status_code, 409)
        with db.get_db() as conn:
            audit = conn.execute('SELECT * FROM identity_audit').fetchall()
        self.assertEqual(len(audit), 1)
        self.assertEqual(audit[0]['member_id'], self.member_id)

    def test_private_photos_are_not_public_or_accessible_through_static_aliases(self):
        room = self.room()
        self.start_room(room)
        result = self.checkout(room['id'])
        self.assertEqual(result.status_code, 200)
        url = result.get_json()['volunteerImage']
        self.assertEqual(server.app.test_client().get(url).status_code, 401)
        self.assertEqual(self.other_client.get(url).status_code, 404)
        photo = self.client.get(url)
        self.assertEqual(photo.status_code, 200)
        self.assertEqual(photo.headers['Cache-Control'], 'no-store')
        photo.close()
        for alias in (url.replace('/volunteer/', '/volunteer/./'), url.replace('/static/', '/static/css/../')):
            self.assertEqual(server.app.test_client().get(alias).status_code, 404)
        admin = server.app.test_client()
        self.assertEqual(admin.post('/api/admin/login', json={'username': 'admin', 'password': 'admin123'}).status_code, 200)
        response = admin.get(url)
        self.assertEqual(response.status_code, 200)
        response.close()

    def test_admin_csrf_origin_and_logout_cookie_replay(self):
        result = self.login()
        cookie = result.headers['Set-Cookie'].split(';', 1)[0]
        token = result.get_json()['csrfToken']
        client = server.app.test_client(use_cookies=False)
        route = '/api/admin/room/slots'
        body = {'openSlots': ['10:00']}
        self.assertEqual(client.put(route, json=body, headers={'Cookie': cookie}).status_code, 403)
        self.assertEqual(client.put(route, json=body, headers={'Cookie': cookie, 'X-CSRF-Token': token, 'Origin': 'https://attacker.invalid'}).status_code, 403)
        self.assertEqual(client.post('/api/admin/logout', json={}, headers={'Cookie': cookie, 'X-CSRF-Token': token}).status_code, 200)
        self.assertEqual(client.get('/api/admin/me', headers={'Cookie': cookie}).status_code, 401)

    def test_login_rate_limit_is_shared_in_database(self):
        with patch.object(identity, 'exchange_code', side_effect=identity.LoginError('Invalid code')):
            for _ in range(10):
                self.assertEqual(server.app.test_client().post('/api/auth/wechat', json={'code': 'wrong'}).status_code, 401)
        self.assertEqual(server.app.test_client().post('/api/auth/wechat', json={'code': 'wrong'}).status_code, 429)

    def test_production_rejects_missing_configuration_and_development_secret(self):
        with patch.dict(os.environ, {'LIBRARY_ENV': 'production', 'SECRET_KEY': ''}):
            with self.assertRaises(RuntimeError):
                configure(Flask('missing-production'))
        env = {'LIBRARY_ENV': 'production', 'SECRET_KEY': 'yuexiang-dev-secret-change-in-production',
               'WECHAT_APP_ID': 'test-app', 'WECHAT_APP_SECRET': 'secret',
               'PUBLIC_BASE_URL': 'https://garden.example.com', 'LIBRARY_DB_PATH': db.DB_PATH, 'LIBRARY_UPLOAD_DIR': server.UPLOAD_DIR}
        with patch.dict(os.environ, env):
            with self.assertRaises(RuntimeError):
                configure(Flask('weak-production'))

    def test_backup_restore_preserves_records_photos_and_invalidates_sessions(self):
        self.borrow()
        room = self.room()
        self.start_room(room)
        self.assertEqual(self.checkout(room['id']).status_code, 200)
        snapshot = backup(db.DB_PATH, server.UPLOAD_DIR, Path(self.temp.name) / 'snapshots')
        self.assertGreaterEqual(len(verify(snapshot)['files']), 2)
        target = Path(self.temp.name) / 'restored'
        restore(snapshot, target)
        import sqlite3
        with closing(sqlite3.connect(target / 'library.db')) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM borrows').fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM room_bookings').fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM auth_sessions').fetchone()[0], 0)
        self.assertEqual(len(list((target / 'uploads').iterdir())), 1)
        with self.assertRaises(ValueError):
            restore(snapshot, target)
        with (snapshot / 'library.db').open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaises(ValueError):
            verify(snapshot)
        self.assertEqual(self.client.get('/api/borrows').status_code, 200)

    def test_backup_rejects_output_inside_uploads_and_manifest_traversal(self):
        with self.assertRaises(ValueError):
            backup(db.DB_PATH, server.UPLOAD_DIR, Path(server.UPLOAD_DIR) / 'backups')
        snapshot = backup(db.DB_PATH, server.UPLOAD_DIR, Path(self.temp.name) / 'snapshots')
        manifest = json.loads((snapshot / 'manifest.json').read_text())
        manifest['files']['../escape'] = 'bad'
        (snapshot / 'manifest.json').write_text(json.dumps(manifest))
        with self.assertRaises(ValueError):
            restore(snapshot, Path(self.temp.name) / 'unsafe-restore')


    def test_complete_production_config_enforces_host_https_cookie_and_key(self):
        from cryptography.fernet import Fernet
        settings = {'LIBRARY_ENV': 'production', 'SECRET_KEY': 'S' * 48, 'WECHAT_APP_ID': 'test-app',
                    'WECHAT_APP_SECRET': 'test-secret', 'PUBLIC_BASE_URL': 'https://garden.example.com',
                    'LIBRARY_DB_PATH': db.DB_PATH, 'LIBRARY_UPLOAD_DIR': server.UPLOAD_DIR,
                    'DOOR_CODE_KEY': Fernet.generate_key().decode(), 'TRUST_PROXY': '0'}
        with patch.dict(os.environ, settings):
            instance = Flask('production-config-test')
            configure(instance)
        instance.add_url_rule('/healthz', endpoint='health', view_func=lambda: {'status': 'ok'})
        instance.add_url_rule('/api/probe', endpoint='probe', view_func=lambda: {'status': 'ok'})
        client = instance.test_client()
        self.assertEqual(client.get('/api/probe').status_code, 400)
        result = client.get('/api/probe', base_url='https://garden.example.com')
        self.assertEqual(result.status_code, 200)
        self.assertIn('no-store', result.headers['Cache-Control'])
        self.assertIn('max-age=', result.headers['Strict-Transport-Security'])
        self.assertTrue(instance.config['SESSION_COOKIE_SECURE'])
        self.assertEqual(client.get('/healthz').status_code, 200)
        settings['DOOR_CODE_KEY'] = 'invalid'
        with patch.dict(os.environ, settings), self.assertRaises(identity.LoginError):
            configure(Flask('invalid-door-key'))

    def test_password_reset_revokes_admin_session(self):
        from scripts.set_admin_password import main
        self.login()
        with patch('scripts.set_admin_password.getpass.getpass', return_value='new-admin-test-password'):
            self.assertEqual(main(['--username', 'admin']), 0)
        self.assertEqual(self.client.get('/api/admin/me').status_code, 401)
        self.assertTrue(db.verify_admin('admin', 'new-admin-test-password'))


    def test_legacy_salvage_explicitly_records_missing_photos_without_changing_records(self):
        record = self.room()
        with db.get_db() as conn:
            conn.execute('UPDATE room_bookings SET volunteer_image = ? WHERE id = ?', ('/static/uploads/volunteer/missing.jpg', record['id']))
        output = Path(self.temp.name) / 'salvage'
        with self.assertRaises(ValueError):
            backup(db.DB_PATH, server.UPLOAD_DIR, output)
        snapshot = backup(db.DB_PATH, server.UPLOAD_DIR, output, allow_missing_photos=True)
        with self.assertRaises(ValueError):
            verify(snapshot)
        manifest = verify(snapshot, allow_missing_photos=True)
        self.assertEqual(manifest['missingPhotos'], ['/static/uploads/volunteer/missing.jpg'])
        target = Path(self.temp.name) / 'salvaged'
        with self.assertRaises(ValueError):
            restore(snapshot, target)
        restore(snapshot, target, allow_missing_photos=True)
        with closing(__import__('sqlite3').connect(target / 'library.db')) as conn:
            self.assertEqual(conn.execute('SELECT volunteer_image FROM room_bookings WHERE id = ?', (record['id'],)).fetchone()[0], '/static/uploads/volunteer/missing.jpg')

if __name__ == '__main__':
    unittest.main()
