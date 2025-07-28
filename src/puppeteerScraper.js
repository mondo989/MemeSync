const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./utils/logger');

class PuppeteerScraper {
    constructor() {
        this.memesSiteUrl = process.env.MEME_SITE_URL;
        this.boboSiteUrl = process.env.BOBO_SITE_URL;
        this.outputFile = path.join(__dirname, '../memes.json');
    }

    /**
     * Search for memes dynamically based on keywords from lyrics
     * @param {Array} keywords - Array of keyword strings to search for
     * @param {string} database - Database to search ('apu', 'bobo', 'other')
     * @returns {Array} - Array of {keyword, memeUrl} objects
     */
    async searchMemesForKeywords(keywords, database = 'apu') {
        // Handle special case for "other" database - search for CC0 photos instead of memes
        if (database.toLowerCase() === 'other') {
            Logger.info(`📷 Using PHOTO search mode for ${keywords.length} keywords (CC0 photos from Pexels)`);
            return await this.searchPhotosForKeywords(keywords);
        }

        // Validate database and get appropriate URL for meme databases
        let siteUrl;
        switch (database.toLowerCase()) {
            case 'apu':
        if (!this.memesSiteUrl) {
            Logger.error('MEME_SITE_URL not configured in environment variables');
            throw new Error('MEME_SITE_URL required');
        }
                siteUrl = this.memesSiteUrl;
                break;
            case 'bobo':
                if (!this.boboSiteUrl) {
                    Logger.error('BOBO_SITE_URL not configured in environment variables');
                    throw new Error('BOBO_SITE_URL required');
                }
                siteUrl = this.boboSiteUrl;
                break;
            default:
                throw new Error(`Unknown database: ${database}`);
        }

        Logger.info(`🎭 Starting isolated meme search for ${keywords.length} keywords using ${database.toUpperCase()} database`);
        Logger.info(`🌐 Meme site URL: ${siteUrl}`);
        Logger.info(`📋 Environment check - MEME_SITE_URL: ${this.memesSiteUrl ? 'SET' : 'NOT SET'}, BOBO_SITE_URL: ${this.boboSiteUrl ? 'SET' : 'NOT SET'}`);
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
                    memeUrl = await this.searchSingleKeywordIsolated(keyword, selectedUrls, database, siteUrl);
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
     * Search for CC0 photos from Pexels based on keywords
     * @param {Array} keywords - Array of keyword strings to search for
     * @returns {Array} - Array of {keyword, memeUrl} objects (memeUrl contains photo URL)
     */
    async searchPhotosForKeywords(keywords) {
        Logger.info(`📷 Starting CC0 photo search for ${keywords.length} keywords from Pexels`);
        Logger.info('🔄 Using separate browser instances for complete isolation between searches');
        
        const results = [];
        const selectedUrls = []; // Track selected URLs to avoid duplicates

        // Process each keyword with its own browser instance for complete isolation
        for (let i = 0; i < keywords.length; i++) {
            const keyword = keywords[i];
            Logger.info(`📷 [${i + 1}/${keywords.length}] Searching photos for: "${keyword}"`);
            
            try {
                // Search for a unique photo URL with retry logic to avoid duplicates
                let photoUrl;
                let retryCount = 0;
                const maxRetries = 5; // Prevent infinite loops
                
                do {
                    photoUrl = await this.searchSingleKeywordPhoto(keyword, selectedUrls);
                    retryCount++;
                    
                    if (selectedUrls.includes(photoUrl)) {
                        Logger.debug(`🔄 Duplicate photo URL found for "${keyword}" (attempt ${retryCount}/${maxRetries}), retrying...`);
                        if (retryCount >= maxRetries) {
                            Logger.warn(`⚠️ Max retries reached for "${keyword}", accepting duplicate URL`);
                            break;
                        }
                    }
                } while (selectedUrls.includes(photoUrl) && retryCount < maxRetries);
                
                // Add to selected URLs array and results
                selectedUrls.push(photoUrl);
                results.push({
                    keyword: keyword,
                    memeUrl: photoUrl // Using memeUrl field for compatibility, but contains photo URL
                });
                
                Logger.success(`✅ Found unique photo for "${keyword}": ${photoUrl.substring(0, 80)}...`);
                if (retryCount > 1) {
                    Logger.info(`🎯 Required ${retryCount} attempts to find unique photo`);
                }
                
                // Brief pause between searches to avoid overwhelming the server
                if (i < keywords.length - 1) {
                    Logger.debug(`⏱️  Brief pause before next photo search...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (error) {
                Logger.error(`❌ Failed to search photos for "${keyword}": ${error.message}`);
                Logger.debug('Error details:', error.stack);
                throw new Error(`Photo search failed for keyword "${keyword}": ${error.message}`);
            }
        }
        
        Logger.success(`🎉 CC0 photo search completed! Found ${results.length} photos using separate browser instances`);
        Logger.info(`🔒 Duplicate prevention: ${selectedUrls.length} unique URLs selected`);
        return results;
    }

    /**
     * Search for a single keyword using an isolated browser instance
     * @param {string} keyword - Keyword to search for
     * @param {Array} selectedUrls - Array of already selected URLs to avoid duplicates
     * @param {string} database - Database to search ('apu', 'bobo', 'other')
     * @param {string} siteUrl - URL of the meme site
     * @returns {string} - Meme image URL
     */
    async searchSingleKeywordIsolated(keyword, selectedUrls = [], database = 'apu', siteUrl = null) {
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
            const targetUrl = siteUrl || this.memesSiteUrl;
            await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
            
            // Perform the search using database-specific logic
            if (database === 'bobo') {
                Logger.info(`🐻 Using BOBO search method for "${keyword}"`);
                return await this.searchSingleKeywordBobo(page, keyword, selectedUrls);
            } else {
                Logger.info(`🐸 Using APU search method for "${keyword}"`);
                return await this.searchSingleKeyword(page, keyword, selectedUrls);
            }
            
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
     * Search for a single keyword on Bobo database and return a random meme URL
     * @param {Page} page - Puppeteer page object
     * @param {string} keyword - Keyword to search for
     * @param {Array} selectedUrls - Array of already selected URLs to avoid duplicates
     * @returns {string} - Meme image URL
     */
    async searchSingleKeywordBobo(page, keyword, selectedUrls = []) {
        try {
            Logger.debug(`🔍 Searching Bobo database for keyword: "${keyword}"`);
            
            // First, let's check if the page loaded correctly
            Logger.debug('📄 Checking page status...');
            const title = await page.title();
            const url = page.url();
            Logger.info(`📋 Page loaded - Title: "${title}", URL: ${url}`);
            
            // Check what elements are available on the page
            const availableElements = await page.evaluate(() => {
                const searchBtn = document.querySelector('#search-btn');
                const searchInput = document.querySelector('#search-input');
                const body = document.body;
                return {
                    hasSearchBtn: !!searchBtn,
                    hasSearchInput: !!searchInput,
                    searchBtnVisible: searchBtn ? !searchBtn.hidden : false,
                    searchInputVisible: searchInput ? !searchInput.hidden : false,
                    bodyContent: body ? body.innerHTML.substring(0, 500) : 'No body',
                    allIds: Array.from(document.querySelectorAll('[id]')).map(el => el.id).slice(0, 10)
                };
            });
            Logger.info(`🔍 Element check:`, availableElements);
            
            // Click search button first
            Logger.debug('🎯 Clicking search button...');
            
            try {
                await page.waitForSelector('#search-btn', { timeout: 5000 });
                await page.click('#search-btn');
                Logger.debug('✅ Search button clicked successfully');
                
                // Wait for search input to become visible/available after clicking search button
                Logger.debug('⏳ Waiting for search input to become available...');
                await page.waitForTimeout(3000); // Give UI time to transition
                
                // Check what elements are now available after clicking search button
                const postClickElements = await page.evaluate(() => {
                    const searchContainer = document.querySelector('#search-container');
                    const searchForm = document.querySelector('#search-form');
                    const searchInput = document.querySelector('#search-input');
                    const body = document.body;
                    
                    return {
                        searchContainer: searchContainer ? {
                            visible: !searchContainer.hidden,
                            display: window.getComputedStyle(searchContainer).display,
                            innerHTML: searchContainer.innerHTML.substring(0, 300)
                        } : null,
                        searchForm: searchForm ? {
                            visible: !searchForm.hidden,
                            display: window.getComputedStyle(searchForm).display,
                            innerHTML: searchForm.innerHTML.substring(0, 300)
                        } : null,
                        searchInput: searchInput ? {
                            visible: !searchInput.hidden,
                            display: window.getComputedStyle(searchInput).display,
                            type: searchInput.type,
                            placeholder: searchInput.placeholder
                        } : null,
                        allVisibleInputs: Array.from(document.querySelectorAll('input')).map(input => ({
                            id: input.id,
                            type: input.type,
                            placeholder: input.placeholder,
                            visible: window.getComputedStyle(input).display !== 'none'
                        }))
                    };
                });
                
                Logger.info(`🔍 Post-click element analysis:`, postClickElements);
                
                // If search container is hidden, make it visible
                if (postClickElements.searchContainer && postClickElements.searchContainer.display === 'none') {
                    Logger.info(`🔧 Search container is hidden, making it visible...`);
                    const containerMadeVisible = await page.evaluate(() => {
                        const searchContainer = document.querySelector('#search-container');
                        if (searchContainer) {
                            searchContainer.style.display = 'block';
                            return true;
                        }
                        return false;
                    });
                    
                    if (containerMadeVisible) {
                        Logger.debug('✅ Search container display set to block');
                    }
                    
                    // Wait a moment for the change to take effect
                    await page.waitForTimeout(1000);
                }
                
            } catch (btnError) {
                Logger.error(`❌ Failed to click search button: ${btnError.message}`);
                
                // Take a screenshot for debugging
                try {
                    const screenshotPath = path.join(__dirname, '../media', `bobo-debug-${Date.now()}.png`);
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    Logger.info(`📸 Debug screenshot saved: ${screenshotPath}`);
                } catch (screenshotError) {
                    Logger.warn(`Failed to take debug screenshot: ${screenshotError.message}`);
                }
                
                throw new Error(`Search button not found or clickable: ${btnError.message}`);
            }
            
            // Wait for search input to be available and click it
            Logger.debug('🎯 Clicking search input...');
            
            try {
                // Now the search input should be available - wait for it and click it
                await page.waitForSelector('#search-input', { visible: true, timeout: 5000 });
                Logger.debug('✅ Search input found and visible');
                
                await page.click('#search-input');
                Logger.debug('✅ Search input clicked successfully');
                
                // Additional check to ensure input is ready
                await page.waitForTimeout(500);
                
            } catch (inputError) {
                Logger.error(`❌ Failed to click search input: ${inputError.message}`);
                
                // Take a screenshot for debugging
                try {
                    const screenshotPath = path.join(__dirname, '../media', `bobo-input-debug-${Date.now()}.png`);
                    await page.screenshot({ path: screenshotPath, fullPage: true });
                    Logger.info(`📸 Input debug screenshot saved: ${screenshotPath}`);
                } catch (screenshotError) {
                    Logger.warn(`Failed to take input debug screenshot: ${screenshotError.message}`);
                }
                
                throw new Error(`Search input not found or clickable: ${inputError.message}`);
            }
            
            // Clear any existing content and type the keyword
            Logger.debug(`⌨️ Typing keyword: "${keyword}"`);
            
            // Clear the input field first
            await page.evaluate(() => {
                const searchInput = document.querySelector('#search-input');
                if (searchInput) {
                    searchInput.value = '';
                    searchInput.focus(); // Ensure focus
                }
            });
                    
            // Type the keyword
            await page.type('#search-input', keyword, { delay: 50 }); // Add small delay between keystrokes
            Logger.debug(`✅ Typed keyword: "${keyword}"`);
            
            // Press Enter to submit search
            Logger.debug('📤 Pressing Enter to submit search...');
            await page.keyboard.press('Enter');
            Logger.debug('✅ Search submitted with Enter key');
            
            // Wait for results to load
            Logger.debug('⏱️ Waiting for search results...');
            await page.waitForTimeout(3000); // Give time for results to load
            
            // Try to wait for gallery with media items
            try {
                await page.waitForSelector('#gallery .media-item', { timeout: 8000 });
            } catch (waitError) {
                Logger.debug('Using fallback wait for results');
                await page.waitForTimeout(2000);
            }
            
            // Extract meme URLs from gallery
            Logger.debug('🖼️ Extracting meme URLs from Bobo gallery...');
            const memeUrls = await page.evaluate(() => {
                const mediaItems = document.querySelectorAll('#gallery .media-item img');
                const urls = [];
                
                mediaItems.forEach(img => {
                    if (img.src && img.src.startsWith('http')) {
                        urls.push(img.src);
                    }
                });
                
                return [...new Set(urls)]; // Remove duplicates
            });
            
            Logger.debug(`📊 Found ${memeUrls.length} Bobo meme images for "${keyword}"`);
            
            if (memeUrls.length === 0) {
                throw new Error(`No Bobo memes found for keyword: "${keyword}"`);
            }
            
            // BOBO-SPECIFIC LOGIC: Only select from first 4 memes, allow duplicates
            const maxMemes = 4;
            const limitedMemes = memeUrls.slice(0, maxMemes);
            Logger.debug(`🐻 Bobo logic: Using first ${limitedMemes.length} memes (max ${maxMemes}) from ${memeUrls.length} total results`);
            
            // Try to find unique URLs from the first 4, but allow duplicates if needed
            const uniqueUrls = limitedMemes.filter(url => !selectedUrls.includes(url));
            const urlsToChooseFrom = uniqueUrls.length > 0 ? uniqueUrls : limitedMemes;
            
            // Randomly select one meme URL from the limited set
            const randomIndex = Math.floor(Math.random() * urlsToChooseFrom.length);
            const selectedUrl = urlsToChooseFrom[randomIndex];
            
            if (uniqueUrls.length > 0) {
                Logger.debug(`🎲 Bobo selection: Chose unique URL ${randomIndex + 1}/${uniqueUrls.length} from first ${maxMemes} memes`);
            } else {
                Logger.debug(`🎲 Bobo selection: Chose duplicate URL ${randomIndex + 1}/${limitedMemes.length} from first ${maxMemes} memes (allowing duplicates)`);
            }
            
            return selectedUrl;
            
        } catch (error) {
            Logger.error(`❌ Error searching Bobo database for "${keyword}": ${error.message}`);
            Logger.debug('Detailed error:', error.stack);
            throw error;
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
     * Search for a single keyword photo from Pexels using an isolated browser instance
     * @param {string} keyword - Keyword to search for
     * @param {Array} selectedUrls - Array of already selected URLs to avoid duplicates
     * @returns {string} - Photo image URL
     */
    async searchSingleKeywordPhoto(keyword, selectedUrls = []) {
        let browser = null;
        
        try {
            Logger.debug(`🚀 Launching isolated browser for photo search: "${keyword}"`);
            
            // Try multiple launch configurations for stability (same as music service)
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
                throw new Error(`Photo browser launch failed: ${lastError?.message || 'Unknown error'}`);
            }

            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1280, height: 720 });
            
            // Navigate to Pexels search
            const searchUrl = `https://www.pexels.com/search/${encodeURIComponent(keyword)}`;
            Logger.debug(`📷 Navigating to Pexels: ${searchUrl}`);
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
            
            // Wait for images to load
            Logger.debug('⏳ Waiting for Pexels images to load...');
            await page.waitForTimeout(4000); // Increased wait time for Pexels
            
            // Try to wait for the grid container and items
            try {
                await page.waitForSelector('[class*="RowGrid_gridContainer"]', { timeout: 10000 });
                Logger.debug('✅ Found Pexels grid container');
            } catch (waitError) {
                Logger.debug('Using fallback wait for Pexels grid');
                await page.waitForTimeout(3000);
            }
            
            // Wait for grid items to be present
            try {
                await page.waitForSelector('[class*="RowItem_gridItem"]', { timeout: 8000 });
                Logger.debug('✅ Found Pexels grid items');
            } catch (waitError) {
                Logger.debug('Using fallback wait for Pexels items');
                await page.waitForTimeout(2000);
            }
            
            // Extract image URLs from Pexels
            Logger.debug('🖼️ Extracting photo URLs from Pexels...');
            const photoUrls = await page.evaluate(() => {
                // Look for grid items with the specific class pattern
                const gridItems = document.querySelectorAll('[class*="RowItem_gridItem"]');
                const urls = [];
                
                console.log(`[PEXELS-EVAL] Found ${gridItems.length} grid items`);
                
                gridItems.forEach((item, index) => {
                    // Find img elements within each grid item
                    const images = item.querySelectorAll('img[src*="pexels.com"]');
                    
                    images.forEach(img => {
                        if (img.srcset && img.src && img.src.includes('pexels.com')) {
                            // Extract the 1200w URL from srcset
                            const srcset = img.srcset;
                            
                            // Look for the 1200w version in the srcset
                            const match = srcset.match(/([^,\s]+)\s+1200w/);
                            if (match && match[1]) {
                                let photoUrl = match[1];
                                
                                // Clean up any HTML entities
                                photoUrl = photoUrl.replace(/&amp;/g, '&');
                                
                                console.log(`[PEXELS-EVAL] Found 1200w image: ${photoUrl.substring(0, 60)}...`);
                                urls.push(photoUrl);
                            } else {
                                // Fallback: use the main src and modify it for higher resolution
                                let photoUrl = img.src.replace(/&amp;/g, '&');
                                
                                // Try to get a higher resolution version
                                if (photoUrl.includes('w=500')) {
                                    photoUrl = photoUrl.replace('w=500', 'w=1200');
                                } else if (photoUrl.includes('dpr=1')) {
                                    photoUrl = photoUrl.replace('dpr=1', 'dpr=2');
                                }
                                
                                console.log(`[PEXELS-EVAL] Using fallback image: ${photoUrl.substring(0, 60)}...`);
                                urls.push(photoUrl);
                            }
                        }
                    });
                });
                
                console.log(`[PEXELS-EVAL] Total URLs extracted: ${urls.length}`);
                return [...new Set(urls)]; // Remove duplicates
            });
            
            Logger.debug(`📊 Found ${photoUrls.length} Pexels photos for "${keyword}"`);
            
            if (photoUrls.length === 0) {
                throw new Error(`No Pexels photos found for keyword: "${keyword}"`);
            }
            
            // Filter out already selected URLs to prioritize unique selections
            const uniqueUrls = photoUrls.filter(url => !selectedUrls.includes(url));
            
            // Use unique URLs if available, otherwise fall back to all URLs
            const urlsToChooseFrom = uniqueUrls.length > 0 ? uniqueUrls : photoUrls;
            
            // Randomly select one photo URL
            const randomIndex = Math.floor(Math.random() * urlsToChooseFrom.length);
            const selectedUrl = urlsToChooseFrom[randomIndex];
            
            if (uniqueUrls.length > 0) {
                Logger.debug(`🎲 Random selection from ${uniqueUrls.length} unique Pexels URLs: ${randomIndex + 1}/${uniqueUrls.length}`);
            } else {
                Logger.debug(`🎲 Random selection from ${photoUrls.length} total Pexels URLs (no unique options): ${randomIndex + 1}/${photoUrls.length}`);
            }
            
            Logger.debug(`🔗 Selected photo URL: ${selectedUrl.substring(0, 80)}...`);
            
            return selectedUrl;
            
        } catch (error) {
            Logger.error(`❌ Error searching Pexels photos for "${keyword}": ${error.message}`);
            Logger.debug('Detailed error:', error.stack);
            throw error;
        } finally {
            if (browser) {
                try {
                    await browser.close();
                    Logger.debug(`🔒 Closed isolated browser for photo search: "${keyword}"`);
                } catch (closeError) {
                    Logger.warn(`⚠️ Error closing photo browser for "${keyword}":`, closeError.message);
                }
            }
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