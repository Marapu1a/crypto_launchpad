#!/usr/bin/python3
"""Native offline backup. Errors after stop require reconciliation, never auto-resume."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

UNITS = ['qianqi-public-automation.service', 'qianqi-public-indexer.service']
HELPER_HASH = 'c260d7bbdf71134ccc8606d16940c9d25c978b532e674ad810e4cffe5229d312'


def atomic(file, value):
    tmp = file.with_suffix('.tmp')
    with tmp.open('w') as out:
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.chmod(tmp, 0o644)  # Sanitized metadata only, readable by the existing observer.
    os.replace(tmp, file)
    fd = os.open(file.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def command(*args):
    return subprocess.run(args, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL, text=True, timeout=600).stdout.strip()


class Backup:
    def __init__(self, root=Path('/'), run=command):
        self.root, self.run = root, run
        self.status_dir = root / 'var/lib/qianqi-backup-status'
        self.status_file = self.status_dir / 'status.json'
        self.source = root / 'var/lib/qianqi-public'
        self.config = root / 'etc/qianqi/public'
        self.dest = root / 'var/backups/qianqi-public'
        self.helper = root / 'opt/crypto-launchpad/ops/qianqi/native-backup.cjs'
        self.state = {}

    def record(self, phase, **extra):
        self.state.update(phase=phase, updatedAt=time.time(), **extra)
        atomic(self.status_file, self.state)

    def preflight(self):
        if digest(self.helper) != HELPER_HASH:
            raise ValueError('helper')
        if not self.source.is_dir() or not self.config.is_dir() or not self.dest.is_dir():
            raise ValueError('paths')
        for name in ['automation.json', 'automation.json.scheduler', 'automation.json.rng']:
            json.loads((self.source / name).read_text())
        for name in ['recognition-automation.json', 'recognition-profile.json', 'recognition-index-config.json']:
            json.loads((self.config / name).read_text())
        self.run('node', str(self.root / 'opt/crypto-launchpad/ops/qianqi/check-backup-config.mjs'))
        total = sum(p.stat().st_size for base in [self.source, self.config]
                    for p in base.rglob('*') if p.is_file())
        stat = os.statvfs(self.dest)
        if stat.f_bavail * stat.f_frsize < max(1024**3, total * 4) or stat.f_favail < 1000:
            raise ValueError('capacity')
        probe = self.dest / '.writable-probe'
        with probe.open('x') as out:
            out.write('probe')
            out.flush()
            os.fsync(out.fileno())
        probe.unlink()
        self.releases = []
        for unit in UNITS:
            directory = Path(self.run('systemctl', 'show', unit, '-p', 'WorkingDirectory', '--value')).resolve()
            allowed = [self.root / 'opt/qianqi/releases', self.root / 'opt/crypto-launchpad/releases']
            if not any(base in directory.parents for base in allowed):
                raise ValueError('release path')
            manifest = directory / 'platform-release.json'
            if manifest.exists():
                self.run('node', str(self.root / 'opt/crypto-launchpad/ops/verify-release.mjs'),
                         str(directory), digest(manifest))
            else:
                manifest = directory / 'release.json'
                self.run('node', str(directory / 'scripts/verify-runtime-release.cjs'), str(directory))
            if not manifest.is_file():
                raise ValueError('manifest')
            self.releases.append((directory, manifest))

    def execute(self):
        self.status_dir.mkdir(mode=0o755, parents=True, exist_ok=True)
        os.chmod(self.status_dir, 0o755)
        with (self.root / 'run/lock/qianqi-public-backup.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print('BACKUP_SKIPPED_LOCKED')
                return 0  # Never advances lastSuccess or replaces an in-flight status.
            previous = json.loads(self.status_file.read_text()) if self.status_file.exists() else {}
            if previous.get('stopRequested') and previous.get('phase') != 'success':
                print('BACKUP_BLOCKED_RECONCILIATION_REQUIRED')
                return 1  # Preserve evidence, including an uncatchable kill.
            self.state = {'schema': 'qianqi-backup-status-v1', 'startedAt': time.time(),
                          'lastSuccess': previous.get('lastSuccess'), 'wasActive': [], 'stopRequested': False}
            try:
                self.record('preflight')
                self.preflight()
                active = [u for u in UNITS if self.run('systemctl', 'show', u, '-p', 'ActiveState', '--value') == 'active']
                self.record('stopping', wasActive=active, stopRequested=True)
                self.run('systemctl', 'stop', *UNITS)
                for unit in UNITS:
                    if self.run('systemctl', 'show', unit, '-p', 'MainPID', '--value') != '0':
                        raise ValueError('writer still alive')
                stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
                target = self.dest / stamp
                self.record('helper')
                self.run('node', str(self.helper), 'backup', str(self.source), str(target))
                self.record('copy')
                self.run('cp', '-a', str(self.config), str(target / 'config'))
                self.run('cp', str(self.releases[0][1]), str(target / 'release.json'))
                (target / 'release.sha256').write_text(digest(target / 'release.json') + '  release.json\n')
                (target / 'runtimes').mkdir()
                for unit, (directory, manifest) in zip(UNITS, self.releases):
                    shutil.copyfile(manifest, target / 'runtimes' / (unit + '.release.json'))
                    (target / 'runtimes' / (unit + '.directory.txt')).write_text(str(directory) + '\n')
                self.record('archive')
                tmp = self.dest / (stamp + '.tar.gz.tmp')
                archive = self.dest / (stamp + '.tar.gz')
                self.run('tar', '-czf', str(tmp), '-C', str(self.dest), stamp)
                self.run('tar', '-tzf', str(tmp))
                self.record('checksum')
                sha = digest(tmp)
                with tmp.open('rb') as stream:
                    os.fsync(stream.fileno())
                os.replace(tmp, archive)
                sidecar = self.dest / (stamp + '.sha256')
                with sidecar.open('x') as out:
                    out.write(sha + '  ' + archive.name + '\n')
                    out.flush()
                    os.fsync(out.fileno())
                self.record('resuming', verifiedArchive=archive.name, verifiedSha256=sha)
                for unit in reversed(active):
                    self.run('systemctl', 'start', unit)
                    if self.run('systemctl', 'show', unit, '-p', 'ActiveState', '--value') != 'active':
                        raise ValueError('resume failed')
                self.record('success', lastSuccess={'at': time.time(), 'archive': archive.name, 'sha256': sha})
                print('BACKUP_OK ' + stamp)
                return 0
            except BaseException as error:
                failed_step = self.state.get('phase')
                self.record('failed', failedStep=failed_step, error=type(error).__name__,
                            recoveryRequired=bool(self.state.get('stopRequested')))
                print('BACKUP_FAILED ' + str(failed_step) + '; inspect durable status and recovery runbook')
                return 1


if __name__ == '__main__':
    os.umask(0o077)
    def interrupted(signum, frame):
        raise InterruptedError('signal')
    for sig in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
        signal.signal(sig, interrupted)
    try:
        raise SystemExit(Backup().execute())
    except Exception:
        print('BACKUP_STATUS_UNAVAILABLE; operator attention required')
        raise SystemExit(1)
