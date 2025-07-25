const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ytdl = require('@distube/ytdl-core');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { timeToSeconds, formatForFFmpeg } = require('./utils/timeHelpers');
const Logger = require('./utils/logger');

// Use system FFmpeg instead of static binary for better codec support
try {
    // Try to use system FFmpeg first
    ffmpeg.setFfmpegPath('/opt/homebrew/bin/ffmpeg');
    ffmpeg.setFfprobePath('/opt/homebrew/bin/ffprobe');
    Logger.info('Using system FFmpeg with full codec support');
} catch (error) {
    // Fallback to static binary if system FFmpeg not available
    ffmpeg.setFfmpegPath(ffmpegStatic);
    Logger.warn('Using static FFmpeg binary (limited codec support)');
}

class VideoRenderer {
    constructor() {
        this.mediaDir = path.join(__dirname, '../media');
        this.slidesDir = path.join(__dirname, '../slides');
        this.audioPath = path.join(this.mediaDir, 'audio.m4a');
        this.outputPath = path.join(this.mediaDir, 'output.mp4');
    }

    /**
     * Initialize renderer and create directories
     */
    async initialize() {
        try {
            await fs.mkdir(this.mediaDir, { recursive: true });
            Logger.info('Video renderer initialized');
        } catch (error) {
            Logger.error('Failed to initialize video renderer:', error);
            throw error;
        }
    }

    /**
     * Download and process audio from YouTube URL
     * @param {string} youtubeUrl - YouTube video URL
     * @param {string} startTime - Start time (MM:SS or HH:MM:SS)
     * @param {string} endTime - End time (MM:SS or HH:MM:SS)
     * @returns {Promise<string>} - Path to processed audio file
     */
    async downloadAudio(youtubeUrl, startTime = null, endTime = null) {
        await this.initialize();

        Logger.info(`Downloading audio from: ${youtubeUrl}`);

        try {
            // Try yt-dlp first (more reliable)
            Logger.info('Attempting download with yt-dlp...');
            const tempAudioPath = await this.downloadWithYtDlp(youtubeUrl);
            
            // Convert and trim audio using FFmpeg
            await this.processAudio(tempAudioPath, startTime, endTime);
            
            // Clean up temp file
            await fs.unlink(tempAudioPath);
            
            Logger.success(`Audio downloaded and processed: ${this.audioPath}`);
            return this.audioPath;

        } catch (ytdlpError) {
            Logger.warn('yt-dlp failed, trying ytdl-core fallback:', ytdlpError.message);
            
            try {
                // Fallback to ytdl-core
                await this.downloadWithYtdlCore(youtubeUrl);
                
                Logger.success(`Audio downloaded with fallback method: ${this.audioPath}`);
                return this.audioPath;
                
            } catch (fallbackError) {
                Logger.error('All download methods failed');
                throw new Error(`Unable to download video. yt-dlp: ${ytdlpError.message}, ytdl-core: ${fallbackError.message}`);
            }
        }
    }

    /**
     * Download audio using yt-dlp (most reliable method)
     * @param {string} youtubeUrl - YouTube video URL
     * @returns {Promise<string>} - Path to downloaded audio file
     */
    async downloadWithYtDlp(youtubeUrl) {
        const tempAudioPath = path.join(this.mediaDir, 'temp_audio.%(ext)s');
        
        try {
            Logger.info('Using yt-dlp for download...');
            
            const output = await youtubedl(youtubeUrl, {
                extractAudio: true,
                audioFormat: 'wav',  // Use WAV instead of MP3 for better compatibility
                audioQuality: '0',   // Best quality
                output: tempAudioPath,
                noPlaylist: true,
                preferFreeFormats: true,
                addHeader: [
                    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                ],
                ffmpegLocation: '/opt/homebrew/bin/ffmpeg'  // Use system FFmpeg
            });

            Logger.info('yt-dlp download completed');
            
            // Find the actual downloaded file (yt-dlp determines the extension)
            const files = await fs.readdir(this.mediaDir);
            const audioFile = files.find(file => file.startsWith('temp_audio.') && file !== 'temp_audio.%(ext)s');
            
            if (!audioFile) {
                throw new Error('Downloaded audio file not found');
            }
            
            return path.join(this.mediaDir, audioFile);
            
        } catch (error) {
            Logger.error('yt-dlp download failed:', error.message);
            throw error;
        }
    }

