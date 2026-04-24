use std::io::{Read, Write};

use epd_text_engine::{render, LayoutRequest};

fn main() {
    if std::env::args().any(|arg| arg == "--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        let _ = writeln!(std::io::stderr(), "stdin read failed: {error}");
        std::process::exit(1);
    }
    let request: LayoutRequest = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => {
            let _ = writeln!(std::io::stderr(), "request parse failed: {error}");
            std::process::exit(1);
        }
    };
    match render(request) {
        Ok(result) => {
            let stdout = std::io::stdout();
            let mut handle = stdout.lock();
            if let Err(error) = serde_json::to_writer(&mut handle, &result) {
                let _ = writeln!(std::io::stderr(), "response write failed: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            let _ = writeln!(std::io::stderr(), "{error}");
            std::process::exit(1);
        }
    }
}
