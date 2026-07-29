#!/usr/bin/env python3
"""Deterministic build entrypoint for Loominary.

Examples:
    python build.py
    python build.py all
    python build.py check
    python build.py userscript
    python build.py userscript chatgpt
    python build.py chatgpt
    python build.py extension
    python build.py extension claude
    python build.py firefox
    python build.py pages
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
SRC_DIR = ROOT / "src"
DIST_DIR = ROOT / "dist"
CHROME_DIR = ROOT / "chrome"
FIREFOX_DIR = ROOT / "firefox"
PACKAGE_JSON = ROOT / "package.json"

if sys.platform == "win32":
    import io

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

CLAUDE_MIRRORS: list[str] = [
    # "https://claude.example.com",
]

PLATFORMS = {
    "claude": {
        "name": "Claude",
        "matches": ["https://claude.ai/*"],
    },
    "chatgpt": {
        "name": "ChatGPT",
        "matches": ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    },
    "grok": {
        "name": "Grok",
        "matches": ["https://grok.com/*"],
        "image_hosts": ["*://*.grok.com/*"],
    },
    "copilot": {
        "name": "Copilot",
        "matches": ["https://copilot.microsoft.com/*"],
        "connect": [
            "copilot.microsoft.com",
            "bing.com",
            "r.bing.com",
            "edgeservices.bing.com",
        ],
    },
    "gemini": {
        "name": "Gemini",
        "matches": ["https://gemini.google.com/*", "https://aistudio.google.com/*"],
        "includes": ["*://gemini.google.com/*", "*://aistudio.google.com/*"],
        "image_hosts": [
            "*://*.googleusercontent.com/*",
            "*://*.googleapis.com/*",
            "*://lh3.google.com/*",
        ],
    },
}

USERSCRIPT_PLATFORMS = ["claude", "chatgpt", "grok", "gemini"]
REQUIRED_SOURCE_FILES = [
    "userscript-adapter.js",
    "extension-adapter.js",
    "common-base.js",
    "markdown-core.js",
    "common-ui.js",
    "claude.js",
    "chatgpt.js",
    "grok.js",
    "gemini.js",
    "copilot.js",
]


class BuildError(RuntimeError):
    """Build failure with a user-facing message."""


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        try:
            label = path.relative_to(ROOT)
        except ValueError:
            label = path
        raise BuildError(f"Missing required file: {label}") from exc


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def read_package() -> dict:
    try:
        return json.loads(read_text(PACKAGE_JSON))
    except json.JSONDecodeError as exc:
        raise BuildError(f"Invalid package.json: {exc}") from exc


def read_package_version() -> str:
    version = str(read_package().get("version", "")).strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise BuildError(
            "package.json version must use three numeric components, for example 26.3.1"
        )
    return version


def npm_executable() -> str:
    candidates = ["npm.cmd", "npm"] if sys.platform == "win32" else ["npm"]
    for candidate in candidates:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    raise BuildError("Cannot find npm in PATH")


def run_command(command: list[str], *, extra_env: dict[str, str] | None = None) -> None:
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    print("  $ " + " ".join(command))
    result = subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=False,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.returncode != 0:
        if result.stderr:
            print(result.stderr.rstrip(), file=sys.stderr)
        raise BuildError(
            f"Command failed with exit code {result.returncode}: {' '.join(command)}"
        )


def selected_platforms(platform: str | None, *, userscript: bool = False) -> list[str]:
    allowed = USERSCRIPT_PLATFORMS if userscript else list(PLATFORMS)
    if platform is None:
        return list(allowed)
    if platform not in allowed:
        raise BuildError(
            f"Unknown platform '{platform}'. Available platforms: {', '.join(allowed)}"
        )
    return [platform]


def apply_mirrors_to_code(code: str, mirrors: Iterable[str]) -> str:
    mirrors = list(mirrors)
    if not mirrors:
        return code
    hostnames = [m.replace("https://", "").replace("http://", "") for m in mirrors]
    extra = " || " + " || ".join(f"host.includes('{host}')" for host in hostnames)
    return code.replace(
        "host.includes('claude.ai')",
        f"(host.includes('claude.ai'){extra})",
    )


@contextmanager
def patched_react_sources(mirrors: Iterable[str]):
    mirrors = list(mirrors)
    originals: dict[Path, str] = {}
    targets = [SRC_DIR / "utils/data/validationUtils.js", SRC_DIR / "App.js"]
    try:
        if mirrors:
            for path in targets:
                if not path.exists():
                    continue
                original = read_text(path)
                originals[path] = original
                patched = original
                for mirror in mirrors:
                    marker = "'https://claude.ai',"
                    insert = f"\n      '{mirror}',"
                    if mirror not in patched and marker in patched:
                        patched = patched.replace(marker, marker + insert, 1)
                write_text(path, patched)
        yield
    finally:
        for path, original in originals.items():
            write_text(path, original)


def strip_platform_code(code: str, targets: list[str] | None) -> str:
    if targets is None:
        return code

    target_set = set(targets)
    result_lines: list[str] = []
    active_stack: list[bool] = []

    for line in code.splitlines():
        stripped = line.strip()
        start = re.match(r"^//\s*#platform:\s*(.+)$", stripped)
        if start:
            block_platforms = {item.strip() for item in start.group(1).split(",")}
            active_stack.append(bool(block_platforms & target_set))
            continue
        if re.match(r"^//\s*#endplatform$", stripped):
            if not active_stack:
                raise BuildError("Unbalanced // #endplatform marker")
            active_stack.pop()
            continue
        if not active_stack or all(active_stack):
            result_lines.append(line)

    if active_stack:
        raise BuildError("Unclosed // #platform marker")

    code = "\n".join(result_lines)

    def replace_inline(match: re.Match[str]) -> str:
        block_platforms = {item.strip() for item in match.group(1).split(",")}
        return match.group(2) if block_platforms & target_set else ""

    code = re.sub(
        r"/\*\s*#platform:\s*([^*]+?)\s*\*/(.*?)/\*\s*#endplatform\s*\*/",
        replace_inline,
        code,
        flags=re.DOTALL,
    )
    code = re.sub(r",(\s*\n\s*[}\]])", r"\1", code)
    return re.sub(r"\n{3,}", "\n\n", code)


def extract_styles_from_ui(ui_code: str) -> str:
    match = re.search(r"GM_addStyle\s*\(\s*`([\s\S]*?)`\s*\)", ui_code)
    if not match:
        return ""
    return "\n".join(line.strip() for line in match.group(1).splitlines() if line.strip())


def userscript_header(platforms: list[str], version: str) -> str:
    match_lines = "\n".join(
        f"// @match        {match}"
        for platform in platforms
        for match in PLATFORMS[platform]["matches"]
    )
    return f"""// ==UserScript==
