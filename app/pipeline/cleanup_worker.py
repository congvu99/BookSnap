"""Periodic housekeeping (D4): expire failed pages' temp images past their TTL, and
sweep orphan files out of DATA_DIR/tmp (uploads whose page row never got created, or
was deleted, before the image could be linked/cleaned up normally)."""

import asyncio
import logging
import time
from datetime import timedelta
from pathlib import Path

from app.app_context import AppContext
from app.db import now_iso

log = logging.getLogger(__name__)

ORPHAN_MIN_AGE_SECONDS = 3600.0


async def cleanup_once(ctx: AppContext) -> None:
    await _expire_failed_images(ctx)
    await _remove_orphan_tmp_files(ctx)


async def _expire_failed_images(ctx: AppContext) -> None:
    cutoff = now_iso(-timedelta(hours=ctx.settings.failed_image_ttl_hours))
    stale = await ctx.pages.list_failed_with_expired_image(cutoff)
    for page in stale:
        if page.image_path:
            await asyncio.to_thread(Path(page.image_path).unlink, True)
        await ctx.pages.clear_image(page.id)
    if stale:
        log.info("cleanup outcome=images_expired count=%d", len(stale))


async def _remove_orphan_tmp_files(ctx: AppContext) -> None:
    tmp_dir = ctx.settings.tmp_dir
    if not tmp_dir.is_dir():
        return
    referenced = {str(Path(p).resolve()) for p in await ctx.pages.all_image_paths()}
    cutoff_ts = time.time() - ORPHAN_MIN_AGE_SECONDS

    def scan_and_delete() -> int:
        removed = 0
        for f in tmp_dir.iterdir():
            if not f.is_file() or str(f.resolve()) in referenced:
                continue
            if f.stat().st_mtime < cutoff_ts:
                f.unlink(missing_ok=True)
                removed += 1
        return removed

    removed = await asyncio.to_thread(scan_and_delete)
    if removed:
        log.info("cleanup outcome=tmp_orphans_removed count=%d", removed)
