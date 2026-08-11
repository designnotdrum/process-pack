# Video evidence pipeline — findings before the map

Working notes gathered 2026-08-11, before charting a wayfinder map. Written so
the map starts from verified facts rather than from a retelling.

**Provenance is marked on every claim.** `[verified today]` means a command was
run in this repo or against a live source on 2026-08-11. `[verified prior]`
means it was checked in the session that produced these notes, against live
docs, but not re-run since. `[unverified]` means nobody has tested it and it is
a candidate for a prototype ticket, not a premise.

## The problem

Today's UI-change evidence is an animated GIF, produced by the Chrome tooling's
`gif_creator`, attached to a PR. GIF is silent, lossy at any useful length, and
carries no narration. The proposal is to replace it with a narrated video.

Two places currently encode GIF as the answer, and both are the target of this
work:

- `plugins/process-pack/skills/verification-gates/SKILL.md:67` — the
  `User-visible or behavioural UI change` work class. Last sentence: "GIF
  renders inline in a PR comment and is the format to reach for." `[verified today]`
- The personal `preview-qa` skill, which names `gif_creator` as the recorder and
  argues GIF is better *regardless*, because "the Chrome tooling exposes
  `gif_creator` only" and "GIFs also render inline in a GitHub comment, which a
  video file does not". `[verified today]`

That second claim is the load-bearing one, and it is wrong on both halves if
Playwright replaces the Chrome tooling and if a native GitHub video upload
works. Both halves need re-testing rather than inheriting.

## What Playwright gives us

- **The screencast API is real, and it writes WebM, not MP4.** VP8/VP9 in a
  WebM container. `[verified prior]`

  ```js
  await page.screencast.start({ path: 'video.webm', size: { width: 1280, height: 800 } })
  await page.screencast.stop()
  ```

  One `ffmpeg` call converts to MP4. That is a step, not a blocker.
  `ffmpeg 8.1.2` is installed locally. `[verified today]`

- **Playwright already ships the interaction overlays.**
  `recordVideo.showActions` annotates the element being interacted with and
  draws an action title, with configurable position, font size, and a pointer
  cursor. That is the entire `gif_creator` overlay set, native, in video.
  `[verified prior]` — this is the finding that removes the main reason to keep
  the current tool, so it is worth re-confirming against the installed version
  before the map depends on it.

- **Version.** The screencast API is attributed to **1.59.0**, which exists
  (1.59.0 and 1.59.1 are published). Latest on npm is **1.62.1**.
  `[verified today]` An earlier note in this thread cited 1.159.0; that was a
  typo for 1.59.0, not a real release. Which minor first shipped `screencast`
  is still `[unverified]` — confirm against the changelog before a ticket
  depends on a floor version.

## What Playwright does not give us

- **No audio track. Playwright records none.** Narration has to be a second
  track: the agent writes a caption per step, text-to-speech renders it, ffmpeg
  muxes it against the video. `[verified prior]`

  ElevenLabs is already wired for Hermes voice dispatch, so a good voice exists.
  macOS `say` is the free fallback and is present at `/usr/bin/say`.
  `[verified today]`

  **The real work here is timing, not synthesis.** A caption must land while its
  action is on screen. Neither the recorder nor the TTS knows about the other,
  so something has to stamp each step's start time during the run and use those
  stamps to place the audio. That is the genuinely new build in this effort, and
  it should be its own ticket.

## Delivery — the open question, and the one that decides everything

The effort is worthless if the evidence lands in a Downloads folder instead of
on the PR. Three candidates, to be prototyped **in this order**:

1. **Native GitHub upload, driven through a browser.** `[unverified]`
   GitHub has no public media upload API, and the web composer accepts `.mp4`
   and `.mov` but rejects `.webm`. But we already drive a browser and have a
   file-upload tool, and nobody has tested whether that lands a video in a
   comment box. **This dominates if it works**: the video plays inline in the
   PR, needs no third-party account, and never leaves the repo. It is roughly a
   one-hour prototype and it decides the whole question. Do it first.

2. **A self-hosted share page.** `[unverified]` Video hosted on our own surface,
   linked from the PR. Plays off-site.

3. **YouTube unlisted.** `[unverified]` Works, with four caveats:

   - **Unlisted is not private.** Anyone holding the URL can watch. QA
     recordings show a signed-in application containing real account and
     organisation data. This repo is public.
   - **OAuth setup has a known trap.** Upload needs user consent, not a service
     account. If the Google Cloud app stays in Testing mode, refresh tokens
     expire every 7 days and the pipeline dies silently every week. Production
     with the upload scope needs verification.
   - **It plays off-site.** GitHub renders a YouTube link as a link, so a
     reviewer clicks out of the review to watch it.
   - **The link is tied to a personal channel.** Delete the video and the PR
     loses its evidence.

   **Correction to an earlier claim:** the quota objection was wrong. Google
   moved `videos.insert` into a dedicated Video Uploads bucket — 1 unit per
   call, 100 uploads per day. Volume is not a constraint. `[verified prior]`

## Known cost nobody has priced

Switching to Playwright means re-solving the Clerk dev-browser session handoff
in Playwright. `storageState` persists a signed-in session across runs and
likely makes it easier than it was in Chrome. But it is not free, and it is the
part that took two sessions to get right the first time. `[verified prior]`

## Skill gaps found alongside this, which the map may or may not absorb

These came out of the same review and are not part of the video pipeline. They
are recorded here so they are not lost, not because they belong to this effort.

1. **No rule binds gate evidence to a commit.** A recording proves something
   about the commit it was taken against; nothing currently says which one.
2. **No rule to sweep a defect class after finding one instance.** One instance
   found, one instance fixed, siblings left in place.
3. **Nothing about verifying a delegate's claims when work comes back.** The
   dispatch side is specified; the receiving side is not.
4. **Narrower gap inside the existing UI-change work class:** pin the deployment
   identity before trusting an observation, and confirm the input landed before
   believing the result. These two produced three separate false bug reports.

## Hazard, unticketed

Skills load from the working tree of this repo, not from the plugin cache. So
**checking out a branch here silently changes the skills every other session
runs.** The install record separately reads 1.2.0 while 1.4.0 is what actually
loads — bookkeeping, harmless today, wrong the moment the marketplace source
changes from a directory to a git URL. `[verified prior]`
