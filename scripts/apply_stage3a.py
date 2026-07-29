from __future__ import annotations

import hashlib
import py_compile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD_FILE = ROOT / 'build.py'
PLATFORM_FILE = ROOT / 'scripts' / 'buildlib' / 'platform.py'
EXPECTED_USERSCRIPT_SHA256 = '164713fd99029c8f9778f8384010b45620c782ac67b4bd77a22054241f4d13c9'

IMPORTS = """from scripts.buildlib.config import (\n    CLAUDE_MIRRORS,\n    PLATFORMS,\n    PLATFORM_DESCRIPTIONS,\n    USERSCRIPT_PLATFORMS,\n)\nfrom scripts.buildlib.platform import apply_mirrors_to_code, strip_platform_code\nfrom scripts.buildlib.version import VERSION\n"""

PLATFORM_SOURCE = r'''"""Platform-specific source filtering helpers."""

import re


def apply_mirrors_to_code(code, mirrors):
    """Inject configured Claude mirror host checks into shared code."""
    if not mirrors:
        return code

    mirror_hostnames = [m.replace('https://', '').replace('http://', '') for m in mirrors]
    extra = ' || ' + ' || '.join(f"host.includes('{h}')" for h in mirror_hostnames)
    return code.replace(
        "host.includes('claude.ai')",
        f"(host.includes('claude.ai'){extra})"
    )


def strip_platform_code(code, target_platforms):
    """Strip source blocks that do not target the requested platforms."""
    if target_platforms is None:
        return code

    target_set = set(target_platforms)
    result_lines = []
    skipping = False
    for line in code.split('\n'):
        stripped = line.strip()
        match_start = re.match(r'^//\s*#platform:\s*(.+)$', stripped)
        if match_start:
            block_platforms = {p.strip() for p in match_start.group(1).split(',')}
            if not block_platforms & target_set:
                skipping = True
            continue

        if re.match(r'^//\s*#endplatform$', stripped):
            skipping = False
            continue

        if not skipping:
            result_lines.append(line)

    code = '\n'.join(result_lines)

    def inline_replacer(match):
        block_platforms = {p.strip() for p in match.group(1).split(',')}
        content = match.group(2)
        if block_platforms & target_set:
            return content
        return ''

    code = re.sub(
        r'/\*\s*#platform:\s*([^*]+?)\s*\*/(.*?)/\*\s*#endplatform\s*\*/',
        inline_replacer,
        code
    )
    code = re.sub(r',(\s*\n\s*[}\]])', r'\1', code)
    return re.sub(r'\n{3,}', '\n\n', code)
'''


def replace_section(text: str, start_marker: str, end_marker: str) -> str:
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    return text[:start] + text[end:]


def apply_refactor() -> None:
    text = BUILD_FILE.read_text(encoding='utf-8')
    if 'from scripts.buildlib.config import (' in text:
        raise RuntimeError('build.py already imports buildlib helpers')

    import_anchor = 'from datetime import datetime\n'
    if import_anchor not in text:
        raise RuntimeError('build.py import anchor not found')
    text = text.replace(import_anchor, import_anchor + '\n' + IMPORTS, 1)

    text = replace_section(text, '# 版本号（统一管理）', 'def patch_react_sources')
    text = replace_section(text, 'def strip_platform_code', 'def read_file')
    text = replace_section(text, 'PLATFORM_DESCRIPTIONS = {', 'def extract_styles_from_ui')

    userscript_marker = "# Userscript 发布的平台\nUSERSCRIPT_PLATFORMS = ['claude', 'chatgpt', 'grok', 'gemini']\n\n"
    if userscript_marker not in text:
        raise RuntimeError('Userscript platform marker not found')
    text = text.replace(userscript_marker, '', 1)

    BUILD_FILE.write_text(text, encoding='utf-8', newline='\n')
    PLATFORM_FILE.write_text(PLATFORM_SOURCE, encoding='utf-8', newline='\n')


def validate() -> None:
    files = [
        BUILD_FILE,
        ROOT / 'scripts' / 'buildlib' / 'config.py',
        PLATFORM_FILE,
        ROOT / 'scripts' / 'buildlib' / 'version.py',
    ]
    for file in files:
        py_compile.compile(str(file), doraise=True)

    subprocess.run([sys.executable, 'build.py', 'userscript'], cwd=ROOT, check=True)
    output = ROOT / 'dist' / 'loominary.user.js'
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    if digest != EXPECTED_USERSCRIPT_SHA256:
        raise RuntimeError(
            f'Userscript hash changed: expected {EXPECTED_USERSCRIPT_SHA256}, got {digest}'
        )
    print(f'[OK] Userscript SHA-256 unchanged: {digest}')


if __name__ == '__main__':
    apply_refactor()
    validate()
