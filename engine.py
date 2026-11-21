#!/usr/bin/env python3
"""Chat Buddy engine: what the Chat Buddy app runs behind the scenes.

It's chat.py and discord_bridge.py without the terminal. The app passes everything in
(no questions asked), and the engine reports back as JSON lines on stdout:

  {"type": "log", "text": "..."}          anything chat.py / the bridge prints
  {"type": "status", ...}                 C64 reachable, F1 mic, F3 music, speaking, Discord
  {"type": "result", ...}                 the answer to "test" and "snapshot"

  engine.py test --host 192.168.2.64
  engine.py snapshot --host 192.168.2.64 --chargen PATH --out screen.png
  engine.py run --config config.json      (OPENAI_API_KEY in the environment)
  engine.py watch --host 192.168.2.64 --chargen PATH
                                          the screen drawn from screen memory a few times a
                                          second, as {"type": "frame", "png": base64}, until
                                          stdin closes (the live view's fallback)
"""
import argparse
import io
import json
import os
import sys
import threading
import time
from pathlib import Path

ENGINE_VERSION = "1.0.1"

_out = sys.stdout  # the real stdout, for JSON lines
_lock = threading.Lock()


def emit(kind: str, **data) -> None:
    line = json.dumps({"type": kind, **data}, ensure_ascii=False)
    with _lock:
        _out.write(line + "\n")
        _out.flush()


class LineEmitter(io.TextIOBase):
    """Turns print() output from chat.py / the bridge into log events."""

    def __init__(self, kind: str):
        self.kind, self.buf = kind, ""

    def write(self, s: str) -> int:
        self.buf += s
        while "\n" in self.buf:
            line, self.buf = self.buf.split("\n", 1)
            if line.strip():
                emit("log", level=self.kind, text=line.rstrip())
        return len(s)

    def flush(self) -> None:
        pass


sys.stdout = LineEmitter("info")
sys.stderr = LineEmitter("error")

import httpx  # noqa: E402
import chat  # noqa: E402
import discord_bridge as bridge  # noqa: E402


# ---------- test / snapshot ----------

def test_host(host: str) -> None:
    try:
        with httpx.Client(timeout=4.0) as http:
            r = http.get(f"http://{host}/v1/version")
            if r.status_code == 200:
                emit("result", ok=True, detail=r.text.strip())
                return
            # some firmware may not have /v1/version: a memory read proves it's an Ultimate too
            m = http.get(f"http://{host}/v1/machine:readmem?address=C005&length=1")
            ok = m.status_code == 200
            emit("result", ok=ok, detail="Connected." if ok else f"The Ultimate answered {r.status_code}.")
    except Exception as e:
        emit("result", ok=False, detail=f"No answer from {host} ({e.__class__.__name__}).")


def snapshot(host: str, chargen_path: str, out: str) -> None:
    try:
        chargen = Path(chargen_path).read_bytes()
        if len(chargen) != 4096:
            raise ValueError("the character ROM must be 4096 bytes")
        with httpx.Client(timeout=chat.TIMEOUT) as http:
            frame = bridge.read_frame(http, host)
        if not frame:
            raise RuntimeError("couldn't read the C64 screen")
        Path(out).write_bytes(bridge.to_png(frame, chargen))
        emit("result", ok=True, detail=out)
    except Exception as e:
        emit("result", ok=False, detail=str(e))


def watch(host: str, chargen_path: str) -> None:
    """Fallback for the live view: draw the screen from screen and colour memory."""
    import base64
    try:
        chargen = Path(chargen_path).read_bytes()
        if len(chargen) != 4096:
            raise ValueError("the character ROM must be 4096 bytes")
    except Exception as e:
        emit("result", ok=False, detail=str(e))
        return
    stop = threading.Event()
    threading.Thread(target=lambda: (sys.stdin.read(), stop.set()), daemon=True).start()
    last = None
    with httpx.Client(timeout=chat.TIMEOUT) as http:
        while not stop.is_set():
            frame = bridge.read_frame(http, host)
            if frame and frame.key() != last:
                last = frame.key()
                emit("frame", png=base64.b64encode(bridge.to_png(frame, chargen)).decode())
            elif not frame:
                emit("frame", error="couldn't read the C64 screen")
            stop.wait(0.3)


# ---------- run ----------

