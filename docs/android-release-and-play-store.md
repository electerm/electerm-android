# Android release signing and Google Play publishing

This document covers two separate distribution paths for `electerm-android`:

1. GitHub Releases / direct APK sideloading
2. Google Play Store publishing

They share the same app code, but they do **not** share the same release process.

## 1. Keep the release keystore consistent

Android requires every installable APK to be signed.

For GitHub Releases and direct sideloading, the signing key should be **stable** across builds. If you sign one release with one key and a later release with another key, Android treats them as different signers and the later APK will not update the installed app in place.

### What the current repo does

The CI workflow decodes a **persistent keystore** from GitHub Secrets (`ANDROID_RELEASE_KEYSTORE_BASE64`) and uses it to sign all release APKs with the same key. This ensures stable update continuity for sideloaded installs.

### Operational setup

Use one persistent keystore for all GitHub Release APKs.

1. Generate a release keystore once.
2. Store the keystore file securely outside the repo.
3. Store the keystore password, key password, and alias in GitHub Secrets.
4. Make the Android build workflow load those secrets and sign release APKs with that same keystore every time.

### Generate the keystore

Run these commands on a secure machine (not in CI). The keystore file is the only thing you keep locally.

```bash
keytool -genkey -v \
  -keystore release.keystore \
  -alias electerm \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass YOUR_KEYSTORE_PASSWORD \
  -keypass YOUR_KEY_PASSWORD \
  -dname "CN=electerm, OU=electerm, O=electerm, L=Unknown, ST=Unknown, C=US"
```

Replace `YOUR_KEYSTORE_PASSWORD` and `YOUR_KEY_PASSWORD` with strong passwords.

### Encode and store in GitHub Secrets

Base64-encode the keystore file and store the result along with the other values as GitHub Actions secrets.

```bash
# macOS / Linux
base64 -i release.keystore | pbcopy        # macOS
base64 -w 0 release.keystore               # Linux (print to stdout)

# Windows (PowerShell)
[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Set-Clipboard
```

Set these four secrets in your GitHub repository (Settings → Secrets and variables → Actions):

| Secret name | Value |
|---|---|
| `ANDROID_RELEASE_KEYSTORE_BASE64` | The base64-encoded keystore content |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | The `-storepass` value you chose |
| `ANDROID_RELEASE_KEY_PASSWORD` | The `-keypass` value you chose |
| `ANDROID_RELEASE_KEY_ALIAS` | The `-alias` value you chose (e.g. `electerm`) |

### Operational rules

- Never commit the keystore into git.
- Back up the keystore file offline (e.g. encrypted USB or password manager).
- Keep the alias and passwords documented somewhere safe.
- If the keystore is lost, app update continuity is lost for sideloaded releases.

## 2. Can users install from GitHub Releases?

Yes.

Android users can download a signed APK from GitHub Releases and install it manually, as long as the device allows sideloading from unknown sources.

For this repo, that is enough for direct distribution.

What Google Play adds is:

- managed app updates
- store listing and discovery
- Play App Signing
- policy and review handling

Google Play is **not required** if you only want direct APK distribution.

## 3. Google Play publishing guide

Google Play now expects new apps to use Android App Bundles (`.aab`) for production publishing. Play Console also uses Play App Signing.

### High-level steps

1. Create a Google Play Developer account.
2. Create the app in Play Console.
3. Complete the store listing and policy declarations.
4. Enable Play App Signing.
5. Build and upload an Android App Bundle.
6. Pass review and publish to production or a testing track.

### Practical checklist for this repo

#### A. Set up package and versioning

- Keep the app package name stable: `org.electerm.electerm`.
- Increment `versionCode` for every Play upload.
- Increment `versionName` as desired for human-readable releases.

The repo version lives in `package.json`. The Capacitor template hardcodes
`versionCode 1` / `versionName "1.0"`, so `build/android/scripts/set-version.mjs`
rewrites the generated Gradle file before the build:

```
versionCode = major * 1000000 + minor * 1000 + patch
```

| package.json version | versionCode |
|---|---|
| `5.8.0` | `5008000` |
| `5.7.21` | `5007021` |
| `5.5.77` | `5005077` |

Play's `versionCode` ceiling is `2100000000`, so this leaves room for
`major <= 2100` and `patch <= 999`. The upstream version scheme uses the patch
slot as a build counter (`5.5.77`, `5.7.21`), well under the limit.

Both `build-android.yml` (the GitHub Release APKs) and
`publish-google-play.yml` (the Play AAB) run this step. Without it every APK
reports itself as version `1.0` to Android — the filename would say `5.8.0`
while Settings and `dumpsys package` show `1.0`. It also lets the GitHub
Release APKs go to Play directly, since both channels then share one version
scheme.

