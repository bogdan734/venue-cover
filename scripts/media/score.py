"""The film's sound: a music bed written here, note by note (no samples, nothing downloaded), the voice, and a few small
sounds for clicks, keys and transitions, mixed into one track. The music steps back while someone speaks.

    python3 scripts/media/score.py <work>/audio.json <out.wav>

audio.json comes from cut.ts: the length, where each sentence starts, the sounds, and when the closing card begins.
"""

import json
import sys
import wave

import numpy as np
from scipy import signal

SR = 48_000
cues = json.load(open(sys.argv[1]))
LENGTH = cues["duration"]
N = int(LENGTH * SR)
rng = np.random.default_rng(2026)
t_all = np.arange(N) / SR


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def place(track, sound, at, gain=1.0):
    """Adds a sound (mono or stereo) into a stereo track from a moment, cut at the end of the film."""
    start = int(at * SR)
    if start >= N or start + len(sound) <= 0:
        return
    sound = sound if sound.ndim == 2 else np.stack([sound, sound], axis=1)
    if start < 0:
        sound, start = sound[-start:], 0
    end = min(N, start + len(sound))
    track[start:end] += gain * sound[: end - start]


def pan(mono, position):
    """-1 is left, 1 is right, at equal power."""
    angle = (position + 1) * np.pi / 4
    return np.stack([mono * np.cos(angle), mono * np.sin(angle)], axis=1)


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))


# ——— The music ———

BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
# Four bars round and round (IV, V, iii, vi in D major), each as a bass note and four notes held above it.
CHORDS = [
    (43, [59, 62, 66, 69]),  # G maj9
    (45, [57, 61, 64, 66]),  # A6
    (42, [61, 64, 66, 69]),  # F#m7
    (47, [57, 61, 62, 66]),  # Bm9
]
LAST = (38, [57, 62, 64, 66])  # D add9, where it comes home
OUTRO = cues["music"]["outro"]
bars = int(np.ceil(LENGTH / BAR)) + 1
home = int(np.floor(OUTRO / BAR)) + 1  # the bar after the closing card begins


def chord_of(bar):
    return LAST if bar >= home else CHORDS[bar % 4]


# A saw wave's cycle with its harmonics kept below the top of hearing, read at any pitch: warm and without aliasing.
TABLE_SIZE = 4096
phase_grid = np.arange(TABLE_SIZE) / TABLE_SIZE
SAW = sum(np.sin(2 * np.pi * k * phase_grid) / k for k in range(1, 41)) * (2 / np.pi)


def saw(freq, count):
    phase = (np.arange(count) * freq / SR + rng.random()) % 1.0
    return np.interp(phase * TABLE_SIZE, np.arange(TABLE_SIZE + 1), np.append(SAW, SAW[0]))


def envelope(count, attack, release):
    e = np.ones(count)
    a = min(count, int(attack * SR))
    r = min(count - a, int(release * SR))
    e[:a] = np.linspace(0, 1, a) ** 2
    if r > 0:
        e[count - r :] *= np.linspace(1, 0, r) ** 1.5
    return e


pad = np.zeros((N, 2))
low = signal.butter(2, 1500, "low", fs=SR, output="sos")
for bar in range(bars):
    _, notes = chord_of(bar)
    start = bar * BAR
    if start >= LENGTH or (bar > home):
        break
    hold = BAR + 1.1 if bar < home else LENGTH - start + 0.5  # each chord rings into the next; the last to the end
    count = int(hold * SR)
    chord = np.zeros((count, 2))
    for i, note in enumerate(notes):
        for cents, side in ((-9, -0.7), (0, 0.0), (9, 0.7)):
            chord += pan(saw(hz(note) * 2 ** (cents / 1200), count), side * (0.6 if i % 2 else 1))
    chord = signal.sosfilt(low, chord, axis=0) * envelope(count, 0.7, 1.1)[:, None]
    place(pad, chord / 12, start)

