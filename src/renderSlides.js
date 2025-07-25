const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./utils/logger');

class SlideRenderer {
    constructor() {
        this.templatePath = path.join(__dirname, '../public/template.html');
        this.slidesDir = path.join(__dirname, '../slides');
        this.animations = ['fade-in', 'zoom-in', 'slide-left', 'spin-in'];
        this.slideDuration = parseInt(process.env.SLIDE_ANIMATION_DURATION) || 3000;
    }

    /**
     * Initialize the renderer and create slides directory
     */
    async initialize() {
        try {
            await fs.mkdir(this.slidesDir, { recursive: true });
            Logger.info('Slide renderer initialized');
        } catch (error) {
            Logger.error('Failed to initialize slide renderer:', error);
            throw error;
        }
    }

    /**
     * Render all slides for the matched memes
     * @param {Array} matchedMemes - Array of {start, end, text, keyword, meme} objects
     * @param {string} thumbnailMemeUrl - Optional thumbnail meme URL for intro slide
     * @returns {Array} - Array of slide file paths
     */
    async renderSlides(matchedMemes, thumbnailMemeUrl = null) {
        await this.initialize();
        
        Logger.info(`Rendering ${matchedMemes.length} slides...`);
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const slides = [];
            
            // Render thumbnail slide if provided
            if (thumbnailMemeUrl) {
                const thumbnailSlide = await this.renderSingleSlide(
                    browser, 
                    thumbnailMemeUrl, 
                    'thumbnail_slide.png',
                    'fade-in',
                    5000 // 5 second duration for intro
                );
                slides.push(thumbnailSlide);
            }
            
            // Render meme slides
            for (let i = 0; i < matchedMemes.length; i++) {
                const matchedMeme = matchedMemes[i];
                const animation = this.getRandomAnimation();
                const filename = `slide_${i.toString().padStart(3, '0')}.png`;
                
                const slideData = await this.renderSingleSlide(
                    browser, 
                    matchedMeme.meme.url, 
                    filename,
                    animation,
                    this.calculateSlideDuration(matchedMeme)
                );
                
                slides.push({
                    ...slideData,
                    startTime: matchedMeme.start,
                    endTime: matchedMeme.end,
                    keyword: matchedMeme.keyword,
                    text: matchedMeme.text
                });
            }
            
            Logger.success(`Successfully rendered ${slides.length} slides`);
            return slides;
            
        } catch (error) {
            Logger.error('Failed to render slides:', error);
            throw error;
        } finally {
            await browser.close();
        }
    }

    /**
     * Render a single slide with animation
     * @param {Browser} browser - Puppeteer browser instance
     * @param {string} memeUrl - URL of the meme image
     * @param {string} filename - Output filename
     * @param {string} animation - CSS animation class
     * @param {number} duration - Animation duration in ms
     * @returns {Object} - Slide data object
     */
    async renderSingleSlide(browser, memeUrl, filename, animation, duration) {
        const page = await browser.newPage();
        
        try {
            // Set viewport to 1920x1080 for HD output
            await page.setViewport({ width: 1920, height: 1080 });
            
            // Load template
            const templateUrl = `file://${this.templatePath}`;
            await page.goto(templateUrl, { waitUntil: 'networkidle2' });
            
            // Inject meme image and animation
            await page.evaluate((memeUrl, animation) => {
                const img = document.getElementById('meme-image');
                img.src = memeUrl;
                img.className = `meme-image ${animation}`;
            }, memeUrl, animation);
            
            // Wait for image to load
            await page.waitForFunction(() => {
                const img = document.getElementById('meme-image');
                return img.complete && img.naturalHeight !== 0;
            }, { timeout: 10000 });
            
            // Wait for animation to play
            await page.waitForTimeout(duration);
            
            // Capture screenshot
            const outputPath = path.join(this.slidesDir, filename);
            await page.screenshot({
                path: outputPath,
                type: 'png',
                fullPage: false
            });
            
            Logger.debug(`Rendered slide: ${filename}`);
            
            return {
                filename,
                path: outputPath,
                memeUrl,
                animation,
                duration
            };
            
        } catch (error) {
            Logger.error(`Failed to render slide ${filename}:`, error);
            throw error;
        } finally {
            await page.close();
        }
    }

    /**
     * Calculate slide duration based on lyric timing
     * @param {Object} matchedMeme - Matched meme object with timing info
     * @returns {number} - Duration in milliseconds
     */
    calculateSlideDuration(matchedMeme) {
        if (matchedMeme.start !== undefined && matchedMeme.end !== undefined) {
            const lyricDuration = (matchedMeme.end - matchedMeme.start) * 1000;
            // Use lyric duration but cap at max slide duration
            return Math.min(lyricDuration, this.slideDuration);
        }
        
        return this.slideDuration;
    }

    /**
     * Get a random animation class
     * @returns {string} - Animation CSS class name
     */
    getRandomAnimation() {
        return this.animations[Math.floor(Math.random() * this.animations.length)];
    }

    /**
     * Clean up slides directory
     */
    async cleanup() {
        try {
            const files = await fs.readdir(this.slidesDir);
            await Promise.all(
                files.map(file => fs.unlink(path.join(this.slidesDir, file)))
            );
            Logger.info('Slides directory cleaned up');
        } catch (error) {
            Logger.warn('Failed to cleanup slides directory:', error.message);
        }
    }

    /**
     * Render slides as video frames for smoother animation
     * @param {Array} matchedMemes - Array of matched meme objects
     * @param {number} fps - Frames per second
     * @returns {Array} - Array of frame file paths
     */
    async renderAnimatedFrames(matchedMemes, fps = 30) {
        await this.initialize();
        
        Logger.info(`Rendering animated frames at ${fps} FPS...`);
        
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        try {
            const frames = [];
            
            for (let i = 0; i < matchedMemes.length; i++) {
                const matchedMeme = matchedMemes[i];
                const animation = this.getRandomAnimation();
                const slideDuration = this.calculateSlideDuration(matchedMeme);
                const frameCount = Math.ceil((slideDuration / 1000) * fps);
                
                const slideFrames = await this.renderSlideFrames(
                    browser,
                    matchedMeme.meme.url,
                    animation,
                    frameCount,
                    i
                );
                
                frames.push(...slideFrames);
            }
            
            Logger.success(`Rendered ${frames.length} animation frames`);
            return frames;
            
        } catch (error) {
            Logger.error('Failed to render animated frames:', error);
            throw error;
        } finally {
            await browser.close();
        }
    }

    /**
     * Render multiple frames for a single slide animation
     * @param {Browser} browser - Puppeteer browser instance
     * @param {string} memeUrl - Meme image URL
     * @param {string} animation - Animation class
     * @param {number} frameCount - Number of frames to render
     * @param {number} slideIndex - Index of the slide
     * @returns {Array} - Array of frame file paths
     */
    async renderSlideFrames(browser, memeUrl, animation, frameCount, slideIndex) {
        const page = await browser.newPage();
        const frames = [];
        
        try {
            await page.setViewport({ width: 1920, height: 1080 });
            
            const templateUrl = `file://${this.templatePath}`;
            await page.goto(templateUrl, { waitUntil: 'networkidle2' });
            
            // Setup the slide
            await page.evaluate((memeUrl, animation) => {
                const img = document.getElementById('meme-image');
                img.src = memeUrl;
                img.className = `meme-image ${animation}`;
            }, memeUrl, animation);
            
            await page.waitForFunction(() => {
                const img = document.getElementById('meme-image');
                return img.complete && img.naturalHeight !== 0;
            }, { timeout: 10000 });
            
            // Capture frames throughout the animation
            for (let frame = 0; frame < frameCount; frame++) {
                const filename = `slide_${slideIndex.toString().padStart(3, '0')}_frame_${frame.toString().padStart(3, '0')}.png`;
                const outputPath = path.join(this.slidesDir, filename);
                
                await page.screenshot({
                    path: outputPath,
                    type: 'png',
                    fullPage: false
                });
                
                frames.push({
                    filename,
                    path: outputPath,
                    slideIndex,
                    frameIndex: frame
                });
                
                // Wait between frames
                await page.waitForTimeout(1000 / 30); // 30 FPS timing
            }
            
        } finally {
            await page.close();
        }
        
        return frames;
    }
}

module.exports = SlideRenderer; 