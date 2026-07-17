# Android release signing and Google Play publishing

This document covers two separate distribution paths for `electerm-android`:

1. GitHub Releases / direct APK sideloading
2. Google Play Store publishing

They share the same app code, but they do **not** share the same release process.

## 1. Keep the release keystore consistent

Android requires every installable APK to be signed.

For GitHub Releases and direct sideloading, the signing key should be **stable** across builds. If you sign one release with one key and a later release with another key, Android treats them as different signers and the later APK will not update the installed app in place.

### What the current repo does

The CI workflow currently generates an **ephemeral keystore** during the release job and uses it to sign the release APK. That is enough for a one-off artifact download, but it is not good for long-term updates because the key changes every run.

### What to do instead

Use one persistent keystore for all GitHub Release APKs.

Recommended setup:

1. Generate a release keystore once.
2. Store the keystore file securely outside the repo.
3. Store the keystore password, key password, and alias in GitHub Secrets.
4. Make the Android build workflow load those secrets and sign release APKs with that same keystore every time.

### Suggested secret names

- `ANDROID_RELEASE_KEYSTORE_BASE64`
- `ANDROID_RELEASE_KEYSTORE_PASSWORD`
- `ANDROID_RELEASE_KEY_PASSWORD`
- `ANDROID_RELEASE_KEY_ALIAS`

Base64-encoding the keystore is often the easiest way to store it in GitHub Secrets.

### Example signing flow

At release time:

1. Decode the keystore secret into a temporary file in the workflow runner.
2. Pass the keystore path and passwords to Gradle.
3. Build the release APK.
4. Publish the resulting APK to GitHub Releases.

### Operational rules

- Never commit the keystore into git.
- Back up the keystore offline.
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
