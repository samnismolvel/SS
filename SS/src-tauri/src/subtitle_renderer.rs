// ─── subtitle_renderer.rs ─────────────────────────────────────────────────────
//
// Renders subtitle segments to RGBA PNG frames using tiny-skia.
//
// Each unique subtitle "state" (a segment of time where the text + styling is
// constant) is rendered once to a PNG. FFmpeg then composites these PNGs over
// the video using the overlay filter with enable= expressions that activate each
// image during its time window.
//
// This module is intentionally video-resolution-agnostic: it receives the
// target frame dimensions and scales everything accordingly.

use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tiny_skia::*;

// ─── Data types from the frontend ─────────────────────────────────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct SubtitleSegment {
    pub index: u32,
    pub start: String, // SRT format: "00:00:01,000"
    pub end: String,
    pub text: String,
}

/// Subset of the Template fields relevant to canvas rendering.
/// The frontend sends the full template; we only deserialize what we need.
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderTemplate {
    pub font_size: f32,
    pub bold: bool,
    pub italic: bool,
    pub primary_color: String,   // "#RRGGBB"
    pub outline_color: String,
    pub outline: f32,

    pub alignment: u8,           // ASS numpad: 1-9
    pub margin_v: f32,           // vertical margin, em units relative to script space
    pub margin_l: f32,
    pub margin_r: f32,

    // Active word color
    pub active_word_color: Option<String>,
    

    // Line background
    #[serde(default)]
    pub line_bg_enabled: bool,
    pub line_bg_color: Option<String>,
    #[serde(default = "default_padding_x")]
    pub line_bg_padding_x: f32,  // em units
    #[serde(default = "default_padding_y")]
    pub line_bg_padding_y: f32,

    // Text transforms
    pub text_transform: Option<String>, // "none" | "uppercase" | "lowercase"
    #[serde(default)]
    pub hide_punctuation: bool,

    pub pos_x: Option<f32>,  // % horizontal, 0=izquierda 100=derecha
    pub pos_y: Option<f32>,  // % vertical, 0=arriba 100=abajo
}

fn default_padding_x() -> f32 { 0.5 }
fn default_padding_y() -> f32 { 0.2 }

/// One rendered PNG slot: a file on disk + the time window it covers.
#[derive(Debug)]
pub struct RenderedFrame {
    pub path: PathBuf,
    pub start_ms: i64,
    pub end_ms: i64,
}

// ─── Color helpers ─────────────────────────────────────────────────────────────

fn parse_color(hex: &str) -> (u8, u8, u8) {
    let h = hex.trim_start_matches('#');
    if h.len() < 6 {
        return (255, 255, 255);
    }
    let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(255);
    let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(255);
    let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(255);
    (r, g, b)
}

fn color_u8(hex: &str, alpha: u8) -> ColorU8 {
    let (r, g, b) = parse_color(hex);
    ColorU8::from_rgba(r, g, b, alpha)
}

// ─── SRT time parsing ─────────────────────────────────────────────────────────

pub fn srt_to_ms(srt: &str) -> i64 {
    // "HH:MM:SS,mmm"
    let parts: Vec<&str> = srt.trim().splitn(2, ',').collect();
    let ms: i64 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
    let time_parts: Vec<i64> = parts
        .first()
        .unwrap_or(&"")
        .split(':')
        .filter_map(|s| s.parse().ok())
        .collect();
    let h = time_parts.get(0).copied().unwrap_or(0);
    let m = time_parts.get(1).copied().unwrap_or(0);
    let s = time_parts.get(2).copied().unwrap_or(0);
    h * 3_600_000 + m * 60_000 + s * 1_000 + ms
}

// ─── Text transforms ──────────────────────────────────────────────────────────

fn apply_text_transform(text: &str, tmpl: &RenderTemplate) -> String {
    let mut t = text.to_string();
    match tmpl.text_transform.as_deref() {
        Some("uppercase") => t = t.to_uppercase(),
        Some("lowercase") => t = t.to_lowercase(),
        _ => {}
    }
    if tmpl.hide_punctuation {
        t = t.chars().filter(|c| !".!?,;:".contains(*c)).collect();
    }
    t
}

