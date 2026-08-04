# Upgrade AGP from 8.13.0 to 9.3.1

The goal is to complete the manual upgrade of the Android Gradle Plugin (AGP) to version 9.3.1, resolving the "Cannot find AGP version" error in the Upgrade Assistant and fixing the Gradle distribution path issue.

## User Review Required

> [!IMPORTANT]
> I am switching the Gradle distribution URL from a local path (`C:\gradle-local\...`) to the official remote URL (`https://services.gradle.org/...`) to ensure the build system can download the required Gradle 9.5.0 version. Please confirm if you must use a local file instead.

> [!WARNING]
> I will be migrating the AGP dependency from the `buildscript` block to the modern `plugins` DSL. This is generally required for newer AGP versions to be correctly recognized by the IDE's Upgrade Assistant.

## Proposed Changes

### Gradle Configuration

#### [MODIFY] [gradle-wrapper.properties](file:///C:/Pessoal/ArquitetoDeValor/FrontEnd/android/gradle/wrapper/gradle-wrapper.properties)
- Change `distributionUrl` to use the remote services URL for Gradle 9.5.

#### [MODIFY] [build.gradle](file:///C:/Pessoal/ArquitetoDeValor/FrontEnd/android/build.gradle) (Top-level)
- Remove the `buildscript` block for AGP and Google Services.
- Add a `plugins` block to declare the versions of `com.android.application`, `com.android.library`, and `com.google.gms.google-services`.

#### [MODIFY] [app/build.gradle](file:///C:/Pessoal/ArquitetoDeValor/FrontEnd/android/app/build.gradle)
- Replace `apply plugin: 'com.android.application'` with the `plugins { id 'com.android.application' }` block.

#### [MODIFY] [gradle.properties](file:///C:/Pessoal/ArquitetoDeValor/FrontEnd/android/gradle.properties)
- Update or remove legacy flags that might conflict with AGP 9.3.1 behavior. Specifically, I'll check `android.newDsl`.

## Verification Plan

### Automated Tests
- Run `./gradlew sync` to verify that the project structure is recognized.
- Run `./gradlew assembleDebug` to ensure the project still builds.

### Manual Verification
- Check if the "Upgrade Assistant" in Android Studio now recognizes the AGP version (it should show the upgrade as completed or allow further steps).
