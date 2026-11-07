"""Authorization, encryption and time boundaries with disposable data only."""
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from cryptography.fernet import Fernet
import test_miniprogram_api as base
import db
import app as server
import room_access
from scripts.backup_restore import backup, restore
from pathlib import Path

class RoomAccessTests(unittest.TestCase):
    phone = base.MiniProgramApiTests.phone
    other_phone = base.MiniProgramApiTests.other_phone
    login = base.MiniProgramApiTests.login
    room_data = base.MiniProgramApiTests.room_data
    room = base.MiniProgramApiTests.room

    def setUp(self):
        base.MiniProgramApiTests.setUp(self)
        env = patch.dict(os.environ, {'DOOR_CODE_KEY': Fernet.generate_key().decode()})
        env.start()
        self.addCleanup(env.stop)
        self.record = self.room()
        self.path = '/api/room/bookings/' + self.record['id'] + '/access'
        self.admin_path = '/api/admin/room/bookings/' + self.record['id'] + '/access'

    def save(self, value='827361#'):
        self.login()
        result = self.client.put(self.admin_path, json={'password': value})
        self.assertEqual(result.status_code, 200, result.get_json())
        return result

    def test_only_admin_can_set_and_only_owner_can_read_immediately(self):
        self.assertEqual(self.client.put(self.admin_path, json={'password': '123456'}).status_code, 401)
        self.assertFalse(self.client.get(self.path).get_json()['available'])
        self.save()
        result = self.client.get(self.path)
        self.assertEqual(result.get_json()['password'], '827361#')
        self.assertIn('no-store', result.headers['Cache-Control'])
        self.assertEqual(self.other_client.get(self.path + '?phone=' + self.phone).status_code, 404)
        self.assertEqual(server.app.test_client().get(self.path).status_code, 401)
        admin_only = server.app.test_client()
        admin_only.post('/api/admin/login', json={'username': 'admin', 'password': 'admin123'})
        self.assertEqual(admin_only.get(self.path).status_code, 401)
        self.assertNotIn('password', self.client.get(self.admin_path).get_json())

    def test_end_time_is_exclusive_and_uses_shanghai_timezone(self):
        self.save()
        end = datetime.fromisoformat(self.client.get(self.path).get_json()['expiresAt'])
        self.assertEqual(end.utcoffset(), timedelta(hours=8))
        with patch.object(room_access, 'now', return_value=end - timedelta(microseconds=1)):
            self.assertTrue(self.client.get(self.path).get_json()['available'])
        for current in (end, end + timedelta(days=1)):
            with patch.object(room_access, 'now', return_value=current):
                result = self.client.get(self.path).get_json()
                self.assertFalse(result['available'])
                self.assertNotIn('password', result)
                self.assertEqual(self.client.put(self.admin_path, json={'password': '234567'}).status_code, 409)

    def test_cancelled_or_checked_out_never_exposes_password(self):
        self.save()
        for status in ('cancelled', 'checked_out'):
            with db.get_db() as conn:
                conn.execute('UPDATE room_bookings SET status = ? WHERE id = ?', (status, self.record['id']))
            result = self.client.get(self.path).get_json()
            self.assertFalse(result['available'])
            self.assertNotIn('password', result)
            self.assertEqual(self.client.put(self.admin_path, json={'password': '234567'}).status_code, 409)

    def test_encrypted_storage_no_bulk_exposure_and_audit_without_secret(self):
        secret = '927364#*'
        self.save(secret)
        with db.get_db() as conn:
            ciphertext = conn.execute('SELECT ciphertext FROM room_access_codes').fetchone()[0]
            audit = [dict(row) for row in conn.execute('SELECT * FROM room_access_audit')]
        self.assertNotIn(secret, ciphertext)
        self.assertNotIn(secret, str(audit))
        self.assertEqual(audit[0]['action'], 'set')
        self.assertNotIn(secret.encode(), Path(db.DB_PATH).read_bytes())
        for path in ('/api/room/calendar', '/api/room/bookings', '/api/admin/room/bookings', '/api/admin/room/calendar'):
            result = self.client.get(path)
            self.assertNotIn(secret, result.get_data(as_text=True))
            self.assertNotIn(ciphertext, result.get_data(as_text=True))

    def test_update_remove_csrf_and_input_validation(self):
        self.save()
        for value in (None, 123456, '123', 'A' * 33, '<script>', '1234\n', '密钥1234'):
            self.assertEqual(self.client.put(self.admin_path, json={'password': value}).status_code, 400)
        result = self.client.put(self.admin_path, json={'password': 'ABCDEFG#'}, headers={'X-CSRF-Token': 'wrong'})
        self.assertEqual(result.status_code, 403)
        self.assertEqual(self.client.put(self.admin_path, json={'password': 'ABCDEFG#'}).status_code, 200)
        self.assertEqual(self.client.get(self.path).get_json()['password'], 'ABCDEFG#')
        self.assertEqual(self.client.delete(self.admin_path, json={}).status_code, 200)
        self.assertFalse(self.client.get(self.path).get_json()['available'])
        self.assertEqual(self.client.get('/api/admin/room/bookings/unknown/access').status_code, 404)

    def test_missing_wrong_key_and_ciphertext_swapping_fail_closed(self):
        self.save()
        with patch.dict(os.environ, {'DOOR_CODE_KEY': ''}):
            self.assertEqual(self.client.get(self.path).status_code, 503)
            self.assertEqual(self.client.put(self.admin_path, json={'password': '456789'}).status_code, 503)
        with patch.dict(os.environ, {'DOOR_CODE_KEY': Fernet.generate_key().decode()}):
            self.assertEqual(self.client.get(self.path).status_code, 503)
        with db.get_db() as conn:
            wrong = room_access.cipher().encrypt(b'other-booking\n123456').decode()
            conn.execute('UPDATE room_access_codes SET ciphertext = ?', (wrong,))
        self.assertEqual(self.client.get(self.path).status_code, 503)

    def test_backup_restore_preserves_encrypted_codes(self):
        self.save()
        snapshot = backup(db.DB_PATH, server.UPLOAD_DIR, Path(self.temp.name) / 'snapshots')
        target = Path(self.temp.name) / 'restored'
        restore(snapshot, target)
        with patch.object(db, 'DB_PATH', str(target / 'library.db')):
            self.assertEqual(room_access.resident_code(self.record['id'], self.member_id)['password'], '827361#')

if __name__ == '__main__':
    unittest.main()