#### B. Build an App Bundle, not just an APK

For Google Play, the required production artifact is an `.aab`.

The repo builds both:

- `assembleRelease` → per-ABI APKs for GitHub Releases and manual testing
- `bundleRelease` → a single AAB for Play Console submission

Both use the same `android.injected.signing.*` keystore injection.

Measured on `5.8.0`:

| Artifact | Size |
|---|---|
| `app-release.aab` (uploaded file) | ~107 MB |
| per-device compressed download (worst ABI) | ~24 MB |

The 200 MB Play limit applies to the **compressed per-device download**, not the
uploaded bundle, so there is a lot of headroom.

#### C. Enable Play App Signing

In Play Console, configure Play App Signing during app setup or on the first release.

With Play App Signing:

- Google stores the app signing key
- you upload with an upload key
- Google re-signs the distributed app

This is the standard model for Play distribution.

> **Key continuity matters here.** The keystore in `ANDROID_RELEASE_KEYSTORE_BASE64`
> is what every GitHub Release APK is signed with. If Play generates its own app
> signing key, the Play-installed app has a **different signature** than the
> sideloaded APK, so existing sideloaded users must uninstall before installing
> from Play. To keep them interchangeable, enroll the *same* keystore as the Play
> app signing key (upload it via PEPK) instead of letting Google generate one.
>
> The keystore file itself can only come from wherever it was originally saved —
> GitHub cannot read a secret back (`gh secret get` no longer exists, and the
> secrets API does not return `encrypted_value`). Alternatively, run
> `.github/workflows/export-play-signing.yml`: it decodes the keystore on the
> runner, produces the PEPK-encrypted export that Play asks for, and deletes the
> plain keystore, so no cleartext key ever reaches an artifact.
>
> The upload key should still be a *different* key from the app signing key, per
> Google's recommendation.

#### D. Upload the first release

> **The first upload for a new package must be done manually from the Play
> Console.** The Android Publisher API only knows a package after one manual
> upload; until then the API rejects every request with `Package not found`.

1. Create the app entry (package `org.electerm.electerm`).
2. Complete identity, content, privacy, and policy forms.
3. Upload the signed AAB manually (use the artifact from the CI run).
4. Review generated device coverage and warnings.
5. Publish to internal testing, closed testing, or production.

After that first manual upload, the CI workflow can publish on every run.

#### E. Prepare testing tracks

Before production, use one of these:

- Internal testing
- Closed testing
- Internal app sharing

These tracks let you verify the build on real devices before broader release.

> An **organization** developer account is exempt from the "12 testers / 14
> consecutive days" closed-testing gate that applies to personal accounts
> created after 2023-11-13. It can go straight to production.

#### F. Current compliance status

Verified against the build in this repo:

| Requirement | Value | Status |
|---|---|---|
| Target API level (new apps, from 2026-08-31) | 36 | OK |
| Min SDK | 24 | OK |
| 16 KB page size (64-bit) | `arm64-v8a` / `x86_64` aligned to 16384 | OK |
| 64-bit native libs | `arm64-v8a`, `x86_64` | OK |
| AAB format | `bundleRelease` | OK |
| Signed bundle | upload key | OK |
| Monotonic `versionCode` | injected at build time | OK |
| Sensitive permissions | none | OK |
| Privacy policy URL | <https://electerm.org/privacy-policy/> | OK |

The 16 KB requirement only applies to 64-bit devices; the 32-bit `armeabi-v7a`
`libc++_shared.so` is still 4 KB-aligned, which is fine.

### Store listing assets still needed

Play requires assets the repo does not currently produce:

| Asset | Requirement | Current state |
|---|---|---|
| App icon | 512 × 512 PNG | largest in repo is 192 px |
| Feature graphic | 1024 × 500 | missing |
| Phone screenshots | at least 2, 320–3840 px | missing |
| Short description | ≤ 80 chars | to write |
| Full description | ≤ 4000 chars | to write |

The in-app launcher icons are generated by `build/android/scripts/gen-assets.py`
into `res-overlay/mipmap-*/`; a 512 × 512 store icon has to be exported
separately from the same source artwork.

### Important Play Store notes

- Play Console enforces `versionCode` limits.
- Play requires current target API levels.
- The store review process can reject builds for policy or content issues.
- If you change signing keys after launch, you need to follow Play’s key management flow.

## 5. CI for Google Play

`.github/workflows/publish-google-play.yml` builds a signed AAB and uploads it to
Google Play. It is **manually triggered** (`workflow_dispatch`) so a release is
never pushed by accident.

Inputs: `track` (internal / alpha / beta / production), `status`
(draft / completed / inProgress / halted), `release_notes`.

### Required GitHub secrets

