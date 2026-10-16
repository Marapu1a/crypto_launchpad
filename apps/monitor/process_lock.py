"""OS-owned exclusive lock, automatically released after a collector crash."""
import os
from contextlib import contextmanager


@contextmanager
def single_writer(directory):
    directory.mkdir(parents=True, exist_ok=True)
    handle = open(directory/'collector.lock', 'a+b')
    try:
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b'0'); handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise RuntimeError('Another collector owns this data directory') from None
    try:
        yield
    finally:
        handle.close()
