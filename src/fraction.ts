/**
 * Exact rational arithmetic.
 *
 * SPEC §2.2: "長さは既約分数で保持する。浮動小数は 1/3 で破綻するため禁止"
 * (durations are kept as reduced fractions; floats are forbidden because they
 * break on 1/3). Every time value in L0 flows through this type.
 */

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

export class Fraction {
  /** Numerator, sign carried here. */
  readonly num: bigint;
  /** Denominator, always > 0. */
  readonly den: bigint;

  constructor(num: bigint | number, den: bigint | number = 1n) {
    let n = typeof num === "bigint" ? num : BigInt(num);
    let d = typeof den === "bigint" ? den : BigInt(den);
    if (d === 0n) throw new Error("Fraction: denominator is zero");
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d) || 1n;
    this.num = n / g;
    this.den = d / g;
  }

  static readonly ZERO = new Fraction(0n);
  static readonly ONE = new Fraction(1n);

  add(o: Fraction): Fraction {
    return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Fraction): Fraction {
    return new Fraction(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Fraction): Fraction {
    return new Fraction(this.num * o.num, this.den * o.den);
  }

  div(o: Fraction): Fraction {
    if (o.num === 0n) throw new Error("Fraction: division by zero");
    return new Fraction(this.num * o.den, this.den * o.num);
  }

  eq(o: Fraction): boolean {
    // Both are stored reduced with positive denominator, so this is exact.
    return this.num === o.num && this.den === o.den;
  }

  lt(o: Fraction): boolean {
    return this.num * o.den < o.num * this.den;
  }

  lte(o: Fraction): boolean {
    return this.num * o.den <= o.num * this.den;
  }

  isZero(): boolean {
    return this.num === 0n;
  }

  /** Approximate value — for display / audio scheduling only, never for logic. */
  toNumber(): number {
    return Number(this.num) / Number(this.den);
  }

  toString(): string {
    return this.den === 1n ? `${this.num}` : `${this.num}/${this.den}`;
  }
}

export function frac(num: bigint | number, den: bigint | number = 1n): Fraction {
  return new Fraction(num, den);
}
