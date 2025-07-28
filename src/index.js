#!/usr/bin/env node

require('dotenv').config();
const Logger = require('./utils/logger');
const TranscriptionService = require('./transcriptionService');
const KeywordExtractor = require('./keywordExtractor');
const MemesMatcher = require('./matchMemes');
const SlideRenderer = require('./renderSlides');
const VideoRenderer = require('./renderVideo');
const PuppeteerScraper = require('./puppeteerScraper');
const ElevenLabsService = require('./elevenLabsService');
const MusicDownloadService = require('./musicDownloadService');
const path = require('path'); // Added for path.join

class MemeVideoGenerator {
    constructor() {
        this.transcriptionService = new TranscriptionService();
        this.keywordExtractor = new KeywordExtractor();
        this.memesMatcher = new MemesMatcher();
        this.slideRenderer = new SlideRenderer();
        this.videoRenderer = new VideoRenderer();
        this.puppeteerScraper = new PuppeteerScraper();
        this.elevenLabsService = new ElevenLabsService();
        this.musicDownloadService = new MusicDownloadService();
    }

    /**
     * Generate meme video from YouTube URL
     * @param {string} youtubeUrl - YouTube video URL
     * @param {Object} options - Generation options
     * @returns {Promise<string>} - Path to generated video
     */
    async generateVideo(youtubeUrl, options = {}) {
        // Check if we have preselected keywords (Generate Again feature)
        if (options.preselectedKeywords && options.preselectedKeywords.length > 0) {
            Logger.info('🔄 Using preselected keywords from previous generation');
            return this.generateVideoWithPreselectedKeywords(youtubeUrl, options);
        }
        
        // Check if this is detailed mode
        Logger.info(`🔍 Processing mode: ${options.processingMode || 'quick'}`);
        if (options.processingMode === 'detailed') {
            Logger.info('🔍 Switching to detailed mode with keyword review');
            return this.generateVideoDetailed(youtubeUrl, options);
        }
        
        Logger.info('⚡ Using quick mode (no keyword review)');
        return this.generateVideoQuick(youtubeUrl, options);
    }

