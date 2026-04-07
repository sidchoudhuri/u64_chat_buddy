; 64tass
; autostart SYS 2064
;
; $c000       = top ticker trigger (write 1 to start scrolling)
; $c001       = bottom ticker trigger (write 1 to start speaking)
; $c003       = (was trigger, now $c001) - NOTE: trigger moved to $c001
; $c100-$c1ff = bottom text buffer, 0-terminated, in SCREEN CODES
; $c200-$c2ff = top text buffer, 0-terminated, in SCREEN CODES

* = $0801
        .word line10, 10
        .byte $9e
        .text "2064"
        .byte 0
line10  .word 0

* = $0810

top_trigger     = $c000
speak_trigger   = $c001
textbuf         = $c100
topbuf          = $c200

screen          = $0400
color           = $d800

border          = $d020
bgcol0          = $d021
raster          = $d012
ctrl1           = $d011

; SID voice 1
sid_v1_freqlo   = $d400
sid_v1_freqhi   = $d401
sid_v1_pwlo     = $d402
sid_v1_pwhi     = $d403
sid_v1_ctrl     = $d404
sid_v1_ad       = $d405
sid_v1_sr       = $d406
sid_mode_vol    = $d418

; face positions
left_eye_scr    = screen + (8*40) + 12
right_eye_scr   = screen + (8*40) + 24
left_eye_col    = color  + (8*40) + 12
right_eye_col   = color  + (8*40) + 24

mouth_scr       = screen + (14*40) + 17
mouth_col       = color  + (14*40) + 17

ticker_scr      = screen + (23*40)
ticker_col      = color  + (23*40)

top_ticker_scr  = screen + (1*40)
top_ticker_col  = color  + (1*40)

; brow positions
lb0_top         = screen + (6*40) + 12
lb1_top         = screen + (6*40) + 13
lb2_top         = screen + (6*40) + 14
rb0_top         = screen + (6*40) + 24
rb1_top         = screen + (6*40) + 25
rb2_top         = screen + (6*40) + 26

lb0_low         = screen + (7*40) + 12
lb1_low         = screen + (7*40) + 13
lb2_low         = screen + (7*40) + 14
rb0_low         = screen + (7*40) + 24
rb1_low         = screen + (7*40) + 25
rb2_low         = screen + (7*40) + 26

col_bg          = $06
col_face        = $01
col_eye_white   = $0f
col_eye_ball    = $00
col_mouth       = $01
col_text        = $0f
col_top_text    = $0e    ; light blue for top ticker

ch_space        = $20
ch_eye_white    = $e6
ch_eye_ball     = $51
ch_mouth_a      = $5f
ch_mouth_b      = $69
ch_brow         = $43

; tweakables
chirp_period    = 6
chirp_length    = 1
sid_volume      = 5
speak_col       = 19

start:
        sei

        lda #$00
        sta border
        lda #col_bg
        sta bgcol0

        jsr detect_video_rate
        jsr set_scroll_delay
        jsr init_sound

        lda #$01
        sta curx
        sta cury
        sta oldx
        sta oldy
        sta targetx
        sta targety

        lda #$00
        sta top_trigger
        sta speak_trigger
        sta speaking
        sta scroll_timer_lo
        sta scroll_timer_hi
        sta text_index
        sta done_flag
        sta eye_found
        sta eye_col
        sta speak_found
        sta speak_char
        sta chirp_timer
        sta chirp_len
        sta chirp_phase
        sta mouth_state
        sta idle_timer_lo
        sta idle_timer_hi
        sta idle_state
        sta twitch_timer_lo
        sta twitch_timer_hi
        sta twitch_target_lo
        sta twitch_target_hi
        sta twitch_len
        sta window_timer_lo
        sta window_timer_hi
        sta top_speaking
        sta top_text_index
        sta top_done_flag
        sta top_scroll_timer_lo
        sta top_scroll_timer_hi

        lda #$5a
        sta idle_seed

        lda #2
        sta twitch_budget

        jsr clear_screen
        jsr draw_face_static
        jsr init_eyes
        jsr draw_mouth_still
        jsr clear_ticker
        jsr clear_top_ticker
        jsr draw_brows_neutral
        jsr set_idle_wait_timer

