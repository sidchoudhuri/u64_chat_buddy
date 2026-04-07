; 64tass
; autostart SYS 2064
;
; $c100-$c1ff = text buffer, 0-terminated, in SCREEN CODES
; $c003       = trigger (write 1 to start speaking)

* = $0801
        .word line10, 10
        .byte $9e
        .text "2064"
        .byte 0
line10  .word 0

* = $0810

speak_trigger   = $c003
textbuf         = $c100

screen          = $0400
color           = $d800

border          = $d020
bgcol0          = $d021
raster          = $d012
ctrl1           = $d011

left_eye_scr    = screen + (8*40) + 12
right_eye_scr   = screen + (8*40) + 24
left_eye_col    = color  + (8*40) + 12
right_eye_col   = color  + (8*40) + 24

mouth_scr       = screen + (14*40) + 17
mouth_col       = color  + (14*40) + 17

ticker_scr      = screen + (23*40)
ticker_col      = color  + (23*40)

col_bg          = $06
col_face        = $01
col_eye_white   = $0f
col_eye_ball    = $00
col_mouth       = $01
col_text        = $0f

ch_space        = $20
ch_eye_white    = $e6
ch_eye_ball     = $51
ch_mouth_a      = $5f
ch_mouth_b      = $69
ch_brow         = $43

mouth_delay     = 30

start:
        sei

        lda #$00
        sta border
        lda #col_bg
        sta bgcol0

        jsr detect_video_rate
        jsr set_scroll_delay

        lda #$01
        sta curx
        sta cury
        sta oldx
        sta oldy
        sta targetx
        sta targety

        lda #$00
        sta speak_trigger
        sta speaking
        sta mouth_state
        sta mouth_timer
        sta scroll_timer_lo
        sta scroll_timer_hi
        sta text_index
        sta done_flag
        sta last_active_col
        sta active_found

        jsr clear_screen
        jsr draw_face_static
        jsr init_eyes
        jsr draw_mouth_still
        jsr clear_ticker

main:
        jsr wait_frame
        jsr maybe_start_speaking
        jsr run_speech
        jsr move_current
        jsr update_eyes
        jsr update_mouth
        jmp main

wait_frame:
        lda raster
wf1:
        cmp raster
        beq wf1
        rts

; ----------------------------------------
; Detect PAL/50Hz vs NTSC/60Hz by checking
; whether raster reaches a high line number.
; PAL reaches much higher raster values.
; ----------------------------------------
detect_video_rate:
dv_wait_start:
        lda raster
        cmp #$10
        bcs dv_wait_start

dv_wait_rise:
        lda raster
        cmp #$10
        bcc dv_wait_rise

        lda #$00
        sta saw_high

dv_loop:
        lda ctrl1
        and #$80
        beq dv_check_end

        lda raster
        cmp #$20
        bcc dv_mark_high
        jmp dv_check_end

dv_mark_high:
        lda #$01
        sta saw_high

dv_check_end:
        lda raster
        cmp #$10
        bcs dv_loop

        lda saw_high
        sta is_50hz
        rts

; ----------------------------------------
; Set scroll delay based on detected rate
; 50Hz: 750 frames ~= 15 sec
; 60Hz: 900 frames ~= 15 sec
; ----------------------------------------
set_scroll_delay:
        lda is_50hz
        beq ssd_60

        lda #<750
        sta scroll_delay_lo
        lda #>750
        sta scroll_delay_hi
        rts

ssd_60:
        lda #<900
        sta scroll_delay_lo
        lda #>900
        sta scroll_delay_hi
        rts

clear_screen:
        lda #ch_space
        ldx #$00
cs1:
        sta screen,x
        sta screen+$100,x
        sta screen+$200,x
        sta screen+$2e8,x

        lda #col_face
        sta color,x
        sta color+$100,x
        sta color+$200,x
        sta color+$2e8,x

        lda #ch_space
        inx
        bne cs1
        rts

draw_face_static:
        lda #ch_brow
        sta screen + (6*40) + 12
        sta screen + (6*40) + 13
        sta screen + (6*40) + 14
        sta screen + (6*40) + 24
        sta screen + (6*40) + 25
        sta screen + (6*40) + 26

        lda #col_face
        sta color + (6*40) + 12
        sta color + (6*40) + 13
        sta color + (6*40) + 14
        sta color + (6*40) + 24
        sta color + (6*40) + 25
        sta color + (6*40) + 26

        jsr draw_left_eye_white
        jsr draw_right_eye_white
        rts

