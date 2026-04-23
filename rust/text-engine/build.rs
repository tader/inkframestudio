fn main() {
    if let Err(error) = pkg_config::Config::new().probe("harfbuzz") {
        panic!("failed to find harfbuzz via pkg-config: {error}");
    }
}
