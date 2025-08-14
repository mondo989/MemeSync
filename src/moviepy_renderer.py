#!/usr/bin/env python3
"""
MoviePy Video Renderer for Meme Sync
Replaces FFmpeg for precise timing and smooth transitions
"""

import sys
import json
import os
import tempfile
import argparse

try:
    from moviepy import (
        AudioFileClip, 
        ImageClip, 
        ColorClip, 
        CompositeVideoClip
    )
    # Import fade effects - using a more robust approach
    import moviepy.video.fx as fx
except ImportError as e:
    print(f"❌ Failed to import MoviePy: {e}")
    print("Please install MoviePy with: pip3 install moviepy")
    sys.exit(1)

def create_meme_video(slides_data, audio_path, output_path, database='apu'):
    """
    Create video with precise timing and smooth transitions using MoviePy
    
    Args:
        slides_data: List of slide objects with timing and image paths
        audio_path: Path to audio file
        output_path: Output video path
        database: Database type ('apu', 'bobo', 'other') for opening slide selection
    """
    
    print(f"🎬 MoviePy: Creating video with {len(slides_data)} slides")
    
    try:
        # Load audio clip as master timeline
        audio_clip = AudioFileClip(audio_path)
        audio_duration = audio_clip.duration
        print(f"🎵 Audio duration: {audio_duration:.3f}s")
        
        # Define transition settings
        transition_duration = 0.6  # 0.6 second smooth crossfade
        
        # Find the time gap before first slide (this is where we'll show the opening slide)
        first_slide_start = min(slide['startTime'] for slide in slides_data) if slides_data else 0
        opening_duration = first_slide_start if first_slide_start > 0 else 0
        
        # Calculate expected video duration
        expected_duration = max(slide['endTime'] for slide in slides_data)
        expected_duration = min(expected_duration, audio_duration)
        print(f"📏 Expected video duration: {expected_duration:.3f}s")
        
        # Create video clips
        video_clips = []
        
        # Create opening slide if needed
        if opening_duration > 0:
            elements_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'elements')
            opening_image_path = None
            
            if database == 'bobo':
                slide_logo_path = os.path.join(elements_dir, 'bobo-slide.png')
                logo_path = os.path.join(elements_dir, 'bobo-logo.svg')
                opening_image_path = slide_logo_path if os.path.exists(slide_logo_path) else (logo_path if os.path.exists(logo_path) else None)
            elif database == 'apu':
                slide_logo_path = os.path.join(elements_dir, 'apu-slide.png')
                logo_path = os.path.join(elements_dir, 'apu-logo.svg')
                opening_image_path = slide_logo_path if os.path.exists(slide_logo_path) else (logo_path if os.path.exists(logo_path) else None)
            
            if opening_image_path:
                try:
                    opening_clip = ImageClip(opening_image_path, duration=opening_duration)
                    opening_clip = opening_clip.resized(height=1080).with_position('center').with_start(0)
                    
                    # Add fade out at the end using built-in effect
                    opening_clip = opening_clip.with_effects([fx.FadeOut(transition_duration/2)])
                    video_clips.append(opening_clip)
                    print(f"  🎬 Created opening slide with fade-out: {opening_duration:.3f}s")
                    
                except Exception as e:
                    print(f"  ⚠️  Failed to create opening slide: {e}")
        
        # Create main slide clips with crossfade transitions
        for i, slide in enumerate(slides_data):
            start_time = slide['startTime']
            end_time = slide['endTime']
            duration = end_time - start_time
            image_path = slide['path']
            
            print(f"  📸 Slide {i+1}: {start_time:.3f}s-{end_time:.3f}s ({duration:.3f}s)")
            
            # Create base image clip
            img_clip = ImageClip(image_path, duration=duration)
            img_clip = img_clip.resized(height=1080).with_position('center').with_start(start_time)
            
            # Apply crossfade transitions using built-in effects
            effects = []
            
            # Fade in for first slide or if there's an opening
            if i == 0:
                if opening_duration > 0:
                    effects.append(fx.FadeIn(transition_duration/2))
                    print(f"  ✨ Added fade-in from opening to slide {i+1}")
                else:
                    effects.append(fx.FadeIn(transition_duration/2))
                    print(f"  ✨ Added fade-in from black to slide {i+1}")
            else:
                # For slides after the first, create crossfade overlap
                effects.append(fx.FadeIn(transition_duration))
                print(f"  ✨ Added crossfade transition to slide {i+1}")
            
            # Fade out for transitions between slides
            if i < len(slides_data) - 1:
                effects.append(fx.FadeOut(transition_duration))
                print(f"  ✨ Added fade-out from slide {i+1}")
            else:
                # Last slide fades to black
                effects.append(fx.FadeOut(transition_duration/2))
                print(f"  ✨ Added final fade-out from slide {i+1}")
            
            # Apply all effects
            if effects:
                img_clip = img_clip.with_effects(effects)
            
            video_clips.append(img_clip)
        
        print(f"  🎬 Created {len(video_clips)} clips with smooth crossfade transitions")
        
        # Create black background
        background = ColorClip(size=(1920, 1080), color=(0, 0, 0), duration=expected_duration)
        
        # Composite all clips together
        print(f"🎭 Compositing {len(video_clips)} clips with smooth transitions...")
        all_clips = [background] + video_clips
        final_video = CompositeVideoClip(all_clips)
        
        # Set audio and duration
        final_video = final_video.with_audio(audio_clip).with_duration(expected_duration)
        
        print(f"🎥 Rendering video with smooth {transition_duration}s crossfade transitions...")
        print(f"⏱️  Final duration: {final_video.duration:.3f}s")
        print(f"✨ Using MoviePy's built-in fade effects for reliable transitions")
        
        # Render with optimized settings for smooth transitions
        final_video.write_videofile(
            output_path,
            fps=30,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            preset='medium',  # Good balance of quality and speed
            ffmpeg_params=[
                '-crf', '20',        # High quality
                '-b:v', '6000k',     # Good bitrate for transitions
                '-b:a', '256k',      # High audio quality
                '-profile:v', 'high',
                '-level:v', '4.1',
                '-movflags', '+faststart',
                '-pix_fmt', 'yuv420p'  # Ensure compatibility
            ]
        )
        
        print(f"✅ Video rendered successfully with beautiful smooth crossfade transitions!")
        print(f"📁 Output: {output_path}")
        print(f"🎬 Transition style: Smooth crossfade ({transition_duration}s)")
        
        # Clean up
        audio_clip.close()
        final_video.close()
        for clip in video_clips:
            clip.close()
        
        return True
        
    except Exception as e:
        print(f"❌ MoviePy rendering failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Main function to handle command line arguments"""
    parser = argparse.ArgumentParser(description='MoviePy Video Renderer for Meme Sync')
    parser.add_argument('--slides', required=True, help='JSON file with slides data')
    parser.add_argument('--audio', required=True, help='Path to audio file')
    parser.add_argument('--output', required=True, help='Output video path')
    parser.add_argument('--database', default='apu', help='Database type (apu, bobo, other) for opening slide selection')
    
    args = parser.parse_args()
    
    # Load slides data
    try:
        with open(args.slides, 'r') as f:
            slides_data = json.load(f)
    except Exception as e:
        print(f"❌ Failed to load slides data: {e}")
        sys.exit(1)
    
    # Create video
    success = create_meme_video(slides_data, args.audio, args.output, args.database)
    
    if success:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main() 