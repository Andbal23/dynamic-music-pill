#!/usr/bin/env python3
"""Sync po/*.po, compiled locale/*.mo, and README translator credits to main."""

from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from update_translations import replace_translations_section, run_git  # noqa: E402

BOT_NAME = 'github-actions[bot]'
BOT_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com'


def collect_source_files(source_sha: str) -> list[str]:
    """Return po/*.po (excluding messages.pot) and locale/**/*.mo paths from source_sha."""
    raw = subprocess.check_output(
        ['git', 'ls-tree', '-r', '-z', '--name-only', source_sha, '--', 'po', 'locale'],
    )
    paths = [p.decode('utf-8') for p in raw.split(b'\x00') if p]
    return sorted(
        p for p in paths
        if (p.startswith('po/') and p.endswith('.po') and p != 'po/messages.pot')
        or (p.startswith('locale/') and p.endswith('.mo'))
    )


def git_read_blob(rev: str, path: str) -> bytes:
    return subprocess.check_output(['git', 'show', f'{rev}:{path}'])


def apply_translations_to_worktree(
    worktree_dir: pathlib.Path,
    source_sha: str,
    sync_paths: list[str],
    source_readme: str | None,
) -> bool:
    """Copy synced .po/.mo files and README translator section into worktree_dir."""
    sync_set = set(sync_paths)

    for existing_po in (worktree_dir / 'po').glob('*.po'):
        rel = existing_po.relative_to(worktree_dir).as_posix()
        if rel not in sync_set:
            existing_po.unlink()

    locale_dir = worktree_dir / 'locale'
    if locale_dir.is_dir():
        for existing_mo in locale_dir.rglob('*.mo'):
            rel = existing_mo.relative_to(worktree_dir).as_posix()
            if rel not in sync_set:
                existing_mo.unlink()

    for rel in sync_paths:
        dest = worktree_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(git_read_blob(source_sha, rel))

    readme_path = worktree_dir / 'README.md'
    if source_readme is not None and readme_path.is_file():
        updated_readme = replace_translations_section(
            readme_path.read_text(encoding='utf-8'),
            source_readme,
        )
        if updated_readme is not None:
            readme_path.write_text(updated_readme, encoding='utf-8')

    subprocess.run(
        [
            'git', '-C', str(worktree_dir),
            'add', '-A', '--', 'po/*.po', ':(exclude)po/messages.pot', 'locale', 'README.md',
        ],
        check=True,
    )
    diff_check = subprocess.run(
        ['git', '-C', str(worktree_dir), 'diff', '--cached', '--quiet'],
    )
    return diff_check.returncode != 0


def sync_branch(
    remote: str,
    target_branch: str,
    source_ref: str,
    push: bool = True,
) -> bool:
    """Sync translation artifacts from source_ref onto target_branch."""
    source_sha = run_git('rev-parse', source_ref).strip()
    sync_paths = collect_source_files(source_sha)
    if not sync_paths:
        print('No translation files found on source ref; skipping.')
        return False

    source_readme: str | None = None
    readme_check = subprocess.run(
        ['git', 'cat-file', '-e', f'{source_sha}:README.md'],
        capture_output=True,
    )
    if readme_check.returncode == 0:
        source_readme = git_read_blob(source_sha, 'README.md').decode('utf-8')

    tmp_dir = pathlib.Path(tempfile.mkdtemp(prefix='sync-i18n-'))
    worktree_created = False
    try:
        subprocess.run(['git', 'fetch', remote, target_branch], check=True)
        target_sha = run_git('rev-parse', 'FETCH_HEAD').strip()

        subprocess.run(
            ['git', 'worktree', 'add', '--detach', str(tmp_dir), target_sha],
            check=True,
        )
        worktree_created = True

        for attempt in range(2):
            changed = apply_translations_to_worktree(
                tmp_dir, source_sha, sync_paths, source_readme,
            )
            if not changed:
                print(f'{target_branch} translations already in sync with {source_ref}.')
                return False

            subprocess.run(
                [
                    'git', '-C', str(tmp_dir),
                    '-c', f'user.name={BOT_NAME}',
                    '-c', f'user.email={BOT_EMAIL}',
                    'commit', '-m', 'chore(locale): sync translations from gnome50',
                ],
                check=True,
            )
            if not push:
                print(f'Prepared sync commit locally in {tmp_dir} (--no-push).')
                return True

            push_res = subprocess.run(
                ['git', '-C', str(tmp_dir), 'push', remote, f'HEAD:refs/heads/{target_branch}'],
                capture_output=True,
                text=True,
            )
            if push_res.returncode == 0:
                print(f'Synced translations from {source_sha[:7]} to {target_branch}.')
                return True

            if attempt == 0 and ('non-fast-forward' in push_res.stderr or 'fetch first' in push_res.stderr):
                subprocess.run(['git', '-C', str(tmp_dir), 'fetch', remote, target_branch], check=True)
                new_target = subprocess.check_output(
                    ['git', '-C', str(tmp_dir), 'rev-parse', 'FETCH_HEAD'],
                    text=True,
                ).strip()
                subprocess.run(
                    ['git', '-C', str(tmp_dir), 'reset', '--hard', new_target],
                    check=True,
                )
                continue

            sys.stderr.write(push_res.stdout)
            sys.stderr.write(push_res.stderr)
            raise subprocess.CalledProcessError(push_res.returncode, push_res.args)

        return False
    finally:
        if worktree_created:
            subprocess.run(['git', 'worktree', 'remove', '--force', str(tmp_dir)], check=False)
        shutil.rmtree(tmp_dir, ignore_errors=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--remote', default='origin')
    parser.add_argument('--target-branch', default='main')
    parser.add_argument('--source-ref', default='HEAD')
    parser.add_argument('--no-push', action='store_true')
    args = parser.parse_args(argv)

    sync_branch(
        remote=args.remote,
        target_branch=args.target_branch,
        source_ref=args.source_ref,
        push=not args.no_push,
    )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
