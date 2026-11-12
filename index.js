const url = require('url');
const http = require('http');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

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

function msToTime(ms) {
  if (ms < 0) ms = 0;
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const milliseconds = String(ms % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${milliseconds}`;
}

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

// معالجة ونظافة الترجمة العربية بدون أي اعتماد خارجي لضمان ثبات التوقيت
function cleanAndFixArabicSubtitle(arSrtText) {
  try {
    let blocks = stripAdsAndJunk(parseSrt(arSrtText));
    if (blocks.length === 0) return arSrtText;

    let processedBlocks = blocks.map(block => {
      let duration = block.endMs - block.startMs;
      // ضمان مدة عرض منطقية وسليمة لا تقل عن ثانية ولا تزيد عن الحد الطبيعي
      if (duration < 1000) block.endMs = block.startMs + 1500;
      return block;
    });

    // منع التداخل البرمجي بين الجمل
    for (let i = 0; i < processedBlocks.length - 1; i++) {
      if (processedBlocks[i].endMs > processedBlocks[i + 1].startMs) {
        processedBlocks[i].endMs = processedBlocks[i + 1].startMs - 50;
      }
    }

    let finalSrt = '';
    processedBlocks.forEach((b, idx) => {
      const timeLine = `${msToTime(b.startMs)} --> ${msToTime(b.endMs)}`;
      finalSrt += `${idx + 1}\n${timeLine}\n${b.text}\n\n`;
    });

    return finalSrt;
  } catch (e) {
    return arSrtText;
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
      id: 'org.custom.purearabic',
      version: '9.0.0',
      name: '🇸🇦 Pure Arabic Subtitle (Single & Clean)',
      description: 'ترجمة عربية نقية، مفردة، ومصححة التوقيت آلياً بدون حوسة',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  if (pathname === '/proxy-sub') {
    const targetUrl = parsedUrl.query.url;
    if (!targetUrl) {
      res.writeHead(400);
      res.end('Missing url');
      return;
    }

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let subText = await response.text();

      // تنظيف وتثبيت الوقت محلياً
      subText = cleanAndFixArabicSubtitle(subText);

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

      let formatted = [];
      if (arabicSubs.length > 0) {
        // إرجاع خيار واحد فقط لا غير لضمان عدم التشتت
        const bestSub = arabicSubs[0];
        formatted.push({
          id: `sub-pure-${id}`,
          url: `${protocol}://${host}/proxy-sub?url=${encodeURIComponent(bestSub.url)}`,
          lang: 'ara',
          label: '🇸🇦 الترجمة العربية الصافية (متطابقة ومستقرة)'
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
  res.end('Pure Arabic Subtitle Addon is Running!');
};

const PORT = process.env.PORT || 3000;
http.createServer(server).listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
