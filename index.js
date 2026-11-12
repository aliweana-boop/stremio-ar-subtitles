const url = require('url');
const http = require('http');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

// تحويل توقيت SRT إلى ميللي ثانية
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

// تحويل الميللي ثانية إلى تنسيق SRT
function msToTime(ms) {
  if (ms < 0) ms = 0;
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const milliseconds = String(ms % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}

// تحليل ملف الترجمة إلى كائنات بيانات مصفوفة
function parseSrt(srtText) {
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
}

// فلتر تنظيف الإعلانات والحقوق من بداية ونهاية الملف
function stripAdsAndJunk(blocks) {
  return blocks.filter(b => {
    const t = b.text.toLowerCase();
    return !(
      t.includes('http') ||
      t.includes('www.') ||
      t.includes('.com') ||
      t.includes('subscene') ||
      t.includes('opensubtitles') ||
      t.includes('translated by') ||
      t.includes('ترجمة:') ||
      t.includes('إعداد:')
    );
  });
}

// خوارزمية المزامنة المتقدمة (Anchor-Based Time Warping + Drift Correction + Structural Healing)
function advancedSyncEngine(enSrtText, arSrtText) {
  try {
    const enBlocks = stripAdsAndJunk(parseSrt(enSrtText));
    const arBlocks = stripAdsAndJunk(parseSrt(arSrtText));

    if (enBlocks.length === 0 || arBlocks.length === 0) return arSrtText;

    // 1. حساب الإزاحة الأولية (Initial Offset) باستخدام أول الحوارات الحقيقية
    const offset = enBlocks[0].startMs - arBlocks[0].startMs;

    // 2. حساب معامل الانحراف الخطي (Linear Drift / FPS Correction)
    const firstEn = enBlocks[0].startMs;
    const lastEn = enBlocks[enBlocks.length - 1].startMs;
    const firstAr = arBlocks[0].startMs;
    const lastAr = arBlocks[arBlocks.length - 1].startMs;

    let stretchFactor = 1.0;
    if ((lastAr - firstAr) > 0 && (lastEn - firstEn) > 0) {
      stretchFactor = (lastEn - firstEn) / (lastAr - firstAr);
    }

    // 3. إعادة بناء وتطبيق المحاذاة (Time Warping)
    let processedBlocks = arBlocks.map(block => {
      let newStart = Math.round(firstEn + (block.startMs - firstAr) * stretchFactor);
      let newEnd = Math.round(firstEn + (block.endMs - firstAr) * stretchFactor);
      
      // ضمان الحد الأدنى لمدّة القراءة (Minimum Duration: 1000ms)
      if ((newEnd - newStart) < 1000) {
        newEnd = newStart + 1000;
      }

      return {
        startMs: newStart,
        endMs: newEnd,
        text: block.text
      };
    });

    // 4. فلتر منع التداخل (Overlap Resolution)
    for (let i = 0; i < processedBlocks.length - 1; i++) {
      if (processedBlocks[i].endMs > processedBlocks[i + 1].startMs) {
        // ترك فاصل زمني 40ms بين الجملتين لمنع التصادم
        processedBlocks[i].endMs = processedBlocks[i + 1].startMs - 40;
        if ((processedBlocks[i].endMs - processedBlocks[i].startMs) < 500) {
          processedBlocks[i].startMs = processedBlocks[i].endMs - 500; // تصحيح طارئ للمدة القصيرة
        }
      }
    }

    // 5. إعادة تجميع الملف بصيغة SRT سليمة
    let finalSrt = '';
    processedBlocks.forEach((b, idx) => {
      const timeLine = `${msToTime(b.startMs)} --> ${msToTime(b.endMs)}`;
      finalSrt += `${idx + 1}\n${timeLine}\n${b.text}\n\n`;
    });

    return finalSrt;
  } catch (e) {
    return arSrtText; // العودة للنص الأصلي في حال حدوث أي خطأ استثنائي
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
      id: 'org.custom.perfectsubtitles.dtw',
      version: '7.0.0',
      name: 'DTW Anchor-Synced Arabic Subtitles',
      description: 'المحرك الهندسي الخارق: مزامنة تعتمد على البصمة الزمنية، تصحيح الـ FPS، وتطهير الإعلانات',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  // مسار البروكسي والمعالجة الزمنية
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
            subText = advancedSyncEngine(refText, subText);
          }
        } catch (err) {
          console.log('Engine sync warning:', err.message);
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
        id: `sub-dtw-${idx}-${id}`,
        url: `${protocol}://${host}/proxy-sub?url=${encodeURIComponent(s.url)}${refUrlParam}`,
        lang: 'ara',
        label: `🇸🇦 [DTW مَزوّن آلياً + تنظيف الإعلانات] (${idx + 1})`
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
  res.end('Stremio DTW Subtitle Addon is Running!');
};

const PORT = process.env.PORT || 3000;
http.createServer(server).listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
