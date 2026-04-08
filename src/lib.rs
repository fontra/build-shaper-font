use wasm_bindgen::prelude::*;

use std::{
    collections::{HashMap, HashSet},
    path::Path,
    str::FromStr,
};

use serde::{Deserialize, Serialize};

use fea_rs::{
    compile::{self, validate, Opts},
    parse::{parse_root, ParseTree, SourceLoadError},
    typed::{AstNode, Feature},
    DiagnosticSet, GlyphMap,
};
use fontbe::features::{FeaVariationInfo, FeatureVariationsProvider};
use fontdrasil::{
    coords::{CoordConverter, DesignCoord, UserCoord},
    types::{Axis, GlyphName},
};
use fontir::ir::{Condition, GlyphOrder, Rule, StaticMetadata, Substitution, VariableFeature};
use write_fonts::{
    tables::{
        fvar::{AxisInstanceArrays, Fvar, VariationAxisRecord},
        gdef::{Gdef, GlyphClassDef},
        layout::ClassDef,
        name::NameRecord,
    },
    types::{GlyphId16, NameId, Tag},
};

const MAX_DIAGNOSTICS: usize = 100;

#[wasm_bindgen]
extern "C" {
    // Use `js_namespace` here to bind `console.log(..)` instead of just
    // `log(..)`
    #[wasm_bindgen(js_namespace = console, js_name = log)]
    fn console_log(s: &str);
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertMarker {
    pub tag: String,
    pub lookup_id: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisInfo {
    pub tag: String,
    pub min_value: f64,
    pub default_value: f64,
    pub max_value: f64,
}

#[derive(Clone, Deserialize)]
pub struct GlyphClasses {
    pub base: Option<Vec<String>>,
    pub mark: Option<Vec<String>>,
    pub ligature: Option<Vec<String>>,
    pub component: Option<Vec<String>>,
}

type ConditionsInput = Vec<HashMap<String, (Option<f64>, Option<f64>)>>;
type SubstitutionsInput = HashMap<String, String>;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeatureVariationInput {
    feature_tags: Vec<String>,
    rules: Vec<(ConditionsInput, SubstitutionsInput)>,
}

fn to_variable_feature(
    inputs: Vec<FeatureVariationInput>,
    glyph_order: &[String],
) -> Result<VariableFeature, String> {
    let mut features = Vec::new();
    let mut rules = Vec::new();

    for input in inputs {
        features.extend(input.feature_tags.iter().map(|t| Tag::from_str(t).unwrap()));
        for (conditions, substitutions) in input.rules {
            for (from, to) in &substitutions {
                if !glyph_order.iter().any(|g| g == from) {
                    return Err(format!(
                        "glyph '{from}' in feature variation substitution not found in glyph order"
                    ));
                }
                if !glyph_order.iter().any(|g| g == to) {
                    return Err(format!(
                        "glyph '{to}' in feature variation substitution not found in glyph order"
                    ));
                }
            }
            rules.push(Rule {
                conditions: vec![conditions
                    .into_iter()
                    .flat_map(|m| m.into_iter())
                    .map(|(axis_tag, (min, max))| Condition {
                        axis: Tag::from_str(&axis_tag).unwrap(),
                        min: min.map(DesignCoord::new),
                        max: max.map(DesignCoord::new),
                    })
                    .collect()],
                substitutions: substitutions
                    .into_iter()
                    .map(|(from, to)| Substitution {
                        replace: GlyphName::from(from),
                        with: GlyphName::from(to),
                    })
                    .collect(),
            });
        }
    }

    Ok(VariableFeature { features, rules })
}

#[derive(Clone, Serialize)]
pub struct Message {
    pub level: String,
    pub text: String,
    pub span: (usize, usize),
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompilationResult {
    #[serde(with = "serde_bytes")]
    pub font_data: Option<Vec<u8>>,
    pub insert_markers: Option<Vec<InsertMarker>>,
    pub messages: Vec<Message>,
    pub formatted_messages: String,
}

impl CompilationResult {
    fn add_diagnostics(&mut self, diagnostics: &DiagnosticSet, tree: &ParseTree) {
        for diagnostic in diagnostics.diagnostics().iter().take(MAX_DIAGNOSTICS) {
            let source = tree
                .get_source(diagnostic.message.file)
                .map(|s| s.text())
                .unwrap_or("");
            let span = diagnostic.span();

            self.messages.push(Message {
                level: format!("{:?}", diagnostic.level).to_lowercase(),
                text: diagnostic.message.text.clone(),
                span: (
                    to_utf16_offset(source, span.start),
                    to_utf16_offset(source, span.end),
                ),
            });
        }

        // display() renders source-context-annotated diagnostics (file paths,
        // line numbers, caret markers). It uses an internal cap from the
        // DiagnosticSet; compile::compile() sets that to usize::MAX, so in
        // theory a pathological FEA file could produce a large string. In
        // practice this is rare and preserving the rich output is worth it.
        self.formatted_messages += &diagnostics.display().to_string();
    }

    fn into_js(self) -> JsValue {
        serde_wasm_bindgen::to_value(&self).unwrap()
    }
}

fn to_utf16_offset(s: &str, byte_offset: usize) -> usize {
    s.get(..byte_offset)
        .map(|s| s.chars().map(|c| c.len_utf16()).sum())
        .unwrap_or(byte_offset)
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
    axes: JsValue,
    #[wasm_bindgen(js_name = "glyphClasses")] glyph_classes: JsValue,
    #[wasm_bindgen(js_name = "featureVariations")] feature_variations: JsValue,
    #[wasm_bindgen(js_name = "compileDebg")] compile_debg: Option<bool>,
) -> Result<JsValue, JsError> {
    set_panic_hook();

    let axes: Option<Vec<AxisInfo>> =
        serde_wasm_bindgen::from_value(axes).map_err(|e| JsError::new(&e.to_string()))?;

    let gdef_classes: Option<GlyphClasses> =
        serde_wasm_bindgen::from_value(glyph_classes).map_err(|e| JsError::new(&e.to_string()))?;

    let feat_vars: Option<Vec<FeatureVariationInput>> =
        serde_wasm_bindgen::from_value(feature_variations)
            .map_err(|e| JsError::new(&e.to_string()))?;

    let glyph_map: GlyphMap = glyph_order.iter().map(|s| s.as_str()).collect();

    const SRC_NAME: &str = "features.fea";
    let (tree, diagnostics) = match parse_root(
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
    ) {
        Ok(res) => res,
        Err(e) => return Err(JsError::new(&e.to_string())),
    };

    let mut res = CompilationResult::default();
    res.add_diagnostics(&diagnostics, &tree);
    if diagnostics.has_errors() {
        return Ok(res.into_js());
    }

    let static_metadata = axes.map(|axis_infos| {
        let axes: Vec<Axis> = axis_infos
            .into_iter()
            .map(|a| {
                let tag = Tag::from_str(&a.tag).unwrap();
                let min = UserCoord::new(a.min_value);
                let default = UserCoord::new(a.default_value);
                let max = UserCoord::new(a.max_value);
                Axis {
                    name: a.tag,
                    tag,
                    min,
                    default,
                    max,
                    hidden: false,
                    converter: CoordConverter::unmapped(min, default, max),
                    localized_names: Default::default(),
                }
            })
            .collect();
        let default_location = axes
            .iter()
            .map(|a| (a.tag, a.default.to_normalized(&a.converter)))
            .collect();
        StaticMetadata::new(
            units_per_em,
            Default::default(),
            axes,
            Vec::new(),
            HashSet::from([default_location]),
            None,
            0.0,
            None,
            false,
        )
        .expect("failed to build static metadata")
    });
    let variation_info = static_metadata.as_ref().map(FeaVariationInfo::new);

    let diagnostics = validate(&tree, &glyph_map, variation_info.as_ref());
    res.add_diagnostics(&diagnostics, &tree);
    if diagnostics.has_errors() {
        return Ok(res.into_js());
    }

    let feat_vars_provider = match feat_vars.filter(|v| !v.is_empty()) {
        Some(v) => {
            let sm = static_metadata
                .as_ref()
                .expect("axes required for feature variations");
            let var_feat = to_variable_feature(v, &glyph_order).map_err(|e| JsError::new(&e))?;
            let ir_glyph_order: GlyphOrder = glyph_order
                .iter()
                .map(|s| GlyphName::from(s.as_str()))
                .collect();
            Some(
                FeatureVariationsProvider::new(&var_feat, sm, &ir_glyph_order)
                    .expect("failed to build feature variations"),
            )
        }
        None => None,
    };

    match compile::compile(
        &tree,
        &glyph_map,
        variation_info.as_ref(),
        feat_vars_provider.as_ref(),
        Opts::default().compile_debg(compile_debg.unwrap_or(false)),
    ) {
        Ok((mut compilation, diagnostics)) => {
            res.add_diagnostics(&diagnostics, &tree);

            // Build insert markers from the Compilation result
            let mut insert_markers: Vec<_> = compilation.insert_markers.iter().collect();
            insert_markers.sort_by(|(_, a), (_, b)| a.priority.cmp(&b.priority));
            let mut insert_markers: Vec<InsertMarker> = insert_markers
                .into_iter()
                .map(|(tag, point)| InsertMarker {
                    tag: tag.to_string(),
                    lookup_id: Some(point.lookup_id.to_raw()),
                })
                .collect();

            // Add default insert markers.
            // If both a feature and corresponding insert marker are missing,
            // add an insert marker with None lookup_id for that feature,
            // in the same order the feature writer would have inserted code
            // for that feature.
            for tag in ["curs", "kern", "mark", "mkmk"] {
                let has_marker = insert_markers.iter().any(|m| m.tag == tag);
                let has_feature = tree.typed_root().statements().any(|statement| {
                    Feature::cast(statement)
                        .map(|f| f.tag().text() == tag)
                        .unwrap_or(false)
                });

                if !has_marker && !has_feature {
                    insert_markers.push(InsertMarker {
                        tag: tag.to_string(),
                        lookup_id: None,
                    });
                }
            }

            let mut head_table = compilation.head.take().unwrap_or_default();
            head_table.units_per_em = units_per_em;
            compilation.head = Some(head_table);

            let mut fvar_axes = Vec::new();
            if let Some(sm) = static_metadata.as_ref() {
                let mut name_table = compilation.name.take().unwrap_or_default();
                let mut name_id = name_table
                    .name_record
                    .iter()
                    .map(|r| r.name_id)
                    .max()
                    .unwrap_or(0.into())
                    .max(NameId::LAST_RESERVED_NAME_ID)
                    .checked_add(1)
                    .ok_or_else(|| JsError::new("name_id overflow"))?;

                for axis in sm.axes.iter() {
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

                    name_id = name_id
                        .checked_add(1)
                        .ok_or_else(|| JsError::new("name_id overflow"))?;
                }

                name_table.name_record.sort();

                compilation.name = Some(name_table);
            }

            if let Some(glyph_classes) = gdef_classes {
                let has_feature_gdef_classes = compilation
                    .gdef
                    .as_ref()
                    .map(|gdef| !gdef.glyph_class_def.is_none())
                    .unwrap_or(false);

                if !has_feature_gdef_classes {
                    let mut classes = Vec::new();

                    let mut add_class = |names: &Option<Vec<String>>, class_val: GlyphClassDef| {
                        if let Some(names) = names {
                            for name in names {
                                if let Some(gid) = glyph_map.get(name.as_str()) {
                                    classes.push((GlyphId16::new(gid.to_u16()), class_val as u16));
                                }
                            }
                        }
                    };

                    add_class(&glyph_classes.base, GlyphClassDef::Base);
                    add_class(&glyph_classes.ligature, GlyphClassDef::Ligature);
                    add_class(&glyph_classes.mark, GlyphClassDef::Mark);
                    add_class(&glyph_classes.component, GlyphClassDef::Component);

                    if !classes.is_empty() {
                        let class_def = ClassDef::from_iter(classes);
                        if let Some(gdef) = compilation.gdef.as_mut() {
                            gdef.glyph_class_def = Some(class_def).into();
                        } else {
                            compilation.gdef = Some(Gdef::new(Some(class_def), None, None, None));
                        }
                    }
                }
            }

            let mut builder = compilation
                .to_font_builder()
                .map_err(|e| JsError::new(&e.to_string()))?;

            if !fvar_axes.is_empty() {
                let fvar_table = Fvar::new(AxisInstanceArrays::new(fvar_axes, Vec::new()));
                builder
                    .add_table(&fvar_table)
                    .map_err(|e| JsError::new(&e.to_string()))?;
            }

            res.font_data = Some(builder.build());
            res.insert_markers = Some(insert_markers);
            Ok(res.into_js())
        }
        Err(diagnostics) => {
            res.add_diagnostics(&diagnostics, &tree);
            Ok(res.into_js())
        }
    }
}
