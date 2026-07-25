import { describe, it, expect } from "vitest";
import { Fraction, frac } from "../src/fraction.js";

describe("Fraction — exact rational arithmetic", () => {
  it("reduces on construction", () => {
    expect(frac(2, 4).toString()).toBe("1/2");
    expect(frac(6, 3).toString()).toBe("2");
    expect(frac(-2, -4).toString()).toBe("1/2");
    expect(frac(2, -4).toString()).toBe("-1/2");
  });

  it("adds thirds without rounding (the reason floats are banned)", () => {
    const third = frac(1, 3);
    const sum = third.add(third).add(third);
    expect(sum.eq(Fraction.ONE)).toBe(true);
    // A float would give 0.9999999999999999 here.
    expect(sum.toString()).toBe("1");
  });

  it("equality is value-based and exact", () => {
    expect(frac(2, 6).eq(frac(1, 3))).toBe(true);
    expect(frac(2, 3).eq(frac(1, 3))).toBe(false);
  });

  it("compares with lt/lte", () => {
    expect(frac(1, 3).lt(frac(1, 2))).toBe(true);
    expect(frac(1, 2).lte(frac(1, 2))).toBe(true);
    expect(frac(2, 3).lt(frac(1, 3))).toBe(false);
  });

  it("throws on zero denominator", () => {
    expect(() => frac(1, 0)).toThrow();
  });
});
