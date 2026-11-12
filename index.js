const http = require('http');
const { processSubtitles } = require('./syncEngine');

const PORT = process.env.PORT || 3000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  const reqUrl = req.url;

  if (reqUrl === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'org.custom.hashmatch',
      version: '8.0.0',
      name: '🇸🇦 Hash-Matched Arabic Subtitles',
      description: 'مطابقة فعلية للترجمة بناءً على بصمة واسم الملف (بدون تخمين زمني)',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  // مسار جلب وتنظيف الترجمة
  if (reqUrl.startsWith('/proxy-sub')) {
    const urlParams = new URLSearchParams(reqUrl.split('?')[1]);
    const arUrl = urlParams.get('arUrl');

    if (!arUrl) {
      res.writeHead(400);
      res.end('Missing arUrl');
      return;
    }

    try {
      const response = await fetch(arUrl, { headers: HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const arText = await response.text();
      const cleanSrt = processSubtitles(arText);

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="subtitle.srt"'
      });
      res.end(cleanSrt);
    } catch (error) {
      res.writeHead(500);
      res.end('Error processing subtitle');
    }
    return;
  }

  // قلب النظام: تمرير المسار بالكامل (بما فيه بصمة الملف) للمصدر الرسمي
  if (reqUrl.startsWith('/subtitles/')) {
    const targetUrl = `https://opensubtitles-v3.strem.io${reqUrl}`;
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      const parsed = await response.json();
      const subs = parsed.subtitles || [];

      const arabicSubs = subs.filter(s => s.lang === 'ara' || s.lang === 'ar');
      const formatted = [];

      if (arabicSubs.length > 0) {
        // نأخذ أول خيار لأنه المطابق رسمياً لبصمة الملف
        const bestSub = arabicSubs[0];
        formatted.push({
          id: 'sub-hash-match',
          url: `${protocol}://${host}/proxy-sub?arUrl=${encodeURIComponent(bestSub.url)}`,
          lang: 'ara',
          label: '🇸🇦 العربية (مطابقة بالبصمة - Hash Match)'
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: formatted }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [] }));
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Stremio Hash Match Addon is Running!');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
