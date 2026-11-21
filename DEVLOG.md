# u64_chat_buddy devlog

## 2026-11-21 - Chat Buddy 1.0.3

- **Microphone really fixed on the Mac:** the app is now signed with permission to use the microphone. Without it, macOS turned the microphone down silently, never asked, and never added Chat Buddy to the Microphone list. If you tried 1.0.2, run `tccutil reset Microphone de.m0n.chatbuddy` once in Terminal, then press Start and choose Allow.
- **Build hardening:** the build now uses pinned, current versions of its tools and Node 26.

## 2026-11-21 - Chat Buddy 1.0.2

- **Microphone fixed on the Mac:** Chat Buddy now asks for microphone access the first time you press Start. Before, macOS was never asked, so the app wasn't in the Microphone list and F1 mic mode and F3 music mode only heard silence.
- **Mic light:** a new status light next to C64 and OpenAI shows whether the microphone is working.
- **Helpful warnings:** if access is refused, or the microphone gives only silence, the window says so, with a button that opens the Microphone settings.

## 2026-11-21 - Chat Buddy 1.0.1

- **Live view:** the C64's screen now shows in the app while Chat Buddy runs, straight from the Ultimate's own video stream, the same way as Viz. Switch it off with the "Live view from the Ultimate" box.
- **If no picture arrives** (the Ultimate only streams over wired Ethernet, and your firewall must allow UDP port 11000), Chat Buddy says why and offers to draw the screen from the C64's screen memory instead. That needs the character ROM from Setup.
- **Save screenshot** saves what the live view shows, so it no longer needs the character ROM.

## 2026-11-20 - Chat Buddy 1.0.0

The talking face is now an app, **Chat Buddy**, for Mac (Apple silicon and Intel) and Windows.

- **Setup that walks you through it:** your Ultimate's IP address (with a test button), your OpenAI key (kept in the system keychain) and, optionally, the C64 character ROM from VICE for screenshots.
- **Start and talk:** the talking face is built in and loads onto the C64. Type on the C64, press F1 to talk, or F3 for music mode, the same as `chat.py`.
- **Watch it in the app:** the conversation appears as it happens, with the C64's mode (keyboard, mic, music, speaking) and a Save screenshot button.
- **Nothing else to install:** the Python part comes inside the app.
- **Updates itself:** it checks for new versions on launch and from Check for Updates….

## 2026-11-20 - Discord bridge 0.2.2

Lexi now shows all the C64's pictures in one live message per channel, which follows that channel's screenshot or GIF setting. So keyboard and mic exchanges send both a screenshot and a GIF again. Music comments stay text only.

## 2026-11-20 - Discord bridge 0.2.1

Posting a GIF to Discord for every local exchange was far too much. Lexi now shows C64 activity in a single live message that updates in place, so the bridge sends less:
- keyboard and mic exchanges: one screenshot, no GIF
- music comments: text only, with no screen capture at all

Discord-asked questions still get a screenshot or GIF as before.

## 2026-11-20 - Discord bridge 0.2.0, chat.py 0.4.5

**The bridge now does everything chat.py does.** With 0.1.0 running, pressing F1 switched the C64 to MIC but nothing was listening, because the mic, music and keyboard handling only lived in `chat.py`. Now the bridge runs those same listeners, so typing on the C64, F1 mic mode and F3 music mode all work while it's connected to Discord. `chat.py` stays the version without Discord.

**chat.py 0.4.5.** The keyboard loop moved into a `keyboard_listener()` function so the bridge can share it, and there's an `ON_REPLY` hook that runs after each reply is sent. Nothing changes when you run `chat.py` on its own.

**F1/F3 in Discord.**
- The bridge watches the mode and music flags and tells Lexi when they change.
- Lexi posts an embed for each switch and shows the current mode in her status line, e.g. `C64: MIC + MUSIC`.

**Local conversations in Discord.**
- Questions typed or spoken at the C64, and the face's music comments, are captured as a screenshot and a GIF.
- Lexi posts them in the commodore 64 channels, using each channel's screenshot/gif choice.

**Taking turns.** Discord jobs and local conversations share one lock, so the face only ever answers one thing at a time.

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
