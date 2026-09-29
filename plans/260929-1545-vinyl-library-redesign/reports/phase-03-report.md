# Phase 3 report - listen mode

## File changed
- web/js/app.js: parseRoute tach ?query -> route.query; #/listen/:id va #/read/:id cung name 'read' + mode; mot case ReaderView duy nhat (key=bookId).
- web/js/views/reader-view.js (356 -> ~395 dong): prop mode; listen render NowPlayingPanel; read them nut dia (topbar), MiniPlayer nhan book+listenHref; auto-scroll/scroll listener tat khi listen. bookmarkSlot=null la cho gan chip danh dau (phase sau).
- web/js/components/now-playing-panel.js (moi), tonearm.js (moi), web/css/now-playing.css.
- mini-player.js: vo 48px + dia nho xoay khi phat; meta la link -> #/listen/:id; chevron van mo sheet; export formatTime.
- bottom-nav.js: Dang nghe -> #/listen/:id, active cho ca listen/read.
- player-sheet.js: chi them export cho RATES. icons.js: them disc, bookmark. reader.css: style mini-art.

## Xac minh lien tuc audio (agent-browser --session p3, 390x844, port 8013)
Hook HTMLMediaElement.play de bat <audio>; sach seed 4 chunk x 10s.
- read: 3.18s -> bam nut dia -> #/listen 4.61s -> 6.83s (cung element, loadstart them = 0).
- listen -> "Doc cung" -> #/read: 2.22s -> 4.35s van phat; doan hien tai duoc highlight lai.
- history.back giua listen/read: van phat lien tuc (7.22 -> 9.36s), khong pause.
- #/listen/bk1?seq=3 render dung panel.
Screenshot (scratchpad): p3-listen-playing.png, p3-listen-paused.png, p3-listen-dark.png, p3-read-mini.png.
pytest: 124 passed.

## Sai khac / van de mo
- Mini player hep tren 390px: tieu de clamp 2 dong (~70px); giam gap.
- Reduced-motion chi duoc kiem qua CSS, chua chay thu trong trinh duyet.
- Listen mode an banner loi/ngoai tuyen cua reader (app shell van co banner ngoai tuyen).
- reader-view tang ~40 dong (props + branch), khong them logic player.