// ─── Layout helpers ───────────────────────────────────────────────────────────

/// Convert ASS alignment (numpad 1-9) to (h_anchor, v_anchor).
/// h_anchor: 0=left, 1=center, 2=right
/// v_anchor: 0=bottom, 1=middle, 2=top
fn alignment_anchors(al: u8) -> (u8, u8) {
    let h = match al {
        1 | 4 | 7 => 0,
        2 | 5 | 8 => 1,
        3 | 6 | 9 => 2,
        _ => 1,
    };
    let v = match al {
        1..=3 => 0,
        4..=6 => 1,
        7..=9 => 2,
        _ => 0,
    };
    (h, v)
}

// ─── Core renderer ────────────────────────────────────────────────────────────

/// Renders all subtitle segments to RGBA PNGs in `out_dir`.
/// `video_w` / `video_h`: final video dimensions in pixels.
/// `font_data`: TTF/OTF bytes for the subtitle font.
///
/// Returns one `RenderedFrame` per segment (empty segments are skipped).
pub fn render_segments(
    segments: &[SubtitleSegment],
    tmpl: &RenderTemplate,
    font_data: &[u8],
    video_w: u32,
    video_h: u32,
    out_dir: &Path,
) -> Result<Vec<RenderedFrame>, String> {
    let font = FontRef::try_from_slice(font_data)
        .map_err(|e| format!("Failed to load font: {e}"))?;

    // libass scales fontSize by (videoHeight / 288).
    // We replicate that here so the canvas size matches the video output.
    let scale_factor = video_h as f32 / 288.0;
    let px_size = tmpl.font_size * scale_factor;
    let scale = PxScale::from(px_size);
    let scaled = font.as_scaled(scale);

    let margin_v_px = (tmpl.margin_v * scale_factor) as f32;
    let margin_l_px = (tmpl.margin_l * scale_factor) as f32;
    let margin_r_px = (tmpl.margin_r * scale_factor) as f32;

    let pad_x = tmpl.line_bg_padding_x * px_size;
    let pad_y = tmpl.line_bg_padding_y * px_size;

    let (h_anchor, v_anchor) = alignment_anchors(tmpl.alignment);

    let mut frames = Vec::new();

    for seg in segments {
        let text = apply_text_transform(&seg.text, tmpl);
        if text.trim().is_empty() {
            continue;
        }

        let start_ms = srt_to_ms(&seg.start);
        let end_ms   = srt_to_ms(&seg.end);

        // Measure text
        let line_height = scaled.height() + scaled.line_gap();
        let text_w: f32 = text.chars().map(|c| scaled.h_advance(scaled.glyph_id(c))).sum();
        let text_h = line_height;

        // Box dimensions (with background padding if enabled)
        let (box_w, box_h) = if tmpl.line_bg_enabled {
            (text_w + pad_x * 2.0, text_h + pad_y * 2.0)
        } else {
            // Still need room for outline
            let o = tmpl.outline * scale_factor;
            (text_w + o * 2.0, text_h + o * 2.0)
        };

        // Position of the box within the video frame
        // posX/posY son % del frame y apuntan al CENTRO del box,
        // igual que \an5 + \pos en ASS (buildPosTag en ass.ts).
        let (box_x, box_y) = if let (Some(px), Some(py)) = (tmpl.pos_x, tmpl.pos_y) {
            let anchor_x = (px / 100.0) * video_w as f32;
            let anchor_y = (py / 100.0) * video_h as f32;
            let bx = anchor_x - box_w / 2.0;
            let by = anchor_y - box_h / 2.0;
            (bx, by)
        } else {
            // Fallback al sistema de alignment + margin
            let bx = match h_anchor {
                0 => margin_l_px,
                2 => video_w as f32 - margin_r_px - box_w,
                _ => (video_w as f32 - box_w) / 2.0,
            };
            let by = match v_anchor {
                0 => video_h as f32 - margin_v_px - box_h,
                2 => margin_v_px,
                _ => (video_h as f32 - box_h) / 2.0,
            };
            (bx, by)
        };

        // Create a full-frame transparent pixmap
        let mut pixmap = Pixmap::new(video_w, video_h)
            .ok_or("Failed to create pixmap")?;

        // ── Draw background box ───────────────────────────────────────────────
        if tmpl.line_bg_enabled {
            let bg_hex = tmpl.line_bg_color.as_deref().unwrap_or("#000000");
            let (br, bg_c, bb) = parse_color(bg_hex);

            let mut paint = Paint::default();
            paint.set_color_rgba8(br, bg_c, bb, 255);
            paint.anti_alias = true;

            let rect = Rect::from_xywh(box_x, box_y, box_w, box_h)
                .ok_or("Invalid rect")?;

            // Rounded corners: 0.4em radius (matching the CSS preview)
            let radius = (0.4 * px_size).min(box_h / 2.0).min(box_w / 2.0);
            if let Some(path) = rounded_rect_path(box_x, box_y, box_w, box_h, radius) {
                pixmap.fill_path(&path, &paint, FillRule::Winding, Transform::identity(), None);
            }
        }

        // ── Draw text outline ─────────────────────────────────────────────────
        let text_x = box_x + if tmpl.line_bg_enabled { pad_x } else { tmpl.outline * scale_factor };
        let text_y = box_y + if tmpl.line_bg_enabled { pad_y } else { tmpl.outline * scale_factor };

        if tmpl.outline > 0.0 && !tmpl.line_bg_enabled {
            let outline_px = tmpl.outline * scale_factor;
            let (or, og, ob) = parse_color(&tmpl.outline_color);
            draw_text_stroked(
                &mut pixmap, &font, scale, &text,
                text_x, text_y, or, og, ob, outline_px,
            );
        }

        // ── Draw text fill ────────────────────────────────────────────────────
        let (tr, tg, tb) = parse_color(&tmpl.primary_color);
        draw_text_filled(&mut pixmap, &font, scale, &text, text_x, text_y, tr, tg, tb);

        // Save PNG
        let fname = format!("sub_{:04}.png", seg.index);
        let fpath = out_dir.join(&fname);
        pixmap.save_png(&fpath)
            .map_err(|e| format!("PNG save failed: {e}"))?;

        frames.push(RenderedFrame { path: fpath, start_ms, end_ms });
    }

    Ok(frames)
}


