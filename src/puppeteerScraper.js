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
     * Scrape memes from the configured website and build memes.json
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
            args: ['--no-sandbox', '--disable-setuid-sandbox']
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

    /**
     * Add default fallback memes for common keywords
     * @returns {Array} - Array of default meme objects
     */
    getDefaultMemes() {
        return [
            {
                keywords: ['default', 'error', 'unknown', 'fallback'],
                url: process.env.FALLBACK_MEME_URL || 'https://i.imgflip.com/30b1gx.jpg' // "This is Fine" meme
            },
            {
                keywords: ['happy', 'joy', 'celebration', 'party', 'excited'],
                url: 'https://i.imgflip.com/1g8my4.jpg' // Drake pointing
            },
            {
                keywords: ['sad', 'cry', 'depression', 'lonely', 'down'],
                url: 'https://i.imgflip.com/1biioo.jpg' // Sad Pablo Escobar
            },
            {
                keywords: ['confused', 'what', 'lost', 'puzzled'],
                url: 'https://i.imgflip.com/2zo1ki.jpg' // Confused Jackie Chan
            },
            {
                keywords: ['angry', 'mad', 'rage', 'furious'],
                url: 'https://i.imgflip.com/1o00in.jpg' // Angry Baby
            },
            {
                keywords: ['love', 'heart', 'romantic', 'valentine'],
                url: 'https://i.imgflip.com/26jxvz.jpg' // Wholesome meme
            }
        ];
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