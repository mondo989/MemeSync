# Meme Music Video Generator – MVP Specification

## 🧠 Overview

This project generates a meme-driven music video by taking a YouTube URL and returning an MP4 video. The video displays meme images timed to the lyrics of the song. Each meme is chosen by matching keywords from the lyrics with images available on a meme website. The goal is to create a fun, local-only tool that automates this pipeline end-to-end.

---

## 🎯 Goals

- Optional: Add a thumbnail meme at the beginning of the video

- Input: YouTube URL (with optional start and end time)
- Output: An MP4 video with meme images synchronized precisely to the lyrics
- No user interface required (CLI-based MVP)
- Automation: No manual tagging or editing
- Works entirely offline/local, except for:
  - LemonFox.ia for transcription
  - YouTube source for audio

---

## 🗂️ Project Structure

```
meme-music-gen/
├── src/
│   ├── index.js               # Main entry script
│   ├── puppeteerScraper.js    # Scrapes meme site, builds JSON
│   ├── keywordExtractor.js    # Extracts and scores keywords
│   ├── matchMemes.js          # Matches lyrics to memes
│   ├── renderSlides.js        # Creates slide HTML + animation per meme
│   ├── renderVideo.js         # Video orchestration (now uses MoviePy)
│   ├── moviepy_renderer.py    # Python script for precise video rendering
│   └── utils/
│       ├── timeHelpers.js     # Duration formatting, slicing
│       └── logger.js
├── memes.json                 # Meme keyword → URL map (scraped)
├── slides/                    # Rendered frames or animations
├── media/
│   ├── audio.mp3              # Trimmed audio from YouTube
│   └── output.mp4             # Final video
├── public/
│   └── template.html          # Slide layout template
├── requirements.txt           # Python dependencies for MoviePy
├── setup_moviepy.sh          # MoviePy setup script
├── .env
├── .gitignore
└── package.json
```

---

## 🚀 Setup & Installation

### 1. Node.js Dependencies
```bash
npm install
```

### 2. MoviePy Setup (Required for video rendering)
```bash
# Run the automated setup script
./setup_moviepy.sh

# Or install manually:
pip3 install -r requirements.txt
```

### 3. Environment Variables
Create a `.env` file:
```
# Optional: Add any API keys or configuration
```

---

## 🔁 Pipeline Flow

### Step 1: Input
- Accept a YouTube URL
- Allow the user to specify a `startTime` and `endTime` (e.g., `00:45` to `01:15`) to select a portion of the song
- Optional startTime and endTime (e.g. `00:45` to `01:15`)

### Step 2: Audio Extraction
- Use `yt-dlp` to download the video
- Extract audio to MP3 format
- Trim audio using `ffmpeg` if start/end specified

### Step 3: Transcription via LemonFox
- Use LemonFox.ia to get transcript + timestamps
- Parse output into array of `{ start, end, text }`

### Step 4: Keyword Extraction
- Use OpenAI GPT (e.g., gpt-4o) to extract and prioritize the most meme-relevant keyword from each lyric line
- Prompt GPT to return a single keyword per line based on emotion, tone, and cultural context
- Fallback to default keyword logic if API fails or returns invalid data
- For each line of lyrics:
  - Tokenize words
  - Score using POS priority (Named Entity > Verb > Adjective > Noun)
  - Remove stopwords
  - Select top scoring word(s)

### Step 5: Meme Matching
- Load `memes.json`
- For each keyword:
  - Find closest match (exact or fuzzy)
  - If no match, fallback to a default meme

### Step 6: Slide Rendering (Puppeteer)
- If a thumbnail image is provided, generate a special first slide (3–5s duration) using that meme before the main lyric-timed slides begin
- Load `template.html`
- Inject meme image (no lyrics)
- Add animation class (fade-in, zoom, etc.)
- Wait for animation to play (2–5s)
- Capture as PNG or short webm
- Save to `slides/`

### Step 7: Video Composition (FFmpeg)
- Stitch all slides in order using FFmpeg
- Add trimmed audio as background
- Export to `media/output.mp4`

---

## 🧰 External Tools + Services

| Purpose | Tool |
|--------|------|
| Audio download | `yt-dlp` |
| Audio trim / video render | `ffmpeg` |
| Transcription | LemonFox.ia |
| Slide capture | Puppeteer |
| Keyword analysis | OpenAI GPT API (preferred for smarter context-based scoring) |
| Meme source | Your meme website (scraped via Puppeteer) |

---

## 📦 memes.json Format

```json
[
  {
    "keywords": ["explode", "fire", "burn"],
    "url": "https://yourmemesite.com/img/burn-meme.jpg"
  },
  {
    "keywords": ["sad", "cry", "alone"],
    "url": "https://yourmemesite.com/img/sad-frog.jpg"
  }
]
```

Generated by `puppeteerScraper.js`

---

## 🌀 Animation Styles (CSS Classes)

- `.fade-in`
- `.zoom-in`
- `.slide-left`
- `.spin-in`
- Add via class on each render frame
- Set animation duration: 3–5s max

---

## 🔐 Notes + Assumptions

- Output is for personal use only
- Memes are sourced from a controlled local or hosted image set
- No user interface — CLI/script-only MVP
- Transcription accuracy is “good enough” — lyrics do not appear in the video
- All rendering happens locally with Puppeteer + FFmpeg
- No error recovery required in V1

---

## 🧪 Test Plan

- [ ] Input valid YouTube URL, get working MP4 output
- [ ] Skip lyric display, verify meme image timing feels good
- [ ] Handle YouTube video with start/end timestamps
- [ ] Slide animations render and play consistently
- [ ] At least 70% of lyrics result in meme match
- [ ] Fallback meme used when no match found
- [ ] Total video duration matches audio

---

## 📌 Future Enhancements (Post-MVP)

- Show lyrics on screen (optional)
- Let user edit or override matched memes
- Meme “style” selector (e.g. dark, sad, hype)
- Emoji overlays and text effects
- UI for uploading new memes and tagging them
- Host as a web app with render queue
