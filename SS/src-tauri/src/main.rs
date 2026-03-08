#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use tauri::{Manager, Emitter};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn emit_progress(app: &tauri::AppHandle, step: &str, message: &str) {
    let _ = app.emit("progress", serde_json::json!({
        "step": step,
        "message": message
    }));
}

#[tauri::command]
async fn process_video(app: tauri::AppHandle, video_path: String, _output_path: String, skip_editor: bool) -> Result<String, String> {
    let resource_path = app.path().resource_dir()
        .map_err(|_| "Could not locate app resources".to_string())?;

    #[cfg(target_os = "windows")]
    let ffmpeg_path = resource_path.join("resources/binaries/ffmpeg.exe");
    #[cfg(not(target_os = "windows"))]
    let ffmpeg_path = resource_path.join("binaries/ffmpeg");

    #[cfg(target_os = "windows")]
    let whisper_path = resource_path.join("resources/whisper-cli.exe");
    #[cfg(not(target_os = "windows"))]
    let whisper_path = resource_path.join("whisper-cli");

    #[cfg(target_os = "windows")]
    let model_path = resource_path.join("resources/ggml-tiny.bin");
    #[cfg(not(target_os = "windows"))]
    let model_path = resource_path.join("ggml-tiny.bin");

    let temp_dir = std::env::temp_dir();
    let audio_path = temp_dir.join("temp_audio.wav");
    let srt_path = temp_dir.join("temp_subtitles.srt");

    // Step 1: Extract audio
    emit_progress(&app, "extracting", "Extracting audio from video...");
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut extract_cmd = Command::new(&ffmpeg_path);
    extract_cmd.args([
        "-i", &video_path,
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        "-y",
        audio_path.to_str().unwrap()
    ]);
    #[cfg(target_os = "windows")]
    extract_cmd.creation_flags(CREATE_NO_WINDOW);
    let extract_status = extract_cmd.status()
        .map_err(|_| "FFmpeg not found. Please reinstall the app.".to_string())?;

    if !extract_status.success() {
        return Err("Could not extract audio. Is the video file valid?".to_string());
    }

    // Step 2: Transcribe
    emit_progress(&app, "transcribing", "Transcribing audio (this may take a while)...");
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut whisper_cmd = Command::new(&whisper_path);
    whisper_cmd.args([
        "-m", model_path.to_str().unwrap(),
        "-f", audio_path.to_str().unwrap(),
        "-ml", "1", // Word-level output
        "-osrt",
        "-of", srt_path.to_str().unwrap().trim_end_matches(".srt")
    ]);
    #[cfg(target_os = "windows")]
    whisper_cmd.creation_flags(CREATE_NO_WINDOW);
    let whisper_status = whisper_cmd.status()
        .map_err(|_| "Whisper not found. Please reinstall the app.".to_string())?;

    if !whisper_status.success() {
        return Err("Transcription failed. The audio may be too short or silent.".to_string());
    }

    // If skip_editor is false, return the SRT content for editing
    if !skip_editor {
        let srt_content = std::fs::read_to_string(&srt_path)
            .map_err(|_| "Could not read generated subtitles.".to_string())?;
        emit_progress(&app, "editing", "Subtitles ready for editing");
        let _ = std::fs::remove_file(audio_path);
        return Ok(srt_content);
    }

    // Cleanup temp files
    let _ = std::fs::remove_file(audio_path);
    let _ = std::fs::remove_file(&srt_path);

    emit_progress(&app, "done", "Done!");
    Ok(String::new())
}

