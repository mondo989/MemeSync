const OpenAI = require('openai');
const Logger = require('./utils/logger');

class KeywordExtractor {
    constructor() {
        this.openai = process.env.OPENAI_API_KEY ? new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        }) : null;
        
        // Stopwords to filter out
        this.stopwords = new Set([
            'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
            'should', 'may', 'might', 'must', 'can', 'shall', 'i', 'you', 'he',
            'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
            'your', 'his', 'her', 'its', 'our', 'their', 'this', 'that', 'these',
            'those', 'am', 'what', 'where', 'when', 'why', 'how'
        ]);
    }

    /**
     * Extract keywords from lyrics using OpenAI GPT (preferred) or fallback logic
     * @param {Array} transcriptLines - Array of {start, end, text} objects
     * @returns {Array} - Array of {start, end, text, keyword} objects
     */
    async extractKeywords(transcriptLines) {
        Logger.info('Starting keyword extraction...');
        
        const results = [];
        
        for (const line of transcriptLines) {
            try {
                let keyword;
                
                if (this.openai) {
                    keyword = await this.extractWithOpenAI(line.text);
                }
                
                // Fallback to manual extraction if OpenAI fails or not available
                if (!keyword) {
                    keyword = this.extractWithFallback(line.text);
                }
                
                results.push({
                    ...line,
                    keyword: keyword || 'default'
                });
                
                Logger.debug(`Extracted keyword "${keyword}" from: "${line.text}"`);
                
            } catch (error) {
                Logger.warn(`Failed to extract keyword from: "${line.text}"`, error.message);
                results.push({
                    ...line,
                    keyword: 'default'
                });
            }
        }
        
        Logger.success(`Keyword extraction complete. Processed ${results.length} lines.`);
        return results;
    }

    /**
     * Extract keyword using OpenAI GPT
     * @param {string} text - Lyric line text
     * @returns {string|null} - Extracted keyword or null if failed
     */
    async extractWithOpenAI(text) {
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `You are a meme expert. Extract the single most meme-relevant keyword from song lyrics. 
                        Consider emotion, tone, cultural context, and meme potential. 
                        Return ONLY one word - the best keyword for finding matching memes.
                        Prefer words that are visual, emotional, or culturally significant.
                        Examples: 
                        "I'm feeling so sad tonight" -> "sad"
                        "Dancing on fire" -> "fire"
                        "Living my best life" -> "celebration"
                        "Can't stop the feeling" -> "happy"`
                    },
                    {
                        role: 'user',
                        content: text
                    }
                ],
                max_tokens: 10,
                temperature: 0.3
            });

            const keyword = response.choices[0]?.message?.content?.trim()?.toLowerCase();
            
            // Validate that we got a single word
            if (keyword && keyword.split(' ').length === 1 && keyword.length > 1) {
                return keyword;
            }
            
            return null;
        } catch (error) {
            Logger.warn('OpenAI extraction failed:', error.message);
            return null;
        }
    }

    /**
     * Fallback keyword extraction using simple NLP techniques
     * @param {string} text - Lyric line text
     * @returns {string} - Extracted keyword
     */
    extractWithFallback(text) {
        // Clean and tokenize
        const words = text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 2 && !this.stopwords.has(word));
        
        if (words.length === 0) {
            return 'default';
        }
        
        // Score words by type and emotion
        const scoredWords = words.map(word => ({
            word,
            score: this.scoreWord(word)
        }));
        
        // Sort by score and return highest
        scoredWords.sort((a, b) => b.score - a.score);
        
        return scoredWords[0].word;
    }

    /**
     * Score word for meme relevance
     * @param {string} word - Word to score
     * @returns {number} - Score (higher is better)
     */
    scoreWord(word) {
        let score = 1;
        
        // Emotion words get higher score
        const emotionWords = ['love', 'hate', 'sad', 'happy', 'angry', 'excited', 'scared', 'confused', 'surprised'];
        if (emotionWords.some(emotion => word.includes(emotion))) {
            score += 3;
        }
        
        // Action words get medium score
        const actionWords = ['dance', 'run', 'jump', 'fly', 'fight', 'party', 'celebrate', 'cry', 'laugh'];
        if (actionWords.some(action => word.includes(action))) {
            score += 2;
        }
        
        // Visual/object words get medium score
        const visualWords = ['fire', 'water', 'light', 'dark', 'red', 'blue', 'big', 'small', 'fast', 'slow'];
        if (visualWords.some(visual => word.includes(visual))) {
            score += 2;
        }
        
        // Prefer longer words (more specific)
        if (word.length > 5) {
            score += 1;
        }
        
        return score;
    }
}

module.exports = KeywordExtractor; 