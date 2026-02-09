mod utils;

use wasm_bindgen::prelude::*;

use std::path::Path;

use fea_rs::{
    compile::{validate, CompilationCtx, NopFeatureProvider, NopVariationInfo},
    parse::{parse_root, SourceLoadError},
    DiagnosticSet, GlyphMap,
};

const MAX_DIAGNOSTICS: usize = 100;

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct InsertMarker {
    pub tag: String,
    #[wasm_bindgen(js_name = "lookupId")]
    pub lookup_id: usize,
}

#[wasm_bindgen(getter_with_clone)]
pub struct CompilationResult {
    #[wasm_bindgen(js_name = "fontData")]
    pub font_data: Option<Vec<u8>>,
    #[wasm_bindgen(js_name = "insertMarkers")]
    pub insert_markers: Option<Vec<InsertMarker>>,
    pub messages: String,
}

#[wasm_bindgen(js_name = buildShaperFont)]
pub fn build_shaper_font(
    #[wasm_bindgen(js_name = "unitsPerEm")] units_per_em: u16,
    #[wasm_bindgen(js_name = "glyphOrder")] glyph_order: Vec<String>,
    #[wasm_bindgen(js_name = "featureSource")] feature_source: String,
    _axes: JsValue,
) -> Result<CompilationResult, JsError> {
    utils::set_panic_hook();

    let glyph_map: GlyphMap = glyph_order.iter().map(|s| s.as_str()).collect();

    let mut messages = Vec::new();

    const SRC_NAME: &str = "features.fea";
    let (tree, diagnostics) = parse_root(
        SRC_NAME.into(),
        Some(&glyph_map),
        Box::new(move |s: &Path| {
            if s == Path::new(SRC_NAME) {
                Ok(feature_source.clone().into())
            } else {
                Err(SourceLoadError::new(
                    s.to_path_buf(),
                    "parse_string cannot handle imports",
                ))
            }
        }),
    )?;

    if !diagnostics.is_empty() {
        messages.push(diagnostics.display().to_string());
        if diagnostics.has_errors() {
            return Err(JsError::new(&messages.join("\n")));
        }
    }

    let diagnostics = validate(&tree, &glyph_map, None::<&NopVariationInfo>);
    if !diagnostics.is_empty() {
        messages.push(diagnostics.display().to_string());
        if diagnostics.has_errors() {
            return Err(JsError::new(&messages.join("\n")));
        }
    }

    let mut ctx = CompilationCtx::new(
        &glyph_map,
        tree.source_map(),
        None::<&NopVariationInfo>,
        None::<&NopFeatureProvider>,
        Default::default(),
    );
    ctx.compile(&tree.typed_root());

    let mut insert_markers: Vec<_> = ctx
        .insert_markers
        .iter()
        .map(|(tag, point)| InsertMarker {
            tag: tag.to_string(),
            lookup_id: point.lookup_id.to_raw(),
        })
        .collect();
    insert_markers.sort_by(|a, b| a.tag.cmp(&b.tag));

    match ctx.build() {
        Ok((mut compilation, warnings)) => {
            if !warnings.is_empty() {
                let diagnostics = DiagnosticSet::new(warnings, &tree, MAX_DIAGNOSTICS);
                messages.push(diagnostics.display().to_string());
            }

            let mut head_table = compilation.head.take().unwrap_or_default();
            head_table.units_per_em = units_per_em;
            compilation.head = Some(head_table);

            let mut builder = compilation.to_font_builder()?;
            let font_data = builder.build();

            Ok(CompilationResult {
                font_data: Some(font_data),
                insert_markers: Some(insert_markers),
                messages: messages.join("\n"),
            })
        }
        Err(errors) => {
            let diagnostics = DiagnosticSet::new(errors, &tree, MAX_DIAGNOSTICS);
            messages.push(diagnostics.display().to_string());

            Err(JsError::new(&messages.join("\n")))
        }
    }
}
