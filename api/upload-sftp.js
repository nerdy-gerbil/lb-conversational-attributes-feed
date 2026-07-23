import Client from 'ssh2-sftp-client';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const shopifyFeedUrl = process.env.SHOPIFY_OPENAI_FEED_URL || "https://www.lilyblanche.com/pages/openai-product-feed";
  const sftp = new Client();

  try {
    console.log(`Fetching feed CSV from ${shopifyFeedUrl}...`);
    let response;
    let attempts = 0;
    
    // Retry up to 3 times if Shopify hits rate limit
    while (attempts < 3) {
      response = await fetch(shopifyFeedUrl, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
        }
      });

      if (response.status !== 429) break;
      attempts++;
      console.log(`Shopify 429 rate limited. Retrying attempt ${attempts}/3...`);
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!response.ok) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({
        success: false,
        error: `Shopify rate-limited (HTTP ${response.status}). Rate limit clear in ~2 minutes.`
      });
    }

    const csvData = await response.text();
    if (csvData.includes('local_rate_limited')) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({
        success: false,
        error: 'Shopify returned local_rate_limited text. Rate limit active.'
      });
    }

    const csvBuffer = Buffer.from(csvData, 'utf-8');

    const sftpConfig = {
      host: process.env.OPENAI_SFTP_HOST || 'sftp.commerce.openai.com',
      port: parseInt(process.env.OPENAI_SFTP_PORT || '443', 10),
      username: process.env.OPENAI_SFTP_USER || 'oaiproductfeedprod.fdbc409cd9193b488a8b211774110db66b476141',
      password: process.env.OPENAI_SFTP_PASSWORD || 'TONvnxOBrcLsxG1wfNgsBOfm/+gmJIqF',
      readyTimeout: 30000,
    };

    console.log(`Connecting to SFTP server ${sftpConfig.host}...`);
    await sftp.connect(sftpConfig);

    console.log('Uploading openai-product-feed.csv to SFTP root...');
    await sftp.put(csvBuffer, '/openai-product-feed.csv');

    await sftp.end();
    console.log('SFTP CSV upload completed successfully!');

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      success: true,
      message: 'OpenAI CSV Shopping Feed uploaded to SFTP successfully',
      csvSizeBytes: csvBuffer.length,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    if (sftp) {
      try { await sftp.end(); } catch (e) {}
    }
    console.error('Feed generation/SFTP error:', err.message);
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      success: false,
      error: err.message
    });
  }
}
