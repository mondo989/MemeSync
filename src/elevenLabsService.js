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
            const response = await fetch(`${this.baseUrl}/text-to-speech/${voice}`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'Content-Type': 'application/json',
                    'xi-api-key': this.apiKey
                },
                body: JSON.stringify({
                    text: text,
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.5,
                        style: 0.0,
                        use_speaker_boost: true
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
            }

            const audioBuffer = await response.arrayBuffer();
            
            // Ensure media directory exists
            const mediaDir = path.join(__dirname, '../media');
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }
            
            const audioPath = path.join(mediaDir, `generated_speech_${Date.now()}.mp3`);
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