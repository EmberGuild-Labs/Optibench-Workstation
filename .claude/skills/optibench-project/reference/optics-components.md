# Optics components

Generated from the live registry by `node scripts/obw.mjs list-components optics --md`.

Positions in mm, `rotation` in radians (clockwise on screen, +y is down). Every prop below is in the unit shown; angle-like props (`deg`) are DEGREES.

## Sources

### `source.laser` — Laser

Monochromatic, collimated, linearly polarized beam with a Gaussian (TEM00) intensity profile. Rays are distributed across the 1/e^2 beam diameter with Gaussian power weights and fan out with the specified full-angle divergence. A non-zero linewidth is sampled as a Gaussian spectrum.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `wavelength` | 632.8 | nm | 200 … 2000 | Vacuum wavelength. 632.8 nm = HeNe, 532 nm = doubled Nd:YAG, 1064 nm = Nd:YAG (infrared, shown dim red). |
| `power` | 0.005 | W | 0.000001 … 100 | Total emitted optical power. Can be driven from the circuit (laser diode / LED link). |
| `beamDiameter` | 1 | mm | 0.01 … 100 | Diameter at which the intensity falls to 1/e^2 (13.5 %) of the peak. |
| `divergence` | 1 | mrad | 0 … 500 | Full-angle beam divergence. A diffraction-limited 633 nm beam of 1 mm diameter diverges by about 0.8 mrad. |
| `linewidth` | 0 | nm | 0 … 50 | Spectral width. 0 = perfectly monochromatic. Laser diodes are typically 0.5-2 nm wide. |
| `rays` | 5 |  | 0 … 2000 | Number of rays used to sample the beam. 0 = use the scene default. Broadband sources multiply this by the number of spectral samples. |
| `polarization` | "linear" |  | `unpolarized`, `linear`, `circular_l`, `circular_r` | Polarization state of the emitted light. The engine carries the full 2x2 coherency (Jones) matrix of every ray, so partially polarized light is handled exactly. |
| `polAngle` | 0 | deg | -180 … 180 | Angle of the electric field for linear polarization: 0 deg = p (in the plane of the bench), 90 deg = s (perpendicular to the bench). |

### `source.led` — LED

Light-emitting diode: a small extended emitter with a Gaussian spectrum (centre wavelength + FWHM) and a cos^m angular pattern. A half-intensity angle of 60 deg corresponds to an ideal Lambertian emitter (m = 1). Unpolarized.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `wavelength` | 525 | nm | 200 … 2000 | Peak emission wavelength. |
| `fwhm` | 30 | nm | 0 … 200 | Full width at half maximum of the emission spectrum (typically 20-40 nm). |
| `power` | 0.05 | W | 0.000001 … 100 | Total emitted optical power. Can be driven from the circuit (laser diode / LED link). |
| `halfAngle` | 60 | deg | 2 … 85 | Angle from the axis at which the radiant intensity drops to 50 %. 60 deg = Lambertian; smaller values model a lensed LED. |
| `size` | 1 | mm | 0 … 20 | Width of the light-emitting chip. |
| `rays` | 40 |  | 0 … 2000 | Number of rays used to sample the beam. 0 = use the scene default. Broadband sources multiply this by the number of spectral samples. |
| `polarization` | "unpolarized" |  | `unpolarized`, `linear`, `circular_l`, `circular_r` | Polarization state of the emitted light. The engine carries the full 2x2 coherency (Jones) matrix of every ray, so partially polarized light is handled exactly. |
| `polAngle` | 0 | deg | -180 … 180 | Angle of the electric field for linear polarization: 0 deg = p (in the plane of the bench), 90 deg = s (perpendicular to the bench). |

### `source.white` — White Light

Broadband white beam. The spectrum is either a Planck blackbody of the given colour temperature (2700 K incandescent, 5778 K sunlight), a phosphor-converted white LED (blue pump + broad yellow phosphor) or an equal-energy spectrum, sampled across 380-780 nm. Every spatial ray carries all spectral samples, so prisms and gratings produce true spectra and lenses show chromatic aberration.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `spectrum` | "blackbody" |  | `blackbody`, `white_led`, `flat` | Shape of the emitted spectrum. |
| `temperature` | 5778 | K | 1000 … 20000 | Blackbody temperature (Planck law). Only used for the blackbody spectrum. |
| `wavelengthMin` | 380 | nm | 200 … 2000 | Short-wavelength limit of the emitted band. The spectral samples cover only [start, end] (swapped if start > end) and the configured Power is the power INSIDE this band; the spectral shape within the band is unchanged. Ignored for the monochromatic spectrum. |
| `wavelengthMax` | 780 | nm | 200 … 2000 | Long-wavelength limit of the emitted band. See Band start. |
| `power` | 1 | W | 0.000001 … 100 | Total emitted optical power. Can be driven from the circuit (laser diode / LED link). |
| `beamWidth` | 4 | mm | 0 … 200 | Width of the emitted beam. |
| `divergence` | 0 | deg | 0 … 180 | Full-angle divergence of the beam; 0 = collimated. |
| `rays` | 7 |  | 0 … 2000 | Number of rays used to sample the beam. 0 = use the scene default. Broadband sources multiply this by the number of spectral samples. |
| `polarization` | "unpolarized" |  | `unpolarized`, `linear`, `circular_l`, `circular_r` | Polarization state of the emitted light. The engine carries the full 2x2 coherency (Jones) matrix of every ray, so partially polarized light is handled exactly. |
| `polAngle` | 0 | deg | -180 … 180 | Angle of the electric field for linear polarization: 0 deg = p (in the plane of the bench), 90 deg = s (perpendicular to the bench). |

