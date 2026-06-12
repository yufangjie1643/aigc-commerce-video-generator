const QR_VERSION = 5;
const QR_SIZE = 17 + QR_VERSION * 4;
const QR_DATA_CODEWORDS = 108;
const QR_ECC_CODEWORDS = 26;
const QR_MASK = 0;
const QR_ECC_LOW_FORMAT = 1;

type Matrix = boolean[][];

class BitBuffer {
  bytes: number[] = [];
  bitLength = 0;

  appendBits(value: number, length: number): void {
    if (length < 0 || length > 31 || value >>> length !== 0) {
      throw new Error("invalid QR bit segment");
    }
    for (let i = length - 1; i >= 0; i--) {
      this.appendBit(((value >>> i) & 1) !== 0);
    }
  }

  appendBit(bit: boolean): void {
    if (this.bitLength % 8 === 0) this.bytes.push(0);
    if (bit) {
      const lastIndex = this.bytes.length - 1;
      this.bytes[lastIndex] = (this.bytes[lastIndex] ?? 0) | (0x80 >>> (this.bitLength % 8));
    }
    this.bitLength += 1;
  }
}

export function createQrSvg(payload: string): string {
  const modules = createQrModules(payload);
  return modulesToSvg(modules);
}

function createQrModules(payload: string): Matrix {
  const dataCodewords = encodePayload(payload);
  const ecc = reedSolomonComputeRemainder(dataCodewords, reedSolomonComputeDivisor(QR_ECC_CODEWORDS));
  const codewords = [...dataCodewords, ...ecc];
  const modules = makeMatrix(QR_SIZE, false);
  const isFunction = makeMatrix(QR_SIZE, false);
  const setFunction = (x: number, y: number, dark: boolean): void => {
    modules[y]![x] = dark;
    isFunction[y]![x] = true;
  };

  drawFunctionPatterns(setFunction);
  drawFormatBits(setFunction, QR_MASK);
  drawCodewords(modules, isFunction, codewords);
  drawFormatBits(setFunction, QR_MASK);
  return modules;
}

function encodePayload(payload: string): number[] {
  const data = [...Buffer.from(payload, "utf8")];
  const buffer = new BitBuffer();
  buffer.appendBits(0x4, 4);
  buffer.appendBits(data.length, 8);
  for (const byte of data) buffer.appendBits(byte, 8);

  const capacityBits = QR_DATA_CODEWORDS * 8;
  if (buffer.bitLength > capacityBits) {
    throw new Error(`QR payload is too long (${data.length} bytes, max 106 bytes)`);
  }
  buffer.appendBits(0, Math.min(4, capacityBits - buffer.bitLength));
  while (buffer.bitLength % 8 !== 0) buffer.appendBit(false);
  for (let padByte = 0xec; buffer.bytes.length < QR_DATA_CODEWORDS; padByte ^= 0xfd) {
    buffer.bytes.push(padByte);
  }
  return buffer.bytes;
}

function makeMatrix(size: number, value: boolean): Matrix {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => value));
}

function drawFunctionPatterns(setFunction: (x: number, y: number, dark: boolean) => void): void {
  drawFinderPattern(setFunction, 3, 3);
  drawFinderPattern(setFunction, QR_SIZE - 4, 3);
  drawFinderPattern(setFunction, 3, QR_SIZE - 4);
  drawAlignmentPattern(setFunction, 30, 30);

  for (let i = 8; i <= QR_SIZE - 9; i++) {
    const dark = i % 2 === 0;
    setFunction(6, i, dark);
    setFunction(i, 6, dark);
  }
}

function drawFinderPattern(
  setFunction: (x: number, y: number, dark: boolean) => void,
  cx: number,
  cy: number,
): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= QR_SIZE || y >= QR_SIZE) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(x, y, dist === 0 || dist === 1 || dist === 3);
    }
  }
}

function drawAlignmentPattern(
  setFunction: (x: number, y: number, dark: boolean) => void,
  cx: number,
  cy: number,
): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(cx + dx, cy + dy, dist === 0 || dist === 2);
    }
  }
}

function drawFormatBits(setFunction: (x: number, y: number, dark: boolean) => void, mask: number): void {
  const bits = getFormatBits(mask);
  const bit = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) setFunction(8, i, bit(i));
  setFunction(8, 7, bit(6));
  setFunction(8, 8, bit(7));
  setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFunction(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFunction(QR_SIZE - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFunction(8, QR_SIZE - 15 + i, bit(i));
  setFunction(8, QR_SIZE - 8, true);
}

function getFormatBits(mask: number): number {
  const data = (QR_ECC_LOW_FORMAT << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function drawCodewords(modules: Matrix, isFunction: Matrix, codewords: number[]): void {
  const bits: boolean[] = [];
  for (const byte of codewords) {
    for (let i = 7; i >= 0; i--) bits.push(((byte >>> i) & 1) !== 0);
  }

  let bitIndex = 0;
  let upward = true;
  for (let right = QR_SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < QR_SIZE; vert++) {
      const y = upward ? QR_SIZE - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (isFunction[y]![x]) continue;
        const dark = bitIndex < bits.length ? bits[bitIndex]! : false;
        modules[y]![x] = shouldMask(x, y) ? !dark : dark;
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function shouldMask(x: number, y: number): boolean {
  return (x + y) % 2 === 0;
}

const GF_EXP: number[] = [];
const GF_LOG: number[] = [];
for (let x = 1, i = 0; i < 255; i++) {
  GF_EXP[i] = x;
  GF_LOG[x] = i;
  x <<= 1;
  if (x & 0x100) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255] ?? 0;

function gfMultiply(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[(GF_LOG[x] ?? 0) + (GF_LOG[y] ?? 0)] ?? 0;
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root);
      if (j + 1 < degree) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result = Array.from({ length: divisor.length }, () => 0);
  for (const byte of data) {
    const factor = byte ^ result.shift()!;
    result.push(0);
    for (let i = 0; i < result.length; i++) {
      result[i] = (result[i] ?? 0) ^ gfMultiply(divisor[i] ?? 0, factor);
    }
  }
  return result;
}

function modulesToSvg(modules: Matrix): string {
  const border = 4;
  const size = modules.length;
  const viewSize = size + border * 2;
  const path: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y]?.[x]) path.push(`M${x + border},${y + border}h1v1h-1z`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    `<path fill="#111827" d="${path.join(" ")}"/>`,
    "</svg>",
  ].join("");
}
