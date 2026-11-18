"""Synthesise the 15-second ambient soundtrack (assets/soundtrack.wav).

Pure numpy, no samples: a pad following the shots (Dm - Bb - Gm - C - Dm),
a sub bass, a soft pulse, whooshes on every cut, bell pings on key reveals,
and a cheap convolution reverb.   Usage:  python3 scripts/soundtrack.py
"""
import os
import wave

import numpy as np

SR = 48000
DUR = 15.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def raised(x):
    """0..1 raised-cosine ramp."""
    x = np.clip(x, 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * x)


# shot boundaries and chords (MIDI notes)
CUTS = [0, 3, 6, 9, 12, 15]
CHORDS = [
    [50, 57, 62, 65, 69, 76],  # Dm9
    [46, 53, 58, 62, 65, 69],  # Bbmaj7
    [43, 50, 55, 58, 62, 69],  # Gm9
    [48, 55, 60, 62, 67, 72],  # Csus2
    [50, 57, 62, 65, 69, 74],  # Dm
]
ROOTS = [38, 34, 31, 36, 38]
XF = 0.7


def segment_env(i):
    a, b = CUTS[i], CUTS[i + 1]
    fin = np.ones(N) if i == 0 else raised((t - (a - XF / 2)) / XF)
    fout = np.ones(N) if i == len(CHORDS) - 1 else 1 - raised((t - (b - XF / 2)) / XF)
    return fin * fout


def saw_pad(freq, detune_cents=5.0):
    out = np.zeros(N)
    for d in (-detune_cents, detune_cents):
        f = freq * 2 ** (d / 1200)
        ph = rng.uniform(0, 2 * np.pi)
        for n in range(1, 11):
            out += np.sin(2 * np.pi * f * n * t + ph * n) * (1 / n) * np.exp(-n * 0.32)
    return out


pad = np.zeros(N)
bass = np.zeros(N)
for i, chord in enumerate(CHORDS):
    env = segment_env(i)
    voice = sum(saw_pad(hz(m)) * (0.9 if m < 60 else 0.7) for m in chord)
    pad += voice * env
    f = hz(ROOTS[i])
    bass += (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * env
# slow tremolo + overall swell
pad *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.35 * t)
pad *= raised(t / 1.2)
pad /= np.max(np.abs(pad)) + 1e-9
bass /= np.max(np.abs(bass)) + 1e-9

# soft pulse (120 bpm) from the first cut, thinning out for the bonus
pulse = np.zeros(N)
for beat in np.arange(3.0, 14.4, 0.5):
    i0 = int(beat * SR)
    L = int(0.35 * SR)
    tt = np.arange(L) / SR
    f = 42 + 70 * np.exp(-tt * 28)
    k = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 9)
    gain = 0.55 if beat < 12 else 0.3
    end = min(N, i0 + L)
    pulse[i0:end] += gain * k[: end - i0]
# off-beat ticks during the explanation shots
ticks = np.zeros(N)
for beat in np.arange(6.25, 12.0, 0.5):
    i0 = int(beat * SR)
    L = int(0.06 * SR)
    noise = rng.standard_normal(L)
    hp = np.diff(noise, prepend=0)  # crude high-pass
    end = min(N, i0 + L)
    ticks[i0:end] += 0.18 * hp[: end - i0] * np.exp(-np.arange(L) / SR * 70)[: end - i0]


def one_pole_lowpass(x, cutoff):
    """Time-varying one-pole low-pass (cutoff array in Hz)."""
    y = np.zeros_like(x)
    a = np.exp(-2 * np.pi * np.asarray(cutoff) / SR)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


# whooshes leading into each cut
whoosh = np.zeros((N, 2))
for cut in CUTS[1:-1]:
    L = int(0.9 * SR)
    i0 = int((cut - 0.7) * SR)
    tt = np.arange(L) / SR
    env = np.where(tt < 0.7, (tt / 0.7) ** 2.5, np.exp(-(tt - 0.7) * 18))
    cutoff = 300 + 5200 * np.where(tt < 0.7, (tt / 0.7) ** 2, 1.0)
    for ch in range(2):
        nz = one_pole_lowpass(rng.standard_normal(L), cutoff)
        pan = 0.6 + 0.4 * np.sin(2 * np.pi * (tt / 0.9) + ch * np.pi)
        whoosh[i0 : i0 + L, ch] += 0.5 * nz * env * pan

# low impacts: opening + bonus reveal
impact = np.zeros(N)
for when, g in ((0.12, 1.0), (12.0, 0.7)):
    i0 = int(when * SR)
    L = int(1.8 * SR)
    tt = np.arange(L) / SR
    f = 32 + 40 * np.exp(-tt * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.6)
    thump = one_pole_lowpass(rng.standard_normal(L), np.full(L, 180.0)) * np.exp(-tt * 14) * 3
    end = min(N, i0 + L)
    impact[i0:end] += g * (boom + thump)[: end - i0]

# bell pings on reveals (note picked from the active chord)
bells = np.zeros((N, 2))
PINGS = [(0.95, 81, -0.3), (4.75, 77, 0.3), (5.05, 81, 0.35), (7.65, 79, -0.2), (10.95, 79, 0.25), (14.05, 86, 0.2)]
for when, m, pan in PINGS:
    i0 = int(when * SR)
    L = int(2.2 * SR)
    tt = np.arange(L) / SR
    f = hz(m)
    b = (
        np.sin(2 * np.pi * f * tt) * np.exp(-tt * 2.2)
        + 0.35 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt * 4.5)
        + 0.15 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt * 8)
    ) * (1 - np.exp(-tt * 400))
    end = min(N, i0 + L)
    bells[i0:end, 0] += b[: end - i0] * (1 - pan) * 0.5
    bells[i0:end, 1] += b[: end - i0] * (1 + pan) * 0.5

# ---------- mix ----------
mono = 0.45 * pad + 0.24 * bass + 0.4 * pulse + ticks + 0.5 * impact
mix = np.stack([mono, mono], axis=1)
mix[:, 0] += 0.06 * np.roll(pad, 240)  # a little width
mix[:, 1] += 0.06 * np.roll(pad, -240)
mix += 0.45 * whoosh + 0.32 * bells


def reverb(x, seconds=2.2, decay=0.55, wet=0.28):
    L = int(seconds * SR)
    out = np.zeros_like(x)
    for ch in range(x.shape[1]):
        ir = rng.standard_normal(L) * np.exp(-np.arange(L) / SR / decay)
        ir[: int(0.012 * SR)] = 0
        ir /= np.sqrt(np.sum(ir**2))
        n = 1 << int(np.ceil(np.log2(len(x) + L)))
        y = np.fft.irfft(np.fft.rfft(x[:, ch], n) * np.fft.rfft(ir, n), n)[: len(x)]
        out[:, ch] = (1 - wet) * x[:, ch] + wet * y
    return out


mix = reverb(mix)
fade = np.clip((DUR - t) / 0.6, 0, 1) ** 1.5 * np.clip(t / 0.03, 0, 1)
mix *= fade[:, None]
mix = np.tanh(mix / (np.max(np.abs(mix)) + 1e-9) * 1.25)  # gentle saturation / limiting
mix *= 0.89 / np.max(np.abs(mix))

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
out_path = os.path.join(root, "assets", "soundtrack.wav")
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with wave.open(out_path, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print(f"wrote {os.path.relpath(out_path, root)} ({DUR:.0f}s, {SR} Hz stereo)")
