import { scoreColor } from "../metrics.js";

const BG: Record<ReturnType<typeof scoreColor>, string> = {
  green: "#2ea043",
  lime: "#7cc243",
  amber: "#d29922",
  orange: "#e3742b",
  red: "#d1242f",
};

/** A flat, shields-style badge. Pure SVG, no external requests. */
export function renderBadge(score: number, grade: string, label = "repolens"): string {
  const value = `${score}/100`;
  const labelWidth = Math.round(6.6 * label.length + 12);
  const valueWidth = Math.round(6.6 * value.length + 16);
  const width = Math.round(labelWidth + valueWidth);
  const height = 20;
  const radius = 3;
  const color = BG[scoreColor(score)];
  const valueX = labelWidth + valueWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" role="img" aria-label="${label}: ${score}/100 ${grade}">
  <title>${label}: ${score}/100 (${grade})</title>
  <defs>
    <linearGradient id="s" x2="0" y2="100%">
      <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
      <stop offset="1" stop-opacity=".1"/>
    </linearGradient>
    <clipPath id="r"><rect width="${width}" height="${height}" rx="${radius}" fill="#fff"/></clipPath>
  </defs>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="${height}" fill="#24292f"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="${height}" fill="${color}"/>
    <rect width="${width}" height="${height}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelWidth / 2}" y="13">${escapeXml(label)}</text>
    <text x="${valueX}" y="14" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text>
    <text x="${valueX}" y="13">${escapeXml(value)}</text>
  </g>
</svg>
`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
