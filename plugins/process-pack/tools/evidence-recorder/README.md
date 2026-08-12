# Evidence recorder

Records a browser scenario as video evidence for a pull request. Replaces the GIF that the
UI-change verification gate used to ask for.

Milestone 1: silent video with native interaction overlays. Narration is a separate step
that consumes the per-step timestamps this tool writes.

## Usage

```sh
bun src/cli.ts examples/todomvc.scenario.ts --out out
```

Environment, all optional except where a protected origin is involved:

| Variable | Purpose |
|---|---|
| `EVIDENCE_STORAGE_STATE` | Path to a captured signed-in session |
| `EVIDENCE_PROTECTED_ORIGIN` | Origin that sits behind deployment protection |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | The bypass secret. **From the environment only** — never committed, never read from a repo file |

Outputs `<name>.webm` (or `.mp4` if it had to be re-encoded) and `<name>.steps.json`
carrying per-step start and end times.

## A scenario

```ts
const scenario: Scenario = {
  name: 'add-a-task',
  url: 'https://example.test/app',
  ready: async page => /* proof the feature is actually rendered */,
  steps: [
    { caption: 'Adding a task.', run: async page => { /* arbitrary Playwright */ } },
  ],
}
export default scenario
```

`run` is arbitrary Playwright, so nothing about the page has to be expressed in an invented
mini-language. The step array supplies the boundaries the recorder stamps, which is what
turns narration timing into bookkeeping rather than audio alignment.

## `ready` is the most important field, and it is required

**It must assert something only the working feature renders.** Not "the page rendered", not
"the network went idle". Every cheap proxy signal has, at some point, passed on a page that
was not the page under test:

| Signal | Passes on |
|---|---|
| HTTP 200 | a sign-in redirect |
| URL path | a page whose content never loaded |
| Session cookie present | a completely blank page |
| Network idle | an app stuck on loading skeletons |
| No skeleton elements | a signed-out sign-in form, which has none either |
| "Sign out" is visible | a session whose org context never resolved — chrome renders, content does not |

That last row is not hypothetical. An earlier version of the bundled Meridian scenario used
exactly that check and recorded five seconds of grey rectangles. Combine signals, and prefer
asserting the specific thing the change is about.

If `ready` never passes, the recorder **refuses to record**, writes `<name>-FAILED.png` at
the point of failure, and exits non-zero. A missing recording is a visible problem; a
recording of loading placeholders is an invisible one.

## Narration

```sh
bun src/narrate-cli.ts out/my-scenario.webm          # ElevenLabs if a key is present
bun src/narrate-cli.ts out/my-scenario.webm --say    # force the free local voice
```

Reads `<name>.steps.json`, renders one audio clip per caption, places each at its step's
recorded start time, and muxes to `<name>-narrated.mp4`.

**Voice.** ElevenLabs when `ELEVENLABS_API_KEY` is set, otherwise the local macOS voice.
The fallback is always **stated in the output**, never silent — a robot voice is acceptable
evidence, a downgrade nobody noticed is not.

```sh
export ELEVENLABS_API_KEY=...                       # from your secret manager, never a repo file
bun src/narrate-cli.ts --list-voices                # what this account can use
bun src/narrate-cli.ts out/x.webm                   # default voice: River
bun src/narrate-cli.ts out/x.webm --voice "Daniel"  # by name (prefix is enough) or id
export ELEVENLABS_VOICE_ID=...                      # set a default; --voice overrides it
```

The default is **River**, ElevenLabs' narration voice — neutral wears better across a
hundred QA videos than a distinctive one, since the reviewer should be listening to what
changed rather than to the narrator.

A voice name is resolved against the account and matched case-insensitively, widening from
exact to prefix. Account names carry descriptor suffixes ("River - Relaxed, Neutral,
Informative"), so `--voice River` is enough. An ambiguous
name is an error rather than a silent pick — narrating a whole recording in the wrong voice
is a slow thing to notice, and a cheap thing to prevent.

**Audio output is normalised** to 44.1kHz stereo at −16 LUFS regardless of which voice
rendered it. The local voice produces 24kHz mono at around −20 dB, which plays unevenly in
embedded players and is too quiet to follow at low volume. Evidence has to play where it is
attached, not only in a desktop video app.

**WAV and MP3 only, never m4a.** Measured: AAC adds ~106ms of encoder padding, so a clip
measured as m4a reports longer than it sounds. Narration placed from that number drifts a
tenth of a second per caption and accumulates, presenting as "the voice slowly falls
behind" — miserable to diagnose after the fact.

**When a caption runs longer than its step**, the next clip starts when the previous one
finishes rather than at its own step time, and the run reports which captions were delayed.
Overlapping narration is unintelligible; truncating drops the words that explain the step;
slowing the video desynchronises every later stamp. Late-but-complete is the least-bad
failure, and it is reported so chronic drift is visible rather than silent.

**If narration outlasts the footage**, the final frame is held so the last caption finishes
instead of being cut off mid-sentence.

## Design notes, each measured rather than assumed

- **`page.screencast` only; never `recordVideo`.** Screencast alone provides both the
  overlays and controllable start/stop. `recordVideo` adds a redundant second file and
  forces recording to start at context creation.
- **Never pass `quality`.** Measured: `quality: 50` produced a *larger* file than the
  default. It does not control the WebM encode.
- **WebM is fine.** GitHub accepts and plays it inline, so conversion is not mandatory.
  MP4 conversion exists as the lever for getting under the size ceiling, and because an MP4
  inserts into a comment as a bare URL where WebM inserts as link markdown.
- **The ceiling is 9 MB, not GitHub's limit.** GitHub accepts at least 60 MB, but the agent
  tooling that attaches the file caps an upload at 10 MB — and a recording an agent cannot
  attach is not evidence.
- **Re-encode is H264 CRF 32**, measured at ~52% reduction on a scroll-heavy worst case and
  verified still legible by reading small text in extracted frames. That is the quality
  floor. Past it the recorder fails rather than degrading, because unreadable video is not
  evidence.
- **VP9 re-encode and lower resolution are not levers.** VP9 produced a *larger* file than
  the VP8 source; 960x540 saved only 12% and cost legibility on small UI text.
- **Custom headers are applied per-origin via `ctx.route()`, never `extraHTTPHeaders`.**
  `extraHTTPHeaders` is context-wide, so it sends the header cross-origin to the auth
  provider too. A custom header forces a CORS preflight the provider rejects, its script
  fails to load, and the app renders a blank page — while cookies and the URL still look
  correct. Per-origin routing also stops the secret being sent to a third party.
- **A saved session expires quickly** — one measured invalid after 22 minutes, failing by
  silently landing on a sign-in page. That is why `ready` runs before recording starts.

## Expected budget

Measured at 1280x720: a realistic click-and-read flow runs about 42 KB/s, so roughly four
minutes fits inside the ceiling. Continuous scrolling on an image-heavy page is the worst
case at about 119 KB/s, or about 86 seconds — and with the CRF 32 re-encode in reserve,
about three minutes.
