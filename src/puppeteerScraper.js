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

        Logger.info(`🎭 Starting optimized meme search for ${keywords.length} keywords`);
        Logger.debug(`Meme site URL: ${this.memesSiteUrl}`);
        Logger.info('💡 Using single browser instance with page reuse for efficiency');
        
        let browser = null;
        Logger.info('🚀 Launching Puppeteer browser...');
        
        // Try multiple launch configurations for macOS stability and port conflicts
        const launchConfigs = [
            // Use system Chrome (most stable) with random port to avoid conflicts
            {
                headless: 'new',
                executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--remote-debugging-port=0' // Use random available port
                ],
                timeout: 10000
            },
            // Fallback to Puppeteer's Chrome with random port
            {
                headless: 'new',
                args: [
                    '--no-sandbox', 
                    '--disable-setuid-sandbox',
                    '--remote-debugging-port=0'
                ],
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
            
            // Store initial page state to return to if needed
            const initialUrl = page.url();
            
            // Process each keyword one by one using the same page instance
            for (let i = 0; i < keywords.length; i++) {
                const keyword = keywords[i];
                Logger.info(`🔎 [${i + 1}/${keywords.length}] Searching: "${keyword}"`);
                
                try {
                    // Ensure we're on the right page (in case of redirects or errors)
                    const currentUrl = page.url();
                    if (!currentUrl.includes(this.memesSiteUrl.split('/')[2])) {
                        Logger.debug('🔄 Returning to main search page...');
                        await page.goto(this.memesSiteUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
                        await page.waitForTimeout(500); // Brief wait for page to stabilize
                    }
                    
                    const memeUrl = await this.searchSingleKeyword(page, keyword);
                    results.push({
                        keyword: keyword,
                        memeUrl: memeUrl
                    });
                    Logger.success(`✅ Found meme for "${keyword}": ${memeUrl.substring(0, 60)}...`);
                    
                    // Rate limiting delay between searches (reduced since we're more efficient now)
                    if (i < keywords.length - 1) {
                        Logger.debug(`⏱️  Brief pause before next search...`);
                        await page.waitForTimeout(500);
                    }
                    
                } catch (error) {
                    Logger.error(`❌ Failed to search for "${keyword}": ${error.message}`);
                    Logger.debug('Error details:', error.stack);
                    
                    // Try to recover by returning to the main page
                    try {
                        Logger.debug('🔧 Attempting recovery by returning to main page...');
                        await page.goto(this.memesSiteUrl, { waitUntil: 'domcontentloaded', timeout: 5000 });
                        await page.waitForTimeout(1000);
                    } catch (recoveryError) {
                        Logger.warn('Recovery attempt failed:', recoveryError.message);
                    }
                    
                    throw new Error(`Meme search failed for keyword "${keyword}": ${error.message}`);
                }
            }
            
            Logger.success(`🎉 Optimized meme search completed! Found ${results.length} memes using single browser instance`);
            Logger.info(`⚡ Efficiency gains: Reused page instance for all ${keywords.length} searches`);
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
            
            // Efficiently clear and fill the search input
            Logger.debug('🎯 Locating search input...');
            const searchInput = await page.waitForSelector('input.search-input', { timeout: 5000 });
            Logger.debug('✅ Search input found');
            
            // More efficient input clearing and typing
            await searchInput.focus();
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA'); // Select all
            await page.keyboard.up('Control');
            await page.keyboard.type(keyword);
            Logger.debug(`✅ Efficiently typed keyword: "${keyword}"`);
            
            // Submit search with improved error handling
            Logger.debug('📤 Submitting search...');
            try {
                await Promise.race([
                    page.keyboard.press('Enter'),
                    page.click('button[type="submit"], .search-button, .search-btn').catch(() => {
                        Logger.debug('Search button not found, using Enter key');
                    })
                ]);
            } catch (submitError) {
                Logger.debug('Search submission fallback triggered');
                await page.keyboard.press('Enter');
            }
            
            // Wait for results with improved detection
            Logger.debug('⏱️  Waiting for search results to load...');
            try {
                // Wait for either the masonry grid or a "no results" indicator
                await Promise.race([
                    page.waitForSelector('.my-masonry-grid .image', { timeout: 3000 }),
                    page.waitForSelector('.no-results, .empty-results', { timeout: 3000 }).catch(() => {})
                ]);
            } catch (waitError) {
                Logger.debug('Using fallback wait time for results');
                await page.waitForTimeout(2000);
            }
            
            // Extract meme URLs from the masonry grid with enhanced selectors
            Logger.debug('🖼️  Extracting meme URLs from search results...');
            const memeUrls = await page.evaluate(() => {
                // Try multiple possible selectors for different site layouts
                const selectors = [
                    '.my-masonry-grid .image img',
                    '.masonry-grid img',
                    '.search-results img',
                    '.meme-grid img',
                    '.image-container img',
                    'img[src*="meme"]'
                ];
                
                const urls = [];
                
                for (const selector of selectors) {
                    const images = document.querySelectorAll(selector);
                    if (images.length > 0) {
                        images.forEach(img => {
                            if (img.src && img.src.startsWith('http') && img.src.includes('meme')) {
                                urls.push(img.src);
                            }
                        });
                        break; // Stop after finding images with the first working selector
                    }
                }
                
                // Fallback: try any image in the results area
                if (urls.length === 0) {
                    const allImages = document.querySelectorAll('img');
                    allImages.forEach(img => {
                        if (img.src && img.src.startsWith('http') && 
                            (img.src.includes('meme') || img.alt?.toLowerCase().includes('meme'))) {
                            urls.push(img.src);
                        }
                    });
                }
                
                return [...new Set(urls)]; // Remove duplicates
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