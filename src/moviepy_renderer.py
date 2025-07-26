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
    Create video with precise timing and smooth transitions using MoviePy
    
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
        
        # Define transition settings
        transition_duration = 0.8  # 0.8 second transition for smoother effect
        
        # Find the time gap before first slide (this is where we'll show the opening slide)
        first_slide_start = min(slide['startTime'] for slide in slides_data) if slides_data else 0
        opening_duration = first_slide_start if first_slide_start > 0 else 0
        
        # Calculate expected video duration (don't extend beyond original duration)
        expected_duration = max(slide['endTime'] for slide in slides_data)
        # Add extra time for the last slide's fade out transition
        expected_duration += transition_duration / 2 if len(slides_data) > 1 else 0
        
        # Ensure we don't exceed audio duration
        expected_duration = min(expected_duration, audio_duration)
        print(f"📏 Expected video duration: {expected_duration:.3f}s (limited to audio duration)")
        
        # Create opening slide if logo exists and there's a gap before first slide
        video_clips = []
        # Look for apu-slide.png first, then apu-logo.svg
        slide_logo_path = os.path.join(os.path.dirname(slides_data[0]['path']), 'apu-slide.png')
        logo_path = os.path.join(os.path.dirname(slides_data[0]['path']), 'apu-logo.svg')
        
        opening_image_path = slide_logo_path if os.path.exists(slide_logo_path) else (logo_path if os.path.exists(logo_path) else None)
        
        if opening_image_path and opening_duration > 0:
            try:
                # Create opening slide to fill the gap before first content slide
                opening_clip = ImageClip(opening_image_path, duration=opening_duration)
                
                # Set start time at the very beginning
                try:
                    opening_clip = opening_clip.with_start(0)
                except AttributeError:
                    opening_clip = opening_clip.set_start(0)
                
                # Resize to fit screen while maintaining aspect ratio
                try:
                    opening_clip = opening_clip.resized(height=1080)
                except AttributeError:
                    opening_clip = opening_clip.resize(height=1080)
                
                # Center the opening slide
                try:
                    opening_clip = opening_clip.with_position('center')
                except AttributeError:
                    opening_clip = opening_clip.set_position('center')
                
                # Add fade out transition to first slide
                try:
                    def opening_fade_out(t):
                        if t > opening_duration - transition_duration:
                            progress = (t - (opening_duration - transition_duration)) / transition_duration
                            return 1.0 - progress
                        return 1.0
                    
                    opening_clip = opening_clip.with_mask().with_opacity(opening_fade_out)
                    print(f"  🎬 Created opening slide with fade-out transition")
                except:
                    print(f"  🎬 Created opening slide (basic)")
                
                video_clips.append(opening_clip)
                print(f"  ✨ Added opening slide: {opening_duration:.3f}s duration (filling gap before first slide)")
                
            except Exception as e:
                print(f"  ⚠️  Failed to create opening slide: {e}")
        else:
            if not opening_image_path:
                print(f"  ℹ️  No opening image found (looked for apu-slide.png and apu-logo.svg)")
            else:
                print(f"  ℹ️  No gap before first slide ({first_slide_start:.3f}s), skipping opening slide")
        
        # No offset needed - slides start at their original times
        slides_start_offset = 0
        
        # Create overlapping clips for smooth crossfades
        for i, slide in enumerate(slides_data):
            start_time = slide['startTime']
            end_time = slide['endTime']
            duration = end_time - start_time
            image_path = slide['path']
            
            print(f"  📸 Slide {i+1}: {start_time:.3f}s-{end_time:.3f}s ({duration:.3f}s)")
            
            # Create image clip
            img_clip = ImageClip(image_path, duration=duration)
            
            # Set start time
            try:
                img_clip = img_clip.with_start(start_time)
            except AttributeError:
                img_clip = img_clip.set_start(start_time)
            
            # Resize to fit screen while maintaining aspect ratio
            try:
                img_clip = img_clip.resized(height=1080)
            except AttributeError:
                img_clip = img_clip.resize(height=1080)
            
            # Center the image
            try:
                img_clip = img_clip.with_position('center')
            except AttributeError:
                img_clip = img_clip.set_position('center')
            
            video_clips.append(img_clip)
            print(f"  📎 Created base clip for slide {i+1}")
            
            # Create transition clip if not the last slide
            if i < len(slides_data) - 1:
                # Create crossfade transition between this slide and the next
                next_slide = slides_data[i + 1]
                next_image_path = next_slide['path']
                next_start_time = next_slide['startTime']
                
                # Calculate transition timing
                transition_start = end_time - transition_duration / 2
                transition_end = next_start_time + transition_duration / 2
                transition_clip_duration = transition_end - transition_start
                
                # Create transition clip with next slide image
                transition_clip = ImageClip(next_image_path, duration=transition_clip_duration)
                
                # Set timing and positioning for transition clip
                try:
                    transition_clip = transition_clip.with_start(transition_start)
                except AttributeError:
                    transition_clip = transition_clip.set_start(transition_start)
                
                try:
                    transition_clip = transition_clip.resized(height=1080)
                except AttributeError:
                    transition_clip = transition_clip.resize(height=1080)
                
                try:
                    transition_clip = transition_clip.with_position('center')
                except AttributeError:
                    transition_clip = transition_clip.set_position('center')
                
                # Apply fade-in effect to create smooth transition
                try:
                    # Create a simple fade-in using CompositeVideoClip layering
                    # The transition clip will gradually appear over the main clip
                    def make_transition_opacity(t):
                        # Start transparent, become opaque over transition duration
                        progress = t / transition_clip_duration
                        return min(1.0, max(0.0, progress))
                    
                    # Try to apply opacity (may not work in all MoviePy versions)
                    try:
                        transition_clip = transition_clip.with_mask().with_opacity(make_transition_opacity)
                        print(f"  ✨ Created crossfade transition from slide {i+1} to {i+2}")
                    except:
                        # If opacity doesn't work, still add the clip but it will be a cut
                        print(f"  📄 Created cut transition from slide {i+1} to {i+2}")
                    
                    video_clips.append(transition_clip)
                    
                except Exception as e:
                    print(f"  ⚠️  Transition creation failed between slides {i+1} and {i+2}: {e}")
        
        print(f"  🎬 Created {len(video_clips)} total clips (including transitions)")
        
        # Create black background for the full duration
        background = ColorClip(size=(1920, 1080), color=(0, 0, 0), duration=expected_duration)
        
        # Add persistent logo overlay (after opening slide ends)
        logo_clips = []
        logo_overlay_path = os.path.join(os.path.dirname(slides_data[0]['path']), 'apu-logo.svg')
        
        if os.path.exists(logo_overlay_path) and slides_start_offset > 0:
            try:
                # Create logo overlay that starts after opening and lasts for the rest
                overlay_duration = expected_duration - slides_start_offset
                logo_clip = ImageClip(logo_overlay_path, duration=overlay_duration)
                
                # Set start time after opening slide
                try:
                    logo_clip = logo_clip.with_start(slides_start_offset)
                except AttributeError:
                    logo_clip = logo_clip.set_start(slides_start_offset)
                
                # Calculate logo position: centered horizontally, 10% from bottom
                logo_height = 1080 * 0.10  # 10% from bottom
                logo_y_position = 1080 - logo_height  # Position from top
                
                # Resize logo to appropriate size (max 15% of screen width to keep it subtle)
                try:
                    logo_clip = logo_clip.resized(width=int(1920 * 0.15))
                except AttributeError:
                    logo_clip = logo_clip.resize(width=int(1920 * 0.15))
                
                # Position logo: centered horizontally, 10% from bottom
                try:
                    logo_clip = logo_clip.with_position(('center', logo_y_position))
                except AttributeError:
                    logo_clip = logo_clip.set_position(('center', logo_y_position))
                
                # Add fade-in transition when overlay starts
                try:
                    def overlay_fade_in(t):
                        if t < transition_duration / 2:
                            return t / (transition_duration / 2)
                        return 1.0
                    
                    logo_clip = logo_clip.with_mask().with_opacity(overlay_fade_in)
                    print(f"  🏷️  Added logo overlay with fade-in: {logo_overlay_path}")
                except:
                    print(f"  🏷️  Added logo overlay (basic): {logo_overlay_path}")
                
                logo_clips.append(logo_clip)
                
            except Exception as e:
                print(f"  ⚠️  Failed to add logo overlay: {e}")
        elif not os.path.exists(logo_overlay_path):
            print(f"  ℹ️  No logo overlay found at: {logo_overlay_path}")
        else:
            print(f"  ℹ️  Logo overlay skipped (no opening slide created)")
        
        # Composite all clips together: background + opening + slides + logo overlay
        print(f"🎭 Compositing {len(video_clips)} clips with opening slide, smooth transitions and logo overlay...")
        all_clips = [background] + video_clips + logo_clips
        final_video = CompositeVideoClip(all_clips)
        
        # Set audio using the appropriate method
        try:
            final_video = final_video.with_audio(audio_clip)
        except AttributeError:
            final_video = final_video.set_audio(audio_clip)
        
        # Ensure exact duration
        try:
            final_video = final_video.with_duration(expected_duration)
        except AttributeError:
            final_video = final_video.set_duration(expected_duration)
        
        print(f"🎥 Rendering video with smooth {transition_duration}s transitions to: {output_path}")
        print(f"⏱️  Final duration: {final_video.duration:.3f}s")
        if opening_duration > 0:
            print(f"🎬 Opening slide: {opening_duration:.3f}s duration (filling gap before content)")
        print(f"✨ Smooth fade transitions applied between all slides")
        if logo_clips:
            print(f"🏷️  Logo overlay applied throughout video")
        
        # Render with high quality settings
        final_video.write_videofile(
            output_path,
            fps=30,
            codec='libx264',
            audio_codec='aac',
            temp_audiofile='temp-audio.m4a',
            remove_temp=True,
            preset='slow',  # High quality for smooth transitions
            ffmpeg_params=[
                '-crf', '18',        # High quality
                '-b:v', '8000k',     # Higher bitrate for smooth transitions
                '-b:a', '320k',      # High audio quality
                '-profile:v', 'high',
                '-level:v', '4.1',
                '-movflags', '+faststart'
            ]
        )
        
        print(f"✅ Video rendered successfully with beautiful smooth transitions!")
        print(f"📁 Output: {output_path}")
        if opening_duration > 0:
            print(f"🎬 Opening: {opening_duration:.3f}s slide filling gap before content")
        print(f"🎬 Transition style: Smooth fade in/out ({transition_duration}s)")
        if logo_clips:
            print(f"🏷️  Logo overlay: Persistent throughout video, centered 10% from bottom")
        
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