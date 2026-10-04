/**
 * Default seed corpus for the Local Translation Engine (LTE).
 *
 * On a fresh install, the LTE has zero entries in its IndexedDB corpus,
 * which means Tier 0 (dictionary/n-gram matching) always returns null.
 * This seed corpus provides ~85 common EN→AR translation pairs covering
 * professional/technical translation terminology so that the LTE can
 * produce ghost-text suggestions immediately after installation.
 *
 * The corpus is loaded into the LTE only when IndexedDB has zero entries,
 * ensuring it never overwrites user-imported data.
 *
 * ─────────────────────────────────────────────────────────────────
 * PHASE 1 task 1.6 — DICTIONARY SCOPE WARNING
 * ─────────────────────────────────────────────────────────────────
 * The current ~85 entries are a hand-picked starter set, NOT a
 * comprehensive bidirectional dictionary. The project brief explicitly
 * calls for "several thousand entries minimum" sourced from a licensed
 * or properly-attributed EN↔AR dictionary dataset.
 *
 * We have NOT fabricated dictionary content here. Doing so would
 * produce plausible-looking but wrong translations that would silently
 * poison the ghost-text suggestions. The LTE itself is already
 * bidirectional (see `load()` in local-translation-engine.ts — it builds
 * both en-index and ar-index), so the moment a real dataset is dropped
 * in here as an additional `CorpusEntry[]`, AR→EN lookups will work
 * end-to-end without further code changes.
 *
 * TODO (project owner): Source a licensed EN↔AR dictionary dataset
 * (e.g. CC-BY wordlist, Wiktionary extract, or a commercial TM
 * export) and either:
 *   (a) ship it as a static JSON asset loaded lazily on first run, or
 *   (b) ship it as a pre-populated IndexedDB blob imported on first run.
 * Then delete this warning.
 *
 * Until then, AR→EN ghost-text will work end-to-end only via Tier 1
 * (local LLM) and Tier 2 (Gemini) — Tier 0 will only hit on the ~85
 * seed entries above.
 */
import type { CorpusEntry } from "./local-translation-engine";

