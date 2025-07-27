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

// Development logging middleware
if (process.env.NODE_ENV === 'development') {
    app.use((req, res, next) => {
        const start = Date.now();
        const { method, url, ip } = req;
        
        Logger.debug(`🌐 ${method} ${url} from ${ip}`);
        
        res.on('finish', () => {
            const duration = Date.now() - start;
            const { statusCode } = res;
            const statusEmoji = statusCode >= 400 ? '❌' : statusCode >= 300 ? '⚠️' : '✅';
            Logger.debug(`${statusEmoji} ${method} ${url} - ${statusCode} (${duration}ms)`);
        });
        
        next();
    });
}

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

// Generate video endpoint (supports both YouTube and script modes)
app.post('/api/generate', async (req, res) => {
    const { youtubeUrl, scriptText, voiceId, musicSearch, photoSource, soundSource, startTime, endTime, thumbnailMemeUrl, database } = req.body;
    
    // Determine mode based on input
    const isScriptMode = scriptText && scriptText.trim().length > 0;
    
    Logger.info('🎬 New video generation request:', {
        mode: isScriptMode ? 'script' : 'youtube',
        youtubeUrl: youtubeUrl?.substring(0, 50) + '...',
        scriptLength: scriptText?.length,
        voiceId,
        musicSearch,
        photoSource,
        soundSource,
        startTime,
        endTime,
        database: database || 'apu',
        ip: req.ip
    });
    
    // Validate inputs based on mode
    if (isScriptMode) {
        if (!scriptText || scriptText.trim().length === 0) {
            Logger.warn('❌ Script mode request missing script text');
            return res.status(400).json({ error: 'Script text is required for script mode' });
        }
        if (scriptText.trim().length < 10) {
            Logger.warn('❌ Script text too short');
            return res.status(400).json({ error: 'Script text must be at least 10 characters long' });
        }
    } else {
        if (!youtubeUrl) {
            Logger.warn('❌ YouTube mode request missing YouTube URL');
            return res.status(400).json({ error: 'YouTube URL is required for YouTube mode' });
        }
    }

    const jobId = Date.now().toString();
    
    // Store job info
    activeJobs.set(jobId, {
        status: 'started',
        progress: 0,
        message: 'Initializing...',
        startTime: new Date(),
        mode: isScriptMode ? 'script' : 'youtube'
    });

    Logger.info(`✅ Job ${jobId} created and queued for processing (${isScriptMode ? 'script' : 'youtube'} mode)`);

    // Start generation in background based on mode
    if (isScriptMode) {
        generateScriptVideoAsync(jobId, scriptText, { 
            voiceId: voiceId || 'voice1', 
            musicSearch: musicSearch || 'ambient peaceful background music', 
            photoSource: photoSource || 'pexels',
            soundSource: soundSource || 'freesound',
            database: database || 'other' // Use 'other' for script mode (CC0 photos)
        });
    } else {
        generateVideoAsync(jobId, youtubeUrl, { 
            startTime, 
            endTime, 
            thumbnailMemeUrl, 
            database: database || 'apu' 
        });
    }

    res.json({ jobId, message: 'Video generation started', mode: isScriptMode ? 'script' : 'youtube' });
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
    
    Logger.info(`📥 Download requested: ${filename} from ${req.ip}`);
    
    res.download(filePath, (err) => {
        if (err) {
            Logger.error(`❌ Download failed for ${filename}:`, err.message);
            res.status(404).json({ error: 'File not found' });
        } else {
            Logger.success(`✅ Download completed: ${filename}`);
        }
    });
});