#[tauri::command]
async fn burn_subtitles(
    app: tauri::AppHandle, 
    video_path: String, 
    output_path: String, 
    srt_content: String,
    font_name: String,
    font_size: u32,
    primary_color: String,
    outline_color: String,
    alignment: u32,
    word_by_word: bool,
    word_mode: String
) -> Result<(), String> {
    let resource_path = app.path().resource_dir()
        .map_err(|_| "Could not locate app resources".to_string())?;

    #[cfg(target_os = "windows")]
    let ffmpeg_path = resource_path.join("resources/binaries/ffmpeg.exe");
    #[cfg(not(target_os = "windows"))]
    let ffmpeg_path = resource_path.join("binaries/ffmpeg");

    let temp_dir = std::env::temp_dir();
    let ass_path = temp_dir.join("edited_subtitles.ass");

    // Convert SRT to ASS with styling
    let ass_content = srt_to_ass(&srt_content, &font_name, font_size, &primary_color, &outline_color, alignment, word_by_word, &word_mode);

    // Debug: save a copy to desktop if possible for inspection
    #[cfg(debug_assertions)]
    {
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let debug_path = std::path::Path::new(&home).join("Desktop").join("debug_subtitles.ass");
            let _ = std::fs::write(&debug_path, &ass_content);
            eprintln!("Debug ASS file saved to: {:?}", debug_path);
        }
    }

    // Write ASS to temp file
    std::fs::write(&ass_path, ass_content)
        .map_err(|_| "Could not save edited subtitles.".to_string())?;

    emit_progress(&app, "burning", "Burning subtitles into video...");

    #[cfg(target_os = "windows")]
    let ass_escaped = ass_path.to_str().unwrap()
        .replace("\\", "/")
        .replace(":", "\\:");
    #[cfg(not(target_os = "windows"))]
    let ass_escaped = ass_path.to_str().unwrap().to_string();

    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut burn_cmd = Command::new(&ffmpeg_path);
    burn_cmd.args([
        "-i", &video_path,
        "-vf", &format!("ass='{}'", ass_escaped),
        "-c:v", "libx264",
        "-c:a", "copy",
        "-y",
        &output_path
    ]);
    #[cfg(target_os = "windows")]
    burn_cmd.creation_flags(CREATE_NO_WINDOW);
    let burn_status = burn_cmd.status()
        .map_err(|_| "FFmpeg not found. Please reinstall the app.".to_string())?;

    if !burn_status.success() {
        return Err("Could not burn subtitles. Check that the output path is writable.".to_string());
    }

    let _ = std::fs::remove_file(&ass_path);

    emit_progress(&app, "done", "Done!");
    Ok(())
}