    /**
     * Generate video in quick mode (original flow)
     * @param {string} youtubeUrl - YouTube video URL
     * @param {Object} options - Generation options
     * @returns {Promise<string>} - Path to generated video
     */
    async generateVideoQuick(youtubeUrl, options = {}) {
        const {
            startTime = null,
            endTime = null,
            thumbnailMemeUrl = null,
            skipMemeGeneration = false
        } = options;

        Logger.info('🎬 Starting Meme Video Generation');
        Logger.info(`YouTube URL: ${youtubeUrl}`);
        
        if (startTime && endTime) {
            Logger.info(`Time range: ${startTime} to ${endTime}`);
        }

        try {
            // Step 1: Ensure we have memes database
            if (!skipMemeGeneration) {
                await this.ensureMemesDatabase();
            }

            // Step 2: Download and process audio
            Logger.info('📥 Step 1/6: Downloading and processing audio...');
            const audioPath = await this.videoRenderer.downloadAudio(youtubeUrl, startTime, endTime);

            // Step 3: Get transcript with timestamps
            Logger.info('🎤 Step 2/6: Generating transcript...');
            const transcript = await this.transcriptionService.getTranscript(youtubeUrl, startTime, endTime);
            
            if (transcript.length === 0) {
                throw new Error('No transcript generated - cannot proceed');
            }

            // Step 4: Extract keywords from transcript
            Logger.info('🔍 Step 3/6: Extracting keywords...');
            const keywordData = await this.keywordExtractor.extractKeywords(transcript);

            // Log the extracted lyrics for review
            Logger.success('📝 Lyrics extraction completed!');
            Logger.info('Extracted lyrics segments:');
            transcript.forEach((segment, index) => {
                Logger.info(`  ${index + 1}. [${segment.start.toFixed(1)}s-${segment.end.toFixed(1)}s] "${segment.text}"`);
            });

            Logger.info('\nExtracted keywords:');
            keywordData.forEach((item, index) => {
                Logger.info(`  ${index + 1}. "${item.keyword}" from: "${item.text}"`);
            });

                        // Step 5: Search for memes dynamically using Puppeteer
            Logger.info('🎭 Step 4/6: Searching for memes...');
            const keywords = keywordData.map(item => item.keyword);
            const memeResults = await this.puppeteerScraper.searchMemesForKeywords(keywords, options.database || 'apu');

            Logger.success(`🎭 Meme search completed! Found memes for ${memeResults.length} keywords`);
            
            // Validate array lengths match
            if (keywordData.length !== memeResults.length) {
                throw new Error(`Mismatch: ${keywordData.length} keywords but ${memeResults.length} meme results`);
            }
            
            // Combine keyword data with meme results using index-based mapping
            const matchedMemes = keywordData.map((item, index) => {
                // Use index-based mapping instead of keyword matching to ensure unique memes
                const memeResult = memeResults[index];
                if (!memeResult) {
                    throw new Error(`No meme found at index ${index} for keyword: ${item.keyword}`);
                }
                return {
                    ...item,
                    meme: {
                        url: memeResult.memeUrl,
                        keywords: [item.keyword]
                    }
                };
            });

            // ✅ CHECKPOINT PASSED: Meme collection successful! Now creating video...
            Logger.success(`🎭 Meme search completed! Found memes for ${matchedMemes.length} keywords`);
            Logger.info('📋 Collected memes summary:');
            matchedMemes.forEach((item, index) => {
                Logger.debug(`${index + 1}. "${item.keyword}" → ${item.meme.url.substring(0, 60)}...`);
            });

            // Step 4.5: Split long segments into multiple memes
            Logger.info('⏱️  Checking for long segments that need multiple memes...');
            const expandedMemes = await this.expandLongSegments(matchedMemes, options.database || 'apu');
            
            if (expandedMemes.length > matchedMemes.length) {
                Logger.info(`📈 Expanded ${matchedMemes.length} segments to ${expandedMemes.length} meme slots for better coverage`);
            }

            // Step 5: Render slides
            Logger.info('🖼️  Step 5/6: Rendering slides...');
            const slides = await this.slideRenderer.renderSlides(expandedMemes, thumbnailMemeUrl, options.database || 'apu');

            // Step 6: Create final video
            Logger.info('🎥 Step 6/6: Creating final video...');
            const outputPath = await this.videoRenderer.createVideo(slides, audioPath, options.database || 'apu');

            // Get video info
            const videoInfo = await this.videoRenderer.getVideoInfo(outputPath);
            
            Logger.success('🎉 Meme video generation completed!');
            Logger.success(`📁 Output: ${outputPath}`);
            Logger.success(`⏱️  Duration: ${Math.round(videoInfo.duration)}s`);
            Logger.success(`📊 Size: ${Math.round(videoInfo.size / 1024 / 1024)}MB`);

            return outputPath;

        } catch (error) {
            Logger.error('❌ Video generation failed:', error);
            throw error;
        }
    }

