---
phase: 2
title: Background music module
status: completed
priority: P2
effort: 2.5h
dependencies: []
---

# Phase 2: Background music module

## Overview
Engine phát nhạc nền (Web Audio), danh sách bài, helper pref thuần có test, và hook Preact để nối vào reader-view.

## Requirements
- Functional:
  - `unlock()`: gọi đồng bộ trong gesture; set `audioSession`, tạo/resume `AudioContext`.
  - `setTrack(id|null)`: đổi bài có fade; `null` → dừng, giải phóng blob.
  - `setVolume(v)`: 0..0.6, áp dụng ngay (ramp 100ms).
  - `setActive(bool)`: đi theo trạng thái TTS, chờ 600ms trước khi fade-out.
  - `destroy()`: dừng, `revokeObjectURL`, `ctx.close()`.
- Non-functional:
  - Không method nào ném lỗi ra ngoài; báo lỗi qua callback `onError(message)`.
  - Track `null` → không fetch, không tạo `AudioContext`.
  - Mỗi file ≤ 200 LOC.

## Architecture

```
web/js/background-music-tracks.js   // data: [{id,label,url,gain,credit}]
web/js/background-music-prefs.js    // pure: readPrefs(storage), writePrefs(storage, prefs), effectiveGain(volume, track)
web/js/background-music.js          // class BackgroundMusic (DOM + Web Audio)
web/js/use-background-music.js      // hook: state {trackId, volume, error}, bind to `playing`
```

Luồng dữ liệu:

```
PlayerSheet chip/slider ──► hook.setTrack/setVolume ──► writePrefs + engine
reader playerState.playing ──► hook effect ──► engine.setActive(playing)
gesture handlers (play/toggle/playFrom/chip) ──► hook.unlock() ──► engine.unlock()
```

Engine state (bên trong):
- `ctx: AudioContext|null`, `gain: GainNode|null`, `el: HTMLAudioElement` (`loop=true`, `preload='auto'`), `source` (tạo 1 lần cho mỗi `el`; `createMediaElementSource` chỉ được gọi 1 lần trên mỗi element).
- `trackId`, `volume`, `active`, `objectUrl`, `loadToken` (tăng mỗi lần `setTrack` → loại kết quả fetch cũ), `abort: AbortController|null`, `pauseTimer`, `stopTimer`.

Fade (dùng chung cho mọi thay đổi gain):
```js
_rampTo(target, seconds) {
  const g = this.gain.gain, now = this.ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(target, now + seconds);
}
```

`setActive(false)`: `clearTimeout(pauseTimer)`; `pauseTimer = setTimeout(() => { rampTo(0, 1); stopTimer = setTimeout(() => el.pause(), 1050) }, 600)`.
`setActive(true)`: xoá cả 2 timer; nếu đã có bài và `ctx` đã unlock → `ctx.resume()` (bắt lỗi), `el.play().catch(onError)`, `rampTo(effectiveGain, 1)`. Nếu blob chưa nạp xong → đánh dấu `active`, phát khi nạp xong.

`setTrack(id)`:
1. `loadToken++`, abort fetch cũ.
2. Nếu đang phát: fade-out 0.4s rồi mới đổi `src`.
3. `null` → `el.pause()`, `removeAttribute('src')`, `el.load()`, revoke blob cũ → return.
4. `fetch(track.url)` (full GET, không Range) → `res.ok` else lỗi → `blob()` → nếu token đã cũ thì bỏ → revoke blob cũ, `el.src = URL.createObjectURL(blob)`; nếu `active` → play + fade-in.
5. Lỗi (network/404/`el.onerror`) → `onError('Không tải được nhạc nền')`, về trạng thái im lặng; TTS không bị ảnh hưởng.

`unlock()` (đồng bộ, không `await` trước `resume()`):
```js
unlock() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.ctx.createMediaElementSource(this.el).connect(this.gain).connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  } catch (err) { this._fail(err); }
}
```
Chỉ gọi `unlock()` khi `trackId != null` (tiêu chí 8).