    /**
     * Fallback download using ytdl-core (legacy method)
     * @param {string} youtubeUrl - YouTube video URL
     */
    async downloadWithYtdlCore(youtubeUrl, startTime = null, endTime = null) {
        try {
            // Validate YouTube URL
            if (!ytdl.validateURL(youtubeUrl)) {
                throw new Error('Invalid YouTube URL format');
            }

            Logger.info('Fetching video information...');
            
            // Get video info with retry logic
            const info = await this.getVideoInfoWithRetry(youtubeUrl);
            const title = info.videoDetails.title;
            Logger.info(`Downloading: ${title}`);

            // Download audio
            const tempAudioPath = path.join(this.mediaDir, 'temp_audio.webm');
            
            await this.downloadAudioWithRetry(youtubeUrl, tempAudioPath, 3);

            // Convert and trim audio using FFmpeg
            await this.processAudio(tempAudioPath, startTime, endTime);
            
            // Clean up temp file
            await fs.unlink(tempAudioPath);
            
        } catch (error) {
            Logger.error('ytdl-core fallback failed:', error);
            throw error;
        }
    }

    /**
     * Process audio (convert format and trim if needed)
     * @param {string} inputPath - Input audio file path
     * @param {string} startTime - Start time for trimming
     * @param {string} endTime - End time for trimming
     */
    async processAudio(inputPath, startTime, endTime) {
        return new Promise((resolve, reject) => {
            let command = ffmpeg(inputPath)
                .audioCodec('aac')  // Use AAC instead of MP3 for better compatibility
                .audioBitrate('128k')
                .audioFrequency(44100)
                .output(this.audioPath);

            // Apply trimming if start/end times provided
            if (startTime && endTime) {
                const startSeconds = timeToSeconds(startTime);
                const duration = timeToSeconds(endTime) - startSeconds;
                
                command = command
                    .seekInput(startSeconds)
                    .duration(duration);
                
                Logger.info(`Trimming audio: ${startTime} to ${endTime} (${duration}s)`);
            }

            command
                .on('end', () => {
                    Logger.info('Audio processing completed');
                    resolve();
                })
                .on('error', (error) => {
                    Logger.error('Audio processing failed:', error);
                    reject(error);
                })
                .run();
        });
    }

    /**
     * Create video from slides and audio
     * @param {Array} slides - Array of slide objects with timing info
     * @param {string} audioPath - Path to audio file
     * @returns {Promise<string>} - Path to output video
     */
    async createVideo(slides, audioPath = null) {
        await this.initialize();

        const finalAudioPath = audioPath || this.audioPath;
        Logger.info(`Creating video with ${slides.length} slides`);

        try {
            // Check if audio file exists
            await fs.access(finalAudioPath);
            
            // Create video using slides timing method
            await this.createTimedVideo(slides, finalAudioPath);
            
            Logger.success(`Video created successfully: ${this.outputPath}`);
            return this.outputPath;

        } catch (error) {
            Logger.error('Failed to create video:', error);
            throw error;
        }
    }

