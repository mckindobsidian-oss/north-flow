# North completion effects

Only task completion and focus/break completion trigger these sounds, when enabled in Settings. Ordinary clicks and navigation stay silent.

Source: Kenney, [Interface Sounds](https://kenney.nl/assets/interface-sounds), CC0.
`task-complete.ogg` is `confirmation_001.ogg`; `focus-complete.ogg` is `confirmation_002.ogg`.
The original licence is included as `Kenney-License.txt`.

Audio is bundled locally, not streamed from another service. Web Audio plays the samples after a user gesture; browsers without Ogg decoding use the existing synthesized chime fallback.

`break-complete.wav`, `streak-complete.wav` and `achievement-complete.wav` are original renders of North's existing Web Audio melodies for native Android playback. Regenerate with `node scripts/render-mobile-cues.mjs`. They are not Kenney samples. Sounds remain opt-in, with the account volume setting applied.
