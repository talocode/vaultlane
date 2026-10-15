#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1920, 1080, 24
VOICE = Path("/workspace/artifacts/vaultlane-voice.mp3")
TIMES = json.loads(Path("/workspace/artifacts/vaultlane-voice.timestamps.json").read_text())
OUT = Path("/workspace/artifacts/vaultlane-demo-2026-10-15.mp4")
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

BG = (8, 10, 14)
INK = (236, 236, 232)
DIM = (154, 160, 168)
GREEN = (126, 214, 146)
AMBER = (232, 176, 88)
RED = (224, 96, 96)
LINE = (42, 48, 58)

duration = float(TIMES["duration"])
frames = int(duration * FPS) + 4
words = []
buf = ""
start = None
for ch, span in zip(TIMES["graph_chars"], TIMES["graph_times"]):
    if ch.isspace():
        if buf:
            words.append((buf, start, span[0]))
            buf = ""
            start = None
        continue
    if start is None:
        start = span[0]
    buf += ch
if buf:
    words.append((buf, start, TIMES["graph_times"][-1][1]))

def font(path, size):
    return ImageFont.truetype(path, size)

F = {
    "h": font(BOLD, 72),
    "s": font(FONT, 32),
    "b": font(BOLD, 36),
    "m": font(MONO, 28),
    "c": font(BOLD, 30),
    "k": font(FONT, 24),
}

def caption(t):
    live = [w for w in words if w[1] <= t <= w[2] + 0.35]
    if not live:
        # hold the latest finished phrase
        done = [w for w in words if w[1] <= t]
        live = done[-8:]
    else:
        # expand to a short window
        idx = words.index(live[0])
        live = words[max(0, idx - 2): idx + 8]
    text = " ".join(w[0] for w in live)
    return text[:110]

def bar(draw, x, y, w, h, frac, fill):
    draw.rounded_rectangle((x, y, x + w, y + h), 8, fill=(28, 32, 40))
    draw.rounded_rectangle((x, y, x + max(8, int(w * frac)), y + h), 8, fill=fill)