    /**
     * Generate video with preselected keywords (Generate Again feature)
     * @param {string} youtubeUrl - YouTube video URL
     * @param {Object} options - Generation options
     * @returns {Promise<string>} - Path to generated video
     */
    async generateVideoWithPreselectedKeywords(youtubeUrl, options = {}) {
        const {
            startTime = null,
            endTime = null,
            thumbnailMemeUrl = null,
            skipMemeGeneration = false,
            preselectedKeywords = []
        } = options;

        Logger.info('🔄 Starting Video Generation with Preselected Keywords');
        Logger.info(`YouTube URL: ${youtubeUrl}`);
        Logger.info(`Using ${preselectedKeywords.length} preselected keywords`);
        
        if (startTime && endTime) {
            Logger.info(`Time range: ${startTime} to ${endTime}`);
        }

        try {
            // Step 1: Ensure we have memes database
            if (!skipMemeGeneration) {
                await this.ensureMemesDatabase();
            }

            // Step 2: Download and process audio
            Logger.info('📥 Step 1/6: Downloading and processing audio...');
            const audioPath = await this.videoRenderer.downloadAudio(youtubeUrl, startTime, endTime);

            // Step 3: Get transcript with timestamps (needed for timing)
            Logger.info('🎤 Step 2/6: Generating transcript...');
            const transcript = await this.transcriptionService.getTranscript(youtubeUrl, startTime, endTime);
            
            if (transcript.length === 0) {
                throw new Error('No transcript generated - cannot proceed');
            }

            // Step 3.5: Convert preselected keywords back to keywordData format
            Logger.info('🔄 Step 3/6: Using preselected keywords...');
            const keywordData = preselectedKeywords.map((keywordItem, index) => {
                const transcriptSegment = transcript[index];
                if (!transcriptSegment) {
                    throw new Error(`Mismatch: preselected keyword ${index} has no corresponding transcript segment`);
                }
                return {
                    start: transcriptSegment.start,
                    end: transcriptSegment.end,
                    text: transcriptSegment.text,
                    keyword: keywordItem.keyword
                };
            });

            Logger.info('Preselected keywords applied:');
            keywordData.forEach((item, index) => {
                Logger.info(`  ${index + 1}. "${item.keyword}" from: "${item.text}"`);
            });

            // Step 4: Search for memes dynamically using Puppeteer
            Logger.info('🎭 Step 4/6: Searching for memes...');
            const keywords = keywordData.map(item => item.keyword);
            const memeResults = await this.puppeteerScraper.searchMemesForKeywords(keywords, options.database || 'apu');

            Logger.success(`🎭 Meme search completed! Found memes for ${memeResults.length} keywords`);
            
            // Validate array lengths match
            if (keywordData.length !== memeResults.length) {
                throw new Error(`Mismatch: ${keywordData.length} keywords but ${memeResults.length} meme results`);
            }
            
            // Combine keyword data with meme results using index-based mapping
            const matchedMemes = keywordData.map((item, index) => {
                // Use index-based mapping instead of keyword matching to ensure unique memes
                const memeResult = memeResults[index];
                if (!memeResult) {
                    throw new Error(`No meme found at index ${index} for keyword: ${item.keyword}`);
                }
                return {
                    ...item,
                    meme: {
                        url: memeResult.memeUrl,
                        keywords: [item.keyword]
                    }
                };
            });

            // ✅ CHECKPOINT PASSED: Meme collection successful! Now creating video...
            Logger.success(`🎭 Meme search completed! Found memes for ${matchedMemes.length} keywords`);
            Logger.info('📋 Collected memes summary:');
            matchedMemes.forEach((item, index) => {
                Logger.debug(`${index + 1}. "${item.keyword}" → ${item.meme.url.substring(0, 60)}...`);
            });

            // Step 4.5: Split long segments into multiple memes
            Logger.info('⏱️  Checking for long segments that need multiple memes...');
            const expandedMemes = await this.expandLongSegments(matchedMemes, options.database || 'apu');
            
            if (expandedMemes.length > matchedMemes.length) {
                Logger.info(`📈 Expanded ${matchedMemes.length} segments to ${expandedMemes.length} meme slots for better coverage`);
            }

            // Step 5: Render slides
            Logger.info('🖼️  Step 5/6: Rendering slides...');
            const slides = await this.slideRenderer.renderSlides(expandedMemes, thumbnailMemeUrl, options.database || 'apu');

            // Step 6: Create final video
            Logger.info('🎥 Step 6/6: Creating final video...');
            const outputPath = await this.videoRenderer.createVideo(slides, audioPath, options.database || 'apu');

            // Get video info
            const videoInfo = await this.videoRenderer.getVideoInfo(outputPath);
            
            Logger.success('🎉 Meme video generation completed!');
            Logger.success(`📁 Output: ${outputPath}`);
            Logger.success(`⏱️  Duration: ${Math.round(videoInfo.duration)}s`);
            Logger.success(`📊 Size: ${Math.round(videoInfo.size / 1024 / 1024)}MB`);

            return outputPath;

        } catch (error) {
            Logger.error('❌ Video generation with preselected keywords failed:', error);
            throw error;
        }
    }

