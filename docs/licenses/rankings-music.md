# Rankings music: "Main Event" — rights and provenance

**What it is.** The theme that plays in Crew → Rankings (Monthly League and
Hall of Strength): `src/assets/music/main-event.m4a`, an original instrumental
made for JF Effect on Nov 26 2026. Dark cinematic trap, C minor, 144 BPM
(half-time feel), a seamless 32-bar loop of 53.3 s. No vocals, no lyrics.

**Who owns it.** JF Effect. The composition, arrangement, drum and bass sound
design and the mix were written for the app (`scripts/rankings-music/`); no
part of it is someone else's track, loop or stem, so there's no licence to
renew, no attribution owed and nothing that can be claimed by a content ID
system. It can be used in the app, on the website, in ads and in social posts.

**What it's built from.**

| Material | Source | Licence | Used for |
| --- | --- | --- | --- |
| VS Chamber Orchestra 2: Community Edition (VSCO-2-CE), Versilian Studios — recorded by Sam Gossner and Simon Dalzell | github.com/sgossner/VSCO-2-CE, as repackaged unchanged in the npm packages `@minicut/music-samples-1@1.0.0` (sha1 `d678cd066a21fb17ba2481d1a87397b2417c5b24`) and `@minicut/music-samples-2@1.0.0` (sha1 `61d449f0d46e672384564530895998a6fcae5ace`), both `"license": "CC0-1.0"` | **CC0 1.0 Universal** (public domain dedication: commercial use, modification and redistribution allowed, no attribution required) | cello section spiccato and sustain, violin section sustain, F horn, tenor trombone, tuba, timpani, concert bass drum |
| 808 bass, kick, clap, hi-hats, risers, sub drops, reverb | synthesized in `scripts/rankings-music/render.py` | ours | drums, bass, effects |

The CC0 text shipped with the samples is kept at
`docs/licenses/rankings-music/VSCO-2-CE-LICENSE.txt`; on Nov 26 2026 it was
checked byte for byte against the upstream repository's `LICENSE`
(raw.githubusercontent.com/sgossner/VSCO-2-CE/master/LICENSE): identical.

**The file.** AAC-LC, 48 kHz stereo, 128 kbps, 54.3 s (the loop plus 0.5 s of
its own end before it and 0.5 s of its start after it, so decoder padding
never puts a gap in the loop), 933 KB, sha256
`369ba6f7b5e1040ca1457888814d843cb34e2454789774b4536f1bbcc593b51d`.
Mastered to −15.9 LUFS integrated, −1.5 dBFS peak, 4.1 LU loudness range; the
app plays it at about −25 LUFS at the default volume.

**Rebuilding it.** `bash scripts/rankings-music/build.sh` downloads the
samples, renders and encodes it again (python3 with numpy, scipy, soundfile;
ffmpeg).

**Replacing it with a bought or royalty-free track.** Keep the licence or
receipt here, cut the track to a whole number of bars, render it as a loop
(its tail mixed onto its start), run `encode.py`, and update `RANKINGS_TRACK`
in `src/lib/rankings-music.ts` (`id`, `bpm`, `bars`, `loopEnd`, `gain`).
Check the licence covers use inside an app (some stock licences cover only
video), and that the track isn't registered with a content ID service.

**Why not a stock track.** On Nov 26 2026 the brief asked for a licensed or
royalty-free track. Pixabay's music (free for commercial use) refuses
automated downloads (a bot check), and the CC0 catalogues that could be
downloaded (OpenGameArt, FreePD) hold fantasy and game music, not the dark
sports / walkout sound the brief describes; commercial libraries (Motion
Array, PremiumBeat…) need an account and a paid licence. An original track
from CC0 recordings meets the brief with no licence risk at all.