main:
        jsr wait_frame
        jsr maybe_start_top_speaking
        jsr maybe_start_speaking
        jsr run_top_speech
        jsr run_speech
        jsr update_mode

        lda speaking
        beq main_no_speech_move
        jsr move_current

main_no_speech_move:
        jsr update_brows
        jsr update_eyes
        jsr update_sound_and_mouth
        jmp main

wait_frame:
        lda raster
wf1:
        cmp raster
        beq wf1
        rts

detect_video_rate:
dv_wait0:
        lda ctrl1
        and #$80
        bne dv_wait0
        lda raster
        bne dv_wait0

        lda #$00
        sta dv_count
        sta dv_frames

dv_outer:
        lda ctrl1
        and #$80
        bne dv_outer
        lda raster
        bne dv_outer

        inc dv_frames

dv_leave:
        lda raster
        beq dv_leave

        inc dv_count
        lda dv_count
        cmp #8
        bne dv_outer

        lda dv_frames
        cmp #7
        bcc dv_pal

        lda #$00
        sta is_50hz
        rts

dv_pal:
        lda #$01
        sta is_50hz
        rts

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

init_sound:
        lda #$00
        sta sid_v1_ctrl
        sta sid_v1_freqlo
        sta sid_v1_freqhi

        lda #$00
        sta sid_v1_pwlo
        lda #$08
        sta sid_v1_pwhi

        lda #$00
        sta sid_v1_ad
        lda #$00
        sta sid_v1_sr

        lda #sid_volume
        sta sid_mode_vol
        rts

sound_off:
        lda #$40
        sta sid_v1_ctrl
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

clear_top_ticker:
        lda #ch_space
        ldx #$00
ctt1:
        sta top_ticker_scr,x
        lda #col_top_text
        sta top_ticker_col,x
        lda #ch_space
        inx
        cpx #40
        bne ctt1
        rts

; --- top ticker ---

maybe_start_top_speaking:
        lda top_trigger
        beq msts_done

        lda #$00
        sta top_trigger
        sta top_text_index
        sta top_scroll_timer_lo
        sta top_scroll_timer_hi
        sta top_done_flag
        lda #$01
        sta top_speaking
        jsr clear_top_ticker

msts_done:
        rts

run_top_speech:
        lda top_speaking
        bne rts_active
        rts

rts_active:
        inc top_scroll_timer_lo
        bne rts_chk
        inc top_scroll_timer_hi

rts_chk:
        sec
        lda top_scroll_timer_lo
        sbc scroll_delay_lo
        lda top_scroll_timer_hi
        sbc scroll_delay_hi
        bcc rts_done

        lda #$00
        sta top_scroll_timer_lo
        sta top_scroll_timer_hi

        jsr scroll_top_ticker_left
        jsr fetch_next_top_char

        lda top_done_flag
        beq rts_done

        jsr top_ticker_is_empty
        cmp #$01
        bne rts_done
        lda #$00
        sta top_speaking

rts_done:
        rts

scroll_top_ticker_left:
        ldx #$00
sttl1:
        lda top_ticker_scr+1,x
        sta top_ticker_scr,x
        lda #col_top_text
        sta top_ticker_col,x
        inx
        cpx #39
        bne sttl1
        rts

fetch_next_top_char:
        lda top_done_flag
        beq fntc_read
        lda #ch_space
        sta top_ticker_scr+39
        lda #col_top_text
        sta top_ticker_col+39
        rts

