"""Cross-process mutation/backup lock; reads remain available during a snapshot."""
import errno
import os
from pathlib import Path
import time
import db

class StorageLock:
    def __init__(self, database=None):
        self.path = Path(str(database or db.DB_PATH) + '.lock')
        self.handle = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open('a+b')
        try:
            if os.name == 'nt':
                self.handle.seek(0, os.SEEK_END)
                if self.handle.tell() == 0:
                    self.handle.write(b'0')
                    self.handle.flush()
            deadline = time.monotonic() + 10
            while True:
                try:
                    if os.name == 'nt':
                        import msvcrt
                        self.handle.seek(0)
                        msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(self.handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    return self
                except OSError as error:
                    if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                        raise
                    if time.monotonic() >= deadline:
                        raise TimeoutError('Storage maintenance is in progress') from None
                    time.sleep(0.05)
        except BaseException:
            self.handle.close()
            self.handle = None
            raise

    def release(self):
        if self.handle is None:
            return
        try:
            if os.name == 'nt':
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle, fcntl.LOCK_UN)
        finally:
            self.handle.close()
            self.handle = None

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *args):
        self.release()
