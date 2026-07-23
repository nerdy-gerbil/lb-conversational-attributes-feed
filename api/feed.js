export default async function handler(req, res) {
  const url = "https://www.lilyblanche.com/pages/openai-product-feed";
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
    const csv = await response.text();
    
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=3600');
    res.end(csv);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end(`Server error: ${err.message}`);
  }
}
