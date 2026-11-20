/** Small hand-drawn category glyphs for the palette (16×16, stroke = currentColor). */
import type { ReactElement } from 'react';
import iconUrl from '../../../../build/icon.svg?url';

type G = ReactElement;
const S = (children: G | G[]): G => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const GLYPHS: Record<string, () => G> = {
  laser: () => S([<rect key="a" x="1.5" y="5.5" width="7" height="5" rx="1" />, <path key="b" d="M8.5 8h6" stroke="#c00000" />]),
  mirror: () => S([<path key="a" d="M5 2.5 11 13.5" />, <path key="b" d="M6.6 2 12.6 13" strokeOpacity=".4" strokeDasharray="1 1.4" />]),
  splitter: () => S([<rect key="a" x="4.5" y="4.5" width="7" height="7" />, <path key="b" d="M4.5 11.5l7-7" />, <path key="c" d="M1 8h3.5M11.5 8H15M8 11.5V15" strokeOpacity=".6" />]),
  lens: () => S([<path key="a" d="M8 1.8c2.4 2.8 2.4 9.6 0 12.4-2.4-2.8-2.4-9.6 0-12.4Z" />]),
  prism: () => S([<path key="a" d="M8 2.2 14 13H2Z" />, <path key="b" d="M1 9l5-.8" strokeOpacity=".6" />]),
  grating: () => S([<path key="a" d="M4 2v12M6.5 2v12M9 2v12M11.5 2v12" />]),
  polarizer: () => S([<circle key="a" cx="8" cy="8" r="5.8" />, <path key="b" d="M8 3v10" />, <path key="c" d="M6 4.5v7M10 4.5v7" strokeOpacity=".5" />]),
  magneto: () => S([<rect key="a" x="3" y="4" width="10" height="8" rx="1.5" />, <path key="b" d="M5 4v8M8 4v8M11 4v8" strokeOpacity=".55" />]),
  fiber: () => S([<path key="a" d="M2 12c3 0 3-8 6-8s3 8 6 8" />, <circle key="b" cx="2" cy="12" r="1" />, <circle key="c" cx="14" cy="12" r="1" />]),
  aperture: () => S([<path key="a" d="M8 1.5v4.5M8 10v4.5" />, <path key="b" d="M5.5 1.5h5M5.5 14.5h5" />]),
  filter: () => S([<rect key="a" x="5.5" y="2" width="5" height="12" rx="1" />, <path key="b" d="M1.5 8h4" />, <path key="c" d="M10.5 8h4" strokeOpacity=".4" />]),
  nonlinear: () => S([<rect key="a" x="5" y="4" width="6" height="8" />, <path key="b" d="M1 8h4" stroke="#f87171" />, <path key="c" d="M11 8h4" stroke="#4ade80" />]),
  detector: () => S([<rect key="a" x="9" y="3" width="4.5" height="10" rx="1" />, <path key="b" d="M2 8h7" strokeOpacity=".6" />, <path key="c" d="M11.2 6v4" />]),
  field: () => S([<circle key="a" cx="8" cy="8" r="2.2" />, <circle key="b" cx="8" cy="8" r="5.5" strokeOpacity=".4" />]),
  medium: () => S([<rect key="a" x="2.5" y="4" width="11" height="8" rx="1" />, <path key="b" d="M2.5 8c3-2 8-2 11 0" strokeOpacity=".5" />]),
  // circuit
  battery: () => S([<path key="a" d="M6 4v8M10 6v4" />, <path key="b" d="M1.5 8H6M10 8h4.5" />]),
  ground: () => S([<path key="a" d="M8 2v6M3.5 8h9M5.5 10.5h5M7.2 13h1.6" />]),
  resistor: () => S([<path key="a" d="M1 8h2.5l1.2-3 2 6 2-6 2 6 1.3-3H15" />]),
  capacitor: () => S([<path key="a" d="M6.5 3v10M9.5 3v10M1 8h5.5M9.5 8H15" />]),
  inductor: () => S([<path key="a" d="M1 9h2c0-3 3-3 3 0 0-3 3-3 3 0 0-3 3-3 3 0h2" />]),
  diode: () => S([<path key="a" d="M5 4v8l6-4Z" />, <path key="b" d="M11 4v8M1 8h4M11 8h4" />]),
  transistor: () => S([<circle key="a" cx="8.5" cy="8" r="5.5" />, <path key="b" d="M6.5 5v6M1 8h5.5M6.5 7l4-3M6.5 9l4 3" />]),
  switch: () => S([<circle key="a" cx="3.5" cy="10" r="1.2" />, <circle key="b" cx="12.5" cy="10" r="1.2" />, <path key="c" d="M4.5 9.4 12 5" />]),
  display: () => S([<path key="a" d="M5 2.5h6M4.5 3l-.5 4.5M11.5 3l-.5 4.5M5 8h6M4 8.5l-.5 4.5M11 8.5l-.5 4.5M4 13.5h6" />]),
  meter: () => S([<circle key="a" cx="8" cy="8" r="6" />, <path key="b" d="M8 8l3-3" />, <path key="c" d="M4.5 10.5h7" strokeOpacity=".5" />]),
  scope: () => S([<rect key="a" x="1.5" y="3" width="13" height="10" rx="1" />, <path key="b" d="M3 9c1.5-4 2.5-4 4 0s2.5 4 4 0 1.5-2 2-2" stroke="#c00000" />]),
  ic: () => S([<rect key="a" x="4" y="3" width="8" height="10" rx="1" />, <path key="b" d="M2 5h2M2 8h2M2 11h2M12 5h2M12 8h2M12 11h2" />]),
  logic: () => S([<path key="a" d="M3 3h5a5 5 0 0 1 0 10H3Z" />, <path key="b" d="M13 8h2" />]),
  clock: () => S([<rect key="a" x="3" y="4" width="10" height="8" rx="1.5" />, <path key="b" d="M5 10V6h2v4h2V6h2" />]),
  lamp: () => S([<circle key="a" cx="8" cy="7" r="4.5" />, <path key="b" d="M5 4l6 6M11 4l-6 6" strokeOpacity=".6" />, <path key="c" d="M6.5 13h3" />]),
  opto: () => S([<path key="a" d="M4 4v8l6-4Z" />, <path key="b" d="M10 4v8" />, <path key="c" d="M11 3l3-2M12 5.5l3-2" stroke="#0a246a" />]),
  camera: () => S([<rect key="a" x="8.5" y="3" width="6" height="10" rx="1" />, <path key="b" d="M2 8h6.5" strokeOpacity=".6" />, <path key="c" d="M10 5.5h3M10 8h3M10 10.5h3" strokeOpacity=".7" />]),
  polarimeter: () => S([<rect key="a" x="9" y="3" width="5" height="10" rx="1" />, <ellipse key="b" cx="4.5" cy="8" rx="3" ry="1.6" transform="rotate(-35 4.5 8)" />]),
  wavemeter: () => S([<rect key="a" x="7" y="3" width="7.5" height="10" rx="1" />, <path key="b" d="M1 8c1-2 2-2 3 0s2 2 3 0" stroke="#c00000" />, <path key="c" d="M9 7h4M9 9.5h3" />]),
  modulator: () => S([<rect key="a" x="4.5" y="4" width="7" height="8" />, <path key="b" d="M6 6v4M8 6v4M10 6v4" strokeOpacity=".55" />, <path key="c" d="M1 8h3.5M11.5 8l3-2.5M11.5 8H15" strokeOpacity=".7" />]),
  chopper: () => S([<circle key="a" cx="8" cy="8" r="6" />, <path key="b" d="M8 8 8 2A6 6 0 0 1 14 8ZM8 8 8 14A6 6 0 0 1 2 8Z" fill="currentColor" fillOpacity=".35" />, <circle key="c" cx="8" cy="8" r=".8" />]),
  lcd: () => S([<rect key="a" x="2" y="3" width="12" height="10" rx=".5" />, <path key="b" d="M4 5.5h3v2H4zM9 5.5h3v2H9zM4 9h3v2H4zM9 9h3v2H9z" strokeOpacity=".6" />]),
  solar: () => S([<path key="a" d="M2 3c3 6 9 6 12 0" />, <path key="b" d="M4 1.5 8 8M12 1.5 8 8M8 1v7" strokeOpacity=".5" />, <rect key="c" x="6" y="9" width="4" height="5" />]),
  retro: () => S([<path key="a" d="M3 3h10L8 13Z" />, <path key="b" d="M8 3v10M3 3l7.5 5" strokeOpacity=".45" />]),
  expander: () => S([<path key="a" d="M4 5c1 1 1 5 0 6-1-1-1-5 0-6Z" />, <path key="b" d="M11 2.5c1.6 2 1.6 9 0 11-1.6-2-1.6-9 0-11Z" />, <path key="c" d="M1 8h2M5 7l5-3M5 9l5 3" strokeOpacity=".5" />]),
  diffuser: () => S([<rect key="a" x="6.5" y="2" width="3" height="12" />, <path key="b" d="M1 8h5.5M9.5 8l5-4M9.5 8H15M9.5 8l5 4" strokeOpacity=".55" strokeDasharray="1 1.2" />]),
  cavity: () => S([<path key="a" d="M2.5 3c1 2 1 8 0 10M13.5 3c-1 2-1 8 0 10" />, <path key="b" d="M3.5 8h9" stroke="#c00000" />]),
  motor: () => S([<circle key="a" cx="8" cy="8" r="5.5" />, <path key="b" d="M5.5 10.5v-5L8 8.5l2.5-3v5" />, <path key="c" d="M1 8h1.5M13.5 8H15" />]),
  servo: () => S([<rect key="a" x="1.5" y="4" width="13" height="8" rx="1" />, <circle key="b" cx="10" cy="8" r="1.2" />, <path key="c" d="M10 8 6 5" strokeWidth="1.8" />]),
  thermistor: () => S([<rect key="a" x="4" y="6" width="8" height="4" />, <path key="b" d="M1 8h3M12 8h3" />, <path key="c" d="M2.5 13h2l7-10" />]),
  fuse: () => S([<rect key="a" x="3.5" y="5.5" width="9" height="5" rx=".5" />, <path key="b" d="M1 8h14" />]),
  opamp: () => S([<path key="a" d="M3 2.5v11L13.5 8Z" />, <path key="b" d="M4.5 5.5h2M5.5 9.5v2M4.5 10.5h2" />, <path key="c" d="M1 5.5h2M1 10.5h2M13.5 8H15" />]),
  regulator: () => S([<rect key="a" x="3.5" y="4" width="9" height="7" />, <path key="b" d="M1 7.5h2.5M12.5 7.5H15M8 11v3.5" />, <path key="c" d="M6 7.5h4" strokeOpacity=".6" />]),
  generic: () => S([<rect key="a" x="3" y="3" width="10" height="10" rx="2" />])
};