    /**
     * Create video with precise slide timing
     * @param {Array} slides - Array of slide objects
     * @param {string} audioPath - Path to audio file
     */
    async createTimedVideo(slides, audioPath) {
        return new Promise((resolve, reject) => {
            // Create filter complex for slide transitions
            const filterComplex = this.buildFilterComplex(slides);
            
            let command = ffmpeg();
            
            // Add all slide images as inputs
            slides.forEach(slide => {
                command = command.input(slide.path);
            });
            
            // Add audio input
            command = command.input(audioPath);
            
            // Apply filter complex and output settings
            command
                .complexFilter(filterComplex)
                .outputOptions([
                    '-c:v libx264',
                    '-preset medium',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 128k',
                    '-pix_fmt yuv420p',
                    '-shortest'
                ])
                .output(this.outputPath)
                .on('start', (commandLine) => {
                    Logger.debug('FFmpeg command:', commandLine);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        Logger.info(`Video progress: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    Logger.success('Video rendering completed');
                    resolve();
                })
                .on('error', (error) => {
                    Logger.error('Video rendering failed:', error);
                    reject(error);
                })
                .run();
        });
    }

    /**
     * Build FFmpeg filter complex for slide timing
     * @param {Array} slides - Array of slide objects
     * @returns {string} - FFmpeg filter complex string
     */
    buildFilterComplex(slides) {
        const filters = [];
        let previousOutput = '';
        
        slides.forEach((slide, index) => {
            const duration = slide.endTime - slide.startTime || 3; // Default 3 seconds
            const startTime = slide.startTime || 0;
            
            // Scale each image to 1920x1080
            filters.push(`[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS,fps=30[v${index}]`);
            
            if (index === 0) {
                // First slide
                filters.push(`[v${index}]trim=duration=${duration},setpts=PTS-STARTPTS[out${index}]`);
                previousOutput = `[out${index}]`;
            } else {
                // Concatenate with previous slides
                filters.push(`${previousOutput}[v${index}]concat=n=2:v=1:a=0[out${index}]`);
                previousOutput = `[out${index}]`;
            }
        });
        
        return filters.join(';');
    }

    /**
     * Create simple video with equal slide durations
     * @param {Array} slides - Array of slide objects
     * @param {string} audioPath - Path to audio file
     * @param {number} slideDuration - Duration per slide in seconds
     */
    async createSimpleVideo(slides, audioPath, slideDuration = 3) {
        return new Promise((resolve, reject) => {
            let command = ffmpeg();
            
            // Add all slide images
            slides.forEach(slide => {
                command = command.input(slide.path);
            });
            
            // Add audio
            command = command.input(audioPath);
            
            // Create simple slideshow
            const filterComplex = slides.map((slide, index) => {
                return `[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setpts=PTS-STARTPTS,fps=30,trim=duration=${slideDuration}[v${index}]`;
            }).join(';') + ';' + 
            slides.map((slide, index) => `[v${index}]`).join('') + 
            `concat=n=${slides.length}:v=1:a=0[outv]`;
            
            command
                .complexFilter(filterComplex)
                .outputOptions([
                    '-map [outv]',
                    `-map ${slides.length}:a`,
                    '-c:v libx264',
                    '-preset medium',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 128k',
                    '-pix_fmt yuv420p',
                    '-shortest'
                ])
                .output(this.outputPath)
                .on('progress', (progress) => {
                    if (progress.percent) {
                        Logger.info(`Video progress: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
    }

    /**
     * Get audio duration
     * @param {string} audioPath - Path to audio file
     * @returns {Promise<number>} - Duration in seconds
     */
    async getAudioDuration(audioPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(metadata.format.duration);
                }
            });
        });
    }

    /**
     * Clean up media files
     */
    async cleanup() {
        try {
            const files = await fs.readdir(this.mediaDir);
            await Promise.all(
                files.filter(file => file !== 'output.mp4')
                     .map(file => fs.unlink(path.join(this.mediaDir, file)))
            );
            Logger.info('Media directory cleaned up');
        } catch (error) {
            Logger.warn('Failed to cleanup media directory:', error.message);
        }
    }

    /**
     * Get video information
     * @param {string} videoPath - Path to video file
     * @returns {Promise<Object>} - Video metadata
     */
    async getVideoInfo(videoPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(err);
                } else {
                    resolve({
                        duration: metadata.format.duration,
                        size: metadata.format.size,
                        bitrate: metadata.format.bit_rate,
                        width: metadata.streams[0].width,
                        height: metadata.streams[0].height
                    });
                }
            });
        });
    }

    /**
     * Download audio with retry and multiple quality fallbacks
     * @param {string} youtubeUrl - YouTube video URL
     * @param {string} outputPath - Output file path
     * @param {number} maxRetries - Maximum retry attempts
     */
    async downloadAudioWithRetry(youtubeUrl, outputPath, maxRetries = 3) {
        const downloadConfigs = [
            // High quality with best compatibility
            {
                filter: 'audioonly',
                quality: 'highestaudio',
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': '*/*',
                        'Accept-Language': 'en-US,en;q=0.9',
                        'Sec-Fetch-Mode': 'navigate'
                    }
                }
            },
            // Fallback with lower quality
            {
                filter: 'audioonly',
                quality: 'lowestaudio',
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                }
            },
            // Last resort - any audio format
            {
                filter: (format) => format.hasAudio && !format.hasVideo,
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0'
                    }
                }
            }
        ];

        for (let configIndex = 0; configIndex < downloadConfigs.length; configIndex++) {
            const config = downloadConfigs[configIndex];
            Logger.info(`Trying download config ${configIndex + 1}/${downloadConfigs.length}`);

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    Logger.info(`Download attempt ${attempt}/${maxRetries} with config ${configIndex + 1}`);
                    
                    await new Promise((resolve, reject) => {
                        const stream = ytdl(youtubeUrl, config);
                        const writeStream = require('fs').createWriteStream(outputPath);
                        
                        stream.pipe(writeStream);
                        
                        stream.on('error', (error) => {
                            Logger.warn(`Stream error (config ${configIndex + 1}, attempt ${attempt}):`, error.message);
                            reject(error);
                        });
                        
                        writeStream.on('error', (error) => {
                            Logger.warn(`Write error (config ${configIndex + 1}, attempt ${attempt}):`, error.message);
                            reject(error);
                        });
                        
                        writeStream.on('finish', () => {
                            Logger.info(`Download successful with config ${configIndex + 1}`);
                            resolve();
                        });
                        
                        // Progressive timeout based on attempt
                        const timeout = (60 + attempt * 30) * 1000; // 60s, 90s, 120s
                        setTimeout(() => {
                            stream.destroy();
                            writeStream.destroy();
                            reject(new Error(`Download timeout after ${timeout/1000}s`));
                        }, timeout);
                    });
                    
                    // If we get here, download was successful
                    return;
                    
                } catch (error) {
                    Logger.warn(`Config ${configIndex + 1}, attempt ${attempt} failed:`, error.message);
                    
                    if (attempt === maxRetries) {
                        // Try next config
                        break;
                    }
                    
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, attempt * 1000));
                }
            }
        }
        
        // All configs and retries failed
        throw new Error('Failed to download audio after trying all methods. This video may be restricted, age-gated, or geoblocked. Try a different video.');
    }

    /**
     * Get video info with retry logic
     * @param {string} youtubeUrl - YouTube video URL
     * @returns {Promise<Object>} - Video info object
     */
    async getVideoInfoWithRetry(youtubeUrl, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                Logger.info(`Attempting to fetch video info (attempt ${attempt}/${maxRetries})`);
                
                const info = await ytdl.getInfo(youtubeUrl, {
                    requestOptions: {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    }
                });
                
                return info;
                
            } catch (error) {
                Logger.warn(`Attempt ${attempt} failed:`, error.message);
                
                if (attempt === maxRetries) {
                    if (error.message.includes('functions')) {
                        throw new Error('YouTube player extraction failed. This usually happens when YouTube updates their code. Please try again in a few minutes or use a different video.');
                    } else if (error.message.includes('private') || error.message.includes('unavailable')) {
                        throw new Error('This video is private or unavailable. Please use a public video.');
                    } else if (error.message.includes('age')) {
                        throw new Error('This video has age restrictions. Please use a different video.');
                    } else {
                        throw new Error(`Failed to access video after ${maxRetries} attempts: ${error.message}`);
                    }
                }
                
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, attempt * 2000));
            }
        }
    }
}

module.exports = VideoRenderer; 