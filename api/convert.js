// api/convert.js (CommonJS)
const ytdl = require('ytdl-core');

let ffmpeg, ffmpegPath;
try {
  // try to require ffmpeg-static + fluent-ffmpeg
  ffmpegPath = require('ffmpeg-static');
  ffmpeg = require('fluent-ffmpeg');
  if (ffmpegPath && ffmpeg && ffmpeg.setFfmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
  } else {
    ffmpeg = null;
  }
} catch (e) {
  // ffmpeg not available
  ffmpeg = null;
}

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { url } = req.body || {};
    if (!url || !ytdl.validateURL(url)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // get info to build filename
    const info = await ytdl.getInfo(url);
    const rawTitle = (info.videoDetails && info.videoDetails.title) || 'youtube-audio';
    const safeTitle = rawTitle.replace(/[\/\\?%*:|"<>]/g, '').slice(0, 120);

    // If ffmpeg available -> transcode to mp3
    if (ffmpeg) {
      const filename = `${safeTitle}.mp3`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'audio/mpeg');
      // stream audio through ffmpeg to mp3
      const ytStream = ytdl(url, { quality: 'highestaudio' });

      // handle ytdl errors
      ytStream.on('error', (err) => {
        console.error('ytdl error:', err);
      });

      // pipe through ffmpeg and stream to response
      ffmpeg(ytStream)
        .audioBitrate(128)
        .format('mp3')
        .on('error', (err) => {
          console.error('ffmpeg error:', err);
          // fallback to direct stream if ffmpeg fails
          try {
            streamOriginalAudioFallback(url, safeTitle, res);
          } catch (fallbackErr) {
            console.error('fallback error:', fallbackErr);
            if (!res.headersSent) res.status(500).json({ error: 'Conversion failed' });
          }
        })
        .pipe(res, { end: true });

      return;
    }

    // If no ffmpeg, fall back to streaming the original audio container (m4a/webm)
    await streamOriginalAudioFallback(url, safeTitle, res);

  } catch (err) {
    console.error('convert handler error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Conversion failed on server' });
  }
};

// helper to stream original audio (no transcoding)
async function streamOriginalAudioFallback(url, safeTitle, res) {
  const info = await ytdl.getInfo(url);
  // pick highest bitrate audio-only format
  const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
  if (!audioFormats || audioFormats.length === 0) {
    if (!res.headersSent) res.status(500).json({ error: 'No audio formats found' });
    return;
  }
  audioFormats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const fmt = audioFormats[0];
  const ext = (fmt.container && fmt.container.toLowerCase()) || 'm4a';
  const filename = `${safeTitle}.${ext}`;

  if (!res.headersSent) {
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const mime = (fmt.mimeType && fmt.mimeType.split(';')[0]) || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
  }

  const stream = ytdl.downloadFromInfo(info, { format: fmt });
  stream.on('error', (err) => {
    console.error('ytdl stream error (fallback):', err);
    try { if (!res.headersSent) res.status(500).json({ error: 'Streaming failed' }); } catch(e){}
  });
  stream.pipe(res);
}
