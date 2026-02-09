#![cfg(target_arch = "wasm32")]

extern crate wasm_bindgen_test;
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;

use build_shaper_font::build_shaper_font;

#[wasm_bindgen_test]
fn test_build_shaper_font() {
    let units_per_em = 1000;
    let glyph_order = vec!["A".to_string(), "V".to_string(), "A.alt".to_string()];

    let feature_source = "
languagesystem DFLT dflt;

feature kern {
    pos A V -50;
    #pos A A.alt (wght=400:-50 wght=900:50 wght=100:0);
    # Automatic Code
} kern;

feature ss01 {
    featureNames {
        name \"Small Caps\";
    };
    sub A by A.alt;
} ss01;

feature aalt {
    feature liga;
    feature ss01;
} aalt;
";

    let result = build_shaper_font(
        units_per_em,
        glyph_order,
        feature_source.to_string(),
        JsValue::NULL,
    );
    assert!(result.is_ok());
    let result = result.unwrap();
    assert!(result.font_data.is_some());
    assert!(result.insert_markers.is_some());
    assert!(!result.messages.is_empty());
}
