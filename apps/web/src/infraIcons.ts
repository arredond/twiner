import bridge from "@mapbox/maki/icons/bridge.svg?raw";
import college from "@mapbox/maki/icons/college.svg?raw";
import dam from "@mapbox/maki/icons/dam.svg?raw";
import doctor from "@mapbox/maki/icons/doctor.svg?raw";
import emergencyPhone from "@mapbox/maki/icons/emergency-phone.svg?raw";
import fireStation from "@mapbox/maki/icons/fire-station.svg?raw";
import home from "@mapbox/maki/icons/home.svg?raw";
import hospital from "@mapbox/maki/icons/hospital.svg?raw";
import industry from "@mapbox/maki/icons/industry.svg?raw";
import police from "@mapbox/maki/icons/police.svg?raw";
import library from "@mapbox/maki/icons/library.svg?raw";
import watermill from "@mapbox/maki/icons/watermill.svg?raw";
import windmill from "@mapbox/maki/icons/windmill.svg?raw";
import type { InfraCategory } from "./infrastructure";

// Critical infrastructure icons (ADR-0025): Mapbox's Maki set (CC0,
// @mapbox/maki), one monochrome 15x15 glyph per asset subtype, drawn on
// the map inside each asset's circle and in the legend/sidebar. Maki has
// no electricity or sun glyph, so power and solar get two of our own,
// drawn on the same 15x15 grid in the same flat style.

const BOLT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15">' +
  '<path d="M9 1 3 8.5h3.8L5.8 14 12 6.2H8.2L9 1z"/></svg>';
const SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 15 15">' +
  '<circle cx="7.5" cy="7.5" r="3"/>' +
  '<path d="M7 .5h1v2.5H7zM7 12h1v2.5H7zM.5 7H3v1H.5zM12 7h2.5v1H12z"/>' +
  '<path transform="rotate(45 7.5 7.5)" d="M7 .5h1v2.5H7zM7 12h1v2.5H7zM.5 7H3v1H.5zM12 7h2.5v1H12z"/></svg>';

export const INFRA_ICON_SVGS = {
  bridge,
  college,
  dam,
  doctor,
  "emergency-phone": emergencyPhone,
  "fire-station": fireStation,
  home,
  hospital,
  industry,
  library,
  police,
  watermill,
  windmill,
  bolt: BOLT,
  sun: SUN,
} as const;

export type InfraIconName = keyof typeof INFRA_ICON_SVGS;

// Per subtype (the tiles' `subtype`, i18n's infra.subtype.*)...
export const SUBTYPE_ICONS: Record<string, InfraIconName> = {
  hospital: "hospital",
  health_centre: "doctor",
  care_home: "home",
  police: "police",
  fire_civil_protection: "fire-station",
  // Maki's own "school" glyph reads poorly at marker size; a book does not.
  school: "library",
  university: "college",
  substation: "bolt",
  thermal: "industry",
  combined_cycle: "industry",
  nuclear: "industry",
  hydro: "watermill",
  wind: "windmill",
  solar_pv: "sun",
  solar_thermal: "sun",
  bridge: "bridge",
  dam: "dam",
};

// ...and per category, for a subtype not listed above and for the
// legend/sidebar, which show one icon per category.
export const CATEGORY_ICONS: Record<InfraCategory, InfraIconName> = {
  health: "hospital",
  care: "home",
  emergency: "emergency-phone",
  education: "library",
  power: "bolt",
  bridge: "bridge",
  dam: "dam",
};

// The drawing inside an icon's <svg> element, for inline React rendering
// (InfraIcon.tsx) with the surrounding text colour.
export function iconInnerSvg(name: InfraIconName): string {
  return /<svg[^>]*>([\s\S]*)<\/svg>/.exec(INFRA_ICON_SVGS[name])?.[1] ?? "";
}

// The two colourings drawn on the map: black icons on light-theme markers,
// white on dark-theme ones (infrastructureLayers.ts' MARKER_STYLES).
export const ICON_VARIANTS = { dark: "#1c1c1c", light: "#ffffff" } as const;
export type IconVariant = keyof typeof ICON_VARIANTS;

export function mapImageId(name: InfraIconName, variant: IconVariant): string {
  return `infra-${name}-${variant}`;
}

// Every icon in both colourings, rasterized once at `pixelRatio` for
// map.addImage (MapLibre takes pixels, not SVG). Resolves to a lookup by
// map image id.
export function rasterizeInfraIcons(pixelRatio: number): Promise<Map<string, ImageData>> {
  const size = 15 * pixelRatio;
  const jobs = (Object.keys(INFRA_ICON_SVGS) as InfraIconName[]).flatMap((name) =>
    (Object.keys(ICON_VARIANTS) as IconVariant[]).map(async (variant) => {
      const svg = INFRA_ICON_SVGS[name].replace("<svg ", `<svg fill="${ICON_VARIANTS[variant]}" `);
      const image = new Image(size, size);
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, size, size);
      return [mapImageId(name, variant), context.getImageData(0, 0, size, size)] as const;
    })
  );
  return Promise.all(jobs).then((entries) => new Map(entries));
}