draw_left_eye_white:
        lda #ch_eye_white
        sta left_eye_scr + 0
        sta left_eye_scr + 1
        sta left_eye_scr + 2
        sta left_eye_scr + 40
        sta left_eye_scr + 41
        sta left_eye_scr + 42
        sta left_eye_scr + 80
        sta left_eye_scr + 81
        sta left_eye_scr + 82

        lda #col_eye_white
        sta left_eye_col + 0
        sta left_eye_col + 1
        sta left_eye_col + 2
        sta left_eye_col + 40
        sta left_eye_col + 41
        sta left_eye_col + 42
        sta left_eye_col + 80
        sta left_eye_col + 81
        sta left_eye_col + 82
        rts

draw_right_eye_white:
        lda #ch_eye_white
        sta right_eye_scr + 0
        sta right_eye_scr + 1
        sta right_eye_scr + 2
        sta right_eye_scr + 40
        sta right_eye_scr + 41
        sta right_eye_scr + 42
        sta right_eye_scr + 80
        sta right_eye_scr + 81
        sta right_eye_scr + 82

        lda #col_eye_white
        sta right_eye_col + 0
        sta right_eye_col + 1
        sta right_eye_col + 2
        sta right_eye_col + 40
        sta right_eye_col + 41
        sta right_eye_col + 42
        sta right_eye_col + 80
        sta right_eye_col + 81
        sta right_eye_col + 82
        rts

init_eyes:
        lda #41
        tay

        lda #ch_eye_ball
        sta left_eye_scr,y
        sta right_eye_scr,y

        lda #col_eye_ball
        sta left_eye_col,y
        sta right_eye_col,y
        rts

clear_ticker:
        lda #ch_space
        ldx #$00
ct1:
        sta ticker_scr,x
        lda #col_text
        sta ticker_col,x
        lda #ch_space
        inx
        cpx #40
        bne ct1
        rts

maybe_start_speaking:
        lda speak_trigger
        beq mss_done

        lda #$00
        sta speak_trigger
        sta text_index
        sta scroll_timer_lo
        sta scroll_timer_hi
        sta mouth_timer
        sta mouth_state
        sta done_flag
        sta active_found
        lda #20
        sta last_active_col
        lda #$01
        sta speaking
        jsr clear_ticker
        jsr draw_mouth_still

mss_done:
        rts

run_speech:
        lda speaking
        bne rs_active
        rts

rs_active:
        inc scroll_timer_lo
        bne rs_chk
        inc scroll_timer_hi

rs_chk:
        sec
        lda scroll_timer_lo
        sbc scroll_delay_lo
        lda scroll_timer_hi
        sbc scroll_delay_hi
        bcc rs_done

        lda #$00
        sta scroll_timer_lo
        sta scroll_timer_hi

        jsr scroll_ticker_left
        jsr fetch_next_char
        jsr find_active_char
        jsr set_mouth_from_active_char
        jsr set_eyes_from_active_col

        lda done_flag
        beq rs_done

        jsr ticker_is_empty
        cmp #$01
        bne rs_done
        lda #$00
        sta speaking
        jsr draw_mouth_still

rs_done:
        rts

scroll_ticker_left:
        ldx #$00
stl1:
        lda ticker_scr+1,x
        sta ticker_scr,x
        lda #col_text
        sta ticker_col,x
        inx
        cpx #39
        bne stl1
        rts

fetch_next_char:
        lda done_flag
        beq fnc_read
        lda #ch_space
        sta ticker_scr+39
        lda #col_text
        sta ticker_col+39
        rts

fnc_read:
        ldy text_index
        lda textbuf,y
        bne fnc_store

        lda #$01
        sta done_flag
        lda #ch_space
        sta ticker_scr+39
        lda #col_text
        sta ticker_col+39
        rts

fnc_store:
        sta ticker_scr+39
        lda #col_text
        sta ticker_col+39
        inc text_index
        rts

find_active_char:
        lda #$00
        sta active_found

        ldx #$00
fac_loop:
        lda ticker_scr,x
        cmp #ch_space
        beq fac_next

        stx last_active_col
        lda #$01
        sta active_found
        rts

fac_next:
        inx
        cpx #40
        bne fac_loop
        rts

