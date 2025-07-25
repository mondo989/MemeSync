const stringSimilarity = require('string-similarity');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./utils/logger');

class MemesMatcher {
    constructor() {
        this.memesPath = path.join(__dirname, '../memes.json');
        this.memes = [];
        this.fallbackMeme = {
            keywords: ['default'],
            url: process.env.FALLBACK_MEME_URL || 'https://i.imgflip.com/30b1gx.jpg'
        };
    }

    /**
     * Load memes from JSON file
     */
    async loadMemes() {
        try {
            const data = await fs.readFile(this.memesPath, 'utf8');
            this.memes = JSON.parse(data);
            Logger.info(`Loaded ${this.memes.length} memes from database`);
        } catch (error) {
            Logger.warn('Failed to load memes.json, using fallback memes only');
            this.memes = this.getDefaultMemes();
        }
    }

    /**
     * Match keywords to memes
     * @param {Array} keywordData - Array of {start, end, text, keyword} objects
     * @returns {Array} - Array of {start, end, text, keyword, meme} objects
     */
    async matchMemes(keywordData) {
        await this.loadMemes();
        
        Logger.info('Starting meme matching...');
        
        const results = keywordData.map(item => {
            const meme = this.findBestMeme(item.keyword);
            
            Logger.debug(`Matched "${item.keyword}" to meme: ${meme.url}`);
            
            return {
                ...item,
                meme
            };
        });
        
        Logger.success(`Meme matching complete. Matched ${results.length} items.`);
        return results;
    }

    /**
     * Find the best matching meme for a keyword
     * @param {string} keyword - Keyword to match
     * @returns {Object} - Meme object {keywords, url}
     */
    findBestMeme(keyword) {
        if (!keyword || keyword === 'default') {
            return this.fallbackMeme;
        }

        let bestMatch = null;
        let bestScore = 0;
        const threshold = 0.3; // Minimum similarity threshold

        // Check each meme for keyword matches
        for (const meme of this.memes) {
            const score = this.calculateMemeScore(keyword, meme);
            
            if (score > bestScore && score >= threshold) {
                bestScore = score;
                bestMatch = meme;
            }
        }

        // If no good match found, try fuzzy matching
        if (!bestMatch) {
            bestMatch = this.fuzzyMatch(keyword);
        }

        return bestMatch || this.fallbackMeme;
    }

    /**
     * Calculate similarity score between keyword and meme
     * @param {string} keyword - Target keyword
     * @param {Object} meme - Meme object with keywords array
     * @returns {number} - Similarity score (0-1)
     */
    calculateMemeScore(keyword, meme) {
        let maxScore = 0;
        
        for (const memeKeyword of meme.keywords) {
            // Exact match gets highest score
            if (keyword.toLowerCase() === memeKeyword.toLowerCase()) {
                return 1.0;
            }
            
            // Partial match
            if (keyword.toLowerCase().includes(memeKeyword.toLowerCase()) || 
                memeKeyword.toLowerCase().includes(keyword.toLowerCase())) {
                maxScore = Math.max(maxScore, 0.8);
            }
            
            // String similarity
            const similarity = stringSimilarity.compareTwoStrings(
                keyword.toLowerCase(), 
                memeKeyword.toLowerCase()
            );
            maxScore = Math.max(maxScore, similarity);
        }
        
        return maxScore;
    }

    /**
     * Fuzzy match using string similarity across all keywords
     * @param {string} keyword - Target keyword
     * @returns {Object|null} - Best matching meme or null
     */
    fuzzyMatch(keyword) {
        const allKeywords = [];
        
        // Flatten all keywords with their meme references
        this.memes.forEach(meme => {
            meme.keywords.forEach(memeKeyword => {
                allKeywords.push({
                    keyword: memeKeyword,
                    meme
                });
            });
        });
        
        // Find best fuzzy match
        const matches = stringSimilarity.findBestMatch(
            keyword.toLowerCase(),
            allKeywords.map(item => item.keyword.toLowerCase())
        );
        
        if (matches.bestMatch.rating > 0.4) {
            const bestKeyword = allKeywords[matches.bestMatchIndex];
            return bestKeyword.meme;
        }
        
        return null;
    }

