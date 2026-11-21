# u64_chat_buddy devlog

## 2026-11-20 - Discord bridge 0.1.0

The talking face can now talk on Discord. Lexi, my Discord bot, has a **commodore 64** personality, and when someone talks to her with it switched on, the real C64 says the reply.

**How it fits together.**
- Lexi runs on Heroku and can't reach the C64 on my network, so `discord_bridge.py` runs next to it.
- The two meet in Lexi's Heroku Postgres database. Lexi writes the question and the ChatGPT reply into a `u64_jobs` table.
- The bridge picks the job up, scrolls "name: question" on row 1 and sends the reply to the bottom ticker so the face speaks it.
- It captures the screen while the face talks and writes the image back.
- Lexi posts the image as an embed with the reply underneath.
- Nothing on my network is exposed: the bridge only makes outgoing connections.

**Screenshots.**
- The U64 API has no screenshot call, so the bridge reads screen RAM, colour RAM, the border and background colours and `$D018`, then draws the screen itself with the real character ROM from VICE.
- In screenshot mode it picks the frame where the ticker shows the most reply text.
- In GIF mode it records the whole reply scrolling past, and shrinks the GIF if needed to stay under 8 MB.
- Switch modes from Discord with `lexi personality commodore 64 gif` / `screenshot`.

**Offline detection.** The bridge checks in every 5 seconds so Lexi knows whether the C64 is there. If it isn't, she answers in text and says the C64 is offline.

**Extras.** `--snapshot screen.png` saves the current screen, which is handy for checking the font and colours.

## Up to 2026-04-19 - talking face 0.4.4

Earlier work, before this log started (`chat.py` and `talking_face.asm` 0.4.4, build 2026-04-19-1):

- Animated talking face with eyes that follow the text, a SID chirp voice and PAL/NTSC detection
- ChatGPT replies scroll on the bottom ticker while the face speaks them
- Typed input on the C64 keyboard; the C64 and `chat.py` talk through the `$C000-$C005` flags over the Ultimate 64 REST API
- Busy flag so a new reply doesn't interrupt one being spoken
- F1 mic mode with Whisper transcription (with hallucination filtering) and the transcribed text scrolling on row 1
- F3 music mode: the face listens along and comments now and then
- A camera experiment that was tried and reverted
