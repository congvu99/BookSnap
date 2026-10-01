"""Print the static ES-module import graph reachable from web/js/app.js as <link rel="modulepreload"> tags.

Usage: python scripts/list-static-imports.py          print the tags
       python scripts/list-static-imports.py --write  rewrite the modulepreload block in web/index.html
Dynamic import() calls are intentionally excluded: they are not on the first-paint path.
"""

import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"
ENTRY = "/js/app.js"
# `import x from '..'`, `import '..'`, `export {..} from '..'` -- static specifiers only.
STATIC_IMPORT = re.compile(r"""(?:^|[;\n])\s*(?:import|export)\s*(?:[^'";]*?\s*from\s*)?['"]([^'"]+)['"]""")


def static_import_graph(entry: str = ENTRY, web: Path = WEB) -> list[str]:
    seen: list[str] = []
    stack = [entry]
    while stack:
        url = stack.pop()
        if url in seen:
            continue
        seen.append(url)
        source = (web / url.lstrip("/")).read_text(encoding="utf-8")
        for spec in STATIC_IMPORT.findall(source):
            if not spec.startswith("."):
                continue
            base = Path(url).parent
            resolved = Path(*base.parts, *spec.split("/"))
            parts: list[str] = []
            for part in resolved.as_posix().split("/"):
                if part == "..":
                    parts.pop()
                elif part not in (".", ""):
                    parts.append(part)
            stack.append("/" + "/".join(parts))
    return sorted(seen)


def render_links() -> str:
    return "".join(f'<link rel="modulepreload" href="{u}" />\n' for u in static_import_graph())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--write" in sys.argv:
        index = WEB / "index.html"
        text = index.read_bytes().decode("utf-8")
        eol = "\r\n" if "\r\n" in text else "\n"
        text = text.replace("\r\n", "\n")
        pattern = r'(?:<link rel="modulepreload" href="[^"]+" />\n)+'
        text = re.sub(pattern, lambda _: render_links(), text, count=1)
        index.write_text(text.replace("\n", eol), encoding="utf-8", newline="")
    else:
        print(render_links(), end="")
