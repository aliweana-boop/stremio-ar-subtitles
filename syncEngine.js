// =========================================================================
// المحرك الاحترافي المتقدم: Signal Overlap Maximization & FPS Correction
// =========================================================================

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
        
        // استبعاد الإعلانات حتى لا تؤثر على حسابات الذكاء الاصطناعي
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

// حساب مدى تطابق (تداخل) مسارين زمنيين لتقييم جودة المزامنة
function calculateOverlapScore(adjustedAr, refItems) {
  let score = 0;
  let i = 0;
  let j = 0;

  while (i < adjustedAr.length && j < refItems.length) {
    const ar = adjustedAr[i];
    const ref = refItems[j];

    if (ar.end <= ref.start) {
      i++;
    } else if (ref.end <= ar.start) {
      j++;
    } else {
      const overlapStart = Math.max(ar.start, ref.start);
      const overlapEnd = Math.min(ar.end, ref.end);
      score += (overlapEnd - overlapStart);

      if (ar.end < ref.end) i++;
      else j++;
    }
  }
  return score;
}

// محرك الذكاء الاصطناعي للمزامنة (Smart Sync AI)
function autoResync(arabicItems, refItems, manualOffsetMs = 0) {
  if (!arabicItems.length) return [];
  if (!refItems || refItems.length < 10) {
    // إذا لم يتوفر ملف مرجعي، نطبق الإزاحة اليدوية فقط
    return applyShiftAndHeal(arabicItems, 1.0, manualOffsetMs);
  }

  // المعاملات القياسية لاختلاف سرعات الإطارات (FPS) في السينما
  const stretchFactors = [
    1.0,                // نفس السرعة
    25 / 23.976,        // تسريع
    23.976 / 25,        // إبطاء
    24 / 23.976,        // تسريع طفيف
    23.976 / 24         // إبطاء طفيف
  ];

  let bestScore = -1;
  let bestStretch = 1.0;
  let bestOffset = 0;

  // أخذ عينة من أول 25 سطر فعلي لاستنتاج نقاط الارتكاز الممكنة
  const sampleSize = Math.min(25, arabicItems.length, refItems.length);
  const arSample = arabicItems.slice(0, sampleSize);
  const refSample = refItems.slice(0, sampleSize);

  for (const stretch of stretchFactors) {
    let offsetVotes = [];

    // توليد كل احتمالات الإزاحة (Offsets)
    for (let i = 0; i < arSample.length; i++) {
      for (let j = 0; j < refSample.length; j++) {
        const offset = refSample[j].start - Math.round(arSample[i].start * stretch);
        offsetVotes.push(offset);
      }
    }

    // تجميع الإزاحات المتقاربة (Clustering) لاكتشاف النمط الصحيح
    let clusters = [];
    for (const off of offsetVotes) {
      let found = false;
      for (let c of clusters) {
        if (Math.abs(c.center - off) < 250) {
          c.offsets.push(off);
          c.center = c.offsets.reduce((a, b) => a + b, 0) / c.offsets.length;
          found = true;
          break;
        }
      }
      if (!found) clusters.push({ center: off, offsets: [off] });
    }

    // ترتيب التجمعات حسب الكثافة (الاحتمالات الأقوى أولاً)
    clusters.sort((a, b) => b.offsets.length - a.offsets.length);

    // اختبار أفضل 3 سيناريوهات للإزاحة مع معامل التمدد الحالي
    for (let k = 0; k < Math.min(3, clusters.length); k++) {
      const testOffset = Math.round(clusters[k].center);
      
      const adjustedSample = arabicItems.map(item => ({
        start: Math.round(item.start * stretch) + testOffset,
        end: Math.round(item.end * stretch) + testOffset
      }));

      // حساب نتيجة التداخل (Score) للفيلم بأكمله
      const score = calculateOverlapScore(adjustedSample, refItems);

      if (score > bestScore) {
        bestScore = score;
        bestStretch = stretch;
        bestOffset = testOffset;
      }
    }
  }

  // تطبيق النتيجة الفائزة + أي تقديم/تأخير يدوي طلبه المستخدم
  return applyShiftAndHeal(arabicItems, bestStretch, bestOffset + manualOffsetMs);
}

function applyShiftAndHeal(items, stretch, offset) {
  const synced = items.map(item => ({
    start: Math.round(item.start * stretch) + offset,
    end: Math.round(item.end * stretch) + offset,
    text: item.text
  }));

  // تنظيف ومعالجة التداخل (Structural Healing)
  const healed = [];
  for (let i = 0; i < synced.length; i++) {
    let { start, end, text } = synced[i];
    if (end <= 0) continue;
    if (start < 0) start = 0;

    // الحد الأدنى لمدة الظهور على الشاشة لضمان القراءة
    if (end - start < 1000) end = start + 1000;
    
    // منع تداخل الجملتين في نفس اللحظة
    if (i < synced.length - 1 && end >= synced[i + 1].start) {
      end = Math.max(start + 500, synced[i + 1].start - 40);
    }
    
    healed.push({ start, end, text });
  }
  return healed;
}

function buildSRT(items) {
  return items.map((item, idx) => {
    return `${idx + 1}\n${msToTime(item.start)} --> ${msToTime(item.end)}\n${item.text}`;
  }).join('\n\n');
}

function processSubtitles(arabicSrtRaw, referenceSrtRaw = null, manualOffsetMs = 0) {
  const arabicItems = parseSRT(arabicSrtRaw);
  const refItems = referenceSrtRaw ? parseSRT(referenceSrtRaw) : null;
  const finalItems = autoResync(arabicItems, refItems, manualOffsetMs);
  return buildSRT(finalItems);
}

module.exports = { processSubtitles };