// @name         Loominary (One-Click AI Chat Backup)
// @name:zh-CN   支持Claude、ChatGPT、Grok、Gemini等多平台的全功能AI对话跨分支全局搜索文档PDF长截图导出管理工具
// @name:zh-TW   Loominary (一鍵 AI 對話備份)
// @name:ja      Loominary (ワンクリック AI チャットバックアップ)
// @name:ko      Loominary (원클릭 AI 채팅 백업)
// @name:es      Loominary (Backup de Chat AI con Un Clic)
// @name:pt      Loominary (Backup de Chat AI com Um Clique)
// @name:fr      Loominary (Sauvegarde de Chat AI en Un Clic)
// @name:de      Loominary (Ein-Klick AI-Chat-Backup)
// @namespace    https://github.com/sgndai/loominary
// @version      {version}
// @description One-click export for Claude, ChatGPT, Grok, Gemini and Google AI Studio. Backups all chat branches, artifacts, and attachments. Exports to JSON/Markdown/PDF/Editable Screenshots.
// @description:zh-CN  一键导出 Claude、ChatGPT、Gemini、Grok 与 Google AI Studio 对话记录，保留完整对话分支、附件、公式、Artifacts 与思考过程。
// @description:zh-TW 一鍵匯出 Claude、ChatGPT、Grok、Gemini 與 Google AI Studio 的對話，保留聊天分支、Artifacts 和附件。
// @description:ja Claude、ChatGPT、Grok、Gemini、Google AI Studio の会話をワンクリックでエクスポートします。
// @description:ko Claude, ChatGPT, Grok, Gemini, Google AI Studio 대화를 한 번에 내보냅니다.
// @description:es Exportación con un clic para Claude, ChatGPT, Grok, Gemini y Google AI Studio.
// @description:pt Exportação com um clique para Claude, ChatGPT, Grok, Gemini e Google AI Studio.
// @description:fr Exportation en un clic pour Claude, ChatGPT, Grok, Gemini et Google AI Studio.
// @description:de Ein-Klick-Export für Claude, ChatGPT, Grok, Gemini und Google AI Studio.
// @author       Laumss; sgndai fork
// @homepage     https://github.com/sgndai/loominary
// @supportURL   https://github.com/sgndai/loominary/issues
{match_lines}
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// ==/UserScript==
"""


def userscript_output_name(platforms: list[str]) -> str:
    if platforms == USERSCRIPT_PLATFORMS:
        return "loominary.user.js"
    return f"loominary-{'-'.join(platforms)}.user.js"


def common_bundle_parts(
    adapter_name: str, platforms: list[str]
) -> tuple[str, str, str, list[str]]:
    adapter = read_text(SRC_DIR / adapter_name)
    common_base = read_text(SRC_DIR / "common-base.js")
    markdown_core = read_text(SRC_DIR / "markdown-core.js")
    common_ui = read_text(SRC_DIR / "common-ui.js")

    strip_targets = platforms if len(platforms) < len(PLATFORMS) else None
    common_base = strip_platform_code(common_base, strip_targets)
    common_ui = strip_platform_code(common_ui, strip_targets)

    if "claude" in platforms:
        common_base = apply_mirrors_to_code(common_base, CLAUDE_MIRRORS)

    platform_code = [read_text(SRC_DIR / f"{platform}.js") for platform in platforms]
    return adapter, common_base, markdown_core, [*platform_code, common_ui]


def fflate_source() -> Path:
    path = ROOT / "node_modules/fflate/umd/index.js"
    if not path.exists():
        raise BuildError("Missing node_modules/fflate/umd/index.js. Run npm ci first.")
    return path


def build_userscript(platform: str | None = None) -> Path:
    version = read_package_version()
    platforms = selected_platforms(platform, userscript=True)
    DIST_DIR.mkdir(exist_ok=True)
    output = DIST_DIR / userscript_output_name(platforms)

    adapter, common_base, markdown_core, remaining = common_bundle_parts(
        "userscript-adapter.js", platforms
    )
    fflate_inline = read_text(fflate_source()).rstrip()

    output_parts = [
        userscript_header(platforms, version),
        "(function() {",
        "    'use strict';",
        "    if (window.loominaryFetchInitialized) return;",
        "    window.loominaryFetchInitialized = true;",
        "",
        "// Inline fflate, sourced from the lockfile-installed dependency.",
        fflate_inline,
        "",
        adapter,
        "",
        common_base,
        "",
        markdown_core,
        "",
        *remaining,
        "",
        "    init();",
        "})();",
        "",
    ]
    write_text(output, "\n".join(output_parts))
    print(f"[Userscript] {output.relative_to(ROOT)} ({output.stat().st_size:,} bytes)")
    return output


def build_react_pages() -> Path:
    print("[Pages] Building React application without deploying it...")
    with patched_react_sources(CLAUDE_MIRRORS):
        run_command(
            [npm_executable(), "run", "build"],
            extra_env={"GENERATE_SOURCEMAP": "false", "CI": "false"},
        )
    build_dir = ROOT / "build"
    if not (build_dir / "index.html").exists():
        raise BuildError("React build completed without build/index.html")
    size = sum(path.stat().st_size for path in build_dir.rglob("*") if path.is_file())
    print(f"[Pages] build/ ready ({size:,} bytes). No deployment was performed.")
    return build_dir


def extension_manifest(platforms: list[str], version: str) -> dict:
    matches: list[str] = []
    host_permissions: list[str] = []
    web_matches: list[str] = []

    for platform in platforms:
        config = PLATFORMS[platform]
        for match in config.get("matches", []):
            if match not in matches:
                matches.append(match)
            if match not in host_permissions:
                host_permissions.append(match)
            scheme, rest = match.split("://", 1)
            host = rest.split("/", 1)[0]
            top_match = f"{scheme}://{host}/*"
            if top_match not in web_matches:
                web_matches.append(top_match)
        for host in config.get("image_hosts", []):
            if host not in host_permissions:
                host_permissions.append(host)

    if "claude" in platforms:
        for mirror in CLAUDE_MIRRORS:
            match = mirror.rstrip("/") + "/*"
            for collection in (matches, host_permissions, web_matches):
                if match not in collection:
                    collection.append(match)

    return {
        "manifest_version": 3,
        "name": "Loominary",
        "version": version,
        "description": "Local-first AI conversation exporter and viewer.",
        "permissions": ["storage", "downloads", "tabs", "sidePanel"],
        "host_permissions": host_permissions,
        "background": {"service_worker": "background.js"},
        "action": {"default_title": "Open Loominary"},
        "side_panel": {"default_path": "app/index.html"},
        "icons": {"128": "icons/icon.png"},
        "content_scripts": [
            {
                "matches": matches,
                "js": ["fflate.min.js", "content.js"],
                "css": ["styles.css"],
                "run_at": "document_start",
            }
        ],
        "web_accessible_resources": [
            {"resources": ["injected.js"], "matches": web_matches}
        ],
    }


def background_script() -> str:
    return r"""'use strict';

