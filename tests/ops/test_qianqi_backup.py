"""Linux isolated filesystem, mocked systemd only; no production paths or credentials."""
import contextlib
import fcntl
import importlib.util
import io
import json
import multiprocessing
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('backup', REPO / 'ops/qianqi/backup.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class Fixture:
    def __init__(self, root, fail=None):
        self.root, self.fail = root, fail
        self.calls = []
        self.active = {u: 'active' for u in mod.UNITS}
        self.backup = mod.Backup(root, self.run)
        for p in [self.backup.source, self.backup.config, self.backup.dest,
                  self.backup.helper.parent, root / 'run/lock']:
            p.mkdir(parents=True, exist_ok=True)
        for n in ['automation.json', 'automation.json.scheduler', 'automation.json.rng']:
            (self.backup.source / n).write_text('{"preserved":"native state"}')
        for n in ['recognition-automation.json', 'recognition-profile.json', 'recognition-index-config.json']:
            (self.backup.config / n).write_text('{}')
        shutil.copyfile(REPO / 'ops/qianqi/native-backup.cjs', self.backup.helper)
        # Normalize checkout CRLF to the pinned original Linux helper bytes.
        self.backup.helper.write_bytes(self.backup.helper.read_bytes().replace(b'\r\n', b'\n'))
        self.release = root / 'opt/crypto-launchpad/releases/fixture'
        self.release.mkdir(parents=True)
        (self.release / 'platform-release.json').write_text('{}')

    def run(self, *args):
        self.calls.append(args)
        phase = self.backup.state.get('phase')
        if self.fail == phase:
            raise OSError('injected failure')
        if args[0] == 'systemctl':
            if args[1] == 'show':
                if args[4] == 'WorkingDirectory':
                    return str(self.release)
                if args[4] == 'ActiveState':
                    return self.active[args[2]]
                return '0'
            for unit in args[2:]:
                self.active[unit] = 'active' if args[1] == 'start' else 'inactive'
            return ''
        if args[0] == 'node' and ('verify-release' in args[1] or 'check-backup-config' in args[1]):
            return 'fixture verification'
        return mod.command(*args)

    def execute(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = self.backup.execute()
        return result, output.getvalue()


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='qianqi-backup-test-')
        self.f = Fixture(Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def state(self):
        return json.loads(self.f.backup.status_file.read_text())

    def test_success_real_helper_archive_and_original_activity(self):
        self.f.active[mod.UNITS[0]] = 'inactive'
        result, output = self.f.execute()
        self.assertEqual(result, 0)
        self.assertIn('BACKUP_OK', output)
        self.assertEqual(self.f.active[mod.UNITS[0]], 'inactive')
        self.assertEqual(self.f.active[mod.UNITS[1]], 'active')
        s = self.state()
        archive = self.f.backup.dest / s['lastSuccess']['archive']
        self.assertEqual(mod.digest(archive), s['lastSuccess']['sha256'])
        unpack = Path(self.tmp.name) / 'unpack'
        unpack.mkdir()
        mod.command('tar', '-xzf', str(archive), '-C', str(unpack))
        saved = next(unpack.iterdir())
        target = Path(self.tmp.name) / 'restored'
        mod.command('node', str(self.f.backup.helper), 'restore', str(saved), str(target))
        self.assertEqual((target / 'automation.json').read_bytes(), (self.f.backup.source / 'automation.json').read_bytes())

    def test_failures_after_stop_preserve_state_and_block_repeat(self):
        for stage in ['helper', 'copy', 'archive', 'checksum', 'resuming']:
            with self.subTest(stage=stage), tempfile.TemporaryDirectory() as root:
                f = Fixture(Path(root), stage)
                original = {p.name: p.read_bytes() for p in f.backup.source.iterdir()}
                # checksum has no external command, inject its digest read instead.
                original_digest = mod.digest
                def digest(p):
                    if stage == 'checksum' and p.name.endswith('.tar.gz.tmp'):
                        raise OSError('ENOSPC')
                    return original_digest(p)
                with patch.object(mod, 'digest', digest):
                    result, output = f.execute()
                self.assertEqual(result, 1)
                self.assertNotIn('BACKUP_OK', output)
                state = json.loads(f.backup.status_file.read_text())
                self.assertEqual(state['phase'], 'failed')
                self.assertTrue(state['recoveryRequired'])
                self.assertIsNone(state['lastSuccess'])
                self.assertEqual(state['wasActive'], mod.UNITS)
                self.assertTrue(all(x == 'inactive' for x in f.active.values()))
                self.assertEqual(original, {p.name:p.read_bytes() for p in f.backup.source.iterdir()})
                count = len(f.calls)
                self.assertEqual(f.execute()[0], 1)
                self.assertEqual(count, len(f.calls))
                self.assertEqual(state, json.loads(f.backup.status_file.read_text()))

    def test_preflight_capacity_and_helper_failure_do_not_stop(self):
        class Full:
            f_bavail = 0
            f_frsize = 4096
            f_favail = 0
        with patch.object(mod.os, 'statvfs', return_value=Full()):
            self.assertEqual(self.f.execute()[0], 1)
        self.assertFalse(self.state()['stopRequested'])
        self.assertTrue(all(x == 'active' for x in self.f.active.values()))
        self.f.backup.helper.write_text('corrupt')
        self.assertEqual(self.f.execute()[0], 1)
        self.assertFalse(any(c[:2] == ('systemctl','stop') for c in self.f.calls))

    def test_lock_skip_does_not_invent_success(self):
        lock_path = self.f.root / 'run/lock/qianqi-public-backup.lock'
        with lock_path.open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result, output = self.f.execute()
            self.assertEqual(result, 0)
            self.assertIn('SKIPPED_LOCKED', output)
            self.assertFalse(self.f.backup.status_file.exists())
            self.assertEqual(self.f.calls, [])

    def test_partial_resume_preserves_failure_and_previous_success(self):
        self.f.backup.status_dir.mkdir()
        previous = {'at': 123, 'archive': 'previous.tar.gz', 'sha256': 'a' * 64}
        mod.atomic(self.f.backup.status_file, {'phase': 'success', 'lastSuccess': previous})
        run = self.f.run
        def partial(*args):
            if args == ('systemctl', 'start', mod.UNITS[0]):
                raise OSError('executor start refused')
            return run(*args)
        self.f.backup.run = partial
        self.assertEqual(self.f.execute()[0], 1)
        self.assertEqual(self.f.active[mod.UNITS[1]], 'active')
        self.assertEqual(self.f.active[mod.UNITS[0]], 'inactive')
        self.assertEqual(self.state()['lastSuccess'], previous)
        self.assertEqual(self.state()['failedStep'], 'resuming')

    def test_sigterm_and_sigkill_keep_recoverable_evidence(self):
        for sig in [signal.SIGTERM, signal.SIGKILL]:
            with self.subTest(signal=sig), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                f = Fixture(root)
                ready = multiprocessing.Event()
                def child():
                    def interrupted(signum, frame):
                        raise InterruptedError()
                    signal.signal(signal.SIGTERM, interrupted)
                    run = f.run
                    def paused(*args):
                        if f.backup.state.get('phase') == 'helper':
                            ready.set()
                            time.sleep(30)
                        return run(*args)
                    f.backup.run = paused
                    f.execute()
                process = multiprocessing.get_context('fork').Process(target=child)
                process.start()
                self.assertTrue(ready.wait(10))
                os.kill(process.pid, sig)
                process.join(5)
                self.assertFalse(process.is_alive())
                state = json.loads(f.backup.status_file.read_text())
                self.assertEqual(state['phase'], 'failed' if sig == signal.SIGTERM else 'helper')
                self.assertTrue(state['stopRequested'])
                self.assertEqual(f.execute()[0], 1)
                self.assertEqual(f.calls, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
