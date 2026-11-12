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

  // 1. مسار الـ Manifest (يعطي خيار ترجمة واحدة نظيفة لعدم التشتت)
  if (pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'org.custom.perfectsubtitles',
      version: '11.0.0',
      name: '🇸🇦 Perfect Arabic Subtitles',
      description: 'محرك المزامنة الجوهرية وضبط التوقيت التلقائي للترجمة العربية',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  // 2. مسار معالجة ومزامنة الترجمة
  if (pathname === '/proxy-sub') {
    const arUrl = parsedUrl.query.arUrl;
    const refUrl = parsedUrl.query.refUrl;

    if (!arUrl) {
      res.writeHead(400);
      res.end('Missing arUrl');
      return;
    }

    try {
      const [arRes, refRes] = await Promise.all([
        fetch(arUrl, { headers: HEADERS }),
        refUrl ? fetch(refUrl, { headers: HEADERS }).catch(() => null) : Promise.resolve(null)
      ]);

      if (!arRes.ok) throw new Error(`HTTP ${arRes.status}`);
      
      const arText = await arRes.text();
      const refText = (refRes && refRes.ok) ? await refRes.text() : null;

      const syncedSrt = processSubtitles(arText, refText);

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="subtitle.srt"'
      });
      res.end(syncedSrt);
    } catch (error) {
      res.writeHead(500);
      res.end(`Error processing subtitle: ${error.message}`);
    }
    return;
  }

  // 3. مسار الترجمات لـ Stremio (إرجاع ترجمة واحدة ممتازة فقط لتجنب الحوسة)
  if (pathname.startsWith('/subtitles/')) {
    const cleanPath = pathname.replace('.json', '');
    const parts = cleanPath.split('/');
    const type = parts[2];
    const id = parts[3] ? decodeURIComponent(parts[3]) : '';

    if (!type || !id) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [] }));
      return;
    }

    const targetUrl = `https://opensubtitles-v3.strem.io/subtitles/${type}/${encodeURIComponent(id)}.json`;
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      const parsed = await response.json();
      const subs = parsed.subtitles || [];

      const arabicSubs = subs.filter(s => s.lang === 'ara' || s.lang === 'ar');
      const refSub = subs.find(s => s.lang === 'eng' || s.lang === 'en');
      const refParam = refSub ? `&refUrl=${encodeURIComponent(refSub.url)}` : '';

      let formatted = [];
      if (arabicSubs.length > 0) {
        // نأخذ الترجمة الأولى فقط ونعالجها لتقديم خيار واحد نظيف تماماً
        const bestSub = arabicSubs[0];
        formatted.push({
          id: `sync-pure-${id}`,
          url: `${protocol}://${host}/proxy-sub?arUrl=${encodeURIComponent(bestSub.url)}${refParam}`,
          lang: 'ara',
          label: '🇸🇦 الترجمة العربية الذكية (مضبوطة ومزمنة تلقائياً)'
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
  res.end('Stremio Perfect Subtitles Addon is Running on Render!');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
