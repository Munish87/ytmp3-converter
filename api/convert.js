import fetch from 'node-fetch';
import ytdl from 'ytdl-core';
import { Readable } from 'stream';
import { createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import fluent from 'fluent-ffmpeg';

export default async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const isValid = ytdl.validateURL(url);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    const info = await ytdl.getInfo(url);
    const videoDetails = info.videoDetails;
    const title = videoDetails.title;
    const thumbnail = videoDetails.thumbnails[0].url;
    const duration = parseInt(videoDetails.lengthSeconds);

    const tempFilePath = join(tmpdir(), `${Date.now()}-${title.replace(/[^a-z0-9]/gi, '_')}.mp3`);

    const audioStream = ytdl(url, { quality: 'highestaudio' });
    
    await new Promise((resolve, reject) => {
      fluent(audioStream)
        .audioBitrate(128)
        .toFormat('mp3')
        .on('error', reject)
        .on('end', resolve)
        .save(tempFilePath);
    });

    const stats = fs.statSync(tempFilePath);
    const fileSize = (stats.size / (1024 * 1024)).toFixed(2) + 'MB';

    const downloadUrl = `/api/download?path=${encodeURIComponent(tempFilePath)}&filename=${encodeURIComponent(title)}.mp3`;

    res.status(200).json({
      title,
      thumbnail,
      duration: formatDuration(duration),
      quality: '128kbps',
      size: fileSize,
      downloadUrl,
      filename: `${title}.mp3`
    });

  } catch (error) {
    console.error('Conversion error:', error);
    res.status(500).json({ error: 'Conversion failed', details: error.message });
  }
};

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  seconds = Math.floor(seconds % 60);
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}