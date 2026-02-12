import { expect } from 'chai';
import { buildShaperFont } from '../pkg/build_shaper_font.js';

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
});
