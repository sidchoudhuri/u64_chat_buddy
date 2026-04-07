#!/usr/bin/env python3
import argparse
import subprocess
import sys

DEFAULT_HOST = "192.168.2.60"
TEXT_ADDR = 0xC100
TRIGGER_ADDR = 0xC003

def to_screen_codes(text: str) -> bytes:
    out = bytearray()

    for ch in text.upper():
        if ch == " ":
            out.append(0x20)
        elif "A" <= ch <= "Z":
            out.append(ord(ch) - 64)   # A=1 ... Z=26
        elif "0" <= ch <= "9":
            out.append(ord(ch))        # digits display correctly
        else:
            out.append(0x20)           # punctuation -> space for now

    out.append(0x00)
    return bytes(out)

def curl_put(host: str, address: int, data: bytes) -> None:
    url = (
        f"http://{host}/v1/machine:writemem"
        f"?address={address:04X}&data={data.hex().upper()}"
    )
    subprocess.run(["curl", "-s", "-X", "PUT", url], check=True)

def run_prg(host: str, prg_path: str) -> None:
    subprocess.run(
        ["curl", "-s", "-F", f"file=@{prg_path}", f"http://{host}/v1/runners:run_prg"],
        check=True,
    )

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("text", nargs="+")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--run-prg")
    args = parser.parse_args()

    text = " ".join(args.text)
    data = to_screen_codes(text)

    if len(data) > 256:
        print("text too long", file=sys.stderr)
        return 1

    if args.run_prg:
        run_prg(args.host, args.run_prg)

    curl_put(args.host, TEXT_ADDR, data)
    curl_put(args.host, TRIGGER_ADDR, b"\x01")
    print(text)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
