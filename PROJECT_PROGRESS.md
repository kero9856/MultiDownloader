# PROJECT_PROGRESS.md

## الجلسة 4 — إصلاحات من مراجعة الكود (ساكنة فقط)
**لم يُشغَّل أي شيء:** لا Flutter/Dart/Kotlin compiler/Android SDK في البيئة (فقط `java`). لم يُنفَّذ `flutter analyze` ولا `flutter test` ولا build. الفحص الوحيد: توازن الأقواس لكل ملفات Dart/Kotlin + تتبّع يدوي للاختبارات. كل ما يلي **مكتوب وغير مُختبر**.

### ما أُصلح
1. حذف عنصر/مسح السجل يحذف الآن ملفات التطبيق (مجلد الـ job) + النسخة العامة (`deletePublic` عبر MediaStore) مع تأكيد (`deleteHistoryEntry/clearHistory`).
2. `safeName` يدعم العربية وكل اللغات (`\p{L}\p{N}` + unicode)، ويقتطع بالـ code points.
3. تقدم الصيغ المدمجة: `core/progress.dart` (`advanceProgress`) يدمج مرحلتي فيديو+صوت في شريط واحد لا يرجع للخلف (`DownloadJob.streams/stage`).
4. Foreground Service: لا `stopService` مباشر؛ الإيقاف عبر intent `ACTION_STOP` يستدعي `startForeground` أولًا، مع أعلام `wanted/sent` لحل السباق، وtry/catch لرفض النظام (Android 12+).
5. مشاركة الرابط (ACTION_SEND): `MainActivity` + قناة `multidownloader/share` + `services/share_intake.dart`؛ يملأ الحقل ويجلب المعلومات تلقائيًا.
6. ترتيب قواعد الأخطاء: `not a bot` قبل قواعد تسجيل الدخول؛ قاعدة `geo` ضُيّقت.
7. `validateUrl` يحجب عناوين IP الحرفية الخاصة/loopback/link-local/CGNAT/IPv6 (`isPrivateIp`). فحص DNS للأسماء ما زال غير منقول.
8. `listUnfinished()` مخزّن مؤقتًا (يُعاد المسح عند الأحداث فقط)؛ المهام الملغاة/الفاشلة تظهر كبطاقة واحدة بزرّي Resume/Discard (`resumeJob`) بلا تكرار.
9. `Shell` يستعمل `IndexedStack` (لا تضيع نتيجة Fetch عند تبديل التبويب)، و`mounted` قبل كل `setState` بعد `await`، وتنظيف المتحكمات.
10. `cancel()` لا يؤثر أثناء `processing` (لم يعد يُكتب فوقه `done`).
11. كاش المعلومات صار 10 دقائق (`AppConfig.infoCacheMinutes`) كالأصل.
12. `--no-check-certificates` صار اختياريًا (Settings → Ignore certificate errors، الافتراضي مُطفأ).
13. تمرير الوسائط إلى yt-dlp كأزواج (option,value) عبر `addArgs` (لا تصادم قيم).
14. اختيار الملف الناتج في Kotlin: أكبر `download.<ext>` مع تجاهل `.part/.ytdl/.temp/-FragN/.fNNN`.
15. `MainActivity` يسجّل المشغّل عبر `FlutterPlugin` (`NativePlayerPlugin`) بدل `platformViewsController` الداخلي؛ `NativePlayer` ينظّف الـ handler عند `dispose`.
16. `export()`: اسم بلا نقطة لم يعد يتكرر. حد السرعة يُحفظ عند الكتابة. زر تحديث yt-dlp يعرض النتيجة الفعلية.
17. `proguard-rules.pro` (keep لـ youtubedl-android/Jackson) مربوط بـ release؛ `tools/verify.sh` يحذف MainActivity الزائد وملفات Groovy المكررة بعد `flutter create`.
18. اختبارات جديدة: `test/fixes_test.dart` (عربي، bot-check، private IP، progress، share، HistoryStore) — **غير مُشغَّلة**.

