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

        Logger.info(`🎭 Starting isolated meme search for ${keywords.length} keywords`);
        Logger.debug(`Meme site URL: ${this.memesSiteUrl}`);
        Logger.info('🔄 Using separate browser instances for complete isolation between searches');
        
        const results = [];
        const selectedUrls = []; // Track selected URLs to avoid duplicates

        // Process each keyword with its own browser instance for complete isolation
        for (let i = 0; i < keywords.length; i++) {
            const keyword = keywords[i];
            Logger.info(`🔎 [${i + 1}/${keywords.length}] Searching: "${keyword}"`);
            
            try {
                // Search for a unique meme URL with retry logic to avoid duplicates
                let memeUrl;
                let retryCount = 0;
                const maxRetries = 5; // Prevent infinite loops
                
                do {
                    memeUrl = await this.searchSingleKeywordIsolated(keyword, selectedUrls);
                    retryCount++;
                    
                    if (selectedUrls.includes(memeUrl)) {
                        Logger.debug(`🔄 Duplicate URL found for "${keyword}" (attempt ${retryCount}/${maxRetries}), retrying...`);
                        if (retryCount >= maxRetries) {
                            Logger.warn(`⚠️ Max retries reached for "${keyword}", accepting duplicate URL`);
                            break;
                        }
                    }
                } while (selectedUrls.includes(memeUrl) && retryCount < maxRetries);
                
                // Add to selected URLs array and results
                selectedUrls.push(memeUrl);
                results.push({
                    keyword: keyword,
                    memeUrl: memeUrl
                });
                
                Logger.success(`✅ Found unique meme for "${keyword}": ${memeUrl}`);
                if (retryCount > 1) {
                    Logger.info(`🎯 Required ${retryCount} attempts to find unique meme`);
                }
                
                // Brief pause between searches to avoid overwhelming the server
                if (i < keywords.length - 1) {
                    Logger.debug(`⏱️  Brief pause before next search...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                Logger.error(`❌ Failed to search for "${keyword}": ${error.message}`);
                Logger.debug('Error details:', error.stack);
                throw new Error(`Meme search failed for keyword "${keyword}": ${error.message}`);
            }
        }
        
        Logger.success(`🎉 Isolated meme search completed! Found ${results.length} memes using separate browser instances`);
        Logger.info(`🔒 Duplicate prevention: ${selectedUrls.length} unique URLs selected`);
        return results;
    }

    /**
     * Search for a single keyword using an isolated browser instance
     * @param {string} keyword - Keyword to search for
     * @param {Array} selectedUrls - Array of already selected URLs to avoid duplicates
     * @returns {string} - Meme image URL
     */
    async searchSingleKeywordIsolated(keyword, selectedUrls = []) {
        let browser = null;
        
        try {
            Logger.debug(`🚀 Launching isolated browser for "${keyword}"...`);
            
            // Try multiple launch configurations for stability
            const launchConfigs = [
                {
                    headless: 'new',
                    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-gpu',
                        '--disable-web-security',
                        '--remote-debugging-port=0'
                    ],
                    timeout: 10000
                },
                {
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--remote-debugging-port=0'],
                    timeout: 10000
                }
            ];

            let lastError = null;
            for (const config of launchConfigs) {
                try {
                    browser = await puppeteer.launch(config);
                    break;
                } catch (configError) {
                    lastError = configError;
                    if (browser) {
                        try { await browser.close(); } catch {}
                        browser = null;
                    }
                }
            }

            if (!browser) {
                throw new Error(`Browser launch failed: ${lastError?.message || 'Unknown error'}`);
            }

            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1280, height: 720 });

            // Navigate to memes site
            await page.goto(this.memesSiteUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            
            // Perform the search using the existing logic
            return await this.searchSingleKeyword(page, keyword, selectedUrls);
            
        } finally {
            if (browser) {
                try {
                    await browser.close();
                    Logger.debug(`🔒 Closed isolated browser for "${keyword}"`);
                } catch (closeError) {
                    Logger.warn(`⚠️ Error closing browser for "${keyword}":`, closeError.message);
                }
            }
        }
    }

    /**
     * Search for a single keyword and return a random meme URL
     * @param {Page} page - Puppeteer page object
     * @param {string} keyword - Keyword to search for
     * @param {Array} selectedUrls - Array of already selected URLs to avoid duplicates
     * @returns {string} - Meme image URL
     */
    async searchSingleKeyword(page, keyword, selectedUrls = []) {
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
            
            // Brief wait after search submission for page to start loading
            Logger.debug('⏳ Brief wait for search to initiate...');
            await page.waitForTimeout(1500);
            
            // Wait for results with improved detection and longer timeout
            Logger.debug('⏱️  Waiting for search results to load...');
            try {
                // Wait for either the masonry grid or a "no results" indicator
                await Promise.race([
                    page.waitForSelector('.my-masonry-grid .image', { timeout: 8000 }),
                    page.waitForSelector('.no-results, .empty-results', { timeout: 8000 }).catch(() => {})
                ]);
                // Additional wait for images to fully load within the grid
                Logger.debug('⏳ Waiting for meme images to fully load...');
                await page.waitForTimeout(3000);
            } catch (waitError) {
                Logger.debug('Using fallback wait time for results');
                await page.waitForTimeout(5000); // Increased fallback wait time
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
                    '.image-container img'
                ];
                
                const urls = [];
                
                // Helper function to check if an image is likely a navbar/logo/icon
                const isNavbarOrLogoImage = (imgSrc, imgElement) => {
                    if (!imgSrc) return true;
                    
                    // Exclude common navbar/logo/icon patterns
                    const excludePatterns = [
                        /\/icon/i,
                        /\/logo/i,
                        /\/nav/i,
                        /\/header/i,
                        /\/footer/i,
                        /\/menu/i,
                        /\/sprite/i,
                        /\.svg$/i,
                        /\/assets\/images\/ui/i,
                        /apu_icon/i,
                        /apu_logo/i,
                        /navigation/i
                    ];
                    
                    // Check if URL matches any exclude patterns
                    if (excludePatterns.some(pattern => pattern.test(imgSrc))) {
                        return true;
                    }
                    
                    // Check image dimensions - likely navbar/logo if too small or in header area
                    if (imgElement) {
                        const rect = imgElement.getBoundingClientRect();
                        const computedStyle = window.getComputedStyle(imgElement);
                        
                        // Skip if image is too small (likely an icon)
                        if (rect.width < 50 || rect.height < 50) {
                            return true;
                        }
                        
                        // Skip if image is in header/nav area (top 100px of page)
                        if (rect.top < 100) {
                            return true;
                        }
                        
                        // Skip if parent has navbar-like classes
                        let parent = imgElement.parentElement;
                        while (parent) {
                            const parentClass = parent.className || '';
                            if (parentClass.match(/nav|header|menu|logo|brand|top-bar/i)) {
                                return true;
                            }
                            parent = parent.parentElement;
                            // Only check up to 3 levels up
                            if (parent === document.body) break;
                        }
                    }
                    
                    return false;
                };
                
                for (const selector of selectors) {
                    const images = document.querySelectorAll(selector);
                    if (images.length > 0) {
                        images.forEach(img => {
                            if (img.src && img.src.startsWith('http') && !isNavbarOrLogoImage(img.src, img)) {
                                urls.push(img.src);
                            }
                        });
                        if (urls.length > 0) break; // Stop after finding valid images with the first working selector
                    }
                }
                
                // Fallback: try any image in the results area, but be more selective
                if (urls.length === 0) {
                    const allImages = document.querySelectorAll('img');
                    allImages.forEach(img => {
                        if (img.src && img.src.startsWith('http') && !isNavbarOrLogoImage(img.src, img)) {
                            // Additional check for images that might be actual meme content
                            const isLikelyMemeContent = img.alt?.toLowerCase().includes('meme') || 
                                                       img.src.includes('/memes/') ||
                                                       img.src.includes('/uploads/') ||
                                                       img.src.includes('/images/') && !img.src.includes('/ui/');
                            
                            if (isLikelyMemeContent) {
                                urls.push(img.src);
                            }
                        }
                    });
                }
                
                return [...new Set(urls)]; // Remove duplicates
            });
            
            Logger.debug(`📊 Found ${memeUrls.length} meme images for "${keyword}"`);
            
            // Log first few URLs for debugging
            if (memeUrls.length > 0) {
                Logger.debug(`🔍 Sample URLs found:`, memeUrls.slice(0, 3).map(url => url.substring(0, 80)));
            }
            
            if (memeUrls.length === 0) {
                throw new Error(`No memes found for keyword: "${keyword}"`);
            }
            
            // Filter out already selected URLs to prioritize unique selections
            const uniqueUrls = memeUrls.filter(url => !selectedUrls.includes(url));
            
            // Use unique URLs if available, otherwise fall back to all URLs
            const urlsToChooseFrom = uniqueUrls.length > 0 ? uniqueUrls : memeUrls;
            
            // Randomly select one meme URL
            const randomIndex = Math.floor(Math.random() * urlsToChooseFrom.length);
            const selectedUrl = urlsToChooseFrom[randomIndex];
            
            if (uniqueUrls.length > 0) {
                Logger.debug(`🎲 Random selection from ${uniqueUrls.length} unique URLs: ${randomIndex + 1}/${uniqueUrls.length} - ${selectedUrl.substring(0, 50)}...`);
            } else {
                Logger.debug(`🎲 Random selection from ${memeUrls.length} total URLs (no unique options): ${randomIndex + 1}/${memeUrls.length} - ${selectedUrl.substring(0, 50)}...`);
            }
            
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