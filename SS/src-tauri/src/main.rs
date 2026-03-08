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
    let json_path = temp_dir.join("temp_subtitles.json");

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

    // Step 2: Transcribe with word-level timestamps
    emit_progress(&app, "transcribing", "Transcribing audio (this may take a while)...");
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut whisper_cmd = Command::new(&whisper_path);
    whisper_cmd.args([
        "-m", model_path.to_str().unwrap(),
        "-f", audio_path.to_str().unwrap(),
        "-oj", // Output JSON with word timestamps
        "-of", json_path.to_str().unwrap().trim_end_matches(".json")
    ]);
    #[cfg(target_os = "windows")]
    whisper_cmd.creation_flags(CREATE_NO_WINDOW);
    let whisper_status = whisper_cmd.status()
        .map_err(|_| "Whisper not found. Please reinstall the app.".to_string())?;

    if !whisper_status.success() {
        return Err("Transcription failed. The audio may be too short or silent.".to_string());
    }

    // Convert JSON with word timestamps to SRT
    let json_content = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Could not read transcription JSON: {}. File may not exist.", e))?;
    
    eprintln!("JSON file size: {} bytes", json_content.len());
    eprintln!("First 200 chars: {}", &json_content.chars().take(200).collect::<String>());
    
    let srt_content = json_to_srt(&json_content)
        .map_err(|e| format!("Could not process transcription: {}", e))?;

    if !skip_editor {
        emit_progress(&app, "editing", "Subtitles ready for editing");
        let _ = std::fs::remove_file(audio_path);
        let _ = std::fs::remove_file(&json_path);
        return Ok(srt_content);
    }

    let _ = std::fs::remove_file(audio_path);
    let _ = std::fs::remove_file(&json_path);

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

    let ass_content = srt_to_ass(&srt_content, &font_name, font_size, &primary_color, &outline_color, alignment, word_by_word, &word_mode);

    #[cfg(debug_assertions)]
    {
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let debug_path = std::path::Path::new(&home).join("Desktop").join("debug_subtitles.ass");
            let _ = std::fs::write(&debug_path, &ass_content);
        }
    }

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

