import { describe, expect, it } from "vitest";
import { linesToNotes, looksLikeAChat, planMessages, readPlan, relativeDate } from "../src/shared/plan";
import { toIcs } from "../src/shared/exporter";
import type { Item, Meta } from "../src/shared/types";

describe("reading the AI's answer", () => {
  it("takes the notes out of whatever the model wraps them in", () => {
    const json = '{"notes":[{"text":"Flyers out","date":"2026-11-25","time":"08:00","who":"Bo"},{"text":"试吃","date":"2026-11-19","time":"16:00","who":null}]}';
    const want = [
      { text: "Flyers out", date: "2026-11-25", time: 480, who: "Bo" },
      { text: "试吃", date: "2026-11-19", time: 960, who: null },
    ];
    expect(readPlan(json, "2026-11-19")).toEqual(want);
    expect(readPlan({ response: json }, "2026-11-19")).toEqual(want);
    expect(readPlan({ response: JSON.parse(json) }, "2026-11-19")).toEqual(want);
    expect(readPlan({ choices: [{ message: { content: "<think>hmm</think>\n```json\n" + json + "\n```" } }] }, "2026-11-19")).toEqual(want);
    expect(readPlan("Sure! Here you go: " + json + " Hope that helps.", "2026-11-19")).toEqual(want);
  });

  it("accepts the shapes a model drifts into, and drops what it can't use", () => {
    const notes = readPlan(
      JSON.stringify({
        notes: [
          { text: "  order   the cake stand ", day: "Friday", time: "4pm", who: "@Ana" },
          { text: "Count the till", date: "2026-11-22", time: null, who: "everyone" },
          { text: "", date: "2026-11-23" },
          { text: "Count the till", day: "周日" },
          { text: "Call the printer", date: "2026-02-30", time: "25:00", who: "大家" },
          { text: "Thursday thing", day: "thu" },
          "not a note",
        ],
      }),
      "2026-11-19",
    );
    expect(notes).toEqual([
      { text: "Order the cake stand", date: "2026-11-20", time: 960, who: "Ana" },
      { text: "Count the till", date: "2026-11-22", time: null, who: null },
      { text: "Call the printer", date: null, time: null, who: null },
      { text: "Thursday thing", date: "2026-11-19", time: null, who: null },
    ]);
  });

  it("says when the answer isn't what was asked for", () => {
    expect(readPlan("I can't help with that.")).toBeNull();
    expect(readPlan({ response: "{broken" })).toBeNull();
    expect(readPlan(null)).toBeNull();
    expect(readPlan('{"notes":[]}')).toEqual([]);
  });

  it("tells the model which week the board plans, and what today is", () => {
    const [system, user] = planMessages("Ana: flyers tomorrow", "2026-11-23", "2026-11-19");
    expect(system.content).toContain("Today is Thursday 2026-11-19.");
    expect(system.content).toContain("Monday 2026-11-23 to Sunday 2026-11-29");
    expect(system.content).toContain("this week: Mon 2026-11-16, Tue 2026-11-17, Wed 2026-11-18, Thu 2026-11-19 (today, 今天)");
    expect(system.content).toContain("next week (下周): Mon 2026-11-23");
    expect(user.content).toContain("Ana: flyers tomorrow");
  });
});

describe("reading a chat line by line", () => {
  it("takes off names and timestamps, and leaves out small talk", () => {
    const chat = [
      "[19/11/2026 12:03] Ana: Flyers out Wed 8 am",
      "19/11/2026, 12:04 - Bo: Cake stand has to be here Fri",
      "小王：周四下午4点试吃",
      "Cy  12:05 PM",
      "Window lettering Fri",
      "Dee: 👍",
      "Eli: ok!",
      "收到",
      "- Count the till Sun",
      "Window lettering Fri",
    ].join("\n");
    expect(linesToNotes(chat).map((n) => n.text)).toEqual(["Flyers out Wed 8 am", "Cake stand has to be here Fri", "周四下午4点试吃", "Window lettering Fri", "Count the till Sun"]);
  });

  it("pins down today, tomorrow and next week from the day it is", () => {
    const notes = linesToNotes("今天下午订蛋糕\n明天 flyers\n下周三开会\nlaunch next Fri\nOven check Wed", 30, "2026-11-19");
    expect(notes.map((n) => n.date)).toEqual(["2026-11-19", "2026-11-20", "2026-11-25", "2026-11-27", null]);
    expect(relativeDate("后天", "2026-11-19")).toBe("2026-11-21");
    expect(relativeDate("下周", "2026-11-19")).toBe("2026-11-23");
    expect(relativeDate("this Sunday", "2026-11-19")).toBe("2026-11-22");
  });

  it("keeps a to-do list as it is", () => {
    expect(linesToNotes("16:00 taste panel Thu\nOven check Mon 6 am").map((n) => n.text)).toEqual(["16:00 taste panel Thu", "Oven check Mon 6 am"]);
  });

  it("knows a chat from a short list", () => {
    expect(looksLikeAChat("Flyers Wed\nCake Fri")).toBe(false);
    expect(looksLikeAChat(Array.from({ length: 6 }, (_, i) => `line ${i}`).join("\n"))).toBe(true);
    expect(looksLikeAChat("x".repeat(300))).toBe(true);
  });
});

describe("the calendar feed", () => {
  const meta: Meta = { client: "Pell & Rye", file: "Opening week", weekOf: "2026-11-23", template: "" };
  const items = [
    { id: "n1", type: "note", x: 0, y: 0, rot: 0, z: 1, text: "Flyers out Wed 8 am", color: "#FFB38A" },
    { id: "n2", type: "note", x: 0, y: 0, rot: 0, z: 2, text: "Count the till", day: 6, color: "#FFB38A" },
    { id: "n3", type: "note", x: 0, y: 0, rot: 0, z: 3, text: "No day here", color: "#FFB38A" },
  ] as Item[];

  it("tells calendar apps to look again, in the board's time zone", () => {
    const ics = toIcs(meta, items, "b1", new Date("2026-11-19T00:00:00Z"), { tz: "Asia/Tokyo" });
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT1H");
    expect(ics).toContain("X-WR-TIMEZONE:Asia/Tokyo");
    expect(ics).toContain("DTSTART:20261125T080000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261129");
    expect(ics).not.toContain("No day here");
  });

  it("keeps each event's id, so a subscribed calendar moves it rather than adding another", () => {
    const a = toIcs(meta, items, "b1", new Date(), {});
    const b = toIcs({ ...meta, weekOf: "2026-11-30" }, items, "b1", new Date(), {});
    const uids = (s: string) => s.match(/^UID:.*$/gm);
    expect(uids(a)).toEqual(uids(b));
    expect(uids(a)).toEqual(["UID:n1.b1@longtable", "UID:n2.b1@longtable"]);
  });
});