### ما لم يُختبر / ما زال مفتوحًا
- كل شيء (ترجمة Dart/Kotlin، Gradle، التشغيل). أول خطوة: `cd app && bash tools/verify.sh` وإصلاح ما يظهر.
- تحقق على جهاز: `--download-sections` (اسم الملف الناتج)، الخدمة الأمامية على Android 14/15 مع رفض الإشعارات، `deletePublic` على MediaStore، R8 في release، `addOption(key,value)` مع 0.18.1، سلوك `ShareIntake` عند البدء البارد.
- مفتوح من قبل: `libqjs.so` (YouTube)، دمج مقاطع ffmpeg، HLS، فحص DNS للأسماء، cookies.txt.


> الأقسام المؤرخة "الجلسة 1/2" أسفل هذا القسم تاريخية؛ قوائم "لم يُنجز" فيها حُدّثت هنا.

## الجلسة 3 — ملخص صادق
**البيئة ما زالت بلا Flutter/Dart/Kotlin compiler/Android SDK وبلا شبكة (pub.dev/Maven/Google محجوبة). لم يُبنَ شيء ولم يُشغَّل شيء. كل ما يلي مكتوب وغير مُختبر. لا وظيفة هنا تُعتبر "تعمل".** الفحص الوحيد: توازن الأقواس لكل ملفات Dart/Kotlin + مراجعة يدوية.

### الوظائف وحالتها
| # | الوظيفة | الحالة |
|---|---|---|
| 1 | Playlist (جلب حتى 200، تحديد، جودة موحدة، تنزيل المحدد، زر "Load the whole playlist" من فيديو داخل قائمة) | مكتوب، غير مُختبر |
| 2 | القنوات/الحسابات (YouTube + TikTok، آخر 50 فيديو، فتح فيديو منها) | مكتوب، غير مُختبر |
| 3 | الترجمات SRT/VTT (`--skip-download --write(-auto)-subs --convert-subs`) | مكتوب، غير مُختبر |
| 4 | استئناف/حذف التنزيلات غير المكتملة من الواجهة (يقرأ job.json ويكمل بـ `--continue`) | مكتوب، غير مُختبر |
| 5 | إعدادات السرعة normal/fast/max + حد MB/s + aria2c (`--downloader libaria2c.so`) + stall watchdog (45s → إعادة تشغيل واستئناف) | مكتوب، غير مُختبر |
| 6 | Foreground Service (إشعار بالتقدم، `dataSync`) يبدأ/يتوقف تلقائيًا مع وجود تنزيلات نشطة | مكتوب، غير مُختبر (انتبه لقواعد Android 14 ورفض إذن الإشعارات) |
| 7 | حفظ في `Download/MultiDownloader` (MediaStore على API29+، نسخ مباشر على 24–28) + مفتاح في الإعدادات | مكتوب، غير مُختبر |
| 8 | معاينة أصلية: `android.widget.VideoView` كـ PlatformView (بدون أي مكتبة مشغّل ولا proxy) تشغّل ملفًا واحدًا فيديو+صوت عبر http مع headers | مكتوب، غير مُختبر |
| 9 | حفظ ما شوهد: تتبع المقاطع المُشاهَدة فعليًا ثم `--download-sections *a-b` بملف واحد | مكتوب، غير مُختبر — **انحراف عن الأصل** (أدناه) |

