# Releasing Planner

One page for the release itself: what to do, in what order, and which parts are
a workflow's job rather than yours. The detail lives next door — [DESKTOP.md](DESKTOP.md)
for the installers, [APPS.md](APPS.md) for the phone shells, [STORE_SUBMISSION.md](STORE_SUBMISSION.md)
for the store questionnaires, [VISUAL_TESTS.md](VISUAL_TESTS.md) for the pictures.

A release is a tag. Everything upstream of that is a check, and everything
downstream of it is a workflow — with two exceptions at the end of this file,
because the store submissions are still a person with a browser.

## 1. Before the tag

The version a release carries comes from the tag, not from a file: the Apps
workflow passes `v1.2.0` through as `VERSION_NAME` for Android and
`PLANNER_VERSION_NAME` for the desktop shell, and `github.run_number` becomes
Android's `versionCode`. So nothing needs editing first — but these do need to
be true:

1. **`main` is green.** Typecheck, unit tests, lint, the browser suites, the
   native compiles, the payload budget, the toolchain check. A red check is what
   the next section is for.
2. **The visual baselines are current.** They are generated on the runner
   (`visual.yml`), never on a laptop — see [VISUAL_TESTS.md](VISUAL_TESTS.md). A
   PR whose screenshots changed and whose baselines were never regenerated is a
   release note nobody has read yet.
3. **The signing identities exist**, if this is the first tagged release:
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
   `ANDROID_KEY_PASSWORD` as repository secrets, and
   `ANDROID_SIGNING_CERT_SHA256` as a repository variable. The tag build runs
   `scripts/validate-release-contract.mjs` first and refuses to publish anything
   signed with a debug key — a Play upload signed by the wrong key can never be
   replaced.
4. **The deployment variables point somewhere real**: `PLANNER_API_ORIGIN` (and
   `PLANNER_APP_URL` for the shells that should load a live site), plus the
   deep-link identity (`PLANNER_LINK_HOST`, `IOS_TEAM_ID`) if this release is
   meant to open invite links.
5. **`npm run check:deployment` passes against the deployment this release will
   talk to.** It checks accounts, sync, push and both deep-link files from the
   outside, which is the only way to see what a phone sees — the file has to be
   served at exactly `/.well-known/apple-app-site-association`, with no redirect
   and no rewrite.

## 2. Tagging

```bash
git tag v1.2.0 && git push origin v1.2.0
```

Three-part stable semver, nothing else: the contract check rejects `v1.2` and
rejects pre-release suffixes, because the Android version name and the Windows
app id have to stay permanently comparable.

The tag starts **Apps** (`apps.yml`). It builds on GitHub's runners, which is
also the only place the packaging runs end to end:

| Job | Produces |
| --- | --- |
| `desktop` | `.exe`, `.dmg` and `.zip`, `.AppImage`, `.deb`/`.rpm` |
| `android` | a signed `app-release.apk` (the direct flavour) and `app-play-release.aab` (Play) |
| `ios` | `Planner-ios-app.zip` and `Planner-ios.xcarchive.zip`, both **unsigned** |
| `release` | attaches all of the above to the GitHub release, plus `planner-update.json` |

The iOS build stops at an unsigned archive on purpose — CI has no distribution
certificate, and it should not. Signing and uploading happen on a Mac in Xcode
or Transporter, which is also where the App Store metadata lives
([APPS.md](APPS.md) §4, [STORE_SUBMISSION.md](STORE_SUBMISSION.md) §2).

The release job then runs `npm run check:downloads` — the website links to
`releases/latest/download/<file>`, so a renamed artefact would 404 every
download button on the site and nothing else would notice. Installer filenames
are deliberately fixed (no version numbers) for the same reason.

The other workflows are for the pull request, not the tag: **Native builds**,
**Browser tests**, **Visual regression**, **Security checks** and **Device
smoke** run on `pull_request` (and on demand), and Security also runs on every
push. By the time a tag exists, all of them have been green on that commit.

## 3. After the tag

1. **Read the release the bot wrote.** Notes come from `--generate-notes`, so
   the interesting part is what the merged pull requests say; edit them into
   something a person would want to read, and call out anything that needs an
   action (a new permission prompt, a setting worth checking, a migration).
2. **Store submissions** are manual and they are the slow part. The order in
   [STORE_SUBMISSION.md](STORE_SUBMISSION.md) §5 matters: a listing with the
   wrong privacy answers has to be withdrawn rather than edited.
3. **Real-device smoke.** `device-smoke.yml` boots the packaged apps on an
   emulator and a simulator — enough to catch a missing plugin registration or
   an intent filter that never matches, and allowed to fail, because virtual
   devices are the flakiest thing in CI. What it cannot cover is the checklist
   that needs a device someone is holding: biometrics, a real push
   notification, and one verified deep link per platform
   ([APPS.md](APPS.md) §9.2). Do that before submitting.
4. **Windows background mode**, if the release touched it: install the `.exe`,
   close the window, and confirm the app is still in the tray and still fires a
   reminder ([DESKTOP.md](DESKTOP.md) §9). Closing the window is exactly the
   case no automated test covers.

## 4. When something is wrong

- **A bad desktop installer** can be replaced: delete the asset, fix, move the
  tag (`git tag -f v1.2.0 && git push --force origin v1.2.0`), and re-run Apps.
  Users on `releases/latest` follow the tag, so the window to do this is short.
- **A bad mobile release cannot.** `versionCode` only moves forward, and a
  pulled Play release keeps the code. The fix is a new patch tag, not a
  replacement — which is why the store steps are last and the device checklist
  is not optional.
- **A bad deploy** is not a release at all: the website and the API roll
  forward independently, and an installed app keeps working offline from its own
  build. Roll the deployment back, leave the tags alone, and let the next patch
  tag carry the fix.
