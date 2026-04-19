#!/usr/bin/env python3
import os
import sys
import time
import json
import threading
import tempfile
import wave
import httpx
from pathlib import Path
from openai import OpenAI

try:
    import pyaudio
    PYAUDIO_AVAILABLE = True
except ImportError:
    PYAUDIO_AVAILABLE = False

VERSION = "0.4.3"
BUILD   = "2026-04-19-1"

CONFIG_PATH = Path(__file__).parent / ".c64_config.json"

SPEAK_TRIGGER_ADDR  = 0xC000
INPUT_READY_ADDR    = 0xC001
INPUT_LEN_ADDR      = 0xC002
MUSIC_TRIGGER_ADDR  = 0xC003
MODE_FLAG_ADDR      = 0xC004
BUSY_FLAG_ADDR      = 0xC005
BOT_TEXT_ADDR       = 0xC100
INPUT_BUF_ADDR      = 0xC200

TIMEOUT             = 5.0
POLL_INTERVAL       = 0.05
MAX_RESPONSE_CHARS  = 254
BUSY_POLL_INTERVAL  = 0.1
SCROLL_INTERVAL     = 0.12

# mic settings
MIC_SAMPLE_RATE     = 16000
MIC_CHANNELS        = 1
MIC_CHUNK           = 1024
SILENCE_THRESHOLD   = 1500
SILENCE_DURATION    = 1.0
MIN_SPEECH_DURATION = 0.5
MIN_SPEECH_RMS      = 800
MUSIC_CLIP_DURATION = 10.0

MODE_KBD = 0
MODE_MIC = 1

SCREEN_CODE_MAP = {
    ' ': 0x20, '!': 0x21, '"': 0x22, '#': 0x23, '$': 0x24,
    '%': 0x25, '&': 0x26, "'": 0x27, '(': 0x28, ')': 0x29,
    '*': 0x2A, '+': 0x2B, ',': 0x2C, '-': 0x2D, '.': 0x2E,
    '/': 0x2F, ':': 0x3A, ';': 0x3B, '<': 0x3C, '=': 0x3D,
    '>': 0x3E, '?': 0x3F,
}

SCREEN_TO_ASCII = {v: k for k, v in SCREEN_CODE_MAP.items()}
for i in range(26):
    SCREEN_TO_ASCII[i + 1] = chr(ord('A') + i)
for i in range(10):
    SCREEN_TO_ASCII[ord('0') + i] = chr(ord('0') + i)

SYSTEM_PROMPT = (
    "You are a Commodore 64 AI assistant displayed on a retro computer screen. "
    "Reply in plain ASCII only — no markdown, no special characters. "
    "Be extremely concise: one or two short sentences maximum, under 200 characters total. "
    "When you receive a [music] message, react naturally to what you hear as if listening along."
)

WHISPER_MUSIC_PROMPT = "Song lyrics, singing, music."

def load_or_ask_host() -> str:
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text())
            if "host" in cfg:
                return cfg["host"]
        except Exception:
            pass

    host = input("C64 host IP address: ").strip()
    if not host:
        host = "192.168.2.64"

    CONFIG_PATH.write_text(json.dumps({"host": host}, indent=2))
    print(f"saved to {CONFIG_PATH}")
    return host

def to_screen_codes(text: str) -> bytes:
    out = bytearray()
    for ch in text.upper():
        if 'A' <= ch <= 'Z':
            out.append(ord(ch) - 64)
        elif '0' <= ch <= '9':
            out.append(ord(ch))
        elif ch in SCREEN_CODE_MAP:
            out.append(SCREEN_CODE_MAP[ch])
        else:
            out.append(0x20)
    out.append(0x00)
    return bytes(out)

def screen_codes_to_ascii(data: bytes) -> str:
    return ''.join(SCREEN_TO_ASCII.get(b, '?') for b in data)

def http_put(client: httpx.Client, host: str, address: int, data: bytes) -> None:
    url = (
        f"http://{host}/v1/machine:writemem"
        f"?address={address:04X}&data={data.hex().upper()}"
    )
    try:
        r = client.put(url)
        r.raise_for_status()
    except Exception as e:
        print(f"error: PUT to {address:04X}: {e}", file=sys.stderr)

def http_post_mem(client: httpx.Client, host: str, address: int, data: bytes) -> None:
    url = f"http://{host}/v1/machine:writemem?address={address:04X}"
    try:
        r = client.post(url, content=data,
                        headers={"Content-Type": "application/octet-stream"})
        r.raise_for_status()
    except Exception as e:
        print(f"error: POST to {address:04X}: {e}", file=sys.stderr)

