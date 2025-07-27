const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./utils/logger');

class TranscriptionService {
    constructor() {
        this.lemonFoxApiKey = process.env.LEMONFOX_API_KEY;
        this.lemonFoxApiUrl = process.env.LEMONFOX_API_URL || 'https://api.lemonfox.ai';
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

        if (!this.lemonFoxApiKey) {
            throw new Error('LemonFox API key is required for transcription');
        }

        return await this.transcribeWithLemonFox(youtubeUrl, startTime, endTime);
    }

    /**
     * Transcribe audio file (from ElevenLabs or other sources)
     * @param {string} audioFilePath - Path to the audio file
     * @returns {Array} - Array of {start, end, text} objects
     */
    async transcribeAudioFile(audioFilePath) {
        Logger.info(`Starting transcription of audio file: ${audioFilePath}`);

        if (!this.lemonFoxApiKey) {
            throw new Error('LemonFox API key is required for transcription');
        }

        try {
            // Verify file exists and get details
            await fs.access(audioFilePath);
            const stats = await fs.stat(audioFilePath);
            Logger.info('Audio file found, starting transcription...');
            Logger.info(`File size: ${Math.round(stats.size / 1024)}KB`);
            Logger.info(`File path: ${audioFilePath}`);
            
            // Check if file is too small (might indicate a problem)
            if (stats.size < 1000) {
                Logger.warn(`⚠️ Audio file is very small (${stats.size} bytes) - this might indicate a problem`);
            }
        } catch (error) {
            Logger.error(`Audio file access failed: ${error.message}`);
            throw new Error(`Audio file not found: ${audioFilePath}`);
        }

        try {
            // Create form data for LemonFox API  
            const FormData = require('form-data');
            const fs_sync = require('fs');
            const formData = new FormData();
            
            // Upload the audio file
            formData.append('file', fs_sync.createReadStream(audioFilePath));
            formData.append('response_format', 'verbose_json');
            formData.append('language', 'english');
            formData.append('timestamp_granularities[]', 'word');

            Logger.info(`Submitting transcription request to: ${this.lemonFoxApiUrl}/v1/audio/transcriptions`);
            Logger.info(`File being uploaded: ${path.basename(audioFilePath)}`);

            // Submit transcription request
            const response = await axios.post(`${this.lemonFoxApiUrl}/v1/audio/transcriptions`, formData, {
                headers: {
                    'Authorization': `Bearer ${this.lemonFoxApiKey}`,
                    ...formData.getHeaders()
                },
                timeout: 120000 // 2 minute timeout for file upload
            });

            Logger.info(`Transcription request completed with status: ${response.status}`);

            Logger.info('LemonFox transcription completed for audio file');
            Logger.info('Raw LemonFox response:', JSON.stringify(response.data, null, 2));
            
            const transcript = this.parseLemonFoxResponse(response.data);
            Logger.success(`Audio transcription completed: ${transcript.length} segments`);
            
            return transcript;

        } catch (error) {
            Logger.error('Audio file transcription failed:', error.response?.data || error.message);
            throw new Error(`Failed to transcribe audio file: ${error.message}`);
        }
    }

