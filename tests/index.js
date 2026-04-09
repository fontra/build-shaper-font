import { expect } from 'chai';
import { buildShaperFont } from '../pkg/build_shaper_font.js';
import harfbuzz from "harfbuzzjs";

describe('buildShaperFont', function () {
  it('Build font with feature data', function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
languagesystem DFLT dflt;

feature kern {
    pos A V -50;
} kern;

feature curs {
} curs;
 `;
    const { fontData, insertMarkers, messages } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource });
    expect(fontData).to.not.equal(null);
    expect(insertMarkers).to.deep.equal([
      { tag: 'mark', lookupId: undefined },
      { tag: 'mkmk', lookupId: undefined },
    ]);
    expect(messages.length).to.equal(0);
  });

  it('Build font with feature data, return warnings', function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef'];
    const featureSource = `languagesystem DFLT dflt;

feature aalt {
    feature liga;
} aalt;
`;
    const { fontData, messages, formattedMessages, insertMarkers } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource });
    expect(fontData).to.not.equal(undefined);
    expect(messages[0].level).to.equal('warning');
    expect(messages[0].text).to.equal('Referenced feature not found.');
    expect(featureSource.substring(...messages[0].span)).to.equal('liga');
    expect(formattedMessages).to.equal(`warning: Referenced feature not found.
in features.fea at 4:12
  | 
4 |     feature liga;
  |             ^^^^
`);
    expect(insertMarkers).to.deep.equal([
      { tag: 'curs', lookupId: undefined },
      { tag: 'kern', lookupId: undefined },
      { tag: 'mark', lookupId: undefined },
      { tag: 'mkmk', lookupId: undefined },
    ]);
  });

  it('Build font with feature data, return errors', function () {
    const unitsPerEm = 2000;
    const glyphOrder = ['.notdef'];
    const featureSource = "languagesystem DFLT dflt";
    const { fontData, messages, formattedMessages } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource });
    expect(fontData).to.equal(undefined);
    expect(messages[0].level).to.equal('error');
    expect(messages[0].text).to.equal("Expected ';'");
    expect(messages[0].span).to.deep.equal([featureSource.length, featureSource.length + 1]);
    expect(formattedMessages).to.equal(`error: Expected ';'
in features.fea at 1:24
  | 
1 | languagesystem DFLT dflt
  |                         ^
`);
  });

  it('Build font with feature data, return warnings with correct UTF-16 indices', function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef'];
    const featureSource = `
# 🌈
languagesystem DFLT dflt;

feature aalt {
    feature liga;
} aalt;
 `;
    const { fontData, messages } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource });
    expect(fontData).to.not.equal(undefined);
    expect(messages[0].level).to.equal('warning');
    expect(messages[0].text).to.equal('Referenced feature not found.');
    expect(featureSource.substring(...messages[0].span)).to.equal('liga');
  });

  it('Build font with with insert markers', function () {
    const unitsPerEm = 2000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
languagesystem DFLT dflt;

feature kern {
    pos A V -50;
    # Automatic Code
} kern;

feature mark {
    # Automatic Code
} mark;

feature mkmk {
    pos A V -20;
} mkmk;
`;
    const { fontData, insertMarkers } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource });
    expect(fontData).to.not.equal(null);
    expect(insertMarkers).to.deep.equal([
      { tag: 'kern', lookupId: 1 },
      { tag: 'mark', lookupId: 1 },
      { tag: 'curs', lookupId: undefined },
    ]);
  });

  it('Build font with with insert markers sorted by priority', function () {
    const unitsPerEm = 2000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
languagesystem DFLT dflt;

feature kern {
    # Automatic Code
} kern;

feature curs {
    # Automatic Code
} curs;

feature mkmk {
    # Automatic Code
} mkmk;

feature mark {
    # Automatic Code
} mark;
`;
    const { insertMarkers } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource });
    expect(insertMarkers).to.deep.equal([
      { tag: 'kern', lookupId: 0 },
      { tag: 'curs', lookupId: 0 },
      { tag: 'mkmk', lookupId: 0 },
      { tag: 'mark', lookupId: 0 },
    ]);
  });

  it('Build font with variations', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = '';
    const axes = [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }];
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource, axes });
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);
    expect(face.getAxisInfos()).to.deep.equal({
      wght: { min: 100, default: 400, max: 900 }
    });
  });

  it('Build font with variable GPOS', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
languagesystem DFLT dflt;

feature kern {
    pos A V (wght=400:-50 wght=900:0 wght=100:-100);
} kern;
 `;
    const axes = [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }];
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource, axes });
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);
    const font = hb.createFont(face);

    let fontFuncs = hb.createFontFuncs();
    fontFuncs.setNominalGlyphFunc((_, codepoint) => {
      const ch = String.fromCodePoint(codepoint);
      if (glyphOrder.includes(ch)) {
        return glyphOrder.indexOf(ch);
      }
      return 0;
    });

    fontFuncs.setGlyphHAdvanceFunc(() => {
      return 100;
    });

    font.setFuncs(fontFuncs);

    const buffer = hb.createBuffer();
    buffer.addText('AV');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const positions = buffer.getGlyphPositions();
    expect(positions[0].x_advance).to.equal(50);
    expect(positions[1].x_advance).to.equal(100);

    font.setVariations({ 'wght': 100 });
    buffer.clearContents();
    buffer.addText('AV');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const positions2 = buffer.getGlyphPositions();
    expect(positions2[0].x_advance).to.equal(0);
    expect(positions2[1].x_advance).to.equal(100);

    font.setVariations({ 'wght': 900 });
    buffer.clearContents();
    buffer.addText('AV');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const positions3 = buffer.getGlyphPositions();
    expect(positions3[0].x_advance).to.equal(100);
    expect(positions3[1].x_advance).to.equal(100);
  });

  it('Build font and shape with HarfBuzz', async function () {
    const unitsPerEm = 2000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
languagesystem DFLT dflt;

feature kern {
    pos A V -50;
} kern;
`;
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource });

    let hb = await harfbuzz;

    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);
    const font = hb.createFont(face);

    let fontFuncs = hb.createFontFuncs();
    fontFuncs.setNominalGlyphFunc((_, codepoint) => {
      const ch = String.fromCodePoint(codepoint);
      if (glyphOrder.includes(ch)) {
        return glyphOrder.indexOf(ch);
      }
      return 0;
    });

    fontFuncs.setGlyphHAdvanceFunc(() => {
      return 100;
    });

    font.setFuncs(fontFuncs);

    const buffer = hb.createBuffer();
    buffer.addText('AV');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);

    const infos = buffer.getGlyphInfos();
    const positions = buffer.getGlyphPositions();
    expect(infos.length).to.equal(2);
    expect(positions.length).to.equal(2);
    expect(infos[0].codepoint).to.equal(1);
    expect(infos[1].codepoint).to.equal(2);
    expect(positions[0].x_advance).to.equal(50);
    expect(positions[1].x_advance).to.equal(100);
  });

  it('Build font with variations and name table', function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
table name {
    nameid 1 "Family";
    nameid 1 3 1 0x0809 "Family UK";
} name;
`;
    const axes = [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }];
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource, axes });
    expect(fontData).to.not.equal(null);
  });

  it('Build font with glyph classes', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'baseGlyph', 'ligatureGlyph', 'markGlyph', 'componentGlyph'];
    const glyphClasses = {
      base: ['baseGlyph'],
      ligature: ['ligatureGlyph'],
      mark: ['markGlyph'],
      component: ['componentGlyph']
    };
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { glyphClasses });
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);

    expect(face.getGlyphClass(0)).to.equal('UNCLASSIFIED');
    expect(face.getGlyphClass(1)).to.equal('BASE_GLYPH');
    expect(face.getGlyphClass(2)).to.equal('LIGATURE');
    expect(face.getGlyphClass(3)).to.equal('MARK');
    expect(face.getGlyphClass(4)).to.equal('COMPONENT');
  });

  it('Build font with partial glyph classes', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'baseGlyph', 'ligatureGlyph', 'markGlyph', 'componentGlyph'];
    const glyphClasses = {
      mark: ['markGlyph'],
    };
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { glyphClasses });
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);

    expect(face.getGlyphClass(0)).to.equal('UNCLASSIFIED');
    expect(face.getGlyphClass(1)).to.equal('UNCLASSIFIED');
    expect(face.getGlyphClass(2)).to.equal('UNCLASSIFIED');
    expect(face.getGlyphClass(3)).to.equal('MARK');
    expect(face.getGlyphClass(4)).to.equal('UNCLASSIFIED');
  });

  it('Do not override glyph if present in features', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'baseGlyph', 'ligatureGlyph', 'markGlyph', 'componentGlyph'];
    const featureSource = `
table GDEF {
  GlyphClassDef [baseGlyph], [ligatureGlyph], [markGlyph], [componentGlyph];
} GDEF;
`;
    const glyphClasses = {
      base: ['componentGlyph'],
      ligature: ['markGlyph'],
      mark: ['ligatureGlyph'],
      component: ['baseGlyph']
    };
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource, glyphClasses });
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);

    expect(face.getGlyphClass(0)).to.equal('UNCLASSIFIED');
    expect(face.getGlyphClass(1)).to.equal('BASE_GLYPH');
    expect(face.getGlyphClass(2)).to.equal('LIGATURE');
    expect(face.getGlyphClass(3)).to.equal('MARK');
    expect(face.getGlyphClass(4)).to.equal('COMPONENT');
  });

  it('Build font with glyph classes and variable GPOS', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
languagesystem DFLT dflt;

feature kern {
    pos A V (wght=400:-50 wght=900:0 wght=100:-100);
} kern;
 `;
    const axes = [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }];
    const glyphClasses = {
      base: ['A', 'V'],
    };
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource, axes, glyphClasses });
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);
    const font = hb.createFont(face);

    let fontFuncs = hb.createFontFuncs();
    fontFuncs.setNominalGlyphFunc((_, codepoint) => {
      const ch = String.fromCodePoint(codepoint);
      if (glyphOrder.includes(ch)) {
        return glyphOrder.indexOf(ch);
      }
      return 0;
    });

    fontFuncs.setGlyphHAdvanceFunc(() => {
      return 100;
    });

    font.setFuncs(fontFuncs);

    const buffer = hb.createBuffer();
    buffer.addText('AV');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const positions = buffer.getGlyphPositions();
    expect(positions[0].x_advance).to.equal(50);
    expect(positions[1].x_advance).to.equal(100);

    font.setVariations({ 'wght': 100 });
    buffer.clearContents();
    buffer.addText('AV');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const positions2 = buffer.getGlyphPositions();
    expect(positions2[0].x_advance).to.equal(0);
    expect(positions2[1].x_advance).to.equal(100);

    font.setVariations({ 'wght': 900 });
    buffer.clearContents();
    buffer.addText('AV');
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    const positions3 = buffer.getGlyphPositions();
    expect(positions3[0].x_advance).to.equal(100);
    expect(positions3[1].x_advance).to.equal(100);

    expect(face.getGlyphClass(0)).to.equal('UNCLASSIFIED');
    expect(face.getGlyphClass(1)).to.equal('BASE_GLYPH');
    expect(face.getGlyphClass(2)).to.equal('BASE_GLYPH');
  });

  it('Build font with feature variations', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'cent', 'cent.alt1', 'cent.alt2', 'dollar', 'dollar.alt1', 'dollar.alt2'];
    const axes = [
      { tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 },
      { tag: 'wdth', minValue: 100, defaultValue: 400, maxValue: 900 }
    ];
    const featureSource = 'languagesystem DFLT dflt;';
    const glyphClasses = {};
    const conditionalSubstitutions = [
      {
        featureTags: ["rvrn"],
        rules: [
          [[{ "wght": [null, 600] }], { "dollar": "dollar.alt1" }],
          [[{ "wght": [600, 900] }], { "dollar": "dollar.alt2" }],
          [[{ "wdth": [500, 700] }], { "cent": "cent.alt1" }],
          [[{ "wdth": [700, null] }], { "cent": "cent.alt2" }],
        ]
      }
    ];

    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, { featureSource, axes, glyphClasses, conditionalSubstitutions });
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);
    const font = hb.createFont(face);

    let fontFuncs = hb.createFontFuncs();
    fontFuncs.setNominalGlyphFunc((_, codepoint) => {
      if (codepoint === 0x00A2) return glyphOrder.indexOf('cent');
      if (codepoint === 0x0024) return glyphOrder.indexOf('dollar');
      return 0;
    });

    font.setFuncs(fontFuncs);
    const text = '¢$';

    // wght=400, wdth=400
    const buffer = hb.createBuffer();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    let infos = buffer.getGlyphInfos();
    expect(infos[0].codepoint).to.equal(1); // 'cent'
    expect(infos[1].codepoint).to.equal(5); // 'dollar.alt1'

    font.setVariations({ 'wdth': 600, 'wght': 400 });
    buffer.clearContents();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    infos = buffer.getGlyphInfos();
    expect(infos[0].codepoint).to.equal(2); // 'cent.alt1'
    expect(infos[1].codepoint).to.equal(5); // 'dollar.alt1'

    font.setVariations({ 'wdth': 400, 'wght': 700 });
    buffer.clearContents();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    infos = buffer.getGlyphInfos();
    expect(infos[0].codepoint).to.equal(1); // 'cent'
    expect(infos[1].codepoint).to.equal(6); // 'dollar.alt2'

    font.setVariations({ 'wdth': 800, 'wght': 400 });
    buffer.clearContents();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    infos = buffer.getGlyphInfos();
    expect(infos[0].codepoint).to.equal(3); // 'cent.alt2'
    expect(infos[1].codepoint).to.equal(5); // 'dollar.alt1'

    font.setVariations({ 'wdth': 800, 'wght': 700 });
    buffer.clearContents();
    buffer.addText(text);
    buffer.guessSegmentProperties();
    hb.shape(font, buffer);
    infos = buffer.getGlyphInfos();
    expect(infos[0].codepoint).to.equal(3); // 'cent.alt2'
    expect(infos[1].codepoint).to.equal(6); // 'dollar.alt2'
  });

  it('Build font with feature variations with unknown glyph name should fail', function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'cent', 'dollar'];
    const axes = [
      { tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 },
    ];
    const featureSource = 'languagesystem DFLT dflt;';
    const glyphClasses = {};
    const conditionalSubstitutions = [
      {
        featureTags: ["rvrn"],
        rules: [
          [[{ "wght": [500, 900] }], { "cent": "cent.alt1" }],
        ]
      }
    ];

    expect(() =>
      buildShaperFont(
        unitsPerEm,
        glyphOrder,
        { featureSource, axes, glyphClasses, conditionalSubstitutions },
      ),
    ).to.throw(/not found in glyph order/);
  });

  it('Build font with Debg table', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = `
languagesystem DFLT dflt;

lookup kern_1 {
   pos A V -50;
} kern_1;

feature kern {
   lookup kern_1;
} kern;
`;
    const { fontData } = buildShaperFont(
      unitsPerEm,
      glyphOrder,
      { featureSource, compileDebg: true }
    );
    expect(fontData).to.not.equal(null);

    let hb = await harfbuzz;
    const blob = hb.createBlob(fontData);
    const face = hb.createFace(blob);

    const debgTable = face.reference_table('Debg');
    expect(debgTable).to.not.equal(undefined);

    const debgJson = JSON.parse(new TextDecoder().decode(debgTable));
    const debgData = debgJson['com.github.fonttools.feaLib'];
    expect(debgData).to.not.equal(undefined);
    expect(debgData['GPOS']).to.deep.equal({ '0': ['features.fea:4:7', "kern_1", null] });
  });
});
