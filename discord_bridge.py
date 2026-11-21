#!/usr/bin/env python3
"""Discord bridge: lets Lexi's "commodore 64" persona talk through the talking face.

Lexi (on Heroku) writes the question and reply into the u64_jobs table in her Postgres
database. This script runs on the same network as the C64, picks up each job, shows the
question on row 1, makes the face speak the reply, captures the screen as a PNG or GIF and
puts the image back in the database for Lexi to post.

It also does everything chat.py does - C64 keyboard input, F1 mic mode and F3 music mode -
and posts those exchanges and the F1/F3 switches to Discord too. Run this instead of chat.py
(both drive the same C64 memory); chat.py is the same thing without Discord.
"""
import argparse
import glob
import io
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import httpx
import psycopg
from psycopg.rows import dict_row
from PIL import Image

import chat

VERSION = "0.2.0"
BUILD   = "2026-11-20-1"

HEARTBEAT_INTERVAL  = 5.0      # seconds between "bridge is alive" check-ins
JOB_POLL_INTERVAL   = 1.0      # seconds between looks at the job queue
JOB_MAX_AGE         = 60       # ignore jobs older than this many seconds
SPEAK_START_TIMEOUT = 5.0      # seconds to wait for the face to start speaking
SPEAK_MAX_SECONDS   = 120.0    # stop capturing after this long
FRAME_INTERVAL      = 0.2      # seconds between captured frames
GIF_MAX_BYTES       = 8 * 1024 * 1024
GIF_MAX_FRAMES      = 400
DEFAULT_APP         = "lexi-persimmons"
MODE_POLL_INTERVAL  = 0.5      # seconds between checks of the F1/F3 flags

TICKER_ROW = 23
SCREEN_ADDR = 0x0400
COLOR_ADDR  = 0xD800
VIC_D018    = 0xD018
VIC_BORDER  = 0xD020

BORDER_X, BORDER_Y = 32, 36    # visible border around the 320x200 screen
SCALE = 2

# Pepto's C64 palette
PALETTE = [
    0x000000, 0xFFFFFF, 0x68372B, 0x70A4B2, 0x6F3D86, 0x588D43, 0x352879, 0xB8C76F,
    0x6F4F25, 0x433900, 0x9A6759, 0x444444, 0x6C6C6C, 0x9AD284, 0x6C5EB5, 0x959595,
]
PALETTE_BYTES = b"".join(bytes([(c >> 16) & 255, (c >> 8) & 255, c & 255]) for c in PALETTE)

CHARGEN_SEARCH = [
    "/Applications/*VICE*/**/C64/chargen*",
    "/Applications/vice*/**/C64/chargen*",
    "~/Applications/*VICE*/**/C64/chargen*",
    "/opt/homebrew/share/vice/C64/chargen*",
    "/usr/local/share/vice/C64/chargen*",
    "/usr/share/vice/C64/chargen*",
    "/usr/lib/vice/C64/chargen*",
]


# ---------- config ----------

def load_config() -> dict:
    if chat.CONFIG_PATH.exists():
        try:
            return json.loads(chat.CONFIG_PATH.read_text())
        except Exception:
            pass
    return {}


def save_config(cfg: dict) -> None:
    chat.CONFIG_PATH.write_text(json.dumps(cfg, indent=2))


def find_chargen(cfg: dict) -> bytes:
    """The C64 character ROM (4096 bytes), from VICE. Found or asked for once, then saved."""
    path = cfg.get("chargen")
    if not path or not Path(path).exists():
        path = None
        for pattern in CHARGEN_SEARCH:
            for p in sorted(glob.glob(os.path.expanduser(pattern), recursive=True)):
                if Path(p).is_file() and Path(p).stat().st_size == 4096:
                    path = p
                    break
            if path:
                break
        if not path:
            path = input("path to the C64 chargen ROM (4096 bytes, e.g. from VICE's C64 folder): ").strip()
        cfg["chargen"] = path
        save_config(cfg)
        print(f"chargen: {path}")
    data = Path(path).read_bytes()
    if len(data) != 4096:
        sys.exit(f"error: {path} is {len(data)} bytes, expected 4096")
    return data