### `source.point` — Point Source

Idealised point emitter radiating uniformly into the chosen angular range (360 deg = isotropic). Useful for imaging experiments with lenses and mirrors.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `spectrum` | "mono" |  | `mono`, `blackbody`, `white_led`, `flat` | Emitted spectrum. |
| `wavelength` | 550 | nm | 200 … 2000 | Wavelength for the monochromatic spectrum. |
| `temperature` | 5778 | K | 1000 … 20000 | Blackbody temperature. |
| `wavelengthMin` | 380 | nm | 200 … 2000 | Short-wavelength limit of the emitted band. The spectral samples cover only [start, end] (swapped if start > end) and the configured Power is the power INSIDE this band; the spectral shape within the band is unchanged. Ignored for the monochromatic spectrum. |
| `wavelengthMax` | 780 | nm | 200 … 2000 | Long-wavelength limit of the emitted band. See Band start. |
| `power` | 0.1 | W | 0.000001 … 100 | Total emitted optical power. Can be driven from the circuit (laser diode / LED link). |
| `spread` | 360 | deg | 1 … 360 | Total angular range of emission, centred on the component axis. |
| `rays` | 48 |  | 0 … 2000 | Number of rays used to sample the beam. 0 = use the scene default. Broadband sources multiply this by the number of spectral samples. |
| `polarization` | "unpolarized" |  | `unpolarized`, `linear`, `circular_l`, `circular_r` | Polarization state of the emitted light. The engine carries the full 2x2 coherency (Jones) matrix of every ray, so partially polarized light is handled exactly. |
| `polAngle` | 0 | deg | -180 … 180 | Angle of the electric field for linear polarization: 0 deg = p (in the plane of the bench), 90 deg = s (perpendicular to the bench). |

### `source.beam` — Collimated Beam

Wide collimated beam of parallel, uniformly spaced rays - the classic ray-box. Choose a monochromatic line for clean lens / mirror experiments or a broadband spectrum to reveal dispersion and chromatic aberration.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `spectrum` | "blackbody" |  | `mono`, `blackbody`, `white_led`, `flat` | Emitted spectrum. |
| `wavelength` | 550 | nm | 200 … 2000 | Wavelength for the monochromatic spectrum. |
| `temperature` | 6500 | K | 1000 … 20000 | Blackbody temperature. |
| `wavelengthMin` | 380 | nm | 200 … 2000 | Short-wavelength limit of the emitted band. The spectral samples cover only [start, end] (swapped if start > end) and the configured Power is the power INSIDE this band; the spectral shape within the band is unchanged. Ignored for the monochromatic spectrum. |
| `wavelengthMax` | 780 | nm | 200 … 2000 | Long-wavelength limit of the emitted band. See Band start. |
| `power` | 1 | W | 0.000001 … 100 | Total emitted optical power. Can be driven from the circuit (laser diode / LED link). |
| `beamWidth` | 30 | mm | 0.1 … 500 | Width of the beam. |
| `divergence` | 0 | deg | 0 … 90 | Full-angle divergence; 0 = perfectly collimated. |
| `rays` | 9 |  | 0 … 2000 | Number of rays used to sample the beam. 0 = use the scene default. Broadband sources multiply this by the number of spectral samples. |
| `polarization` | "unpolarized" |  | `unpolarized`, `linear`, `circular_l`, `circular_r` | Polarization state of the emitted light. The engine carries the full 2x2 coherency (Jones) matrix of every ray, so partially polarized light is handled exactly. |
| `polAngle` | 0 | deg | -180 … 180 | Angle of the electric field for linear polarization: 0 deg = p (in the plane of the bench), 90 deg = s (perpendicular to the bench). |

## Mirrors

### `mirror.flat` — Flat Mirror

Plane first-surface mirror. Angle of reflection equals angle of incidence. With a metal coating the reflectance is computed from the complex Fresnel equations, which also changes the polarization state of obliquely reflected light.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 40 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `coating` | "silver" |  | `silver`, `aluminium`, `gold`, `ideal` | Metal coatings use measured complex refractive indices (Johnson & Christy, Rakic) in the full Fresnel equations, so reflectance and the s/p phase shift depend on wavelength, angle and polarization. Gold absorbs blue/green light; aluminium reflects ~91 %; silver ~97 %. |
| `reflectivity` | 1 |  | 0 … 1 | Power reflectivity used when the coating is Ideal. The remainder is absorbed. |
| `doubleSided` | true |  | true / false | If off, only the front face (facing local -x) reflects and the back absorbs light like a real first-surface mirror substrate. |

### `mirror.spherical` — Spherical Mirror

