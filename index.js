const url = require('url');
const http = require('http');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

/**
 * محرك المزامنة الجوهرية للترجمات (Auto-Resync & Structural Healing Engine)
 */
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
    /ترجمة وتعديل/i, /جميع الحقوق/i, /مشاهدة ممتعة/i, /synced by/i
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

function autoResync(arabicItems, refItems) {
  if (!arabicItems.length) return [];
  if (!refItems || refItems.length < 5) return healStructure(arabicItems);

  const sampleSize = Math.min(5, arabicItems.length, refItems.length);
  
  let startDiffSum = 0;
  for (let i = 0; i < sampleSize; i++) {
    startDiffSum += (refItems[i].start - arabicItems[i].start);
  }
  const initialOffset = startDiffSum / sampleSize;

  let endDiffSum = 0;
  for (let i = 1; i <= sampleSize; i++) {
    const arIdx = arabicItems.length - i;
    const refIdx = refItems.length - i;
    endDiffSum += (refItems[refIdx].start - arabicItems[arIdx].start);
  }
  const finalOffset = endDiffSum / sampleSize;

  const arSpan = arabicItems[arabicItems.length - 1].start - arabicItems[0].start;
  const driftDelta = finalOffset - initialOffset;
  const stretchFactor = arSpan > 0 ? (arSpan + driftDelta) / arSpan : 1;
  const baseStart = arabicItems[0].start;

  const synced = arabicItems.map(item => {
    const duration = item.end - item.start;
    const relativePos = item.start - baseStart;
    const newStart = baseStart + (relativePos * stretchFactor) + initialOffset;
    
    const closestRef = findClosestRef(newStart, refItems, 1500);
    const finalStart = closestRef ? closestRef.start : newStart;
    const finalEnd = finalStart + (duration * stretchFactor);

    return {
      start: finalStart,
      end: finalEnd,
      text: item.text
    };
  });

  return healStructure(synced);
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

    if (end - start < 1000) {
      end = start + 1000;
    }

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

function processSubtitles(arabicSrtRaw, referenceSrtRaw = null) {
  const arabicItems = parseSRT(arabicSrtRaw);
  const refItems = referenceSrtRaw ? parseSRT(referenceSrtRaw) : null;
  const finalItems = autoResync(arabicItems, refItems);
  return buildSRT(finalItems);
}

const server = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  if (pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'org.custom.proengine',
      version: '10.0.0',
      name: '🇸🇦 Pro Engine Arabic Subtitle (Single & Perfectly Synced)',
      description: 'محرك المزامنة الاحترافي: معايرة زمنية دقيقة، تنظيف الإعلانات، وترجمة مفردة مثالية',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  if (pathname === '/proxy-sub') {
    const targetUrl = parsedUrl.query.url;
    const refUrl = parsedUrl.query.ref;
    
    if (!targetUrl) {
      res.writeHead(400);
      res.end('Missing url');
      return;
    }

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let arRaw = await response.text();

      let refRaw = null;
      if (refUrl) {
        try {
          const refRes = await fetch(refUrl, { headers: HEADERS });
          if (refRes.ok) {
            refRaw = await refRes.text();
          }
        } catch (e) {
          console.log('Ref fetch warning:', e.message);
        }
      }

      // معالجة الترجمة عبر المحرك الاحترافي الجديد
      const processedSrt = processSubtitles(arRaw, refRaw);

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="subtitle.srt"'
      });
      res.end(processedSrt);
    } catch (error) {
      res.writeHead(500);
      res.end(`Error processing subtitle: ${error.message}`);
    }
    return;
  }

  if (pathname.startsWith('/subtitles/')) {
    const parts = pathname.split('/');
    const type = parts[2];
    let id = parts[3] ? decodeURIComponent(parts[3]) : '';
    id = id.replace('.json', '');

    if (!type || !id) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [] }));
      return;
    }

    const targetUrl = `https://opensubtitles-v3.strem.io/subtitles/${type}/${id}.json`;
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      const parsed = await response.json();
      const subs = parsed.subtitles || [];
      
      const arabicSubs = subs.filter(s => s.lang === 'ara' || s.lang === 'ar');
      const englishSub = subs.find(s => s.lang === 'eng' || s.lang === 'en');
      const refUrlParam = englishSub ? `&ref=${encodeURIComponent(englishSub.url)}` : '';

      let formatted = [];
      if (arabicSubs.length > 0) {
        // نختار الترجمة الأولى فقط ونمرر معها رابط المرجع الإنجليزي (إن وجد) للمحرك
        const bestSub = arabicSubs[0];
        formatted.push({
          id: `sub-pro-${id}`,
          url: `${protocol}://${host}/proxy-sub?url=${encodeURIComponent(bestSub.url)}${refUrlParam}`,
          lang: 'ara',
          label: '🇸🇦 الترجمة العربية الاحترافية (مضبوطة ومزمنة تلقائياً)'
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: formatted }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [], error: e.message }));
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Pro Engine Subtitle Addon is Running!');
};

const PORT = process.env.PORT || 3000;
http.createServer(server).listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
