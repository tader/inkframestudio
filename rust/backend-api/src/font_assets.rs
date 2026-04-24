use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

include!(concat!(env!("OUT_DIR"), "/generated_font_assets.rs"));

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct GeneratedFontFamilyData {
    pub(crate) regular: Option<String>,
    pub(crate) italic: Option<String>,
    pub(crate) bold: Option<String>,
    #[serde(rename = "boldItalic")]
    pub(crate) bold_italic: Option<String>,
}

fn built_in_font_assets() -> &'static HashMap<String, GeneratedFontFamilyData> {
    static CACHE: OnceLock<HashMap<String, GeneratedFontFamilyData>> = OnceLock::new();
    CACHE.get_or_init(|| {
        serde_json::from_str(GENERATED_FONT_ASSETS_JSON)
            .expect("generated built-in font assets must be valid JSON")
    })
}

pub(crate) fn has_built_in_font(family: &str) -> bool {
    built_in_font_assets().get(family).is_some_and(|entry| {
        entry.regular.is_some()
            || entry.italic.is_some()
            || entry.bold.is_some()
            || entry.bold_italic.is_some()
    })
}

pub(crate) fn built_in_font_data(family: &str) -> Option<GeneratedFontFamilyData> {
    built_in_font_assets().get(family).cloned()
}

#[cfg(test)]
mod tests {
    use super::built_in_font_assets;

    #[test]
    fn contains_pixel_font_families() {
        let assets = built_in_font_assets();
        let px_sans = assets.get("px-sans").expect("px-sans");
        assert!(px_sans
            .regular
            .as_ref()
            .is_some_and(|value| !value.is_empty()));
        assert!(px_sans.bold.as_ref().is_some_and(|value| !value.is_empty()));
    }

    #[test]
    fn contains_font_awesome_families() {
        let assets = built_in_font_assets();
        let fa_solid = assets.get("fa-solid").expect("fa-solid");
        assert!(fa_solid
            .regular
            .as_ref()
            .is_some_and(|value| !value.is_empty()));
        assert!(fa_solid.italic.is_none());
        assert!(fa_solid.bold.is_none());
        assert!(fa_solid.bold_italic.is_none());
    }
}