Mirror whose surface is part of a circle of the given radius of curvature; focal length f = R/2 for paraxial rays. Positive radius = concave (focusing), negative = convex (diverging). Rays far from the axis focus closer to the mirror - spherical aberration emerges from the exact geometry.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `radius` | 200 | mm | -5000 … 5000 | Positive: concave towards the incoming light (front faces local -x). Negative: convex. Focal length = R/2. |
| `size` | 50 | mm | 1 … 500 | Aperture (chord height) of the mirror. |
| `coating` | "silver" |  | `silver`, `aluminium`, `gold`, `ideal` | Metal coatings use measured complex refractive indices (Johnson & Christy, Rakic) in the full Fresnel equations, so reflectance and the s/p phase shift depend on wavelength, angle and polarization. Gold absorbs blue/green light; aluminium reflects ~91 %; silver ~97 %. |
| `reflectivity` | 1 |  | 0 … 1 | Power reflectivity used when the coating is Ideal. The remainder is absorbed. |
| `doubleSided` | false |  | true / false | If off, only the front face (facing local -x) reflects and the back absorbs light like a real first-surface mirror substrate. |

### `mirror.parabolic` — Parabolic Mirror

Mirror with a parabolic profile. All rays parallel to the axis converge exactly at the focus regardless of their height - no spherical aberration - which is why telescopes and satellite dishes use parabolas. Intersections are computed analytically. Negative focal length gives a convex parabola.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `focalLength` | 100 | mm | -5000 … 5000 | Distance from the vertex to the focus (focus lies at local x = -f). |
| `size` | 60 | mm | 1 … 500 | Aperture height of the mirror. |
| `coating` | "silver" |  | `silver`, `aluminium`, `gold`, `ideal` | Metal coatings use measured complex refractive indices (Johnson & Christy, Rakic) in the full Fresnel equations, so reflectance and the s/p phase shift depend on wavelength, angle and polarization. Gold absorbs blue/green light; aluminium reflects ~91 %; silver ~97 %. |
| `reflectivity` | 1 |  | 0 … 1 | Power reflectivity used when the coating is Ideal. The remainder is absorbed. |
| `doubleSided` | false |  | true / false | If off, only the front face (facing local -x) reflects and the back absorbs light like a real first-surface mirror substrate. |

### `mirror.dichroic` — Dichroic Mirror

Interference-coated plate that reflects one part of the spectrum and transmits the rest without absorption. The transition at the cut-off wavelength follows a smooth logistic edge of the given 10-90 % width. Longpass: transmits wavelengths above the cut-off and reflects those below; shortpass is the opposite.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 40 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `mode` | "longpass" |  | `longpass`, `shortpass` | Which side of the cut-off is transmitted. |
| `cutoff` | 550 | nm | 200 … 2000 | 50 % transmission point. |
| `edgeWidth` | 15 | nm | 0.5 … 200 | Spectral width of the transition from reflecting to transmitting. |
| `efficiency` | 0.98 |  | 0 … 1 | Maximum reflectance / transmittance in the respective bands. |

## Splitters

### `splitter.plate` — Plate Beam Splitter

Idealised thin, non-polarizing partially reflecting plate. A fraction R of the power is reflected, T = 1 - R - loss is transmitted. Use it for interferometer layouts, beam sampling and power division. (For a physical glass plate with ghost reflections use a Glass Slab.)

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 40 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `reflectance` | 0.5 |  | 0 … 1 | Fraction of incident power that is reflected (R:T = 50:50 for 0.5). |
| `loss` | 0 |  | 0 … 1 | Fraction of power absorbed in the coating. |

### `splitter.pbs` — Polarizing Beam Splitter Cube

Glass cube with a dielectric coating on its internal diagonal. p-polarized light (electric field in the plane of the bench) is transmitted straight through; s-polarized light (field perpendicular to the bench) is reflected by 90 degrees. The outer faces refract like real glass (optionally anti-reflection coated).

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 25.4 | mm | 2 … 200 | Edge length of the cube. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `tp` | 0.97 |  | 0 … 1 | Transmittance of the diagonal for p-polarized light; the remainder is reflected. |
| `rs` | 0.999 |  | 0 … 1 | Reflectance of the diagonal for s-polarized light; the remainder leaks through (extinction ratio Tp : Ts). |
| `coating` | "ideal" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

## Lenses

### `lens.biconvex` — Bi-Convex Lens

Converging lens with two equal convex spherical surfaces - a real thick lens made of dispersive glass. Marginal rays focus closer than paraxial rays (spherical aberration) and blue focuses closer than red (chromatic aberration). Best for 1:1 imaging.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `focalLength` | 100 | mm | 5 … 5000 | Paraxial effective focal length at 587.6 nm. The surface radii are derived from it with the thick-lens lensmaker equation; the lens is then traced as real spherical glass surfaces, so spherical and chromatic aberration appear naturally. |
| `diameter` | 25.4 | mm | 1 … 300 | Clear diameter of the lens. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |
| `edgeThickness` | 2 | mm | 0.1 … 50 | Thickness of the lens at its rim; the centre thickness follows from the curvature. |

### `lens.biconcave` — Bi-Concave Lens

