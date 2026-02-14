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
 `;
    const { fontData, insertMarkers, messages } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);
    expect(fontData).to.not.equal(null);
    expect(insertMarkers.length).to.equal(0);
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
    const { fontData, messages, formattedMessages } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);
    expect(fontData).to.not.equal(undefined);
    expect(messages[0].level).to.equal('warning');
    expect(messages[0].text).to.equal('Referenced feature not found.');
    expect(featureSource.substring(messages[0].span.start, messages[0].span.end)).to.equal('liga');
    expect(formattedMessages).to.equal(`warning: Referenced feature not found.
in features.fea at 4:12
  | 
4 |     feature liga;
  |             ^^^^
`);
  });

  it('Build font with feature data, return errors', function () {
    const unitsPerEm = 2000;
    const glyphOrder = ['.notdef'];
    const featureSource = "languagesystem DFLT dflt";
    const { fontData, messages, formattedMessages } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);
    expect(fontData).to.equal(undefined);
    expect(messages[0].level).to.equal('error');
    expect(messages[0].text).to.equal("Expected ';'");
    expect(messages[0].span.start).to.equal(featureSource.length);
    expect(messages[0].span.end).to.equal(featureSource.length + 1);
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
    const { fontData, messages } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);
    expect(fontData).to.not.equal(undefined);
    expect(messages[0].level).to.equal('warning');
    expect(messages[0].text).to.equal('Referenced feature not found.');
    expect(featureSource.substring(messages[0].span.start, messages[0].span.end)).to.equal('liga');
  });

  it('Build font with feature data with insert markers', function () {
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
    const { fontData, insertMarkers } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);
    expect(fontData).to.not.equal(null);
    expect(insertMarkers.length).to.equal(2);
    expect([insertMarkers[0].tag, insertMarkers[0].lookupId]).to.deep.equal(['kern', 1]);
    expect([insertMarkers[1].tag, insertMarkers[1].lookupId]).to.deep.equal(['mark', 1]);
  });

  it('Build font with variations', async function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef', 'A', 'V'];
    const featureSource = '';
    const axes = [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }];
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, featureSource, axes);
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
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, featureSource, axes);
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
    const { fontData } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);

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
});
