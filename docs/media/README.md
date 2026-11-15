# Media

| File | What it is |
|---|---|
| `venue-cover-tour.mp4` | A 90-second film of the running demo, with a voice, subtitles and music |
| `hero.png`, `social-preview.png` | The cover image of the README and the repository's social preview |
| `bot-avatar.jpg` | The Telegram bot's picture (`npm run bot:avatar` sets it) |
| `read.png`, `policy.png`, `worksheet.png`, `referred.png`, `phone.png` | The renter's price and its working, the policy, the underwriter's worksheet, a referral, the portal on a phone |
| `hub.png`, `client.png`, `inbox.png`, `quality.png`, `portals.png` | The back office and the front door |

Everything here is taken from the running product; nothing is drawn by hand. To make it again, start the demo with
`npm run public` and, on a Mac:

```bash
scripts/media/make                         # the film: shoot, voice, cut, score, render
scripts/media/make cut score render        # edit again from the footage already shot
TOUR_URL=http://127.0.0.1:3100 ADMIN_PASSWORD=… \
  node --import tsx apps/web/e2e/screens.ts  # the screenshots
node --import tsx scripts/media/hero.ts      # the cover image, from the screenshots
```

How the film is made:

| Step | File | What it does |
|---|---|---|
| shoot | [`apps/web/e2e/film.ts`](../../apps/web/e2e/film.ts) | Drives the pages a renter, an underwriter and a developer use. Every screen is a still at twice the pixels; entrance animations are stepped through frame by frame and typing is shot a few keys at a time, so the film stays as sharp as a screenshot |
| voice | [`scripts/media/voice.ts`](../../scripts/media/voice.ts) | Speaks each sentence of [`lines.ts`](../../scripts/media/lines.ts) with Kokoro, an open text-to-speech voice (Apache-2.0) that runs on this machine |
| cut | [`scripts/media/cut.ts`](../../scripts/media/cut.ts) | The edit: what plays when, the camera's moves, the pointer and its clicks, transitions, subtitles and cards. Writes a plan of every frame |
| score | [`scripts/media/score.py`](../../scripts/media/score.py) | Writes the music note by note, adds the voice and the small sounds, and lowers the music while someone speaks |
| render | [`scripts/media/main.swift`](../../scripts/media/main.swift) | Draws the plan frame by frame and encodes it with AVFoundation |

Nothing needs a key or an account. The first run installs the voice into `.cache/tts`, and the footage stays in
`.cache/film`, both ignored by git.
