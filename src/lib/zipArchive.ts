type ZipEntry = {
  name: string;
  data: Buffer | string;
  modifiedAt?: Date;
};

type CentralDirectoryRecord = {
  name: Buffer;
  crc32: number;
  size: number;
  offset: number;
  dosTime: number;
  dosDate: number;
};

const CRC_TABLE = new Uint32Array(256).map((_, tableIndex) => {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function normalizeEntryName(name: string): string {
  return name
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => part.replace(/[^\w .@#()+,-]/g, "-").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("/");
}

export function createZipArchive(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const centralDirectory: CentralDirectoryRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const name = Buffer.from(normalizeEntryName(entry.name));
    const checksum = crc32(data);
    const { dosTime, dosDate } = toDosDateTime(entry.modifiedAt ?? new Date());

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    chunks.push(localHeader, name, data);
    centralDirectory.push({ name, crc32: checksum, size: data.length, offset, dosTime, dosDate });
    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectoryStart = offset;

  for (const record of centralDirectory) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(record.dosTime, 12);
    header.writeUInt16LE(record.dosDate, 14);
    header.writeUInt32LE(record.crc32, 16);
    header.writeUInt32LE(record.size, 20);
    header.writeUInt32LE(record.size, 24);
    header.writeUInt16LE(record.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(record.offset, 42);
    chunks.push(header, record.name);
    offset += header.length + record.name.length;
  }

  const centralDirectorySize = offset - centralDirectoryStart;
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(centralDirectory.length, 8);
  endRecord.writeUInt16LE(centralDirectory.length, 10);
  endRecord.writeUInt32LE(centralDirectorySize, 12);
  endRecord.writeUInt32LE(centralDirectoryStart, 16);
  endRecord.writeUInt16LE(0, 20);
  chunks.push(endRecord);

  return Buffer.concat(chunks);
}

