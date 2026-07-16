export default async function handler(req, res) {
  const url = "https://www.lilyblanche.com/pages/conversational-attributes-feed";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
    });
    if (!response.ok) {
      res.statusCode = response.status;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`Failed to fetch from Shopify: ${response.statusText}`);
      return;
    }
    const xml = await response.text();
    
    // Set headers for XML content and Vercel edge caching (12 hours = twice a day)
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=3600');
    res.end(xml);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`Server error: ${err.message}`);
  }
}
