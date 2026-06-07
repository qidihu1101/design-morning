const cache = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  const decoded = decodeURIComponent(url);

  // Return cached data if fresh
  const cached = cache[decoded];
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    return res.status(200).json(cached.data);
  }

  try {
    const response = await fetch(decoded, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader Bot)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();

    const items = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const block = match[1];

      // Extract text fields
      const get = (tag) => {
        const m = block.match(new RegExp(
          `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`
        ));
        return m ? (m[1] || m[2] || '').trim() : '';
      };

      // 1. Try media:content, enclosure, or url= attributes first
      let thumb = '';

      const mediaContent = block.match(/<media:content[^>]+url="([^"]+)"/i);
      const enclosure    = block.match(/<enclosure[^>]+url="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);
      const urlAttr      = block.match(/url="([^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);

      if (mediaContent) thumb = mediaContent[1];
      else if (enclosure) thumb = enclosure[1];
      else if (urlAttr)   thumb = urlAttr[1];

      // 2. If no thumb yet, scan description/content for first <img src="...">
      if (!thumb) {
        const content = get('content:encoded') || get('description') || '';
        const imgMatch = content.match(/<img[^>]+src=["']([^"']+\.(jpg|jpeg|png|webp)[^"']*)["']/i)
                      || content.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (imgMatch) thumb = imgMatch[1];
      }

      // 3. Also try og:image style tags inside item
      if (!thumb) {
        const ogMatch = block.match(/og:image[^>]+content=["']([^"']+)["']/i);
        if (ogMatch) thumb = ogMatch[1];
      }

      // Filter out tiny tracking pixels, svg, gif
      if (thumb && (thumb.match(/\.(svg|gif)$/i) || thumb.includes('pixel') || thumb.includes('track'))) {
        thumb = '';
      }

      items.push({
        title:       get('title'),
        link:        get('link') || get('guid'),
        description: get('description') || get('content:encoded'),
        pubDate:     get('pubDate'),
        thumbnail:   thumb,
      });

      if (items.length >= 6) break;
    }

    const result = { status: 'ok', items, cachedAt: new Date().toISOString() };
    cache[decoded] = { data: result, timestamp: Date.now() };

    res.setHeader('X-Cache', 'MISS');
    res.status(200).json(result);

  } catch (err) {
    if (cached) {
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json(cached.data);
    }
    res.status(500).json({ status: 'error', message: err.message });
  }
}
