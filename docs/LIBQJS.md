# libqjs.so (QuickJS) — YouTube needs a JS runtime

**الحالة: الملف غير موجود في المشروع ولا يجوز افتراض وجوده. دعم YouTube غير مكتمل بدونه.**

## لماذا
yt-dlp الحديث يحل تحدي YouTube بواسطة runtime خارجي (النسخة الأصلية Node كانت تمرّر `jsRuntimes:'node'`). `youtubedl-android` لا يضمّن أي runtime (README لا يذكره، وSeal issue #2543 يظهر `No supported JavaScript runtime could be found` ثم `Sign in to confirm you're not a bot`). yt-dlp يقبل `--js-runtimes RUNTIME[:PATH]` ومن بين المدعومين quickjs.

## ما هو جاهز في الكود
`YtDlpBridge.kt` → `jsRuntimeArgs()`: إن وُجد `<nativeLibraryDir>/libqjs.so` يضيف `--js-runtimes quickjs:<المسار>` لكل استدعاء. Engine status (Settings/ⓘ) يعرض `jsRuntime: none (YouTube may fail)` أو `quickjs`.

## ما ينقص (يدويًا، يتطلب جهاز بناء بإنترنت)
1. الحصول على مصدر QuickJS (أو QuickJS-ng) وبناء **ملف تنفيذي** `qjs` (وليس مكتبة) بـ Android NDK لكل ABI: arm64-v8a, armeabi-v7a, x86_64 (API 24+).
2. تسميته `libqjs.so` ووضعه في `app/android/app/src/main/jniLibs/<abi>/libqjs.so` (الاسم `lib*.so` ضروري ليستخرجه النظام إلى nativeLibraryDir؛ `extractNativeLibs=true` و`useLegacyPackaging=true` مفعّلان فعلًا).
3. التحقق على جهاز: `Engine status` يعرض quickjs، ثم Fetch Info على فيديو YouTube عام.
4. **غير مُتحقق منه:** هل نسخة yt-dlp المضمّنة في إصدار المكتبة المستخدم تدعم `--js-runtimes quickjs` وتقبل المسار؟ (تفقّد `yt-dlp --help` عبر `YoutubeDL.execute` أو الإصدار من Engine status). إن لم تدعمه: حدّث yt-dlp من التطبيق (زر التحديث) ثم أعد الاختبار.
5. قد يتطلب حل التحدي أيضًا حزمة `yt-dlp-ejs` (سكربتات JS) داخل yt-dlp المضمّن — تحقق أنها موجودة في الحزمة (pip package يتضمنها عادة في الإصدارات الحديثة؛ غير مؤكد هنا).

## بدائل إن تعذّر
- استيراد `cookies.txt` لحساب YouTube (غير منفّذ في الواجهة بعد).
- `youtube_explode_dart` لـ YouTube فقط (يفقد مزايا yt-dlp؛ قرار معماري يحتاج موافقة).
