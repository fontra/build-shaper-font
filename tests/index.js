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
    expect(insertMarkers).to.deep.equal([]);
    expect(messages).to.equal('');
  });

  it('Build font with feature data, return warnings', function () {
    const unitsPerEm = 1000;
    const glyphOrder = ['.notdef'];
    const featureSource = `
languagesystem DFLT dflt;

feature aalt {
    feature liga;
} aalt;
`;
    const { fontData, insertMarkers, messages } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);
    expect(fontData).to.not.equal(null);
    expect(insertMarkers).to.deep.equal([]);
    expect(messages).to.match(/warning: Referenced feature not found./);
  });

  it('Build font with feature data, throws errors', function () {
    const unitsPerEm = 2000;
    const glyphOrder = ['.notdef'];
    const featureSource = "languagesystem DFLT dflt";
    expect(() => buildShaperFont(unitsPerEm, glyphOrder, featureSource)).to.throw(/Expected ';'/);
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
    const { fontData, insertMarkers, messages } = buildShaperFont(unitsPerEm, glyphOrder, featureSource);
    expect(fontData).to.not.equal(null);
    expect(insertMarkers.length).to.equal(2);
    expect([insertMarkers[0].tag, insertMarkers[0].lookupId]).to.deep.equal(['kern', 1]);
    expect([insertMarkers[1].tag, insertMarkers[1].lookupId]).to.deep.equal(['mark', 1]);
    expect(messages).to.equal('');
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
