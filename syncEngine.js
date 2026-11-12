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

// محرك الاستنساخ الذكي: البحث عن أقرب وقت إنجليزي متطابق مكانياً وليس رقمياً
function processSubtitles(arabicSrtRaw, referenceSrtRaw = null, manualOffsetMs = 0) {
  const arItems = parseSRT(arabicSrtRaw);
  
  if (!referenceSrtRaw || arItems.length < 5) {
    return buildSRT(arItems.map(i => ({ ...i, start: i.start + manualOffsetMs, end: i.end + manualOffsetMs })));
  }

  const enItems = parseSRT(referenceSrtRaw);
  if (enItems.length < 5) return buildSRT(arItems);

  const arFirst = arItems[0].start;
  const enFirst = enItems[0].start;
  const initialOffset = enFirst - arFirst;

  const arSpan = arItems[arItems.length - 1].start - arFirst;
  const enSpan = enItems[enItems.length - 1].start - enFirst;
  
  let stretchFactor = 1.0;
  if (arSpan > 0 && enSpan > 0) {
    const rawStretch = enSpan / arSpan;
    if (rawStretch > 0.8 && rawStretch < 1.2) stretchFactor = rawStretch;
  }

  const finalItems = [];
  let j = 0; // مؤشر الإنجليزي

  // مطابقة كل سطر عربي مع السطر الإنجليزي الأقرب له في الزمن
  for (let i = 0; i < arItems.length; i++) {
    const ar = arItems[i];
    // حساب التوقيت المفترض للسطر العربي
    const idealStart = arFirst + ((ar.start - arFirst) * stretchFactor) + initialOffset;

    let bestJ = j;
    let minDiff = Infinity;

    // نبحث في السطور الإنجليزية الجاية (نطاق 25 سطر) عن أقرب وقت
    const searchLimit = Math.min(enItems.length, j + 25);
    for (let k = j; k < searchLimit; k++) {
      const diff = Math.abs(enItems[k].start - idealStart);
      if (diff < minDiff) {
        minDiff = diff;
        bestJ = k;
      }
    }

    j = bestJ; // تحديث المؤشر عشان ما نرجع للأسطر السابقة

    // إذا لقينا وقت إنجليزي مقارب جداً، "نسرق" توقيته بالضبط!
    if (minDiff < 3000) {
      finalItems.push({
        start: enItems[bestJ].start + manualOffsetMs,
        end: enItems[bestJ].end + manualOffsetMs,
        text: ar.text
      });
    } else {
      // لو مافي سطر إنجليزي قريب، نعتمد الوقت المحسوب رياضياً
      finalItems.push({
        start: idealStart + manualOffsetMs,
        end: idealStart + ((ar.end - ar.start) * stretchFactor) + manualOffsetMs,
        text: ar.text
      });
    }
  }

  // معالجة ذكية: لو المترجم العربي قسم جملة إنجليزية لسطرين، راح ياخذون نفس الوقت ويدخلون ببعض
  // هنا نقسم الوقت بالنص بينهم عشان يظهرون بالترتيب ورا بعض
  for (let i = 1; i < finalItems.length; i++) {
    if (finalItems[i].start <= finalItems[i - 1].start) {
      const sharedEnd = finalItems[i - 1].end;
      const midPoint = Math.floor((finalItems[i - 1].start + sharedEnd) / 2);
      
      finalItems[i - 1].end = midPoint - 20;
      finalItems[i].start = midPoint + 20;
      
      if (finalItems[i].end <= finalItems[i].start) {
        finalItems[i].end = finalItems[i].start + 1000;
      }
    }
  }

  // منع التداخل النهائي لأي جمل متقاربة
  for (let i = 0; i < finalItems.length - 1; i++) {
    if (finalItems[i].end >= finalItems[i + 1].start) {
      finalItems[i].end = Math.max(finalItems[i].start + 500, finalItems[i + 1].start - 40);
    }
  }

  return buildSRT(finalItems);
}

module.exports = { processSubtitles };