fntc_read:
        ldy top_text_index
        lda topbuf,y
        bne fntc_store

        lda #$01
        sta top_done_flag
        lda #ch_space
        sta top_ticker_scr+39
        lda #col_top_text
        sta top_ticker_col+39
        rts

fntc_store:
        sta top_ticker_scr+39
        lda #col_top_text
        sta top_ticker_col+39
        inc top_text_index
        rts

top_ticker_is_empty:
        ldx #$00
ttie1:
        lda top_ticker_scr,x
        cmp #ch_space
        bne ttie_no
        inx
        cpx #40
        bne ttie1
        lda #$01
        rts
ttie_no:
        lda #$00
        rts

; --- bottom ticker / speech (unchanged) ---

maybe_start_speaking:
        lda speak_trigger
        beq mss_done

        lda #$00
        sta speak_trigger
        sta text_index
        sta scroll_timer_lo
        sta scroll_timer_hi
        sta done_flag
        sta eye_found
        sta eye_col
        sta speak_found
        sta speak_char
        sta chirp_timer
        sta chirp_len
        sta chirp_phase
        sta mouth_state
        sta idle_state
        lda #$01
        sta speaking
        jsr clear_ticker
        jsr draw_mouth_still
        jsr draw_brows_neutral
        jsr sound_off

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
        jsr find_eye_target
        jsr find_speaking_char
        jsr set_eyes_from_eye_col

        lda done_flag
        beq rs_done

        jsr ticker_is_empty
        cmp #$01
        bne rs_done
        lda #$00
        sta speaking
        jsr draw_mouth_still
        jsr sound_off
        jsr set_idle_wait_timer

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

find_eye_target:
        lda #$00
        sta eye_found
        lda #20
        sta eye_col

        ldx #20
fet_left:
        lda ticker_scr,x
        cmp #ch_space
        beq fet_left_next
        stx eye_col
        lda #$01
        sta eye_found
        rts
fet_left_next:
        dex
        bpl fet_left

        ldx #21
fet_right:
        cpx #40
        bcs fet_none
        lda ticker_scr,x
        cmp #ch_space
        beq fet_right_next
        stx eye_col
        lda #$01
        sta eye_found
        rts
fet_right_next:
        inx
        bne fet_right

fet_none:
        rts

find_speaking_char:
        lda ticker_scr+speak_col
        sta speak_char
        cmp #ch_space
        beq fsc_space
        lda #$01
        sta speak_found
        rts
fsc_space:
        lda #$00
        sta speak_found
        rts

update_mode:
        lda speaking
        bne um_speech
        jsr update_idle
        rts

um_speech:
        lda #$00
        sta idle_state
        jsr draw_brows_neutral
        jsr set_idle_wait_timer
        rts

update_idle:
        lda idle_state
        beq ui_waiting
        jmp ui_moving

ui_waiting:
        inc idle_timer_lo
        bne uiw_chk
        inc idle_timer_hi

uiw_chk:
        lda idle_timer_hi
        cmp idle_target_time_hi
        bcc ui_done
        bne ui_start_move
        lda idle_timer_lo
        cmp idle_target_time_lo
        bcc ui_done

ui_start_move:
        lda #$00
        sta idle_timer_lo
        sta idle_timer_hi
        jsr choose_idle_target
        lda #$01
        sta idle_state
        jmp ui_done

ui_moving:
        jsr move_current

        lda curx
        cmp targetx
        bne ui_done
        lda cury
        cmp targety
        bne ui_done

        lda #$00
        sta idle_state
        jsr set_idle_wait_timer

ui_done:
        jsr update_idle_twitch
        rts

set_idle_wait_timer:
        lda #$00
        sta idle_timer_lo
        sta idle_timer_hi

        jsr next_rand
        and #$ff
        clc
        adc #<250
        sta idle_target_time_lo

        jsr next_rand
        and #$01
        adc #>250
        sta idle_target_time_hi

        jsr next_rand
        clc
        adc idle_target_time_lo
        sta idle_target_time_lo
        lda idle_target_time_hi
        adc #$00
        sta idle_target_time_hi
        rts