// Convert SRT to ASS with styling
fn srt_to_ass(srt: &str, font: &str, size: u32, primary: &str, outline: &str, alignment: u32, word_by_word: bool, word_mode: &str) -> String {
    // Convert hex colors to ASS format (&HAABBGGRR)
    let primary_ass = hex_to_ass_color(primary);
    let outline_ass = hex_to_ass_color(outline);
    
    // For word-by-word, use yellow highlight color
    let highlight_color = if word_by_word { "&H00FFFF".to_string() } else { primary_ass.clone() };

    let mut ass = format!(
r#"[Script Info]
Title: Subtitles
ScriptType: v4.00+
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{},{},{},{},{},&H80000000,0,0,0,0,100,100,0,0,1,2,0,{},10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"#, font, size, primary_ass, primary_ass, outline_ass, alignment);

    // Parse SRT and convert to ASS
    // Handle both Unix (\n) and Windows (\r\n) line endings
    let normalized = srt.replace("\r\n", "\n");
    
    for block in normalized.trim().split("\n\n") {
        let block = block.trim();
        if block.is_empty() { continue; }
        
        let lines: Vec<&str> = block.lines().collect();
        if lines.len() < 3 { 
            eprintln!("Skipping invalid block: {:?}", lines);
            continue; 
        }

        let timing = lines[1];
        let text = lines[2..].join("\\N");

        if let Some((start, end)) = timing.split_once(" --> ") {
            let start_ass = srt_time_to_ass(start.trim());
            let end_ass = srt_time_to_ass(end.trim());
            
            let text_escaped = text.replace("{", "\\{").replace("}", "\\}");
            
            // Word-by-word mode
            if word_by_word {
                // With -ml 1, each subtitle block is already a single word with correct timing
                // Just add a small advance for highlight mode
                if word_mode == "highlight" {
                    // Show highlight 100ms early for better sync
                    let start_ms = ass_time_to_ms(&start_ass).saturating_sub(100);
                    let adjusted_start = ms_to_ass_time(start_ms);
                    ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{{\\c{}}}{}\n", adjusted_start, end_ass, &highlight_color, text_escaped));
                } else {
                    // Solo mode: use exact timing
                    ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", start_ass, end_ass, text_escaped));
                }
                continue;
            }
            
            // Normal mode or single word
            ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", start_ass, end_ass, text_escaped));
        } else {
            eprintln!("Invalid timing format: {}", timing);
        }
    }

    ass
}

fn hex_to_ass_color(hex: &str) -> String {
    let hex = hex.trim_start_matches('#');
    if hex.len() == 6 {
        let r = &hex[0..2];
        let g = &hex[2..4];
        let b = &hex[4..6];
        format!("&H00{}{}{}", b, g, r) // ASS uses BGR
    } else {
        "&H00FFFFFF".to_string() // Default white
    }
}

fn srt_time_to_ass(srt_time: &str) -> String {
    // Convert 00:00:10,500 to 0:00:10.50
    // SRT format: HH:MM:SS,mmm
    // ASS format: H:MM:SS.cc (centiseconds, not milliseconds)
    
    let time = srt_time.trim();
    
    // Split by comma to separate seconds from milliseconds
    if let Some((time_part, ms_part)) = time.split_once(',') {
        // Convert milliseconds to centiseconds (divide by 10)
        let ms: u32 = ms_part.parse().unwrap_or(0);
        let cs = ms / 10; // Convert to centiseconds
        
        // Parse HH:MM:SS
        let parts: Vec<&str> = time_part.split(':').collect();
        if parts.len() == 3 {
            let hours: u32 = parts[0].parse().unwrap_or(0);
            let minutes = parts[1];
            let seconds = parts[2];
            
            // ASS format: H:MM:SS.cc (no leading zero on hours)
            return format!("{}:{:0>2}:{:0>2}.{:0>2}", hours, minutes, seconds, cs);
        }
    }
    
    // Fallback
    time.replace(',', ".")
}

// Convert ASS time to milliseconds for calculation
fn ass_time_to_ms(ass_time: &str) -> i64 {
    // Format: H:MM:SS.cc
    let parts: Vec<&str> = ass_time.split(':').collect();
    if parts.len() != 3 { return 0; }
    
    let hours: i64 = parts[0].parse().unwrap_or(0);
    let minutes: i64 = parts[1].parse().unwrap_or(0);
    
    let sec_parts: Vec<&str> = parts[2].split('.').collect();
    let seconds: i64 = sec_parts[0].parse().unwrap_or(0);
    let centis: i64 = if sec_parts.len() > 1 { sec_parts[1].parse().unwrap_or(0) } else { 0 };
    
    (hours * 3600000) + (minutes * 60000) + (seconds * 1000) + (centis * 10)
}

// Convert milliseconds back to ASS time
fn ms_to_ass_time(ms: i64) -> String {
    let hours = ms / 3600000;
    let remainder = ms % 3600000;
    let minutes = remainder / 60000;
    let remainder = remainder % 60000;
    let seconds = remainder / 1000;
    let centis = (remainder % 1000) / 10;
    
    format!("{}:{:02}:{:02}.{:02}", hours, minutes, seconds, centis)
}

// Calculate duration between two SRT timestamps in milliseconds
fn calculate_duration_ms(start: &str, end: &str) -> i64 {
    // SRT format: HH:MM:SS,mmm
    let parse_srt_to_ms = |time: &str| -> i64 {
        let parts: Vec<&str> = time.split(':').collect();
        if parts.len() != 3 { return 0; }
        
        let hours: i64 = parts[0].parse().unwrap_or(0);
        let minutes: i64 = parts[1].parse().unwrap_or(0);
        
        let sec_parts: Vec<&str> = parts[2].split(',').collect();
        let seconds: i64 = sec_parts[0].parse().unwrap_or(0);
        let millis: i64 = if sec_parts.len() > 1 { sec_parts[1].parse().unwrap_or(0) } else { 0 };
        
        (hours * 3600000) + (minutes * 60000) + (seconds * 1000) + millis
    };
    
    parse_srt_to_ms(end) - parse_srt_to_ms(start)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![process_video, burn_subtitles])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}