### قرارات وانحرافات عن الأصل (يجب أن يعرفها من يكمل)
- **المعاينة 8:** الأصل كان يمرّر الفيديو عبر proxy ويدعم HLS. هنا نشغّل مباشرة فقط الصيغ المدمجة (فيديو+صوت، http/https، mp4/webm/m4v/mov) عبر `buildPlayable/pickPlayable` (port لـ findPlayable). جودات YouTube العالية (فيديو وصوت منفصلان) **لا تُشغَّل** وتظهر نفس رسالة الأصل. HLS على VideoView غير مُجرَّب ولم يُفعَّل عمدًا.
- **"المعاينة بقطع 5 ثوانٍ"** (createPreview) **لم تُنقل**.
- **الحفظ 9:** الأصل يدمج قطعًا منفصلة بـ ffmpeg concat. لا يوجد ffmpeg مستقل ⇒ نحفظ **النطاق المحيط** من أول مقطع شوهد لآخره (قد يشمل أجزاء تم تخطيها؛ الواجهة تنبّه). الدمج الدقيق لعدة مقاطع يحتاج ثنائي ffmpeg قابلًا للتشغيل (غير متوفر/غير مُتحقق منه).
- **لا مكتبات جديدة بإصدارات مخمّنة:** حُذفت من pubspec: `permission_handler`, `shared_preferences`, `url_launcher`, `path`. الإعدادات في `settings.json`، الأذونات من Kotlin مباشرة. المتبقي: `provider`, `path_provider`, `crypto`, `open_filex` (+ flutter_lints). **حدود الإصدارات الدنيا في pubspec كتبتها من الذاكرة ولم تُتحقق** — `flutter pub get` هو الحَكَم؛ عدّلها حسب ما يُحلّ فعليًا.
- المشغّل الأصلي لا يضيف dependency (framework `VideoView`).
- `youtubedl-android` الآن `0.18.1` (حسب README الرسمي) — لم يُحَل من Maven فعليًا.

### QuickJS / libqjs.so (مراجعة مطلوبة)
**الملف غير موجود، ولا افتراض بوجوده، ودعم YouTube غير مكتمل بدونه.** الخطاف في `YtDlpBridge.kt` (`jsRuntimeArgs`) جاهز ويتحقق من وجود الملف وقت التشغيل ويُظهر الحالة في Engine status. خطوات توفيره ودمجه والتحقق وما لم يُتحقق منه ومسار البدائل: **`docs/LIBQJS.md`**.

### الملفات الجديدة في الجلسة 3
`app/lib/core/{collections,speed,watched_ranges}.dart`, `app/lib/services/settings_store.dart`, `app/lib/ui/{native_player,preview_page,settings_page,collections_views}.dart`, `app/android/.../{NativePlayer,DownloadService}.kt`, `app/test/features_test.dart`, `docs/LIBQJS.md`.
### الملفات المعدّلة في الجلسة 3
`app/pubspec.yaml`, `app/lib/models/models.dart` (PlayableFormat، Playlist/Profile/AppSettings، حقول DownloadJob/HistoryEntry)، `app/lib/core/quality_builder.dart` (buildPlayable/pickPlayable)، `app/lib/services/{download_manager,ytdlp_bridge}.dart` (إعادة كتابة موسّعة)، `app/lib/ui/{home_page,downloads_page,history_page,shell}.dart`, `app/android/.../{MainActivity,YtDlpBridge}.kt`, `app/android/app/src/main/AndroidManifest.xml` (service). `original/yt-grab/` **لم يُمَس**.

### فصل الواجهة عن المنطق
المنطق في `lib/core` (نقي، قابل للاختبار) و`lib/services` (DownloadManager/Bridge/Stores). الواجهة `lib/ui` تستدعي DownloadManager فقط ولا تلمس القنوات الأصلية — باستثناء `native_player.dart` (غلاف الـ PlatformView لأنه عنصر واجهة بطبيعته).

### ما لم يُختبر (كل شيء) — وأخطر نقاط الشك
Dart: الترجمة أصلًا (records، switch expressions، definite assignment لـ `out` في `_run`). Kotlin: أسماء/توقيعات `YoutubeDL.execute`، `version(ctx)`، `updateYoutubeDL`، `VideoView.setVideoURI(uri, headers)`، تسجيل PlatformViewFactory عبر `flutterEngine.platformViewsController.registry`. تشغيلية: استقرار الخدمة الأمامية، ظهور الملف في Download، استئناف بعد إلغاء/قتل التطبيق، watchdog (يُلغي العملية ثم يعيد `execute` بنفس processId)، aria2c، VideoView مع headers لروابط YouTube.

### لم يُنجز بعد
- `libqjs.so` (انظر أعلاه) ⇒ YouTube غير مكتمل.
- معاينة القطع (createPreview) و HLS و`/api/hls-save` و`assembleHls`؛ الدمج الدقيق بـ ffmpeg.
- fallback لـ X (`findXMediaUrl`)، فحص private-IP عبر DNS، قياس الأحجام بـ HEAD/Range، "Show all sizes" في playlist.
- استيراد cookies.txt (YouTube/Instagram المقيّد)، أيقونات التطبيق، طلب إذن الإشعارات بشكل تفاعلي (حاليًا fire-and-forget)، حذف ملفات من History يحذف النسخة العامة أيضًا (حاليًا لا).

