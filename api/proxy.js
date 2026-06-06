export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  try {
    const response = await fetch(decodeURIComponent(url), {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS Reader)' }
    });
    const xml = await response.text();

    // Parse RSS XML into JSON
    const items = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

    for (const match of itemMatches) {
      const block = match[1];
      const get = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([^<]*)<\\/${tag}>`));
        return m ? (m[1] || m[2] || '').trim() : '';
      };
      const thumbMatch = block.match(/url="([^"]+\.(jpg|jpeg|png|webp))"/i)
        || block.match(/<media:content[^>]+url="([^"]+)"/i)
        || block.match(/<enclosure[^>]+url="([^"]+)"/i);

      items.push({
        title:       get('title'),
        link:        get('link') || get('guid'),
        description: get('description') || get('content:encoded'),
        pubDate:     get('pubDate'),
        thumbnail:   thumbMatch ? thumbMatch[1] : '',
      });

      if (items.length >= 6) break;
    }

    res.status(200).json({ status: 'ok', items });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
}
