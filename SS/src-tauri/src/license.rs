use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::api::path::app_config_dir;

const API_URL: &str = "https://api.lemonsqueezy.com/v1/licenses";
const PRODUCT_ID: i64 = 123456; // ⚠️ CAMBIAR

// ─── Estructuras ─────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
pub struct LicenseCache {
    pub license_key: String,
    pub instance_id: Option<String>,
    pub last_check: i64,
    pub valid: bool,
}

#[derive(Deserialize)]
struct ValidateResponse {
    valid: bool,
    meta: Meta,
}

#[derive(Deserialize)]
struct Meta {
    product_id: i64,
}

// ─── Helpers ─────────────────────────────────────────────

fn get_cache_path() -> PathBuf {
    let mut path = app_config_dir(&tauri::Config::default())
        .expect("No config dir");
    path.push("license.json");
    path
}

fn save_cache(cache: &LicenseCache) -> Result<(), String> {
    let path = get_cache_path();
    let data = serde_json::to_string_pretty(cache).unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, data).map_err(|e| e.to_string())
}

fn load_cache() -> Option<LicenseCache> {
    let path = get_cache_path();
    if !path.exists() {
        return None;
    }
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

fn now_ts() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

// ─── API calls ───────────────────────────────────────────

async fn validate_online(key: &str) -> Result<bool, String> {
    let client = reqwest::Client::new();

    let res = client
        .post(&format!("{}/validate", API_URL))
        .form(&[("license_key", key)])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: ValidateResponse = res.json().await.map_err(|e| e.to_string())?;

    if !json.valid {
        return Ok(false);
    }

    if json.meta.product_id != PRODUCT_ID {
        return Err("Invalid product".into());
    }

    Ok(true)
}

// ─── Comandos Tauri ──────────────────────────────────────

#[tauri::command]
pub async fn activate_license(key: String) -> Result<bool, String> {
    let valid = validate_online(&key).await?;

    if !valid {
        return Ok(false);
    }

    let cache = LicenseCache {
        license_key: key,
        instance_id: None,
        last_check: now_ts(),
        valid: true,
    };

    save_cache(&cache)?;
    Ok(true)
}

#[tauri::command]
pub async fn check_license() -> Result<bool, String> {
    let cache = match load_cache() {
        Some(c) => c,
        None => return Ok(false),
    };

    let now = now_ts();

    // 7 días = 604800 segundos
    let needs_refresh = now - cache.last_check > 604800;

    if !needs_refresh {
        return Ok(cache.valid);
    }

    let valid = validate_online(&cache.license_key).await?;

    let updated = LicenseCache {
        last_check: now,
        valid,
        ..cache
    };

    save_cache(&updated)?;
    Ok(valid)
}