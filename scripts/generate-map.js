/**
 * generate-map.js
 * Converts world-atlas TopoJSON to a filtered Europe GeoJSON file.
 * Run with: npm run setup
 */

const fs = require('fs');
const path = require('path');
const topojson = require('topojson-client');

// European country ISO 3166-1 numeric codes
const EUROPE_CODES = new Set([
  '008', // Albania
  '040', // Austria
  '056', // Belgium
  '070', // Bosnia and Herzegovina
  '100', // Bulgaria
  '112', // Belarus
  '191', // Croatia
  '203', // Czech Republic
  '208', // Denmark
  '233', // Estonia
  '246', // Finland
  '250', // France
  '276', // Germany
  '300', // Greece
  '348', // Hungary
  '352', // Iceland
  '372', // Ireland
  '380', // Italy
  '428', // Latvia
  '440', // Lithuania
  '442', // Luxembourg
  '498', // Moldova
  '499', // Montenegro
  '528', // Netherlands
  '578', // Norway
  '616', // Poland
  '620', // Portugal
  '642', // Romania
  '643', // Russia
  '688', // Serbia
  '703', // Slovakia
  '705', // Slovenia
  '724', // Spain
  '752', // Sweden
  '756', // Switzerland
  '804', // Ukraine
  '807', // North Macedonia
  '826', // United Kingdom
  '792', // Turkey
]);

// Name mapping for the numeric codes
const CODE_TO_NAME = {
  '008': 'Albania',
  '040': 'Austria',
  '056': 'Belgium',
  '070': 'Bosnia and Herzegovina',
  '100': 'Bulgaria',
  '112': 'Belarus',
  '191': 'Croatia',
  '203': 'Czechia',
  '208': 'Denmark',
  '233': 'Estonia',
  '246': 'Finland',
  '250': 'France',
  '276': 'Germany',
  '300': 'Greece',
  '348': 'Hungary',
  '352': 'Iceland',
  '372': 'Ireland',
  '380': 'Italy',
  '428': 'Latvia',
  '440': 'Lithuania',
  '442': 'Luxembourg',
  '498': 'Moldova',
  '499': 'Montenegro',
  '528': 'Netherlands',
  '578': 'Norway',
  '616': 'Poland',
  '620': 'Portugal',
  '642': 'Romania',
  '643': 'Russia',
  '688': 'Serbia',
  '703': 'Slovakia',
  '705': 'Slovenia',
  '724': 'Spain',
  '752': 'Sweden',
  '756': 'Switzerland',
  '804': 'Ukraine',
  '807': 'North Macedonia',
  '826': 'United Kingdom',
  '792': 'Turkey',
};

// Load TopoJSON from world-atlas
const topoPath = path.resolve(__dirname, '..', 'node_modules', 'world-atlas', 'countries-50m.json');
if (!fs.existsSync(topoPath)) {
  console.error('world-atlas countries-50m.json not found. Run npm install first.');
  process.exit(1);
}

const topoData = JSON.parse(fs.readFileSync(topoPath, 'utf8'));

// Convert to GeoJSON
const allCountries = topojson.feature(topoData, topoData.objects.countries);

// Filter to European countries and add names
const europeFeatures = allCountries.features
  .filter(f => EUROPE_CODES.has(f.id))
  .map(f => ({
    type: 'Feature',
    id: f.id,
    properties: {
      name: CODE_TO_NAME[f.id] || `Unknown (${f.id})`,
      code: f.id,
    },
    geometry: f.geometry,
  }));

const europeGeoJSON = {
  type: 'FeatureCollection',
  features: europeFeatures,
};

// Write output
const outDir = path.resolve(__dirname, '..', 'public', 'data');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outPath = path.join(outDir, 'europe.geo.json');
fs.writeFileSync(outPath, JSON.stringify(europeGeoJSON));
console.log(`✓ Generated ${outPath} with ${europeFeatures.length} countries`);
europeFeatures.forEach(f => console.log(`  - ${f.properties.name}`));
