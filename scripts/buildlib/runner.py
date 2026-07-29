"""Runtime helpers used by build.py."""

import subprocess
from pathlib import Path


def run_legacy_shell(command):
    return subprocess.run(command, cwd=Path('.'), check=True, capture_output=True, text=True, encoding='utf-8', shell=True)
