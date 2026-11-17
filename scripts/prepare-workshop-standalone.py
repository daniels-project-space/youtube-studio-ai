#!/usr/bin/env python3
"""Complete missing pnpm package targets in Next's standalone output.

Next can copy a pnpm link without tracing its package target. Copy only exact
missing package directories from this checkout's installed lockfile, then
require every output symlink to resolve inside the standalone tree.
"""
import os
from pathlib import Path
import shutil
import sys

root = Path(__file__).resolve().parent.parent
standalone = (root/'.next/standalone').resolve(strict=True)
pnpm = standalone/'node_modules/.pnpm'
source = root/'node_modules/.pnpm'
if sys.argv[1:] != ['--prepare'] or not pnpm.is_dir() or not source.is_dir():
    raise SystemExit('Run with --prepare after building the standalone workshop')

copied = set()
while True:
    missing = []
    for directory, dirs, files in os.walk(standalone, followlinks=False):
        for name in dirs + files:
            path = Path(directory)/name
            if not path.is_symlink(): continue
            target = path.resolve(strict=False)
            if not target.is_relative_to(standalone):
                raise RuntimeError('Standalone symlink escapes the release')
            if not target.exists(): missing.append(target)
    if not missing: break
    progress = False
    for target in missing:
        if target.exists(): continue
        if not target.is_relative_to(pnpm):
            raise RuntimeError('A missing standalone link is outside the pnpm package store')
        package = target.relative_to(pnpm).parts[0]
        destination, original = pnpm/package, source/package
        if destination.exists() or not original.is_dir() or package in copied or len(copied) >= 50:
            raise RuntimeError('Cannot safely complete a missing standalone dependency')
        shutil.copytree(original, destination, symlinks=True)
        copied.add(package)
        progress = True
    if not progress: raise RuntimeError('Standalone dependency completion made no progress')
print(f'Completed {len(copied)} missing package targets; standalone symlinks are contained')
