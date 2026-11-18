#!/usr/bin/env python3
"""Update README.md translator credits from newly pushed Weblate .po changes."""

from __future__ import annotations

import os
import pathlib
import re
import subprocess
import sys

LANG_NAMES = {
    'ar': 'Arabic',
    'bg': 'Bulgarian',
    'ca': 'Catalan',
    'cs': 'Czech',
    'da': 'Danish',
    'de': 'German',
    'el': 'Greek',
    'es': 'Spanish',
    'et': 'Estonian',
    'fa': 'Persian',
    'fi': 'Finnish',
    'fr': 'French',
    'he': 'Hebrew',
    'hi': 'Hindi',
    'hr': 'Croatian',
    'hu': 'Hungarian',
    'id': 'Indonesian',
    'it': 'Italian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'lt': 'Lithuanian',
    'lv': 'Latvian',
    'ms': 'Malay',
    'nb': 'Norwegian Bokmål',
    'nl': 'Dutch',
    'pl': 'Polish',
    'pt': 'Portuguese',
    'pt_BR': 'Portuguese (Brazil)',
    'ro': 'Romanian',
    'ru': 'Russian',
    'sk': 'Slovak',
    'sl': 'Slovenian',
    'sr': 'Serbian',
    'sv': 'Swedish',
    'ta': 'Tamil',
    'th': 'Thai',
    'tr': 'Turkish',
    'uk': 'Ukrainian',
    'vi': 'Vietnamese',
    'zh_Hans': 'Chinese (Simplified)',
    'zh_Hant': 'Chinese (Traditional)',
}

IGNORED_NAMES = {
    '',
    'full name',
    'automatically generated',
    'hosted weblate',
    'weblate',
    'github-actions[bot]',
    'andbal23',
    'andras laszlo',
    'lászló andrás',
}

IGNORED_EMAILS = {
    'laszlo2002andras@gmail.com',
    '91387090+andbal23@users.noreply.github.com',
    'noreply@weblate.org',
    '41898282+github-actions[bot]@users.noreply.github.com',
}


def run_git(*args: str) -> str:
    res = subprocess.run(
        ['git', *args],
        check=True,
        capture_output=True,
        text=True,
    )
    return res.stdout


def git_obj_exists(sha: str) -> bool:
    if not sha or set(sha) == {'0'}:
        return False
    res = subprocess.run(['git', 'cat-file', '-e', f'{sha}^{{commit}}'], capture_output=True)
    return res.returncode == 0


def parse_po_headers(po_path: pathlib.Path) -> dict[str, str]:
    """Extract unwrapped header key/value pairs from the top msgstr block."""
    text = po_path.read_text(encoding='utf-8')
    match = re.search(r'^msgstr\s+((?:"(?:\\.|[^"])*"\s*)+)', text, re.M)
    if not match:
        return {}
    raw_lines = re.findall(r'"((?:\\.|[^"])*)"', match.group(1))
    unwrapped = ''.join(raw_lines).replace('\\n', '\n')
    headers: dict[str, str] = {}
    for line in unwrapped.splitlines():
        if ':' in line:
            k, v = line.split(':', 1)
            headers[k.strip()] = v.strip()
    return headers


def resolve_language_name(lang_code: str, headers: dict[str, str]) -> str:
    if lang_code in LANG_NAMES:
        return LANG_NAMES[lang_code]
    team = headers.get('Language-Team', '')
    team = re.sub(r'<[^>]*>', '', team).strip()
    if team and team.lower() != 'none':
        return team
    return lang_code


def split_name_email(raw: str) -> tuple[str, str]:
    m = re.match(r'^(.*?)\s*<([^>]*)>\s*$', raw.strip())
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return raw.strip(), ''


def is_ignored_contributor(name: str, email: str) -> bool:
    n_low = name.strip().lower()
    e_low = email.strip().lower()
    if n_low in IGNORED_NAMES or e_low in IGNORED_EMAILS:
        return True
    if 'weblate@' in e_low or 'bot@' in e_low or '[bot]' in n_low:
        return True
    return False


