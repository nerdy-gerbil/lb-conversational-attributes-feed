import Client from 'ssh2-sftp-client';

export const config = {
  api: {
    bodyParser: false,
  },
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
    const response = await fetch(shopifyFeedUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenAI-Feed-Generator/1.0" 
      }
    });

    if (!response.ok) {
      throw new Error(`Shopify Feed fetch failed: ${response.status} ${response.statusText}`);
    }

    const csvData = await response.text();
    const csvBuffer = Buffer.from(csvData, 'utf-8');

    const sftpConfig = {
      host: process.env.OPENAI_SFTP_HOST || 'sftp.commerce.openai.com',
      port: parseInt(process.env.OPENAI_SFTP_PORT || '443', 10),
      username: process.env.OPENAI_SFTP_USER || 'oaiproductfeedprod.fdbc409cd9193b488a8b211774110db66b476141',
      password: process.env.OPENAI_SFTP_PASSWORD || 'TONvnxOBrcLsxG1wfNgsBOfm/+gmJIqF',
    };

    console.log(`Connecting to SFTP server ${sftpConfig.host}...`);
    await sftp.connect(sftpConfig);

    // Clean up non-CSV legacy files on SFTP
    try { await sftp.delete('/conversational-feed.xml'); } catch (e) {}
    try { await sftp.delete('/conversational-feed.xml.gz'); } catch (e) {}

    // Upload single canonical CSV feed
    console.log('Uploading openai-product-feed.csv to SFTP root...');
    await sftp.put(csvBuffer, '/openai-product-feed.csv');

    await sftp.end();
    console.log('SFTP CSV upload completed successfully!');

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
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
