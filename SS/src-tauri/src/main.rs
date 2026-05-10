#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod subtitle_renderer;
use subtitle_renderer::{render_segments, SubtitleSegment, RenderTemplate, FrameInfo, WordToken};

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

// ─── crop_filter ─────────────────────────────────────────────────────────────
// Builds the FFmpeg crop+scale filter string for a given ratio and offset.
//
// Strategy:
//   1. crop=  — cuts the input to the target W:H ratio, panning vertically
//              with `offset` (0 = top, 50 = center, 100 = bottom).
//   2. scale= — resizes the crop to a canonical pixel size so the output has
//              clean, standard dimensions regardless of source resolution.
//
// We use FFmpeg expression variables so this works on any input size:
//   iw / ih  = input width / height
//   ow / oh  = output (crop) width / height (computed from ratio)
//
// For a portrait ratio (h > w) the crop width = ih * (rw/rh), full height.
// For a landscape ratio (w > h) the crop height = iw * (rh/rw), full width.
// For 1:1 the crop = min(iw,ih).

fn crop_filter(ratio: &str, offset: u32) -> Option<String> {
    // Parse "W:H" string into integers
    let parts: Vec<u32> = ratio.split(':')
        .filter_map(|s| s.parse().ok())
        .collect();

    if parts.len() != 2 {
        return None; // "original" or anything unparseable → no crop
    }

    let (rw, rh) = (parts[0], parts[1]);

    // Clamp offset 0–100
    let off = offset.min(100);

    // Build FFmpeg crop expression.
    // We want the crop to have the exact aspect ratio rw:rh.
    // If rw/rh < iw/ih  (target narrower than source, e.g. 9:16 from 16:9):
    //   crop width  = ih * rw / rh   (fit to full height)
    //   crop height = ih
    //   x offset    = (iw - ow) / 2  (center horizontally)
    //   y offset    = 0              (no vertical crop needed)
    //
    // If rw/rh > iw/ih  (target wider, e.g. 16:9 from 9:16):
    //   crop width  = iw
    //   crop height = iw * rh / rw
    //   x offset    = 0
    //   y offset    = (ih - oh) * offset/100
    //
    // We express this purely in FFmpeg filter expressions so it adapts to
    // any input resolution at runtime.
    //
    // ow = if(gt(iw/ih\,{rw}/{rh})\, ih*{rw}/{rh}\, iw)
    // oh = if(gt(iw/ih\,{rw}/{rh})\, ih\, iw*{rh}/{rw})
    // x  = (iw-ow)/2
    // y  = (ih-oh)*{off}/100
    //
    // (backslash-comma escapes the comma inside if() for the vf argument)

    let ow_expr = format!("if(gt(iw/ih\\,{rw}/{rh})\\,ih*{rw}/{rh}\\,iw)");
    let oh_expr = format!("if(gt(iw/ih\\,{rw}/{rh})\\,ih\\,iw*{rh}/{rw})");
    let x_expr  = "(iw-ow)/2".to_string();
    let y_expr  = format!("(ih-oh)*{off}/100");

    // Canonical output scale: choose a standard size for the ratio.
    // These match common social media export sizes.
    let (scale_w, scale_h) = canonical_size(rw, rh);

    let crop  = format!("crop={ow_expr}:{oh_expr}:{x_expr}:{y_expr}");
    let scale = format!("scale={scale_w}:{scale_h}");

    Some(format!("{crop},{scale}"))
}

/// Returns a canonical pixel size for a ratio, rounding to even numbers.
/// Falls back to -2 (FFmpeg auto-even) on the height when ratio is unusual.
fn canonical_size(rw: u32, rh: u32) -> (i32, i32) {
    match (rw, rh) {
        (9, 16)  => (1080, 1920),
        (16, 9)  => (1920, 1080),
        (1, 1)   => (1080, 1080),
        (4, 3)   => (1440, 1080),
        (3, 4)   => (1080, 1440),
        _        => (-2, -2),   // let FFmpeg pick even dimensions
    }
}

