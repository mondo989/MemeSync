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
     * @param {string} database - Database type ('apu', 'bobo', 'other') for styling
     * @returns {Array} - Array of slide file paths
     */
    async renderSlides(matchedMemes, thumbnailMemeUrl = null, database = 'apu') {
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
                    'thumbnail_slide.png',
                    database
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
                    filename,
                    database
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
     * @param {string} database - Database type ('apu', 'bobo', 'other') for styling
     * @returns {Object} - Slide data object
     */
    async renderSingleSlide(browser, memeUrl, filename, database = 'apu') {
        const page = await browser.newPage();
        
        try {
            // Set viewport to 1920x1080 for HD output
            await page.setViewport({ width: 1920, height: 1080 });
            
            // Load template
            const templateUrl = `file://${this.templatePath}`;
            await page.goto(templateUrl, { waitUntil: 'networkidle2' });
            
            // Inject database-specific background color
            await page.evaluate((database) => {
                let backgroundColor;
                switch (database.toLowerCase()) {
                    case 'apu':
                        // Keep existing Apu gradient
                        backgroundColor = 'radial-gradient(64.01% 64.01% at 50% 50%, rgba(93, 143, 54, 0.9) 0%, rgba(0, 0, 0, 0.5) 83.17%), #000000';
                        break;
                    case 'bobo':
                        backgroundColor = '#be0129';
                        break;
                    case 'other':
                        backgroundColor = '#000000';
                        break;
                    default:
                        backgroundColor = 'radial-gradient(64.01% 64.01% at 50% 50%, rgba(93, 143, 54, 0.9) 0%, rgba(0, 0, 0, 0.5) 83.17%), #000000';
                }
                document.body.style.background = backgroundColor;
            }, database);
            
            // Inject meme image
            await page.evaluate((memeUrl) => {
                const img = document.getElementById('meme-image');
                img.src = memeUrl;
            }, memeUrl);
            
            // Handle database-specific logo overlay (original logic but database-aware)
            let logoPath, slideName;
            
            if (database.toLowerCase() === 'bobo') {
                logoPath = path.join(this.slidesDir, 'bobo-logo.png');
                slideName = 'bobo-slide';
            } else { // default to 'apu' (including 'other')
                logoPath = path.join(this.slidesDir, 'apu-logo.svg');
                slideName = 'apu-slide';
            }
            
            const isSpecialSlide = filename.includes(slideName) || memeUrl.includes(`${slideName}.png`);
            const shouldShowLogo = !isSpecialSlide && await this.fileExists(logoPath);
            
            if (shouldShowLogo) {
                await page.evaluate((logoPath) => {
                    const logoImg = document.getElementById('apu-logo');
                    logoImg.src = `file://${logoPath}`;
                    logoImg.classList.remove('hidden');
                }, logoPath);
                
                Logger.debug(`Added ${database} logo overlay to slide: ${filename}`);
            } else {
                Logger.debug(`Skipping ${database} logo overlay for: ${filename} (${isSpecialSlide ? `${slideName} detected` : 'logo file not found'})`);
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