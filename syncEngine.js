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
    /ترجمة/i, /تعديل/i, /الحقوق/i, /مشاهدة ممتعة/i, /synced/i, /تقديم/i
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

/**
 * خوارزمية الإجماع الإحصائي (Histogram Consensus):
 * تحسب الفارق الزمني بين كل جملة عربية وجميع الجمل الإنجليزية القريبة منها
 * وتختار الفارق الأكثر تكراراً طوال الفيلم
 */
function findBestOffset(arItems, refItems) {
  const bucketSize = 150; // دقة التجميع 150 ملي ثانية
  const buckets = new Map();
  const maxSearchWindow = 60000; // البحث في نطاق ±60 ثانية

  for (const ar of arItems) {
    for (const ref of refItems) {
      const diff = ref.start - ar.start;
      if (Math.abs(diff) <= maxSearchWindow) {
        const bucket = Math.round(diff / bucketSize) * bucketSize;
        buckets.set(bucket, (buckets.get(bucket) || 0) + 1);
      }
    }
  }

  let bestOffset = 0;
  let maxVotes = 0;

  for (const [offset, votes] of buckets.entries()) {
    if (votes > maxVotes) {
      maxVotes = votes;
      bestOffset = offset;
    }
  }

  let exactSum = 0;
  let exactCount = 0;
  for (const ar of arItems) {
    for (const ref of refItems) {
      const diff = ref.start - ar.start;
      if (Math.abs(diff - bestOffset) <= bucketSize) {
        exactSum += diff;
        exactCount++;
      }
    }
  }

  return exactCount > 0 ? Math.round(exactSum / exactCount) : bestOffset;
}

function autoResync(arabicItems, refItems, manualOffsetMs = 0) {
  if (!arabicItems.length) return [];

  if (refItems && refItems.length >= 10) {
    const midPoint = Math.floor(arabicItems.length / 2);
    const firstHalfAr = arabicItems.slice(0, midPoint);
    const secondHalfAr = arabicItems.slice(midPoint);

    const offsetFirstHalf = findBestOffset(firstHalfAr, refItems);
    const offsetSecondHalf = findBestOffset(secondHalfAr, refItems);

    const drift = offsetSecondHalf - offsetFirstHalf;
    const arSpan = arabicItems[arabicItems.length - 1].start - arabicItems[0].start;
    const stretchFactor = (arSpan > 0 && Math.abs(drift) > 500) ? (arSpan + drift) / arSpan : 1;
    const baseStart = arabicItems[0].start;

    const synced = arabicItems.map(item => {
      const duration = item.end - item.start;
      const relativePos = item.start - baseStart;
      const newStart = baseStart + (relativePos * stretchFactor) + offsetFirstHalf + manualOffsetMs;
      
      const closest = findClosestRef(newStart, refItems, 600);
      const finalStart = closest ? (closest.start + manualOffsetMs) : newStart;
      const finalEnd = finalStart + (duration * stretchFactor);

      return { start: finalStart, end: finalEnd, text: item.text };
    });

    return healStructure(synced);
  }

  const shifted = arabicItems.map(item => ({
    start: item.start + manualOffsetMs,
    end: item.end + manualOffsetMs,
    text: item.text
  }));

  return healStructure(shifted);
}

function findClosestRef(targetMs, refItems, toleranceMs) {
  let best = null;
  let minDiff = toleranceMs;
  for (const ref of refItems) {
    const diff = Math.abs(ref.start - targetMs);
    if (diff < minDiff) {
      minDiff = diff;
      best = ref;
    }
  }
  return best;
}

function healStructure(items) {
  const healed = [];
  for (let i = 0; i < items.length; i++) {
    let { start, end, text } = items[i];
    if (end <= 0) continue;
    if (start < 0) start = 0;

    if (end - start < 1000) end = start + 1000;
    if (i < items.length - 1 && end >= items[i + 1].start) {
      end = Math.max(start + 500, items[i + 1].start - 40);
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