### المهمة التالية بدقة (الحساب 4) — جهاز بـ Flutter + Android SDK + إنترنت
1. `cd app && bash tools/verify.sh`. أصلح بالترتيب: `flutter pub get` (عدّل حدود الإصدارات)، `flutter analyze`، `flutter test` (4 ملفات اختبار: format_selectors, quality_builder, features)، ثم أخطاء Kotlin. سجّل بالضبط ما أصلحته.
2. شغّل على جهاز arm64 حقيقي واختبر **بالترتيب وسجّل نتيجة كل بند حرفيًا هنا (نجح/فشل/لم يُجرَّب)**: Engine status → Fetch Info (TikTok أو فيديو CC على YouTube) → تنزيل 720p → ظهور الملف في Download/MultiDownloader → إلغاء ثم Resume من Unfinished → تنزيل في الخلفية مع إشعار → Subtitles → Playlist صغيرة → Profile → Watch (صيغة 18 المدمجة) ثم Save what I watched → السرعة (Max/aria2c).
3. وفّر `libqjs.so` حسب `docs/LIBQJS.md` وتحقق من YouTube.
4. بعدها: المتبقي في قائمة "لم يُنجز".

---
## (الجلسة 2) ⚠️ حالة الاختبار — اقرأ أولًا
**لم يُبنَ ولم يُشغَّل أي شيء.** الجلسة 2 تأكدت أن البيئة لا تحتوي Flutter/Dart/Kotlin compiler/Android SDK، وأن الشبكة محجوبة (pub.dev, Maven, Google, storage.googleapis كلها مرفوضة؛ GitHub محجوب أيضًا للمواقع). لذلك: لا `flutter analyze` ولا `flutter test` ولا build. ما فُحص فقط: توازن الأقواس في كل ملفات Dart/Kotlin، ومراجعة يدوية. **التحميل الفعلي غير مُختبر ولا يجوز اعتباره يعمل.** كل الأكواد أدناه "مكتوبة وغير مُجرَّبة".

## ما أُنجز في الجلسة 2 (فوق الجلسة 1، بدون إعادة إنشاء شيء)
- `lib/core/errors.dart`: تعيين رسائل yt-dlp الودودة (port من errors.js، رسائل مختصرة، نفس الترتيب والأكواد).
- `lib/core/quality_builder.dart`: port لـ `buildOptions` و`buildSubtitles` و`guessHeight` و`fmtDuration` وتجميع الـ info (`videoInfoFromJson`). **فرق عن الأصل:** لا قياس حجم عبر HEAD/Range (`streamSize`)، فقط filesize/filesize_approx/bitrate×duration.
- `lib/models/models.dart`، `lib/services/history_store.dart` (port من history.js)، `lib/services/download_manager.dart` (port من jobs.js: مجلد لكل url+جودة بنفس hash، job.json/meta.json، طابور بحد 3، تقدم، إلغاء مع إبقاء الملف الجزئي، history، قائمة unfinished، دمج المنشورات متعددة الفيديو، كاش info).
- واجهة Flutter حقيقية: `ui/shell.dart` (3 تبويبات + ثيم داكن/فاتح + زر تحديث yt-dlp + Engine status)، `home_page.dart` (لصق رابط، Fetch Info، بطاقة الفيديو، اسم الملف، اختيار الجودة/الصوت بالأحجام، زر Download)، `downloads_page.dart` (تقدم/إلغاء/فتح + قائمة unfinished)، `history_page.dart`.
- Kotlin: `diagnose`، وخطاف JS runtime (`--js-runtimes quickjs:<nativeLibDir>/libqjs.so` إن وُجد الملف)، `withCommon()` للخيارات المشتركة.
- تحديث `build.gradle.kts` إلى `youtubedl-android 0.18.1`، وإزالة `abiFilters` (يتعارض مع `--split-per-abi`).
- `app/tools/verify.sh` (create → pub get → analyze → test → build debug APK).
- اختبارات جديدة: `test/quality_builder_test.dart` (غير مُشغَّلة).

