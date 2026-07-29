"""Product version source used by the build pipeline."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PACKAGE_JSON = ROOT / "package.json"


def read_package_version() -> str:
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    version = package.get("version")
    if not isinstance(version, str) or not version.strip():
        raise RuntimeError("package.json must contain a version")
    return version.strip()


VERSION = read_package_version()