set_mouth_from_active_char:
        lda active_found
        beq sm_space
        lda #$01
        sta mouth_on
        rts
sm_space:
        lda #$00
        sta mouth_on
        rts

set_eyes_from_active_col:
        lda active_found
        bne sefc_have
        lda #$01
        sta targetx
        lda #$01
        sta targety
        rts

sefc_have:
        lda last_active_col
        cmp #13
        bcc sefc_left
        cmp #27
        bcc sefc_center

        lda #$02
        sta targetx
        lda #$02
        sta targety
        rts

sefc_center:
        lda #$01
        sta targetx
        lda #$02
        sta targety
        rts

sefc_left:
        lda #$00
        sta targetx
        lda #$02
        sta targety
        rts

move_current:
        lda curx
        cmp targetx
        beq mx_done
        bcc mx_inc
        dec curx
        jmp mx_done
mx_inc:
        inc curx
mx_done:

        lda cury
        cmp targety
        beq my_done
        bcc my_inc
        dec cury
        jmp my_done
my_inc:
        inc cury
my_done:
        rts

update_eyes:
        lda curx
        cmp oldx
        bne eyes_changed
        lda cury
        cmp oldy
        beq eyes_done

eyes_changed:
        lda oldy
        asl
        clc
        adc oldy
        clc
        adc oldx
        tax

        lda eye_offsets,x
        tay

        lda #ch_eye_white
        sta left_eye_scr,y
        sta right_eye_scr,y

        lda #col_eye_white
        sta left_eye_col,y
        sta right_eye_col,y

        lda cury
        asl
        clc
        adc cury
        clc
        adc curx
        tax

        lda eye_offsets,x
        tay

        lda #ch_eye_ball
        sta left_eye_scr,y
        sta right_eye_scr,y

        lda #col_eye_ball
        sta left_eye_col,y
        sta right_eye_col,y

        lda curx
        sta oldx
        lda cury
        sta oldy

eyes_done:
        rts

draw_mouth_still:
        lda #ch_mouth_a
        ldx #$00
dms1:
        sta mouth_scr,x
        lda #col_mouth
        sta mouth_col,x
        lda #ch_mouth_a
        inx
        cpx #5
        bne dms1

        lda #$00
        sta mouth_state
        sta mouth_timer
        rts

draw_mouth_a:
        lda #ch_mouth_a
        ldx #$00
dma1:
        sta mouth_scr,x
        lda #col_mouth
        sta mouth_col,x
        lda #ch_mouth_a
        inx
        cpx #5
        bne dma1
        rts

draw_mouth_b:
        lda #ch_mouth_b
        ldx #$00
dmb1:
        sta mouth_scr,x
        lda #col_mouth
        sta mouth_col,x
        lda #ch_mouth_b
        inx
        cpx #5
        bne dmb1
        rts

update_mouth:
        lda mouth_on
        beq mouth_off

        inc mouth_timer
        lda mouth_timer
        cmp #mouth_delay
        bcc mouth_done

        lda #$00
        sta mouth_timer

        lda mouth_state
        eor #$01
        sta mouth_state
        beq mouth_draw_a

        jsr draw_mouth_b
        jmp mouth_done

mouth_draw_a:
        jsr draw_mouth_a
        jmp mouth_done

mouth_off:
        lda mouth_state
        beq mouth_done
        jsr draw_mouth_still

mouth_done:
        rts

ticker_is_empty:
        ldx #$00
tie1:
        lda ticker_scr,x
        cmp #ch_space
        bne tie_no
        inx
        cpx #40
        bne tie1
        lda #$01
        rts
tie_no:
        lda #$00
        rts

eye_offsets:
        .byte 0,1,2,40,41,42,80,81,82

curx:
        .byte $01
cury:
        .byte $01
oldx:
        .byte $01
oldy:
        .byte $01
targetx:
        .byte $01
targety:
        .byte $01

mouth_state:
        .byte $00
mouth_timer:
        .byte $00
mouth_on:
        .byte $00
scroll_timer_lo:
        .byte $00
scroll_timer_hi:
        .byte $00
scroll_delay_lo:
        .byte $00
scroll_delay_hi:
        .byte $00
text_index:
        .byte $00
speaking:
        .byte $00
done_flag:
        .byte $00
last_active_col:
        .byte 20
active_found:
        .byte $00
is_50hz:
        .byte $00
saw_high:
        .byte $00
