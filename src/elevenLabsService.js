const fs = require('fs');
const path = require('path');

class ElevenLabsService {
    constructor() {
        this.apiKey = process.env.ELEVENLABS_API_KEY;
        this.baseUrl = 'https://api.elevenlabs.io/v1';
        
        if (!this.apiKey || this.apiKey === 'sk-test-dummy-key-for-testing') {
            this.isDevelopmentMode = true;
            console.log('⚠️  Running in DEVELOPMENT MODE - using dummy audio files');
            console.log('To use real text-to-speech, set a valid ELEVENLABS_API_KEY');
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
        // These are actual ElevenLabs voice IDs - expanded selection with spooky/atmospheric voices
        const voices = {
            voice1: 'pNInz6obpgDQGcFmaJgB', // Adam - Natural
            voice2: 'ErXwobaYiN019PkySvjV', // Antoni - Energetic  
            voice3: 'VR6AewLTigWG4xSOukaG', // Arnold - Calm
            voice4: 'rF5l8JggYM5VtGMNwK8t', // Bella - Dramatic
            voice5: 'jBpfuIE2acCO8z3wKNLl', // Gigi - Friendly
            voice6: 'TxGEqnHWrfWFTfGW9XjX', // Josh - Deep and authoritative
            voice7: 'D38z5RcWu1voky8WS1ja', // Fin - Dark and mysterious
            voice8: 'ZQe5CqHNLWdVhrnuN8oN', // Freya - Atmospheric and haunting
            voice9: 'SOYHLrjzK2X1ezoPC6cr', // Harry - Sinister and dramatic
            voice10: 'Yko7PKHZNXotIFUBG7I9', // Emily - Ethereal and mysterious
            voice11: 'bVMeCyTHy58xNoL34h3p', // Jeremy - Dark narrator
            voice12: 'EXAVITQu4vr4xnSDxMaL', // Sarah - Whispery and eerie
            voice13: 'MF3mGyEYCl7XYWbV9V6O', // Elli - Ghostly and soft
            voice14: 'TX3LPaxmHKxFdv7VOQHJ', // Liam - Deep and ominous
            voice15: 'XB0fDUnXU5powFXDhCwa', // Charlotte - Mysterious female
            voice16: '7NsaqHdLuKNFvEfjpUno', // Seer Morganna - Mystical oracle voice
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
            voice5: { name: 'Gigi', description: 'Friendly and warm' },
            voice6: { name: 'Josh', description: 'Deep and authoritative' },
            voice7: { name: 'Fin', description: '🎭 Dark and mysterious' },
            voice8: { name: 'Freya', description: '👻 Atmospheric and haunting' },
            voice9: { name: 'Harry', description: '🔥 Sinister and dramatic' },
            voice10: { name: 'Emily', description: '✨ Ethereal and mysterious' },
            voice11: { name: 'Jeremy', description: '📚 Dark narrator voice' },
            voice12: { name: 'Sarah', description: '🌙 Whispery and eerie' },
            voice13: { name: 'Elli', description: '👤 Ghostly and soft' },
            voice14: { name: 'Liam', description: '⚡ Deep and ominous' },
            voice15: { name: 'Charlotte', description: '🔮 Mysterious female voice' },
            voice16: { name: 'Seer Morganna', description: '🔮✨ Mystical oracle with ancient wisdom' }
        };
    }
}

module.exports = ElevenLabsService; 