const TYPE_RULES: [RegExp, keyof typeof GLYPHS][] = [
  [/^source\.laser_cavity/, 'cavity'],
  [/^source\.(laser|beam|point|led|white)/, 'laser'],
  [/^source\.clock/, 'clock'],
  [/^modulator\./, 'modulator'],
  [/^chopper\./, 'chopper'],
  [/^display\.lcd_panel/, 'lcd'],
  [/^solar\./, 'solar'],
  [/^retro\./, 'retro'],
  [/^beam\.expander/, 'expander'],
  [/^diffuser\./, 'diffuser'],
  [/^detector\.camera/, 'camera'],
  [/^detector\.polarimeter/, 'polarimeter'],
  [/^detector\.wavemeter/, 'wavemeter'],
  [/^misc\.motor/, 'motor'],
  [/^misc\.servo/, 'servo'],
  [/^passive\.thermistor/, 'thermistor'],
  [/^passive\.fuse/, 'fuse'],
  [/^ic\.(opamp|comparator)/, 'opamp'],
  [/^ic\.regulator/, 'regulator'],
  [/^mirror\./, 'mirror'],
  [/^splitter\./, 'splitter'],
  [/^lens\./, 'lens'],
  [/^(prism|block)\./, 'prism'],
  [/^medium\./, 'medium'],
  [/^grating\./, 'grating'],
  [/^(polarizer|waveplate)\./, 'polarizer'],
  [/^magneto\./, 'magneto'],
  [/^field\./, 'field'],
  [/^fiber\./, 'fiber'],
  [/^(aperture|absorber)\./, 'aperture'],
  [/^filter\./, 'filter'],
  [/^nonlinear\./, 'nonlinear'],
  [/^detector\./, 'detector'],
  [/^opto\./, 'opto'],
  [/^misc\.ground/, 'ground'],
  [/^source\.(battery|psu|current)/, 'battery'],
  [/^source\.(ac|function_gen)/, 'scope'],
  [/^osc\./, 'clock'],
  [/^ic\./, 'ic'],
  [/^passive\.(resistor|potentiometer)/, 'resistor'],
  [/^passive\.capacitor/, 'capacitor'],
  [/^passive\.(inductor|transformer)/, 'inductor'],
  [/^semi\.(diode|zener|led)/, 'diode'],
  [/^semi\./, 'transistor'],
  [/^switch\./, 'switch'],
  [/^display\./, 'display'],
  [/^meter\.probe/, 'scope'],
  [/^meter\./, 'meter'],
  [/^digital\./, 'logic'],
  [/^misc\./, 'lamp']
];

