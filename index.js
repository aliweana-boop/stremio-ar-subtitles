const http = require('http');
const url = require('url');
const { processSubtitles } = require('./syncEngine');

const PORT = process.env.PORT || 3000;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  if (pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'org.custom.purearabic',
      version: '7.0.0',
      name: '🇸🇦 Pure Arabic Subtitles',
      description: 'إضافة الترجمات العربية النقية (مصححة ومنظفة بدون تدخلات خارجية)',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  // مسار جلب وتنظيف الترجمة العربية
  if (pathname === '/proxy-sub') {
    const arUrl = parsedUrl.query.arUrl;

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
      res.end(`Error processing subtitle: ${error.message}`);
    }
    return;
  }

  if (pathname.startsWith('/subtitles/')) {
    const cleanPath = pathname.replace('.json', '');
    const parts = cleanPath.split('/');
    const type = parts[2];
    const id = parts[3] ? decodeURIComponent(parts[3]) : '';
    const extra = parts[4] ? `/${decodeURIComponent(parts[4])}` : '';

    if (!type || !id) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [] }));
      return;
    }

    const targetUrl = `https://opensubtitles-v3.strem.io/subtitles/${type}/${encodeURIComponent(id)}${extra ? encodeURI(extra) : ''}.json`;
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      const parsed = await response.json();
      const subs = parsed.subtitles || [];

      const arabicSubs = subs.filter(s => s.lang === 'ara' || s.lang === 'ar');
      const formatted = [];

      // نعرض أفضل 3 ترجمات، لأن نسخة الفيلم قد تختلف من ملف لملف
      arabicSubs.slice(0, 3).forEach((s, idx) => {
        formatted.push({
          id: `pure-ar-${idx}-${id}`,
          url: `${protocol}://${host}/proxy-sub?arUrl=${encodeURIComponent(s.url)}`,
          lang: 'ara',
          label: `🇸🇦 العربية (خيار ${idx + 1}) - خالية من الإعلانات`
        });
      });

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: formatted }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [] }));
    }
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Stremio Pure Arabic Subtitles is Running!');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