def contributor_already_listed(line_lower: str, name: str, email: str) -> bool:
    if name.lower() in line_lower:
        return True
    gh_noreply = re.match(r'^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$', email.lower())
    if gh_noreply and gh_noreply.group(1) in line_lower:
        return True
    if '@' in email:
        local = email.split('@', 1)[0].lower()
        if local and f'@{local}' in line_lower:
            return True
    return False


def collect_po_contributors(po_files: list[pathlib.Path], before: str, current: str) -> dict[str, list[tuple[str, str]]]:
    """Return mapping of Language Name -> list of (name, email) translators."""
    result: dict[str, list[tuple[str, str]]] = {}
    has_range = git_obj_exists(before) and git_obj_exists(current) and before != current

    for po_path in po_files:
        if not po_path.is_file():
            continue
        headers = parse_po_headers(po_path)
        lang_code = po_path.stem
        lang_name = resolve_language_name(lang_code, headers)
        candidates: list[tuple[str, str]] = []

        if has_range:
            log_out = run_git('log', '--format=%an%x09%ae%n%b', f'{before}..{current}', '--', str(po_path))
            for line in log_out.splitlines():
                if '\t' in line:
                    an, ae = line.split('\t', 1)
                    candidates.append((an.strip(), ae.strip()))
                elif line.lower().startswith('co-authored-by:'):
                    co = line.split(':', 1)[1].strip()
                    candidates.append(split_name_email(co))

        last_tr = headers.get('Last-Translator', '')
        if last_tr:
            candidates.append(split_name_email(last_tr))

        filtered = [(n, e) for (n, e) in candidates if not is_ignored_contributor(n, e)]
        if filtered:
            result.setdefault(lang_name, []).extend(filtered)

    return result


def get_target_po_files(before: str, current: str) -> list[pathlib.Path]:
    if git_obj_exists(before) and git_obj_exists(current) and before != current:
        changed = run_git('diff', '--name-only', before, current, '--', 'po/*.po').splitlines()
        return [pathlib.Path(p) for p in changed if p.strip()]
    return sorted(pathlib.Path('po').glob('*.po'))


def update_readme(readme_path: pathlib.Path, additions: dict[str, list[tuple[str, str]]]) -> bool:
    if not additions or not readme_path.is_file():
        return False

    text = readme_path.read_text(encoding='utf-8')
    section_re = re.compile(
        r'(### Translations .*?</div>\s*\n\n)((?:- \*\*.*?\n)+)(\n---)',
        re.S,
    )
    m = section_re.search(text)
    if not m:
        print('Translations section not found in README.md; skipping.', file=sys.stderr)
        return False

    prefix, list_block, suffix = m.group(1), m.group(2), m.group(3)
    entries: dict[str, str] = {}
    for line in list_block.strip().splitlines():
        lm = re.match(r'^- \*\*([^*]+)\*\*:\s*(.+)$', line.strip())
        if lm:
            entries[lm.group(1).strip()] = lm.group(2).strip()

    changed = False
    for lang_name, people in additions.items():
        current_val = entries.get(lang_name, '')
        for name, email in people:
            if not current_val:
                current_val = name
                changed = True
            elif not contributor_already_listed(current_val.lower(), name, email):
                current_val = f'{current_val}, {name}'
                changed = True
        if current_val:
            entries[lang_name] = current_val

    if not changed:
        return False

    new_lines = [f'- **{lang}**: {entries[lang]}' for lang in sorted(entries, key=str.casefold)]
    new_block = '\n'.join(new_lines) + '\n'
    new_text = text[:m.start()] + prefix + new_block + suffix + text[m.end():]
    readme_path.write_text(new_text, encoding='utf-8')
    return True


def main() -> int:
    before = os.environ.get('BEFORE_SHA', '').strip()
    current = os.environ.get('CURRENT_SHA', '').strip() or 'HEAD'
    po_files = get_target_po_files(before, current)
    additions = collect_po_contributors(po_files, before, current)
    updated = update_readme(pathlib.Path('README.md'), additions)
    print(f'README translator credits updated: {updated}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