Diverging lens with two equal concave spherical surfaces. Parallel rays leave as if they came from a virtual focus in front of the lens. Used for beam expansion and to correct converging lenses.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `focalLength` | -100 | mm | -5000 … -5 | Paraxial effective focal length at 587.6 nm. The surface radii are derived from it with the thick-lens lensmaker equation; the lens is then traced as real spherical glass surfaces, so spherical and chromatic aberration appear naturally. |
| `diameter` | 25.4 | mm | 1 … 300 | Clear diameter of the lens. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |
| `centerThickness` | 2.5 | mm | 0.1 … 100 | Thickness of the lens on the optical axis. |

### `lens.planoconvex` — Plano-Convex Lens

Converging lens with one spherical and one flat surface. For focusing a collimated beam the curved side should face the collimated light - turning it around roughly quadruples the spherical aberration, which you can verify by rotating the lens by 180 degrees.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `focalLength` | 100 | mm | 5 … 5000 | Paraxial effective focal length at 587.6 nm. The surface radii are derived from it with the thick-lens lensmaker equation; the lens is then traced as real spherical glass surfaces, so spherical and chromatic aberration appear naturally. |
| `diameter` | 25.4 | mm | 1 … 300 | Clear diameter of the lens. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |
| `edgeThickness` | 2 | mm | 0.1 … 50 | Thickness of the lens at its rim; the centre thickness follows from the curvature. |

### `lens.planoconcave` — Plano-Concave Lens

Diverging lens with one concave spherical and one flat surface. Commonly used as the negative element of a Galilean beam expander.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `focalLength` | -100 | mm | -5000 … -5 | Paraxial effective focal length at 587.6 nm. The surface radii are derived from it with the thick-lens lensmaker equation; the lens is then traced as real spherical glass surfaces, so spherical and chromatic aberration appear naturally. |
| `diameter` | 25.4 | mm | 1 … 300 | Clear diameter of the lens. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |
| `centerThickness` | 2.5 | mm | 0.1 … 100 | Thickness of the lens on the optical axis. |

### `lens.ball` — Ball Lens

Glass sphere. Effective focal length f = nD / (4(n-1)), measured from the centre, with very strong spherical aberration. Used for fibre coupling; with water as the material it models a raindrop - the internal reflection produces the rainbow angle of about 42 degrees.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `diameter` | 10 | mm | 0.5 … 200 | Diameter of the sphere. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

### `lens.ideal` — Ideal Thin Lens

Mathematically perfect paraxial thin lens: a ray at height h is bent so that tan(theta_out) = tan(theta_in) - h/f. It images stigmatically with no spherical or chromatic aberration and no reflection losses - the textbook lens, useful as a reference against the real glass lenses.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `focalLength` | 100 | mm | -5000 … 5000 | Positive = converging, negative = diverging. |
| `size` | 40 | mm | 1 … 500 | Clear aperture of the lens. |

### `lens.custom` — Custom Lens

Thick lens defined directly by its two radii of curvature, centre thickness, diameter and material - meniscus, asymmetric and thick lenses are all possible. Sign convention: a radius is positive when its centre of curvature lies on the +x (exit) side; 0 means flat. Focal length follows the lensmaker equation 1/f = (n-1)[1/R1 - 1/R2 + (n-1)d/(n R1 R2)].

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `r1` | 60 | mm | -5000 … 5000 | Radius of the surface facing -x. Positive = convex, negative = concave, 0 = flat. |
| `r2` | -200 | mm | -5000 … 5000 | Radius of the surface facing +x. Negative = convex, positive = concave, 0 = flat. |
| `thickness` | 5 | mm | 0.1 … 200 | Thickness on the optical axis (automatically increased if the edges would cross). |
| `diameter` | 25.4 | mm | 1 … 300 | Clear diameter of the lens. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

## Prisms & Blocks

### `prism.equilateral` — Equilateral Prism

Dispersing prism with three 60 degree angles. Because the refractive index rises towards the blue, white light is fanned out into a spectrum. At minimum deviation the ray passes symmetrically and n = sin((A + D)/2) / sin(A/2).

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 40 | mm | 2 … 300 | Length of each side. |
| `material` | "f2" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

### `prism.right_angle` — Right-Angle Prism

45-45-90 degree prism. Light entering through a short face is totally internally reflected at the hypotenuse (the 45 degree incidence exceeds the ~41.8 degree critical angle of crown glass) and turned by 90 degrees; entering through the hypotenuse it acts as a retro-reflector (Porro prism).

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 2 … 300 | Length of the two short faces. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

### `prism.dove` — Dove Prism

Truncated right-angle prism with 45 degree end faces. A beam parallel to the long face is refracted down, totally reflected at the base and refracted out again travelling in its original direction, but the image is inverted. Rotating the prism rotates the image at twice the rate.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `length` | 60 | mm | 4 … 400 | Length of the long (base) face. |
| `height` | 15 | mm | 1 … 150 | Height of the prism; the end faces are inclined at 45 degrees. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

### `prism.custom` — Custom Prism

Isosceles prism with adjustable apex angle. Thin wedges (a few degrees) deviate a beam by approximately (n - 1) x A; large apex angles give strong dispersion until total internal reflection sets in.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `apexAngle` | 30 | deg | 2 … 175 | Angle between the two refracting faces. |
| `size` | 40 | mm | 2 … 300 | Length of the two equal sides. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

### `block.slab` — Glass Slab

