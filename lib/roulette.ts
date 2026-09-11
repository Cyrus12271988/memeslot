// lib/roulette.ts

export const ROULETTE_WHEEL_SEQUENCE = [
  0,
  32,
  15,
  19,
  4,
  21,
  2,
  25,
  17,
  34,
  6,
  27,
  13,
  36,
  11,
  30,
  8,
  23,
  10,
  5,
  24,
  16,
  33,
  1,
  20,
  14,
  31,
  9,
  22,
  18,
  29,
  7,
  28,
  12,
  35,
  3,
  26,
] as const;

export const RED_NUMBERS = [
  1, 3, 5, 7, 9,
  12, 14, 16, 18,
  19, 21, 23, 25, 27,
  30, 32, 34, 36,
] as const;

export const BLACK_NUMBERS = [
  2, 4, 6, 8, 10,
  11, 13, 15, 17,
  20, 22, 24, 26, 28,
  29, 31, 33, 35,
] as const;

export function isRed(number: number): boolean {
  return (RED_NUMBERS as readonly number[]).includes(number);
}

export function isBlack(number: number): boolean {
  return (BLACK_NUMBERS as readonly number[]).includes(number);
}

export function isEven(number: number): boolean {
  return number !== 0 && number % 2 === 0;
}

export function isOdd(number: number): boolean {
  return number % 2 !== 0;
}

export function isLow(number: number): boolean {
  return number >= 1 && number <= 18;
}

export function isHigh(number: number): boolean {
  return number >= 19 && number <= 36;
}