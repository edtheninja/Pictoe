//! Prints the OpenAPI spec. Regenerate the committed copy with:
//!
//!     cargo run --example openapi > openapi.json

fn main() {
    println!(
        "{}",
        pictoe_api::openapi()
            .to_pretty_json()
            .expect("the spec serializes")
    );
}