ep = np.zeros((N, 2))
# A soft electric piano: a sine bent by another sine, brighter as it is struck and mellower as it rings.
PATTERNS = [[0, 1, 2, 3, 2, 1, 2, 3], [3, 2, 1, 2, 0, 2, 1, 3]]
for bar in range(bars):
    _, notes = chord_of(bar)
    if bar * BAR > LENGTH:
        break
    pattern = PATTERNS[(bar // 4) % 2]
    steps = 8 if bar < home else 4
    for step in range(steps):
        at = bar * BAR + step * BEAT / 2 + rng.normal(0, 0.006)
        note = notes[pattern[step]] + 12
        count = int(1.6 * SR)
        t = np.arange(count) / SR
        f = hz(note)
        index = 1.6 * np.exp(-t / 0.28) + 0.15
        tone = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * f * t))
        tone += 0.12 * np.sin(2 * np.pi * f * 4.02 * t) * np.exp(-t / 0.08)
        strike = (0.75 if step % 2 else 1.0) * rng.uniform(0.85, 1.0)
        tone *= np.exp(-t / 0.65) * np.minimum(1, t / 0.004) * strike
        place(ep, pan(tone, 0.35 if step % 2 else -0.35), at)
ep = signal.sosfilt(signal.butter(2, 4500, "low", fs=SR, output="sos"), ep, axis=0)

DROP = 3.2  # the beat comes in with the first page of the product
drums = np.zeros((N, 2))
bassline = np.zeros((N, 2))
duck_kick = np.ones(N)
kick_t = np.arange(int(0.45 * SR)) / SR
kick = np.sin(2 * np.pi * np.cumsum(45 + 70 * np.exp(-kick_t / 0.035)) / SR) * np.exp(-kick_t / 0.16)
kick[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
hat_t = np.arange(int(0.05 * SR)) / SR
hat_high = signal.butter(4, 7000, "high", fs=SR, output="sos")
first_bar = int(np.ceil(DROP / BAR))
for bar in range(first_bar, home):
    bass, _ = chord_of(bar)
    for beat in (0, 2):
        at = bar * BAR + beat * BEAT
        place(drums, kick, at, 0.9)
        # Everything else bows to the kick for a moment, which gives the bed its pulse.
        i = int(at * SR)
        span = min(N - i, int(0.32 * SR))
        if span > 0:
            duck_kick[i : i + span] = np.minimum(
                duck_kick[i : i + span], 1 - 0.38 * np.exp(-np.arange(span) / SR / 0.11)
            )
    for sixteenth in range(16):
        at = bar * BAR + sixteenth * BEAT / 4 + rng.normal(0, 0.003)
        level = 0.55 if sixteenth % 4 == 2 else (0.3 if sixteenth % 2 else 0.18)
        burst = signal.sosfilt(hat_high, rng.normal(0, 1, len(hat_t))) * np.exp(-hat_t / 0.018)
        place(drums, pan(burst * level, 0.25), at, 0.5)
    for at, length in ((0, 1.4), (1.5, 0.9), (2, 1.4), (3.5, 0.45)):
        count = int(length * BEAT * SR)
        t = np.arange(count) / SR
        f = hz(bass)
        tone = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * envelope(count, 0.01, 0.12)
        place(bassline, tone, bar * BAR + at * BEAT, 0.8)
bassline = signal.sosfilt(signal.butter(2, 320, "low", fs=SR, output="sos"), bassline, axis=0)

# One room for the pad and the piano: a decaying noise as the impulse, a little different in each ear.
ir_t = np.arange(int(2.4 * SR)) / SR
room = np.stack(
    [
        signal.sosfilt(signal.butter(2, 5000, "low", fs=SR, output="sos"), rng.normal(0, 1, len(ir_t)))
        * np.exp(-ir_t / 0.55)
        for _ in range(2)
    ],
    axis=1,
)
room /= np.sqrt(np.sum(room**2, axis=0))
send = pad * 0.6 + ep
wet = np.stack([signal.fftconvolve(send[:, c], room[:, c])[:N] for c in range(2)], axis=1)

music = (pad * 0.55 + bassline * 0.5) * duck_kick[:, None] + ep * 0.36 + drums * 0.55 + wet * 0.3
music *= np.minimum(1, t_all / 1.6)[:, None]  # it fades in under the title
music *= 0.1 / rms(music)  # a level the voice will sit well above

# ——— The voice ———

def read_wav(path):
    with wave.open(path) as w:
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64) / 32768
        return data, w.getframerate()


