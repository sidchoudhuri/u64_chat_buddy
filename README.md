# Talking Face ASM Tuning Guide

This README is a quick map of the main parts of the `talking_face.asm` file that you can adjust.

- [Eyes](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#eyes-1)
- [Mouth](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#mouth)
- [Scrolling Text](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#scrolling-text-1)
- [Speech / Sound](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#speech--sound-1)
- [Video Timing](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#video-timing-1)
- [Mic Mode & Transcription](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#mic-mode-and-transcription)
- [Music Mode](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#music-mode)
- [Problems & Solutions](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#scrolling-text-1)
- [Build / Test Cycle](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#build--test-cycle-1)
- [Safe Things To Tweak](https://github.com/sidchoudhuri/C64_Chat_Buddy/edit/main/README.md#safe-first-things-to-tweak)

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

