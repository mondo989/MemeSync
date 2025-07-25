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
except ImportError as e:
    print(f"❌ Failed to import MoviePy: {e}")
    print("Please install MoviePy with: pip3 install moviepy")
    sys.exit(1)

def create_meme_video(slides_data, audio_path, output_path):
    """
    Create video with precise timing using MoviePy
    
    Args:
        slides_data: List of slide objects with timing and image paths
        audio_path: Path to audio file
        output_path: Output video path
    """
    
    print(f"🎬 MoviePy: Creating video with {len(slides_data)} slides")
    
    try:
        # Load audio clip as master timeline
        audio_clip = AudioFileClip(audio_path)
        audio_duration = audio_clip.duration
        print(f"🎵 Audio duration: {audio_duration:.3f}s")
        
        # Calculate expected video duration from slides
        expected_duration = max(slide['endTime'] for slide in slides_data)
        print(f"📏 Expected video duration: {expected_duration:.3f}s")
        
        # Create video clips for each slide
        video_clips = []
        
        for i, slide in enumerate(slides_data):
            start_time = slide['startTime']
            end_time = slide['endTime']
            duration = end_time - start_time
            image_path = slide['path']
            
            print(f"  📸 Slide {i+1}: {start_time:.3f}s-{end_time:.3f}s ({duration:.3f}s)")
            
            # Create image clip with duration parameter
            img_clip = ImageClip(image_path, duration=duration)
            
            # Set start time - check if with_start method exists
            try:
                img_clip = img_clip.with_start(start_time)
            except AttributeError:
                # Fallback for older API
                img_clip = img_clip.set_start(start_time)
            
            # Resize to fit screen
            try:
                img_clip = img_clip.resized(height=1080)
            except AttributeError:
                # Fallback for older API
                img_clip = img_clip.resize(height=1080)
            
            # Set position to center
            try:
                img_clip = img_clip.with_position('center')
            except AttributeError:
                # Fallback for older API
                img_clip = img_clip.set_position('center')
            
            video_clips.append(img_clip)
        
        # Create black background for the full duration
        background = ColorClip(size=(1920, 1080), color=(0, 0, 0), duration=expected_duration)
        
        # Composite all clips together
        final_video = CompositeVideoClip([background] + video_clips)
        
        # Set audio - check if with_audio method exists
        try:
            final_video = final_video.with_audio(audio_clip)
        except AttributeError:
            # Fallback for older API
            final_video = final_video.set_audio(audio_clip)
        
        # Ensure exact duration
        try:
            final_video = final_video.with_duration(expected_duration)
        except AttributeError:
            # Fallback for older API
            final_video = final_video.set_duration(expected_duration)
        
        print(f"🎥 Rendering video to: {output_path}")
        print(f"⏱️  Final duration: {final_video.duration:.3f}s")
        
        # Render with high quality settings
        final_video.write_videofile(
            output_path,
            fps=30,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            preset='slow',  # High quality
            ffmpeg_params=[
                '-crf', '18',        # High quality
                '-b:v', '5000k',     # High bitrate
                '-b:a', '320k',      # High audio quality
                '-profile:v', 'high',
                '-level:v', '4.1',
                '-movflags', '+faststart'
            ]
        )
        
        print(f"✅ Video rendered successfully!")
        print(f"📁 Output: {output_path}")
        
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
    
    args = parser.parse_args()
    
    # Load slides data
    try:
        with open(args.slides, 'r') as f:
            slides_data = json.load(f)
    except Exception as e:
        print(f"❌ Failed to load slides data: {e}")
        sys.exit(1)
    
    # Create video
    success = create_meme_video(slides_data, args.audio, args.output)
    
    if success:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == "__main__":
    main() 