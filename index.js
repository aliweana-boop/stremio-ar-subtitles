const url = require('url');
const http = require('http');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

// تحويل توقيت SRT (مثل 00:01:20,123) إلى ميللي ثانية
function timeToMs(timeStr) {
  const match = timeStr.match(/(\d{2}):(\d{2}):(\d{2})[,\.](\d{3})/);
  if (!match) return 0;
  return (
    parseInt(match[1], 10) * 3600000 +
    parseInt(match[2], 10) * 60000 +
    parseInt(match[3], 10) * 1000 +
    parseInt(match[4], 10)
  );
}

// تحويل الميللي ثانية إلى تنسيق SRT من جديد
function msToTime(ms) {
  if (ms < 0) ms = 0;
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const milliseconds = String(ms % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}

// دالة تحليل ومزامنة التوقيت مع تصحيح معدل الإطارات (FPS Drift & Time Stretch)
function advancedSyncSubtitle(enSrt, arSrt) {
  try {
    const parseSrt = (srtText) => {
      return srtText.trim().split(/\r?\n\r?\n/).map(block => {
        const lines = block.split(/\r?\n/);
        if (lines.length >= 3) {
          const parts = lines[1].split(' --> ');
          if (parts.length === 2) {
            return {
              startMs: timeToMs(parts[0]),
              endMs: timeToMs(parts[1]),
              text: lines.slice(2).join('\n')
            };
          }
        }
        return null;
      }).filter(Boolean);
    };

    const enBlocks = parseSrt(enSrt);
    const arBlocks = parseSrt(arSrt);

    if (enBlocks.length === 0 || arBlocks.length === 0) return arSrt;

    // حساب معامل تمدد السرعة (Time Stretch Factor) لمطابقة الفترات الزمنية بدقة
    const firstEn = enBlocks[0].startMs;
    const lastEn = enBlocks[enBlocks.length - 1].startMs;
    const firstAr = arBlocks[0].startMs;
    const lastAr = arBlocks[lastAr = arBlocks.length - 1].startMs;

    let stretchFactor = 1.0;
    if (lastAr > firstAr && lastEn > firstEn) {
      stretchFactor = (lastEn - firstEn) / (lastAr - firstAr);
    }

    let syncedSrt = '';
    for (let i = 0; i < arBlocks.length; i++) {
      const arBlock = arBlocks[i];
      
      // تطبيق عامل التمدد وتصحيح البداية والنهاية بناءً على الترجمة الإنجليزية المرجعية
      const adjustedStart = Math.round(firstEn + (arBlock.startMs - firstAr) * stretchFactor);
      const adjustedEnd = Math.round(firstEn + (arBlock.endMs - firstAr) * stretchFactor);

      const timeLine = `${msToTime(adjustedStart)} --> ${msToTime(adjustedEnd)}`;
      syncedSrt += `${i + 1}\n${timeLine}\n${arBlock.text}\n\n`;
    }

    return syncedSrt;
  } catch (e) {
    return arSrt; // الرجوع للنص الأصلي في حال وجود أي استثناء
  }
}

const server = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  if (pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'org.custom.perfectsubtitles',
      version: '6.2.0',
      name: 'Perfect Auto-Synced Arabic Subtitles',
      description: 'المحرك الهندسي المتقدم لمزامنة التوقيت ومعالجة معدل الإطارات (FPS Stretch)',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  // مسار جلب الترجمة وتطبيق الخوارزمية المتقدمة
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
      let subText = await response.text();

      if (refUrl) {
        try {
          const refResponse = await fetch(refUrl, { headers: HEADERS });
          if (refResponse.ok) {
            const refText = await refResponse.text();
            subText = advancedSyncSubtitle(refText, subText);
          }
        } catch (err) {
          console.log('Advanced Sync warning:', err.message);
        }
      }

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="subtitle.srt"'
      });
      res.end(subText);
    } catch (error) {
      res.writeHead(500);
      res.end(`Error fetching subtitle: ${error.message}`);
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

      const formatted = arabicSubs.map((s, idx) => ({
        id: `sub-adv-sync-${idx}-${id}`,
        url: `${protocol}://${host}/proxy-sub?url=${encodeURIComponent(s.url)}${refUrlParam}`,
        lang: 'ara',
        label: `🇸🇦 [مزامنة متقدمة + تصحيح الفريمات] ترجمة (${idx + 1})`
      }));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: formatted }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [], error: e.message }));
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Stremio Addon is Running! Add /manifest.json to Stremio.');
};

const PORT = process.env.PORT || 3000;
http.createServer(server).listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
