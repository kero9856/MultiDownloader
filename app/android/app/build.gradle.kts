plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.multidownloader.app"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    defaultConfig {
        applicationId = "com.multidownloader.app"
        minSdk = 24            // required by youtubedl-android
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // youtubedl-android ships python/ffmpeg/aria2c as native libs that must be extracted to disk.
    packaging { jniLibs { useLegacyPackaging = true } }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}

flutter { source = "../.." }

dependencies {
    // yt-dlp + python + ffmpeg + aria2c for Android (0.18.1 = version in the upstream README; Maven Central page showed 0.17.4 for `common` - verify on first online build)
    val ytdl = "0.18.1"
    implementation("io.github.junkfood02.youtubedl-android:library:$ytdl")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:$ytdl")
    implementation("io.github.junkfood02.youtubedl-android:aria2c:$ytdl")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