    /**
     * Generate video in detailed mode (with keyword review pause)
     * @param {string} youtubeUrl - YouTube video URL
     * @param {Object} options - Generation options
     * @returns {Promise<string>} - Path to generated video or throws PauseForKeywordReview
     */
    async generateVideoDetailed(youtubeUrl, options = {}) {
        const {
            startTime = null,
            endTime = null,
            thumbnailMemeUrl = null,
            skipMemeGeneration = false,
            jobId = null
        } = options;

        Logger.info('🎬 Starting Detailed Meme Video Generation');
        Logger.info(`YouTube URL: ${youtubeUrl}`);
        
        if (startTime && endTime) {
            Logger.info(`Time range: ${startTime} to ${endTime}`);
        }

        try {
            // Step 1: Ensure we have memes database
            if (!skipMemeGeneration) {
                await this.ensureMemesDatabase();
            }

            // Step 2: Download and process audio
            Logger.info('📥 Step 1/6: Downloading and processing audio...');
            const audioPath = await this.videoRenderer.downloadAudio(youtubeUrl, startTime, endTime);

            // Step 3: Get transcript with timestamps
            Logger.info('🎤 Step 2/6: Generating transcript...');
            const transcript = await this.transcriptionService.getTranscript(youtubeUrl, startTime, endTime);
            
            if (transcript.length === 0) {
                throw new Error('No transcript generated - cannot proceed');
            }

            // Step 4: Extract keywords from transcript
            Logger.info('🔍 Step 3/6: Extracting keywords...');
            const keywordData = await this.keywordExtractor.extractKeywords(transcript);

            // Log the extracted lyrics for review
            Logger.success('📝 Lyrics extraction completed!');
            Logger.info('Extracted lyrics segments:');
            transcript.forEach((segment, index) => {
                Logger.info(`  ${index + 1}. [${segment.start.toFixed(1)}s-${segment.end.toFixed(1)}s] "${segment.text}"`);
            });

            Logger.info('\nExtracted keywords:');
            keywordData.forEach((item, index) => {
                Logger.info(`  ${index + 1}. "${item.keyword}" from: "${item.text}"`);
            });

            // PAUSE FOR KEYWORD REVIEW - Return data for server to handle
            Logger.info(`🔍 DETAILED MODE: Preparing keyword review data. JobId: ${jobId}`);
            
            // Format keywords for frontend display
            const keywords = keywordData.map(item => ({
                timestamp: `${Math.floor(item.start / 60)}:${String(Math.floor(item.start % 60)).padStart(2, '0')}`,
                keyword: item.keyword,
                lyrics: item.text,
                text: item.text  // Ensure both fields are available
            }));
            
            // Return special object to signal keyword review pause
            const pauseData = {
                isPause: true,
                transcript,
                keywordData,
                audioPath,
                thumbnailMemeUrl,
                keywords,
                database: options.database
            };
            
            Logger.info('🔍 Keywords extracted, returning pause data for user review...');
            
            // Return the pause data instead of throwing an error
            return pauseData;

            // Continue with the rest of the generation (this will be called after user reviews keywords)
            return this.continueDetailedGeneration(keywordData, audioPath, thumbnailMemeUrl, options);

        } catch (error) {
            Logger.error('❌ Video generation failed:', error);
            throw error;
        }
    }

