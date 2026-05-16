use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

static KEYS_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Default, Serialize, Deserialize)]
struct KeyStore {
    keys: HashMap<String, String>,
}

pub fn init(app_data_dir: &std::path::Path) {
    KEYS_DIR.set(app_data_dir.to_path_buf()).ok();
}

fn keys_path() -> PathBuf {
    KEYS_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")))
        .join(".holmes_keys.json")
}

fn load() -> KeyStore {
    fs::read_to_string(keys_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(store: &KeyStore) {
    if let Ok(json) = serde_json::to_string_pretty(store) {
        fs::write(keys_path(), json).ok();
    }
}

pub fn store_key(name: &str, value: &str) -> Result<(), String> {
    let mut store = load();
    store.keys.insert(name.to_string(), value.to_string());
    save(&store);
    Ok(())
}

pub fn get_key(name: &str) -> Option<String> {
    let store = load();
    store.keys.get(name).cloned()
}

pub fn delete_key(name: &str) {
    let mut store = load();
    store.keys.remove(name);
    save(&store);
}
