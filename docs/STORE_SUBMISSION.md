# Store submission pack

Everything a submission needs, answer by answer, so nobody has to infer a
privacy label from the code at 11pm before a release. The listing copy and the
review notes live in `docs/APPS.md` §10 and §9.2; this file is the
questionnaires, the declarations and the checklist around them.

Two deployment shapes change some answers, so they are called out rather than
averaged away:

- **Local-only / self-hosted** — no accounts, no server. Everything is on the
  device.
- **Operator-hosted sync** — accounts, encrypted sync, AI proxy and push run on
  a deployment the operator pays for. The operator stores ciphertext and an
  account identifier, and nothing readable.

Both are the same app; only the deployment differs. Answer for the shape you
are actually shipping.

---

## 1. Google Play

### 1.1 Data safety

Play wants one answer per data type: collected, shared, optional, encrypted in
transit, deletable. Planner's answers:

| Play category | Data type | Collected? | Shared? | Optional? | Notes to give Play |
|---|---|---|---|---|---|
| Personal info | Email address | Yes (hosted) / No (local-only) | No | Yes — an account is optional | Used for app functionality: signing in and letting a linked guardian or student find the account. Encrypted in transit. Deletable in-app. |
| Personal info | User IDs / username | Yes (hosted) / No | No | Yes | Same as email: the username is the account identifier. |
| App activity | App interactions (planner entries, habits, focus sessions) | Yes (hosted) / No | No | Yes — only if sync is on | Stored **encrypted**; the operator cannot read it. The app's own note is: *data is encrypted on the device before upload and the key is not held by the server*. |
| App activity | In-app search history | No | No | — | Search is local and not recorded. |
| Photos and videos | Photos | No | No | — | The photo picker reads one chosen image on the device to build a plan; it is not uploaded. |
| Files and docs | Files | No | No | — | Imports are read locally. |
| Messages | Emails/SMS | No | No | — | Invites are one-time codes the person copies and sends themselves; the app never sends a message. |
| Device or other IDs | Device or other IDs | Yes | No | Yes — only with background notifications | The push token (FCM) is used to deliver the reminder the person scheduled. Deleted when the registration is removed or the app is uninstalled. |
| App info and performance | Crash logs, diagnostics | Yes | No | Yes — the report setting can be turned off | Sent only when a crash or an error happens and the setting is on; contains the error, the screen and the last few actions, never planner content. |
| Health and fitness | Health info | No | No | — | Mood check-ins are planner data, not health data, and stay encrypted. |
| Location | Approximate/precise location | No | No | — | The app never requests location. Weather is looked up by city name the person types. |
| Financial info | Any | No | No | — | No payments, no ads. |
| Contacts | Contacts | No | No | — | Guardian/student links use usernames, never the address book. |

Questions Play asks that are answered by the table: *Is all data encrypted in
transit?* — **Yes**, everything that leaves the device is HTTPS and additional
end-to-end encryption. *Do users have a way to request deletion?* — **Yes**,
in-app: Settings → Sync & backup → *Delete the cloud copy* removes the
encrypted vault, and deleting an account removes the stored data.

### 1.2 Content rating questionnaire (IARC)

| Question | Answer |
|---|---|
| Violence, blood, sexual content, nudity, profanity, drugs, alcohol, tobacco, gambling | No to all |
| User-generated content shared with other users? | Yes — a student may share weekly results and notes with a guardian, or a guardian may send a plan; the content is planner text, and the app has no public feed |
| Users can interact / share location with other users? | Users can interact (linked guardian and student only). No location sharing. |
| Digital purchases? | No |
| Contains ads? | No |
| Miscellaneous: unrestricted internet access? | The app can open external links in the system browser, which is expected |

Expected outcome: **Everyone / Rated for all ages** on both Play and the Apple
age rating (4+ with no unrestricted web access inside the app). Re-run the
questionnaire if the sharing model ever changes.

### 1.3 Declarations