def http_readmem(client: httpx.Client, host: str,
                 address: int, length: int) -> bytes | None:
    url = f"http://{host}/v1/machine:readmem?address={address:04X}&length={length}"
    try:
        r = client.get(url)
        r.raise_for_status()
        return r.content
    except Exception as e:
        print(f"error: readmem {address:04X}: {e}", file=sys.stderr)
        return None

def wait_until_not_busy(client: httpx.Client, host: str,
                        stop_event: threading.Event) -> bool:
    while not stop_event.is_set():
        result = http_readmem(client, host, BUSY_FLAG_ADDR, 1)
        if result is not None and result[0] == 0:
            return True
        time.sleep(BUSY_POLL_INTERVAL)
    return False

def send_response(client: httpx.Client, host: str, text: str) -> None:
    data = to_screen_codes(text)
    if len(data) >= 256:
        data = to_screen_codes(text[:MAX_RESPONSE_CHARS])
    http_post_mem(client, host, BOT_TEXT_ADDR, data)
    http_put(client, host, SPEAK_TRIGGER_ADDR, b"\x01")

def send_to_top_ticker(client: httpx.Client, host: str, text: str) -> None:
    data = to_screen_codes(text)
    if len(data) >= 256:
        data = to_screen_codes(text[:MAX_RESPONSE_CHARS])
    http_post_mem(client, host, INPUT_BUF_ADDR, data[:-1])
    length = len(data) - 1
    http_put(client, host, INPUT_LEN_ADDR, bytes([length]))
    http_put(client, host, INPUT_READY_ADDR, b"\x01")

# row 1 screen RAM = $0400 + 40 = $0428
# row 1 color RAM  = $D800 + 40 = $D828
INPUT_LINE_SCR_ADDR = 0x0428
INPUT_LINE_COL_ADDR = 0xD828
INPUT_LINE_COLOR    = 0x0e     # light blue, same as col_top_text

def display_on_input_line(client: httpx.Client, host: str, text: str) -> None:
    codes = bytearray()
    for ch in text.upper():
        if 'A' <= ch <= 'Z':
            codes.append(ord(ch) - 64)
        elif '0' <= ch <= '9':
            codes.append(ord(ch))
        elif ch in SCREEN_CODE_MAP:
            codes.append(SCREEN_CODE_MAP[ch])
        else:
            codes.append(0x20)

    codes = codes[:40]
    while len(codes) < 40:
        codes.append(0x20)

    color = bytes([INPUT_LINE_COLOR] * 40)
    http_put(client, host, INPUT_LINE_SCR_ADDR, bytes(codes))
    http_put(client, host, INPUT_LINE_COL_ADDR, color)

def clear_input_line_display(client: httpx.Client, host: str) -> None:
    http_put(client, host, INPUT_LINE_SCR_ADDR, bytes([0x20] * 40))
    http_put(client, host, INPUT_LINE_COL_ADDR, bytes([INPUT_LINE_COLOR] * 40))

def scroll_input_line(client: httpx.Client, host: str, text: str,
                      stop_event: threading.Event) -> None:
    text = text[:80]
    if len(text) <= 40:
        display_on_input_line(client, host, text)
        return
    for i in range(len(text) - 39):
        if stop_event.is_set():
            return
        display_on_input_line(client, host, text[i:i + 40])
        time.sleep(SCROLL_INTERVAL)

def run_prg(host: str, prg_path: str) -> None:
    url = f"http://{host}/v1/runners:run_prg"
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            with open(prg_path, "rb") as f:
                r = client.post(url, files={"file": f})
            r.raise_for_status()
    except Exception as e:
        print(f"error: run_prg: {e}", file=sys.stderr)

def rms(data: bytes) -> float:
    import struct
    count = len(data) // 2
    if count == 0:
        return 0.0
    samples = struct.unpack(f"{count}h", data)
    return (sum(s * s for s in samples) / count) ** 0.5

WHISPER_HALLUCINATIONS = {
    "thank you for watching",
    "thanks for watching",
    "please like and subscribe",
    "don't forget to subscribe",
    "see you in the next video",
    "ご視聴ありがとうございました",
}

WHISPER_PROMPT = (
    "User speaking a short question or command to a Commodore 64 computer."
)

def mean_rms(frames: list) -> float:
    all_data = b''.join(frames)
    return rms(all_data)

