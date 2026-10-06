# Visual regression tests

The suite in `e2e/visual.spec.ts` takes pictures of the screens that break
quietly: the Today view, Tasks, Insights and the marketing landing page, each in
**Persian/RTL and English** and in **both themes**, plus one phone-sized Persian
dark case. It is the net under the changes that behaviour tests cannot see — a
mirrored padding rule that lost its RTL override, a dark-theme card that kept a
light background, Persian digits that turned back into Latin ones.

```bash
npx playwright install --with-deps chromium   # once
npm run test:e2e:visual                       # compare against the baselines
npm run test:e2e:visual:update                # rewrite the baselines
```

## Where the baselines come from

Baselines live in `e2e/visual.spec.ts-snapshots/` and are committed. They are
generated **on the CI runner**, not on anybody's laptop, because font rendering
and subpixel layout differ between machines: a baseline captured locally fails
on the runner for reasons that have nothing to do with the change. The runner
image is the single reference.

You rarely have to do this by hand:

- **A branch with no baselines yet.** The workflow notices the directory is
  empty, writes the baselines, commits them to that branch and stays green. The
  next run is a real comparison.
- **A change that is meant to move every picture** (a spacing scale, a font).
  Run **Actions → Visual regression → Run workflow** on your branch with
  `update_baselines` ticked; it regenerates and commits them the same way.
- **By hand**, if you would rather: download the `visual-baselines` artifact from
  any run, unpack it into `e2e/visual.spec.ts-snapshots/`, and commit.

One wrinkle worth knowing: a baseline commit pushed by the workflow itself
(`github-actions[bot]`, using the run's own token) does not start a new run —
GitHub does not trigger workflows from that token, and the run it does create
sits at "action required". It needs nothing from you; the next ordinary push
compares against the baselines and is the run that counts.

Either way, review the images in the pull request the way you would review code.
If a picture changed and that is not the change you meant, the diff is the bug
report. A pull request from a fork cannot push, so it only uploads the artifact —
a maintainer commits that one.

## Why the pictures are comparable at all

Three things would otherwise make every run different:

- **The clock is frozen** (`page.clock.setFixedTime`, 2026-03-12 09:20 UTC) and
  the planner state is seeded with fixed ids and dates. "Today" is the same day
  with the same tasks on every run; a screenshot test that depends on the real
  date is a test that fails tomorrow.
- **Animations are disabled** (`animations: 'disabled'`, reduced motion), and the
  suite waits for `document.fonts.ready` and two animation frames before the
  shutter. No half-faded card, no fallback font.
- **The transient toast is masked.** It appears and disappears on a timer, so it
  is excluded rather than waited on.

Screenshots are compared with `maxDiffPixelRatio: 0.002`, which tolerates the
last bit of antialiasing noise without letting a real change through.

## How the signed-in screens get on screen

The planner sits behind the account gate, and CI has no account server to sign
in to. The suite aborts the `/api/auth/session` probe, which is a state the app
already handles: it renders the local planner offline. Nothing about the UI is
faked — the seeded state is the state the app would show a device that signed in
this morning and then lost its network — and the screenshots are of the real
views. What is *not* exercised here is the gate itself, or anything that needs a
vault (sync, panels, sharing); those keep their behaviour tests.

## What it does not cover

- The sign-in gate itself, the unlock screen, the settings sheet and anything
  that needs a server-backed vault. Those need a server (and a vault) to be meaningful, so
  they stay with the behaviour suites.
- Mobile layouts beyond the one phone case. The rest of the phone matrix is
  covered by the overflow checks in `e2e/ui-layout.spec.ts`, which assert that
  nothing escapes the viewport in any of the five phone/tablet shapes.
- Motion. A screenshot cannot tell whether the reveal animation is pleasant.
