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

### What to do instead

Use one persistent keystore for all GitHub Release APKs.

Recommended setup:

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

- Keep the app package name stable.
- Increment `versionCode` for every Play upload.
- Increment `versionName` as desired for human-readable releases.

The repo already has a version in [`package.json`](/E:/dev/electerm-android/package.json). Make sure the Android Gradle config uses a monotonically increasing `versionCode` for each upload.

#### B. Build an App Bundle, not just an APK

For Google Play, the preferred production artifact is an `.aab`.

If the current Android build only produces APKs, add or adjust the Gradle release task so the CI can build:

- `bundleRelease` for Google Play
- `assembleRelease` for direct APK distribution

You can keep both:

- APK for GitHub Releases and manual testing
- AAB for Play Console submission

#### C. Enable Play App Signing

In Play Console, configure Play App Signing during app setup or on the first release.

With Play App Signing:

- Google stores the app signing key
- you upload with an upload key
- Google re-signs the distributed app

This is the standard model for Play distribution.

#### D. Upload the first release

For the first production or testing release:

1. Create the app entry.
2. Complete identity, content, privacy, and policy forms.
3. Upload the signed AAB.
4. Review generated device coverage and warnings.
5. Publish to internal testing, closed testing, or production.

#### E. Prepare testing tracks

Before production, use one of these:

- Internal testing
- Closed testing
- Internal app sharing

These tracks let you verify the build on real devices before broader release.

### Important Play Store notes

- Play Console enforces `versionCode` limits.
- Play requires current target API levels.
- The store review process can reject builds for policy or content issues.
- If you change signing keys after launch, you need to follow Play’s key management flow.

## 4. Recommended distribution strategy for this project

For this repo, the most practical split is:

- GitHub Releases: signed APK, manually installed by users
- Google Play: signed AAB, uploaded through Play Console

That gives you:

- a direct-download channel for power users
- an official store channel for broader distribution

## 5. Repo action items

If you want to make GitHub Releases reliable for updates, update the CI workflow to:

- read a persistent release keystore from secrets
- stop generating a new keystore every run
- sign all release APKs with the same key

If you want Play Store support, add a bundle release path and upload the `.aab` to Play Console.

## References

- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en)
- [Use Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756?hl=en)
- [Sign and upload an APK](https://support.google.com/googleplay/android-developer/answer/16761055?hl=en)
- [Select key for existing package name](https://support.google.com/googleplay/android-developer/answer/16762143?hl=en)
