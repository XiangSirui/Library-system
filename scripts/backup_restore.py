"""Consistent SQLite + private photo snapshots and non-destructive restore.
Backups contain personal data. Keep output outside the web root and copy offsite.
"""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from storage_lock import StorageLock

def checksum(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()

def database_check(path, uploads, allow_missing_photos=False):
    missing = []
    with closing(sqlite3.connect(path)) as conn:
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Database integrity check failed')
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'books', 'borrows', 'room_bookings'}.issubset(tables):
            raise ValueError('Not a library database')
        for (image,) in conn.execute("SELECT volunteer_image FROM room_bookings WHERE volunteer_image IS NOT NULL AND volunteer_image != ''"):
            name = PurePosixPath(image).name
            if image != '/static/uploads/volunteer/' + name or not (uploads / name).is_file():
                missing.append(image)
        if missing and not allow_missing_photos:
            raise ValueError('A referenced volunteer photo is missing; resolve legacy data or explicitly archive with --allow-missing-photos')
    return sorted(set(missing))

def verify(snapshot, allow_missing_photos=False):
    snapshot = Path(snapshot).resolve()
    if any(p.is_symlink() for p in snapshot.rglob('*')):
        raise ValueError('Snapshot cannot contain symbolic links')
    manifest = json.loads((snapshot / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != 1 or not isinstance(manifest.get('files'), dict):
        raise ValueError('Invalid snapshot manifest')
    expected = manifest['files']
    if 'library.db' not in expected:
        raise ValueError('Snapshot has no database')
    for name, expected_hash in expected.items():
        relative = PurePosixPath(name)
        if ':' in name or relative.is_absolute() or '..' in relative.parts or '\\' in name or (name != 'library.db' and not name.startswith('uploads/')):
            raise ValueError('Invalid snapshot path')
        path = snapshot.joinpath(*relative.parts)
        if not path.is_file() or checksum(path) != expected_hash:
            raise ValueError('Snapshot file missing or checksum mismatch: ' + name)
    actual = {p.relative_to(snapshot).as_posix() for p in snapshot.rglob('*') if p.is_file() and p.relative_to(snapshot).as_posix() != 'manifest.json'}
    if actual != set(expected):
        raise ValueError('Snapshot contains unexpected files')
    missing = database_check(snapshot / 'library.db', snapshot / 'uploads', allow_missing_photos)
    if missing != manifest.get('missingPhotos', []):
        raise ValueError('Missing photo inventory does not match snapshot')
    return manifest

def backup(database, uploads, output, allow_missing_photos=False):
    database, uploads, output = Path(database).resolve(), Path(uploads).resolve(), Path(output).resolve()
    if not database.is_file() or not uploads.is_dir():
        raise ValueError('Database and upload directory must already exist')
    if output == uploads or uploads in output.parents:
        raise ValueError('Backups cannot be stored inside uploads')
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    staging = output / ('.partial-' + name)
    staging.mkdir(mode=0o700)
    try:
        with StorageLock(database):
            if any(p.is_symlink() for p in uploads.rglob('*')):
                raise ValueError('Upload directory cannot contain symbolic links')
            with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as source:
                with closing(sqlite3.connect(staging / 'library.db')) as target:
                    source.backup(target)
            shutil.copytree(uploads, staging / 'uploads')
        files = {p.relative_to(staging).as_posix(): checksum(p) for p in staging.rglob('*') if p.is_file()}
        missing = database_check(staging / 'library.db', staging / 'uploads', allow_missing_photos)
        manifest = {'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(), 'files': files, 'missingPhotos': missing}
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        verify(staging, allow_missing_photos)
        destination = output / name
        staging.rename(destination)
        return destination
    except BaseException:
        if staging.resolve().parent != output:
            raise RuntimeError('Unsafe staging cleanup path')
        shutil.rmtree(staging)
        raise

def restore(snapshot, target, allow_missing_photos=False):
    snapshot, target = Path(snapshot).resolve(), Path(target).resolve()
    verify(snapshot, allow_missing_photos)
    if target.exists():
        raise ValueError('Restore target already exists; restore to a new directory, never overwrite live data')
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = target.parent / ('.restore-' + uuid.uuid4().hex)
    staging.mkdir(mode=0o700)
    try:
        shutil.copy2(snapshot / 'library.db', staging / 'library.db')
        shutil.copytree(snapshot / 'uploads', staging / 'uploads')
        with closing(sqlite3.connect(staging / 'library.db')) as conn:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ('auth_sessions', 'auth_rate_limits'):
                if table in tables:
                    conn.execute('DELETE FROM ' + table)
            conn.commit()
        database_check(staging / 'library.db', staging / 'uploads', allow_missing_photos)
        staging.rename(target)
        return target
    except BaseException:
        if staging.resolve().parent != target.parent:
            raise RuntimeError('Unsafe restore cleanup path')
        shutil.rmtree(staging)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    b = sub.add_parser('backup')
    b.add_argument('--database', default=os.environ.get('LIBRARY_DB_PATH'))
    b.add_argument('--uploads', default=os.environ.get('LIBRARY_UPLOAD_DIR'))
    b.add_argument('--output', required=True)
    v = sub.add_parser('verify'); v.add_argument('snapshot')
    r = sub.add_parser('restore'); r.add_argument('--snapshot', required=True); r.add_argument('--target', required=True)
    for operation in (b, v, r):
        operation.add_argument('--allow-missing-photos', action='store_true', help='Explicit legacy salvage only: record known missing photo references without fabricating files')
    args = parser.parse_args()
    if args.allow_missing_photos:
        print('WARNING: legacy salvage mode; missing photos stay missing and are listed in the manifest.', file=sys.stderr)
    if args.command == 'backup':
        if not args.database or not args.uploads:
            parser.error('Provide --database and --uploads or their environment variables')
        print('Snapshot created: ' + str(backup(args.database, args.uploads, args.output, args.allow_missing_photos)))
    elif args.command == 'verify':
        manifest = verify(args.snapshot, args.allow_missing_photos)
        print('Verified snapshot: ' + str(len(manifest['files'])) + ' files')
    else:
        print('Restored into new directory: ' + str(restore(args.snapshot, args.target, args.allow_missing_photos)))

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, sqlite3.Error) as error:
        print('Backup/restore failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
