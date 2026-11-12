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

  const reqUrl = req.url;

  if (reqUrl === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      id: 'org.custom.clonesync',
      version: '10.0.0',
      name: '🇸🇦 Arabic Subs (Auto + Manual Sync)',
      description: 'ترجمات عربية مع خيارات التأخير والتقديم المباشرة من القائمة',
      resources: ['subtitles'],
      types: ['movie', 'series'],
      idPrefixes: ['tt'],
      catalogs: []
    }));
    return;
  }

  if (reqUrl.startsWith('/proxy-sub')) {
    const urlParams = new URLSearchParams(reqUrl.split('?')[1]);
    const arUrl = urlParams.get('arUrl');
    const refUrl = urlParams.get('refUrl');
    const offset = parseInt(urlParams.get('offset') || '0', 10);

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

      // تطبيق محرك المزامنة مع الإزاحة المطلوبة
      const syncedSrt = processSubtitles(arText, refText, offset);

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="subtitle.srt"'
      });
      res.end(syncedSrt);
    } catch (error) {
      res.writeHead(500);
      res.end('Error processing subtitle');
    }
    return;
  }

  if (reqUrl.startsWith('/subtitles/')) {
    const targetUrl = `https://opensubtitles-v3.strem.io${reqUrl}`;
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';

    try {
      const response = await fetch(targetUrl, { headers: HEADERS });
      const parsed = await response.json();
      const subs = parsed.subtitles || [];

      const arabicSubs = subs.filter(s => s.lang === 'ara' || s.lang === 'ar');
      const englishSub = subs.find(s => s.lang === 'eng' || s.lang === 'en');
      const refParam = englishSub ? `&refUrl=${encodeURIComponent(englishSub.url)}` : '';

      const formatted = [];

      // نأخذ أفضل ترجمة عربية واحدة، ونعطي عليها خيارات التوقيت عشان ما تصير القائمة زحمة
      if (arabicSubs.length > 0) {
        const bestSub = arabicSubs[0];
        const baseProxy = `${protocol}://${host}/proxy-sub?arUrl=${encodeURIComponent(bestSub.url)}${refParam}`;
        
        formatted.push({
          id: `sub-auto`,
          url: `${baseProxy}&offset=0`,
          lang: 'ara',
          label: `🇸🇦 [تلقائي] المزامنة الذكية`
        });
        
        // خيارات التأخير (إذا كانت الترجمة تسبق الصوت)
        formatted.push({
          id: `sub-delay1`,
          url: `${baseProxy}&offset=1000`, // تأخير 1 ثانية
          lang: 'ara',
          label: `🇸🇦 [تأخير 1 ثانية] (الترجمة متقدمة)`
        });

        formatted.push({
          id: `sub-delay2`,
          url: `${baseProxy}&offset=2000`, // تأخير 2 ثانية
          lang: 'ara',
          label: `🇸🇦 [تأخير 2 ثانية] (الترجمة متقدمة جداً)`
        });

        // خيارات التقديم (إذا كانت الترجمة متأخرة عن الصوت)
        formatted.push({
          id: `sub-fast1`,
          url: `${baseProxy}&offset=-1000`, // تقديم 1 ثانية
          lang: 'ara',
          label: `🇸🇦 [تقديم 1 ثانية] (الترجمة متأخرة)`
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
  res.end('Stremio Custom Offset Addon is Running!');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
