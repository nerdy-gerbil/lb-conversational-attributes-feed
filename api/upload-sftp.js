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
  const sftp = new Client();

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

    console.log(`Connecting to SFTP server ${sftpConfig.host}...`);
    await sftp.connect(sftpConfig);

    console.log('Uploading openai-product-feed.csv to SFTP root...');
    let uploadSuccess = false;
    let uploadAttempts = 0;
    
    while (uploadAttempts < 5 && !uploadSuccess) {
      uploadAttempts++;
      try {
        await sftp.put(csvBuffer, '/openai-product-feed.csv');
        uploadSuccess = true;
      } catch (uploadErr) {
        console.warn(`SFTP put attempt ${uploadAttempts} failed: ${uploadErr.message}`);
        if (uploadAttempts >= 5) throw uploadErr;
        // Reconnect SFTP session before retry if concurrent modification blob error occurs
        try { await sftp.end(); } catch (e) {}
        await new Promise(r => setTimeout(r, 4000));
        await sftp.connect(sftpConfig);
      }
    }

    await sftp.end();
    console.log('SFTP CSV upload completed successfully!');

    res.statusCode = 200;
    return res.end(JSON.stringify({
      success: true,
      message: 'OpenAI CSV Shopping Feed uploaded to SFTP successfully',
      csvSizeBytes: csvBuffer.length,
      timestamp: new Date().toISOString()
    }));

  } catch (err) {
    if (sftp) {
      try { await sftp.end(); } catch (e) {}
    }
    console.error('Feed generation/SFTP error:', err.message);
    res.statusCode = 500;
    return res.end(JSON.stringify({
      success: false,
      error: err.message
    }));
  }
}