async function serializeResponse(response, responseType) {
  if (responseType === 'blob' || responseType === 'arraybuffer') {
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const encoded = btoa(binary);
    if (responseType === 'blob') {
      const type = response.headers.get('content-type') || 'application/octet-stream';
      return `data:${type};base64,${encoded}`;
    }
    return encoded;
  }
  if (responseType === 'json') return response.json();
  return response.text();
}

async function proxyFetch(options = {}) {
  const response = await fetch(options.url, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    credentials: 'include',
  });
  if (!response.ok) {
    return { success: false, status: response.status, error: `HTTP ${response.status}` };
  }
  return {
    success: true,
    status: response.status,
    data: await serializeResponse(response, options.responseType || 'text'),
  };
}

async function openViewer(sender, data) {
  await chrome.storage.local.set({ loominary_pending_data: data });
  const tabId = sender.tab?.id;
  if (tabId && chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.setOptions({ tabId, path: 'app/index.html', enabled: true });
      await chrome.sidePanel.open({ tabId });
      return { success: true, mode: 'side-panel' };
    } catch (error) {
      console.warn('[Loominary] Side panel failed, opening a tab instead:', error);
    }
  }
  const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('app/index.html') });
  return { success: true, mode: 'tab', tabId: tab.id };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LOOMINARY_FETCH') {
    proxyFetch(message.options)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  if (message?.type === 'LOOMINARY_OPEN_SIDEPANEL') {
    openViewer(sender, message.data)
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener(async tab => {
  if (tab.id && chrome.sidePanel?.open) {
    try {
      await chrome.sidePanel.setOptions({ tabId: tab.id, path: 'app/index.html', enabled: true });
      await chrome.sidePanel.open({ tabId: tab.id });
      return;
    } catch (_) {}
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL('app/index.html') });
});
"""


def injected_script() -> str:
    return r"""(() => {
  'use strict';
  if (window.__loominaryInjected) return;
  window.__loominaryInjected = true;

  const emit = (type, payload) => window.postMessage({ type, ...payload }, window.location.origin);
  const inspectUrl = url => {
    const value = String(url || '');
    const match = value.match(/\/api\/organizations\/([a-f0-9-]+)\//i);
    if (match?.[1]) emit('LOOMINARY_USER_ID_CAPTURED', { userId: match[1] });
  };
  const inspectHeaders = headers => {
    try {
      const normalized = new Headers(headers || {});
      const authorization = normalized.get('authorization') || '';
      if (authorization.startsWith('Bearer ')) {
        emit('LOOMINARY_TOKEN_CAPTURED', { token: authorization.slice(7) });
      }
    } catch (_) {}
  };

  const originalFetch = window.fetch;
  window.fetch = function(resource, options = {}) {
    inspectUrl(typeof resource === 'string' ? resource : resource?.url);
    inspectHeaders(options.headers || resource?.headers);
    return originalFetch.apply(this, arguments);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
    inspectUrl(url);
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (String(name).toLowerCase() === 'authorization') {
      inspectHeaders({ authorization: value });
    }
    return originalSetHeader.apply(this, arguments);
  };
})();
"""


def build_extension(platform: str | None = None) -> Path:
    version = read_package_version()
    platforms = selected_platforms(platform)
    print(f"[Extension] Building platforms: {', '.join(platforms)}")

    if CHROME_DIR.exists():
        shutil.rmtree(CHROME_DIR)
    (CHROME_DIR / "icons").mkdir(parents=True)

    adapter, common_base, markdown_core, remaining = common_bundle_parts(
        "extension-adapter.js", platforms
    )
    content = "\n".join(
        [
            "// Loominary content script",
            f"// Version: {version}",
            f"// Built: {datetime.now().isoformat()}",
            "(function() {",
            "    'use strict';",
            "    if (window.loominaryFetchInitialized) return;",
            "    window.loominaryFetchInitialized = true;",
            "    const script = document.createElement('script');",
            "    script.src = chrome.runtime.getURL('injected.js');",
            "    script.onload = function() { this.remove(); };",
            "    (document.head || document.documentElement).appendChild(script);",
            "    window.addEventListener('message', event => {",
            "        if (event.source !== window || event.origin !== window.location.origin) return;",
            "        if (event.data?.type === 'LOOMINARY_USER_ID_CAPTURED') {",
            "            localStorage.setItem('claudeUserId', event.data.userId);",
            "        }",
            "        if (event.data?.type === 'LOOMINARY_TOKEN_CAPTURED') {",
            "            localStorage.setItem('chatGPTToken', event.data.token);",
            "        }",
            "    });",
            adapter,
            common_base,
            markdown_core,
            *remaining,
            "    init();",
            "})();",
            "",
        ]
    )
    write_text(CHROME_DIR / "content.js", content)

    styles = extract_styles_from_ui(read_text(SRC_DIR / "common-ui.js"))
    write_text(CHROME_DIR / "styles.css", f"/* Loominary {version} */\n{styles}\n")
    write_text(CHROME_DIR / "background.js", background_script())
    write_text(CHROME_DIR / "injected.js", injected_script())
    write_text(
        CHROME_DIR / "manifest.json",
        json.dumps(extension_manifest(platforms, version), indent=2, ensure_ascii=False)
        + "\n",
    )
    shutil.copy2(fflate_source(), CHROME_DIR / "fflate.min.js")

    icon_source = ROOT / "public/favicon.png"
    if not icon_source.exists():
        icon_source = ROOT / "public/logo1024.png"
    if not icon_source.exists():
        raise BuildError("Missing public/favicon.png and public/logo1024.png")
    shutil.copy2(icon_source, CHROME_DIR / "icons/icon.png")

    build_dir = build_react_pages()
    shutil.copytree(build_dir, CHROME_DIR / "app")
    print(f"[Extension] {CHROME_DIR.relative_to(ROOT)}/ ready")
    return CHROME_DIR


def build_firefox(platform: str | None = None) -> Path:
    version = read_package_version()
    build_extension(platform)
    if FIREFOX_DIR.exists():
        shutil.rmtree(FIREFOX_DIR)
    shutil.copytree(CHROME_DIR, FIREFOX_DIR)

    manifest_path = FIREFOX_DIR / "manifest.json"
    manifest = json.loads(read_text(manifest_path))
    service_worker = manifest.get("background", {}).get("service_worker")
    if service_worker:
        manifest["background"] = {"scripts": [service_worker]}
    manifest.pop("side_panel", None)
    permissions = manifest.get("permissions", [])
    manifest["permissions"] = [item for item in permissions if item != "sidePanel"]
    manifest["browser_specific_settings"] = {
        "gecko": {"id": "loominary@sgndai", "strict_min_version": "109.0"}
    }
    write_text(manifest_path, json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")

    DIST_DIR.mkdir(exist_ok=True)
    suffix = f"-{platform}" if platform else ""
    zip_path = DIST_DIR / f"loominary-firefox{suffix}-{version}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in FIREFOX_DIR.rglob("*"):
            if path.is_file():
                archive.write(path, path.relative_to(FIREFOX_DIR))
    print(f"[Firefox] {zip_path.relative_to(ROOT)} ({zip_path.stat().st_size:,} bytes)")
    return FIREFOX_DIR


def check_platform_markers(path: Path) -> list[str]:
    errors: list[str] = []
    depth = 0
    for line_number, line in enumerate(read_text(path).splitlines(), start=1):
        if re.match(r"^\s*//\s*#platform:", line):
            depth += 1
        elif re.match(r"^\s*//\s*#endplatform\s*$", line):
            depth -= 1
            if depth < 0:
                errors.append(f"{path.relative_to(ROOT)}:{line_number}: unmatched #endplatform")
                depth = 0
    if depth:
        errors.append(f"{path.relative_to(ROOT)}: {depth} unclosed #platform block(s)")
    return errors


def run_checks() -> None:
    version = read_package_version()
    errors: list[str] = []

    for relative in REQUIRED_SOURCE_FILES:
        path = SRC_DIR / relative
        if not path.exists():
            errors.append(f"Missing source file: src/{relative}")
        else:
            errors.extend(check_platform_markers(path))

    required_root = [
        PACKAGE_JSON,
        ROOT / "src/App.js",
        ROOT / "server/loominary-local-service.mjs",
        ROOT / "tests/archive-loader.test.mjs",
        ROOT / "tests/http-service.test.mjs",
    ]
    for path in required_root:
        if not path.exists():
            errors.append(f"Missing required file: {path.relative_to(ROOT)}")

    if not fflate_source().exists():
        errors.append("Missing node_modules/fflate/umd/index.js; run npm ci")

    package = read_package()
    scripts = package.get("scripts", {})
    forbidden_scripts = [
        name
        for name in ("deploy:pages", "tauri", "tauri:dev", "tauri:build")
        if name in scripts
    ]
    if forbidden_scripts:
        errors.append("Forbidden obsolete scripts: " + ", ".join(forbidden_scripts))

    all_header = userscript_header(USERSCRIPT_PLATFORMS, version)
    chatgpt_header = userscript_header(["chatgpt"], version)
    for forbidden in ("@downloadURL", "@updateURL", "Laumss/loominary/issues"):
        if forbidden in all_header:
            errors.append(f"Generated userscript header still contains {forbidden}")
    if "https://claude.ai/*" in chatgpt_header or "https://grok.com/*" in chatgpt_header:
        errors.append("Single-platform ChatGPT header contains another platform")

    if errors:
        raise BuildError("Static checks failed:\n- " + "\n- ".join(errors))
    print(f"[Check] OK. Product version: {version}")


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build Loominary artifacts")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("all", help="Build extension and userscript")
    subparsers.add_parser("check", help="Run fast static build checks")
    subparsers.add_parser("pages", help="Build the React application without deploying")

    for command, help_text, platforms in (
        ("userscript", "Build userscript", USERSCRIPT_PLATFORMS),
        ("extension", "Build Chrome extension", list(PLATFORMS)),
        ("firefox", "Build Firefox extension", list(PLATFORMS)),
    ):
        subparser = subparsers.add_parser(command, help=help_text)
        subparser.add_argument("platform", nargs="?", choices=platforms)

    return parser


def main() -> int:
    parser = create_parser()
    argv = sys.argv[1:]
    if argv and argv[0] in USERSCRIPT_PLATFORMS:
        argv = ["userscript", argv[0], *argv[1:]]
    args = parser.parse_args(argv)
    command = args.command or "all"

    try:
        if command == "check":
            run_checks()
        elif command == "pages":
            build_react_pages()
        elif command == "userscript":
            build_userscript(args.platform)
        elif command == "extension":
            build_extension(args.platform)
        elif command == "firefox":
            build_firefox(args.platform)
        elif command == "all":
            run_checks()
            build_extension()
            build_userscript()
        else:
            parser.error(f"Unknown command: {command}")
        return 0
    except BuildError as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
