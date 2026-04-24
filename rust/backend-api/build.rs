use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;

fn extract_json_object(source: &str, const_name: &str) -> Result<String, String> {
    let marker = format!("export const {} = ", const_name);
    let start = source
        .find(&marker)
        .ok_or_else(|| format!("missing marker for {}", const_name))?
        + marker.len();
    let rest = &source[start..];
    let end = rest
        .rfind("} as const;")
        .ok_or_else(|| format!("missing closing object for {}", const_name))?;
    Ok(rest[..=end].to_string())
}

fn parse_font_asset_file(
    path: &str,
    const_name: &str,
) -> Result<BTreeMap<String, BTreeMap<String, String>>, String> {
    let text =
        fs::read_to_string(path).map_err(|error| format!("read {} failed: {}", path, error))?;
    let json = extract_json_object(&text, const_name)?;
    serde_json::from_str(&json).map_err(|error| format!("parse {} failed: {}", path, error))
}

fn main() {
    let generated_font_data = parse_font_asset_file(
        "../../packages/render-core/src/generated-font-data.ts",
        "FONT_BINARY_BASE64",
    )
    .expect("parse generated font data");
    let generated_font_awesome_data = parse_font_asset_file(
        "../../packages/render-core/src/generated-font-awesome-data.ts",
        "FONT_AWESOME_FONT_BINARY_BASE64",
    )
    .expect("parse generated font awesome data");

    let mut merged = generated_font_data;
    merged.extend(generated_font_awesome_data);
    let merged_json = serde_json::to_string(&merged).expect("serialize merged font data");

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let output = out_dir.join("generated_font_assets.rs");
    fs::write(
        &output,
        format!(
            "pub const GENERATED_FONT_ASSETS_JSON: &str = r#\"{}\"#;\n",
            merged_json
        ),
    )
    .expect("write generated font assets");

    println!("cargo:rerun-if-changed=../../packages/render-core/src/generated-font-data.ts");
    println!(
        "cargo:rerun-if-changed=../../packages/render-core/src/generated-font-awesome-data.ts"
    );
}
