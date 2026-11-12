function parseSRT(srtText) {
  const normalized = srtText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const blocks = normalized.split(/\n\s*\n/);
  const items = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
      if (timeMatch) {
        const start = timeToMs(timeMatch[1]);
        const end = timeToMs(timeMatch[2]);
        const text = lines.slice(2).join('\n').trim();
        
        // استبعاد الإعلانات حتى لا نعتمد عليها كنقطة ارتكاز
        if (!isAdLine(text) && text.length > 0) {
          items.push({ start, end, text });
        }
      }
    }
  }
  return items;
}

function isAdLine(text) {
  const adPatterns = [
    /opensubtitles/i, /subscene/i, /yify/i, /http/i, /www\./i,
    /ترجمة/i, /تعديل/i, /الحقوق/i, /مشاهدة ممتعة/i, /synced/i, /subby/i
  ];
  return adPatterns.some(pattern => pattern.test(text));
}

function timeToMs(timeStr) {
  const [hms, ms] = timeStr.replace(',', '.').split('.');
  const [h, m, s] = hms.split(':').map(Number);
  return (h * 3600000) + (m * 60000) + (s * 1000) + Number(ms);
}

function msToTime(ms) {
  const safeMs = Math.max(0, Math.round(ms));
  const h = String(Math.floor(safeMs / 3600000)).padStart(2, '0');
  const m = String(Math.floor((safeMs % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((safeMs % 60000) / 1000)).padStart(2, '0');
  const remMs = String(safeMs % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${remMs}`;
}

function buildSRT(items) {
  return items.map((item, idx) => {
    return `${idx + 1}\n${msToTime(item.start)} --> ${msToTime(item.end)}\n${item.text}`;
  }).join('\n\n');
}

// محرك الارتكاز (Anchor-based Warping)
function processSubtitles(arabicSrtRaw, referenceSrtRaw = null, manualOffsetMs = 0) {
  const arItems = parseSRT(arabicSrtRaw);
  
  // إذا مافيه مرجع إنجليزي أو الملف صغير جداً
  if (!referenceSrtRaw || arItems.length < 5) {
    return buildSRT(arItems.map(i => ({ ...i, start: i.start + manualOffsetMs, end: i.end + manualOffsetMs })));
  }

  const enItems = parseSRT(referenceSrtRaw);
  if (enItems.length < 5) {
    return buildSRT(arItems.map(i => ({ ...i, start: i.start + manualOffsetMs, end: i.end + manualOffsetMs })));
  }

  // أخذ نقطة الارتكاز الأولى (أول حوار فعلي)
  const arFirst = arItems[0];
  const enFirst = enItems[0];
  
  // أخذ نقطة الارتكاز الأخيرة (آخر حوار فعلي)
  const arLast = arItems[arItems.length - 1];
  const enLast = enItems[enItems.length - 1];

  // الإزاحة الأساسية: سحب بداية الترجمة العربية لتتطابق مع بداية الإنجليزية
  const initialOffset = enFirst.start - arFirst.start;

  // حساب التمدد: هل الترجمة الإنجليزية أطول أم أقصر؟ (يحل مشكلة اختلاف الفريمات)
  const arDuration = arLast.start - arFirst.start;
  const enDuration = enLast.start - enFirst.start;
  
  let stretchFactor = 1.0;
  if (arDuration > 0 && enDuration > 0) {
    const rawStretch = enDuration / arDuration;
    // التأكد أن التمدد منطقي (بين 0.9 و 1.1) عشان ما نخرب الوقت لو كان فيه خلل بالملف
    if (rawStretch > 0.9 && rawStretch < 1.1) {
      stretchFactor = rawStretch;
    }
  }

  const baseStart = arFirst.start;

  // تطبيق السحب والتمديد على كامل الملف العربي
  const syncedItems = arItems.map(item => {
    const relativeStart = item.start - baseStart;
    const duration = item.end - item.start;
    
    // التوقيت الجديد = نقطة البداية + (المسافة النسبية × معامل التمدد) + الإزاحة + أي تقديم يدوي
    const newStart = baseStart + (relativeStart * stretchFactor) + initialOffset + manualOffsetMs;
    const newEnd = newStart + (duration * stretchFactor);

    return {
      start: newStart,
      end: newEnd,
      text: item.text
    };
  });

  // منع التداخل (إذا جملة انتهت وبدأت اللي بعدها بنفس الوقت)
  for (let i = 0; i < syncedItems.length - 1; i++) {
    if (syncedItems[i].end >= syncedItems[i+1].start) {
      syncedItems[i].end = Math.max(syncedItems[i].start + 500, syncedItems[i+1].start - 10);
    }
  }

  return buildSRT(syncedItems);
}

module.exports = { processSubtitles };