def database_url(cfg: dict, app: str | None) -> str:
    """DATABASE_URL from the environment, or from the Heroku CLI (it can change, so it isn't saved)."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    app = app or cfg.get("heroku_app")
    if not app:
        app = input(f"Lexi's Heroku app name [{DEFAULT_APP}]: ").strip() or DEFAULT_APP
    if cfg.get("heroku_app") != app:
        cfg["heroku_app"] = app
        save_config(cfg)
    try:
        out = subprocess.run(["heroku", "config:get", "DATABASE_URL", "-a", app],
                             capture_output=True, text=True, check=True, timeout=30)
    except Exception as e:
        sys.exit(f"error: couldn't get DATABASE_URL from Heroku ({e}). Set DATABASE_URL instead.")
    url = out.stdout.strip()
    if not url:
        sys.exit(f"error: {app} has no DATABASE_URL. Add Heroku Postgres first.")
    return url


def connect(url: str) -> psycopg.Connection:
    local = "@localhost" in url or "@127.0.0.1" in url
    return psycopg.connect(url, autocommit=True, sslmode="disable" if local else "require")


# ---------- screen capture ----------

class Frame:
    def __init__(self, screen: bytes, colors: bytes, border: int, bg: int, lower: bool):
        self.screen, self.colors = screen, colors
        self.border, self.bg, self.lower = border, bg, lower

    def key(self):
        return (self.screen, self.colors, self.border, self.bg, self.lower)

    def ticker_chars(self) -> int:
        row = self.screen[TICKER_ROW * 40:(TICKER_ROW + 1) * 40]
        return sum(1 for b in row if b != 0x20)


def read_frame(http: httpx.Client, host: str) -> Frame | None:
    screen = chat.http_readmem(http, host, SCREEN_ADDR, 1000)
    colors = chat.http_readmem(http, host, COLOR_ADDR, 1000)
    if not screen or not colors or len(screen) < 1000 or len(colors) < 1000:
        return None
    regs = chat.http_readmem(http, host, VIC_BORDER, 2)
    d018 = chat.http_readmem(http, host, VIC_D018, 1)
    border = regs[0] & 15 if regs and len(regs) == 2 else 0
    bg = regs[1] & 15 if regs and len(regs) == 2 else 6
    lower = bool(d018 and d018[0] & 0x02)
    return Frame(screen[:1000], colors[:1000], border, bg, lower)


def render(frame: Frame, chargen: bytes, scale: int = SCALE) -> Image.Image:
    """Draw the text screen with the real character ROM, plus border."""
    w, h = 320 + 2 * BORDER_X, 200 + 2 * BORDER_Y
    px = bytearray([frame.border]) * (w * h)
    base = 0x800 if frame.lower else 0
    bg = frame.bg
    for row in range(25):
        for col in range(40):
            i = row * 40 + col
            glyph = base + frame.screen[i] * 8
            fg = frame.colors[i] & 15
            x0 = BORDER_X + col * 8
            for line in range(8):
                bits = chargen[glyph + line]
                start = (BORDER_Y + row * 8 + line) * w + x0
                px[start:start + 8] = bytes(fg if bits & (0x80 >> b) else bg for b in range(8))
    img = Image.frombytes("P", (w, h), bytes(px))
    img.putpalette(PALETTE_BYTES)
    return img.resize((w * scale, h * scale), Image.NEAREST) if scale > 1 else img


def to_png(frame: Frame, chargen: bytes) -> bytes:
    buf = io.BytesIO()
    render(frame, chargen).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def to_gif(frames: list[tuple[Frame, float]], chargen: bytes) -> bytes:
    """frames = [(frame, seconds shown)]. Shrinks to fit Discord if needed."""
    def build(items, scale):
        images = [render(f, chargen, scale) for f, _ in items]
        durations = [max(20, int(d * 1000)) for _, d in items]
        buf = io.BytesIO()
        images[0].save(buf, format="GIF", save_all=True, append_images=images[1:],
                       duration=durations, loop=0, disposal=1)
        return buf.getvalue()

    items = frames[-GIF_MAX_FRAMES:]
    for scale in (SCALE, 1):
        data = build(items, scale)
        if len(data) <= GIF_MAX_BYTES:
            return data
    while len(items) > 2:
        # Drop every other frame, giving its time to the frame before it.
        items = [(items[i][0], items[i][1] + (items[i + 1][1] if i + 1 < len(items) else 0))
                 for i in range(0, len(items), 2)]
        data = build(items, 1)
        if len(data) <= GIF_MAX_BYTES:
            return data
    return data


def busy(http: httpx.Client, host: str) -> bool | None:
    r = chat.http_readmem(http, host, chat.BUSY_FLAG_ADDR, 1)
    return None if r is None else r[0] != 0


def capture_speech(http: httpx.Client, host: str, gif: bool) -> list[tuple[Frame, float]]:
    """Frames from when the face starts speaking until it stops."""
    start = time.time()
    while busy(http, host) is not True and time.time() - start < SPEAK_START_TIMEOUT:
        time.sleep(0.05)

    frames: list[tuple[Frame, float]] = []
    last_time = time.time()
    speak_start = last_time
    while time.time() - speak_start < SPEAK_MAX_SECONDS:
        frame = read_frame(http, host)
        now = time.time()
        if frame:
            if frames and frames[-1][0].key() == frame.key():
                prev, dur = frames[-1]
                frames[-1] = (prev, dur + (now - last_time))
            else:
                if frames:
                    prev, dur = frames[-1]
                    frames[-1] = (prev, dur + (now - last_time))
                frames.append((frame, 0.0))
            last_time = now
        if busy(http, host) is False:
            break
        time.sleep(FRAME_INTERVAL)

    if frames:
        prev, dur = frames[-1]
        frames[-1] = (prev, dur + 1.5)   # hold the last frame a moment in the GIF
    return frames


def best_screenshot(frames: list[tuple[Frame, float]]) -> Frame:
    """The frame with the most reply text on the ticker (latest one if tied)."""
    best = frames[0][0]
    for frame, _ in frames:
        if frame.ticker_chars() >= best.ticker_chars():
            best = frame
    return best


# ---------- jobs ----------

def plain(text: str) -> str:
    return "".join(ch if 32 <= ord(ch) < 127 else " " for ch in text).strip()


def question_line(job: dict) -> str:
    q = plain(job["question"])
    # drop a leading "lexi," / "hey lexi"
    words = q.split()
    while words and words[0].lower().strip(",.:!?") in ("lexi", "hey", "yo", "hi"):
        words.pop(0)
    q = " ".join(words) or q
    return f"{job['user_name']}: {q}" if job.get("user_name") else q


def claim_job(db: psycopg.Connection) -> dict | None:
    with db.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """UPDATE u64_jobs SET status = 'working', updated_at = now()
               WHERE id = (SELECT id FROM u64_jobs
                           WHERE status = 'pending' AND created_at > now() - make_interval(secs => %s)
                           ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
               RETURNING *""",
            (JOB_MAX_AGE,),
        )
        return cur.fetchone()


def finish_job(db: psycopg.Connection, job_id: int, image: bytes, kind: str) -> None:
    db.execute("UPDATE u64_jobs SET status = 'done', image = %s, image_type = %s, updated_at = now() WHERE id = %s",
               (image, kind, job_id))


def fail_job(db: psycopg.Connection, job_id: int, error: str) -> None:
    db.execute("UPDATE u64_jobs SET status = 'failed', error = %s, updated_at = now() WHERE id = %s",
               (error[:200], job_id))


def run_job(job: dict, http: httpx.Client, host: str, chargen: bytes, stop: threading.Event) -> tuple[bytes, str]:
    gif = job["capture"] == "gif"
    if not chat.wait_until_not_busy(http, host, stop):
        raise RuntimeError("stopped")

    scroll_stop = threading.Event()
    scroll = threading.Thread(target=chat.scroll_input_line,
                              args=(http, host, question_line(job), scroll_stop), daemon=True)
    scroll.start()
    try:
        chat.send_response(http, host, plain(job["reply"])[:chat.MAX_RESPONSE_CHARS])
        frames = capture_speech(http, host, gif)
    finally:
        scroll_stop.set()
        scroll.join(timeout=1.0)

    if not frames:
        raise RuntimeError("couldn't read the C64 screen")
    if gif:
        data = to_gif(frames, chargen)
    else:
        data = to_png(best_screenshot(frames), chargen)
    chat.clear_input_line_display(http, host)
    return data, "gif" if gif else "png"


def heartbeat(url: str, stop: threading.Event) -> None:
    db = None
    while not stop.is_set():
        try:
            db = db or connect(url)
            db.execute(
                """INSERT INTO bot_settings (key, value) VALUES ('u64_bridge_last_seen', %s)
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
                (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),),
            )
        except Exception as e:
            print(f"error: heartbeat: {e}", file=sys.stderr)
            db = None
        stop.wait(HEARTBEAT_INTERVAL)


