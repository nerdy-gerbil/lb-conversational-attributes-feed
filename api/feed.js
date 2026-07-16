export default async function handler(req, res) {
  const url = "https://www.lilyblanche.com/pages/conversational-attributes-feed";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
    });
    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch from Shopify: ${response.statusText}`);
    }
    const xml = await response.text();
    
    // Set headers for XML content and Vercel edge caching (1 hour)
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
    
    return res.status(200).send(xml);
  } catch (err) {
    return res.status(500).send(`Server error: ${err.message}`);
  }
}
