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
async fn process_video(app: tauri::AppHandle, video_path: String, output_path: String, skip_editor: bool) -> Result<String, String> {
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
    alignment: u32
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
    let ass_content = srt_to_ass(&srt_content, &font_name, font_size, &primary_color, &outline_color, alignment);

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
fn srt_to_ass(srt: &str, font: &str, size: u32, primary: &str, outline: &str, alignment: u32) -> String {
    // Convert hex colors to ASS format (&HAABBGGRR)
    let primary_ass = hex_to_ass_color(primary);
    let outline_ass = hex_to_ass_color(outline);

    let mut ass = format!(
r#"[Script Info]
Title: Subtitle
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{},{},{},&H000000FF,{},&H80000000,0,0,0,0,100,100,0,0,1,2,0,{},10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"#, font, size, primary_ass, outline_ass, alignment);

    // Parse SRT and convert to ASS
    for block in srt.trim().split("\n\n") {
        let lines: Vec<&str> = block.lines().collect();
        if lines.len() < 3 { continue; }

        let timing = lines[1];
        let text = lines[2..].join("\\N");

        if let Some((start, end)) = timing.split_once(" --> ") {
            let start_ass = srt_time_to_ass(start.trim());
            let end_ass = srt_time_to_ass(end.trim());
            ass.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", start_ass, end_ass, text));
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
    srt_time.replace(',', ".")
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![process_video, burn_subtitles])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}