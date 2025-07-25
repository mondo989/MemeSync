const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ytdl = require('ytdl-core');
const fs = require('fs').promises;
const path = require('path');
const { timeToSeconds, formatForFFmpeg } = require('./utils/timeHelpers');
const Logger = require('./utils/logger');

// Set FFmpeg binary path
ffmpeg.setFfmpegPath(ffmpegStatic);

class VideoRenderer {
    constructor() {
        this.mediaDir = path.join(__dirname, '../media');
        this.slidesDir = path.join(__dirname, '../slides');
        this.audioPath = path.join(this.mediaDir, 'audio.mp3');
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
            // Validate YouTube URL
            if (!ytdl.validateURL(youtubeUrl)) {
                throw new Error('Invalid YouTube URL');
            }

            // Get video info
            const info = await ytdl.getInfo(youtubeUrl);
            const title = info.videoDetails.title;
            Logger.info(`Downloading: ${title}`);

            // Download audio
            const tempAudioPath = path.join(this.mediaDir, 'temp_audio.webm');
            
            await new Promise((resolve, reject) => {
                const stream = ytdl(youtubeUrl, {
                    filter: 'audioonly',
                    quality: 'highestaudio',
                });

                const writeStream = require('fs').createWriteStream(tempAudioPath);
                
                stream.pipe(writeStream);
                
                stream.on('error', reject);
                writeStream.on('error', reject);
                writeStream.on('finish', resolve);
            });

            // Convert and trim audio using FFmpeg
            await this.processAudio(tempAudioPath, startTime, endTime);
            
            // Clean up temp file
            await fs.unlink(tempAudioPath);
            
            Logger.success(`Audio downloaded and processed: ${this.audioPath}`);
            return this.audioPath;

        } catch (error) {
            Logger.error('Failed to download audio:', error);
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
                .audioCodec('mp3')
                .audioBitrate('128k')
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
}

module.exports = VideoRenderer; 