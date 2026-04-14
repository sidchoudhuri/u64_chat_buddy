#!/usr/bin/env python3
import os
import sys
import time
import json
import httpx
from pathlib import Path
from openai import OpenAI

VERSION = "0.3.0"
BUILD   = "2026-04-14-1"

CONFIG_PATH = Path(__file__).parent / ".c64_config.json"

SPEAK_TRIGGER_ADDR  = 0xC000
INPUT_READY_ADDR    = 0xC001
INPUT_LEN_ADDR      = 0xC002
BOT_TEXT_ADDR       = 0xC100
INPUT_BUF_ADDR      = 0xC200
TIMEOUT             = 5.0
POLL_INTERVAL       = 0.1
MAX_RESPONSE_CHARS  = 254

SCREEN_CODE_MAP = {
    ' ': 0x20, '!': 0x21, '"': 0x22, '#': 0x23, '$': 0x24,
    '%': 0x25, '&': 0x26, "'": 0x27, '(': 0x28, ')': 0x29,
    '*': 0x2A, '+': 0x2B, ',': 0x2C, '-': 0x2D, '.': 0x2E,
    '/': 0x2F, ':': 0x3A, ';': 0x3B, '<': 0x3C, '=': 0x3D,
    '>': 0x3E, '?': 0x3F,
}

# reverse map: screen code -> ASCII for reading input back from C64
SCREEN_TO_ASCII = {v: k for k, v in SCREEN_CODE_MAP.items()}
for i in range(26):
    SCREEN_TO_ASCII[i + 1] = chr(ord('A') + i)
for i in range(10):
    SCREEN_TO_ASCII[ord('0') + i] = chr(ord('0') + i)

SYSTEM_PROMPT = (
    "You are a Commodore 64 AI assistant displayed on a retro computer screen. "
    "Reply in plain ASCII only — no markdown, no special characters. "
    "Be extremely concise: one or two short sentences maximum, under 200 characters total."
)

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

def send_response(client: httpx.Client, host: str, text: str) -> None:
    data = to_screen_codes(text)
    if len(data) >= 256:
        data = to_screen_codes(text[:MAX_RESPONSE_CHARS])
    http_post_mem(client, host, BOT_TEXT_ADDR, data)
    http_put(client, host, SPEAK_TRIGGER_ADDR, b"\x01")

def run_prg(host: str, prg_path: str) -> None:
    url = f"http://{host}/v1/runners:run_prg"
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            with open(prg_path, "rb") as f:
                r = client.post(url, files={"file": f})
            r.raise_for_status()
    except Exception as e:
        print(f"error: run_prg: {e}", file=sys.stderr)

def parse_args():
    args = sys.argv[1:]
    prg_path = None
    while args:
        if args[0] == "--run-prg" and len(args) > 1:
            prg_path = args[1]
            args = args[2:]
        else:
            break
    return prg_path

def main() -> int:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("error: OPENAI_API_KEY not set", file=sys.stderr)
        return 1

    host = load_or_ask_host()
    prg_path = parse_args()

    if prg_path:
        print(f"loading {prg_path}...")
        run_prg(host, prg_path)
        time.sleep(1.5)

    openai_client = OpenAI(api_key=api_key)
    history = []

    print(f"C64 face chat v{VERSION} ({BUILD}). waiting for C64 input. ctrl-c to quit.\n")

    with httpx.Client(timeout=TIMEOUT) as http:
        while True:
            try:
                result = http_readmem(http, host, INPUT_READY_ADDR, 1)
                if result is None:
                    time.sleep(POLL_INTERVAL)
                    continue

                if result[0] != 1:
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

                # clear ready flag so C64 can accept new input
                http_put(http, host, INPUT_READY_ADDR, b"\x00")

                user_input = screen_codes_to_ascii(buf).strip()
                if not user_input:
                    continue

                print(f"> {user_input}")

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
                    continue

                print()
                reply = "".join(reply_chunks).strip()

                if len(reply) > MAX_RESPONSE_CHARS:
                    reply = reply[:MAX_RESPONSE_CHARS]

                history.append({"role": "assistant", "content": reply})

                send_response(http, host, reply)

            except KeyboardInterrupt:
                print()
                break

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
