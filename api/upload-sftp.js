import Client from 'ssh2-sftp-client';

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json');

  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const shopifyFeedUrl = process.env.SHOPIFY_OPENAI_FEED_URL || "https://www.lilyblanche.com/pages/openai-product-feed";

  try {
    console.log(`Fetching feed CSV from ${shopifyFeedUrl}...`);
    let csvData = "";
    let attempts = 0;
    const maxFetchAttempts = 15;
    
    while (attempts < maxFetchAttempts) {
      attempts++;
      const response = await fetch(shopifyFeedUrl, {
        headers: { 
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
        }
      });

      if (response.ok) {
        const text = await response.text();
        if (text.startsWith('item_id,title,description,url') || text.startsWith('"item_id","title","description","url"')) {
          csvData = text;
          break;
        }
      }

      console.log(`Shopify cold start/rate limit hit (attempt ${attempts}/${maxFetchAttempts}). Retrying in 2.5s...`);
      await new Promise(r => setTimeout(r, 2500));
    }

    if (!csvData) {
      res.statusCode = 500;
      return res.end(JSON.stringify({
        success: false,
        error: `Failed to fetch valid CSV from Shopify after ${maxFetchAttempts} retries.`
      }));
    }

    const csvBuffer = Buffer.from(csvData, 'utf-8');

    const sftpConfig = {
      host: process.env.OPENAI_SFTP_HOST || 'sftp.commerce.openai.com',
      port: parseInt(process.env.OPENAI_SFTP_PORT || '443', 10),
      username: process.env.OPENAI_SFTP_USER || 'oaiproductfeedprod.fdbc409cd9193b488a8b211774110db66b476141',
      password: process.env.OPENAI_SFTP_PASSWORD || 'TONvnxOBrcLsxG1wfNgsBOfm/+gmJIqF',
      readyTimeout: 30000,
    };

    let uploadSuccess = false;
    let uploadAttempts = 0;
    const maxUploadAttempts = 8;
    
    while (uploadAttempts < maxUploadAttempts && !uploadSuccess) {
      uploadAttempts++;
      const sftp = new Client();
      try {
        console.log(`SFTP connect & upload attempt ${uploadAttempts}/${maxUploadAttempts}...`);
        await sftp.connect(sftpConfig);
        await sftp.put(csvBuffer, '/openai-product-feed.csv');
        await sftp.end();
        uploadSuccess = true;
      } catch (uploadErr) {
        try { await sftp.end(); } catch (e) {}
        console.warn(`SFTP upload attempt ${uploadAttempts} failed: ${uploadErr.message}`);
        if (uploadAttempts >= maxUploadAttempts) throw uploadErr;
        // Exponential backoff (5s, 8s, 11s...) to allow Azure Blob read lock to clear
        const backoffMs = 5000 + (uploadAttempts * 3000);
        console.log(`Waiting ${backoffMs}ms for OpenAI Azure Blob lock to release...`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }

    console.log('SFTP CSV upload completed successfully!');

    res.statusCode = 200;
    return res.end(JSON.stringify({
      success: true,
      message: 'OpenAI CSV Shopping Feed uploaded to SFTP successfully',
      csvSizeBytes: csvBuffer.length,
      timestamp: new Date().toISOString()
    }));

  } catch (err) {
    console.error('Feed generation/SFTP error:', err.message);
    res.statusCode = 500;
    return res.end(JSON.stringify({
      success: false,
      error: err.message
    }));
  }
}
