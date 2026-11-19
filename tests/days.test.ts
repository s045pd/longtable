import { describe, expect, it } from "vitest";
import { dateOf, findDay, findTime, nextMonday } from "../src/shared/days";

describe("findDay", () => {
  it("finds short and long English day names", () => {
    expect(findDay("Oven check Mon 6 am")?.day).toBe(0);
    expect(findDay("Flyers to print Tues")?.day).toBe(1);
    expect(findDay("Test bake Wednesday")?.day).toBe(2);
    expect(findDay("Aprons arrive THURS")?.day).toBe(3);
    expect(findDay("Hire\nSaturday\nbarista")?.day).toBe(5);
    expect(findDay("Kids' bun class Sun")?.day).toBe(6);
  });
  it("does not read days inside other words", () => {
    expect(findDay("Wedding cake")).toBeNull();
    expect(findDay("Sunflower bread")).toBeNull();
    expect(findDay("Monstera for the window")).toBeNull();
    expect(findDay("Saturn-shaped buns")).toBeNull();
  });
  it("takes the first day named", () => {
    expect(findDay("Move Fri delivery to Mon")?.day).toBe(4);
  });
  it("reads Chinese weekdays", () => {
    expect(findDay("周一 开门")?.day).toBe(0);
    expect(findDay("星期三试烤")?.day).toBe(2);
    expect(findDay("礼拜天 感谢派对")?.day).toBe(6);
    expect(findDay("周日盘点")?.day).toBe(6);
  });
  it("reports where the day word is", () => {
    const m = findDay("Flyers out Wed 8 am")!;
    expect("Flyers out Wed 8 am".slice(m.index, m.index + m.length)).toBe("Wed");
  });
});

describe("findTime", () => {
  it("reads 12-hour and 24-hour times", () => {
    expect(findTime("Oven check Mon 6 am")).toBe(6 * 60);
    expect(findTime("Taste panel Thu 4 pm")).toBe(16 * 60);
    expect(findTime("Brass band Sat 10:30am")).toBe(10 * 60 + 30);
    expect(findTime("Stand-up 09:15")).toBe(9 * 60 + 15);
    expect(findTime("Midnight bake 12 am")).toBe(0);
    expect(findTime("Lunch 12 pm")).toBe(12 * 60);
  });
  it("reads Chinese times", () => {
    expect(findTime("周四下午4点试吃")).toBe(16 * 60);
    expect(findTime("周三 上午8点半 发传单")).toBe(8 * 60 + 30);
    expect(findTime("晚上7:30 庆功")).toBe(19 * 60 + 30);
  });
  it("leaves notes without a time alone", () => {
    expect(findTime("Sourdough × 120 Thu")).toBeNull();
    expect(findTime("Flour 50 kg lands Tue")).toBeNull();
  });
});

describe("dates", () => {
  it("finds the next Monday", () => {
    expect(nextMonday(new Date(2026, 10, 18))).toBe("2026-11-23"); // a Wednesday
    expect(nextMonday(new Date(2026, 10, 23))).toBe("2026-11-23"); // a Monday
    expect(nextMonday(new Date(2026, 10, 22))).toBe("2026-11-23"); // a Sunday
  });
  it("counts days from the week's Monday", () => {
    expect(dateOf("2026-11-23", 6).getDate()).toBe(29);
    expect(dateOf("2026-12-28", 6).getFullYear()).toBe(2027);
  });
});
