import ytdl from 'ytdl-core';
import ffmpeg from 'fluent-ffmpeg';
import rateLimit from 'express-rate-limit';
import ffmpegStatic from 'ffmpeg-static';
import { PassThrough } from 'stream';

// Set ffmpeg path from ffmpeg-static
ffmpeg.setFfmpegPath(ffmpegStatic);

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per window
  message: 'Too many conversion requests, please try again later',
  keyGenerator: (req) => {
    return req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  }
});

// Function to get a random user agent
const getRandomUserAgent = () => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36 Edg/117.0.2045.47'
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

// Function to get a random IP address for header rotation
const getRandomIP = () => {
  return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
};

export default async (req, res) => {
  // Apply rate limiter
  limiter(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      // Validate YouTube URL
      const isValid = ytdl.validateURL(url);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid YouTube URL' });
      }

      // Create request options to bypass 410 error
      const requestOptions = {
        headers: {
          'User-Agent': getRandomUserAgent(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'X-Forwarded-For': getRandomIP()
        }
      };

      // Get video info with custom options to avoid 410 error
      const info = await ytdl.getInfo(url, { requestOptions });
      const videoDetails = info.videoDetails;
      const title = videoDetails.title;
      const duration = parseInt(videoDetails.lengthSeconds);

      // Add video duration limit (5 minutes max for free tier)
      const MAX_DURATION = 300; // 5 minutes in seconds
      if (duration > MAX_DURATION) {
        return res.status(400).json({ 
          error: 'Videos longer than 5 minutes are not supported on the free plan' 
        });
      }

      // Create a pass-through stream for more efficient processing
      const audioStream = ytdl(url, {
        quality: 'highestaudio',
        highWaterMark: 1 << 25, // 32MB buffer
        requestOptions // Use our custom headers to avoid 410
      });

      // Create converter stream
      const converter = ffmpeg(audioStream)
        .audioBitrate(128)
        .toFormat('mp3')
        .on('error', error => {
          console.error('FFmpeg error:', error);
          res.status(500).json({ error: 'Conversion failed' });
        });

      // Stream directly to response
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/[^a-z0-9]/gi, '_')}.mp3"`);
      
      converter.pipe(res);

    } catch (error) {
      console.error('Conversion error:', error);
      
      // Special handling for 410 error
      if (error.message.includes('410') || error.statusCode === 410) {
        return res.status(410).json({ 
          error: 'YouTube has changed their API. Please try again with a different video or try again later.',
          details: error.message 
        });
      }
      
      res.status(500).json({ error: 'Conversion failed', details: error.message });
    }
  });
};