def transcribe(openai_client: OpenAI, audio_frames: list, sample_rate: int) -> str | None:
    if mean_rms(audio_frames) < MIN_SPEECH_RMS:
        print("skipped: low energy")
        return None

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp_path = f.name

    with wave.open(tmp_path, 'wb') as wf:
        wf.setnchannels(MIC_CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(b''.join(audio_frames))

    try:
        with open(tmp_path, "rb") as audio_file:
            result = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                prompt=WHISPER_PROMPT,
            )
        text = result.text.strip()
        if text.lower().rstrip("!.") in WHISPER_HALLUCINATIONS:
            print(f"skipped: hallucination detected ({text!r})")
            return None
        return text
    except Exception as e:
        print(f"error: whisper: {e}", file=sys.stderr)
        return None
    finally:
        Path(tmp_path).unlink(missing_ok=True)

def record_clip(stream, duration: float) -> list:
    chunks = int(duration * MIC_SAMPLE_RATE / MIC_CHUNK)
    return [stream.read(MIC_CHUNK, exception_on_overflow=False) for _ in range(chunks)]

def transcribe_music(openai_client: OpenAI, frames: list) -> str | None:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp_path = f.name
    with wave.open(tmp_path, 'wb') as wf:
        wf.setnchannels(MIC_CHANNELS)
        wf.setsampwidth(2)
        wf.setframerate(MIC_SAMPLE_RATE)
        wf.writeframes(b''.join(frames))
    try:
        with open(tmp_path, "rb") as audio_file:
            result = openai_client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                prompt=WHISPER_MUSIC_PROMPT,
            )
        return result.text.strip() or None
    except Exception as e:
        print(f"error: whisper: {e}", file=sys.stderr)
        return None
    finally:
        Path(tmp_path).unlink(missing_ok=True)

def energy_desc(frames: list) -> str:
    level = mean_rms(frames)
    if level > 2000: return "intense"
    if level > 1000: return "lively"
    if level > 400:  return "mellow"
    return "quiet"

def handle_music_clip(openai_client: OpenAI, http: httpx.Client, host: str,
                      history: list, stop_event: threading.Event,
                      gpt_lock: threading.Lock, stream) -> None:
    print("recording...")
    display_on_input_line(http, host, "listening...")
    frames = record_clip(stream, MUSIC_CLIP_DURATION)

    lyrics = transcribe_music(openai_client, frames)
    mood = energy_desc(frames)

    if lyrics:
        user_msg = f"[music] {mood} — \"{lyrics}\""
    else:
        user_msg = f"[music] {mood}"

    print(f"> {user_msg}")

    scroll_stop = threading.Event()
    scroll_thread = threading.Thread(
        target=scroll_input_line,
        args=(http, host, lyrics or mood, scroll_stop),
        daemon=True,
    )
    scroll_thread.start()
    with gpt_lock:
        process_input(user_msg, openai_client, http, host, history, stop_event)
    scroll_stop.set()
    scroll_thread.join(timeout=1.0)
    clear_input_line_display(http, host)

def process_input(user_input: str, openai_client: OpenAI,
                  http: httpx.Client, host: str, history: list,
                  stop_event: threading.Event) -> None:
    if not wait_until_not_busy(http, host, stop_event):
        return

    history.append({"role": "user", "content": user_input})
    print("< ", end="", flush=True)
    reply_chunks = []

    try:
        with openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": SYSTEM_PROMPT}] + history,
            max_tokens=120,
            stream=True,
        ) as stream:
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    print(delta, end="", flush=True)
                    reply_chunks.append(delta)
    except Exception as e:
        print(f"\nerror: OpenAI: {e}", file=sys.stderr)
        history.pop()
        return

    print()
    reply = "".join(reply_chunks).strip()
    if len(reply) > MAX_RESPONSE_CHARS:
        reply = reply[:MAX_RESPONSE_CHARS]

    history.append({"role": "assistant", "content": reply})
    send_response(http, host, reply)