## نتيجة فحص إمكانية yt-dlp/FFmpeg محليًا (من التوثيق، وليس من تجربة)
- **yt-dlp + ffmpeg + aria2c**: ممكنة عبر `io.github.junkfood02.youtubedl-android` (README الرسمي: `library/ffmpeg/aria2c`، `mavenCentral()`، `android:extractNativeLibs="true"`، الإصدار المذكور 0.18.1؛ صفحة Sonatype لـ `common` أظهرت 0.17.4 — تحقق عند أول build). API: `init`, `execute(request, processId, callback)`, `destroyProcessById`, `updateYoutubeDL(ctx, channel)`, `getInfo`. aria2c يُفعَّل بـ `--downloader libaria2c.so`.
- **ffmpeg**: يستعمله yt-dlp تلقائيًا للدمج/استخراج الصوت (مغطى بوحدة `ffmpeg`). **غير متاح كأمر مستقل لنا** → ميزات الأصل التي تستدعي ffmpeg مباشرة (concat "احفظ ما شاهدته"، HLS save، قراءة المدة) تحتاج حلًا: إما `ffmpeg_kit_flutter` (تحقق من حالته/صيانته)، أو تشغيل ثنائي ffmpeg الذي تضعه الوحدة عبر ProcessBuilder (غير مُتحقق منه).
- **YouTube JS runtime — العقبة الحاسمة**: yt-dlp الحديث يحتاج runtime لحل التحدي. README المكتبة لا يذكر أي runtime، وissue Seal #2543 يظهر `No supported JavaScript runtime could be found` ثم `Sign in to confirm you're not a bot`. yt-dlp يدعم `--js-runtimes` مع deno/node/bun/quickjs. **الخطة:** تضمين ثنائي QuickJS مبني لأندرويد (arm64/armv7/x86_64) باسم `libqjs.so` في `android/app/src/main/jniLibs/<abi>/` (الخطاف جاهز في Kotlin). بناء/الحصول على هذا الثنائي لم يتم. بدائل: cookies.txt مستوردة من المستخدم، أو `youtube_explode_dart` لـ YouTube فقط.
- باقي المواقع (TikTok/Facebook/X/Instagram/OK.ru) لا تحتاج JS runtime عادة، فالأرجح أن تعمل أولًا — غير مُختبر.

## لم يُنجز بعد
playlist، profile، subtitles (البيانات تُحلَّل لكن لا واجهة/تنزيل)، preview/watch/assemble/HLS-save (+ مشغّل فيديو أصلي)، stall watchdog، إعدادات السرعة (normal/fast/max/limit)، استئناف unfinished من الواجهة (يلزم `getInfo` ثم `start`)، fallback لـ X embed (`findXMediaUrl`)، فحص private-IP عبر DNS، قياس الأحجام عبر HEAD/Range، cookies (استيراد cookies.txt)، Foreground Service + إشعارات، تصدير إلى مجلد Download العام (MediaStore)، طلب إذن POST_NOTIFICATIONS، اختبارات الوحدة لم تُشغَّل.

## الخطوة التالية بدقة (الحساب 3) — تتطلب جهازًا بـ Flutter + Android SDK + إنترنت
1. `cd app && bash tools/verify.sh` — أصلح بالترتيب: أخطاء `flutter analyze` (الكود كُتب دون compiler، توقع أخطاء صغيرة في Dart: records في quality_builder، cascades في download_manager)، ثم `flutter test` (اختبارات format_selectors/quality_builder/errors يجب أن تنجح)، ثم أخطاء Kotlin في `YtDlpBridge.kt` (تحقق من توقيع `execute` والـ callback و`version(ctx)` و`UpdateChannel` مع 0.18.1).
2. شغّل على جهاز arm64 حقيقي: Engine status ثم Fetch Info برابط **TikTok أو فيديو CC على YouTube** وسجّل النتيجة هنا بصدق.
3. حل JS runtime لـ YouTube (ضع `libqjs.so` في jniLibs وتحقق أن Engine status يعرض quickjs).
4. جرّب تنزيلًا كاملًا (فيديو 720p + mp3) ثم إلغاء + استئناف.
5. بعدها فقط: ما في قائمة "لم يُنجز" بالترتيب: Foreground Service والتصدير العام → resume UI → subtitles → playlist → profile → سرعة → preview/watch.