Rectangular block of transparent material. A ray is displaced sideways but leaves parallel to its original direction; each face reflects a few percent (Fresnel). Choose water to build a water tank, or add absorption for tinted glass (Beer-Lambert law).

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `width` | 60 | mm | 0.5 … 1000 | Extent along the local x axis. |
| `height` | 30 | mm | 0.5 … 1000 | Extent along the local y axis. |
| `material` | "bk7" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |
| `absorption` | 0 | 1/cm | 0 … 20 | Additional Beer-Lambert absorption coefficient: transmitted power = exp(-alpha x path length). |

### `block.semicircle` — Semicircular Block

Half-disc ("D") block, the classic tool for studying refraction: a ray aimed at the centre of the flat face crosses the curved face along a radius and is not bent there, so only the refraction at the flat face is observed. Sending light in through the curved side demonstrates the critical angle and total internal reflection.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `radius` | 30 | mm | 2 … 300 | Radius of the half disc. The centre of the flat face is the component origin. |
| `material` | "pmma" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

## Diffraction

### `grating.transmission` — Transmission Grating

Periodic structure that splits light into diffraction orders m = -2..+2 on the far side. Each order leaves at the angle given exactly by the grating equation sin(theta_m) = sin(theta_i) + m lambda / d, so long wavelengths are deflected more - the opposite ordering to a prism. Orders that would need \|sin\| > 1 are evanescent and their power is redistributed to the propagating orders.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `linesPerMm` | 600 | lines/mm | 10 … 3600 | Number of grooves per millimetre. The grating period is d = 1/density; orders obey d(sin theta_m - sin theta_i) = m lambda. |
| `eff0` | 0.3 |  | 0 … 1 | Relative power in the undiffracted (zero) order. |
| `eff1` | 0.25 |  | 0 … 1 | Relative power in each first order. |
| `eff2` | 0.1 |  | 0 … 1 | Relative power in each second order. |

### `grating.reflection` — Reflection Grating

Ruled or holographic reflective grating: the diffraction orders m = -2..+2 appear on the same side as the incident light. Order 0 is the ordinary specular reflection; the others follow the grating equation and form spectra, as used in spectrometers and monochromators.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `linesPerMm` | 600 | lines/mm | 10 … 3600 | Number of grooves per millimetre. The grating period is d = 1/density; orders obey d(sin theta_m - sin theta_i) = m lambda. |
| `eff0` | 0.3 |  | 0 … 1 | Relative power in the undiffracted (zero) order. |
| `eff1` | 0.25 |  | 0 … 1 | Relative power in each first order. |
| `eff2` | 0.1 |  | 0 … 1 | Relative power in each second order. |

## Polarization

### `polarizer.linear` — Linear Polarizer

Transmits the electric-field component along its transmission axis and absorbs the orthogonal one. For linearly polarized input the transmitted power follows Malus's law, I = I0 cos^2(theta); unpolarized light is reduced to 50 %. The finite extinction ratio lets a small fraction of the blocked component through.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `angle` | 0 | deg | -180 … 180 | Orientation of the transmission axis: 0 deg = p (in the bench plane), 90 deg = s (perpendicular to the bench). |
| `transmission` | 0.95 |  | 0 … 1 | Power transmission for light polarized along the axis. |
| `extinction` | 10000 | :1 | 1 … 10000000 | Ratio of transmission along the axis to transmission across it (10 000:1 is typical for film polarizers, 100 000:1 for Glan prisms). |

### `waveplate.half` — Half-Wave Plate

Birefringent plate that delays the slow-axis component by half a wavelength. Linear polarization is mirrored about the fast axis, i.e. rotated by twice the angle between the polarization and the axis (a plate at 22.5 deg rotates p-polarization to 45 deg; at 45 deg it converts p to s). Circular polarization changes handedness.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 25 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `fastAxis` | 22.5 | deg | -180 … 180 | Orientation of the fast axis: 0 deg = in the bench plane (p), 90 deg = perpendicular (s). |
| `designWavelength` | 632.8 | nm | 200 … 2000 | Wavelength at which the retardance has its nominal value. At other wavelengths the retardance scales as 1/lambda. |
| `order` | 0 |  | 0 … 30 | 0 = true zero-order plate. Multi-order plates add whole waves of retardance and are far more wavelength sensitive. |

### `waveplate.quarter` — Quarter-Wave Plate

Birefringent plate with a quarter-wave (90 degree) phase delay between fast and slow axis. Linear polarization at 45 degrees to the axis becomes circular (the displayed degree of linear polarization drops to zero) and vice versa. Two passes act as a half-wave plate - the basis of optical isolators using a mirror.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 25 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `fastAxis` | 45 | deg | -180 … 180 | Orientation of the fast axis: 0 deg = in the bench plane (p), 90 deg = perpendicular (s). |
| `designWavelength` | 632.8 | nm | 200 … 2000 | Wavelength at which the retardance has its nominal value. At other wavelengths the retardance scales as 1/lambda. |
| `order` | 0 |  | 0 … 30 | 0 = true zero-order plate. Multi-order plates add whole waves of retardance and are far more wavelength sensitive. |

## Apertures & Filters

### `aperture.slit` — Slit

