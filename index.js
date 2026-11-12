const url = require('url');
const http = require('http');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

const server = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || '/';

  // 1. مسار الـ Manifest
  if (pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'org.custom.perfectsubtitles',
      version: '6.0.3',
      name: 'Perfect Arabic Subtitles',
      description: 'المحرك الهندسي المحصن بمعايير الثقة والتحقق والاتزان',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  // 2. مسار بروكسي جلب الترجمة
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
      
      const subText = await response.text();

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

  // 3. مسار الترجمات لـ Stremio
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

      const formatted = arabicSubs.map((s, idx) => ({
        id: `sub-${idx}-${id}`,
        url: `${protocol}://${host}/proxy-sub?url=${encodeURIComponent(s.url)}`,
        lang: 'ara',
        label: `🇸🇦 الترجمة العربية (${idx + 1})`
      }));

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: formatted }));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ subtitles: [], error: e.message }));
    }
    return;
  }

  // الصفحة الرئيسية
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Stremio Addon is Running! Add /manifest.json to Stremio.');
};

const PORT = process.env.PORT || 3000;
http.createServer(server).listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
