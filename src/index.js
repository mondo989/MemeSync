#!/usr/bin/env node

require('dotenv').config();
const Logger = require('./utils/logger');
const TranscriptionService = require('./transcriptionService');
const KeywordExtractor = require('./keywordExtractor');
const MemesMatcher = require('./matchMemes');
const SlideRenderer = require('./renderSlides');
const VideoRenderer = require('./renderVideo');
const PuppeteerScraper = require('./puppeteerScraper');

class MemeVideoGenerator {
    constructor() {
        this.transcriptionService = new TranscriptionService();
        this.keywordExtractor = new KeywordExtractor();
        this.memesMatcher = new MemesMatcher();
        this.slideRenderer = new SlideRenderer();
        this.videoRenderer = new VideoRenderer();
        this.puppeteerScraper = new PuppeteerScraper();
    }

    /**
     * Generate meme video from YouTube URL
     * @param {string} youtubeUrl - YouTube video URL
     * @param {Object} options - Generation options
     * @returns {Promise<string>} - Path to generated video
     */
    async generateVideo(youtubeUrl, options = {}) {
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
                this.videoRenderer.cleanup()
            ]);
            
            Logger.success('✅ Cleanup completed');
        } catch (error) {
            Logger.warn('⚠️  Cleanup failed:', error.message);
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