    /**
     * Continue detailed generation after keyword review
     * @param {Array} keywordData - Reviewed keyword data
     * @param {string} audioPath - Path to audio file
     * @param {string} thumbnailMemeUrl - Optional thumbnail meme URL
     * @param {Object} options - Generation options
     * @returns {Promise<string>} - Path to generated video
     */
    async continueDetailedGeneration(keywordData, audioPath, thumbnailMemeUrl, options = {}) {
        try {
            // Step 5: Search for memes dynamically using Puppeteer
            Logger.info('🎭 Step 4/6: Searching for memes...');
            const keywords = keywordData.map(item => item.keyword);
            const memeResults = await this.puppeteerScraper.searchMemesForKeywords(keywords, options.database || 'apu');

            Logger.success(`🎭 Meme search completed! Found memes for ${memeResults.length} keywords`);
            
            // Validate array lengths match
            if (keywordData.length !== memeResults.length) {
                throw new Error(`Mismatch: ${keywordData.length} keywords but ${memeResults.length} meme results`);
            }
            
            // Combine keyword data with meme results using index-based mapping
            const matchedMemes = keywordData.map((item, index) => {
                // Use index-based mapping instead of keyword matching to ensure unique memes
                const memeResult = memeResults[index];
                if (!memeResult) {
                    throw new Error(`No meme found at index ${index} for keyword: ${item.keyword}`);
                }
                return {
                    ...item,
                    meme: {
                        url: memeResult.memeUrl,
                        keywords: [item.keyword]
                    }
                };
            });

            // ✅ CHECKPOINT PASSED: Meme collection successful! Now creating video...
            Logger.success(`🎭 Meme search completed! Found memes for ${matchedMemes.length} keywords`);
            Logger.info('📋 Collected memes summary:');
            matchedMemes.forEach((item, index) => {
                Logger.debug(`${index + 1}. "${item.keyword}" → ${item.meme.url.substring(0, 60)}...`);
            });

            // Step 4.5: Split long segments into multiple memes
            Logger.info('⏱️  Checking for long segments that need multiple memes...');
            const expandedMemes = await this.expandLongSegments(matchedMemes, options.database || 'apu');
            
            if (expandedMemes.length > matchedMemes.length) {
                Logger.info(`📈 Expanded ${matchedMemes.length} segments to ${expandedMemes.length} meme slots for better coverage`);
            }

            // Step 5: Render slides
            Logger.info('🖼️  Step 5/6: Rendering slides...');
            const slides = await this.slideRenderer.renderSlides(expandedMemes, thumbnailMemeUrl, options.database || 'apu');

            // Step 6: Create final video
            Logger.info('🎥 Step 6/6: Creating final video...');
            const outputPath = await this.videoRenderer.createVideo(slides, audioPath, options.database || 'apu');

            // Get video info
            const videoInfo = await this.videoRenderer.getVideoInfo(outputPath);
            
            Logger.success('🎉 Meme video generation completed!');
            Logger.success(`📁 Output: ${outputPath}`);
            Logger.success(`⏱️  Duration: ${Math.round(videoInfo.duration)}s`);
            Logger.success(`📊 Size: ${Math.round(videoInfo.size / 1024 / 1024)}MB`);

            return outputPath;

        } catch (error) {
            Logger.error('❌ Video generation continuation failed:', error);
            throw error;
        }
    }