const CATEGORY_RULES: [RegExp, keyof typeof GLYPHS][] = [
  [/source|laser/i, 'laser'], [/mirror/i, 'mirror'], [/split/i, 'splitter'], [/lens/i, 'lens'],
  [/prism|block/i, 'prism'], [/diffract|grating/i, 'grating'], [/polari/i, 'polarizer'],
  [/electromech/i, 'motor'], [/modulat/i, 'modulator'], [/magnet/i, 'magneto'], [/exotic/i, 'field'], [/fiber/i, 'fiber'], [/aperture/i, 'aperture'], [/filter/i, 'filter'],
  [/nonlinear/i, 'nonlinear'], [/detector/i, 'detector'], [/opto/i, 'opto'], [/power|suppl/i, 'battery'],
  [/oscill|ic/i, 'ic'], [/passive/i, 'resistor'], [/semi/i, 'transistor'], [/switch/i, 'switch'],
  [/display/i, 'display'], [/meter|instrument/i, 'meter'], [/digital|logic/i, 'logic']
];

export function TypeGlyph({ type }: { type: string }): G {
  const rule = TYPE_RULES.find(([re]) => re.test(type));
  return GLYPHS[rule ? rule[1] : 'generic']();
}

export function CategoryGlyph({ category, domain }: { category: string; domain: 'optics' | 'circuit' }): G {
  const rule = CATEGORY_RULES.find(([re]) => re.test(category));
  if (rule && !(domain === 'circuit' && rule[1] === 'laser')) return GLYPHS[rule[1]]();
  return GLYPHS[domain === 'circuit' && /source/i.test(category) ? 'battery' : 'generic']();
}

export function AppLogo({ size = 20 }: { size?: number }): G {
  return <img src={iconUrl} width={size} height={size} alt="" draggable={false} style={{ borderRadius: size * 0.22 }} />;
}
