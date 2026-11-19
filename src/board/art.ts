// Flat illustrations for polaroids, drawn as SVG in a 160 × 132 frame. No
// photographs: every picture on a board is made here.
import type { PhotoArt } from "../shared/types";

const ART: Record<PhotoArt, string> = {
  loaf: `
    <rect width="160" height="132" fill="#FFDDB5"/>
    <rect y="98" width="160" height="34" fill="#F6BE8E"/>
    <ellipse cx="80" cy="101" rx="64" ry="7" fill="#5A2E12" opacity=".22"/>
    <path d="M22 100C18 34 142 34 138 100Z" fill="#B26A2E"/>
    <path d="M34 92C32 46 128 46 126 92Z" fill="#CC8642"/>
    <g stroke="#FBE6C2" stroke-width="6" stroke-linecap="round"><path d="M51 78l14-18M73 78l14-18M95 78l14-18"/></g>`,
  croissant: `
    <rect width="160" height="132" fill="#CFF3DD"/>
    <ellipse cx="80" cy="80" rx="66" ry="38" fill="#F4EFE6"/>
    <g transform="translate(80 74)">
      <ellipse cx="-50" cy="12" rx="11" ry="15" transform="rotate(-62 -50 12)" fill="#C98538"/>
      <ellipse cx="50" cy="12" rx="11" ry="15" transform="rotate(62 50 12)" fill="#C98538"/>
      <ellipse cx="-28" cy="0" rx="15" ry="21" transform="rotate(-30 -28 0)" fill="#E2A654"/>
      <ellipse cx="28" cy="0" rx="15" ry="21" transform="rotate(30 28 0)" fill="#E2A654"/>
      <ellipse cx="0" cy="-6" rx="18" ry="25" fill="#C98538"/>
      <path d="M-6 -24q6 18 0 36" stroke="#F3C27A" stroke-width="3" fill="none" stroke-linecap="round"/>
    </g>`,
  shop: `
    <rect width="160" height="132" fill="#BFE4FF"/>
    <rect y="108" width="160" height="24" fill="#8FB9D9"/>
    <rect x="28" y="26" width="104" height="86" fill="#F4EFE6"/>
    <rect x="40" y="62" width="46" height="34" fill="#2C3440"/>
    <rect x="98" y="62" width="24" height="50" fill="#2C3440"/>
    <rect x="44" y="66" width="38" height="26" fill="#FFE38A"/>
    <path d="M67 26a13 13 0 0 1 26 0z" fill="#FF9A6B"/>
    ${Array.from({ length: 8 }, (_, i) => `<path d="M${22 + i * 14.5} 40h14.5v14a7.25 7.25 0 0 1-14.5 0z" fill="${i % 2 ? "#F4EFE6" : "#FF9A6B"}"/>`).join("")}`,
  cup: `
    <rect width="160" height="132" fill="#E7DBFF"/>
    <rect y="100" width="160" height="32" fill="#CDB9F5"/>
    <ellipse cx="80" cy="104" rx="46" ry="8" fill="#F4EFE6"/>
    <path d="M50 54h60l-6 46H56z" fill="#F4EFE6"/>
    <path d="M110 62c18 0 18 24 0 24" stroke="#F4EFE6" stroke-width="7" fill="none"/>
    <ellipse cx="80" cy="54" rx="30" ry="6" fill="#8A5A3A"/>
    <path d="M70 44c-6-8 6-12 0-22M88 44c-6-8 6-12 0-22" stroke="#FFFFFF" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".8"/>`,
  tray: `
    <rect width="160" height="132" fill="#FFF0B8"/>
    <rect x="18" y="34" width="124" height="70" rx="6" fill="#8D96A3"/>
    <rect x="24" y="40" width="112" height="58" rx="3" fill="#B7BFCA"/>
    ${[0, 1, 2]
      .flatMap((r) => [0, 1, 2, 3].map((c) => `<circle cx="${40 + c * 27}" cy="${52 + r * 17}" r="8" fill="${(r + c) % 2 ? "#E0A55A" : "#C98538"}"/>`))
      .join("")}`,
  flag: `
    <rect width="160" height="132" fill="#C8F1E2"/>
    <path d="M10 30q70 26 140 0" stroke="#5B6470" stroke-width="2" fill="none"/>
    ${[0, 1, 2, 3, 4, 5, 6]
      .map((i) => {
        const x = 18 + i * 19;
        const y = 30 + Math.sin((i / 6) * Math.PI) * 13;
        const c = ["#FFB38A", "#C9B6FF", "#9DF0C4", "#FFE38A", "#8FD0FF", "#FF9FC0", "#FFB38A"][i];
        return `<path d="M${x - 8} ${y}h16l-8 18z" fill="${c}"/>`;
      })
      .join("")}
    <rect x="44" y="72" width="72" height="40" rx="6" fill="#F4EFE6"/>
    <path d="M58 92h44" stroke="#2C3440" stroke-width="6" stroke-linecap="round"/>`,
};

export const artSvg = (art: PhotoArt) =>
  `<svg viewBox="0 0 160 132" width="160" height="132" aria-hidden="true">${ART[art] ?? ART.loaf}</svg>`;
