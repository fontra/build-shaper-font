use wasm_bindgen::prelude::*;

use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
    fmt::Display,
    path::Path,
    str::FromStr,
};

use fea_rs::{
    compile::{validate, CompilationCtx, NopFeatureProvider, VariationInfo},
    parse::{parse_root, SourceLoadError},
    DiagnosticSet, GlyphMap,
};
use fontdrasil::{
    coords::{NormalizedLocation, UserCoord},
    types::{Axes, Axis},
    variations::VariationModel,
};
use write_fonts::{
    tables::{
        fvar::{AxisInstanceArrays, Fvar, VariationAxisRecord},
        name::NameRecord,
        variations::VariationRegion,
    },
    types::{NameId, Tag},
    OtRound,
};

const MAX_DIAGNOSTICS: usize = 100;

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn console_log(s: &str);
}

#[wasm_bindgen(getter_with_clone)]
#[derive(Clone)]
pub struct InsertMarker {
    pub tag: String,
    #[wasm_bindgen(js_name = "lookupId")]
    pub lookup_id: usize,
}

#[wasm_bindgen(getter_with_clone)]
pub struct AxisInfo {
    #[wasm_bindgen(js_name = "axisTag")]
    pub axis_tag: String,
    #[wasm_bindgen(js_name = "minValue")]
    pub min_value: f64,
    #[wasm_bindgen(js_name = "defaultValue")]
    pub default_value: f64,
    #[wasm_bindgen(js_name = "maxValue")]
    pub max_value: f64,
}

#[wasm_bindgen]
impl AxisInfo {
    #[wasm_bindgen(constructor)]
    pub fn new(
        #[wasm_bindgen(js_name = "axisTag")] axis_tag: String,
        #[wasm_bindgen(js_name = "minValue")] min_value: f64,
        #[wasm_bindgen(js_name = "defaultValue")] default_value: f64,
        #[wasm_bindgen(js_name = "maxValue")] max_value: f64,
    ) -> Self {
        AxisInfo {
            axis_tag,
            min_value,
            default_value,
            max_value,
        }
    }
}

struct SimpleVariationInfo {
    axes: Axes,
    model: VariationModel,
}

impl SimpleVariationInfo {
    fn new(axis_infos: Vec<AxisInfo>) -> Self {
        let axes = Axes::new(
            axis_infos
                .into_iter()
                .map(|a| {
                    let tag = Tag::from_str(&a.axis_tag).unwrap();
                    let min = UserCoord::new(a.min_value);
                    let default = UserCoord::new(a.default_value);
                    let max = UserCoord::new(a.max_value);
                    Axis {
                        name: a.axis_tag,
                        tag,
                        min,
                        default,
                        max,
                        hidden: false,
                        converter: fontdrasil::coords::CoordConverter::default_normalization(
                            min, default, max,
                        ),
                        localized_names: Default::default(),
                    }
                })
                .collect(),
        );

        let mut location = NormalizedLocation::new();
        axes.iter().for_each(|axis| {
            location.insert(axis.tag, axis.default.to_normalized(&axis.converter));
        });

        let locations = vec![location].into_iter().collect();
        let model = VariationModel::new(locations, axes.axis_order());

        Self { axes, model }
    }
}

#[derive(Debug)]
pub struct VariationError;

impl std::error::Error for VariationError {}

impl Display for VariationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("variation error")
    }
}

impl VariationInfo for SimpleVariationInfo {
    type Error = VariationError;

    fn axis_count(&self) -> u16 {
        self.axes.len() as u16
    }

    fn axis(&self, axis_tag: Tag) -> Option<(usize, &Axis)> {
        self.axes.iter().enumerate().find_map(|(i, axis)| {
            if axis_tag == axis.tag {
                Some((i, axis))
            } else {
                None
            }
        })
    }

    // Adapted from
    // https://github.com/googlefonts/fontc/blob/982b5b5acc2749b7e8e4ed7bba1ed655a5b7981d/fontbe/src/features.rs#L317
    fn resolve_variable_metric(
        &self,
        values: &HashMap<NormalizedLocation, i16>,
    ) -> Result<(i16, Vec<(VariationRegion, i16)>), Self::Error> {
        // Compute deltas using f64 as 1d point and delta, then ship them home as i16
        let point_seqs: HashMap<_, _> = values
            .iter()
            .map(|(pos, value)| (pos.clone(), vec![*value as f64]))
            .collect();

        let locations: HashSet<_> = point_seqs.keys().collect();
        let global_locations: HashSet<_> = self.model.locations().collect();

        // Try to reuse the global model, or make a new sub-model only with the locations we
        // are asked for so we can support sparseness
        let var_model: Cow<'_, VariationModel> = if locations == global_locations {
            Cow::Borrowed(&self.model)
        } else {
            Cow::Owned(VariationModel::new(
                locations.into_iter().cloned().collect(),
                self.axes.axis_order(),
            ))
        };