def watch_status(host: str, stop: threading.Event, discord: bool) -> None:
    """Report the C64's state to the app whenever it changes."""
    last = None
    with httpx.Client(timeout=2.0) as http:
        while not stop.is_set():
            flags = chat.http_readmem(http, host, chat.MUSIC_ACTIVE_ADDR, 3)  # $C003 music, $C004 mode, $C005 busy
            now = {
                "c64": flags is not None and len(flags) >= 3,
                "music": bool(flags and len(flags) >= 3 and flags[0] == 1),
                "mic": bool(flags and len(flags) >= 3 and flags[1] == chat.MODE_MIC),
                "speaking": bool(flags and len(flags) >= 3 and flags[2] != 0),
                "discord": discord,
            }
            if now != last:
                emit("status", **now)
                last = now
            stop.wait(0.5)


def serve_discord_jobs(url: str, host: str, chargen: bytes, stop: threading.Event) -> None:
    """Lexi's questions from Discord (the same loop as discord_bridge.py)."""
    db = None
    with httpx.Client(timeout=chat.TIMEOUT) as http:
        while not stop.is_set():
            try:
                db = db or bridge.connect(url)
                job = bridge.claim_job(db)
            except Exception as e:
                print(f"error: database: {e}", file=sys.stderr)
                db = None
                stop.wait(5)
                continue
            if not job:
                stop.wait(bridge.JOB_POLL_INTERVAL)
                continue
            print(f"> {bridge.question_line(job)}")
            print(f"< {job['reply']}")
            try:
                with bridge.gpt_lock:
                    image, kind = bridge.run_job(job, http, host, chargen, stop)
                bridge.finish_job(db, job["id"], image, kind)
            except Exception as e:
                print(f"error: job {job['id']}: {e}", file=sys.stderr)
                try:
                    bridge.fail_job(db, job["id"], str(e))
                except Exception:
                    db = None


def run(cfg: dict) -> None:
    host = cfg["host"]
    stop = threading.Event()
    discord_url = cfg.get("discordUrl") or None
    chargen = None
    if cfg.get("chargen") and Path(cfg["chargen"]).is_file():
        chargen = Path(cfg["chargen"]).read_bytes()

    if cfg.get("loadFace", True) and cfg.get("prg") and Path(cfg["prg"]).is_file():
        print("loading the talking face...")
        chat.run_prg(host, cfg["prg"])
        time.sleep(1.5)

    threading.Thread(target=watch_status, args=(host, stop, bool(discord_url)), daemon=True).start()

    if discord_url:
        if not chargen:
            print("error: Discord needs the character ROM for screenshots", file=sys.stderr)
            discord_url = None
        else:
            bridge.state.update(url=discord_url, host=host, chargen=chargen)
            threading.Thread(target=bridge.heartbeat, args=(discord_url, stop), daemon=True).start()
            threading.Thread(target=bridge.watch_modes, args=(stop,), daemon=True).start()
            threading.Thread(target=serve_discord_jobs, args=(discord_url, host, chargen, stop), daemon=True).start()
            print("connected to Lexi")

    bridge.state["host"] = host
    bridge.start_local_chat(stop)       # keyboard, F1 mic, F3 music (needs OPENAI_API_KEY)
    if not discord_url:
        chat.ON_REPLY = None            # local chats stay local without Discord

    emit("status", c64=True, mic=False, music=False, speaking=False, discord=bool(discord_url), started=True)
    # Run until the app closes our stdin (or kills us).
    try:
        for _ in iter(sys.stdin.readline, ""):
            pass
    finally:
        stop.set()


def main() -> int:
    p = argparse.ArgumentParser(description="Chat Buddy engine")
    p.add_argument("mode", choices=["test", "snapshot", "run", "watch", "version"])
    p.add_argument("--host")
    p.add_argument("--chargen")
    p.add_argument("--out")
    p.add_argument("--config")
    a = p.parse_args()
    if a.mode == "version":
        emit("result", ok=True, engine=ENGINE_VERSION, chat=chat.VERSION, bridge=bridge.VERSION)
    elif a.mode == "test":
        test_host(a.host)
    elif a.mode == "snapshot":
        snapshot(a.host, a.chargen, a.out)
    elif a.mode == "watch":
        watch(a.host, a.chargen)
    else:
        run(json.loads(Path(a.config).read_text()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