Opaque screen with a narrow opening. Geometrically it simply clips the beam. With diffraction enabled every transmitted ray is spread into the Fraunhofer single-slit pattern I ~ sinc^2(pi a sin(theta) / lambda): the narrower the slit, the wider the pattern (first minimum at sin(theta) = lambda / a).

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `width` | 1 | mm | 0.001 … 100 | Width of the opening. |
| `size` | 40 | mm | 1 … 500 | Total height of the opaque screen. |
| `diffraction` | false |  | true / false | Spread transmitted rays into the single-slit Fraunhofer pattern (13 rays sampling the central lobe and the first two side lobes on each side). Only noticeable for slits narrower than ~0.1 mm. |

### `aperture.iris` — Iris Diaphragm

Adjustable circular aperture (in this 2D bench: an adjustable opening). Rays outside the opening are absorbed. Stopping down a lens with an iris removes the marginal rays and thereby reduces spherical aberration at the cost of brightness.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `diameter` | 8 | mm | 0 … 200 | Diameter of the clear opening. Can be driven from a circuit. |
| `size` | 40 | mm | 1 … 500 | Outer diameter of the iris housing. |

### `aperture.shutter` — Shutter / Modulator

Electrically controllable beam gate. In "attenuate" mode it transmits the fraction `open` of the incident power (like an acousto-optic or liquid-crystal modulator); in "blade" mode a mechanical blade covers the fraction (1 - open) of the aperture. Drive the `open` property from a circuit to chop or modulate a beam.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `open` | 1 |  | 0 … 1 | 0 = closed, 1 = fully open. Drivable from the circuit (actuator link, target prop "open"). |
| `mode` | "attenuate" |  | `attenuate`, `blade` | How the open fraction acts on the beam. |
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |

### `absorber.block` — Beam Dump

Perfectly black block that absorbs all light striking it. Use it to terminate unwanted beams and reflections safely.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `width` | 8 | mm | 0.5 … 500 | Extent along local x. |
| `height` | 40 | mm | 0.5 … 1000 | Extent along local y. |

### `filter.bandpass` — Bandpass Filter

Interference filter that transmits a narrow band around the centre wavelength. The pass band has the flat-topped Butterworth shape of a multi-cavity Fabry-Perot design, T = Tpeak / (1 + (2 (lambda - lambda0) / FWHM)^(2N)), where N is the number of cavities. Light outside the band is blocked.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `center` | 550 | nm | 200 … 2000 | Wavelength of maximum transmission. |
| `fwhm` | 20 | nm | 0.5 … 400 | Full width at half maximum of the pass band. |
| `peak` | 0.9 |  | 0 … 1 | Transmission in the pass band. |
| `cavities` | 2 |  | 1 … 6 | Number of coupled cavities; more cavities give steeper edges and a flatter top. |

### `filter.longpass` — Longpass Filter

Coloured-glass / edge filter that transmits wavelengths longer than the cut-off and absorbs shorter ones, with a smooth sigmoidal edge.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `cutoff` | 550 | nm | 200 … 2000 | 50 % transmission point. |
| `edgeWidth` | 12 | nm | 0.5 … 200 | Spectral width over which the transmission rises from 10 % to 90 % of its peak. |
| `peak` | 0.92 |  | 0 … 1 | Transmission in the pass band. |

### `filter.shortpass` — Shortpass Filter

Edge filter that transmits wavelengths shorter than the cut-off and blocks longer ones (e.g. a heat-absorbing filter that removes infrared).

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `cutoff` | 550 | nm | 200 … 2000 | 50 % transmission point. |
| `edgeWidth` | 12 | nm | 0.5 … 200 | Spectral width over which the transmission rises from 10 % to 90 % of its peak. |
| `peak` | 0.92 |  | 0 … 1 | Transmission in the pass band. |

### `filter.nd` — Neutral Density Filter

Attenuates all wavelengths equally. The optical density OD gives the transmission T = 10^(-OD): OD 1 passes 10 %, OD 2 passes 1 %, OD 3 passes 0.1 %. Densities of stacked filters add.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 30 | mm | 1 … 500 | Clear height of the element (extent perpendicular to the optical axis). |
| `opticalDensity` | 1 | OD | 0 … 8 | T = 10^(-OD). |

## Detectors

### `detector.power` — Power Meter

Thermal power-meter head: absorbs all light that reaches its sensitive face (facing local -x) and reports the total optical power in watts, independent of wavelength. Light striking the housing from behind is absorbed but not counted.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 20 | mm | 1 … 500 | Height of the sensitive area. |

### `detector.screen` — Screen

Observation screen. Records where every ray lands, a binned 1D intensity profile along the screen and the wavelength of each hit, so spectra, images, focal spots and diffraction patterns can be displayed in colour. Both sides are sensitive.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 60 | mm | 1 … 500 | Height of the screen. |
| `bins` | 64 |  | 4 … 1024 | Number of bins of the intensity profile across the screen. |

### `detector.spectrometer` — Spectrometer