        // Only 1 value per region for our input
        let deltas: Vec<_> = var_model
            .deltas(&point_seqs)
            .map_err(|_| VariationError)?
            .into_iter()
            .map(|(region, values)| {
                assert!(values.len() == 1, "{} values?!", values.len());
                (region, values[0])
            })
            .collect();

        // Compute the default on the unrounded deltas
        let default_value = deltas
            .iter()
            .filter_map(|(region, value)| {
                let scaler = region.scalar_at(&var_model.default).into_inner();
                (scaler != 0.0).then_some(*value * scaler)
            })
            .sum::<f64>()
            .ot_round();

        // Produce the desired delta type
        let mut fears_deltas = Vec::with_capacity(deltas.len());
        for (region, value) in deltas.iter().filter(|(r, _)| !r.is_default()) {
            fears_deltas.push((
                region.to_write_fonts_variation_region(&self.axes),
                value.ot_round(),
            ));
        }

        Ok((default_value, fears_deltas))
    }

    fn resolve_glyphs_number_value(
        &self,
        _: &str,
    ) -> Result<HashMap<NormalizedLocation, f64>, Self::Error> {
        unimplemented!("Glyphs number values are not supported")
    }
}

#[wasm_bindgen(getter_with_clone)]
pub struct CompilationResult {
    #[wasm_bindgen(js_name = "fontData")]
    pub font_data: Option<Vec<u8>>,
    #[wasm_bindgen(js_name = "insertMarkers")]
    pub insert_markers: Option<Vec<InsertMarker>>,
    pub messages: String,
}

fn set_panic_hook() {
    // When the `console_error_panic_hook` feature is enabled, we can call the
    // `set_panic_hook` function at least once during initialization, and then
    // we will get better error messages if our code ever panics.
    //
    // For more details see
    // https://github.com/rustwasm/console_error_panic_hook#readme
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen(js_name = buildShaperFont)]
pub fn build_shaper_font(
    #[wasm_bindgen(js_name = "unitsPerEm")] units_per_em: u16,
    #[wasm_bindgen(js_name = "glyphOrder")] glyph_order: Vec<String>,
    #[wasm_bindgen(js_name = "featureSource")] feature_source: String,
    axes: Option<Vec<AxisInfo>>,
) -> Result<CompilationResult, JsError> {
    set_panic_hook();

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

    let variation_info = axes.map(SimpleVariationInfo::new);

    let diagnostics = validate(&tree, &glyph_map, variation_info.as_ref());
    if !diagnostics.is_empty() {
        messages.push(diagnostics.display().to_string());
        if diagnostics.has_errors() {
            return Err(JsError::new(&messages.join("\n")));
        }
    }

    let mut ctx = CompilationCtx::new(
        &glyph_map,
        tree.source_map(),
        variation_info.as_ref(),
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

            let mut fvar_axes = Vec::new();
            if let Some(variation_info) = variation_info {
                let mut name_table = compilation.name.take().unwrap_or_default();
                let mut name_id = name_table
                    .name_record
                    .iter()
                    .map(|r| r.name_id)
                    .max()
                    .unwrap_or(0.into())
                    .max(NameId::LAST_RESERVED_NAME_ID)
                    .checked_add(1)
                    .unwrap();

                for axis in variation_info.axes.iter() {
                    name_table.name_record.push(NameRecord::new(
                        3,
                        1,
                        0x0409,
                        name_id,
                        axis.ui_label_name().to_string().into(),
                    ));

                    fvar_axes.push(VariationAxisRecord {
                        axis_tag: axis.tag,
                        min_value: axis.min.into(),
                        default_value: axis.default.into(),
                        max_value: axis.max.into(),
                        axis_name_id: name_id,
                        ..Default::default()
                    });

                    name_id = name_id.checked_add(1).unwrap();
                }

                compilation.name = Some(name_table);
            }

            let mut builder = compilation.to_font_builder()?;

            if !fvar_axes.is_empty() {
                let fvar_table = Fvar::new(AxisInstanceArrays::new(fvar_axes, Vec::new()));
                builder.add_table(&fvar_table)?;
            }

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
