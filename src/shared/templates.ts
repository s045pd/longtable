// Boards a new board can start from. "pell-and-rye" is the example: a
// fictional bakery's opening week, planned by five fictional people, with the
// notes grouped by topic so the tidy has something to sort.
import { isoDate, mondayOf, nextMonday } from "./days";
import type { Item, Meta, NoteItem } from "./types";

export const TEMPLATES = ["pell-and-rye", "blank"] as const;
export type TemplateName = (typeof TEMPLATES)[number];

export const DEMO_PEOPLE = {
  ana: { name: "Ana", color: "#FFB38A" },
  bo: { name: "Bo", color: "#C9B6FF" },
  cy: { name: "Cy", color: "#9DF0C4" },
  dee: { name: "Dee", color: "#FFE38A" },
  eli: { name: "Eli", color: "#8FD0FF" },
};
type Who = keyof typeof DEMO_PEOPLE;

export interface Seed {
  meta: Meta;
  items: Item[];
}

export function makeTemplate(name: TemplateName, today = new Date()): Seed {
  if (name === "blank") {
    // "This week" plans this week: today's notes and the rest of the week's.
    return { meta: { client: "My team", file: "This week", weekOf: mondayOf(isoDate(today)), template: "" }, items: [] };
  }
  let z = 0;
  const items: Item[] = [];
  const note = (id: string, who: Who, text: string, x: number, y: number, rot: number, extra: Partial<NoteItem> = {}) =>
    items.push({ id, type: "note", x, y, rot, z: ++z, by: DEMO_PEOPLE[who].name, color: DEMO_PEOPLE[who].color, text, ...extra });
  const label = (id: string, who: Who, text: string, x: number, y: number) =>
    items.push({ id, type: "label", x, y, rot: 0, z: ++z, by: DEMO_PEOPLE[who].name, color: DEMO_PEOPLE[who].color, text });

  // Bake: the kitchen's week, on the left.
  label("s-bake", "bo", "Bake", -1300, -600);
  note("n-oven", "bo", "Oven check\nMon 6 am", -1430, -390, -2);
  note("n-flour", "bo", "Flour 50 kg\nlands Tue", -1190, -350, 1);
  note("n-test", "cy", "Test bake\nWed", -950, -410, 4);
  note("n-sour", "bo", "Sourdough\n× 120 Thu", -1320, -130, -1);
  note("n-crois", "cy", "Croissants\n× 200 Fri", -1070, -100, -5);
  note("n-double", "dee", "Double bake\nSat", -820, -160, 3);
  items.push({
    id: "c-bake",
    type: "check",
    x: -1440,
    y: 190,
    rot: 0,
    z: ++z,
    by: "Bo",
    color: DEMO_PEOPLE.bo.color,
    title: "Bake list",
    rows: [
      { text: "Starter fed", done: true },
      { text: "Trays × 12", done: true },
      { text: "Ovens 5 am", done: false },
    ],
  });
  items.push({ id: "p-loaf", type: "photo", x: -1160, y: 210, rot: -3, z: ++z, by: "Cy", art: "loaf", caption: "test loaf" });
  items.push({ id: "p-crois", type: "photo", x: -900, y: 160, rot: 5, z: ++z, by: "Bo", art: "croissant", caption: "Sat special" });

  // People: hiring, training and thanking, top right.
  label("s-people", "ana", "People", 660, -680);
  note("n-rota", "ana", "Rota draft\nby Tue", 520, -450, -3);
  note("n-train", "dee", "Train the\ntill Wed", 770, -490, 2);
  note("n-aprons", "ana", "Aprons\narrive Thu", 1020, -420, 6);
  note("n-panel", "eli", "Taste panel\nThu 4 pm", 1270, -470, -2);
  note("n-staff", "ana", "Staff\ntasting Fri", 570, -200, -5);
  note("n-hire", "bo", "Hire\nSaturday\nbarista", 830, -170, 2);
  note("n-thanks", "dee", "Thank-you\nparty Sun", 1090, -190, -4);
  note("n-count", "cy", "Count the\ntill Sun", 1340, -210, 3);

  // Tell the street: everything the neighbours will see, bottom middle.
  label("s-street", "eli", "Tell the street", -170, 300);
  note("n-starts", "ana", "Opening\nweek\nstarts Mon", -560, 520, -2);
  note("n-bun", "eli", "Free bun\nwith coffee\nMon", -310, 560, 3);
  note("n-print", "ana", "Flyers to\nprint Tue", -60, 500, -4);
  note("n-chalk", "cy", "Chalkboard\nmenu Tue", 190, 560, -6);
  note("n-flyers", "eli", "Flyers out\nWed 8 am", 440, 520, 2);
  note("n-window", "ana", "Window\nlettering\nFri", -440, 790, -5);
  note("n-balloons", "eli", "Balloons\nup Fri", -180, 820, -4);
  note("n-band", "dee", "Brass band\nSat 10 am", 80, 790, 2, {
    votes: { eli: DEMO_PEOPLE.eli.color, ana: DEMO_PEOPLE.ana.color, cy: DEMO_PEOPLE.cy.color },
  });
  note("n-kids", "eli", "Kids' bun\nclass Sun", 340, 800, 6);
  items.push({ id: "p-shop", type: "photo", x: 680, y: 770, rot: 4, z: ++z, by: "Dee", art: "shop", caption: "our street" });

  // Cy's pen arrow: print the flyers, then hand them out.
  const arrow: number[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = -150 + 300 * t;
    const y = 30 - Math.sin(Math.PI * t) * 70 + t * 4;
    arrow.push(Math.round(x), Math.round(y));
  }
  arrow.push(150 - 30, 34 - 20, 150, 34, 150 - 34, 34 + 14);
  items.push({ id: "k-arrow", type: "stroke", x: 190, y: 360, rot: 0, z: ++z, by: "Cy", color: DEMO_PEOPLE.cy.color, width: 6, pts: arrow });

  return {
    meta: { client: "Pell & Rye", file: "Opening week", weekOf: nextMonday(today), template: "pell-and-rye" },
    items,
  };
}