- **Ads:** no ads, no ad SDKs.
- **Target audience:** 13+ (see the open question in `SPEC.md` §16 about an
  under-13 mode — nothing in the app records age or consent today, so do not
  claim a children's category).
- **News app:** not a news app.
- **Health apps declaration:** not a health app.
- **Financial features:** none.
- **Government app:** no.
- **Data deletion URL:** required when the app offers accounts — point it at the
  hosted copy of §4 below (the privacy policy), which states the in-app path.
- **App access:** the app works with no account, so no demo credentials are
  needed; say so in *App access* so a reviewer does not stop at the sign-in
  screen.

---

## 2. Apple App Store

### 2.1 App Privacy (App Store Connect → App Privacy)

For a **local-only** build: **Data Not Collected**. Nothing leaves the device.

For a **hosted** build, the answers are:

| App Privacy section | Data type | Answer |
|---|---|---|
| Contact Info | Email Address, Name, User ID | Collected, **linked to the user**, used for *App Functionality* (sign-in, linking). Not used for tracking. |
| User Content | Other User Content (planner entries, notes, plans) | Collected, linked, *App Functionality*. Stored encrypted; readable only by the person. |
| Identifiers | User ID, Device ID | Collected, linked, *App Functionality* (account id, push token). |
| Diagnostics | Crash Data, Performance Data | Collected, **not linked** if the person leaves crash reports on, *App Functionality*. |
| Usage Data | Product Interaction | Not collected. |
| Location, Health, Financial, Contacts, Browsing, Search | — | Not collected. |
| Tracking | — | **No tracking**, and no data used to track across apps or websites. |

Also answer in the same section: *Is this data used for third-party
advertising?* No. *Is it used for tracking?* No.

### 2.2 App Review notes

Paste this into *App Review Information → Notes*:

> Planner works fully without an account: open it and the whole planner is
> there, offline. Signing in is optional and only adds encrypted sync between
> the reviewer's own devices. Guardian and student linking needs two accounts
> and an invite code, which is why the app can be reviewed end-to-end through
> the personal planner alone.
>
> The app requests notification permission only when *Settings → Reminders* is
> turned on, camera-adjacent photo access only when *Add a plan picture* is
> tapped, and microphone access only when voice input is started. Face ID is
> requested only when *Unlock with Face ID* is switched on in Settings →
> Account.
>
> There is no pricing, no advertising and no third-party analytics SDK.

### 2.3 Export compliance

`ios/App/App/Info.plist` sets `ITSAppUsesNonExemptEncryption` to `false`: the
app uses HTTPS and the platform's own WebCrypto to protect the person's data
and to authenticate them, which is the standard exempt case. If the app ever
adds a cryptographic feature beyond that, revisit the key and the answer.

### 2.4 Other fields

- **Age rating:** 4+. Answer *no* to unrestricted web access — external links
  open in Safari, but there is no in-app browser.
- **Content rights:** the app's artwork is its own; the bundled Persian UI font
  is Vazirmatn (`public/fonts/`, SIL Open Font License, redistributable). No
  third-party music, video or photography.
- **Sign in with Apple:** not required — the app does not use a third-party
  social sign-in.
- **Category:** Productivity; secondary: Education (the student panel).
- **Screenshots:** see §3.

---

## 3. Screenshots

Both stores want a handful of real screens. The visual test suite already
renders the app at device sizes and freezes the results, which is the honest
source for these:

```bash
npm run build
npm run test:e2e:visual          # writes 15 PNGs under test-results/ and compares to the baselines
npm run test:e2e:visual:update   # refresh the baselines (and the screenshots) after a UI change
```

Take the store shots from the **phone** project's snapshots (day view, week
view, habits, insights, the settings sheet, and the panels), because that is the
shape both stores ask for first. Play needs a phone set plus a 7-inch and a
10-inch tablet set; the visual project's tablet viewport covers the second.
Screenshots must not contain a real person's planner: use `npm run dev` with the
mock data, or the built-in sample plan (*Settings → Load sample data*), and
check for names before uploading.

---

## 4. Privacy policy text

Both stores require a reachable policy URL. The text below is the whole policy;
host it wherever the deployment already lives (for example as a static page at
`/privacy` on the same domain, or as a repository file the landing page links
to) and give that URL to the stores.

> **Planner — privacy policy**
>
> Planner is a local-first planner. The short version: your planner is yours.
>
> **What stays on your device.** Your tasks, events, habits, goals, notes,
> attachments, mood check-ins and focus sessions are stored on the device you
> use, encrypted. Nothing is uploaded unless you turn on sync.
>
> **If you turn on sync.** Your planner is encrypted on your device before it
> is uploaded. The server stores encrypted data and the account details needed
> to sign you in (an email or username). It cannot read your planner, and
> nobody at the service can.
>
> **If you link a guardian or a student.** Only the weekly results you choose
> to share are sent: counts, focused minutes, per-subject minutes and the
> headline you write. Task titles, notes, reasons, exam dates and everything
> else stay private. You can unlink at any time; what was already shared stays
> with the person who received it.
>
> **What is never collected.** No location, no contacts, no advertising
> identifier, no third-party analytics, no data used to track you across other
> apps or websites. The app has no ads.
>
> **Notifications.** Reminders run on your device. If you turn on background
> notifications, the times you scheduled and an opaque device token are stored
> so the reminder can be delivered; the reminder itself is a generic sentence
> and never contains your task, event or habit text.
>
> **Crash reports.** Off unless you turn them on. A report contains the error,
> the screen you were on and the last few actions — never your planner content.
>
> **Deleting your data.** Settings → Sync & backup → *Delete the cloud copy*
> removes the uploaded copy. Deleting your account removes the stored account
> and its data. Everything else is already only on your device: uninstalling
> the app removes it.
>
> **Children.** Planner is not directed at children under 13, and the app does
> not record age or consent.
>
> **Contact.** Use the address published with the deployment.

If you change the sharing model, the retention window or the notification
payload, this policy and the labels above change with it — they are checked in
`docs/APPS.md` §9 for the technical half.

---

## 5. Submission checklist

Order matters: a store listing with the wrong privacy answers has to be
withdrawn, not edited.

1. Version numbers bumped (`android/app/build.gradle` `versionCode`/`versionName`,
   `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in the Xcode project).
2. `npm run check:deployment` green against the deployment the app will talk to.
3. `docs/APPS.md` §9.2 real-device checklist done on hardware: biometrics, a
   pushed reminder, and one deep link per platform.
4. Privacy answers copied from §1/§2 above, for the deployment shape being
   shipped — not from memory.
5. Store listing copy from `docs/APPS.md` §10, screenshots from §3 here.
6. Content rating questionnaire re-run if anything user-visible was added.
7. Signing: the permanent Android keystore and the Apple distribution profile.
8. Release notes: what changed, and anything that needs a person's action
   (a new permission prompt, a new setting they should check).
