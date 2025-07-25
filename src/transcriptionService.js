const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./utils/logger');

class TranscriptionService {
    constructor() {
        this.lemonFoxApiKey = process.env.LEMONFOX_API_KEY;
        this.lemonFoxApiUrl = process.env.LEMONFOX_API_URL || 'https://api.lemonfox.ia';
    }

    /**
     * Get transcript with timestamps for YouTube video
     * @param {string} youtubeUrl - YouTube video URL
     * @param {string} startTime - Start time for trimming
     * @param {string} endTime - End time for trimming
     * @returns {Array} - Array of {start, end, text} objects
     */
    async getTranscript(youtubeUrl, startTime = null, endTime = null) {
        Logger.info('Starting transcription process...');

        try {
            // Try LemonFox.ia first if API key is available
            if (this.lemonFoxApiKey) {
                return await this.transcribeWithLemonFox(youtubeUrl, startTime, endTime);
            } else {
                Logger.warn('LemonFox API key not found, using fallback method');
                return await this.transcribeWithFallback(youtubeUrl, startTime, endTime);
            }
        } catch (error) {
            Logger.error('Transcription failed:', error);
            // Try fallback method if main method fails
            return await this.transcribeWithFallback(youtubeUrl, startTime, endTime);
        }
    }

    /**
     * Transcribe using LemonFox.ia API
     * @param {string} youtubeUrl - YouTube video URL
     * @param {string} startTime - Start time
     * @param {string} endTime - End time
     * @returns {Array} - Transcript with timestamps
     */
    async transcribeWithLemonFox(youtubeUrl, startTime, endTime) {
        Logger.info('Using LemonFox.ia for transcription...');

        try {
            // Submit transcription job
            const submitResponse = await axios.post(`${this.lemonFoxApiUrl}/transcribe`, {
                url: youtubeUrl,
                format: 'youtube',
                timestamps: true,
                language: 'auto'
            }, {
                headers: {
                    'Authorization': `Bearer ${this.lemonFoxApiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            const jobId = submitResponse.data.job_id;
            Logger.info(`Transcription job submitted: ${jobId}`);

            // Poll for completion
            let transcript = await this.pollTranscriptionJob(jobId);
            
            // Filter by time range if specified
            if (startTime && endTime) {
                transcript = this.filterTranscriptByTime(transcript, startTime, endTime);
            }

            Logger.success(`Transcription completed: ${transcript.length} segments`);
            return transcript;

        } catch (error) {
            Logger.error('LemonFox transcription failed:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Poll transcription job until completion
     * @param {string} jobId - Job ID from LemonFox
     * @returns {Array} - Completed transcript
     */
    async pollTranscriptionJob(jobId) {
        const maxAttempts = 60; // 5 minutes max
        const pollInterval = 5000; // 5 seconds

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const response = await axios.get(`${this.lemonFoxApiUrl}/jobs/${jobId}`, {
                    headers: {
                        'Authorization': `Bearer ${this.lemonFoxApiKey}`
                    }
                });

                const { status, result } = response.data;

                if (status === 'completed') {
                    return this.parseLemonFoxTranscript(result);
                } else if (status === 'failed') {
                    throw new Error('Transcription job failed');
                }

                Logger.info(`Transcription in progress... (${attempt + 1}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, pollInterval));

            } catch (error) {
                if (error.response?.status === 404) {
                    throw new Error('Transcription job not found');
                }
                throw error;
            }
        }

        throw new Error('Transcription job timed out');
    }

    /**
     * Parse LemonFox transcript format
     * @param {Object} result - LemonFox result object
     * @returns {Array} - Standardized transcript format
     */
    parseLemonFoxTranscript(result) {
        // Adapt this based on actual LemonFox.ia response format
        if (result.segments) {
            return result.segments.map(segment => ({
                start: segment.start,
                end: segment.end,
                text: segment.text.trim()
            }));
        }
        
        // Fallback parsing
        if (result.transcript && result.timestamps) {
            const lines = result.transcript.split('\n');
            const timestamps = result.timestamps;
            
            return lines.map((text, index) => ({
                start: timestamps[index]?.start || index * 3,
                end: timestamps[index]?.end || (index + 1) * 3,
                text: text.trim()
            })).filter(item => item.text.length > 0);
        }

        throw new Error('Unknown LemonFox transcript format');
    }

    /**
     * Fallback transcription method (mock implementation)
     * In a real implementation, this could use:
     * - YouTube's auto-generated captions
     * - Local speech recognition
     * - Alternative APIs
     * @param {string} youtubeUrl - YouTube video URL
     * @param {string} startTime - Start time
     * @param {string} endTime - End time
     * @returns {Array} - Mock transcript
     */
    async transcribeWithFallback(youtubeUrl, startTime, endTime) {
        Logger.warn('Using fallback transcription (mock data)');
        
        // Mock transcript for development/testing
        const mockTranscript = [
            { start: 0, end: 3, text: "Welcome to this amazing song" },
            { start: 3, end: 6, text: "Feel the rhythm in your soul" },
            { start: 6, end: 9, text: "Dancing through the night" },
            { start: 9, end: 12, text: "Everything will be alright" },
            { start: 12, end: 15, text: "Love is in the air tonight" },
            { start: 15, end: 18, text: "Stars are shining bright" },
            { start: 18, end: 21, text: "Never gonna give you up" },
            { start: 21, end: 24, text: "Never gonna let you down" },
            { start: 24, end: 27, text: "Running around and desert you" },
            { start: 27, end: 30, text: "Never gonna make you cry" }
        ];

        // Filter by time range if specified
        if (startTime && endTime) {
            return this.filterTranscriptByTime(mockTranscript, startTime, endTime);
        }

        Logger.info('Fallback transcription completed');
        return mockTranscript;
    }

    /**
     * Filter transcript by time range
     * @param {Array} transcript - Full transcript
     * @param {string} startTime - Start time (MM:SS)
     * @param {string} endTime - End time (MM:SS)
     * @returns {Array} - Filtered transcript
     */
    filterTranscriptByTime(transcript, startTime, endTime) {
        const startSeconds = this.timeToSeconds(startTime);
        const endSeconds = this.timeToSeconds(endTime);

        return transcript
            .filter(segment => segment.start >= startSeconds && segment.end <= endSeconds)
            .map(segment => ({
                ...segment,
                start: segment.start - startSeconds,
                end: segment.end - startSeconds
            }));
    }

    /**
     * Convert time string to seconds
     * @param {string} timeStr - Time in MM:SS or HH:MM:SS format
     * @returns {number} - Time in seconds
     */
    timeToSeconds(timeStr) {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 2) {
            return parts[0] * 60 + parts[1];
        } else if (parts.length === 3) {
            return parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
        return 0;
    }

    /**
     * Save transcript to file for debugging
     * @param {Array} transcript - Transcript data
     * @param {string} filename - Output filename
     */
    async saveTranscript(transcript, filename = 'transcript.json') {
        try {
            const outputPath = path.join(__dirname, '..', filename);
            await fs.writeFile(outputPath, JSON.stringify(transcript, null, 2));
            Logger.debug(`Transcript saved to ${outputPath}`);
        } catch (error) {
            Logger.warn('Failed to save transcript:', error.message);
        }
    }

    /**
     * Load transcript from file
     * @param {string} filename - Transcript filename
     * @returns {Array} - Transcript data
     */
    async loadTranscript(filename = 'transcript.json') {
        try {
            const filePath = path.join(__dirname, '..', filename);
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            Logger.warn('Failed to load transcript:', error.message);
            return [];
        }
    }
}

module.exports = TranscriptionService; 