// ─── Rounded rectangle path ───────────────────────────────────────────────────
// tiny-skia 0.12 removed RoundRect. We build the path manually using cubic
// bezier approximations of quarter-circle arcs (k ≈ 0.5523).

fn rounded_rect_path(x: f32, y: f32, w: f32, h: f32, r: f32) -> Option<tiny_skia::Path> {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    const K: f32 = 0.5522847498; // cubic bezier arc approximation constant
    let kr = K * r;

    let mut pb = PathBuilder::new();
    // Start at top-left corner after the radius
    pb.move_to(x + r, y);
    // Top edge → top-right arc
    pb.line_to(x + w - r, y);
    pb.cubic_to(x + w - r + kr, y, x + w, y + r - kr, x + w, y + r);
    // Right edge → bottom-right arc
    pb.line_to(x + w, y + h - r);
    pb.cubic_to(x + w, y + h - r + kr, x + w - r + kr, y + h, x + w - r, y + h);
    // Bottom edge → bottom-left arc
    pb.line_to(x + r, y + h);
    pb.cubic_to(x + r - kr, y + h, x, y + h - r + kr, x, y + h - r);
    // Left edge → top-left arc
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - kr, x + r - kr, y, x + r, y);
    pb.close();
    pb.finish()
}

// ─── Text drawing primitives ──────────────────────────────────────────────────