voice = np.zeros((N, 2))
speaking = np.zeros(N)
clean = signal.butter(2, 75, "high", fs=SR, output="sos")
for line in cues["voices"]:
    data, rate = read_wav(line["file"])
    data = signal.resample_poly(data, SR, rate)
    data = signal.sosfilt(clean, data)
    data *= 0.12 / rms(data[np.abs(data) > 0.02 * np.max(np.abs(data))])
    place(voice, data, line["at"])
    a = int(line["at"] * SR)
    speaking[max(0, a - int(0.12 * SR)) : min(N, a + len(data) + int(0.2 * SR))] = 1

# The music steps back under the voice: down quickly, up slowly.
target = 1 - 0.82 * speaking
gain = np.empty(N)
level = 1.0
down = 1 - np.exp(-1 / (0.09 * SR))
up = 1 - np.exp(-1 / (0.45 * SR))
step = 64
for i in range(0, N, step):
    goal = target[i]
    level += (goal - level) * (1 - (1 - (down if goal < level else up)) ** step)
    gain[i : i + step] = level

# ——— Small sounds ———

sfx = np.zeros((N, 2))


def whoosh():
    count = int(0.6 * SR)
    t = np.arange(count) / SR
    noise = rng.normal(0, 1, count)
    # A low-pass whose corner sweeps up and back: air moving past.
    corner = 400 + 5200 * np.sin(np.pi * np.clip(t / 0.6, 0, 1)) ** 2
    a = 1 - np.exp(-2 * np.pi * corner / SR)
    out = np.empty(count)
    y = 0.0
    for i in range(count):
        y += a[i] * (noise[i] - y)
        out[i] = y
    shape = np.sin(np.pi * np.clip(t / 0.6, 0, 1)) ** 1.6
    return np.stack([out * shape * (1 - t / 0.6 * 0.6), out * shape * (0.4 + t / 0.6 * 0.6)], axis=1)


def click():
    count = int(0.05 * SR)
    t = np.arange(count) / SR
    tick = signal.sosfilt(signal.butter(2, 2500, "high", fs=SR, output="sos"), rng.normal(0, 1, count))
    return tick * np.exp(-t / 0.004) * 0.7 + np.sin(2 * np.pi * 1900 * t) * np.exp(-t / 0.012) * 0.35


def key():
    count = int(0.03 * SR)
    t = np.arange(count) / SR
    tick = signal.sosfilt(signal.butter(2, 3200, "high", fs=SR, output="sos"), rng.normal(0, 1, count))
    return tick * np.exp(-t / 0.005) * rng.uniform(0.5, 1)


def hit():
    count = int(1.8 * SR)
    t = np.arange(count) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 30 * np.exp(-t / 0.08)) / SR) * np.exp(-t / 0.5)
    air = signal.sosfilt(signal.butter(2, 1800, "low", fs=SR, output="sos"), rng.normal(0, 1, count))
    return boom + 0.25 * air * np.exp(-t / 0.05)


for sound in cues["sfx"]:
    kind, at = sound["kind"], sound["at"]
    if kind == "whoosh":
        place(sfx, whoosh(), at, 0.06)
    elif kind == "click":
        place(sfx, click(), at, 0.16)
    elif kind == "hit":
        place(sfx, hit(), at, 0.32)
    elif kind == "keys":
        moment = at
        while moment < at + sound["dur"]:
            place(sfx, pan(key(), rng.uniform(-0.2, 0.2)), moment, 0.07)
            moment += rng.uniform(0.055, 0.1)
    else:
        raise ValueError(f"no sound called {kind}")

# ——— The mix ———

mix = music * gain[:, None] + voice + sfx
tail = np.clip((LENGTH - t_all) / 0.9, 0, 1)  # the picture fades to black over its last second, and so does this
mix *= tail[:, None]
mix = np.tanh(mix * 1.1) / np.tanh(1.1)  # a soft ceiling for the few peaks
mix *= 10 ** (-1 / 20) / np.max(np.abs(mix))

with wave.open(sys.argv[2], "wb") as out:
    out.setnchannels(2)
    out.setsampwidth(2)
    out.setframerate(SR)
    out.writeframes((mix * 32767).astype(np.int16).tobytes())
print(
    f"{LENGTH:.1f} s; voice {20 * np.log10(rms(voice[speaking > 0]) + 1e-9):.1f} dBFS while speaking, "
    f"music under it {20 * np.log10(rms((music * gain[:, None])[speaking > 0]) + 1e-9):.1f} dBFS, "
    f"alone {20 * np.log10(rms((music * gain[:, None])[speaking == 0]) + 1e-9):.1f} dBFS"
)