choose_idle_target:
        jsr next_rand
        and #$07
        cmp #$05
        bcc cit_center
        cmp #$07
        bcc cit_side
        jmp cit_other

cit_center:
        lda #$01
        sta targetx
        lda #$01
        sta targety
        jmp cit_done

cit_side:
        lda idle_seed
        and #$01
        sta targetx
        lda #$01
        sta targety
        jmp cit_done

cit_other:
        lda #$01
        sta targetx
        lda idle_seed
        and #$01
        sta targety

cit_done:
        rts

update_brows:
        lda curx
        cmp targetx
        bne ub_motion
        lda cury
        cmp targety
        bne ub_motion
        jmp ub_neutral

ub_motion:
        jsr draw_brows_for_motion
        rts

ub_neutral:
        jsr draw_brows_neutral
        rts

draw_brows_neutral:
        lda #ch_space
        sta lb0_top
        sta lb1_top
        sta lb2_top
        sta rb0_top
        sta rb1_top
        sta rb2_top
        sta lb0_low
        sta lb1_low
        sta lb2_low
        sta rb0_low
        sta rb1_low
        sta rb2_low

        lda #ch_brow
        sta lb0_top
        sta lb1_top
        sta lb2_top
        sta rb0_top
        sta rb1_top
        sta rb2_top
        rts

draw_brows_for_motion:
        lda #ch_space
        sta lb0_top
        sta lb1_top
        sta lb2_top
        sta rb0_top
        sta rb1_top
        sta rb2_top
        sta lb0_low
        sta lb1_low
        sta lb2_low
        sta rb0_low
        sta rb1_low
        sta rb2_low

        lda #ch_brow
        sta lb0_top
        sta lb1_top
        sta lb2_top
        sta rb0_top
        sta rb1_top
        sta rb2_top

        lda targetx
        cmp #$00
        bne dbfm_check_right
        lda #ch_space
        sta lb0_top
        sta lb1_top
        lda #ch_brow
        sta lb0_low
        sta lb1_low
        rts

dbfm_check_right:
        lda targetx
        cmp #$02
        bne dbfm_check_down
        lda #ch_space
        sta rb1_top
        sta rb2_top
        lda #ch_brow
        sta rb1_low
        sta rb2_low
        rts

dbfm_check_down:
        lda targety
        cmp #$02
        bne dbfm_done
        lda #ch_space
        sta lb1_top
        sta rb1_top
        lda #ch_brow
        sta lb1_low
        sta rb1_low

dbfm_done:
        rts

update_idle_twitch:
        lda twitch_len
        beq uit_no_active
        dec twitch_len
        bne uit_done
        jsr draw_mouth_still
        jmp uit_done

uit_no_active:
        lda twitch_budget
        beq uit_budget_reset_check

        inc twitch_timer_lo
        bne uit_chk
        inc twitch_timer_hi

uit_chk:
        sec
        lda twitch_timer_lo
        sbc twitch_target_lo
        lda twitch_timer_hi
        sbc twitch_target_hi
        bcc uit_done

        lda #$00
        sta twitch_timer_lo
        sta twitch_timer_hi
        dec twitch_budget

        jsr next_rand
        and #$03
        clc
        adc #2
        sta twitch_len

        jsr toggle_mouth
        jsr schedule_next_twitch
        jmp uit_done

uit_budget_reset_check:
        inc window_timer_lo
        bne uwc1
        inc window_timer_hi
uwc1:
        sec
        lda window_timer_lo
        sbc #<1500
        lda window_timer_hi
        sbc #>1500
        bcc uit_done

        lda #$00
        sta window_timer_lo
        sta window_timer_hi
        lda #2
        sta twitch_budget
        jsr schedule_next_twitch

uit_done:
        rts

