# u64_chat_buddy roadmap

## Now

- [ ] Test the Discord bridge on the real C64 with Lexi: screenshot and GIF modes, offline notice
- [ ] Check the screenshot font and colours with `python3 discord_bridge.py --snapshot screen.png`
- [ ] Merge `discord-bridge` into main

## Next

- [x] Let the bridge also handle the C64 keyboard, F1 mic and F3 music, so it does everything `chat.py` does
- [ ] Run the bridge somewhere always-on next to the C64 (e.g. a Raspberry Pi) so it doesn't depend on the Mac being awake
- [ ] Show the Discord username on the C64 more prominently, e.g. in a different colour on row 1

## Ideas

- [ ] Use the U64's video stream for real captures, including sprites, instead of drawing from screen RAM
- [ ] Short video clips with the SID chirp audio from the U64's audio stream, instead of silent GIFs
- [x] Keyboard, mic and music mode replies posted to Discord too
- [x] F1/F3 shown in Discord (embeds and Lexi's status line)
