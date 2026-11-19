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
  /**
   * A date picked by hand or read from a chat, YYYY-MM-DD: it wins over `day`
   * and puts the note in that date's own week, which may not be the board's.
   * "" or absent = none.
   */
  date?: string;
  /** Whose it is: a name, shown as a tag on the note. "" or absent = nobody in particular. */
  who?: string;
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
  /**
   * The Monday of the week it shows, YYYY-MM-DD. Absent or "" = the board's
   * own week (meta.weekOf); a tidy adds a week like this for each other week
   * that dated notes fall in.
   */
  of?: string;
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
  /** Every week the tidy laid out, in order, when there are more than one. */
  weeks?: string[];
  /** How many notes went into the week. */
  count: number;
}

export interface Person {
  /** One id per open tab. */
  pid: string;
  name: string;
  color: string;
  /** True for someone who opened the watch-only link. */
  view?: boolean;
}

/**
 * Who may do what on a board. The owner made it (or holds its owner link) and
 * manages it; editors came with the edit link; viewers with the watch link.
 */
export type Role = "owner" | "editor" | "viewer";

/** What a board tells each person about their access, and the links they may hand on. */
export interface Access {
  role: Role;
  /** True when a link alone is not enough: the board's password is needed too. */
  password: boolean;
  /** The key of the link that can change the board (owners and editors only). */
  edit?: string;
  /** The key of the watch-only link. */
  view: string;
  /** The key of the board's calendar feed (read-only, for calendar apps to subscribe to). */
  cal?: string;
  /**
   * The owner key, sent once: when a board made before boards had keys is
   * first opened, whoever opens it becomes its owner.
   */
  owner?: string;
  /** A board kept in this browser (no server): links, passwords and owners do not apply. */
  local?: boolean;
}

/** Why a board would not open: no board at that address, a link that is no longer the board's, or the board was deleted. */
export type DeniedReason = "missing" | "link" | "deleted";

/** The owner's controls. */
export type AdminAct = "password" | "links" | "delete";

/** One note read out of a pasted chat. */
export interface PlanNote {
  /** What to do, short, in the chat's own language. */
  text: string;
  /** The date it happens or is due, YYYY-MM-DD, or null when the chat names none. */
  date: string | null;
  /** Minutes after midnight, or null when no time is given. */
  time: number | null;
  /** Who it falls to, when the chat says so. */
  who: string | null;
}

/** Why the room could not read a chat: AI is not set up here, today's free AI is used up, too many asks, it failed, or found nothing. */
export type PlanTrouble = "off" | "spent" | "busy" | "failed" | "empty" | "view";

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
  /** key: the key from the link; owner: the owner key; pass: what the board gave back for its password. */
  | { t: "hello"; name: string; color: string; cid: string; key?: string; owner?: string; pass?: string }
  | { t: "unlock"; pw: string }
  | { t: "admin"; act: "password"; pw: string | null }
  | { t: "admin"; act: "links" | "delete" }
  | { t: "ops"; tx: number; ops: Op[]; fx?: Effect }
  | { t: "pres"; p: Presence }
  | { t: "react"; kind: ReactionKind; x: number; y: number }
  /** Read a pasted chat into notes. today: the sender's own date (YYYY-MM-DD), for "tomorrow" and "明天". */
  | { t: "plan"; text: string; today?: string }
  | { t: "ping" };

export type ServerMessage =
  | { t: "init"; you: string; meta: Meta; items: Item[]; people: (Person & { p?: Presence })[]; access: Access }
  | { t: "access"; access: Access }
  /** The link is right but the board has a password. wait: seconds before another try is checked. */
  | { t: "locked"; wrong?: boolean; wait?: number }
  /** The password was right: keep this and send it as `pass` next time instead of the password. */
  | { t: "pass"; token: string }
  | { t: "denied"; why: DeniedReason; at?: string }
  | { t: "done"; act: AdminAct; ok: boolean; message?: string }
  | { t: "ops"; from: string; ops: Op[]; fx?: Effect }
  | { t: "ack"; tx: number; rejected?: number }
  | { t: "join"; person: Person }
  | { t: "leave"; pid: string }
  | { t: "pres"; pid: string; p: Presence }
  | { t: "react"; pid: string; kind: ReactionKind; x: number; y: number }
  | { t: "pong" }
  | { t: "plan"; ok: true; notes: PlanNote[] }
  | { t: "plan"; ok: false; why: PlanTrouble; wait?: number }
  | { t: "error"; message: string };
