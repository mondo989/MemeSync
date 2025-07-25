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
                // Fallback to ytdl-core (already handles timing correctly)
                await this.downloadWithYtdlCore(youtubeUrl, startTime, endTime);
                
                Logger.success(`Audio downloaded and processed with fallback method: ${this.audioPath}`);
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
            
            // Get actual audio duration for proper timing
            const audioDuration = await this.getAudioDuration(finalAudioPath);
            Logger.info(`Creating video with ${slides.length} slides over ${audioDuration}s audio`);
            Logger.info('Slide timing:');
            slides.forEach((slide, index) => {
                const duration = slide.endTime - slide.startTime;
                Logger.info(`  ${index + 1}. ${slide.startTime.toFixed(1)}s-${slide.endTime.toFixed(1)}s (${duration.toFixed(1)}s)`);
            });
            await this.createTimedSlideshow(slides, finalAudioPath);
            
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
     * Get the duration of an audio file
     * @param {string} audioPath - Path to audio file
     * @returns {Promise<number>} - Duration in seconds
     */
    async getAudioDuration(audioPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    Logger.error('Failed to get audio duration:', err);
                    reject(err);
                } else {
                    const duration = metadata.format.duration;
                    Logger.info(`Audio duration: ${duration.toFixed(1)}s`);
                    resolve(duration);
                }
            });
        });
    }

    /**
     * Create timed slideshow with specific slide durations based on lyrics timing
     * @param {Array} slides - Array of slide objects with startTime/endTime
     * @param {string} audioPath - Path to audio file
     */
    async createTimedSlideshow(slides, audioPath) {
        Logger.info(`Creating precisely timed slideshow with ${slides.length} slides`);
        
        // Log exact timing for each slide
        slides.forEach((slide, index) => {
            const duration = slide.endTime - slide.startTime;
            Logger.info(`  Slide ${index + 1}: ${slide.startTime.toFixed(1)}s-${slide.endTime.toFixed(1)}s (${duration.toFixed(1)}s)`);
        });

        try {
            // Method: Create individual segments then concatenate (more reliable)
            const segmentPaths = [];
            
            // Create each slide as a separate video segment
            for (let i = 0; i < slides.length; i++) {
                const slide = slides[i];
                const duration = slide.endTime - slide.startTime;
                const segmentPath = path.join(this.mediaDir, `segment_${i}.mp4`);
                
                Logger.info(`Creating segment ${i + 1}/${slides.length}: ${duration.toFixed(1)}s`);
                
                await this.createSlideSegment(slide.path, duration, segmentPath);
                segmentPaths.push(segmentPath);
            }
            
            // Concatenate all segments with audio
            await this.concatenateSegmentsWithAudio(segmentPaths, audioPath);
            
            // Clean up segment files
            for (const segmentPath of segmentPaths) {
                try {
                    await fs.unlink(segmentPath);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
            
            Logger.success('Precisely timed slideshow created successfully!');
            
        } catch (error) {
            Logger.error('Timed slideshow creation failed:', error.message);
            throw error;
        }
    }

    /**
     * Create a single slide segment with larger image size
     * @param {string} imagePath - Path to slide image
     * @param {number} duration - Duration in seconds
     * @param {string} outputPath - Output path for segment
     */
    async createSlideSegment(imagePath, duration, outputPath) {
        return new Promise((resolve, reject) => {
            ffmpeg(imagePath)
                .inputOptions(['-loop 1'])
                .videoFilters([
                    // Scale image to take up 75% of screen (larger presence)
                    'scale=1920:1080:force_original_aspect_ratio=increase',
                    'crop=1920:1080',
                    'scale=1440:810', // 75% of 1920x1080
                    'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black@0.1', // Subtle dark background
                    'fps=24'
                ])
                .outputOptions([
                    '-c:v libx264',
                    '-preset medium', // Better quality for larger images
                    '-crf 23', // Higher quality
                    '-pix_fmt yuv420p',
                    '-t', duration.toString()
                ])
                .output(outputPath)
                .on('end', resolve)
                .on('error', reject)
                .run();
        });
    }

    /**
     * Concatenate video segments with beautiful transitions and audio
     * @param {Array} segmentPaths - Array of segment file paths
     * @param {string} audioPath - Audio file path
     */
    async concatenateSegmentsWithAudio(segmentPaths, audioPath) {
        return new Promise((resolve, reject) => {
            Logger.info('Creating video with beautiful transitions...');
            
            let command = ffmpeg();
            
            // Add all segments
            segmentPaths.forEach(segmentPath => {
                command = command.addInput(segmentPath);
            });
            
            // Add audio
            command = command.addInput(audioPath);
            
            // Create beautiful transition effects
            const transitionDuration = 0.8; // 0.8 second transitions
            const transitions = [
                'fade', 'fadeblack', 'fadewhite', 'distance', 'wipeleft', 'wiperight',
                'wipeup', 'wipedown', 'slideleft', 'slideright', 'slideup', 'slidedown',
                'circlecrop', 'rectcrop', 'dissolve', 'pixelize'
            ];
            
            if (segmentPaths.length === 1) {
                // Single segment, no transitions needed
                const simpleFilter = '[0:v]scale=1920:1080[outv]';
                command.complexFilter(simpleFilter);
            } else {
                // Multiple segments with transitions
                const filters = [];
                let currentOutput = '[0:v]';
                
                for (let i = 1; i < segmentPaths.length; i++) {
                    const randomTransition = transitions[Math.floor(Math.random() * transitions.length)];
                    const outputLabel = i === segmentPaths.length - 1 ? '[outv]' : `[v${i}]`;
                    
                    Logger.info(`  Transition ${i}: ${randomTransition}`);
                    
                    filters.push(
                        `${currentOutput}[${i}:v]xfade=transition=${randomTransition}:duration=${transitionDuration}:offset=0${outputLabel}`
                    );
                    
                    currentOutput = outputLabel;
                }
                
                const filterComplex = filters.join(';');
                command.complexFilter(filterComplex);
            }
            
            command
                .outputOptions([
                    '-map [outv]',
                    `-map ${segmentPaths.length}:a`,
                    '-c:v libx264',
                    '-preset medium', // Better quality for transitions
                    '-crf 20', // High quality for beautiful transitions
                    '-c:a aac',
                    '-b:a 192k', // Higher audio quality
                    '-pix_fmt yuv420p',
                    '-shortest'
                ])
                .output(this.outputPath)
                .on('start', (commandLine) => {
                    Logger.debug('FFmpeg command with transitions:', commandLine);
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        Logger.info(`Final video with transitions: ${Math.round(progress.percent)}%`);
                    }
                })
                .on('end', () => {
                    Logger.success('Beautiful video with transitions created!');
                    resolve();
                })
                .on('error', (error) => {
                    Logger.error('Transition video creation failed:', error.message);
                    reject(error);
                })
                .run();
        });
    }

    /**
     * Create simple video with equal slide durations
     * @param {Array} slides - Array of slide objects
     * @param {string} audioPath - Path to audio file
     * @param {number} slideDuration - Duration per slide in seconds
     */
    async createSimpleVideo(slides, audioPath, slideDuration = 3) {
        return new Promise((resolve, reject) => {
            Logger.info(`Creating video with ${slides.length} slides, ${slideDuration.toFixed(1)}s each`);
            
            // Use simple, reliable approach: create slideshow from images with audio overlay
            let command = ffmpeg();
            
            // Simple, reliable approach: loop first image with audio
            command = command
                .addInput(slides[0].path)
                .inputOptions(['-loop 1'])
                .addInput(audioPath)
                .videoFilters([
                    'scale=1280:720:force_original_aspect_ratio=decrease',
                    'pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                    'fps=24'
                ])
                .outputOptions([
                    '-c:v libx264',
                    '-preset fast',
                    '-crf 28',
                    '-c:a aac',
                    '-b:a 128k',
                    '-pix_fmt yuv420p',
                    '-shortest' // Video duration matches audio
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
                    Logger.success('Video created successfully');
                    resolve();
                })
                .on('error', (error) => {
                    Logger.error('Video creation failed:', error.message);
                    reject(error);
                })
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