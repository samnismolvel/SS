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
        "-ml", "1",
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

    if !skip_editor {
        let srt_content = std::fs::read_to_string(&srt_path)
            .map_err(|_| "Could not read generated subtitles.".to_string())?;
        emit_progress(&app, "editing", "Subtitles ready for editing");
        let _ = std::fs::remove_file(audio_path);
        return Ok(srt_content);
    }

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
        let blocks: Vec<_> = normalized.trim().split("\n\n")
            .filter(|b| !b.trim().is_empty())
            .collect();
        
        // Merge syllables
        let mut merged_blocks = vec![];
        let mut i = 0;
        
        while i < blocks.len() {
            let block = blocks[i].trim();
            let lines: Vec<&str> = block.lines().collect();
            if lines.len() < 3 { i += 1; continue; }
            
            let timing = lines[1];
            let mut word = lines[2..].join(" ");
            
            if let Some((start, end)) = timing.split_once(" --> ") {
                let start_time = start.trim();
                let mut end_time = end.trim();
                
                i += 1;
                while i < blocks.len() {
                    let next_block = blocks[i].trim();
                    let next_lines: Vec<&str> = next_block.lines().collect();
                    if next_lines.len() < 3 { break; }
                    
                    let next_word = next_lines[2..].join(" ");
                    let next_timing = next_lines[1];
                    
                    if let Some((_, next_end)) = next_timing.split_once(" --> ") {
                        let duration_ms = calculate_duration_ms(start_time, next_end.trim());
                        
                        if (duration_ms < 1000 && word.len() + next_word.len() < 12) || next_word.trim().len() <= 2 {
                            word.push_str(&next_word);
                            end_time = next_end.trim();
                            i += 1;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                
                merged_blocks.push((word, start_time.to_string(), end_time.to_string()));
            } else {
                i += 1;
            }
        }
        
        // Group into sentences
        let mut sentence_idx = 0;
        
        while sentence_idx < merged_blocks.len() {
            let mut sentence_words = vec![];
            
            while sentence_idx < merged_blocks.len() && sentence_words.len() < 8 {
                let (word, start, end) = &merged_blocks[sentence_idx];
                
                let clean_word = word.chars()
                    .filter(|c| c.is_alphanumeric() || c.is_whitespace())
                    .collect::<String>()
                    .trim()
                    .to_string();
                
                if !clean_word.is_empty() {
                    let start_ass = srt_time_to_ass(start);
                    let end_ass = srt_time_to_ass(end);
                    sentence_words.push((clean_word, start_ass, end_ass));
                }
                
                sentence_idx += 1;
            }
            
            if sentence_words.is_empty() { continue; }
            
            // Generate one subtitle per word with full sentence context
            for (word_idx, (word, word_start, word_end)) in sentence_words.iter().enumerate() {
                let start_ms = ass_time_to_ms(word_start).saturating_sub(100);
                let adjusted_start = ms_to_ass_time(start_ms);
                
                let mut highlighted_text = String::new();
                for (j, (w, _, _)) in sentence_words.iter().enumerate() {
                    if j == word_idx {
                        highlighted_text.push_str(&format!("{{\\c{}}}{}", &highlight_color, w));
                        highlighted_text.push_str(&format!("{{\\c{}}}", &primary_ass));
                    } else {
                        highlighted_text.push_str(w);
                    }
                    if j < sentence_words.len() - 1 {
                        highlighted_text.push(' ');
                    }
                }
                
                ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", adjusted_start, word_end, highlighted_text));
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![process_video, burn_subtitles])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}