    /**
     * Generate meme video from script text using ElevenLabs TTS
     * @param {string} scriptText - Script text to convert to speech
     * @param {Object} options - Generation options
     * @returns {Promise<string>} - Path to generated video
     */
    async generateVideoFromScript(scriptText, options = {}) {
        const {
            voiceId = 'voice1',
            musicSearch = 'ambient peaceful background music',
            photoSource = 'unsplash',
            soundSource = 'freesound',
            database = 'apu'
        } = options;

        Logger.info('🎬 Starting Script-to-Meme Video Generation');
        Logger.info(`Script length: ${scriptText.length} characters`);
        Logger.info(`Voice: ${voiceId}, Music search: "${musicSearch}", Photo source: ${photoSource}, Sound source: ${soundSource}, Database: ${database}`);

        try {
            // Step 1: Ensure we have memes database
            await this.ensureMemesDatabase();

            // Step 2: Generate speech from script
            Logger.info('🗣️ Step 1/7: Generating speech from script...');
            const speechPath = await this.elevenLabsService.generateSpeech(scriptText, voiceId);

            // Step 3: Download background music
            Logger.info('🎵 Step 2/7: Downloading background music...');
            const musicPath = await this.musicDownloadService.downloadMusicBySearchTerms(musicSearch);

            // Step 4: Transcribe the generated speech
            Logger.info('🎤 Step 3/7: Transcribing generated speech...');
            const transcript = await this.transcriptionService.transcribeAudioFile(speechPath);
            
            if (transcript.length === 0) {
                throw new Error('No transcript generated from speech - cannot proceed');
            }

            // Step 5: Extract keywords from transcript
            Logger.info('🔍 Step 4/7: Extracting keywords...');
            const keywordData = await this.keywordExtractor.extractKeywords(transcript);

            // Log the extracted lyrics for review
            Logger.success('📝 Speech transcription completed!');
            Logger.info('Transcribed speech segments:');
            transcript.forEach((segment, index) => {
                Logger.info(`  ${index + 1}. [${segment.start.toFixed(1)}s-${segment.end.toFixed(1)}s] "${segment.text}"`);
            });

            Logger.info('\nExtracted keywords:');
            keywordData.forEach((item, index) => {
                Logger.info(`  ${index + 1}. "${item.keyword}" from: "${item.text}"`);
            });

            // Step 6: Search for memes dynamically using Puppeteer
            Logger.info('🎭 Step 5/7: Searching for memes...');
            const keywords = keywordData.map(item => item.keyword);
            const memeResults = await this.puppeteerScraper.searchMemesForKeywords(keywords, database);

            Logger.success(`🎭 Meme search completed! Found memes for ${memeResults.length} keywords`);
            
            // Validate array lengths match
            if (keywordData.length !== memeResults.length) {
                throw new Error(`Mismatch: ${keywordData.length} keywords but ${memeResults.length} meme results`);
            }
            
            // Combine keyword data with meme results using index-based mapping
            const matchedMemes = keywordData.map((item, index) => {
                const memeResult = memeResults[index];
                if (!memeResult) {
                    throw new Error(`No meme found at index ${index} for keyword: ${item.keyword}`);
                }
                return {
                    ...item,
                    meme: {
                        url: memeResult.memeUrl,
                        keywords: [item.keyword]
                    }
                };
            });

            Logger.success(`🎭 Meme collection completed! Found memes for ${matchedMemes.length} keywords`);
            Logger.info('📋 Collected memes summary:');
            matchedMemes.forEach((item, index) => {
                Logger.debug(`${index + 1}. "${item.keyword}" → ${item.meme.url.substring(0, 60)}...`);
            });

            // Step 6.5: Split long segments into multiple memes
            Logger.info('⏱️  Checking for long segments that need multiple memes...');
            const expandedMemes = await this.expandLongSegments(matchedMemes, database);
            
            if (expandedMemes.length > matchedMemes.length) {
                Logger.info(`📈 Expanded ${matchedMemes.length} segments to ${expandedMemes.length} meme slots for better coverage`);
            }

            // Step 7: Render slides
            Logger.info('🖼️  Step 6/7: Rendering slides...');
            const slides = await this.slideRenderer.renderSlides(expandedMemes, null, database);

            // Step 8: Create final video with mixed audio (speech + background music)
            Logger.info('🎥 Step 7/7: Creating final video with mixed audio...');
            const outputPath = await this.videoRenderer.createVideoWithMixedAudio(slides, speechPath, musicPath, database);

            // Get video info
            const videoInfo = await this.videoRenderer.getVideoInfo(outputPath);
            
            Logger.success('🎉 Script-to-meme video generation completed!');
            Logger.success(`📁 Output: ${outputPath}`);
            Logger.success(`⏱️  Duration: ${Math.round(videoInfo.duration)}s`);
            Logger.success(`📊 Size: ${Math.round(videoInfo.size / 1024 / 1024)}MB`);

            return outputPath;

        } catch (error) {
            Logger.error('❌ Script video generation failed:', error);
            throw error;
        }
    }

    /**
     * Ensure memes database exists, create if needed
     */
    async ensureMemesDatabase() {
        try {
            const existingMemes = await this.puppeteerScraper.loadMemes();
            if (existingMemes.length > 0) {
                Logger.info(`📚 Found existing memes database: ${existingMemes.length} memes`);
                return;
            }
        } catch (error) {
            // File doesn't exist, need to create it
        }

        Logger.info('📥 Memes database not found, creating from default memes...');
        
        // Use default memes for now - in production you'd scrape from a real site
        const defaultMemes = this.puppeteerScraper.getDefaultMemes();
        await this.puppeteerScraper.saveMemes(defaultMemes);
        
        Logger.success(`📚 Created memes database with ${defaultMemes.length} default memes`);
    }