// Cleanup endpoint
app.post('/api/cleanup', async (req, res) => {
    Logger.info(`🧹 Cleanup requested from ${req.ip}`);
    
    try {
        await generator.cleanup();
        const activeJobCount = activeJobs.size;
        activeJobs.clear();
        
        Logger.success(`✅ Cleanup completed - cleared ${activeJobCount} active jobs`);
        res.json({ message: 'Cleanup completed' });
    } catch (error) {
        Logger.error('❌ Cleanup failed:', error);
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

async function generateScriptVideoAsync(jobId, scriptText, options) {
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
                
                // Update progress based on message content for script mode
                if (message.includes('Step 1/7')) updateJob('running', 15, 'Generating speech...');
                else if (message.includes('Step 2/7')) updateJob('running', 25, 'Downloading background music...');
                else if (message.includes('Step 3/7')) updateJob('running', 35, 'Transcribing speech...');
                else if (message.includes('Step 4/7')) updateJob('running', 50, 'Extracting keywords...');
                else if (message.includes('Step 5/7')) updateJob('running', 65, 'Searching for memes...');
                else if (message.includes('Meme search completed')) updateJob('running', 75, 'Memes collected! Creating slides...');
                else if (message.includes('Step 6/7')) updateJob('running', 85, 'Rendering slides...');
                else if (message.includes('Step 7/7')) updateJob('running', 90, 'Creating final video with mixed audio...');
                else if (message.includes('Script-to-meme video generation completed')) updateJob('running', 95, 'Video complete! Preparing download...');
                else if (message.includes('Generating speech')) updateJob('running', 12, 'Converting text to speech...');
                else if (message.includes('Downloading background music')) updateJob('running', 20, 'Finding background music...');
            } catch (err) {
                originalInfo(message, data);
            }
        };

        // Race between generation and timeout
        const outputPath = await Promise.race([
            (async () => {
                try {
                    return await generator.generateVideoFromScript(scriptText, options);
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
        updateJob('completed', 100, 'Script video generated successfully!', filename);
        
    } catch (error) {
        // Restore original logger in case of error
        Logger.info = Logger.info.originalInfo || Logger.info;
        Logger.error = Logger.error.originalError || Logger.error;
        
        Logger.error(`Script video generation failed for job ${jobId}:`, error.message);
        
        // Determine error type for better user feedback
        let userMessage = error.message;
        if (error.message.includes('ELEVENLABS_API_KEY')) {
            userMessage = 'ElevenLabs API key is missing or invalid. Please check configuration.';
        } else if (error.message.includes('Failed to generate speech')) {
            userMessage = 'Text-to-speech generation failed. Please try again or use shorter text.';
        } else if (error.message.includes('Failed to download music')) {
            userMessage = 'Background music download failed. Please try a different mood or try again.';
        } else if (error.message.includes('timeout')) {
            userMessage = 'Generation timed out. Try shorter script text.';
        } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
            userMessage = 'Network error. Please check your internet connection.';
        }
        
        updateJob('error', 0, userMessage, null);
    }
}

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
            setTimeout(() => reject(new Error('Generation timeout after 10 minutes')), 6000000);
        });
        
        // Create custom logger to update progress
        const originalInfo = Logger.info;
        const originalError = Logger.error;
        
        Logger.info = (message, data) => {
            try {
                originalInfo(message, data);
                
                // Update progress based on message content  
                                    if (message.includes('Step 1/6')) updateJob('running', 15, 'Downloading audio...');
                    else if (message.includes('Step 2/6')) updateJob('running', 30, 'Generating transcript...');
                    else if (message.includes('Step 3/6')) updateJob('running', 45, 'Extracting keywords...');
                    else if (message.includes('Step 4/6')) updateJob('running', 60, 'Searching for memes...');
                    else if (message.includes('Meme search completed')) updateJob('running', 70, 'Memes collected! Creating slides...');
                    else if (message.includes('Step 5/6')) updateJob('running', 80, 'Rendering slides...');
                    else if (message.includes('Step 6/6')) updateJob('running', 90, 'Creating final video...');
                    else if (message.includes('Meme video generation completed')) updateJob('running', 95, 'Video complete! Preparing download...');
                else if (message.includes('Downloading audio')) updateJob('running', 10, 'Downloading audio...');
                else if (message.includes('Fetching video')) updateJob('running', 8, 'Fetching video info...');
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
    console.log('\n' + '='.repeat(60));
    Logger.success(`🎬 MEME SYNC SERVER STARTED`);
    console.log('='.repeat(60));
    Logger.success(`🌐 Server running at: http://localhost:${PORT}`);
    Logger.info(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    Logger.info(`📁 Serving static files from: ${path.join(__dirname, '../public')}`);
    Logger.info(`📦 Media directory: ${path.join(__dirname, '../media')}`);
    
    console.log('\n📋 API Endpoints:');
    Logger.info('   🏠 GET  /                    - Web interface');
    Logger.info('   🎬 POST /api/generate        - Start video generation');
    Logger.info('   📊 GET  /api/status/:jobId   - Check job status');
    Logger.info('   📡 GET  /api/stream/:jobId   - Real-time updates');
    Logger.info('   📥 GET  /api/download/:file  - Download generated video');
    Logger.info('   🧹 POST /api/cleanup         - Clean up temporary files');
    Logger.info('   ❤️  GET  /api/health         - Health check');
    
    console.log('\n🔑 Configuration:');
    Logger.info(`   OpenAI API: ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
    Logger.info(`   LemonFox API: ${process.env.LEMONFOX_API_KEY ? '✅ Configured' : '❌ Missing (using fallback)'}`);
    Logger.info(`   Meme Site URL: ${process.env.MEME_SITE_URL || '❌ Not configured (using defaults)'}`);
    
    console.log('\n🚀 Ready to generate meme videos!');
    console.log('='.repeat(60) + '\n');
});

module.exports = app; 