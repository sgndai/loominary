"""Platform-specific source filtering helpers."""

import re


def apply_mirrors_to_code(code, mirrors):
    if not mirrors:
        return code
    hosts = [m.replace('https://', '').replace('http://', '') for m in mirrors]
    extra = ' || ' + ' || '.join(f"host.includes('{h}')" for h in hosts)
    return code.replace("host.includes('claude.ai')", f"(host.includes('claude.ai'){extra})")


def strip_platform_code(code, target_platforms):
    if target_platforms is None:
        return code
    targets = set(target_platforms)
    lines = []
    skipping = False
    for line in code.split('\n'):
        start = re.match(r'^//\s*#platform:\s*(.+)$', line.strip())
        if start:
            skipping = not bool(set(x.strip() for x in start.group(1).split(',')) & targets)
            continue
        if re.match(r'^//\s*#endplatform$', line.strip()):
            skipping = False
            continue
        if not skipping:
            lines.append(line)
    return '\n'.join(lines)