# ---------- local exchanges and F1/F3 (posted to Discord through u64_events) ----------

state = {"url": None, "host": None, "chargen": None}
gpt_lock = threading.Lock()   # one conversation on the C64 at a time: keyboard, mic, music or Discord


def insert_event(**fields) -> None:
    """Add an event for Lexi to post. Uses its own connection (called from listener threads)."""
    cols = ", ".join(fields)
    marks = ", ".join(["%s"] * len(fields))
    try:
        with connect(state["url"]) as db:
            db.execute(f"INSERT INTO u64_events ({cols}) VALUES ({marks})", tuple(fields.values()))
    except Exception as e:
        print(f"error: posting to Discord: {e}", file=sys.stderr)


def save_mode_state(mic: bool, music: bool) -> None:
    try:
        with connect(state["url"]) as db:
            db.execute(
                """INSERT INTO bot_settings (key, value) VALUES ('u64_state', %s)
                   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value""",
                (json.dumps({"mic": mic, "music": music}),),
            )
    except Exception as e:
        print(f"error: saving F1/F3 state: {e}", file=sys.stderr)


def watch_modes(stop: threading.Event) -> None:
    """Tell Lexi whenever F1 (mic) or F3 (music) is switched on the C64."""
    last = None
    with httpx.Client(timeout=chat.TIMEOUT) as http:
        while not stop.is_set():
            mode = chat.http_readmem(http, state["host"], chat.MODE_FLAG_ADDR, 1)
            music = chat.http_readmem(http, state["host"], chat.MUSIC_ACTIVE_ADDR, 1)
            if mode and music:
                now = (mode[0] == chat.MODE_MIC, music[0] == 1)
                if now != last:
                    save_mode_state(*now)
                    if last is not None:
                        if now[0] != last[0]:
                            print(f"F1: mic {'on' if now[0] else 'off'}")
                            insert_event(kind="mode", source="f1", mic=now[0], music=now[1])
                        if now[1] != last[1]:
                            print(f"F3: music {'on' if now[1] else 'off'}")
                            insert_event(kind="mode", source="f3", mic=now[0], music=now[1])
                    last = now
            stop.wait(MODE_POLL_INTERVAL)


