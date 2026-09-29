"""sw.js precaches the app shell with cache.addAll, which rejects the whole install on a single 404.
Keep SHELL_ASSETS in lockstep with the files under web/ so offline never misses a module."""

import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


def shell_assets() -> list[str]:
    source = (WEB / "sw.js").read_text(encoding="utf-8")
    block = re.search(r"const SHELL_ASSETS = \[(.*?)\];", source, re.S)
    assert block, "SHELL_ASSETS not found in sw.js"
    return re.findall(r"'([^']+)'", block.group(1))


def test_every_shell_asset_exists():
    missing = [a for a in shell_assets() if a != "/" and not (WEB / a.lstrip("/")).is_file()]
    assert missing == []


def test_every_script_and_stylesheet_is_precached():
    listed = set(shell_assets())
    on_disk = {"/" + p.relative_to(WEB).as_posix() for p in WEB.rglob("*") if p.suffix in (".js", ".css") and p.name != "sw.js"}
    assert sorted(on_disk - listed) == []
