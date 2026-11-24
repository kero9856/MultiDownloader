#!/usr/bin/env bash
# Run from app/ on a machine with Flutter + Android SDK + internet.
set -e
flutter create --platforms=android --org com.multidownloader --project-name multidownloader .   # fills gradlew, icons, local.properties; never overwrites our files
# flutter create also generates a MainActivity in com/multidownloader/multidownloader and, depending on the Flutter version,
# Groovy gradle files next to our .kts ones: remove those duplicates (our MainActivity/gradle files are the real ones).
rm -rf android/app/src/main/kotlin/com/multidownloader/multidownloader
for f in android/build.gradle android/settings.gradle android/app/build.gradle; do [ -f "$f.kts" ] && rm -f "$f"; done
flutter pub get
flutter analyze
flutter test
flutter build apk --debug --target-platform android-arm64
