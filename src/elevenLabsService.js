const fs = require('fs');
const path = require('path');

class ElevenLabsService {
    constructor() {
        this.apiKey = process.env.ELEVENLABS_API_KEY;
        this.baseUrl = 'https://api.elevenlabs.io/v1';
        
        if (!this.apiKey) {
            throw new Error('ELEVENLABS_API_KEY environment variable is required');
        }
    }

    async generateSpeech(text, voiceId) {
        const voice = this.getVoiceMapping(voiceId);
        
        try {
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': this.apiKey
                },
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.5
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
            }

            const audioBuffer = await response.arrayBuffer();
            
            // Ensure media directory exists
            const mediaDir = path.join(__dirname, '../media');
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }
            
            // Clean up old speech files before creating new one
            await this.cleanupOldSpeechFiles(mediaDir);
            
            // Use consistent filename that gets overwritten each time
            const audioPath = path.join(mediaDir, 'generated_speech_current.mp3');
            const audioBufferData = Buffer.from(audioBuffer);
            fs.writeFileSync(audioPath, audioBufferData);
            
            // Log file details for debugging
            const stats = fs.statSync(audioPath);
            console.log(`Generated speech saved to: ${audioPath}`);
            console.log(`File size: ${Math.round(stats.size / 1024)}KB`);
            console.log(`File exists: ${fs.existsSync(audioPath)}`);
            
            return audioPath;
            
        } catch (error) {
            console.error('ElevenLabs generation failed:', error);
            throw new Error(`Failed to generate speech: ${error.message}`);
        }
    }

    getVoiceMapping(voiceId) {
        // These are actual ElevenLabs voice IDs - you may need to update with your preferred voices
        const voices = {
            voice1: 'pNInz6obpgDQGcFmaJgB', // Adam - Natural
            voice2: 'ErXwobaYiN019PkySvjV', // Antoni - Energetic  
            voice3: 'VR6AewLTigWG4xSOukaG', // Arnold - Calm
            voice4: 'rF5l8JggYM5VtGMNwK8t', // Bella - Dramatic
            voice5: 'jBpfuIE2acCO8z3wKNLl'  // Gigi - Friendly
        };
        return voices[voiceId] || voices.voice1;
    }

    /**
     * Clean up old speech files to prevent accumulation
     * @param {string} mediaDir - Media directory path
     */
    async cleanupOldSpeechFiles(mediaDir) {
        try {
            const fs = require('fs');
            const files = fs.readdirSync(mediaDir);
            
            // Remove old generated_speech files (but keep the current one)
            const speechFilesToDelete = files.filter(file => 
                file.startsWith('generated_speech_') && 
                file.endsWith('.mp3') && 
                file !== 'generated_speech_current.mp3'
            );
            
            for (const file of speechFilesToDelete) {
                const filePath = path.join(mediaDir, file);
                fs.unlinkSync(filePath);
                console.log(`🗑️ Cleaned up old speech file: ${file}`);
            }
            
            if (speechFilesToDelete.length > 0) {
                console.log(`🧹 Cleaned up ${speechFilesToDelete.length} old speech files`);
            }
        } catch (error) {
            console.warn(`⚠️ Failed to cleanup old speech files: ${error.message}`);
        }
    }

    getVoiceInfo() {
        return {
            voice1: { name: 'Adam', description: 'Natural and clear' },
            voice2: { name: 'Antoni', description: 'Energetic and expressive' },
            voice3: { name: 'Arnold', description: 'Calm and steady' },
            voice4: { name: 'Bella', description: 'Dramatic and engaging' },
            voice5: { name: 'Gigi', description: 'Friendly and warm' }
        };
    }
}

module.exports = ElevenLabsService; 