def mic_listener(openai_client: OpenAI, http: httpx.Client, host: str,
                 history: list, stop_event: threading.Event,
                 gpt_lock: threading.Lock) -> None:
    import pyaudio as pa

    audio = pa.PyAudio()
    stream = audio.open(
        format=pa.paInt16,
        channels=MIC_CHANNELS,
        rate=MIC_SAMPLE_RATE,
        input=True,
        frames_per_buffer=MIC_CHUNK,
    )

    print("mic listener started")

    while not stop_event.is_set():
        music = http_readmem(http, host, MUSIC_TRIGGER_ADDR, 1)
        if music and music[0] == 1:
            http_put(http, host, MUSIC_TRIGGER_ADDR, b"\x00")
            handle_music_clip(openai_client, http, host, history, stop_event, gpt_lock, stream)
            continue

        result = http_readmem(http, host, MODE_FLAG_ADDR, 1)
        if result is None or result[0] != MODE_MIC:
            time.sleep(0.1)
            continue

        recording = False
        frames = []
        silence_start = None
        speech_start = None

        while not stop_event.is_set():
            result = http_readmem(http, host, MODE_FLAG_ADDR, 1)
            if result is None or result[0] != MODE_MIC:
                break

            data = stream.read(MIC_CHUNK, exception_on_overflow=False)
            level = rms(data)

            if level > SILENCE_THRESHOLD:
                if not recording:
                    recording = True
                    speech_start = time.time()
                    frames = []
                    print("listening...")
                frames.append(data)
                silence_start = None
            else:
                if recording:
                    frames.append(data)
                    if silence_start is None:
                        silence_start = time.time()
                    elif time.time() - silence_start >= SILENCE_DURATION:
                        speech_duration = time.time() - speech_start
                        if speech_duration >= MIN_SPEECH_DURATION:
                            print("transcribing...")
                            text = transcribe(openai_client, frames, MIC_SAMPLE_RATE)
                            if text:
                                print(f"> {text}")
                                scroll_stop = threading.Event()
                                scroll_thread = threading.Thread(
                                    target=scroll_input_line,
                                    args=(http, host, text, scroll_stop),
                                    daemon=True,
                                )
                                scroll_thread.start()
                                with gpt_lock:
                                    process_input(
                                        text, openai_client, http, host,
                                        history, stop_event
                                    )
                                scroll_stop.set()
                                scroll_thread.join(timeout=1.0)
                                clear_input_line_display(http, host)
                        recording = False
                        frames = []
                        silence_start = None
                        speech_start = None

    stream.stop_stream()
    stream.close()
    audio.terminate()
    print("mic listener stopped")

def main() -> int:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("error: OPENAI_API_KEY not set", file=sys.stderr)
        return 1

    if not PYAUDIO_AVAILABLE:
        print("warning: pyaudio not installed, mic mode unavailable")
        print("         install with: pip install pyaudio")

    host = load_or_ask_host()

    prg_path = Path(__file__).parent / "talking_face.prg"
    if prg_path.exists():
        print(f"loading {prg_path.name}...")
        run_prg(host, str(prg_path))
        time.sleep(1.5)
    else:
        print(f"warning: {prg_path.name} not found, skipping")

    openai_client = OpenAI(api_key=api_key)
    history = []
    gpt_lock = threading.Lock()
    stop_event = threading.Event()

    print(f"C64 face chat v{VERSION} ({BUILD}). waiting for C64 input. ctrl-c to quit.")
    print(f"press F1 on C64 to toggle mic mode.\n")

    with httpx.Client(timeout=TIMEOUT) as http:
        mic_thread = None
        if PYAUDIO_AVAILABLE:
            mic_thread = threading.Thread(
                target=mic_listener,
                args=(openai_client, http, host, history, stop_event, gpt_lock),
                daemon=True,
            )
            mic_thread.start()

        try:
            while True:
                result = http_readmem(http, host, INPUT_READY_ADDR, 1)
                if result is None:
                    time.sleep(POLL_INTERVAL)
                    continue

                if result[0] != 1:
                    time.sleep(POLL_INTERVAL)
                    continue

                mode = http_readmem(http, host, MODE_FLAG_ADDR, 1)
                if mode and mode[0] == MODE_MIC:
                    time.sleep(POLL_INTERVAL)
                    continue

                len_result = http_readmem(http, host, INPUT_LEN_ADDR, 1)
                if len_result is None or len_result[0] == 0:
                    http_put(http, host, INPUT_READY_ADDR, b"\x00")
                    time.sleep(POLL_INTERVAL)
                    continue

                input_length = len_result[0]
                buf = http_readmem(http, host, INPUT_BUF_ADDR, input_length)
                if buf is None:
                    http_put(http, host, INPUT_READY_ADDR, b"\x00")
                    time.sleep(POLL_INTERVAL)
                    continue

                http_put(http, host, INPUT_READY_ADDR, b"\x00")

                user_input = screen_codes_to_ascii(buf).strip()
                if not user_input:
                    continue

                print(f"> {user_input}")
                with gpt_lock:
                    process_input(user_input, openai_client, http, host,
                                  history, stop_event)

        except KeyboardInterrupt:
            print()
        finally:
            stop_event.set()
            if mic_thread:
                mic_thread.join(timeout=2.0)

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
