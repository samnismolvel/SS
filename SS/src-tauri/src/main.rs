use std::process::Command;
use tauri::Manager;

#[tauri::command]
fn process_video(app: tauri::AppHandle, video_path: String, output_path: String) -> Result<(), String> {
    // Get paths to bundled resources
    let resource_path = app.path().resource_dir()
        .map_err(|e| format!("Failed to get resource directory: {}", e))?;
    
    let ffmpeg_path = resource_path.join("binaries/ffmpeg");
    let whisper_path = resource_path.join("whisper-cli");
    let model_path = resource_path.join("ggml-tiny.bin");
    
    // Create temp directory for intermediate files
    let temp_dir = std::env::temp_dir();
    let audio_path = temp_dir.join("temp_audio.wav");
    let srt_path = temp_dir.join("temp_subtitles.srt");

    // Step 1: Extract audio from video using FFmpeg
    println!("Extracting audio...");
    let extract_status = Command::new(&ffmpeg_path)
        .args([
            "-i", &video_path,
            "-vn", // No video
            "-acodec", "pcm_s16le",
            "-ar", "16000", // 16kHz sample rate (whisper requirement)
            "-ac", "1", // Mono
            "-y", // Overwrite output
            audio_path.to_str().unwrap()
        ])
        .status()
        .map_err(|e| format!("Failed to run FFmpeg: {}", e))?;

    if !extract_status.success() {
        return Err("FFmpeg audio extraction failed".to_string());
    }

    // Step 2: Transcribe audio using whisper.cpp
    println!("Transcribing audio...");
    let whisper_status = Command::new(&whisper_path)
        .args([
            "-m", model_path.to_str().unwrap(),
            "-f", audio_path.to_str().unwrap(),
            "-osrt", // Output SRT format
            "-of", srt_path.to_str().unwrap().trim_end_matches(".srt")
        ])
        .status()
        .map_err(|e| format!("Failed to run whisper.cpp: {}", e))?;

    if !whisper_status.success() {
        return Err("Whisper transcription failed".to_string());
    }

    // Step 3: Burn subtitles into video using FFmpeg
    println!("Burning subtitles...");
    let srt_escaped = srt_path.to_str().unwrap().replace("\\", "/").replace(":", "\\:");
    
    let burn_status = Command::new(&ffmpeg_path)
        .args([
            "-i", &video_path,
            "-vf", &format!("subtitles={}", srt_escaped),
            "-c:a", "copy", // Copy audio without re-encoding
            "-y",
            &output_path
        ])
        .status()
        .map_err(|e| format!("Failed to burn subtitles: {}", e))?;

    if !burn_status.success() {
        return Err("Subtitle burning failed".to_string());
    }

    // Cleanup temp files
    let _ = std::fs::remove_file(audio_path);
    let _ = std::fs::remove_file(&srt_path);

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![process_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}