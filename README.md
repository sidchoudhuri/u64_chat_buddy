# Talking Face ASM Tuning Guide

This README is a quick map of the main parts of the `talking_face.asm` file that you can adjust.

- [Eyes](#eyes)
- [Mouth](#mouth)
- [Scrolling Text](#scrolling-text)
- [Speech / Sound](#speech--sound)
- [Video Timing](#video-timing)
- [Mic Mode & Transcription](#mic-mode-and-transcription)
- [Music Mode](#music-mode)
- [Discord Bridge (Lexi)](#discord-bridge-lexi)
- [Problems & Solutions](#scrolling-text)
- [Build / Test Cycle](#build--test-cycle)
- [Safe Things To Tweak](#safe-first-things-to-tweak)

## Eyes

### Eye characters
These constants control what the eye white and eyeball look like:

```asm
ch_eye_white    = $e6
ch_eye_ball     = $51
```

### Eye position
These control where the eyes are drawn:

```asm
left_eye_scr    = screen + (8*40) + 12
right_eye_scr   = screen + (8*40) + 24
left_eye_col    = color  + (8*40) + 12
right_eye_col   = color  + (8*40) + 24
```

How to think about those numbers:
- `8*40` = row 8
- `+12` and `+24` = starting columns

Change the row number to move both eyes up or down.
Change the column numbers to move them left or right.

### Eye colors

```asm
col_eye_white   = $0f
col_eye_ball    = $00
```

### What the eyes follow
This routine decides which visible text position the eyes care about:

```asm
find_eye_target
```

This routine turns that ticker column into left / center / right eye direction:

```asm
set_eyes_from_eye_col
```

Inside `set_eyes_from_eye_col`, these thresholds matter:

```asm
cmp #13
cmp #27
```

That means:
- columns `0–12` -> look left
- columns `13–26` -> look center
- columns `27–39` -> look right

## Mouth

### Mouth characters
These are the two mouth states:

```asm
ch_mouth_a      = $5f
ch_mouth_b      = $69
```

### Mouth position

```asm
mouth_scr       = screen + (14*40) + 17
mouth_col       = color  + (14*40) + 17
```

Change `14` to move the mouth up or down.
Change `17` to move the mouth left or right.

### Mouth width
The mouth drawing routines use this loop limit:

```asm
cpx #5
```

That means the mouth is 5 characters wide.
Change `5` if you want it wider or narrower.

### Speaking zone
This constant sets which ticker column is directly under the mouth:

```asm
speak_col       = 19
```

Only the character at `speak_col` triggers the mouth and sound.

This routine reads that character:

```asm
find_speaking_char
```

## Scrolling Text

### Text row

```asm
ticker_scr      = screen + (23*40)
ticker_col      = color  + (23*40)
```

Change `23` to move the scrolling text up or down.

### Text color

```asm
col_text        = $0f
```

### Scroll speed
The scroll speed is set in this routine:

```asm
set_scroll_delay
```

Current values are chosen separately for 50 Hz and 60 Hz.
Bigger values make scrolling slower.
Smaller values make it faster.

### Scroll direction
This routine shifts the ticker contents:

```asm
scroll_ticker_left
```

If you ever want the text to move the other way, that is the routine to change.

## Speech / Sound

### Chirp spacing

```asm
chirp_period    = 6
```

Bigger number = more silence between chirps.
Smaller number = more constant chatter.

### Chirp duration

```asm
chirp_length    = 1
```

Bigger number = each chirp lasts longer.
Smaller number = shorter chirps.

### Volume

```asm
sid_volume      = 5
```

Range is `0` to `15`.

### Waveform
The waveform is chosen in these lines:

```asm
lda #$40
sta sid_v1_ctrl
...
lda #$41
sta sid_v1_ctrl
```

That is pulse wave with gate off / on.

### Tone color / pulse width
Set in `init_sound`:

```asm
lda #$00
sta sid_v1_pwlo
lda #$08
sta sid_v1_pwhi
```

Changing `#$08` changes the tone character.

### Envelope
Also in `init_sound`:

```asm
lda #$00
sta sid_v1_ad
lda #$00
sta sid_v1_sr
```

These are the ADSR values.
If the sound is too clicky or too abrupt, this is one place to adjust.

### Pitch range
Set in `start_pulse_chirp`:

```asm
adc #80
```

and

```asm
adc #18
```

Lower values make the voice deeper.
Higher values make it more shrill.

### What drives the sound
The sound uses only the character in the speaking zone:

```asm
speak_char
```

That is set by:

```asm
find_speaking_char
```

## Video Timing

### 50 Hz vs 60 Hz detection
Done here:

```asm
detect_video_rate
```

### Timing values chosen from that detection
Done here:

```asm
set_scroll_delay
```

If you want different real-time behavior on 50 Hz vs 60 Hz, change that routine.

## Quick Problem Map

| Problem | Where to adjust |
|---|---|
| Eyes looking at the wrong part of text | `find_eye_target` |
| Eyes turn left/center/right at the wrong times | `set_eyes_from_eye_col` |
| Mouth talks too early or too late | `speak_col` / `find_speaking_char` |
| Text scrolls too fast or too slow | `set_scroll_delay` |
| Text is on the wrong row | `ticker_scr` / `ticker_col` |
| Chirps are too constant | `chirp_period` |
| Chirps are too short or too long | `chirp_length` |
| Voice too loud or quiet | `sid_volume` |
| Voice too shrill or too deep | pitch math in `start_pulse_chirp` |
| Voice too clicky | ADSR in `init_sound` |

## Mic Mode and Transcription

### Toggling input mode
Press **F1** on the C64 to toggle between keyboard and mic mode.
The top-left indicator shows the current mode:
- `F1[KBD]` — light blue, keyboard input active
- `F1[MIC]` — red, microphone listening

### How mic input works
`chat.py` listens to the microphone using PyAudio and detects speech by watching the audio volume level. When the level exceeds `SILENCE_THRESHOLD`, it starts recording. When it drops back below that level for at least `SILENCE_DURATION` seconds, it stops and sends the clip to OpenAI Whisper for transcription.

The transcribed text is then sent to GPT-4o and the response is displayed on the bottom ticker, same as keyboard input.

### Scrolling input display
While the C64 is waiting for a GPT response, the transcribed text scrolls across row 1 of the screen (directly below the mode indicator). Text up to 80 characters is supported — anything beyond that is cut off. GPT processing starts immediately in parallel, so the response may arrive before the scroll finishes.

### Transcription settings
These constants in `chat.py` control mic sensitivity and transcription behaviour:

| Constant | Default | Effect |
|---|---|---|
| `SILENCE_THRESHOLD` | `1500` | RMS level that counts as speech. Raise if background noise triggers false recordings, lower if your voice isn't being picked up. |
| `SILENCE_DURATION` | `1.0` | Seconds of quiet before a recording is submitted. |
| `MIN_SPEECH_DURATION` | `0.5` | Minimum recording length in seconds. Clips shorter than this are discarded. |
| `MIN_SPEECH_RMS` | `800` | Average energy across the whole clip must exceed this or it is skipped before even calling Whisper. |
| `SCROLL_INTERVAL` | `0.12` | Seconds between scroll steps on the input line. |

### Whisper hallucination filtering
Whisper tends to hallucinate YouTube-style phrases ("Thank you for watching", etc.) when given silence or low-level noise. The code applies three layers of protection:

1. **Energy gate** — clips with low average RMS are discarded before being sent to Whisper.
2. **Domain prompt** — Whisper is given a short context prompt ("User speaking a short question or command to a Commodore 64 computer.") to anchor its output.
3. **Phrase blocklist** — known hallucination phrases are matched and dropped after transcription.

If you still see garbage transcriptions in the terminal (prefixed with `skipped:`), try raising `SILENCE_THRESHOLD`.

### Dependencies
```bash
pip install openai pyaudio httpx
```
PyAudio requires PortAudio. On macOS: `brew install portaudio`. On Linux: `apt install portaudio19-dev`.

## Music Mode

### Toggling music recording
Press **F3** on the C64 to start or stop music recording. The top-right indicator shows the current state:
- `F3[MUS]` — light blue (all 7 chars), music recording off
- `F3[MUS]` — `F3` light blue, `[MUS]` red, music recording active

### How music mode works
While music recording is active, `chat.py` continuously listens to the microphone in 8-second windows. After each window it decides probabilistically whether to comment. If it comments, it:
1. Sends the audio clip to Whisper for lyric/content transcription
2. Measures the audio energy to pick a mood word (quiet / mellow / lively / intense)
3. Builds a message like `[music] lively — "hey jude"` and sends it to GPT-4o
4. Scrolls the transcribed text on row 1 while the GPT response plays on the bottom ticker

GPT-4o is given the context that `[music]` messages are from a listener reacting to music it can hear, so replies are natural and conversational rather than assistant-like.

### Spontaneous comment behaviour
The bot does not comment on every window. It rolls dice each window, with the base probability boosted when the audio energy changes significantly (e.g. a chorus kicks in or the song changes). There is also a minimum cooldown between comments so it doesn't spam.

### Tuning constants

| Constant | Default | Effect |
|---|---|---|
| `MUSIC_CHUNK_DURATION` | `8.0` | Seconds of audio per analysis window. |
| `MUSIC_COMMENT_PROB` | `0.35` | Base probability of commenting per window. |
| `MUSIC_COMMENT_COOLDOWN` | `20.0` | Minimum seconds between spontaneous comments. |
| `MUSIC_ENERGY_CHANGE` | `0.4` | Relative RMS shift (40%) that doubles comment probability. |

### Session memory
Music comments use the same conversation history as keyboard and mic input, so the bot remembers what it heard earlier in the session and can refer back to it.

## Discord Bridge (Lexi)

`discord_bridge.py` connects the talking face to Lexi, the Discord bot, as her **commodore 64** personality. When someone in Discord talks to Lexi with that personality on, the real C64 says the reply, and Lexi posts a screenshot or GIF of it in the channel.

### How it works
Lexi runs on Heroku and can't reach the C64 on your home network, so the two meet in Lexi's Heroku Postgres database:

1. Lexi gets the reply from ChatGPT (using the commodore 64 prompt in her `data/chat.json`) and adds a job to the `u64_jobs` table.
2. The bridge, running on a computer on the same network as the C64, picks the job up.
3. It scrolls the question on row 1, sends the reply to the bottom ticker so the face speaks it, and captures the screen while it talks.
4. It puts the PNG or GIF back in the database, and Lexi posts it with the reply text.

The bridge checks in every few seconds. If Lexi hasn't heard from it for 20 seconds she posts the reply as text with "the C64 is offline".

### Everything chat.py does, too
The bridge also runs `chat.py`'s own listeners, so one script does it all:
- typing on the C64 keyboard
- **F1** mic mode
- **F3** music mode

`chat.py` is the same thing without Discord. Both talk to ChatGPT with the C64 prompt and need `OPENAI_API_KEY`. Without the key, the bridge still does the Discord side and says the keyboard, mic and music listeners are off.

What happens on the C64 shows up in Discord too:
- **Status line:** Lexi's shows the current mode while the bridge runs, e.g. `Watching for Lexi · C64: MIC + MUSIC`.
- **C64 live message:** in channels where it's switched on (`lexi c64 live on`), Lexi keeps one message up to date instead of posting every exchange. It shows the mode, the latest screenshot from a keyboard or mic exchange, and the last few lines said. Music comments are sent as text only.

Only one conversation uses the C64 at a time. A Discord message waits while the face is answering a mic question, and the other way round.

Your computer only makes outgoing connections to the database. Nothing needs port forwarding, and the C64 isn't exposed to the internet.

### Screenshots
The U64 API has no screenshot call, so the bridge reads screen RAM (`$0400`), colour RAM (`$D800`), the border and background colours (`$D020`/`$D021`) and the character set bit in `$D018`, then draws the screen with the real C64 character ROM. Sprites aren't drawn (the talking face doesn't use any).

- **screenshot**: one PNG at 2x, picked from the moment the ticker shows the most reply text
- **gif**: an animated GIF of the whole reply scrolling past, shrunk if needed to stay under 8 MB

Switch between them in Discord with `lexi personality commodore 64 screenshot` or `lexi personality commodore 64 gif`.

### Setup
```bash
pip install httpx openai pillow "psycopg[binary]" pyaudio
export OPENAI_API_KEY=...   # for keyboard, F1 mic and F3 music
```

The bridge also needs:
- **The C64 character ROM**: it looks in VICE's install folder for `chargen` (4096 bytes) and asks for the path if it can't find it.
- **Lexi's database address**: it gets this from the Heroku CLI (`heroku config:get DATABASE_URL -a lexi-persimmons`), so be logged in with `heroku login`. Or set `DATABASE_URL` yourself.

Both settings, and the Heroku app name, are saved in `.c64_config.json` next to the C64's IP.

### Running
```bash
python3 discord_bridge.py              # loads talking_face.prg, then waits for Lexi
python3 discord_bridge.py --no-prg     # face is already running
python3 discord_bridge.py --snapshot screen.png   # save the current screen and quit (good for checking the font)
```

Run the bridge **instead of** `chat.py`, not alongside it. Both drive the same C64 memory, and the bridge already does everything `chat.py` does.

### In Discord (owner only)
```
lexi personality commodore 64        switch the channel to the C64
lexi personality commodore 64 gif    ...and post GIFs
lexi personality screenshot          back to screenshots
lexi personality sassy               back to normal Lexi
lexi chat on                         chat mode has to be on in the channel
```

## Build / Test Cycle

After making changes to the assembly:

```bash
64tass -a -B -o talking_face.prg talking_face.asm
curl -F "file=@talking_face.prg" http://192.168.2.64/v1/runners:run_prg
python3 chat.py
```

## Safe First Things to Tweak

These are good first adjustments:

```asm
ch_eye_white    = $e6
ch_eye_ball     = $51
ch_mouth_a      = $5f
ch_mouth_b      = $69

left_eye_scr    = screen + (8*40) + 12
right_eye_scr   = screen + (8*40) + 24

mouth_scr       = screen + (14*40) + 17

ticker_scr      = screen + (23*40)

speak_col       = 19

chirp_period    = 6
chirp_length    = 1
sid_volume      = 5
```