Không có Web Audio (trình duyệt quá cũ) → fallback: phát `el` trực tiếp với `el.volume` (desktop vẫn chỉnh được; iOS cũ thì chấp nhận to hơn).

Pref: key `booksnap:bgMusic`, JSON `{track: string|null, volume: number}`. `readPrefs` bọc try/catch; JSON hỏng, track không có trong danh sách hoặc volume ngoài khoảng → trả mặc định `{track:null, volume:0.2}` (clamp volume thay vì reset nếu chỉ lệch khoảng). `effectiveGain = clamp(volume,0,0.6) * track.gain`.

## Related Code Files
- Create: `web/js/background-music-tracks.js` (~25 LOC)
- Create: `web/js/background-music-prefs.js` (~40 LOC, không import DOM/Preact)
- Create: `web/js/background-music.js` (~150 LOC)
- Create: `web/js/use-background-music.js` (~50 LOC)
- Create: `tests/web/background-music-prefs.test.mjs`

## Implementation Steps
1. `background-music-tracks.js`: export `AMBIENT_TRACKS` (`rain` "Mưa" gain 1, `piano` "Piano" 1, `fireplace-cafe` "Lò sưởi" 1, `violin` "Violin" 0.6) + `findTrack(id)`. `gain` sẽ chỉnh tiếp ở phase 3 bằng tai nghe.
2. `background-music-prefs.js`: `DEFAULT_PREFS`, `MAX_VOLUME = 0.6`, `readPrefs(storage, tracks)`, `writePrefs(storage, prefs)` (bắt lỗi quota/private mode), `effectiveGain(volume, track)`.
3. Test `node --test`: JSON hỏng; storage ném lỗi; track không tồn tại → null; volume âm / >0.6 / NaN; round-trip; `effectiveGain` với violin.
4. `background-music.js`: class như trên. Bind `el.onerror` → `_fail`. Mọi `play()` đều `.catch`.
5. `use-background-music.js`:
   ```js
   export function useBackgroundMusic(playing, { onError }) {
     const engineRef = useRef(null);
     const [prefs, setPrefs] = useState(() => readPrefs(localStorage, AMBIENT_TRACKS));
     // create on mount, destroy on unmount; apply prefs.track once
     // effect [playing] → engine.setActive(playing)
     // setTrack(id): unlock() (gesture) → engine.setTrack(id) → persist
     // setVolume(v): engine.setVolume(v) → persist
     return { trackId, volume, setTrack, setVolume, unlock };
   }
   ```
   `setTrack` được gọi từ click chip → là gesture → gọi `unlock()` **trước** `setTrack`.
6. Chạy `node --test "tests/web/**/*.test.mjs"`.

## Success Criteria
- [ ] Test helper pass; các test hiện có vẫn pass.
- [ ] Không file nào > 200 LOC.
- [ ] Nhanh `setTrack` A→B→A liên tục: chỉ bài cuối phát, không rò object URL (kiểm bằng log revoke khi dev).
- [ ] `setActive(false)` rồi `true` trong vòng 600ms → không có fade-out.
- [ ] Track `null`: không có request tới `/audio/ambient/`, `ctx` vẫn `null`.

## Risk Assessment
- `createMediaElementSource` gọi 2 lần trên cùng element → `InvalidStateError`. Giảm thiểu: chỉ tạo trong nhánh `!this.ctx`, giữ 1 `el` suốt vòng đời engine.
- Sau khi element nối vào Web Audio, nếu `ctx` bị suspend thì element im tiếng dù vẫn "playing". Giảm thiểu: `setActive(true)` luôn thử `resume()`; kiểm `ctx.state` trên thiết bị ở phase 4.
- Timers chạy sau `destroy()` → phải xoá hết timer, abort fetch trong `destroy()`.