fn srt_to_ass(srt: &str, font: &str, size: u32, primary: &str, outline: &str, alignment: u32, word_by_word: bool, word_mode: &str) -> String {
    let primary_ass = hex_to_ass_color(primary);
    let outline_ass = hex_to_ass_color(outline);
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

    let normalized = srt.replace("\r\n", "\n");
    
    if word_by_word && word_mode == "highlight" {
        // Split sentences into words with timing
        for block in normalized.trim().split("\n\n") {
            let block = block.trim();
            if block.is_empty() { continue; }
            
            let lines: Vec<&str> = block.lines().collect();
            if lines.len() < 3 { continue; }
            
            let timing = lines[1];
            let text = lines[2..].join(" ");
            
            if let Some((start, end)) = timing.split_once(" --> ") {
                let start_ass = srt_time_to_ass(start.trim());
                let end_ass = srt_time_to_ass(end.trim());
                
                // Clean and split into words
                let words: Vec<String> = text.chars()
                    .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                    .collect::<String>()
                    .split_whitespace()
                    .map(|s| s.to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                
                if words.is_empty() { continue; }
                
                // Calculate timing per word
                let start_ms = ass_time_to_ms(&start_ass);
                let end_ms = ass_time_to_ms(&end_ass);
                let duration_ms = end_ms - start_ms;
                let ms_per_word = if words.len() > 1 { duration_ms / words.len() as i64 } else { duration_ms };
                
                // Generate subtitle for each word with full sentence context
                for (i, _) in words.iter().enumerate() {
                    let word_start_ms = start_ms + (i as i64 * ms_per_word) - 100; // 100ms advance
                    let word_end_ms = start_ms + ((i + 1) as i64 * ms_per_word);
                    
                    let word_start = ms_to_ass_time(word_start_ms.max(0));
                    let word_end = ms_to_ass_time(word_end_ms);
                    
                    // Build sentence with current word highlighted
                    let mut highlighted = String::new();
                    for (j, word) in words.iter().enumerate() {
                        if j == i {
                            highlighted.push_str(&format!("{{\\c{}}}{}", &highlight_color, word));
                            highlighted.push_str(&format!("{{\\c{}}}", &primary_ass));
                        } else {
                            highlighted.push_str(word);
                        }
                        if j < words.len() - 1 {
                            highlighted.push(' ');
                        }
                    }
                    
                    ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", word_start, word_end, highlighted));
                }
            }
        }
        
        return ass;
    }
    
    // Solo mode or normal mode
    for block in normalized.trim().split("\n\n") {
        let block = block.trim();
        if block.is_empty() { continue; }
        
        let lines: Vec<&str> = block.lines().collect();
        if lines.len() < 3 { continue; }

        let timing = lines[1];
        let mut text = lines[2..].join("\\N");
        
        if word_by_word {
            text = text.chars()
                .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                .collect::<String>()
                .trim()
                .to_string();
            
            if text.is_empty() { continue; }
        }
        
        let text = text.replace("{", "\\{").replace("}", "\\}");

        if let Some((start, end)) = timing.split_once(" --> ") {
            let start_ass = srt_time_to_ass(start.trim());
            let end_ass = srt_time_to_ass(end.trim());
            
            if word_by_word && word_mode == "solo" {
                ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{{\\c{}}}{}\n", start_ass, end_ass, &highlight_color, text));
            } else {
                ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", start_ass, end_ass, text));
            }
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
        format!("&H00{}{}{}", b, g, r)
    } else {
        "&H00FFFFFF".to_string()
    }
}

fn srt_time_to_ass(srt_time: &str) -> String {
    let time = srt_time.trim();
    
    if let Some((time_part, ms_part)) = time.split_once(',') {
        let ms: u32 = ms_part.parse().unwrap_or(0);
        let cs = ms / 10;
        
        let parts: Vec<&str> = time_part.split(':').collect();
        if parts.len() == 3 {
            let hours: u32 = parts[0].parse().unwrap_or(0);
            let minutes = parts[1];
            let seconds = parts[2];
            
            return format!("{}:{:0>2}:{:0>2}.{:0>2}", hours, minutes, seconds, cs);
        }
    }
    
    time.replace(',', ".")
}

fn ass_time_to_ms(ass_time: &str) -> i64 {
    let parts: Vec<&str> = ass_time.split(':').collect();
    if parts.len() != 3 { return 0; }
    
    let hours: i64 = parts[0].parse().unwrap_or(0);
    let minutes: i64 = parts[1].parse().unwrap_or(0);
    
    let sec_parts: Vec<&str> = parts[2].split('.').collect();
    let seconds: i64 = sec_parts[0].parse().unwrap_or(0);
    let centis: i64 = if sec_parts.len() > 1 { sec_parts[1].parse().unwrap_or(0) } else { 0 };
    
    (hours * 3600000) + (minutes * 60000) + (seconds * 1000) + (centis * 10)
}

fn ms_to_ass_time(ms: i64) -> String {
    let hours = ms / 3600000;
    let remainder = ms % 3600000;
    let minutes = remainder / 60000;
    let remainder = remainder % 60000;
    let seconds = remainder / 1000;
    let centis = (remainder % 1000) / 10;
    
    format!("{}:{:02}:{:02}.{:02}", hours, minutes, seconds, centis)
}

fn calculate_duration_ms(start: &str, end: &str) -> i64 {
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

// Convert whisper JSON output with word timestamps to SRT format
fn json_to_srt(json: &str) -> Result<String, String> {
    use serde_json::Value;
    
    let data: Value = serde_json::from_str(json)
        .map_err(|e| format!("JSON parse error: {}", e))?;
    
    // Debug: print JSON structure
    eprintln!("JSON keys: {:?}", data.as_object().map(|o| o.keys().collect::<Vec<_>>()));
    
    let mut srt = String::new();
    let mut index = 1;
    
    // Try different JSON structures whisper might use
    
    // Structure 1: Check for "transcription" array
    if let Some(transcription) = data.get("transcription").and_then(|t| t.as_array()) {
        for segment in transcription {
            if let Some(timestamps) = segment.get("timestamps") {
                if let Some(words) = timestamps.get("word").and_then(|w| w.as_array()) {
                    for word_data in words {
                        if let (Some(word), Some(from), Some(to)) = (
                            word_data.get("word").and_then(|w| w.as_str()),
                            word_data.get("from").and_then(|f| f.as_f64()),
                            word_data.get("to").and_then(|t| t.as_f64())
                        ) {
                            let start = format_timestamp(from);
                            let end = format_timestamp(to);
                            
                            srt.push_str(&format!("{}\n{} --> {}\n{}\n\n", index, start, end, word.trim()));
                            index += 1;
                        }
                    }
                }
            }
        }
    }
    
    // Structure 2: Check for "segments" array (common whisper.cpp format)
    if srt.is_empty() {
        if let Some(segments) = data.get("segments").and_then(|s| s.as_array()) {
            for segment in segments {
                // Get segment text and timing for fallback
                let segment_text = segment.get("text").and_then(|t| t.as_str()).unwrap_or("");
                let segment_start = segment.get("start").and_then(|s| s.as_f64()).unwrap_or(0.0);
                let segment_end = segment.get("end").and_then(|e| e.as_f64()).unwrap_or(0.0);
                
                // Try to get word-level data
                if let Some(words) = segment.get("words").and_then(|w| w.as_array()) {
                    for word_obj in words {
                        if let (Some(word), Some(start), Some(end)) = (
                            word_obj.get("word").or(word_obj.get("text")).and_then(|w| w.as_str()),
                            word_obj.get("start").and_then(|s| s.as_f64()),
                            word_obj.get("end").and_then(|e| e.as_f64())
                        ) {
                            let start_ts = format_timestamp(start);
                            let end_ts = format_timestamp(end);
                            
                            srt.push_str(&format!("{}\n{} --> {}\n{}\n\n", index, start_ts, end_ts, word.trim()));
                            index += 1;
                        }
                    }
                } else {
                    // Fallback: use segment-level timing
                    let start_ts = format_timestamp(segment_start);
                    let end_ts = format_timestamp(segment_end);
                    srt.push_str(&format!("{}\n{} --> {}\n{}\n\n", index, start_ts, end_ts, segment_text.trim()));
                    index += 1;
                }
            }
        }
    }
    
    if srt.is_empty() {
        // Save JSON for debugging
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let debug_path = std::path::Path::new(&home).join("Desktop").join("debug_whisper.json");
            let _ = std::fs::write(&debug_path, json);
            eprintln!("Saved debug JSON to: {:?}", debug_path);
        }
        return Err("No word timestamps found in transcription. Check debug_whisper.json on Desktop.".to_string());
    }
    
    Ok(srt)
}

// Format seconds to SRT timestamp (HH:MM:SS,mmm)
fn format_timestamp(seconds: f64) -> String {
    let total_ms = (seconds * 1000.0) as i64;
    let hours = total_ms / 3600000;
    let remainder = total_ms % 3600000;
    let minutes = remainder / 60000;
    let remainder = remainder % 60000;
    let secs = remainder / 1000;
    let millis = remainder % 1000;
    
    format!("{:02}:{:02}:{:02},{:03}", hours, minutes, secs, millis)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![process_video, burn_subtitles])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}