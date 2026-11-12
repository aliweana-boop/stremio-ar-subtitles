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
        
        // استبعاد الإعلانات
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
    /ترجمة/i, /تعديل/i, /الحقوق/i, /مشاهدة ممتعة/i
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

// تنظيف البنية وإصلاح التداخل بدون العبث بالتوقيت الأصلي
function cleanAndHeal(items) {
  const healed = [];
  for (let i = 0; i < items.length; i++) {
    let { start, end, text } = items[i];
    if (end <= start) continue;
    
    // الحد الأدنى لمدة الظهور
    if (end - start < 1000) end = start + 1000;
    
    // منع التداخل بين الجمل
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

function processSubtitles(arabicSrtRaw) {
  const arabicItems = parseSRT(arabicSrtRaw);
  const finalItems = cleanAndHeal(arabicItems);
  return buildSRT(finalItems);
}

module.exports = { processSubtitles };
