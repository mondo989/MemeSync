const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./utils/logger');

class PuppeteerScraper {
    constructor() {
        this.memesSiteUrl = process.env.MEME_SITE_URL;
        this.outputFile = path.join(__dirname, '../memes.json');
    }

    /**
     * Search for memes dynamically based on keywords from lyrics
     * @param {Array} keywords - Array of keyword strings to search for
     * @returns {Array} - Array of {keyword, memeUrl} objects
     */
    async searchMemesForKeywords(keywords) {
        if (!this.memesSiteUrl) {
            Logger.error('MEME_SITE_URL not configured in environment variables');
            throw new Error('MEME_SITE_URL required');
        }

        Logger.info(`🎭 Starting dynamic meme search for ${keywords.length} keywords`);
        Logger.debug(`Meme site URL: ${this.memesSiteUrl}`);
        
        let browser = null;
        Logger.info('🚀 Launching Puppeteer browser...');
        
        // Try multiple launch configurations for macOS stability
        const launchConfigs = [
            // Use system Chrome (most stable)
            {
                headless: 'new', // Back to headless for production
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu'
                ],
                timeout: 10000
            },
            // Fallback to Puppeteer's Chrome
            {
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                timeout: 10000
            }
        ];

        let lastError = null;
        for (let i = 0; i < launchConfigs.length; i++) {
            try {
                Logger.info(`🔄 Trying browser config ${i + 1}/${launchConfigs.length}...`);
                browser = await puppeteer.launch(launchConfigs[i]);
                Logger.success('✅ Browser launched successfully');
                break;
            } catch (configError) {
                lastError = configError;
                Logger.warn(`⚠️ Config ${i + 1} failed: ${configError.message}`);
                if (browser) {
                    try { await browser.close(); } catch {}
                    browser = null;
                }
            }
        }

        if (!browser) {
            Logger.error('❌ All browser launch configurations failed');
            throw new Error(`Browser launch failed: ${lastError?.message || 'Unknown error'}`);
        }

        const results = [];

