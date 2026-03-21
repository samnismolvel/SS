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

fn get_ffmpeg_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let resource_path = app.path().resource_dir()
        .map_err(|_| "Could not locate app resources".to_string())?;
    #[cfg(target_os = "windows")]
    return Ok(resource_path.join("resources/binaries/ffmpeg.exe"));
    #[cfg(not(target_os = "windows"))]
    return Ok(resource_path.join("binaries/ffmpeg"));
}

// ─── process_video ────────────────────────────────────────────────────────────
// Extracts audio, runs whisper, returns raw SRT string to the frontend.
// All styling decisions happen in the frontend after this.

#[tauri::command]
async fn process_video(
    app: tauri::AppHandle,
    video_path: String,
    _output_path: String,
    skip_editor: bool
) -> Result<String, String> {
    let resource_path = app.path().resource_dir()
        .map_err(|_| "Could not locate app resources".to_string())?;

    let ffmpeg_path = get_ffmpeg_path(&app)?;

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

    // Step 2: Transcribe
    emit_progress(&app, "transcribing", "Transcribing audio (this may take a while)...");
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut whisper_cmd = Command::new(&whisper_path);
    whisper_cmd.args([
        "-m", model_path.to_str().unwrap(),
        "-f", audio_path.to_str().unwrap(),
        "-ojf",
        "-of", json_path.to_str().unwrap().trim_end_matches(".json")
    ]);
    #[cfg(target_os = "windows")]
    whisper_cmd.creation_flags(CREATE_NO_WINDOW);
    let whisper_status = whisper_cmd.status()
        .map_err(|_| "Whisper not found. Please reinstall the app.".to_string())?;

    if !whisper_status.success() {
        return Err("Transcription failed. The audio may be too short or silent.".to_string());
    }

    let json_content = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Could not read transcription: {}", e))?;

    let srt_content = json_to_srt(&json_content)
        .unwrap_or_else(|e| {
            let debug_path = temp_dir.join("debug_whisper.json");
            let _ = std::fs::write(&debug_path, &json_content);
            eprintln!("JSON error: {}. Saved to {:?}", e, debug_path);
            format!("Error: {}", e)
        });

    if srt_content.starts_with("Error:") {
        return Err(srt_content);
    }

    let _ = std::fs::remove_file(&audio_path);
    let _ = std::fs::remove_file(&json_path);

    if !skip_editor {
        emit_progress(&app, "editing", "Subtitles ready for editing");
    } else {
        emit_progress(&app, "done", "Transcription complete");
    }

    Ok(srt_content)
}

// ─── burn_subtitles ───────────────────────────────────────────────────────────
// Accepts a pre-built ASS string from the frontend.
// All styling logic lives in src/lib/utils/ass.ts now.

#[tauri::command]
async fn burn_subtitles(
    app: tauri::AppHandle,
    video_path: String,
    output_path: String,
    ass_content: String,
) -> Result<(), String> {
    let ffmpeg_path = get_ffmpeg_path(&app)?;
    let temp_dir = std::env::temp_dir();
    let ass_path = temp_dir.join("edited_subtitles.ass");

    #[cfg(debug_assertions)]
    {
        if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
            let debug_path = std::path::Path::new(&home).join("Desktop").join("debug_subtitles.ass");
            let _ = std::fs::write(&debug_path, &ass_content);
        }
    }

    std::fs::write(&ass_path, &ass_content)
        .map_err(|_| "Could not save subtitle file.".to_string())?;

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

// ─── json_to_srt ──────────────────────────────────────────────────────────────

fn json_to_srt(json: &str) -> Result<String, String> {
    use serde_json::Value;

    let data: Value = serde_json::from_str(json)
        .map_err(|e| format!("Invalid JSON: {}", e))?;

    let mut srt = String::new();
    let mut index = 1;

    if let Some(transcription) = data.get("transcription").and_then(|t| t.as_array()) {
        for segment in transcription {
            if let Some(tokens) = segment.get("tokens").and_then(|t| t.as_array()) {
                for token in tokens {
                    if let Some(text) = token.get("text").and_then(|t| t.as_str()) {
                        if text.starts_with('[') || text.trim().is_empty() {
                            continue;
                        }
                        if let (Some(from_ms), Some(to_ms)) = (
                            token.get("offsets").and_then(|o| o.get("from")).and_then(|f| f.as_i64()),
                            token.get("offsets").and_then(|o| o.get("to")).and_then(|t| t.as_i64())
                        ) {
                            let start = format_timestamp_ms(from_ms);
                            let end = format_timestamp_ms(to_ms);
                            srt.push_str(&format!("{}\n{} --> {}\n{}\n\n", index, start, end, text.trim()));
                            index += 1;
                        }
                    }
                }
            }
        }
    }

    if srt.is_empty() {
        return Err("No word timestamps found in JSON".to_string());
    }

    Ok(srt)
}

fn format_timestamp_ms(ms: i64) -> String {
    let hours = ms / 3600000;
    let remainder = ms % 3600000;
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