/// Rasterise `text` into `pixmap` by walking glyphs manually with ab_glyph.
fn draw_text_filled(
    pixmap: &mut Pixmap,
    font: &FontRef,
    scale: PxScale,
    text: &str,
    x: f32,
    y: f32,
    r: u8,
    g: u8,
    b: u8,
) {
    let scaled = font.as_scaled(scale);
    let ascent = scaled.ascent();

    let mut paint = Paint::default();
    paint.set_color_rgba8(r, g, b, 255);
    paint.anti_alias = true;

    let mut cursor_x = x;
    for ch in text.chars() {
        let glyph_id = scaled.glyph_id(ch);
        let glyph = glyph_id.with_scale_and_position(scale, ab_glyph::point(cursor_x, y + ascent));

        if let Some(outline) = font.outline_glyph(glyph) {
            let bounds = outline.px_bounds();
            outline.draw(|px, py, coverage| {
                if coverage > 0.05 {
                    let fx = bounds.min.x + px as f32;
                    let fy = bounds.min.y + py as f32;
                    if let Some(rect) = Rect::from_xywh(fx, fy, 1.0, 1.0) {
                        let mut p = Paint::default();
                        let alpha = (coverage * 255.0) as u8;
                        p.set_color_rgba8(r, g, b, alpha);
                        p.anti_alias = false;
                        pixmap.fill_rect(rect, &p, Transform::identity(), None);
                    }
                }
            });
        }

        cursor_x += scaled.h_advance(glyph_id);
    }
}

/// Draw text as a thick stroke (outline effect) by rendering at offsets.
/// For subtitle-quality outlines this is accurate enough; for very thick
/// outlines you'd want to stroke the actual glyph path.
fn draw_text_stroked(
    pixmap: &mut Pixmap,
    font: &FontRef,
    scale: PxScale,
    text: &str,
    x: f32,
    y: f32,
    r: u8,
    g: u8,
    b: u8,
    thickness: f32,
) {
    // Draw at 8 directions around the text for a solid outline
    let steps = 8;
    for i in 0..steps {
        let angle = (i as f32 / steps as f32) * std::f32::consts::TAU;
        let dx = angle.cos() * thickness;
        let dy = angle.sin() * thickness;
        draw_text_filled(pixmap, font, scale, text, x + dx, y + dy, r, g, b);
    }
}

// ─── FFmpeg overlay filter builder ────────────────────────────────────────────

/// Builds the FFmpeg filtergraph string for overlaying subtitle PNGs.
///
/// Each PNG is loaded as a separate input stream and composited with
/// `overlay=enable='between(t,start,end)'`. The inputs are layered so
/// that each segment appears exactly during its time window.
///
/// Returns (extra_input_args, filtergraph_string).
/// extra_input_args: Vec of "-i path" pairs to prepend to the ffmpeg command.
pub fn build_overlay_filtergraph(frames: &[RenderedFrame]) -> (Vec<String>, String) {
    if frames.is_empty() {
        return (vec![], String::new());
    }

    let mut inputs: Vec<String> = Vec::new();
    let mut filter = String::new();

    // The video stream starts as [0:v]
    // Each PNG input is stream [N:v] where N = 1-based index
    for (i, frame) in frames.iter().enumerate() {
        inputs.push("-i".to_string());
        inputs.push(frame.path.to_string_lossy().to_string());

        let start_s = frame.start_ms as f64 / 1000.0;
        let end_s   = frame.end_ms   as f64 / 1000.0;

        // Input ref for this PNG (stream index N+1, since [0:v] is the video)
        let png_stream = format!("[{}:v]", i + 1);
        // Overlay base: first iteration uses [0:v], subsequent use the output of the previous overlay
        let base = if i == 0 {
            "[0:v]".to_string()
        } else {
            format!("[ov{}]", i)
        };
        let out = if i == frames.len() - 1 {
            "[outv]".to_string()
        } else {
            format!("[ov{}]", i + 1)
        };

        // overlay=x=0:y=0 — the PNGs are already full-frame (transparent outside the subtitle)
        filter.push_str(&format!(
            "{base}{png_stream}overlay=x=0:y=0:enable='between(t,{start_s:.3},{end_s:.3})'{out};"
        ));
    }

    // Remove trailing semicolon
    if filter.ends_with(';') {
        filter.pop();
    }

    (inputs, filter)
}