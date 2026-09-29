"""PCM -> MP3 encoding via `lameenc` (a pure wheel, so no system ffmpeg is needed — D8)."""

import lameenc

PCM_SAMPLE_WIDTH = 2  # s16le


def pcm16_to_mp3(pcm: bytes, *, sample_rate: int = 24000, channels: int = 1, bitrate_kbps: int = 64) -> tuple[bytes, int]:
    """Encode signed 16-bit little-endian PCM to MP3; returns (mp3_bytes, duration_ms)."""
    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bitrate_kbps)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(channels)
    encoder.set_quality(2)
    mp3 = encoder.encode(pcm)
    mp3 += encoder.flush()
    sample_count = len(pcm) // (PCM_SAMPLE_WIDTH * channels)
    duration_ms = round(sample_count / sample_rate * 1000)
    return bytes(mp3), duration_ms