| Secret | Value | Status |
|---|---|---|
| `SERVER_SECRET` | JWT secret for the on-device electerm server | exists |
| `ANDROID_RELEASE_KEYSTORE_BASE64` | base64 of the upload-key `.keystore` | exists |
| `ANDROID_RELEASE_KEYSTORE_PASSWORD` | keystore store password | exists |
| `ANDROID_RELEASE_KEY_ALIAS` | keystore key alias | exists |
| `ANDROID_RELEASE_KEY_PASSWORD` | keystore key password | exists |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | full JSON of a Play service account | **to create** |

Only one secret has to be added. The keystore secrets are reused as-is.

### Creating the Play service account

1. In [Google Cloud Console](https://console.cloud.google.com/), enable the
   **Google Play Android Developer API** for a project.
2. **IAM & Admin → Service Accounts → Create service account**. No project
   roles are needed.
3. **Keys → Add key → JSON**, and store the file content in the
   `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret.
4. In [Play Console](https://play.google.com/console) → **Users and permissions**
   → **Invite new users**, and paste the service account's
   `...@<project>.iam.gserviceaccount.com` address.
5. Grant it the permissions it needs on the app: *Manage tracks* (uploading to
   testing tracks) and *Manage production releases*. The link takes effect
   immediately — service accounts have no inbox and need no acceptance step.

```bash
gh secret set GOOGLE_PLAY_SERVICE_ACCOUNT_JSON < service-account.json
```

### Signing vs. Play App Signing

Two different keys are involved:

- **Upload key** — signs the `.aab` you upload. The repo's existing keystore is
  used for this, so `ANDROID_RELEASE_KEYSTORE_*` covers it.
- **App signing key** — signs the APK that reaches the user's device. Google
  generates and holds this one by default.

To let the Play build update a sideloaded build in place, the app signing key
must be the **same** keystore the GitHub Release APKs use. Enroll it in
Play Console → *Release → Setup → App signing → Change app signing key →
Upload a new app signing key from Java Keystore* (uses the
[PEPK](https://developer.android.com/studio/publish/app-signing) tool).

### Workflow steps

```
checkout → node 24 → JDK 21 → Android SDK 36
  → npm i → npm run build:android
  → cap add android → cap sync android
  → overlay (res-overlay → native tree)
  → set-version (versionCode / versionName)
  → gradle bundleRelease (signed)
  → verify-aab (signature + version + targetSdk)
  → upload artifact → upload to Play
```

The overlay step copies `build/android/res-overlay/` by hand rather than calling
`build.mjs --overlay-only`, because CI regenerates the native project from
scratch — same as `build-android.yml`.

### Guard scripts

- `build/android/scripts/set-version.mjs` — injects `versionCode` / `versionName`
  into the generated Gradle file. Fails loudly if the template layout changes.
- `build/android/scripts/verify-aab.mjs` — checks the built bundle is signed and
  carries the expected version and target SDK before the upload step runs.

The manifest inside an `.aab` is protobuf-encoded, so `strings` does not expose
the values; `verify-aab.mjs` reads them out of the length-prefixed attributes.

### Exporting Play signing material

`.github/workflows/export-play-signing.yml` produces the files Play Console asks
for when enrolling an existing signing key:

- `signing_key.zip` → *Upload a new app signing key from Java Keystore*
- `upload_certificate.pem` → *Upload your upload key certificate*

It decodes the keystore from `ANDROID_RELEASE_KEYSTORE_BASE64` on the runner,
runs the official PEPK tool, and deletes the plain keystore, so no cleartext key
ever reaches an artifact. It needs one extra secret, the public encryption key
downloaded from the Play Console screen:

```bash
base64 -i encryption_public_key.pem | tr -d '\n' > /tmp/ek.txt
gh secret set PLAY_ENCRYPTION_KEY_B64 < /tmp/ek.txt
```

Artifacts of a public repo are listed anonymously but downloading them requires
authentication (the API returns 401 without a token). Treat the artifact as a
secret anyway — it decrypts into your signing key — and delete it once used.

## 6. Recommended distribution strategy for this project

For this repo, the most practical split is:

- GitHub Releases: signed APK, manually installed by users
- Google Play: signed AAB, uploaded through Play Console

That gives you:

- a direct-download channel for power users
- an official store channel for broader distribution

## References

- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)
- [Use Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)
- [Sign and upload an APK](https://support.google.com/googleplay/android-developer/answer/16761055?hl=en)
- [Select key for existing package name](https://support.google.com/googleplay/android-developer/answer/16762143?hl=en)
- [Target API level requirements](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
- [Support 16 KB page sizes](https://developer.android.com/guide/practices/page-sizes)
- [App testing requirements for new personal developer accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