def on_local_reply(user_input: str, reply: str) -> None:
    """chat.py's reply hook: capture the face saying it and post it to Discord (PNG and GIF)."""
    with httpx.Client(timeout=chat.TIMEOUT) as http:
        if user_input.startswith("[music]"):
            source, question = "music", user_input[len("[music]"):].strip()
        else:
            mode = chat.http_readmem(http, state["host"], chat.MODE_FLAG_ADDR, 1)
            source = "mic" if mode and mode[0] == chat.MODE_MIC else "keyboard"
            question = user_input
        frames = capture_speech(http, state["host"], True)
    if not frames:
        return
    png = to_png(best_screenshot(frames), state["chargen"])
    gif = to_gif(frames, state["chargen"])
    insert_event(kind="exchange", source=source, question=plain(question), reply=plain(reply), png=png, gif=gif)
    print(f"posted {source} exchange to Discord")


def start_local_chat(stop: threading.Event) -> None:
    """The same keyboard, F1 mic and F3 music listeners as chat.py."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("warning: OPENAI_API_KEY not set, so C64 keyboard, F1 mic and F3 music are off (Discord still works)")
        return
    openai_client = chat.OpenAI(api_key=api_key)
    history: list = []
    http = httpx.Client(timeout=chat.TIMEOUT)
    chat.ON_REPLY = on_local_reply
    threading.Thread(target=chat.keyboard_listener,
                     args=(openai_client, http, state["host"], history, stop, gpt_lock), daemon=True).start()
    if chat.PYAUDIO_AVAILABLE:
        threading.Thread(target=chat.mic_listener,
                         args=(openai_client, http, state["host"], history, stop, gpt_lock), daemon=True).start()
    else:
        print("warning: pyaudio not installed, mic mode unavailable")
        print("         install with: pip install pyaudio")
    print("F1: toggle mic  F3: start/stop music recording")


# ---------- main ----------

def main() -> int:
    parser = argparse.ArgumentParser(description="Discord bridge for Lexi's commodore 64 persona")
    parser.add_argument("--app", help=f"Lexi's Heroku app (default: saved, or {DEFAULT_APP})")
    parser.add_argument("--no-prg", action="store_true", help="don't load talking_face.prg first")
    parser.add_argument("--snapshot", metavar="FILE", help="save the current C64 screen as a PNG and quit")
    args = parser.parse_args()

    cfg = load_config()
    host = chat.load_or_ask_host()
    cfg = load_config()  # load_or_ask_host may have just saved the host
    chargen = find_chargen(cfg)

    if args.snapshot:
        with httpx.Client(timeout=chat.TIMEOUT) as http:
            frame = read_frame(http, host)
        if not frame:
            print("error: couldn't read the C64 screen", file=sys.stderr)
            return 1
        Path(args.snapshot).write_bytes(to_png(frame, chargen))
        print(f"saved {args.snapshot}")
        return 0

    url = database_url(cfg, args.app)
    state.update(url=url, host=host, chargen=chargen)

    if not args.no_prg:
        prg_path = Path(__file__).parent / "talking_face.prg"
        if prg_path.exists():
            print(f"loading {prg_path.name}...")
            chat.run_prg(host, str(prg_path))
            time.sleep(1.5)
        else:
            print(f"warning: {prg_path.name} not found, skipping")

    stop = threading.Event()
    threading.Thread(target=heartbeat, args=(url, stop), daemon=True).start()
    threading.Thread(target=watch_modes, args=(stop,), daemon=True).start()
    print(f"C64 discord bridge v{VERSION} ({BUILD}). waiting for Lexi and the C64. ctrl-c to quit.")
    start_local_chat(stop)

    db = None
    with httpx.Client(timeout=chat.TIMEOUT) as http:
        try:
            while True:
                try:
                    db = db or connect(url)
                    job = claim_job(db)
                except Exception as e:
                    print(f"error: database: {e}", file=sys.stderr)
                    db = None
                    time.sleep(5)
                    continue
                if not job:
                    time.sleep(JOB_POLL_INTERVAL)
                    continue

                print(f"> {question_line(job)}")
                print(f"< {job['reply']}")
                try:
                    with gpt_lock:
                        image, kind = run_job(job, http, host, chargen, stop)
                    finish_job(db, job["id"], image, kind)
                    print(f"sent {kind} ({len(image) // 1024} KB)")
                except Exception as e:
                    print(f"error: job {job['id']}: {e}", file=sys.stderr)
                    try:
                        fail_job(db, job["id"], str(e))
                    except Exception:
                        db = None
        except KeyboardInterrupt:
            print()
        finally:
            stop.set()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