export const SEED_CORPUS: CorpusEntry[] = [
  // ─── General Translation & CAT Terminology ───
  { en: "Computer-assisted translation", ar: "الترجمة بمساعدة الحاسوب", type: "term" },
  { en: "Computer-aided translation", ar: "الترجمة المعاونة بالحاسوب", type: "term" },
  { en: "Translation memory", ar: "ذاكرة الترجمة", type: "term" },
  { en: "Machine translation", ar: "الترجمة الآلية", type: "term" },
  { en: "Neural machine translation", ar: "الترجمة الآلية العصبية", type: "term" },
  { en: "Terminology management", ar: "إدارة المصطلحات", type: "term" },
  { en: "Glossary", ar: "المسرد", type: "term" },
  { en: "Source text", ar: "النص المصدر", type: "term" },
  { en: "Target text", ar: "النص الهدف", type: "term" },
  { en: "Source language", ar: "لغة المصدر", type: "term" },
  { en: "Target language", ar: "لغة الهدف", type: "term" },
  { en: "Segment", ar: "مقطع", type: "term" },
  { en: "Alignment", ar: "المحاذاة", type: "term" },
  { en: "Linguistic analysis", ar: "التحليل اللغوي", type: "term" },
  { en: "Quality assurance", ar: "ضمان الجودة", type: "term" },
  { en: "Post-editing", ar: "ما بعد التحرير", type: "term" },
  { en: "Fuzzy match", ar: "مطابقة تقريبية", type: "term" },
  { en: "Exact match", ar: "مطابقة تامة", type: "term" },
  { en: "Context match", ar: "مطابقة السياق", type: "term" },
  { en: "Repetitions", ar: "التكرارات", type: "term" },
  { en: "Word count", ar: "عدد الكلمات", type: "term" },
  { en: "Word frequency", ar: "تردد الكلمات", type: "term" },
  { en: "Localization", ar: "التوطين", type: "term" },
  { en: "Internationalization", ar: "الدولنة", type: "term" },
  { en: "Bilingual", ar: "ثنائي اللغة", type: "term" },
  { en: "Monolingual", ar: "أحادي اللغة", type: "term" },
  { en: "Multilingual", ar: "متعدد اللغات", type: "term" },
  { en: "Concordance", ar: "الكونكوردانس", type: "term" },

  // ─── Technology & Computing ───
  { en: "Artificial intelligence", ar: "الذكاء الاصطناعي", type: "term" },
  { en: "Natural language processing", ar: "معالجة اللغات الطبيعية", type: "term" },
  { en: "Deep learning", ar: "التعلم العميق", type: "term" },
  { en: "Neural network", ar: "الشبكة العصبية", type: "term" },
  { en: "Algorithm", ar: "الخوارزمية", type: "term" },
  { en: "Database", ar: "قاعدة البيانات", type: "term" },
  { en: "Software", ar: "البرمجيات", type: "term" },
  { en: "Hardware", ar: "الأجهزة", type: "term" },
  { en: "User interface", ar: "واجهة المستخدم", type: "term" },
  { en: "Open source", ar: "مفتوح المصدر", type: "term" },
  { en: "Cloud computing", ar: "الحوسبة السحابية", type: "term" },
  { en: "Data privacy", ar: "خصوصية البيانات", type: "term" },
  { en: "Encryption", ar: "التشفير", type: "term" },
  { en: "Server", ar: "الخادم", type: "term" },
  { en: "Browser", ar: "المتصفح", type: "term" },
  { en: "Cache", ar: "ذاكرة التخزين المؤقت", type: "term" },
  { en: "Bandwidth", ar: "عرض النطاق", type: "term" },
  { en: "Latency", ar: "زمن الاستجابة", type: "term" },
  { en: "Performance", ar: "الأداء", type: "term" },
  { en: "Scalability", ar: "قابلية التوسع", type: "term" },

  // ─── Common Professional Phrases ───
  { en: "Please review the translation", ar: "يرجى مراجعة الترجمة", type: "phrase" },
  { en: "The document has been translated", ar: "تمت ترجمة المستند", type: "phrase" },
  { en: "This term requires further research", ar: "يتطلب هذا المصطلح مزيدًا من البحث", type: "phrase" },
  { en: "The translation is complete", ar: "اكتملت الترجمة", type: "phrase" },
  { en: "Confirm the changes", ar: "تأكيد التغييرات", type: "phrase" },
  { en: "Save the document", ar: "حفظ المستند", type: "phrase" },
  { en: "Export the file", ar: "تصدير الملف", type: "phrase" },
  { en: "Import data", ar: "استيراد البيانات", type: "phrase" },
  { en: "Settings have been updated", ar: "تم تحديث الإعدادات", type: "phrase" },
  { en: "No results found", ar: "لم يتم العثور على نتائج", type: "phrase" },
  { en: "Operation completed successfully", ar: "تمت العملية بنجاح", type: "phrase" },
  { en: "An error occurred", ar: "حدث خطأ", type: "phrase" },
  { en: "Loading please wait", ar: "جاري التحميل يرجى الانتظار", type: "phrase" },
  { en: "Are you sure you want to delete", ar: "هل أنت متأكد من الحذف", type: "phrase" },
  { en: "Click here for more information", ar: "انقر هنا لمزيد من المعلومات", type: "phrase" },
  { en: "Download the latest version", ar: "تحميل أحدث إصدار", type: "phrase" },

  // ─── Academic & Research ───
  { en: "Research methodology", ar: "منهجية البحث", type: "term" },
  { en: "Hypothesis", ar: "الفرضية", type: "term" },
  { en: "Data analysis", ar: "تحليل البيانات", type: "term" },
  { en: "Statistical significance", ar: "الدلالة الإحصائية", type: "term" },
  { en: "Peer review", ar: "التحكيم", type: "term" },
  { en: "Conclusion", ar: "الخاتمة", type: "term" },
  { en: "Abstract", ar: "الملخص", type: "term" },
  { en: "References", ar: "المراجع", type: "term" },
  { en: "Citation", ar: "الاستشهاد", type: "term" },
  { en: "Bibliography", ar: "قائمة المراجع", type: "term" },
  { en: "Appendix", ar: "الملحق", type: "term" },

  // ─── Business & Legal ───
  { en: "Confidential", ar: "سري", type: "term" },
  { en: "Agreement", ar: "الاتفاقية", type: "term" },
  { en: "Terms and conditions", ar: "الشروط والأحكام", type: "phrase" },
  { en: "Intellectual property", ar: "الملكية الفكرية", type: "term" },
  { en: "Copyright", ar: "حقوق النشر", type: "term" },
  { en: "Disclaimer", ar: "إخلاء المسؤولية", type: "term" },
  { en: "Liability", ar: "المسؤولية", type: "term" },
  { en: "Compliance", ar: "الامتثال", type: "term" },
  { en: "Regulation", ar: "اللائحة", type: "term" },
  { en: "Stakeholder", ar: "صاحب المصلحة", type: "term" },
  { en: "Deadline", ar: "الموعد النهائي", type: "term" },
  { en: "Deliverable", ar: "المخرج", type: "term" },

  // ─── Full Sentences (CAT context) ───
  { en: "Computer-assisted translation is a form of language translation in which a human translator uses computer software to support and facilitate the translation process.", ar: "الترجمة بمساعدة الحاسوب هي شكل من أشكال الترجمة اللغوية حيث يستخدم المترجم البشري برامج حاسوبية لدعم وتسهيل عملية الترجمة.", type: "sentence" },
  { en: "Neural machine translation is an approach to machine translation that uses a large artificial neural network to predict the likelihood of a sequence of words.", ar: "الترجمة الآلية العصبية هي نهج في الترجمة الآلية يستخدم شبكة عصبية اصطناعية كبيرة للتنبؤ باحتمالية تسلسل من الكلمات.", type: "sentence" },
  { en: "At the heart of the system is the translation memory.", ar: "في قلب النظام توجد ذاكرة الترجمة.", type: "sentence" },
  { en: "A translation memory is a database that stores segments of text that have been previously translated.", ar: "ذاكرة الترجمة هي قاعدة بيانات تخزن مقاطع النص التي تمت ترجمتها مسبقًا.", type: "sentence" },
  { en: "Local language models on device ensure data privacy and provide fast offline terminology matching.", ar: "تضمن النماذج اللغوية المحلية على الجهاز خصوصية البيانات وتوفر مطابقة سريعة للمصطلحات بدون اتصال بالإنترنت.", type: "sentence" },
  { en: "These systems optimize student workflow efficiency.", ar: "تعمل هذه الأنظمة على تحسين كفاءة سير عمل الطالب.", type: "sentence" },
];
