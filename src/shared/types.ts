// The board's data model and the messages that travel between a browser and
// the board's room on the server. Both sides import this file.

/** Every object on the board has a centre (x, y) in world units, a tilt in degrees and a stacking order. */
export interface BaseItem {
  id: string;
  x: number;
  y: number;
  rot: number;
  z: number;
  /** The name of whoever made it (shown on hover, used in exports). */
  by?: string;
}

/** A sticky note. Its colour is its author's at the time it was made. */
export interface NoteItem extends BaseItem {
  type: "note";
  text: string;
  color: string;
  /** Voting dots: voter id → that voter's colour. */
  votes?: Record<string, string>;
  /** A day picked by hand: 0 = Monday … 6 = Sunday, 7 = any day; -1 or absent = read from the words. */
  day?: number;
  /** A time picked by hand, in minutes after midnight; -2 = no time; -1 or absent = read from the words. */
  time?: number;
}

/** Big chalk words typed straight onto the canvas: a section heading. */
export interface LabelItem extends BaseItem {
  type: "label";
  text: string;
  color: string;
}

export interface CheckRow {
  text: string;
  done: boolean;
}

/** A small paper card with a title and rows that can be ticked. */
export interface CheckItem extends BaseItem {
  type: "check";
  title: string;
  rows: CheckRow[];
  color: string;
}

export type PhotoArt = "loaf" | "croissant" | "shop" | "cup" | "tray" | "flag";

/** A polaroid with a flat illustration drawn in code and a handwritten caption. */
export interface PhotoItem extends BaseItem {
  type: "photo";
  art: PhotoArt;
  caption: string;
}

/** A pen stroke. pts are x,y pairs relative to the item's centre. */
export interface StrokeItem extends BaseItem {
  type: "stroke";
  color: string;
  width: number;
  pts: number[];
}

/**
 * The week the tidy lays out: column headers MON … SUN (and ANY DAY when some
 * notes name no day). (x, y) is the centre of the first column's first cell.
 */
export interface WeekItem extends BaseItem {
  type: "week";
  cols: number;
}

export type Item = NoteItem | LabelItem | CheckItem | PhotoItem | StrokeItem | WeekItem;
export type ItemType = Item["type"];

export interface Meta {
  /** Who the board is for, shown first in the top bar. */
  client: string;
  /** The board's own name. */
  file: string;
  /** The Monday of the week being planned, YYYY-MM-DD (used when exporting). */
  weekOf: string;
  /** The template the board was started from ("" for a blank board). */
  template: string;
}

/** A change to the board. The server applies them in the order it receives them. */
export type Op =
  | { op: "put"; item: Item }
  | { op: "patch"; id: string; set: Partial<Item> }
  | { op: "del"; id: string }
  | { op: "vote"; id: string; who: string; color: string; on: boolean }
  | { op: "meta"; set: Partial<Meta> };

/** Something everyone should see happen, not just its result (the tidy's wave). */
export interface Effect {
  kind: "tidy";
  /** Seconds each moved item waits before it flies. */
  delays: Record<string, number>;
  /** The week the tidy laid out, so every viewer can type its headers in. */
  week: string;
  /** How many notes went into the week. */
  count: number;
}

export interface Person {
  /** One id per open tab. */
  pid: string;
  name: string;
  color: string;
}

/** Where someone is and what they are doing. All coordinates are world units. */
export interface Presence {
  /** The pointer, or null when it has left the board. */
  c?: [number, number] | null;
  /** What they have selected. */
  sel?: string[];
  /** The item whose words they are typing, if any. */
  edit?: string | null;
  /** Their view: the world point at its centre and the zoom. */
  view?: [number, number, number];
  /** True while drawing with the pen. */
  pen?: boolean;
}

export type ReactionKind = "heart" | "star" | "bang" | "clap";

export type ClientMessage =
  | { t: "hello"; name: string; color: string; cid: string }
  | { t: "ops"; tx: number; ops: Op[]; fx?: Effect }
  | { t: "pres"; p: Presence }
  | { t: "react"; kind: ReactionKind; x: number; y: number }
  | { t: "ping" };

export type ServerMessage =
  | { t: "init"; you: string; meta: Meta; items: Item[]; people: (Person & { p?: Presence })[] }
  | { t: "ops"; from: string; ops: Op[]; fx?: Effect }
  | { t: "ack"; tx: number; rejected?: number }
  | { t: "join"; person: Person }
  | { t: "leave"; pid: string }
  | { t: "pres"; pid: string; p: Presence }
  | { t: "react"; pid: string; kind: ReactionKind; x: number; y: number }
  | { t: "pong" }
  | { t: "error"; message: string };
