import { describe, expect, it } from "vitest";
import { toCsv, toIcs, toMarkdown, weekEntries } from "../src/shared/exporter";
import { makeTemplate } from "../src/shared/templates";
import type { NoteItem } from "../src/shared/types";

const seed = makeTemplate("pell-and-rye", new Date(2026, 10, 18));

describe("exports", () => {
  it("lists the week in day and time order", () => {
    const e = weekEntries(seed.items);
    expect(e.length).toBe(24 - 1);
    const days = e.map((x) => x.day ?? 7);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    const mon = e.filter((x) => x.day === 0);
    expect(mon[mon.length - 1].text).toBe("Oven check Mon 6 am");
  });
  it("writes Markdown with dates", () => {
    const md = toMarkdown(seed.meta, seed.items);
    expect(md).toContain("# Pell & Rye · Opening week");
    expect(md).toContain("## Monday 23 Nov");
    expect(md).toContain("- [ ] 10:00 Brass band Sat 10 am (3 votes)");
    expect(md).toContain("- [x] Starter fed");
  });
  it("writes CSV with quoting", () => {
    const csv = toCsv(seed.meta, [{ id: "q", type: "note", x: 0, y: 0, rot: 0, z: 0, color: "#FFE38A", text: 'Say "hi", Tue', by: "Bo" }]);
    expect(csv.split("\r\n")[0]).toBe("day,date,time,note,who,by,votes");
    expect(csv.split("\r\n")[1]).toBe('Tuesday,2026-11-24,,"Say ""hi"", Tue",,Bo,0');
  });
  it("writes a valid calendar", () => {
    const ics = toIcs(seed.meta, seed.items, "board12345", new Date(Date.UTC(2026, 10, 18, 12)));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(23);
    expect(ics).toContain("DTSTART:20261123T060000");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261129");
    expect(ics).toContain("SUMMARY:Thank-you party Sun");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  const note = (id: string, text: string, extra: Partial<NoteItem> = {}): NoteItem => ({ id, type: "note", x: 0, y: 0, rot: 0, z: 0, color: "#FFE38A", text, ...extra });
  const meta = { client: "My team", file: "This week", weekOf: "2026-11-16", template: "" };
  const items = [
    note("a", "Call the printer", { date: "2026-11-19", who: "Cy" }),
    note("b", "Flyers out", { date: "2026-11-25", time: 480, who: "Ana" }),
    note("c", "Sign the lease Fri"),
    note("d", "Ask @Ana about the till", { day: 6 }),
  ];

  it("puts each note on its own date, across weeks", () => {
    const md = toMarkdown(meta, items);
    expect(md.indexOf("## Thursday 19 Nov")).toBeLessThan(md.indexOf("## Friday 20 Nov"));
    expect(md.indexOf("## Sunday 22 Nov")).toBeLessThan(md.indexOf("## Wednesday 25 Nov"));
    expect(md).toContain("- [ ] Call the printer · Cy");
    expect(md).toContain("- [ ] 08:00 Flyers out · Ana");
    const ics = toIcs(meta, items, "b1", new Date(Date.UTC(2026, 10, 19)));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261119");
    expect(ics).toContain("DTSTART:20261125T080000");
    expect(ics).toContain("SUMMARY:Flyers out · Ana");
  });

  it("narrows everything to one person: their tag, or an @mention", () => {
    const md = toMarkdown(meta, items, { who: "ana" });
    expect(md).toContain("# My team · This week · ana");
    expect(md).toContain("- [ ] 08:00 Flyers out");
    expect(md).toContain("Ask @Ana about the till");
    expect(md).not.toContain("Call the printer");
    expect(md).not.toContain("· Ana");
    const ics = toIcs(meta, items, "b1", new Date(), { tz: "Asia/Tokyo" }, { who: "Ana" });
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics).toContain("X-WR-CALNAME:My team · This week · Ana");
    expect(toCsv(meta, items, { who: "Nobody" }).trim().split("\r\n")).toHaveLength(1);
  });
});