    /**
     * Scrape memes from configured website
     */
    async scrapeMemes() {
        Logger.info('🕷️  Starting meme scraping...');
        
        try {
            const memes = await this.puppeteerScraper.scrapeMemes();
            Logger.success(`✅ Scraped ${memes.length} memes successfully`);
            return memes;
        } catch (error) {
            Logger.error('❌ Meme scraping failed:', error);
            throw error;
        }
    }

    /**
     * Test the pipeline with a sample video
     */
    async test() {
        Logger.info('🧪 Running test pipeline...');
        
        const testUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'; // Rick Roll for testing
        
        try {
            const outputPath = await this.generateVideo(testUrl, {
                startTime: '00:30',
                endTime: '00:45',
                skipMemeGeneration: false
            });
            
            Logger.success('✅ Test completed successfully!');
            return outputPath;
            
        } catch (error) {
            Logger.error('❌ Test failed:', error);
            throw error;
        }
    }

    /**
     * Clean up all temporary files
     */
    async cleanup() {
        Logger.info('🧹 Cleaning up temporary files...');
        
        try {
            await Promise.all([
                this.slideRenderer.cleanup(),
                this.videoRenderer.cleanup(),
                this.musicDownloadService.cleanup(),
                this.cleanupGeneratedFiles()
            ]);
            
            Logger.success('✅ Cleanup completed');
        } catch (error) {
            Logger.warn('⚠️  Cleanup failed:', error.message);
        }
    }

    /**
     * Clean up generated speech and music files
     */
    async cleanupGeneratedFiles() {
        try {
            const mediaDir = path.join(__dirname, '../media');
            const fs = require('fs');
            
            if (fs.existsSync(mediaDir)) {
                // Clean up old generated files
                await this.elevenLabsService.cleanupOldSpeechFiles(mediaDir);
                await this.musicDownloadService.cleanupOldMusicFiles();
                Logger.info('🗑️ Generated files cleaned up');
            }
        } catch (error) {
            Logger.warn('⚠️ Failed to cleanup generated files:', error.message);
        }
    }

    /**
     * Expand long segments (>5s) into multiple sub-segments with different memes
     * @param {Array} matchedMemes - Array of matched meme objects with timing
     * @param {string} database - Database to search ('apu', 'bobo', 'other')
     * @returns {Array} - Expanded array with sub-segments for long durations
     */
    async expandLongSegments(matchedMemes, database = 'apu') {
        const expandedMemes = [];
        const maxSegmentDuration = 5.0; // 5 seconds max per meme
        const minSegmentDuration = 3.0; // 3 seconds minimum per meme

        for (const meme of matchedMemes) {
            const duration = meme.end - meme.start;
            
            if (duration <= maxSegmentDuration) {
                // Short segment - keep as is
                expandedMemes.push(meme);
                continue;
            }

            // Long segment - split into multiple sub-segments
            Logger.info(`📏 Splitting long segment "${meme.keyword}" (${duration.toFixed(1)}s) into multiple memes`);
            
            // Calculate optimal number of segments ensuring last segment is >= 3s
            let numSegments = Math.floor(duration / maxSegmentDuration);
            const remainder = duration - (numSegments * maxSegmentDuration);
            
            // If remainder is too short, extend the last segment instead of creating a new one
            if (remainder > 0 && remainder < minSegmentDuration) {
                // Keep numSegments as is - last segment will be extended
                Logger.debug(`  Last segment would be ${remainder.toFixed(1)}s, extending previous segment instead`);
            } else if (remainder >= minSegmentDuration) {
                // Remainder is long enough to be its own segment
                numSegments += 1;
            }
            
            Logger.debug(`  Creating ${numSegments} sub-segments with minimum ${minSegmentDuration}s duration`);

            // Get additional memes for this keyword
            const additionalMemes = await this.getAdditionalMemesForKeyword(meme.keyword, numSegments, database);
            
            // Create sub-segments
            for (let i = 0; i < numSegments; i++) {
                const segmentStart = meme.start + (i * maxSegmentDuration);
                let segmentEnd;
                
                if (i === numSegments - 1) {
                    // Last segment - extend to the actual end time
                    segmentEnd = meme.end;
                } else {
                    segmentEnd = meme.start + ((i + 1) * maxSegmentDuration);
                }
                
                const segmentDuration = segmentEnd - segmentStart;

                // Use different meme for each segment
                const memeUrl = additionalMemes[i] || meme.meme.url; // Fallback to original if not enough memes

                expandedMemes.push({
                    ...meme,
                    start: segmentStart,
                    end: segmentEnd,
                    meme: {
                        ...meme.meme,
                        url: memeUrl
                    },
                    segmentIndex: i + 1,
                    totalSegments: numSegments
                });

                Logger.debug(`  Segment ${i + 1}/${numSegments}: ${segmentStart.toFixed(1)}s-${segmentEnd.toFixed(1)}s (${segmentDuration.toFixed(1)}s)`);
            }
        }

        return expandedMemes;
    }