schedule_next_twitch:
        jsr next_rand
        and #$ff
        clc
        adc #<200
        sta twitch_target_lo
        jsr next_rand
        and #$01
        adc #>200
        sta twitch_target_hi
        rts

next_rand:
        lda idle_seed
        asl
        bcc nr1
        eor #$1d
nr1:
        clc
        adc #$37
        sta idle_seed
        rts

set_eyes_from_eye_col:
        lda eye_found
        bne sefc_have
        lda #$01
        sta targetx
        lda #$01
        sta targety
        rts

sefc_have:
        lda eye_col
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
        lda curx
        cmp #3
        bcc mc_clamp_y
        lda #2
        sta curx
mc_clamp_y:
        lda cury
        cmp #3
        bcc mc_clamp_done
        lda #2
        sta cury
mc_clamp_done:
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

update_sound_and_mouth:
        lda speak_found
        beq usm_silent

        lda chirp_len
        beq usm_no_len
        dec chirp_len
        bne usm_after_len
        jsr sound_off
usm_after_len:
usm_no_len:

        inc chirp_timer
        lda chirp_timer
        cmp #chirp_period
        bcc usm_done

        lda #$00
        sta chirp_timer
        lda #chirp_length
        sta chirp_len

        inc chirp_phase
        jsr start_pulse_chirp
        jsr toggle_mouth
        jmp usm_done

usm_silent:
        lda #$00
        sta chirp_timer
        sta chirp_len
        jsr sound_off

usm_done:
        rts

toggle_mouth:
        lda mouth_state
        eor #$01
        sta mouth_state
        beq tm_a
        jsr draw_mouth_b
        rts
tm_a:
        jsr draw_mouth_a
        rts

start_pulse_chirp:
        lda speak_char
        asl
        clc
        adc speak_char
        clc
        adc #80
        sta temp_lo

        lda chirp_phase
        asl
        asl
        clc
        adc chirp_phase
        clc
        adc temp_lo
        sta sid_v1_freqlo

        lda speak_char
        lsr
        lsr
        lsr
        and #$07
        sta temp_hi

        lda chirp_phase
        and #$01
        clc
        adc temp_hi
        clc
        adc #18
        sta sid_v1_freqhi

        lda #$40
        sta sid_v1_ctrl
        nop
        nop
        lda #$41
        sta sid_v1_ctrl
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

curx:               .byte $01
cury:               .byte $01
oldx:               .byte $01
oldy:               .byte $01
targetx:            .byte $01
targety:            .byte $01

scroll_timer_lo:    .byte $00
scroll_timer_hi:    .byte $00
scroll_delay_lo:    .byte $00
scroll_delay_hi:    .byte $00

text_index:         .byte $00
speaking:           .byte $00
done_flag:          .byte $00

eye_found:          .byte $00
eye_col:            .byte 20

speak_found:        .byte $00
speak_char:         .byte $20

is_50hz:            .byte $00
saw_high:           .byte $00

chirp_timer:        .byte $00
chirp_len:          .byte $00
chirp_phase:        .byte $00

mouth_state:        .byte $00

idle_seed:          .byte $5a
idle_timer_lo:      .byte $00
idle_timer_hi:      .byte $00
idle_target_time_lo:.byte $00
idle_target_time_hi:.byte $00
idle_state:         .byte $00

twitch_timer_lo:    .byte $00
twitch_timer_hi:    .byte $00
twitch_target_lo:   .byte $00
twitch_target_hi:   .byte $00
twitch_len:         .byte $00
twitch_budget:      .byte $00
window_timer_lo:    .byte $00
window_timer_hi:    .byte $00

temp_lo:            .byte $00
temp_hi:            .byte $00

dv_count:           .byte $00
dv_frames:          .byte $00

top_speaking:           .byte $00
top_text_index:         .byte $00
top_done_flag:          .byte $00
top_scroll_timer_lo:    .byte $00
top_scroll_timer_hi:    .byte $00