    /**
     * Transcribe using LemonFox.ai API
     * @param {string} youtubeUrl - YouTube video URL
     * @param {string} startTime - Start time
     * @param {string} endTime - End time
     * @returns {Array} - Transcript with timestamps
     */
    async transcribeWithLemonFox(youtubeUrl, startTime, endTime) {
        Logger.info('Using LemonFox.ai for transcription...');

        try {
            // LemonFox needs actual audio file, not YouTube URL
            // Look for the downloaded audio file
            const audioPath = path.join(process.cwd(), 'media/audio.m4a');
            
            try {
                await fs.access(audioPath);
                Logger.info('Found downloaded audio file for transcription');
            } catch {
                throw new Error('Audio file not found. Download audio first before transcription.');
            }

            // Create form data for LemonFox API  
            const FormData = require('form-data');
            const fs_sync = require('fs');
            const formData = new FormData();
            
            // Upload the actual audio file
            formData.append('file', fs_sync.createReadStream(audioPath));
            formData.append('response_format', 'verbose_json');
            formData.append('language', 'english');
            formData.append('timestamp_granularities[]', 'word');

            // Submit transcription request
            const response = await axios.post(`${this.lemonFoxApiUrl}/v1/audio/transcriptions`, formData, {
                headers: {
                    'Authorization': `Bearer ${this.lemonFoxApiKey}`,
                    ...formData.getHeaders()
                },
                timeout: 120000 // 2 minute timeout for file upload
            });

            Logger.info('LemonFox transcription completed');
            Logger.info('Raw LemonFox response:', JSON.stringify(response.data, null, 2));
            let transcript = this.parseLemonFoxResponse(response.data);
            
            // No need to filter by time - audio was already trimmed to the exact range
            Logger.info(`Transcription completed: ${transcript.length} segments from trimmed audio`);
            if (startTime && endTime) {
                Logger.info(`Original time range: ${startTime}-${endTime}`);
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
                    return this.parseLemonFoxResponse(result);
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
    parseLemonFoxResponse(result) {
        Logger.info('Parsing LemonFox response...');
        
        // LemonFox verbose_json format
        if (result.segments) {
            return result.segments.map(segment => ({
                start: segment.start,
                end: segment.end,
                text: segment.text.trim()
            })).filter(item => item.text.length > 0);
        }
        
        // Alternative format - simple text with word-level timestamps
        if (result.words) {
            // Group words into phrases (every ~3 seconds)
            const segments = [];
            let currentSegment = { start: 0, end: 0, text: '' };
            const maxDuration = 3; // 3 seconds per segment
            
            result.words.forEach(word => {
                if (word.end - currentSegment.start > maxDuration && currentSegment.text.trim()) {
                    segments.push({
                        start: currentSegment.start,
                        end: currentSegment.end,
                        text: currentSegment.text.trim()
                    });
                    currentSegment = { start: word.start, end: word.end, text: word.word };
                } else {
                    if (!currentSegment.text) currentSegment.start = word.start;
                    currentSegment.end = word.end;
                    currentSegment.text += ' ' + word.word;
                }
            });
            
            // Add the last segment
            if (currentSegment.text.trim()) {
                segments.push({
                    start: currentSegment.start,
                    end: currentSegment.end,
                    text: currentSegment.text.trim()
                });
            }
            
            return segments;
        }

        // Simple text format - create timed segments
        if (result.text) {
            const words = result.text.split(' ');
            const segments = [];
            const wordsPerSegment = 8; // ~3 seconds worth
            
            for (let i = 0; i < words.length; i += wordsPerSegment) {
                const segmentWords = words.slice(i, i + wordsPerSegment);
                const start = (i / wordsPerSegment) * 3;
                const end = start + 3;
                
                segments.push({
                    start: start,
                    end: end,
                    text: segmentWords.join(' ')
                });
            }
            
            return segments;
        }

        throw new Error('Unknown LemonFox response format');
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

        Logger.info(`Filtering transcript: ${startSeconds}s to ${endSeconds}s from ${transcript.length} segments`);

        // Filter segments that overlap with our time range
        const filtered = transcript
            .filter(segment => {
                // Include segment if it overlaps with our time range
                const segmentOverlaps = segment.start < endSeconds && segment.end > startSeconds;
                if (segmentOverlaps) {
                    Logger.debug(`Including segment: ${segment.start}-${segment.end}s: "${segment.text}"`);
                }
                return segmentOverlaps;
            })
            .map(segment => ({
                ...segment,
                // Adjust timestamps to start from 0
                start: Math.max(0, segment.start - startSeconds),
                end: segment.end - startSeconds
            }));

        Logger.info(`Filtered transcript: ${filtered.length} segments in time range`);
        return filtered;
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