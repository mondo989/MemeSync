const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class MusicDownloadService {
    constructor() {
        this.downloadDir = path.join(__dirname, '../media');
        this.ensureMediaDirectory();
        this.browser = null; // Keep browser instance for reuse
    }

    ensureMediaDirectory() {
        if (!fs.existsSync(this.downloadDir)) {
            fs.mkdirSync(this.downloadDir, { recursive: true });
        }
    }

    async getBrowser() {
        // Reuse existing browser if available and connected
        if (this.browser && this.browser.isConnected()) {
            console.log(`[MUSIC] ✅ Reusing existing browser`);
            return this.browser;
        }

        console.log(`[MUSIC] Launching new browser...`);
        
        // Try multiple launch configurations for stability (copied from working puppeteerScraper)
        const launchConfigs = [
            {
                headless: 'new', // Set to false for testing visibility
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
                headless: 'new', // Set to false for testing visibility
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--remote-debugging-port=0'],
                timeout: 10000
            }
        ];

        let lastError = null;
        for (const config of launchConfigs) {
            try {
                this.browser = await puppeteer.launch(config);
                break;
            } catch (configError) {
                lastError = configError;
                if (this.browser) {
                    try { await this.browser.close(); } catch {}
                    this.browser = null;
                }
            }
        }

        if (!this.browser) {
            throw new Error(`Browser launch failed: ${lastError?.message || 'Unknown error'}`);
        }
        
        console.log(`[MUSIC] ✅ Browser launched successfully`);
        
        // Add browser disconnect handler
        this.browser.on('disconnected', () => {
            console.log(`[MUSIC] ⚠️ Browser disconnected, clearing reference`);
            this.browser = null;
        });
        
        return this.browser;
    }

    async downloadMusicBySearchTerms(searchTerms) {
        console.log(`[MUSIC] Starting music download for search: "${searchTerms}"`);
        
        let browser = null;
        let page = null;
        
        try {
            // Get browser instance
            browser = await this.getBrowser();
            console.log(`[MUSIC] ✅ Browser instance ready`);
            
            // Create new page with retry logic
            page = await this.createPageWithRetry(browser);
            console.log(`[MUSIC] ✅ Page created successfully`);
            
            // Navigate to search results
            const directSearchUrl = `https://freesound.org/search/?q=${encodeURIComponent(searchTerms)}`;
            console.log(`[MUSIC] 🌐 Navigating to: ${directSearchUrl}`);
            
            await this.navigateWithRetry(page, directSearchUrl);
            console.log(`[MUSIC] ✅ Navigation completed successfully`);
            
            // Wait for search results
            await this.waitForSearchResults(page);
            console.log(`[MUSIC] ✅ Search results loaded and ready`);
            
            // Extract MP3 data
            const mp3Data = await this.extractMp3Data(page);
            
            if (!mp3Data || !mp3Data.mp3Url) {
                throw new Error(`No MP3 data found for search: "${searchTerms}"`);
            }

            console.log(`[MUSIC] 🎵 Selected track: "${mp3Data.title}" (${mp3Data.duration})`);
            console.log(`[MUSIC] 🔗 MP3 URL: ${mp3Data.mp3Url.substring(0, 80)}...`);
            
            // Download the MP3 file
            const fileName = `background_music_${Date.now()}.mp3`;
            console.log(`[MUSIC] ⬇️ Starting download: ${fileName}`);
            const filePath = await this.downloadFile(mp3Data.mp3Url, fileName);
            
            console.log(`[MUSIC] ✅ Music downloaded successfully: ${filePath}`);
            
            // Close page and browser after successful download
            if (page && !page.isClosed()) {
                await page.close();
                console.log(`[MUSIC] 🗂️ Page closed`);
            }
            
            // Close browser after successful extraction
            if (browser && browser.isConnected()) {
                await browser.close();
                this.browser = null; // Clear reference
                console.log(`[MUSIC] 🔒 Browser closed after successful download`);
            }
            
            return filePath;
            
        } catch (error) {
            console.error(`[MUSIC] ❌ Music download error: ${error.message}`);
            
            // Clean up page
            if (page && !page.isClosed()) {
                try {
                    await page.close();
                    console.log(`[MUSIC] 🗂️ Page closed after error`);
                } catch (closeError) {
                    console.error(`[MUSIC] Failed to close page: ${closeError.message}`);
                }
            }
            
            // Clean up browser
            if (browser && browser.isConnected()) {
                try {
                    await browser.close();
                    this.browser = null; // Clear reference
                    console.log(`[MUSIC] 🔒 Browser closed after error`);
                } catch (closeError) {
                    console.error(`[MUSIC] Failed to close browser: ${closeError.message}`);
                }
            }
            
            // Try fallback options
            console.log(`[MUSIC] 🔄 Looking for fallback music...`);
            const fallbackPath = await this.getFallbackMusic('default');
            if (fallbackPath) {
                console.log(`[MUSIC] ✅ Using fallback music: ${fallbackPath}`);
                return fallbackPath;
            }
            
            // Create silent audio as last resort
            console.log('[MUSIC] 🔇 Creating silent audio fallback...');
            const silentPath = await this.createSilentAudio();
            if (silentPath) {
                console.log(`[MUSIC] ✅ Using silent audio fallback: ${silentPath}`);
                return silentPath;
            }
            
            throw new Error(`Failed to download music: ${error.message}`);
        }
    }

    async createPageWithRetry(browser, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[MUSIC] Creating page (attempt ${attempt}/${maxRetries})...`);
                
                // Check if browser is still connected
                if (!browser.isConnected()) {
                    throw new Error('Browser disconnected');
                }
                
                const page = await browser.newPage();
                
                // Configure page
                await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                page.setDefaultTimeout(30000);
                page.setDefaultNavigationTimeout(30000);
                
                // Add error handlers
                page.on('error', (error) => {
                    console.log(`[MUSIC] Page error: ${error.message}`);
                });
                
                page.on('pageerror', (error) => {
                    console.log(`[MUSIC] Page JavaScript error: ${error.message}`);
                });
                
                console.log(`[MUSIC] ✅ Page created successfully`);
                return page;
                
            } catch (error) {
                console.log(`[MUSIC] ❌ Page creation attempt ${attempt} failed: ${error.message}`);
                
                if (attempt === maxRetries) {
                    throw error;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // If browser disconnected, get a new one
                if (!browser.isConnected()) {
                    browser = await this.getBrowser();
                }
            }
        }
    }

    async navigateWithRetry(page, url, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[MUSIC] Navigation attempt ${attempt}/${maxRetries} to: ${url}`);
                
                // Check if page is still valid
                if (page.isClosed()) {
                    throw new Error('Page is closed');
                }
                
                const response = await page.goto(url, { 
                    waitUntil: 'domcontentloaded',
                    timeout: 30000 
                });
                
                console.log(`[MUSIC] ✅ Navigation successful: ${response.status()}`);
                
                // Wait for page to stabilize
                await page.waitForTimeout(3000);
                
                return response;
                
            } catch (error) {
                console.log(`[MUSIC] ❌ Navigation attempt ${attempt} failed: ${error.message}`);
                
                if (attempt === maxRetries) {
                    throw error;
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
    }

    async waitForSearchResults(page) {
        console.log('[MUSIC] ⏳ Waiting for search results...');
        
        try {
            // Wait for document to be ready
            console.log('[MUSIC] 📄 Waiting for document ready state...');
            await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 });
            console.log('[MUSIC] ✅ Document ready');
            
            // Wait for search results with multiple selectors
            console.log('[MUSIC] 🔍 Waiting for search result elements...');
            await Promise.race([
                page.waitForSelector('.bw-search__result', { timeout: 15000, visible: true }),
                page.waitForSelector('.v-spacing-6.v-spacing-top-2', { timeout: 15000, visible: true }),
                page.waitForSelector('[class*="search__result"]', { timeout: 15000, visible: true })
            ]);
            
            console.log('[MUSIC] ✅ Search result elements found');
            
            // Additional wait for dynamic content
            console.log('[MUSIC] ⏱️ Waiting for dynamic content to stabilize...');
            await page.waitForTimeout(2000);
            
        } catch (error) {
            console.log(`[MUSIC] ⚠️ Search results wait failed: ${error.message}`);
            console.log('[MUSIC] 🔄 Continuing anyway, will attempt to find results...');
            // Continue anyway, might still find results
        }
    }

        async extractMp3Data(page) {
        console.log(`[MUSIC] 🎵 Extracting MP3 data from search results...`);
        
        const mp3Data = await page.evaluate(() => {
            const searchResults = document.querySelectorAll('.bw-search__result');
            console.log(`[MUSIC-EVAL] Found ${searchResults.length} search results`);
            
            if (searchResults.length === 0) {
                console.log(`[MUSIC-EVAL] No search results found`);
                return null;
            }
            
            // Try multiple results
            for (let i = 0; i < Math.min(5, searchResults.length); i++) {
                const randomIndex = Math.floor(Math.random() * searchResults.length);
                const result = searchResults[randomIndex];
                
                const player = result.querySelector('.bw-player');
                if (!player) {
                    console.log(`[MUSIC-EVAL] No player found in result ${randomIndex + 1}`);
                    continue;
                }
                
                const mp3Url = player.getAttribute('data-mp3');
                if (!mp3Url) {
                    console.log(`[MUSIC-EVAL] No MP3 URL found in result ${randomIndex + 1}`);
                    continue;
                }
                
                const titleElement = result.querySelector('.sound-title a');
                const title = titleElement ? titleElement.textContent.trim() : 'Unknown';
                
                const durationElement = result.querySelector('.duration');
                const duration = durationElement ? durationElement.textContent.trim() : 'Unknown';
                
                console.log(`[MUSIC-EVAL] ✅ Found valid MP3: "${title}" (${duration})`);
                return {
                    mp3Url: mp3Url,
                    title: title,
                    duration: duration,
                    index: randomIndex
                };
            }
            
            console.log(`[MUSIC-EVAL] No valid MP3 URLs found after checking results`);
            return null;
        });
        
        if (mp3Data) {
            console.log(`[MUSIC] ✅ MP3 extraction successful: "${mp3Data.title}"`);
        } else {
            console.log(`[MUSIC] ❌ MP3 extraction failed: no valid tracks found`);
        }
        
        return mp3Data;
    }

    // Add cleanup method for when service is done
    async cleanup() {
        if (this.browser && this.browser.isConnected()) {
            console.log(`[MUSIC] Closing browser...`);
            try {
                await this.browser.close();
                this.browser = null;
                console.log(`[MUSIC] ✅ Browser closed`);
        } catch (error) {
                console.error(`[MUSIC] Failed to close browser: ${error.message}`);
            }
        }
    }

    getMoodSearchTerms(mood) {
        const searchTerms = {
            upbeat: "upbeat happy energetic background music instrumental",
            calm: "ambient peaceful relaxing meditation calm instrumental", 
            dramatic: "cinematic epic tension dramatic orchestral instrumental",
            energetic: "electronic dance energetic pump beat instrumental",
            mysterious: "dark mysterious atmospheric ambient suspense instrumental"
        };
        return searchTerms[mood] || searchTerms.calm;
    }

    async downloadFile(url, fileName) {
        return new Promise((resolve, reject) => {
            const filePath = path.join(this.downloadDir, fileName);
            const file = fs.createWriteStream(filePath);
            
            const protocol = url.startsWith('https:') ? https : http;
            
            const request = protocol.get(url, (response) => {
                // Follow redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    return this.downloadFile(response.headers.location, fileName)
                        .then(resolve)
                        .catch(reject);
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                response.pipe(file);
                
                file.on('finish', () => {
                    file.close();
                    resolve(filePath);
                });
                
                file.on('error', (err) => {
                    fs.unlink(filePath, () => {});
                    reject(err);
                });
            });
            
            request.on('error', (err) => {
                fs.unlink(filePath, () => {});
                reject(err);
            });
            
            request.setTimeout(30000, () => {
                request.destroy();
                fs.unlink(filePath, () => {});
                reject(new Error('Download timeout'));
            });
        });
    }

    async getFallbackMusic(mood) {
        // Check for any existing music files as fallback
        const fallbackFiles = [
            `fallback_${mood}.mp3`,
            'fallback_music.mp3',
            'default_background.mp3'
        ];
        
        for (const fileName of fallbackFiles) {
            const filePath = path.join(this.downloadDir, fileName);
            if (fs.existsSync(filePath)) {
                return filePath;
            }
        }
        
        return null;
    }

    async createSilentAudio() {
        const fs = require('fs');
        console.log(`[MUSIC] Creating simple silent audio file...`);
        
        try {
            // Create a minimal silent MP3 file by writing a basic MP3 header
            // This is a minimal 1-second silent MP3 file in base64
            const silentMp3Base64 = '/+MYxAAEaAIAAAg='
            const silentBuffer = Buffer.from(silentMp3Base64, 'base64');
            
            const silentPath = path.join(this.downloadDir, `silent_audio_${Date.now()}.mp3`);
            fs.writeFileSync(silentPath, silentBuffer);
            
            console.log(`[MUSIC] ✅ Silent audio created: ${silentPath}`);
            return silentPath;
        } catch (error) {
            console.error(`[MUSIC] ❌ Failed to create silent audio: ${error.message}`);
            return null;
        }
    }
}

module.exports = MusicDownloadService; 