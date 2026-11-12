const url = require('url');
const http = require('http');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

// دالة ذكية لمواءمة وتثبيت التوقيت الزمني من الإنجليزي إلى العربي
function syncSubtitleTiming(enSrt, arSrt) {
  try {
    const parseSrt = (srtText) => {
      return srtText.trim().split(/\r?\n\r?\n/).map(block => {
        const lines = block.split(/\r?\n/);
        if (lines.length >= 3) {
          return {
            time: lines[1], // التوقيت (مثال: 00:01:20,123 --> 00:01:25,456)
            text: lines.slice(2).join('\n') // النص
          };
        }
        return null;
      }).filter(Boolean);
    };

    const enBlocks = parseSrt(enSrt);
    const arBlocks = parseSrt(arSrt);

    if (enBlocks.length === 0 || arBlocks.length === 0) return arSrt;

    // دمج التوقيت الإنجليزي مع النص العربي حسب تسلسل الأسطر
    let syncedSrt = '';
    for (let i = 0; i < arBlocks.length; i++) {
      const timing = enBlocks[i] ? enBlocks[i].time : arBlocks[i].time;
      const text = arBlocks[i].text;
      
      syncedSrt += `${i + 1}\n${timing}\n${text}\n\n`;
    }

    return syncedSrt;
  } catch (e) {
    return arSrt; // في حال حدث أي خطأ، يعود للترجمة الأصلية
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
      version: '6.1.0',
      name: 'Perfect Synced Arabic Subtitles',
      description: 'المحرك الهندسي الموازن للتوقت والزمن بدقة متناهية',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  // مسار جلب ومواءمة الترجمة (Proxy & Sync)
  if (pathname === '/proxy-sub') {
    const targetUrl = parsedUrl.query.url;
    const refUrl = parsedUrl.query.ref; // رابط الترجمة الإنجليزية المرجعية
    
    if (!targetUrl) {
      res.writeHead(400);
      res.end('Missing url');
      return;
    }

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      let subText = await response.text();

      // إذا وُجدت ترجمة إنجليزية مرجعية، نقوم بمواءمة التوقيت عليها
      if (refUrl) {
        try {
          const refResponse = await fetch(refUrl, { headers: HEADERS });
          if (refResponse.ok) {
            const refText = await refResponse.text();
            subText = syncSubtitleTiming(refText, subText);
          }
        } catch (err) {
          console.log('Sync warning:', err.message);
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
        id: `sub-synced-${idx}-${id}`,
        url: `${protocol}://${host}/proxy-sub?url=${encodeURIComponent(s.url)}${refUrlParam}`,
        lang: 'ara',
        label: `🇸🇦 [معايرة زمنية دقيقة] ترجمة عربية (${idx + 1})`
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
