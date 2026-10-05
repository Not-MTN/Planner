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

To make or refresh them:

1. Run **Actions → Visual regression → Run workflow** on your branch with
   `update_baselines` ticked.
2. Download the `visual-baselines` artifact when the run finishes.
3. Unpack its contents into `e2e/visual.spec.ts-snapshots/` and commit them.
4. Review the images in the pull request the way you would review code. If a
   picture changed and that is not the change you meant, the diff is the bug
   report.

Runs on a branch where no baselines are committed yet do not fail: the workflow
notices the directory is empty, writes the baselines, stays green and uploads
them as the same artifact. That first green run *is* step 1 above, so a fresh
clone needs no special handling — commit the artifact and the job becomes a real
gate from the next run on. (A local `npm run test:e2e:visual` before that still
fails with "A snapshot doesn't exist"; run it with `:update` once you have the
artifact.)

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

## What it does not cover

- Anything behind an account: the sign-in gate, the settings sheet and the app
  in a signed-in state. Those need a server (and a vault) to be meaningful, so
  they stay with the behaviour suites.
- Mobile layouts beyond the one phone case. The rest of the phone matrix is
  covered by the overflow checks in `e2e/ui-layout.spec.ts`, which assert that
  nothing escapes the viewport in any of the five phone/tablet shapes.
- Motion. A screenshot cannot tell whether the reveal animation is pleasant.