    /**
     * Get additional memes for a keyword to use in sub-segments
     * @param {string} keyword - The keyword to search for
     * @param {number} count - Number of memes needed
     * @param {string} database - Database to search ('apu', 'bobo', 'other')
     * @returns {Array} - Array of meme URLs
     */
    async getAdditionalMemesForKeyword(keyword, count, database = 'apu') {
        try {
            Logger.debug(`🔄 Getting ${count} additional memes for "${keyword}"`);
            
            // Create an array with the keyword repeated for the number of memes we need
            const keywords = Array(count).fill(keyword);
            
            // Search for multiple memes of the same keyword
            const memeResults = await this.puppeteerScraper.searchMemesForKeywords(keywords, database);
            
            // Extract just the URLs
            const urls = memeResults.map(result => result.memeUrl);
            
            Logger.debug(`✅ Found ${urls.length} additional memes for "${keyword}"`);
            return urls;
            
        } catch (error) {
            Logger.warn(`⚠️ Failed to get additional memes for "${keyword}": ${error.message}`);
            return []; // Return empty array, will fall back to original meme
        }
    }
}

// CLI Interface
async function main() {
    const args = process.argv.slice(2);
    const generator = new MemeVideoGenerator();

    // Handle different CLI commands
    if (args.length === 0) {
        console.log(`
🎬 Meme Sync - Meme Video Generator

Usage:
  node src/index.js <youtube_url> [start_time] [end_time]
  node src/index.js scrape-memes
  node src/index.js test
  node src/index.js cleanup

Examples:
  node src/index.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  node src/index.js "https://www.youtube.com/watch?v=dQw4w9WgXcQ" "00:30" "01:15"
  node src/index.js scrape-memes
  node src/index.js test

Environment Variables Required:
  OPENAI_API_KEY - OpenAI API key for keyword extraction
  LEMONFOX_API_KEY - LemonFox.ia API key for transcription (optional)
  MEME_SITE_URL - URL for meme scraping (optional)
        `);
        process.exit(0);
    }

    try {
        const command = args[0];

        switch (command) {
            case 'scrape-memes':
                await generator.scrapeMemes();
                break;

            case 'test':
                await generator.test();
                break;

            case 'cleanup':
                await generator.cleanup();
                break;

            default:
                // Assume it's a YouTube URL
                const youtubeUrl = command;
                const startTime = args[1] || null;
                const endTime = args[2] || null;

                const outputPath = await generator.generateVideo(youtubeUrl, {
                    startTime,
                    endTime
                });

                console.log(`\n🎉 Video generated successfully!`);
                console.log(`📁 Output: ${outputPath}\n`);
                break;
        }

    } catch (error) {
        Logger.error('❌ Command failed:', error);
        process.exit(1);
    }
}

// Export for programmatic use
module.exports = MemeVideoGenerator;

// Run CLI if called directly
if (require.main === module) {
    main();
} 