        try {
            Logger.debug('🔧 Creating new browser page...');
            const page = await browser.newPage();
            
            // Enhanced page setup with error handling
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1280, height: 720 });
            
            // Add page error listeners
            page.on('error', (error) => {
                Logger.error('❌ Page error:', error.message);
            });
            
            page.on('pageerror', (error) => {
                Logger.warn('⚠️  Page JS error:', error.message);
            });
            
            // Give browser time to fully initialize
            await page.waitForTimeout(1000);
            
            // Navigate to memes site with retry logic
            Logger.info(`🌐 Navigating to: ${this.memesSiteUrl}`);
            let navigationSuccess = false;
            const maxRetries = 3;
            
            for (let retry = 1; retry <= maxRetries; retry++) {
                try {
                    Logger.debug(`📡 Navigation attempt ${retry}/${maxRetries}...`);
                    await page.goto(this.memesSiteUrl, { 
                        waitUntil: 'domcontentloaded', // Less strict than networkidle2
                        timeout: 10000 
                    });
                    navigationSuccess = true;
                    Logger.success('✅ Page loaded successfully');
                    break;
                } catch (navError) {
                    Logger.warn(`⚠️ Navigation attempt ${retry} failed: ${navError.message}`);
                    if (retry < maxRetries) {
                        Logger.debug('⏳ Waiting 1 second before retry...');
                        await page.waitForTimeout(1000);
                    }
                }
            }
            
            if (!navigationSuccess) {
                throw new Error('Failed to navigate to memes site after multiple retries');
            }
            
            Logger.info(`🔍 Starting search for ${keywords.length} keywords...`);
            
            // Process each keyword one by one to avoid rate limiting
            for (let i = 0; i < keywords.length; i++) {
                const keyword = keywords[i];
                Logger.info(`🔎 [${i + 1}/${keywords.length}] Searching: "${keyword}"`);
                
                try {
                    const memeUrl = await this.searchSingleKeyword(page, keyword);
                    results.push({
                        keyword: keyword,
                        memeUrl: memeUrl
                    });
                    Logger.success(`✅ Found meme for "${keyword}": ${memeUrl.substring(0, 60)}...`);
                    
                    // Rate limiting delay between searches
                    if (i < keywords.length - 1) {
                        Logger.debug(`⏱️  Waiting 2 seconds before next search...`);
                        await page.waitForTimeout(2000);
                    }
                    
                } catch (error) {
                    Logger.error(`❌ Failed to search for "${keyword}": ${error.message}`);
                    Logger.debug('Error details:', error.stack);
                    throw new Error(`Meme search failed for keyword "${keyword}": ${error.message}`);
                }
            }
            
            Logger.success(`🎉 Completed meme search! Found ${results.length} memes`);
            return results;
            
        } catch (error) {
            Logger.error('❌ Critical error during meme search:', error.message);
            Logger.debug('Error details:', error.stack);
            throw error;
            
        } finally {
            if (browser) {
                try {
                    Logger.debug('🔒 Closing browser...');
                    await browser.close();
                    Logger.debug('✅ Browser closed successfully');
                } catch (closeError) {
                    Logger.warn('⚠️  Error closing browser:', closeError.message);
                }
            }
        }
    }

    /**
     * Search for a single keyword and return a random meme URL
     * @param {Page} page - Puppeteer page object
     * @param {string} keyword - Keyword to search for
     * @returns {string} - Meme image URL
     */
    async searchSingleKeyword(page, keyword) {
        try {
            Logger.debug(`🔍 Searching single keyword: "${keyword}"`);
            
            // Clear and fill the search input
            Logger.debug('🎯 Looking for search input...');
            const searchInput = await page.waitForSelector('input.search-input', { timeout: 5000 });
            Logger.debug('✅ Search input found');
            
            await searchInput.click({ clickCount: 3 }); // Select all text
            await searchInput.type(keyword);
            Logger.debug(`✅ Typed keyword: "${keyword}"`);
            
            // Submit search (either press Enter or look for search button)
            Logger.debug('📤 Submitting search...');
            await Promise.race([
                searchInput.press('Enter'),
                page.click('button[type="submit"], .search-button, .search-btn').catch(() => {})
            ]);
            
            // Wait for results to load
            Logger.debug('⏱️  Waiting for search results...');
            await page.waitForTimeout(2000);
            
            // Extract meme URLs from the masonry grid
            Logger.debug('🖼️  Extracting meme URLs from results...');
            const memeUrls = await page.evaluate(() => {
                const imageContainers = document.querySelectorAll('.my-masonry-grid .image');
                const urls = [];
                
                imageContainers.forEach(container => {
                    const img = container.querySelector('img');
                    if (img && img.src && img.src.startsWith('http')) {
                        urls.push(img.src);
                    }
                });
                
                return urls;
            });
            
            Logger.debug(`📊 Found ${memeUrls.length} meme images for "${keyword}"`);
            
            if (memeUrls.length === 0) {
                throw new Error(`No memes found for keyword: "${keyword}"`);
            }
            
            // Randomly select one meme URL
            const randomIndex = Math.floor(Math.random() * memeUrls.length);
            const selectedUrl = memeUrls[randomIndex];
            
            Logger.debug(`🎲 Random selection: ${randomIndex + 1}/${memeUrls.length} - ${selectedUrl.substring(0, 50)}...`);
            return selectedUrl;
            
        } catch (error) {
            Logger.error(`❌ Error searching for "${keyword}": ${error.message}`);
            Logger.debug('Detailed error:', error.stack);
            throw error;
        }
    }

    /**
     * Legacy method - Scrape memes from the configured website and build memes.json
     * @returns {Array} - Array of meme objects with keywords and URLs
     */
    async scrapeMemes() {
        if (!this.memesSiteUrl) {
            Logger.error('MEME_SITE_URL not configured in environment variables');
            throw new Error('MEME_SITE_URL required');
        }

        Logger.info(`Starting meme scraping from: ${this.memesSiteUrl}`);
        
        const browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage'
            ]
        });

        try {
            const page = await browser.newPage();
            
            // Set user agent to avoid bot detection
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Navigate to memes site
            await page.goto(this.memesSiteUrl, { waitUntil: 'networkidle2' });
            
            Logger.info('Page loaded, extracting meme data...');
            
            // Generic meme extraction - this will need to be customized based on the actual meme site
            const memes = await this.extractMemesFromPage(page);
            
            // Save to memes.json
            await this.saveMemes(memes);
            
            Logger.success(`Successfully scraped ${memes.length} memes`);
            return memes;
            
        } catch (error) {
            Logger.error('Failed to scrape memes:', error);
            throw error;
        } finally {
            await browser.close();
        }
    }

    /**
     * Extract meme data from the current page
     * This is a generic implementation that should be customized for specific meme sites
     * @param {Page} page - Puppeteer page object
     * @returns {Array} - Array of meme objects
     */
    async extractMemesFromPage(page) {
        // Generic extraction - customize this based on the actual meme site structure
        const memes = await page.evaluate(() => {
            const results = [];
            
            // Try to find images with alt text, titles, or surrounding text
            const images = document.querySelectorAll('img');
            
            images.forEach(img => {
                const src = img.src;
                if (!src || !src.startsWith('http')) return;
                
                // Extract keywords from alt text, title, or surrounding text
                const keywords = [];
                
                // From alt text
                if (img.alt) {
                    keywords.push(...img.alt.toLowerCase().split(/\s+/).filter(word => word.length > 2));
                }
                
                // From title
                if (img.title) {
                    keywords.push(...img.title.toLowerCase().split(/\s+/).filter(word => word.length > 2));
                }
                
                // From parent element text
                const parent = img.parentElement;
                if (parent && parent.textContent) {
                    const text = parent.textContent.toLowerCase();
                    keywords.push(...text.split(/\s+/).filter(word => word.length > 2));
                }
                
                // From data attributes that might contain keywords
                if (img.dataset.tags) {
                    keywords.push(...img.dataset.tags.toLowerCase().split(/[,\s]+/));
                }
                
                // Clean and deduplicate keywords
                const cleanKeywords = [...new Set(keywords)]
                    .filter(keyword => keyword && keyword.match(/^[a-z]+$/))
                    .slice(0, 10); // Limit to 10 keywords per meme
                
                if (cleanKeywords.length > 0) {
                    results.push({
                        keywords: cleanKeywords,
                        url: src
                    });
                }
            });
            
            return results;
        });
        
        Logger.info(`Extracted ${memes.length} memes from page`);
        return memes;
    }

    /**
     * Load additional memes from multiple pages if supported
     * @param {Page} page - Puppeteer page object
     * @returns {Array} - Combined memes from all pages
     */
    async scrapeMultiplePages(page) {
        const allMemes = [];
        let currentPage = 1;
        const maxPages = 5; // Limit scraping to prevent overload
        
        while (currentPage <= maxPages) {
            Logger.info(`Scraping page ${currentPage}...`);
            
            try {
                // Wait for content to load
                await page.waitForTimeout(2000);
                
                // Extract memes from current page
                const pageMemes = await this.extractMemesFromPage(page);
                allMemes.push(...pageMemes);
                
                // Try to find and click next page button
                const nextButton = await page.$('a[href*="page"], .next, .pagination-next, [class*="next"]');
                if (!nextButton) {
                    Logger.info('No more pages found');
                    break;
                }
                
                await nextButton.click();
                await page.waitForTimeout(3000);
                currentPage++;
                
            } catch (error) {
                Logger.warn(`Failed to load page ${currentPage}:`, error.message);
                break;
            }
        }
        
        return allMemes;
    }

    /**
     * Save memes to JSON file
     * @param {Array} memes - Array of meme objects
     */
    async saveMemes(memes) {
        try {
            const jsonData = JSON.stringify(memes, null, 2);
            await fs.writeFile(this.outputFile, jsonData, 'utf8');
            Logger.success(`Memes saved to ${this.outputFile}`);
        } catch (error) {
            Logger.error('Failed to save memes:', error);
            throw error;
        }
    }

    /**
     * Load existing memes from JSON file
     * @returns {Array} - Array of meme objects
     */
    async loadMemes() {
        try {
            const data = await fs.readFile(this.outputFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            Logger.warn('No existing memes.json found or failed to load');
            return [];
        }
    }


}

// CLI interface for standalone scraping
if (require.main === module) {
    require('dotenv').config();
    
    const scraper = new PuppeteerScraper();
    scraper.scrapeMemes()
        .then(() => {
            Logger.success('Scraping completed successfully');
            process.exit(0);
        })
        .catch(error => {
            Logger.error('Scraping failed:', error);
            process.exit(1);
        });
}

module.exports = PuppeteerScraper; 