    /**
     * Get semantic matches for emotion/concept keywords
     * @param {string} keyword - Target keyword
     * @returns {Object|null} - Semantically matching meme or null
     */
    getSemanticMatch(keyword) {
        const emotionMappings = {
            // Happy/Positive emotions
            'happy': ['joy', 'celebrate', 'party', 'excited', 'fun'],
            'excited': ['party', 'celebrate', 'energy', 'hype'],
            'love': ['heart', 'romantic', 'valentine', 'cute'],
            
            // Sad/Negative emotions
            'sad': ['cry', 'depression', 'lonely', 'down', 'blue'],
            'angry': ['mad', 'rage', 'furious', 'upset'],
            'confused': ['lost', 'puzzled', 'what', 'help'],
            
            // Actions
            'dance': ['party', 'music', 'move', 'groove'],
            'run': ['fast', 'speed', 'exercise', 'escape'],
            'fight': ['battle', 'war', 'conflict', 'strong'],
            
            // Objects/Concepts
            'fire': ['hot', 'burn', 'flame', 'heat'],
            'water': ['ocean', 'rain', 'blue', 'flow'],
            'money': ['rich', 'cash', 'dollar', 'wealth'],
            'time': ['clock', 'wait', 'late', 'hurry']
        };
        
        const lowerKeyword = keyword.toLowerCase();
        
        // Find semantic matches
        for (const [concept, synonyms] of Object.entries(emotionMappings)) {
            if (synonyms.includes(lowerKeyword) || concept === lowerKeyword) {
                // Look for memes with this concept or its synonyms
                const conceptKeywords = [concept, ...synonyms];
                
                for (const meme of this.memes) {
                    for (const memeKeyword of meme.keywords) {
                        if (conceptKeywords.includes(memeKeyword.toLowerCase())) {
                            return meme;
                        }
                    }
                }
            }
        }
        
        return null;
    }

    /**
     * Get default memes for common cases
     * @returns {Array} - Array of default meme objects
     */
    getDefaultMemes() {
        return [
            {
                keywords: ['default', 'error', 'unknown', 'fallback'],
                url: 'https://i.imgflip.com/30b1gx.jpg' // "This is Fine"
            },
            {
                keywords: ['happy', 'joy', 'celebration', 'party', 'excited', 'fun'],
                url: 'https://i.imgflip.com/1g8my4.jpg' // Drake pointing
            },
            {
                keywords: ['sad', 'cry', 'depression', 'lonely', 'down'],
                url: 'https://i.imgflip.com/1biioo.jpg' // Sad Pablo Escobar
            },
            {
                keywords: ['confused', 'what', 'lost', 'puzzled', 'help'],
                url: 'https://i.imgflip.com/2zo1ki.jpg' // Confused Jackie Chan
            },
            {
                keywords: ['angry', 'mad', 'rage', 'furious', 'upset'],
                url: 'https://i.imgflip.com/1o00in.jpg' // Angry Baby
            },
            {
                keywords: ['love', 'heart', 'romantic', 'valentine', 'cute'],
                url: 'https://i.imgflip.com/26jxvz.jpg' // Wholesome meme
            },
            {
                keywords: ['dance', 'music', 'party', 'move', 'groove'],
                url: 'https://i.imgflip.com/1rbojb.jpg' // Dancing baby
            },
            {
                keywords: ['fire', 'hot', 'burn', 'flame', 'heat'],
                url: 'https://i.imgflip.com/2fm6x.jpg' // "Everything is fine" fire
            },
            {
                keywords: ['money', 'rich', 'cash', 'dollar', 'wealth'],
                url: 'https://i.imgflip.com/1c1uej.jpg' // Money meme
            },
            {
                keywords: ['fast', 'speed', 'run', 'quick', 'rush'],
                url: 'https://i.imgflip.com/1ihzfe.jpg' // Speed meme
            }
        ];
    }

    /**
     * Get meme statistics
     * @returns {Object} - Statistics about meme matching
     */
    getStats() {
        const keywordCount = this.memes.reduce((total, meme) => total + meme.keywords.length, 0);
        
        return {
            totalMemes: this.memes.length,
            totalKeywords: keywordCount,
            averageKeywordsPerMeme: keywordCount / this.memes.length || 0
        };
    }
}

module.exports = MemesMatcher; 