---
# (سجل الجلسة 1 — كما هو)

## بنية المشروع الأصلي (`original/yt-grab/` — لم يُعدَّل)
Node.js 18+ / Express + `yt-dlp-exec` + `ffmpeg-static`، وواجهة Vanilla JS (`public/`). المشروع اسمه `yt-grab` داخل الـ ZIP.
- `server.js` (196 سطر): 20 route. `src/youtube.js`: التحقق من الرابط، الميتاداتا، قائمة الجودات، `flagsForOption`. `src/jobs.js`: التنزيل، التقدم، الاستئناف، watchdog. `src/preview.js` و`src/stream.js`: المعاينة والتشغيل عبر HLS proxy + ffmpeg. `src/subtitles.js`, `src/history.js`, `src/errors.js`, `src/config.js`.
- الواجهة: `app.js` (963 سطر) + `index.html` + `styles.css`.

## الوظائف الأصلية (يجب الحفاظ عليها كلها)
1. Fetch info (عنوان/صورة/قناة/مدة/جودات مع أحجام) — `/api/info`
2. تنزيل فيديو بجودات (360p…4K، vbest، format-id) وصوت M4A/MP3 — `/api/download`
3. تقدم مباشر + إلغاء + استئناف تلقائي للتنزيلات غير المكتملة + إعادة محاولة لا نهائية — `/api/progress`, `/cancel`, `/unfinished`
4. Playlists (حتى 200) واختيار/جودة موحدة — `/api/playlist`
5. Profile لقناة YouTube/حساب TikTok + آخر الفيديوهات — `/api/profile`
6. ترجمات SRT/VTT — `/api/subtitles`
7. معاينة/مشاهدة بقطع ثم "حفظ ما شاهدته كملف واحد" (ffmpeg concat) و HLS save — `/api/preview`, `/assemble`, `/play`, `/hls-save`
8. سجل التنزيلات (history) — `/api/history`
9. سرعة التنزيل (normal/fast/max + حد سرعة + aria2c) — `/api/speed`
10. مواقع: YouTube, Facebook, TikTok, X (مع fallback embed), Instagram, OK.ru (+ روابط مباشرة m3u8/mp4)
11. حماية: رفض localhost/private IP، تحديث yt-dlp تلقائيًا، cookies، ثيم داكن/فاتح.

## القرار المعماري
لا WebView ولا سيرفر: **Flutter UI + Platform Channel إلى Kotlin يشغّل `youtubedl-android`** (مكتبة تضم Python + yt-dlp + ffmpeg + aria2c داخل الـ APK). يحل محل Express/yt-dlp-exec/ffmpeg-static كلها محليًا ويحافظ على دعم كل المواقع. (البديل `youtube_explode_dart` يغطي YouTube فقط ويفقد باقي المواقع — يُستخدم كاحتياط فقط.)

## أكبر العقبات
1. **yt-dlp على Android**: لا يوجد npm/Python. الحل `youtubedl-android`؛ الإصدار `0.17.2` في `app/build.gradle.kts` **غير مُتحقق منه** (لم تتوفر شبكة) — تحقق من Maven Central.
2. **JS runtime ليوتيوب**: الأصل يستخدم `jsRuntimes:'node'` لحل تحدي YouTube. لا Node على Android. يلزم runtime بديل يدعمه yt-dlp (QuickJS كملف تنفيذي لـ arm64 مضمّن في jniLibs) أو نسخة youtubedl-android تتضمنه. **أخطر عقبة لـ YouTube.**
3. **ffmpeg مباشر**: `preview.js/stream.js/youtube.js` يستدعون ffmpeg بـ spawn (concat, remux, قراءة المدة). الحل: تشغيل ثنائي ffmpeg من مكتبة `ffmpeg` أو `ffmpeg_kit`، عبر قناة جديدة `runFfmpeg`.
4. **HLS proxy/Range proxy** (`stream.js`): كان يخدم المتصفح. في Flutter يُستبدل بمشغّل أصلي (`video_player`/`media_kit`) وربما سيرفر loopback داخلي صغير (Dart `HttpServer`) — مسموح لأنه محلي وليس خارجيًا.
5. **التخزين**: مجلد `downloads/` يصبح Scoped Storage (MediaStore/`Download/`) + Foreground Service + إشعار للتنزيل الطويل.
6. حجم APK كبير (~100MB+) بسبب Python+ffmpeg؛ استخدم `--split-per-abi`.
7. `aria2c` وCOOKIES_FROM_BROWSER: الأخير غير ممكن على Android (يُستبدل باستيراد cookies.txt).

