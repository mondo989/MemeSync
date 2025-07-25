const express = require('express');
const path = require('path');
const cors = require('cors');
const MemeVideoGenerator = require('./index');
const Logger = require('./utils/logger');

// Add global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
    Logger.error('Uncaught Exception:', error);
    // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    Logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process, just log the error
});

const app = express();
const PORT = process.env.PORT || 3000;
const generator = new MemeVideoGenerator();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/media', express.static(path.join(__dirname, '../media')));

// Store active jobs
const activeJobs = new Map();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Generate video endpoint
app.post('/api/generate', async (req, res) => {
    const { youtubeUrl, startTime, endTime, thumbnailMemeUrl } = req.body;
    
    if (!youtubeUrl) {
        return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const jobId = Date.now().toString();
    
    // Store job info
    activeJobs.set(jobId, {
        status: 'started',
        progress: 0,
        message: 'Initializing...',
        startTime: new Date()
    });

    // Start generation in background
    generateVideoAsync(jobId, youtubeUrl, { startTime, endTime, thumbnailMemeUrl });

    res.json({ jobId, message: 'Video generation started' });
});

// Job status endpoint
app.get('/api/status/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = activeJobs.get(jobId);
    
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(job);
});

// Server-Sent Events for real-time updates
app.get('/api/stream/:jobId', (req, res) => {
    const { jobId } = req.params;
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const sendUpdate = () => {
        const job = activeJobs.get(jobId);
        if (job) {
            res.write(`data: ${JSON.stringify(job)}\n\n`);
            
            if (job.status === 'completed' || job.status === 'error') {
                res.end();
                return;
            }
        }
        setTimeout(sendUpdate, 1000);
    };

    sendUpdate();

    req.on('close', () => {
        res.end();
    });
});

// Download video endpoint
app.get('/api/download/:filename', (req, res) => {
    const { filename } = req.params;
    const filePath = path.join(__dirname, '../media', filename);
    
    res.download(filePath, (err) => {
        if (err) {
            Logger.error('Download failed:', err);
            res.status(404).json({ error: 'File not found' });
        }
    });
});

// Cleanup endpoint
app.post('/api/cleanup', async (req, res) => {
    try {
        await generator.cleanup();
        activeJobs.clear();
        res.json({ message: 'Cleanup completed' });
    } catch (error) {
        Logger.error('Cleanup failed:', error);
        res.status(500).json({ error: 'Cleanup failed' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeJobs: activeJobs.size
    });
});

async function generateVideoAsync(jobId, youtubeUrl, options) {
    // Update job status
    const updateJob = (status, progress, message, outputPath = null) => {
        try {
            activeJobs.set(jobId, {
                status,
                progress,
                message,
                outputPath,
                startTime: activeJobs.get(jobId)?.startTime || new Date(),
                endTime: status === 'completed' || status === 'error' ? new Date() : null
            });
        } catch (err) {
            Logger.error('Failed to update job status:', err);
        }
    };

    try {
        updateJob('running', 10, 'Initializing...');
        
        // Wrap the generator in a timeout to prevent hanging
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Generation timeout after 10 minutes')), 600000);
        });
        
        // Create custom logger to update progress
        const originalInfo = Logger.info;
        const originalError = Logger.error;
        
        Logger.info = (message, data) => {
            try {
                originalInfo(message, data);
                
                // Update progress based on message content
                if (message.includes('Step 1/6')) updateJob('running', 20, 'Downloading audio...');
                else if (message.includes('Step 2/6')) updateJob('running', 35, 'Generating transcript...');
                else if (message.includes('Step 3/6')) updateJob('running', 50, 'Extracting keywords...');
                else if (message.includes('Step 4/6')) updateJob('running', 65, 'Matching memes...');
                else if (message.includes('Step 5/6')) updateJob('running', 80, 'Rendering slides...');
                else if (message.includes('Step 6/6')) updateJob('running', 90, 'Creating final video...');
                else if (message.includes('Downloading audio')) updateJob('running', 15, 'Downloading audio...');
                else if (message.includes('Fetching video')) updateJob('running', 12, 'Fetching video info...');
            } catch (err) {
                originalInfo(message, data);
            }
        };

        // Race between generation and timeout with additional error wrapping
        const outputPath = await Promise.race([
            (async () => {
                try {
                    return await generator.generateVideo(youtubeUrl, options);
                } catch (err) {
                    Logger.error('Generator error:', err);
                    throw err;
                }
            })(),
            timeoutPromise
        ]);
        
        // Restore original logger
        Logger.info = originalInfo;
        Logger.error = originalError;
        
        const filename = path.basename(outputPath);
        updateJob('completed', 100, 'Video generated successfully!', filename);
        
    } catch (error) {
        // Restore original logger in case of error
        Logger.info = Logger.info.originalInfo || Logger.info;
        Logger.error = Logger.error.originalError || Logger.error;
        
        Logger.error(`Video generation failed for job ${jobId}:`, error.message);
        
        // Determine error type for better user feedback
        let userMessage = error.message;
        if (error.message.includes('functions') || error.message.includes('player')) {
            userMessage = 'YouTube video extraction failed. Try a different video or try again later.';
        } else if (error.message.includes('private') || error.message.includes('unavailable')) {
            userMessage = 'This video is private or unavailable. Please use a public video.';
        } else if (error.message.includes('timeout')) {
            userMessage = 'Generation timed out. Try a shorter video or time range.';
        } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
            userMessage = 'Network error. Please check your internet connection.';
        }
        
        updateJob('error', 0, userMessage, null);
    }
}

app.listen(PORT, () => {
    Logger.success(`🌐 Meme Sync web server running on http://localhost:${PORT}`);
    Logger.info('📝 Environment variables:');
    Logger.info(`   OpenAI API: ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    Logger.info(`   LemonFox API: ${process.env.LEMONFOX_API_KEY ? '✅ Configured' : '❌ Missing (using fallback)'}`);
    Logger.info(`   Meme Site URL: ${process.env.MEME_SITE_URL || '❌ Not configured (using defaults)'}`);
});

module.exports = app; 