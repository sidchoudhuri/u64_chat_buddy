# Talking Face ASM Tuning Guide

This README is a quick map of the main parts of the `talking_face.asm` file that you can adjust.

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

## Build / Test Cycle

After making changes:

```bash
64tass -a -B -o talking_face.prg talking_face.asm
curl -F "file=@talking_face.prg" http://192.168.2.60/v1/runners:run_prg
python3 speak_text.py hello sid this is a test
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

