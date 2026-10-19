/**
 * A strict POSIX ustar writer and reader for flat archives of regular files.
 *
 * The writer emits only regular-file headers with fixed mode, owner and time, so equal inputs give
 * equal bytes. The reader accepts only what the writer could have produced in shape: `ustar\0` + `00`
 * headers with valid checksums, regular files (typeflag `0` or NUL), an empty prefix and link name,
 * NUL-only padding and a zero end-of-archive. Everything else (directories, links, devices, FIFOs,
 * PAX or GNU extension records, base-256 numbers, trailing data) is refused. It never touches the
 * file system and never interprets member content.
 */

export const TAR_BLOCK = 512;
/** The ustar name field; longer names need the prefix field, which would add a directory. */
export const TAR_NAME_BYTES = 100;

export interface TarMember { name: string; bytes: Uint8Array }

export type TarRefusal =
  | 'corrupt' // bad checksum, truncated, malformed numeric field, non-ustar header, trailing data
  | 'link' // hard or symbolic link
  | 'unsupported' // any other non-regular entry, a prefix, a link name on a file, a PAX/GNU record
  | 'too_large' // a member, the total or the member count exceeds a limit
  | 'too_many';

export class TarError extends Error {
  constructor(public readonly refusal: TarRefusal, message: string, public readonly memberName?: string) {
    super(message);
    this.name = 'TarError';
  }
}

const encoder = new TextEncoder();
const MODE = '0000644';
const ZERO7 = '0000000';
const MTIME = '00000000000';

function writeString(header: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = encoder.encode(value);
  if (bytes.length > length) throw new TarError('unsupported', `Tar field value too long: ${value}`);
  header.set(bytes, offset);
}

function octal(value: number, digits: number): string {
  const text = value.toString(8);
  if (text.length > digits) throw new TarError('too_large', 'Value does not fit a ustar numeric field.');
  return text.padStart(digits, '0');
}

function headerFor(name: string, size: number): Uint8Array {
  const header = new Uint8Array(TAR_BLOCK);
  writeString(header, 0, TAR_NAME_BYTES, name);
  writeString(header, 100, 8, `${MODE}\0`);
  writeString(header, 108, 8, `${ZERO7}\0`); // uid
  writeString(header, 116, 8, `${ZERO7}\0`); // gid
  writeString(header, 124, 12, `${octal(size, 11)}\0`);
  writeString(header, 136, 12, `${MTIME}\0`);
  header.fill(0x20, 148, 156); // checksum computed over spaces
  header[156] = 0x30; // '0' regular file
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 329, 8, `${ZERO7}\0`); // devmajor
  writeString(header, 337, 8, `${ZERO7}\0`); // devminor
  let sum = 0;
  for (const byte of header) sum += byte;
  writeString(header, 148, 8, `${octal(sum, 6)}\0 `);
  return header;
}

const padded = (size: number) => Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;

/** Writes members in the given order. Callers sort and validate names. */
export function writeTar(members: readonly TarMember[]): Uint8Array {
  let total = 2 * TAR_BLOCK;
  for (const member of members) total += TAR_BLOCK + padded(member.bytes.length);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const member of members) {
    if (encoder.encode(member.name).length > TAR_NAME_BYTES || member.name.length === 0) {
      throw new TarError('unsupported', `Member name must be 1-${TAR_NAME_BYTES} bytes: ${member.name}`, member.name);
    }
    out.set(headerFor(member.name, member.bytes.length), offset);
    offset += TAR_BLOCK;
    out.set(member.bytes, offset);
    offset += padded(member.bytes.length);
  }
  return out; // the final two blocks are already zero
}

export interface TarReadLimits { maxMembers: number; maxMemberBytes: number; maxTotalBytes: number }

function field(header: Uint8Array, offset: number, length: number): Uint8Array {
  return header.subarray(offset, offset + length);
}

/** A NUL-terminated text field; bytes after the first NUL must also be NUL. */
function text(header: Uint8Array, offset: number, length: number, label: string): string {
  const bytes = field(header, offset, length);
  const end = bytes.indexOf(0);
  const used = end === -1 ? bytes : bytes.subarray(0, end);
  if (end !== -1 && bytes.subarray(end).some(byte => byte !== 0)) throw new TarError('corrupt', `Tar ${label} field has data after its terminator.`);
  for (const byte of used) if (byte < 0x20 || byte > 0x7e) throw new TarError('corrupt', `Tar ${label} field must be printable ASCII.`);
  return String.fromCharCode(...used);
}