Fibre-input style spectrometer: absorbs the light entering its aperture (facing local -x) and reports the spectral power distribution in equal-width wavelength bins between the adjustable range limits (default 380-780 nm), plus the total power.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 15 | mm | 1 … 500 | Height of the entrance aperture. |
| `bins` | 80 |  | 8 … 1024 | Number of wavelength bins (80 bins over 380-780 nm = 5 nm resolution). |
| `wavelengthMin` | 380 | nm | 200 … 2000 | Short-wavelength limit of the recorded spectrum (swapped with the end if larger). Light outside the range still counts towards the total power. |
| `wavelengthMax` | 780 | nm | 200 … 2000 | Long-wavelength limit of the recorded spectrum. |

### `detector.photodiode` — Photodiode

Photodiode active area (facing local -x). Absorbs the incident light and reports its optical power; link it to a circuit photodiode, LDR or solar cell to convert that power into photocurrent (the responsivity in A/W is a property of the circuit component).

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `size` | 5 | mm | 1 … 500 | Height of the active area. |

## Prisms & Blocks

### `medium.grin` — GRIN Medium

Slab whose refractive index varies across its height. Parabolic profile: n(y) = n0 - dn (y/h)^2 - rays oscillate sinusoidally about the axis and the slab acts as a lens with flat faces (GRIN rod lens, graded-index fibre). Linear profile: n(y) = n0 + dn (y/h) - rays bend continuously towards the denser side, as in a mirage or a sugar-solution tank. Ray paths are obtained by integrating the ray equation d/ds(n dr/ds) = grad n with a 4th-order Runge-Kutta scheme.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `length` | 80 | mm | 1 … 1000 | Extent along the local x axis (propagation direction). |
| `height` | 20 | mm | 1 … 500 | Extent along the local y axis (gradient direction); h = height/2. |
| `profile` | "parabolic" |  | `parabolic`, `linear` | Shape of the transverse index variation. |
| `n0` | 1.6 |  | 1 … 3 | Refractive index on the axis (at 587.6 nm). |
| `deltaN` | 0.05 |  | -0.5 … 0.5 | Index difference between axis and edge. Parabolic pitch length = 2 pi h / sqrt(2 dn / n0). |
| `abbe` | 50 |  | 5 … 120 | Dispersion of the base material. |
| `coating` | "none" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

## Magneto-Optics

### `magneto.faraday` — Faraday Rotator

Magneto-optic rod in a longitudinal magnetic field. The plane of polarization is rotated by theta = V(lambda) B L, where V is the Verdet constant of the material (TGG: -134 rad/(T m) at 632.8 nm, falling roughly as 1/lambda^2). The effect is non-reciprocal: the rotation sense is fixed by the field, not by the propagation direction, so a reflected beam is rotated further instead of being restored. The rotation is accumulated along the actual ray path as V B.dl. Drive `bField` from a coil current to build a magneto-optic modulator.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `bField` | 0.293 | T | -5 … 5 | Flux density along the rod axis (local +x). Negative values reverse the rotation. Drivable from the circuit (actuator link, target prop "bField"). |
| `length` | 20 | mm | 1 … 300 | Length of the magneto-optic rod. |
| `diameter` | 10 | mm | 1 … 100 | Clear aperture of the rod. |
| `material` | "tgg" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "ideal" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

### `magneto.isolator` — Optical Isolator

Optical diode: input polarizer, 45 degree TGG Faraday rotator in a permanent magnet, output polarizer at 45 degrees. Forward light passes with low loss. Backward light is polarized at 45 degrees by the output polarizer, rotated a further 45 degrees in the same sense by the non-reciprocal Faraday effect and arrives crossed at the input polarizer, where it is absorbed. The magnet is sized for exactly 45 degrees at the design wavelength, so isolation degrades at other wavelengths, as in real devices.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `designWavelength` | 632.8 | nm | 200 … 2000 | Wavelength at which the Faraday rotation is exactly 45 degrees. |
| `inputAxis` | 0 | deg | -180 … 180 | Transmission axis of the input polarizer (0 = p, in the bench plane). The output polarizer sits at +45 degrees to it. |
| `fieldScale` | 1 |  | -2 … 2 | Multiplier on the magnet strength (1 = nominal 45 degree rotation, -1 reverses the isolator). Drivable. |
| `length` | 16 | mm | 2 … 200 | Length of the TGG rod. |
| `aperture` | 8 | mm | 1 … 100 | Diameter of the clear aperture. |
| `extinction` | 100000 | :1 | 10 … 10000000 | Extinction ratio of the two polarizers; limits the achievable isolation. |

## Exotic

### `field.gravity` — Gravitational Lens

A compact mass bends light: far from the mass the deflection is alpha = 4GM / (c^2 b) = 2 r_s / b for impact parameter b (twice the Newtonian value - Einstein 1915). Rays are integrated through the exact optical metric of a Schwarzschild black hole in isotropic coordinates, n(r) = (1 + r_s/4r)^3 / (1 - r_s/4r), so strong-field effects (photon sphere, capture by the horizon) also appear. ILLUSTRATIVE SCALING: `strength` is the Einstein radius in mm - the impact parameter at which parallel rays are focused onto the axis at the chosen focal distance - giving r_s = R_E^2 / (2 D); a real mass with a millimetre-scale Schwarzschild radius would weigh about as much as the Earth. Unlike a glass lens, a gravitational lens bends rays MORE the closer they pass, so it has no single focus and forms Einstein rings; it is also perfectly achromatic. The field is truncated at the field radius.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `strength` | 10 | mm | 0 … 200 | Impact parameter of the rays that cross the axis at the focal distance. Drivable. |
| `focalDistance` | 200 | mm | 10 … 5000 | Distance behind the mass at which rays passing at the Einstein radius cross the axis. |
| `radius` | 90 | mm | 5 … 2000 | Radius of the region in which the curved-space ray integration is performed. Outside it rays travel straight. |

