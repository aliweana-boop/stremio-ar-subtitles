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

// محرك الحقن المباشر: أخذ الوقت من ملف (المرجع الإنجليزي) والنص من ملف آخر (العربي) حبة بحبة
function processSubtitles(arabicSrtRaw, referenceSrtRaw = null, manualOffsetMs = 0) {
  const arItems = parseSRT(arabicSrtRaw);
  
  if (!referenceSrtRaw) {
    return buildSRT(arItems.map(i => ({ ...i, start: i.start + manualOffsetMs, end: i.end + manualOffsetMs })));
  }

  const enItems = parseSRT(referenceSrtRaw);
  const finalItems = [];
  
  // دمج النص العربي مع الوقت الإنجليزي سطر بسطر (حبة بحبة)
  const minLength = Math.min(arItems.length, enItems.length);

  for (let i = 0; i < minLength; i++) {
    finalItems.push({
      start: enItems[i].start + manualOffsetMs,
      end: enItems[i].end + manualOffsetMs,
      text: arItems[i].text // النص من العربي، والوقت من الإنجليزي
    });
  }

  // إذا كانت الترجمة العربية أطول، نكمل الباقي مع ضبط الوقت بناءً على الفارق الأخير
  if (arItems.length > enItems.length) {
    const lastSyncOffset = enItems[minLength - 1].start - arItems[minLength - 1].start;
    for (let i = minLength; i < arItems.length; i++) {
      finalItems.push({
        start: arItems[i].start + lastSyncOffset + manualOffsetMs,
        end: arItems[i].end + lastSyncOffset + manualOffsetMs,
        text: arItems[i].text
      });
    }
  }

  return buildSRT(finalItems);
}

module.exports = { processSubtitles };