/** Octal digits, optionally space-padded on the left and NUL/space-terminated. Base-256 is refused. */
function number(header: Uint8Array, offset: number, length: number, label: string): number {
  const bytes = field(header, offset, length);
  if ((bytes[0]! & 0x80) !== 0) throw new TarError('corrupt', `Tar ${label} uses an unsupported base-256 encoding.`);
  const raw = String.fromCharCode(...bytes).replace(/[\0 ]+$/, '').replace(/^ +/, '');
  if (!/^[0-7]+$/.test(raw)) throw new TarError('corrupt', `Tar ${label} field is not octal.`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) throw new TarError('corrupt', `Tar ${label} field is out of range.`);
  return value;
}

const isZero = (bytes: Uint8Array) => bytes.every(byte => byte === 0);

/**
 * Reads a flat ustar archive of regular files. Names are returned raw; callers validate them.
 * Size limits are checked from headers before any content is copied.
 */
export function readTar(archive: Uint8Array, limits: TarReadLimits): TarMember[] {
  const members: TarMember[] = [];
  let offset = 0, total = 0;
  for (;;) {
    if (offset + TAR_BLOCK > archive.length) throw new TarError('corrupt', 'Archive is truncated before its end marker.');
    const header = archive.subarray(offset, offset + TAR_BLOCK);
    if (isZero(header)) {
      // End of archive: a second zero block, then only zero padding.
      if (offset + 2 * TAR_BLOCK > archive.length || !isZero(archive.subarray(offset + TAR_BLOCK, offset + 2 * TAR_BLOCK))) {
        throw new TarError('corrupt', 'Archive end marker is incomplete.');
      }
      if (!isZero(archive.subarray(offset + 2 * TAR_BLOCK))) throw new TarError('corrupt', 'Archive has data after its end marker.');
      return members;
    }
    const expected = number(header, 148, 8, 'checksum');
    let sum = 0;
    for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
    if (sum !== expected) throw new TarError('corrupt', 'Tar header checksum mismatch.');
    if (text(header, 257, 6, 'magic') !== 'ustar' || header[262] !== 0 || header[263] !== 0x30 || header[264] !== 0x30) {
      throw new TarError('corrupt', 'Only POSIX ustar headers are accepted.');
    }
    const name = text(header, 0, TAR_NAME_BYTES, 'name');
    const typeflag = header[156]!;
    if (typeflag === 0x31 || typeflag === 0x32) throw new TarError('link', `Link entries are not allowed: ${name}`, name);
    if (typeflag !== 0x30 && typeflag !== 0) {
      throw new TarError('unsupported', `Only regular files are allowed (entry type ${JSON.stringify(String.fromCharCode(typeflag))}): ${name}`, name);
    }
    if (text(header, 157, 100, 'linkname') !== '') throw new TarError('unsupported', `A regular file must not name a link target: ${name}`, name);
    if (text(header, 345, 155, 'prefix') !== '') throw new TarError('unsupported', `Prefixed (nested) names are not allowed: ${name}`, name);
    for (const [at, length, label] of [[100, 8, 'mode'], [108, 8, 'uid'], [116, 8, 'gid'], [136, 12, 'mtime']] as const) number(header, at, length, label);
    text(header, 265, 32, 'uname'); text(header, 297, 32, 'gname');
    const size = number(header, 124, 12, 'size');
    if (members.length + 1 > limits.maxMembers) throw new TarError('too_many', `Archive has more than ${limits.maxMembers} members.`);
    if (size > limits.maxMemberBytes) throw new TarError('too_large', `Member ${name} exceeds ${limits.maxMemberBytes} bytes.`, name);
    total += size;
    if (total > limits.maxTotalBytes) throw new TarError('too_large', `Members exceed ${limits.maxTotalBytes} bytes in total.`);
    const start = offset + TAR_BLOCK;
    const end = start + padded(size);
    if (end > archive.length) throw new TarError('corrupt', `Member ${name} is truncated.`, name);
    if (!isZero(archive.subarray(start + size, end))) throw new TarError('corrupt', `Member ${name} has non-zero padding.`, name);
    members.push({ name, bytes: archive.slice(start, start + size) });
    offset = end;
  }
}
