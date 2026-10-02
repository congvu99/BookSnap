"""sw.js precaches the app shell with cache.addAll, which rejects the whole install on a single 404.
Keep SHELL_ASSETS in lockstep with the files under web/ so offline never misses a module."""

import importlib.util
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"


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


def _preload_hrefs() -> list[str]:
    html = (WEB / "index.html").read_text(encoding="utf-8")
    return re.findall(r'<link rel="modulepreload" href="([^"]+)"', html)


def test_modulepreload_hrefs_exist_and_are_precached():
    hrefs = _preload_hrefs()
    assert hrefs, "index.html has no modulepreload links"
    assert [h for h in hrefs if not (WEB / h.lstrip("/")).is_file()] == []
    assert sorted(set(hrefs) - set(shell_assets())) == []


def test_modulepreload_covers_static_import_graph_of_app_js():
    """Regenerate with scripts/list-static-imports.py when this fails."""
    spec = importlib.util.spec_from_file_location("list_static_imports", SCRIPTS / "list-static-imports.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    expected = set(module.static_import_graph())
    assert sorted(expected - set(_preload_hrefs())) == []
    assert sorted(set(_preload_hrefs()) - expected) == []


def test_app_version_matches_the_service_worker_shell_cache():
    import re
    from pathlib import Path

    web = Path(__file__).resolve().parent.parent / "web"
    shell = re.search(r"booksnap-shell-v(\d+)", (web / "sw.js").read_text(encoding="utf-8")).group(1)
    version = re.search(r"APP_VERSION = (\d+)", (web / "js" / "app-version.js").read_text(encoding="utf-8")).group(1)
    assert shell == version, "bump web/js/app-version.js together with SHELL_CACHE in web/sw.js"
