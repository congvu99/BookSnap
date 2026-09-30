"""Normalise background-music sources into web/audio/ambient/<id>.mp3.

Sources (downloaded by hand, see web/audio/ambient/CREDITS.md) go in scripts/ambient-source/
(gitignored). Each output is trimmed, loudness-normalised to -18 LUFS / -1 dBFS peak and encoded as
MP3 128 kbps 44.1 kHz stereo, so one volume slider works across tracks. Gain is one linear
`volume` step (plus a peak limiter), never loudnorm's time-varying gain, so the level at the end of
a loop matches its start. Ambient loops are made seamless by crossfading their tail into their
head; music pieces get a short fade in/out instead.

Usage:  .venv\\Scripts\\python scripts\\prepare_ambient_audio.py [track-id ...]
Needs ffmpeg on PATH (`winget install Gyan.FFmpeg`) or the `imageio-ffmpeg` package.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIR = ROOT / "scripts" / "ambient-source"
OUTPUT_DIR = ROOT / "web" / "audio" / "ambient"
# Reading voice (Gemini TTS) measures about -16 LUFS; a bed at -18 LUFS at full slider sits about
# 2 dB under the voice (the listener turns it down). At -23 LUFS the old default was inaudible.
TARGET_LUFS = -18.0
LUFS_TOLERANCE = 1.0
MAX_BYTES = 6 * 1024 * 1024


@dataclass(frozen=True)
class Track:
    id: str
    source: str
    start_s: float = 0.0
    duration_s: float | None = None
    loop: bool = False  # ambient bed: tail crossfaded into head instead of fades
    loop_crossfade_s: float = 4.0
    # Applied before the gain: very peaky sources (fire crackle) would otherwise hit the limiter
    # long before reaching the target loudness.
    pre_filter: str | None = None


TRACKS = [
    Track("rain", "rain", loop=True),
    Track("piano", "piano"),
    Track("fireplace-cafe", "fireplace-cafe", loop=True, loop_crossfade_s=3.0,
          pre_filter="acompressor=threshold=0.05:ratio=4:attack=2:release=80:makeup=4"),
    Track("violin", "violin"),
]


def find_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg  # type: ignore[import-not-found]

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("ffmpeg not found: install it (winget install Gyan.FFmpeg) or pip install imageio-ffmpeg")


def find_source(stem: str) -> Path:
    matches = sorted(p for p in SOURCE_DIR.glob(f"{stem}.*") if p.is_file())
    if not matches:
        raise FileNotFoundError(f"missing source {SOURCE_DIR / stem}.*")
    return matches[0]


def probe_duration(ffmpeg: str, path: Path) -> float:
    out = subprocess.run([ffmpeg, "-hide_banner", "-i", str(path)], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    if not m:
        raise RuntimeError(f"cannot read duration of {path}")
    h, mnt, s = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(s)


def integrated_lufs(ffmpeg: str, args: list[str], label: str) -> float:
    """Run ffmpeg with `args` (inputs + a graph ending in ebur128) and return integrated loudness."""
    out = subprocess.run([ffmpeg, "-hide_banner", "-nostats", *args, "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    values = re.findall(r"I:\s+(-?[\d.]+) LUFS", out)
    if not values:
        raise RuntimeError(f"cannot measure loudness of {label}")
    return float(values[-1])


def shape_filter(track: Track, length: float) -> tuple[int, str]:
    """(input count, filter_complex ending in [shaped]): seamless loop or faded piece, stereo 44.1 kHz."""
    fmt = "aresample=44100,aformat=channel_layouts=stereo"
    if track.loop:
        d = track.loop_crossfade_s
        # Output = A[d:] with its last d seconds crossfaded into A[:d]; A[:d] flows into A[d],
        # which is where the output starts, so the loop point is continuous. The source is opened
        # twice: asplit + acrossfade stalls because acrossfade drains its first input first.
        return 2, (f"[0:a]{fmt},atrim=start={d},asetpts=PTS-STARTPTS[body];"
                   f"[1:a]{fmt},atrim=end={d},asetpts=PTS-STARTPTS[head];"
                   f"[body][head]acrossfade=d={d}:c1=qsin:c2=qsin[shaped]")
    return 1, f"[0:a]{fmt},afade=t=in:d=2,afade=t=out:st={max(0.0, length - 3):.2f}:d=3[shaped]"


def dynamics(track: Track) -> str:
    return f"{track.pre_filter}," if track.pre_filter else ""


def build(ffmpeg: str, track: Track) -> Path:
    src = find_source(track.source)
    length = probe_duration(ffmpeg, src) - track.start_s
    if track.duration_s:
        length = min(length, track.duration_s)
    n_inputs, shaped = shape_filter(track, length)
    inputs = ["-ss", str(track.start_s), "-t", f"{length:.2f}", "-i", str(src)] * n_inputs
    def chain(gain_db: float, tail: str) -> str:
        return f"{shaped};[shaped]{dynamics(track)}volume={gain_db:.2f}dB,alimiter=limit=0.89:level=disabled{tail}[out]"

    measured = integrated_lufs(ffmpeg, [*inputs, "-filter_complex", chain(0.0, ",ebur128"), "-map", "[out]"], str(src))
    gain_db = TARGET_LUFS - measured
    # The limiter eats loudness on peaky sources, so re-measure after it and top the gain up.
    for _ in range(3):
        measured = integrated_lufs(ffmpeg, [*inputs, "-filter_complex", chain(gain_db, ",ebur128"), "-map", "[out]"], str(src))
        if abs(measured - TARGET_LUFS) <= LUFS_TOLERANCE / 2:
            break
        gain_db += TARGET_LUFS - measured
    dst = OUTPUT_DIR / f"{track.id}.mp3"
    subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", chain(gain_db, ""), "-map", "[out]",
         "-c:a", "libmp3lame", "-b:a", "128k", "-map_metadata", "-1", str(dst)],
        check=True,
    )
    return dst


def main(argv: list[str]) -> int:
    ffmpeg = find_ffmpeg()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    wanted = set(argv) or {t.id for t in TRACKS}
    failed = False
    for track in (t for t in TRACKS if t.id in wanted):
        try:
            dst = build(ffmpeg, track)
            lufs = integrated_lufs(ffmpeg, ["-i", str(dst), "-af", "ebur128"], str(dst))
            size = dst.stat().st_size
            warn = []
            if abs(lufs - TARGET_LUFS) > LUFS_TOLERANCE:
                warn.append(f"loudness {lufs:.1f} LUFS off target")
            if size > MAX_BYTES:
                warn.append(f"{size / 1e6:.1f} MB > {MAX_BYTES / 1e6:.0f} MB")
            print(f"{track.id:16} {probe_duration(ffmpeg, dst):6.1f}s {size / 1e6:5.2f} MB {lufs:6.1f} LUFS {'WARN ' + '; '.join(warn) if warn else 'ok'}")
            failed = failed or bool(warn)
        except (OSError, RuntimeError, subprocess.CalledProcessError) as err:
            print(f"{track.id:16} FAILED: {err}", file=sys.stderr)
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
