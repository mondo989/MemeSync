const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./utils/logger');

class SlideRenderer {
    constructor() {
        this.templatePath = path.join(__dirname, '../public/template.html');
        this.slidesDir = path.join(__dirname, '../slides');
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
        
        let browser;
        const maxRetries = 3;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                Logger.info(`Launching browser (attempt ${attempt}/${maxRetries})`);
                
                browser = await puppeteer.launch({
                    headless: 'new', // Back to headless for production
                    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    args: [
                        '--no-sandbox', 
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu'
                    ],
                    defaultViewport: {
                        width: 1920,
                        height: 1080
                    },
                    timeout: 10000
                });
                
                Logger.info('Browser launched successfully');
                break;
                
            } catch (error) {
                Logger.warn(`Browser launch attempt ${attempt} failed:`, error.message);
                if (attempt === maxRetries) {
                    throw new Error(`Failed to launch browser after ${maxRetries} attempts`);
                }
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s before retry
            }
        }

        try {
            const slides = [];
            
            // Render thumbnail slide if provided
            if (thumbnailMemeUrl) {
                const thumbnailSlide = await this.renderSingleSlide(
                    browser, 
                    thumbnailMemeUrl, 
                    'thumbnail_slide.png'
                );
                slides.push(thumbnailSlide);
            }
            
            // Render meme slides
            for (let i = 0; i < matchedMemes.length; i++) {
                const matchedMeme = matchedMemes[i];
                const filename = `slide_${i.toString().padStart(3, '0')}.png`;
                
                const slideData = await this.renderSingleSlide(
                    browser, 
                    matchedMeme.meme.url, 
                    filename
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
            try {
                await browser.close();
            } catch (closeError) {
                Logger.warn('Error closing browser:', closeError.message);
            }
        }
    }

    /**
     * Render a single slide (no animations)
     * @param {Browser} browser - Puppeteer browser instance
     * @param {string} memeUrl - URL of the meme image
     * @param {string} filename - Output filename
     * @returns {Object} - Slide data object
     */
    async renderSingleSlide(browser, memeUrl, filename) {
        const page = await browser.newPage();
        
        try {
            // Set viewport to 1920x1080 for HD output
            await page.setViewport({ width: 1920, height: 1080 });
            
            // Load template
            const templateUrl = `file://${this.templatePath}`;
            await page.goto(templateUrl, { waitUntil: 'networkidle2' });
            
            // Inject meme image
            await page.evaluate((memeUrl) => {
                const img = document.getElementById('meme-image');
                img.src = memeUrl;
            }, memeUrl);
            
            // Handle apu-logo overlay
            const logoPath = path.join(this.slidesDir, 'apu-logo.png');
            const isApuSlide = filename.includes('apu-slide') || memeUrl.includes('apu-slide.png');
            const shouldShowLogo = !isApuSlide && await this.fileExists(logoPath);
            
            if (shouldShowLogo) {
                await page.evaluate((logoPath) => {
                    const logoImg = document.getElementById('apu-logo');
                    logoImg.src = `file://${logoPath}`;
                    logoImg.classList.remove('hidden');
                }, logoPath);
                
                Logger.debug(`Added apu-logo overlay to slide: ${filename}`);
            } else {
                Logger.debug(`Skipping apu-logo overlay for: ${filename} (${isApuSlide ? 'apu-slide detected' : 'logo file not found'})`);
            }
            
            // Wait for images to load
            await page.waitForFunction(() => {
                const img = document.getElementById('meme-image');
                const logo = document.getElementById('apu-logo');
                const logoIsHidden = logo.classList.contains('hidden');
                
                const mainImageLoaded = img.complete && img.naturalHeight !== 0;
                const logoLoadedOrHidden = logoIsHidden || (logo.complete && logo.naturalHeight !== 0);
                
                return mainImageLoaded && logoLoadedOrHidden;
            }, { timeout: 10000 });
            
            // Small delay to ensure rendering is complete
            await page.waitForTimeout(500);
            
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
                memeUrl
            };
            
        } catch (error) {
            Logger.error(`Failed to render slide ${filename}:`, error);
            throw error;
        } finally {
            await page.close();
        }
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
     * Check if a file exists
     * @param {string} filepath - Path to check
     * @returns {boolean} - True if file exists
     */
    async fileExists(filepath) {
        try {
            await fs.access(filepath);
            return true;
        } catch {
            return false;
        }
    }
}

module.exports = SlideRenderer; 