def scene(t, draw):
    # always-moving scan
    scan = int((t * 140) % (W + 80)) - 40
    draw.line((scan, 0, scan, H), fill=(22, 28, 36), width=2)
    draw.text((80, 48), "VAULTLANE  ·  0.1.0", font=F["k"], fill=DIM)
    draw.text((1500, 48), "NO FUNDS MOVED", font=F["k"], fill=AMBER)

    if t < 9:
        draw.text((80, 280), "The gate in front of a swap.", font=F["h"], fill=INK)
        draw.text((80, 390), "It checks the basket. It does not hold the tokens.", font=F["s"], fill=DIM)
        y = 520
        for i, (label, target) in enumerate((("SOL", 0.50), ("USDC", 0.30), ("TCODE", 0.20))):
            grow = min(1, max(0, (t - 2 - i * 0.4) / 2.2))
            draw.text((80, y), label, font=F["b"], fill=INK)
            bar(draw, 280, y + 8, 900, 28, target * grow, GREEN)
            draw.text((1210, y), f"{int(target * 10000)} bps", font=F["m"], fill=DIM)
            y += 90
    elif t < 20:
        draw.text((80, 180), "Sample basket", font=F["h"], fill=INK)
        draw.text((80, 280), "Weights must sum to 10,000.", font=F["s"], fill=DIM)
        rows = [("SOL", 5000, GREEN), ("USDC", 3000, (120, 170, 220)), ("TCODE", 2000, AMBER)]
        y = 400
        shown = 0
        for i, (label, bps, color) in enumerate(rows):
            appear = min(1, max(0, (t - 10 - i * 0.5)))
            if appear <= 0:
                continue
            draw.text((80, y), label, font=F["b"], fill=INK)
            bar(draw, 280, y + 8, 1100, 36, (bps / 10000) * appear, color)
            draw.text((1420, y), str(bps), font=F["m"], fill=INK)
            shown += bps if appear > 0.95 else 0
            y += 110
        pulse = int(800 + 40 * ((t * 3) % 1))
        draw.text((80, 820), f"Running total  {shown if shown else '…'}   /  10,000", font=F["b"], fill=GREEN if shown == 10000 else INK)
        draw.rectangle((80, 890, pulse, 896), fill=GREEN)
    elif t < 36:
        draw.text((80, 150), "The book is off target.", font=F["h"], fill=INK)
        progress = min(1, max(0, (t - 21) / 6))
        pairs = [
            ("SOL", 0.70, 0.50, "sell $200", RED),
            ("USDC", 0.20, 0.30, "buy $100", GREEN),
            ("TCODE", 0.10, 0.20, "buy $100", GREEN),
        ]
        y = 300
        for label, now, target, verb, color in pairs:
            frac = now + (target - now) * progress
            draw.text((80, y), f"{label}  {int(frac * 100)}%", font=F["b"], fill=INK)
            bar(draw, 420, y + 8, 900, 32, frac, color)
            if progress > 0.55:
                draw.text((1360, y), verb, font=F["m"], fill=color)
            y += 110
        if t > 30:
            blink = int(t * 2) % 2
            draw.text((80, 760), f"signed: false{'_' if blink else ' '}", font=F["m"], fill=AMBER)
            draw.text((80, 820), "Nothing leaves the wallet.", font=F["s"], fill=INK)
    elif t < 46:
        shake = int(6 * ((t * 4) % 1))
        draw.text((80 + shake, 220), "TCODE price is stale.", font=F["h"], fill=RED)
        draw.text((80, 360), "The keeper halts.", font=F["h"], fill=INK)
        draw.text((80, 500), "It will not invent a number.", font=F["s"], fill=DIM)
        draw.text((80, 620), "action: halt", font=F["m"], fill=RED)
        draw.rectangle((80, 720, 80 + int(((t * 90) % 700)), 728), fill=RED)
    elif t < 56:
        draw.text((80, 160), "Credits", font=F["h"], fill=INK)
        draw.text((80, 280), "Local plan and quote", font=F["s"], fill=DIM)
        draw.text((80, 330), "0 credits", font=F["h"], fill=GREEN)
        draw.text((80, 460), "Live endpoint, 15 Oct 2026", font=F["s"], fill=DIM)
        x = 80
        for name in ("Tera", "SearchLane", "CalcLane"):
            draw.rounded_rectangle((x, 530, x + 280, 620), 16, outline=LINE, width=2)
            draw.text((x + 24, 558), name, font=F["b"], fill=INK)
            x += 320
        draw.text((80, 700), "VaultLane is not on that list.", font=F["s"], fill=AMBER)
        draw.text((80, 790), "POST /execute   →   HTTP 402", font=F["m"], fill=RED)
        draw.text((80, 860), "No charge. No signature.", font=F["s"], fill=INK)
    else:
        draw.text((80, 200), "Official mint", font=F["h"], fill=INK)
        draw.text((80, 340), "6ptxwABxQz8zMhwhiPeVgRgWjGMdVcEBFBv8v8C3ory", font=F["m"], fill=GREEN)
        draw.text((80, 460), "The program that would hold funds", font=F["s"], fill=DIM)
        draw.text((80, 520), "is not deployed.", font=F["h"], fill=INK)
        draw.text((80, 680), "github.com/talocode/vaultlane", font=F["m"], fill=DIM)
        draw.text((80, 760), "npm @talocode/vaultlane@0.1.0", font=F["m"], fill=DIM)

def frame(t):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    scene(t, draw)
    cap = caption(t)
    draw.rounded_rectangle((120, 960, 1800, 1040), 12, fill=(16, 18, 24))
    draw.text((150, 982), cap, font=F["c"], fill=INK)
    return img

def main():
    cmd = [
        "ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-", "-i", str(VOICE), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
        "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(OUT),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for i in range(frames):
            img = frame(i / FPS)
            proc.stdin.write(img.tobytes())
    finally:
        proc.stdin.close()
        err = proc.stderr.read().decode(errors="ignore")
        code = proc.wait()
    if code != 0:
        raise SystemExit(err[-2000:])
    print("wrote", OUT, "frames", frames)

if __name__ == "__main__":
    main()
