import Client from 'ssh2-sftp-client';
import zlib from 'zlib';

export default async function handler(req, res) {
  // Check authorization token if defined
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Shopify liquid feed URL or fallback to GraphQL generator
  const shopifyFeedUrl = process.env.SHOPIFY_OPENAI_FEED_URL || "https://www.lilyblanche.com/pages/openai-product-feed";
  const sftp = new Client();

  try {
    console.log(`Fetching feed from ${shopifyFeedUrl}...`);
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
    const gzBuffer = zlib.gzipSync(csvBuffer);

    console.log(`Fetched feed CSV (${csvBuffer.length} bytes), compressed to GZIP (${gzBuffer.length} bytes)`);

    const sftpConfig = {
      host: process.env.OPENAI_SFTP_HOST || 'sftp.commerce.openai.com',
      port: parseInt(process.env.OPENAI_SFTP_PORT || '443', 10),
      username: process.env.OPENAI_SFTP_USER || 'oaiproductfeedprod.fdbc409cd9193b488a8b211774110db66b476141',
      password: process.env.OPENAI_SFTP_PASSWORD || 'TONvnxOBrcLsxG1wfNgsBOfm/+gmJIqF',
    };

    console.log(`Connecting to SFTP server ${sftpConfig.host}...`);
    await sftp.connect(sftpConfig);

    console.log('Uploading feeds to SFTP...');
    await sftp.put(csvBuffer, '/openai-product-feed.csv');
    await sftp.put(gzBuffer, '/openai-product-feed.csv.gz');

    await sftp.end();
    console.log('SFTP upload completed successfully!');

    return res.status(200).json({
      success: true,
      message: 'OpenAI Shopping Feed generated and uploaded to SFTP successfully',
      csvSizeBytes: csvBuffer.length,
      gzSizeBytes: gzBuffer.length,
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
