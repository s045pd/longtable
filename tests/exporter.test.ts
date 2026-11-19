import { describe, expect, it } from "vitest";
import { toCsv, toIcs, toMarkdown, weekEntries } from "../src/shared/exporter";
import { makeTemplate } from "../src/shared/templates";

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
    expect(csv.split("\r\n")[1]).toBe('Tuesday,2026-11-24,,"Say ""hi"", Tue",Bo,0');
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
});
