#!/usr/bin/env python3
"""Regenerate po/messages.pot when translatable strings change in JS sources."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
POT_PATH = ROOT_DIR / "po" / "messages.pot"


def collect_js_sources(root: Path) -> list[str]:
    """Return sorted repo-relative JavaScript source paths to scan."""
    files: list[str] = []
    for name in ("extension.js", "prefs.js"):
        candidate = root / name
        if candidate.is_file():
            files.append(name)

    src_dir = root / "src"
    if src_dir.is_dir():
        src_files = sorted(
            p.relative_to(root).as_posix()
            for p in src_dir.rglob("*.js")
            if p.is_file()
        )
        files.extend(src_files)
    return files


def extract_signatures(pot_path: Path) -> set[tuple[str | None, str, str | None]]:
    """Extract canonical (msgctxt, msgid, msgid_plural) tuples from a .pot file."""
    if not pot_path.is_file():
        return set()

    unwrapped = subprocess.check_output(
        ["msgcat", "--no-wrap", str(pot_path)],
        text=True,
    )

    signatures: set[tuple[str | None, str, str | None]] = set()
    fields: dict[str, list[str]] = {}
    current_field: str | None = None

    def flush() -> None:
        nonlocal fields, current_field
        if "msgid" in fields:
            msgctxt = "".join(fields["msgctxt"]) if "msgctxt" in fields else None
            msgid = "".join(fields["msgid"])
            plural = (
                "".join(fields["msgid_plural"])
                if "msgid_plural" in fields
                else None
            )
            if not (msgid == '""' and msgctxt is None):
                signatures.add((msgctxt, msgid, plural))
        fields = {}
        current_field = None

    for line in unwrapped.splitlines():
        if not line.strip():
            flush()
        elif line.startswith("msgctxt "):
            current_field = "msgctxt"
            fields[current_field] = [line[len("msgctxt ") :]]
        elif line.startswith("msgid "):
            current_field = "msgid"
            fields[current_field] = [line[len("msgid ") :]]
        elif line.startswith("msgid_plural "):
            current_field = "msgid_plural"
            fields[current_field] = [line[len("msgid_plural ") :]]
        elif line.startswith('"') and current_field is not None:
            fields[current_field].append(line)
        else:
            current_field = None

    flush()
    return signatures


def generate_pot(root: Path, output_path: Path) -> None:
    """Run xgettext on extension JS files and write a validated .pot template."""
    sources = collect_js_sources(root)
    if not sources:
        raise RuntimeError("No JavaScript source files found to extract.")

    subprocess.run(
        [
            "xgettext",
            "--from-code=UTF-8",
            "--language=JavaScript",
            "--keyword=_",
            "--keyword=N_",
            "--keyword=C_:1c,2",
            "--keyword=NC_:1c,2",
            "--keyword=ngettext:1,2",
            "--keyword=gettext",
            "--keyword=pgettext:1c,2",
            "-o",
            str(output_path),
            *sources,
        ],
        cwd=root,
        check=True,
    )
    subprocess.run(
        ["msgfmt", "-o", os.devnull, str(output_path)],
        check=True,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Always overwrite po/messages.pot even if msgids are unchanged.",
    )
    args = parser.parse_args(argv)

    POT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_pot = Path(tmp_dir) / "messages.pot"
        generate_pot(ROOT_DIR, tmp_pot)

        old_sigs = extract_signatures(POT_PATH)
        new_sigs = extract_signatures(tmp_pot)

        if not args.force and POT_PATH.is_file() and old_sigs == new_sigs:
            print(
                f"No translatable string changes detected ({len(new_sigs)} entries)."
            )
            return 0

        shutil.copyfile(tmp_pot, POT_PATH)
        added = len(new_sigs - old_sigs)
        removed = len(old_sigs - new_sigs)
        print(
            f"Updated {POT_PATH.relative_to(ROOT_DIR)} "
            f"(+{added} / -{removed}, total {len(new_sigs)} entries)."
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())
