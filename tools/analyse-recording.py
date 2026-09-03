#!/usr/bin/env python3
"""Analyses a recording of the engine playing on a real device.

Everything else in tools/ measures the engine as it runs here. This measures
what actually came out of a speaker somewhere else, which is the only way to
see problems that depend on the device: dropouts under load, a mix that
collapses on a small speaker, noise the sandbox never produces.

It answers the three questions we keep hitting, in the same terms:

  glitching?  discontinuities and silent gaps - a dropout is a break in the
              waveform, and it looks nothing like distortion
  static?     spectral flatness per band - near 1.0 is noise, near 0 a tone
  balance?    energy per octave band, plus level and crest factor

Accepts any format ffmpeg reads (m4a, mp3, wav, the audio of a screen
recording). Requires numpy; ffmpeg comes from imageio-ffmpeg if not on PATH.

Usage: python3 tools/analyse-recording.py recording.m4a [--quiet-start 2.0]
"""

import argparse
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

BANDS = [
    (20, 60, "sub"),
    (60, 120, "bass"),
    (120, 250, "low mid"),
    (250, 500, "mid"),
    (500, 1000, "upper mid"),
    (1000, 2000, "presence"),
    (2000, 4000, "brightness"),
    (4000, 8000, "air"),
    (8000, 16000, "top"),
]

SAMPLE_RATE = 44100


def ffmpeg_path():
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        sys.exit("need ffmpeg: pip install imageio-ffmpeg")


def load(path):
    """Decode to mono float32 at a known rate."""
    out = Path("/tmp/_recording_mono.wav")
    subprocess.run(
        [ffmpeg_path(), "-y", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE),
         "-f", "wav", str(out)],
        check=True, capture_output=True,
    )
    with wave.open(str(out), "rb") as w:
        raw = w.readframes(w.getnframes())
        width = w.getsampwidth()
    if width != 2:
        sys.exit(f"unexpected sample width {width}")
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def db(x):
    x = float(np.max(x) if np.ndim(x) else x)
    return -np.inf if x <= 0 else 20 * np.log10(x)


def flatness(power):
    """Geometric over arithmetic mean. Near 1 is noise, near 0 is a tone."""
    power = np.maximum(power, 1e-20)
    return float(np.exp(np.mean(np.log(power))) / np.mean(power))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--quiet-start", type=float, default=0.0,
                    help="seconds to skip, e.g. before playback begins")
    args = ap.parse_args()

    x = load(args.file)[int(args.quiet_start * SAMPLE_RATE):]
    if x.size < SAMPLE_RATE:
        sys.exit("recording is too short to say anything useful")

    seconds = x.size / SAMPLE_RATE
    print(f"{args.file}: {seconds:.1f}s at {SAMPLE_RATE}Hz\n")

    # --- glitching -------------------------------------------------------
    # A dropout breaks the waveform: neighbouring samples jump in a way no
    # oscillator does. Distortion, by contrast, stays continuous.
    diff = np.abs(np.diff(x))
    jumps = int(np.sum(diff > 0.25))
    # Digital silence mid-playback is a buffer that never got filled.
    window = SAMPLE_RATE // 100
    frames = x[: (x.size // window) * window].reshape(-1, window)
    frame_peak = np.max(np.abs(frames), axis=1)
    loud = frame_peak > 0.01
    gaps = int(np.sum(~loud[loud.argmax():])) if loud.any() else 0

    print("IS IT GLITCHING?")
    print(f"  discontinuities        {jumps}  ({jumps / x.size * 100:.4f}% of samples)")
    print(f"  biggest sample jump    {np.max(diff):.3f}   (1.0 = full scale in one sample)")
    print(f"  silent 10ms frames     {gaps} of {len(frame_peak)} after playback starts")

    # --- level -----------------------------------------------------------
    rms = np.sqrt(np.mean(frames**2, axis=1))
    active = rms[rms > 1e-4]
    med_rms = float(np.median(active)) if active.size else 0.0
    clipped = int(np.sum(np.abs(x) > 0.99))

    print("\nLEVEL")
    print(f"  peak                   {db(np.abs(x)):.1f} dBFS")
    print(f"  median RMS             {db(med_rms):.1f} dBFS")
    print(f"  crest factor           {db(np.abs(x)) - db(med_rms):.1f} dB")
    print(f"  samples at/over FS     {clipped}  ({clipped / x.size * 100:.4f}%)")

    # --- spectrum --------------------------------------------------------
    size = 8192
    hop = size // 2
    win = np.hanning(size)
    count = max(1, (x.size - size) // hop)
    acc = np.zeros(size // 2 + 1)
    for i in range(count):
        seg = x[i * hop: i * hop + size]
        if seg.size < size:
            break
        acc += np.abs(np.fft.rfft(seg * win)) ** 2
    acc /= count
    freqs = np.fft.rfftfreq(size, 1 / SAMPLE_RATE)

    total = acc.sum()
    loudest = max(acc[(freqs >= lo) & (freqs < hi)].sum() for lo, hi, _ in BANDS)

    print("\nBALANCE AND NOISE")
    print("  band          range        share    dB vs loudest   noisiness")
    for lo, hi, name in BANDS:
        sel = (freqs >= lo) & (freqs < hi)
        power = acc[sel].sum()
        share = power / total * 100
        rel = 10 * np.log10(power / loudest) if power > 0 else -np.inf
        print(f"  {name:<12} {lo:>5}-{hi:<6} {share:6.2f}%   {rel:7.1f} dB   {flatness(acc[sel]):8.3f}")

    print("\n  noisiness near 1.0 is static; a tonal instrument should be near 0.")


if __name__ == "__main__":
    main()
