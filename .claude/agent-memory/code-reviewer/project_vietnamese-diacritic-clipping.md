---
name: vietnamese-diacritic-clipping
description: BookSnap review check - display-font changes must be verified against stacked Vietnamese diacritics in overflow:hidden / line-clamp boxes with tight line-height
metadata:
  type: project
---

BookSnap UI text is Vietnamese; stacked diacritics (ế ề ấ ầ ắ ố, caps Ế Ấ Ề) rise far above cap/x-height. Any font swap or line-height change on title elements that use `overflow:hidden` / `-webkit-line-clamp` (sleeve title, hero title, mini-player, rec-title, menu-heading) can shave accents on the first line, and tight line-heights (1.05-1.15) let accents hit descenders of the line above.

**Why:** 2026-09-29 Playfair Display swap: glyph tops reach 1.07em (lowercase) / 1.16em (caps), but hhea ascent is 1.082. At line-height 1.1 the clip threshold is ~0.966em, so accents got clipped. Visual checks with accent-free test titles ("BookSnap") missed it.

**How to apply:** For font or line-height reviews, measure with fontTools in a scratchpad venv: fetch the Google Fonts woff2 files for the vietnamese and latin subsets, then compare glyph yMax against `ascent + (L - (ascent + descent))/2`. Ask for visual tests with titles like "Bố Già", "Tiếng Việt", "ẤN TƯỢNG".