// ─── process_video ────────────────────────────────────────────────────────────

#[tauri::command]
async fn process_video(
    app: tauri::AppHandle,
    video_path: String,
    _output_path: String,
    skip_editor: bool,
    language: Option<String>,  // <-- agrega esto
) -> Result<String, String> {
    let resource_path = app.path().resource_dir()
        .map_err(|_| "Could not locate app resources".to_string())?;

    let ffmpeg_path = get_ffmpeg_path(&app)?;

    #[cfg(target_os = "windows")]
    let whisper_path = resource_path.join("resources/whisper-cli.exe");
    #[cfg(not(target_os = "windows"))]
    let whisper_path = resource_path.join("whisper-cli");

    #[cfg(target_os = "windows")]
    let model_path = resource_path.join("resources/ggml-base.bin");
    #[cfg(not(target_os = "windows"))]
    let model_path = resource_path.join("ggml-base.bin");

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
    let lang = language.as_deref().unwrap_or("auto");
    whisper_cmd.args([
        "-m", model_path.to_str().unwrap(),
        "-f", audio_path.to_str().unwrap(),
        "-l", lang,
        "--split-on-word",   // corta en palabras, no sub-tokens
        "--max-len", "1",    // 1 palabra por segmento (para tus timestamps por token)
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
// Accepts a pre-built ASS string plus optional crop parameters.
// crop_ratio: "9:16" | "16:9" | "1:1" | "4:3" | "3:4" | "" (original)
// crop_offset: 0–100, vertical pan position within the crop (50 = center)

#[tauri::command]
async fn burn_subtitles(
    app: tauri::AppHandle,
    video_path: String,
    output_path: String,
    ass_content: String,
    crop_ratio: Option<String>,
    crop_offset: Option<u32>,
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

    // ── Escape the ASS path for FFmpeg -vf ───────────────────────────────────
    #[cfg(target_os = "windows")]
    let ass_escaped = ass_path.to_str().unwrap()
        .replace("\\", "/")
        .replace(":", "\\:");
    #[cfg(not(target_os = "windows"))]
    let ass_escaped = ass_path.to_str().unwrap().to_string();

    // ── Build the -vf filter chain ────────────────────────────────────────────
    // If a valid ratio was provided, prepend crop+scale before ass=.
    // Order matters: crop/scale must come BEFORE ass so the subtitle renderer
    // works with the final frame dimensions, not the original video dimensions.
    let vf = {
        let ratio_str = crop_ratio.as_deref().unwrap_or("original");
        let offset    = crop_offset.unwrap_or(50);

        let ass_filter = format!("ass='{}'", ass_escaped);

        match crop_filter(ratio_str, offset) {
            Some(crop) => format!("{},{}", crop, ass_filter),
            None       => ass_filter,   // "original" — no crop, just ass
        }
    };

    #[cfg(debug_assertions)]
    eprintln!("FFmpeg -vf: {}", vf);

    // ── Run FFmpeg ────────────────────────────────────────────────────────────
    #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
    let mut burn_cmd = Command::new(&ffmpeg_path);
    burn_cmd.args([
        "-i", &video_path,
        "-vf", &vf,
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

// ─── get_video_dimensions ─────────────────────────────────────────────────────
// Uses ffprobe (bundled alongside ffmpeg) to get the pixel dimensions of the
// input video. Falls back to 1920×1080 if probing fails.
//
// Resolves ffprobe from the app resource dir (same location as ffmpeg) so it
// works with the bundled binary rather than relying on a system install.

fn get_video_dimensions(app: &tauri::AppHandle, video_path: &str) -> (u32, u32) {
    let resource_path = match app.path().resource_dir() {
        Ok(p) => p,
        Err(_) => return (1920, 1080),
    };

    #[cfg(target_os = "windows")]
    let ffprobe = resource_path.join("resources/binaries/ffprobe.exe");
    #[cfg(not(target_os = "windows"))]
    let ffprobe = resource_path.join("binaries/ffprobe");

    let out = Command::new(&ffprobe)
        .args([
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0",
            video_path,
        ])
        .output();

    if let Ok(o) = out {
        let s = String::from_utf8_lossy(&o.stdout);
        let parts: Vec<u32> = s.trim().split(',')
            .filter_map(|x| x.parse().ok())
            .collect();
        if parts.len() == 2 {
            return (parts[0], parts[1]);
        }
    }
    (1920, 1080)
}

// ─── burn_subtitles_canvas ────────────────────────────────────────────────────
// Canvas-based subtitle burn. Instead of ASS, this command:
//   1. Deserialises segments + template from the frontend
//   2. Renders each subtitle segment to a full-frame RGBA PNG via tiny-skia
//   3. Builds an FFmpeg overlay filtergraph that composites the PNGs in sequence
//   4. Runs FFmpeg with the overlay chain
//
// The frontend calls this command when `lineBgEnabled` is true or any feature
// requires rendering that ASS/libass cannot express (rounded backgrounds, etc.).
// For plain subtitles the existing `burn_subtitles` (ASS path) is still used.

#[tauri::command]
async fn burn_subtitles_canvas(
    app: tauri::AppHandle,
    video_path: String,
    output_path: String,
    segments_json: String,
    template_json: String,
    font_data_b64: String,
    crop_ratio: Option<String>,
    crop_offset: Option<u32>,
    frame_info_json: Option<String>,
    video_native_w: Option<u32>,
    video_native_h: Option<u32>,
    raw_subs_json: Option<String>,
) -> Result<(), String> {
    // ── Debug log — escribe en cada etapa ────────────────────────────────────
    let log_path = std::env::temp_dir().join("ss_burn_log.txt");
    macro_rules! log {
        ($($arg:tt)*) => {{
            let msg = format!($($arg)*);
            let prev = std::fs::read_to_string(&log_path).unwrap_or_default();
            let _ = std::fs::write(&log_path, format!("{}{}\n", prev, msg));
        }};
    }
    log!("=== burn_subtitles_canvas start ===");
    log!("segments_json len: {}", segments_json.len());
    log!("template_json len: {}", template_json.len());
    log!("font_data_b64 len: {}", font_data_b64.len());

    let ffmpeg_path = get_ffmpeg_path(&app)?;
    emit_progress(&app, "burning", "Rendering subtitle frames...");

    let segments: Vec<SubtitleSegment> = serde_json::from_str(&segments_json)
        .map_err(|e| { log!("FAIL segments json: {e}"); format!("Invalid segments JSON: {e}") })?;
    log!("segments parsed: {}", segments.len());

    let tmpl: RenderTemplate = serde_json::from_str(&template_json)
        .map_err(|e| { log!("FAIL template json: {e}"); format!("Invalid template JSON: {e}") })?;
    log!("template parsed ok");

    let font_bytes: Vec<u8> = if font_data_b64.trim().is_empty() {
        include_bytes!("../fonts/NotoSans-Regular.ttf").to_vec()
    } else {
        base64_decode(&font_data_b64)
            .map_err(|e| format!("Font decode error: {e}"))?
    };
    log!("font decoded: {} bytes", font_bytes.len());

    // Use native dimensions from the frontend video element (always correct).
    // Fall back to ffprobe only if the frontend couldn't provide them.
    let (vid_w, vid_h) = match (video_native_w, video_native_h) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        _ => get_video_dimensions(&app, &video_path),
    };

    // Deserialise frame info — describes visible content area within the full frame
    let frame_info = {
        #[derive(serde::Deserialize)]
        struct Fi { offset_x: f32, offset_y: f32, scale_x: f32, scale_y: f32 }
        let fi = frame_info_json.as_deref()
            .and_then(|s| serde_json::from_str::<Fi>(s).ok());
        match fi {
            Some(f) => subtitle_renderer::FrameInfo {
                offset_x: f.offset_x, offset_y: f.offset_y,
                scale_x: f.scale_x,   scale_y: f.scale_y,
            },
            None => subtitle_renderer::FrameInfo::default(),
        }
    };
    log!("video dimensions: {}x{} | frame_info: offsetX={:.4} offsetY={:.4} scaleX={:.4} scaleY={:.4}",
         vid_w, vid_h, frame_info.offset_x, frame_info.offset_y, frame_info.scale_x, frame_info.scale_y);

    let word_tokens: Vec<WordToken> = raw_subs_json
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    log!("word_tokens: {}", word_tokens.len());

    let temp_dir = std::env::temp_dir().join("ss_canvas_frames");
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| { log!("FAIL create temp dir: {e}"); format!("Cannot create temp dir: {e}") })?;
    log!("temp dir created: {:?}", temp_dir);

    let frames = render_segments(&segments, &tmpl, &font_bytes, vid_w, vid_h, &temp_dir, frame_info, &word_tokens)
        .map_err(|e| { log!("FAIL render_segments: {e}"); format!("Render error: {e}") })?;
    log!("frames rendered: {}", frames.len());

    // ... resto del código sin cambios
    if frames.is_empty() {
        return Err("No subtitle frames were rendered.".to_string());
    }

    emit_progress(&app, "burning", "Compositing subtitle frames...");

    // ── filter_complex_script approach ──────────────────────────────────────
    // Write the overlay filtergraph to a file to avoid Windows arg-length limits.
    // Each PNG input gets an `overlay` with `enable='between(t,s,e)'` — the same
    // approach as before but the long string goes in a file, not on the command line.

    let mut sorted = frames.clone();
    sorted.sort_by_key(|f| f.start_ms);

    // Build filtergraph string — same logic as the old batch approach but written to file
    let mut filter = String::new();
    let total = sorted.len();

    const BATCH: usize = 60;
    let num_batches = (total + BATCH - 1) / BATCH;

    for batch_idx in 0..num_batches {
        let start = batch_idx * BATCH;
        let end   = (start + BATCH).min(total);
        let batch = &sorted[start..end];

        for (j, frame) in batch.iter().enumerate() {
            let global_i = start + j;
            let start_s = frame.start_ms as f64 / 1000.0;
            let end_s   = frame.end_ms   as f64 / 1000.0;
            let png_ref = format!("[{}:v]", global_i + 1);

            let base = if j == 0 {
                if batch_idx == 0 { "[0:v]".to_string() }
                else { format!("[batch{}]", batch_idx) }
            } else {
                format!("[b{}f{}]", batch_idx, j)
            };

            let out = if j == batch.len() - 1 {
                if batch_idx == num_batches - 1 { "[outv]".to_string() }
                else { format!("[batch{}]", batch_idx + 1) }
            } else {
                format!("[b{}f{}]", batch_idx, j + 1)
            };

            filter.push_str(&format!(
                "{base}{png_ref}overlay=x=0:y=0:enable='between(t,{start_s:.3},{end_s:.3})'{out};
"
            ));
        }
    }
    if filter.ends_with(";
") { filter.truncate(filter.len() - 2); }

    // Apply yuv420p conversion at end
    let ratio_str  = crop_ratio.as_deref().unwrap_or("original");
    let offset_val = crop_offset.unwrap_or(50);

    // Replace [outv] with the final output label inline — no trailing newline
    // before scale/format or FFmpeg treats it as a separate filterchain.
    let final_filter = if let Some(crop) = crop_filter(ratio_str, offset_val) {
        filter.replacen("[0:v]", "[0:v_raw]", 1)
            .replace("[outv]", "[outv_pre]")
            + &format!(";[0:v_raw]{crop}[0:v_c];[outv_pre]format=yuv420p[outv_final]")
    } else {
        filter.replace("[outv]", "[outv_pre]")
            + &format!(";[outv_pre]scale={}:{},format=yuv420p[outv_final]", vid_w, vid_h)
    };

    // Write filtergraph to file
    let filter_script_path = temp_dir.join("filter.txt");
    std::fs::write(&filter_script_path, &final_filter)
        .map_err(|e| format!("Failed to write filter script: {e}"))?;

    // Build FFmpeg command: -i video, then all PNG inputs, then -filter_complex_script
    let mut args: Vec<String> = vec!["-i".to_string(), video_path.clone()];
    for frame in &sorted {
        args.push("-i".to_string());
        args.push(frame.path.to_string_lossy().to_string());
    }
    args.extend([
        "-/filter_complex".to_string(), filter_script_path.to_string_lossy().to_string(),
        "-map".to_string(),    "[outv_final]".to_string(),
        "-map".to_string(),    "0:a?".to_string(),
        "-c:v".to_string(),    "libx264".to_string(),
        "-crf".to_string(),    "18".to_string(),
        "-preset".to_string(), "fast".to_string(),
        "-c:a".to_string(),    "copy".to_string(),
        "-y".to_string(),
        output_path.clone(),
    ]);

        log!("FFmpeg concat args count: {}", args.len());
    log!("output path: {}", output_path);

    let output = {
        #[cfg_attr(not(target_os = "windows"), allow(unused_mut))]
        let mut cmd = Command::new(&ffmpeg_path);
        cmd.args(&args);
        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output().map_err(|e| {
            let msg = format!("FFmpeg launch failed: {e}");
            log!("{}", msg);
            msg
        })?
    };

    log!("FFmpeg exit code: {:?}", output.status.code());

    // Always log stderr — critical for diagnosing silent failures
    let stderr_str = String::from_utf8_lossy(&output.stderr).to_string();
    if !stderr_str.is_empty() {
        log!("FFmpeg stderr (last 800):\n{}", &stderr_str[stderr_str.len().saturating_sub(800)..]);
    }

    let out_size = std::fs::metadata(&output_path).map(|m| m.len()).unwrap_or(0);
    log!("output file size: {} bytes", out_size);

    // Cleanup temp frames
    let _ = std::fs::remove_dir_all(&temp_dir);

    if !output.status.success() {
        let tail = &stderr_str[stderr_str.len().saturating_sub(400)..];
        return Err(format!("Canvas burn failed: {tail}"));
    }

    if out_size == 0 {
        return Err("Canvas burn produced empty output — filter_complex_script may not be supported. Check ss_burn_log.txt.".to_string());
    }

    emit_progress(&app, "done", "Done!");
    Ok(())
}

// ─── base64_decode ────────────────────────────────────────────────────────────
// Minimal base64 decoder — avoids adding a heavy dependency for one use.

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Strip whitespace / data-URL prefix
    let s = if let Some(idx) = input.find(',') {
        &input[idx + 1..]
    } else {
        input
    };
    let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();

    let table: [u8; 128] = {
        let mut t = [255u8; 128];
        for (i, c) in b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
            .iter()
            .enumerate()
        {
            t[*c as usize] = i as u8;
        }
        t
    };

    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut i = 0;
    while i + 3 < bytes.len() {
        let b0 = bytes[i] as usize;
        let b1 = bytes[i + 1] as usize;
        let b2 = bytes[i + 2] as usize;
        let b3 = bytes[i + 3] as usize;
        if b0 >= 128 || b1 >= 128 || b2 >= 128 || b3 >= 128 {
            return Err("Invalid base64 character".to_string());
        }
        let v0 = table[b0];
        let v1 = table[b1];
        let v2 = if bytes[i + 2] == b'=' { 0 } else { table[b2] };
        let v3 = if bytes[i + 3] == b'=' { 0 } else { table[b3] };
        if v0 == 255 || v1 == 255 { return Err("Invalid base64 char".to_string()); }
        out.push((v0 << 2) | (v1 >> 4));
        if bytes[i + 2] != b'=' { out.push(((v1 & 0xf) << 4) | (v2 >> 2)); }
        if bytes[i + 3] != b'=' { out.push(((v2 & 0x3) << 6) | v3); }
        i += 4;
    }
    Ok(out)
}


fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                let window = _app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![process_video, burn_subtitles, burn_subtitles_canvas])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}