## Fiber

### `fiber.cable` — Optical Fiber

Step-index multimode fibre patch cable. Light striking the core of one end face within the acceptance cone (sin(theta) <= NA / n_ambient, NA = sqrt(n_core^2 - n_clad^2)) is guided by total internal reflection and re-emitted from the other end; rays outside the cone leak into the cladding and are lost. Transmission includes the Fresnel loss at both faces and attenuation (dB/km) - for silica the Rayleigh-scattering 1/lambda^4 law, the infrared absorption edge and the OH peak at 1383 nm. The exit angle keeps its magnitude but position and sign are mode-scrambled, and standard fibre depolarizes the light over a few metres (polarization-maintaining fibre does not). Works in both directions. Drag the `end` handle to move the second end.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `endX` | 150 | mm | -100000 … 100000 | World x coordinate of the second fibre end. |
| `endY` | 0 | mm | -100000 … 100000 | World y coordinate of the second fibre end. |
| `endRotation` | 0 | deg | -180 … 180 | World direction in which end B emits light (0 = +x, 90 = +y / down). |
| `length` | 2 | m | 0.01 … 100000 | Physical length of the fibre (independent of the drawn path); determines attenuation and depolarization. |
| `coreDiameter` | 1 | mm | 0.005 … 20 | Diameter of the light-guiding core. Real fibres: 0.009 mm single-mode, 0.05-0.2 mm multimode silica, 1 mm polymer. |
| `na` | 0.39 |  | 0.05 … 0.9 | NA = sin of the maximum acceptance half-angle in air. 0.22 and 0.39 are common for silica multimode fibre, 0.5 for polymer fibre. |
| `coreIndex` | 1.4585 |  | 1.2 … 2.5 | Refractive index of the core (fused silica 1.4585, PMMA 1.492); sets the Fresnel loss at the end faces. |
| `attenuationModel` | "silica" |  | `silica`, `constant` | Silica: Rayleigh 0.8/lambda^4 dB/km + IR edge + OH peak (0.17 dB/km at 1550 nm, ~5 dB/km at 633 nm, ~30 dB/km at 400 nm). |
| `attenuation` | 150 | dB/km | 0 … 100000 | Used with the constant model (PMMA polymer fibre: ~150 dB/km at 650 nm). |
| `pm` | false |  | true / false | If off, the polarization is scrambled with a 1/e depolarization length of 2 m. If on, the polarization state is preserved. |

## Nonlinear

### `nonlinear.shg` — SHG Crystal

Frequency-doubling crystal (second-harmonic generation): two photons of the fundamental combine into one photon of half the wavelength, e.g. infrared 1064 nm -> green 532 nm. The conversion efficiency grows with the beam power, eta = tanh^2(sqrt(kappa P)) (pump depletion included), and is limited to the phase-matching bandwidth by a sinc^2 acceptance curve. The second harmonic is generated collinearly, polarized perpendicular to the fundamental (type-I phase matching); the unconverted fundamental continues as well. kappa is idealised - real crystals need focused or pulsed beams to reach percent-level efficiencies.

| prop | default | unit | range / options | help |
|---|---|---|---|---|
| `length` | 10 | mm | 0.5 … 100 | Extent along local x. |
| `height` | 8 | mm | 0.5 … 100 | Extent along local y. |
| `phaseMatchWavelength` | 1064 | nm | 200 … 2000 | Fundamental wavelength for which the crystal is cut (phase matched). |
| `acceptanceBandwidth` | 30 | nm | 0.1 … 500 | FWHM of the sinc^2 phase-matching curve. |
| `efficiency` | 50 | 1/W | 0 … 100000 | Low-power conversion efficiency per watt of fundamental (eta ~ kappa P for small P). |
| `material` | "bbo" |  | `water`, `ethanol`, `bk7`, `bak4`, `f2`, `sf10`, `sf11`, `sf6`, `fused_silica`, `caf2`, `mgf2`, `sapphire`, `diamond`, `pmma`, `polycarbonate`, `polystyrene`, `tgg`, `bbo`, `custom` | Optical material. The refractive index follows the published Sellmeier dispersion formula, so blue light is refracted more strongly than red. |
| `customIndex` | 1.5 |  | 1 … 4 | Refractive index at 587.6 nm, used only when Material = Custom. |
| `customAbbe` | 60 |  | 5 … 120 | Abbe number V_d = (n_d - 1)/(n_F - n_C); lower means more dispersion. Used only when Material = Custom. |
| `coating` | "ideal" |  | `none`, `mgf2`, `ideal` | Uncoated surfaces reflect ~4 % per face (Fresnel). The MgF2 option is an exact single-layer thin-film calculation (about 1.3 % on crown glass, wavelength and angle dependent). Ideal AR suppresses all partial reflections (total internal reflection still occurs). |