## ما تم إنجازه
- نسخة الأصل محفوظة سليمة في `original/yt-grab/`.
- هيكل Flutter (`app/`) كُتب يدويًا لأن Flutter SDK غير متوفر والشبكة محجوبة: `pubspec.yaml`, `lib/main.dart` (شاشة Fetch Info بسيطة), `lib/core/{config,url_validator,format_selectors}.dart` (مُنقولة من JS), `lib/services/ytdlp_bridge.dart`, `test/format_selectors_test.dart`.
- جسر أصلي Kotlin: `android/.../YtDlpBridge.kt` (init/getInfo/download/cancel/update + تقدم عبر EventChannel)، `MainActivity.kt`, `AndroidManifest.xml`, ملفات Gradle.

## ملفات أُنشئت (كلها جديدة، لا تعديل على الأصل)
`app/pubspec.yaml`, `app/analysis_options.yaml`, `app/.gitignore`, `app/lib/main.dart`, `app/lib/core/*.dart`, `app/lib/services/ytdlp_bridge.dart`, `app/test/format_selectors_test.dart`, `app/android/{settings,build}.gradle.kts`, `app/android/gradle.properties`, `app/android/gradle/wrapper/gradle-wrapper.properties`, `app/android/app/build.gradle.kts`, `app/android/app/src/main/{AndroidManifest.xml,res/values/styles.xml}`, `app/android/app/src/main/kotlin/com/multidownloader/app/{MainActivity,YtDlpBridge}.kt`.

## مشاكل مكتشفة
- **كل ما كُتب غير مُجرَّب**: لا Flutter/Dart/Android SDK هنا؛ لا compile ولا test تم تشغيلهما.
- لا توجد أيقونات `mipmap/ic_launcher` ولا `gradlew` ولا `local.properties` — يولدها `flutter create`.
- `audio.mp4.ytdl` و`downloads/history.json` في الأصل ملفات بيانات تشغيل (مسارات Windows للمستخدم) — لم تُنقل ولا حاجة لها.
- تحقق من أسماء API في `YtDlpBridge.kt` (`execute` callback signature, `UpdateChannel`) مقابل إصدار المكتبة الفعلي.

## لم يُنجز
Info→قائمة الجودات والأحجام (`buildOptions`)، شاشة التنزيل والتقدم، playlist، profile، subtitles، preview/watch/assemble، history (SQLite/JSON)، unfinished/resume، speed settings، theme، تحويل X fallback، فحص private-IP عبر DNS، Foreground Service، التخزين العام.

## الخطوة التالية للحساب الثاني
1. في مجلد `app/` شغّل: `flutter create --platforms=android --org com.multidownloader .` (لا يستبدل الملفات الموجودة؛ إن تعارض `build.gradle.kts` فاحتفظ بنسخنا) ثم `flutter pub get && flutter test` (يجب أن تنجح اختبارات format_selectors).
2. تحقق من إصدار `youtubedl-android` وابنِ debug APK (`flutter build apk --debug --target-platform android-arm64`) وأصلح أخطاء Kotlin.
3. حل مشكلة JS runtime ليوتيوب (العقبة #2) وجرّب `getInfo` برابط حقيقي على جهاز/محاكي.
4. ثم انقل بالترتيب: buildOptions → شاشة اختيار الجودة → download + progress + cancel → history/unfinished.
