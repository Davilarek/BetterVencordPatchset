import { mkdir, utimes, WriteStream } from "@zenfs/core";
import { dirname } from "@zenfs/core/path";
import { SpecBuffer } from "./type_system";
type FileEntry = {
    path: string;
    pathOffset: number;
    type: number;
    mode: number;
    mtime: bigint;
    size: number;
    dataOffset: number;
};

const MAGIC = new TextEncoder().encode("SNAPSHOT");
const VERSION = "0.2";

/*
    structure:

    header:
        magic: 8 bytes
        version_length: 4 bytes
        version: variable length
        total_bytes: 8 bytes
        entries_count: 4 bytes
    entries:
        path_offset: 4 bytes
        path_len: 4 bytes
        type: 4 bytes
        mode: 4 bytes
        mtime: 8 bytes
        size: 8 bytes
        data_offset: 8 bytes
    path blob:
        concatenated paths of all entries
    data:
        concatenated data blocks of all entries

    endianness is dictated by underlying spec_types definitions.
*/

function readUint64(buf: SpecBuffer) {
    const low = (buf.readFromSpecType("uint32") as number) >>> 0;
    const high = (buf.readFromSpecType("uint32") as number) >>> 0;
    return (BigInt(high) << 32n) | BigInt(low);
}

enum RestoreStage {
    HEADER,
    PATH_BLOB,
    DATA_BLOCKS,
}

const ReadFlags = {
    HAD_READ_MAGIC: 1 << 0,
    HAD_READ_VERSION: 1 << 1,
    HAD_READ_TOTAL_BYTES: 1 << 2,
    HAD_READ_ENTRIES_COUNT: 1 << 3,
    HAD_READ_ALL_ENTRIES: 1 << 4,
    HAD_READ_PATH_BLOB: 1 << 5,
}

export class SnapshotRestorer {
    public stage: RestoreStage;
    public flags: number;
    public entries_read: number;
    public entries_count: number;
    public entries: FileEntry[];
    public pathBlobProcessed: boolean;
    public currentFileIndex: number;
    public dataWriteStream: WriteStream | null = null;
    public bytesWrittenForCurrentFile: number = 0;
    public totalBytesForCurrentFile: number = 0;
    public pathBlobEndOffset: number = 0;

    private leftoverDataQueue: Uint8Array[] = [];

    public path_join_impl: (...paths: string[]) => string;
    public createWriteStream_impl: (path: string, options: {}) => WriteStream;
    public path_sep: string;
    public path_dirname_impl: typeof dirname;
    public fs_mkdir_impl: typeof mkdir;
    public fs_utimes_impl: typeof utimes;

    constructor(public targetDir: string,
        path_join_impl: typeof this.path_join_impl,
        createWriteStream_impl: typeof this.createWriteStream_impl,
        path_sep: string,
        path_dirname_impl: typeof this.path_dirname_impl,
        fs_mkdir_impl: typeof this.fs_mkdir_impl,
        fs_utimes_impl: typeof this.fs_utimes_impl
    ) {
        this.stage = RestoreStage.HEADER;
        this.flags = 0;
        this.entries_read = 0;
        this.entries_count = -1;
        this.entries = [];
        this.pathBlobProcessed = false;
        this.currentFileIndex = 0;
        this.path_join_impl = path_join_impl;
        this.createWriteStream_impl = createWriteStream_impl;
        this.path_sep = path_sep;
        this.path_dirname_impl = path_dirname_impl;
        this.fs_mkdir_impl = fs_mkdir_impl;
        this.fs_utimes_impl = fs_utimes_impl;
    }

    async restoreFromStream(snapshotStream: ReadableStream<Uint8Array>) {
        const reader = snapshotStream.getReader();
        const buf = new SpecBuffer();

        try {
            let chunk;
            while ((chunk = await reader.read()) && !chunk.done) {
                console.log(`Chunk received, size=${chunk.value.length}`);

                if (this.stage === RestoreStage.DATA_BLOCKS) {

                    await this.handleDataChunk(chunk.value);
                    continue;
                }

                buf.appendToBuffer(chunk.value);
                console.log(`Remaining after append: ${buf.remaining()}`);

                if (this.stage === RestoreStage.HEADER) {
                    await this.parseHeader(buf);
                }
                if (this.stage === RestoreStage.PATH_BLOB) {
                    await this.parsePathBlob(buf);
                }
            }

            if (this.dataWriteStream) {
                this.dataWriteStream.end();
                await new Promise<void>((resolve, reject) => {
                    this.dataWriteStream!.on('finish', resolve).on('error', reject);
                });
            }
        } finally {
            reader.releaseLock();
            if (this.dataWriteStream) {
                this.dataWriteStream.close();
            }
        }
    }

    private async parseHeader(buf: SpecBuffer) {
        if (!(this.flags & ReadFlags.HAD_READ_MAGIC)) {
            if (buf.remaining() >= MAGIC.byteLength) {
                const magic = buf.read(MAGIC.byteLength);
                if (!magic.every((byte, i) => byte === MAGIC[i])) {
                    throw new Error("Invalid snapshot format");
                }
                this.flags |= ReadFlags.HAD_READ_MAGIC;
            }
        }

        if (!(this.flags & ReadFlags.HAD_READ_VERSION)) {
            if (buf.remaining() >= 4) {
                const versionBytes = buf.readFromSpecType("string") as Uint8Array;
                const version = new TextDecoder().decode(versionBytes);
                if (version !== VERSION) {
                    throw new Error(`Unsupported snapshot version: ${version}`);
                }
                console.log(`Restoring snapshot with version ${version}`);
                this.flags |= ReadFlags.HAD_READ_VERSION;
            }
        }

        if (!(this.flags & ReadFlags.HAD_READ_ENTRIES_COUNT)) {
            if (buf.remaining() >= 4) {
                const entryCount = buf.readFromSpecType("uint32") as number;
                console.log(`Found ${entryCount} entries in the snapshot`);
                this.flags |= ReadFlags.HAD_READ_ENTRIES_COUNT;
                this.entries_count = entryCount;

                for (let i = 0; i < entryCount; i++) {
                    this.entries.push({
                        path: "",
                        pathOffset: 0,
                        type: 0,
                        mode: 0,
                        mtime: 0n,
                        size: 0,
                        dataOffset: 0
                    });
                }
            }
        }

        if (!(this.flags & ReadFlags.HAD_READ_TOTAL_BYTES)) {
            if (buf.remaining() >= 8) {
                const totalBytes = readUint64(buf);
                console.log(`Total bytes in the snapshot: ${totalBytes}`);
                this.flags |= ReadFlags.HAD_READ_TOTAL_BYTES;
            }
        }

        if (!(this.flags & ReadFlags.HAD_READ_ALL_ENTRIES)) {
            if (this.entries_read < this.entries_count) {
                console.log(`Parsing entry registry, from ${this.entries_read} to ${this.entries_count}`);
                while (this.entries_read < this.entries_count) {
                    if (buf.remaining() < 40) {
                        console.log(`Not enough data to read next entry (need 40, have ${buf.remaining()})`);
                        break;
                    }
                    const entryIndex = this.entries_read;
                    this.entries[entryIndex].pathOffset = buf.readFromSpecType("uint32") as number;
                    this.entries[entryIndex].type = buf.readFromSpecType("uint32") as number;
                    this.entries[entryIndex].mode = buf.readFromSpecType("uint32") as number;
                    this.entries[entryIndex].mtime = readUint64(buf);
                    this.entries[entryIndex].size = Number(readUint64(buf));
                    this.entries[entryIndex].dataOffset = Number(readUint64(buf));
                    this.entries_read++;
                }
            }

            if (this.entries_read === this.entries_count) {
                this.flags |= ReadFlags.HAD_READ_ALL_ENTRIES;
                this.stage = RestoreStage.PATH_BLOB;
                const pathBlobSize = buf.readFromSpecType("uint32") as number;
                if (this.entries_count > 0) {
                    this.pathBlobEndOffset = this.entries[0].pathOffset + pathBlobSize;
                } else {
                    this.pathBlobEndOffset = 0;
                }
                console.log(`Finished reading all ${this.entries_count} entries, moving to path blob, which promises to be exactly ${pathBlobSize} bytes long at pos ${this.pathBlobEndOffset}`);
            }
        }
    }

    private async parsePathBlob(buf: SpecBuffer) {
        if (this.pathBlobProcessed) return;

        const buffer = buf.getBuffer();

        if (buffer.length < this.pathBlobEndOffset) {
            console.log(`Waiting for more data: have ${buffer.length}, need ${this.pathBlobEndOffset}`);
            return;
        }

        for (let i = 0; i < this.entries.length; i++) {
            const entry = this.entries[i];
            const bytesAhead = this.entries[i + 1]
                ? this.entries[i + 1].pathOffset - entry.pathOffset
                : this.pathBlobEndOffset - entry.pathOffset;
            const pathBytes = buffer.subarray(entry.pathOffset, entry.pathOffset + bytesAhead);
            entry.path = new TextDecoder().decode(pathBytes);
            console.log(`Read path for entry ${i}: "${entry.path}"`);
        }

        this.pathBlobProcessed = true;

        const leftoverStart = this.pathBlobEndOffset;
        let leftoverBytes = new Uint8Array(0);
        if (buffer.length > leftoverStart) {
            // @ts-expect-error
            leftoverBytes = buffer.subarray(leftoverStart);
            console.log(`Leftover bytes after path blob: ${leftoverBytes.length}`);
        }

        this.stage = RestoreStage.DATA_BLOCKS;

        await this.startDataRestoration(leftoverBytes);
    }

    private async startDataRestoration(initialData: Uint8Array) {

        const dirsToCreate: string[] = [];
        for (const entry of this.entries) {
            if (entry.type === 1) {
                const fullPath = this.path_join_impl(this.targetDir, entry.path);
                dirsToCreate.push(fullPath);
            }
        }

        dirsToCreate.sort((a, b) => a.split(this.path_sep).length - b.split(this.path_sep).length);
        for (const dir of dirsToCreate) {
            await this.fs_mkdir_impl(dir);
            console.log(`Created directory: ${dir}`);
        }

        await this.advanceToNextFile();
        if (initialData.length > 0) {
            await this.handleDataChunk(initialData);
        }
    }

    private async advanceToNextFile() {
        while (this.currentFileIndex < this.entries.length) {
            const entry = this.entries[this.currentFileIndex];
            if (entry.type === 1) {

                this.currentFileIndex++;
                continue;
            }

            const fullPath = this.path_join_impl(this.targetDir, entry.path);
            const dir = this.path_dirname_impl(fullPath);
            await this.fs_mkdir_impl(dir);

            this.dataWriteStream = this.createWriteStream_impl(fullPath, { flags: 'w' });
            this.bytesWrittenForCurrentFile = 0;
            this.totalBytesForCurrentFile = entry.size;

            console.log(`Starting to write file: ${fullPath} (${entry.size} bytes)`);
            return;
        }

        console.log("All files restored.");
        if (this.dataWriteStream) {
            this.dataWriteStream.end();
            this.dataWriteStream = null;
        }
    }

    private async handleDataChunk(chunk: Uint8Array) {
        this.leftoverDataQueue.push(chunk);

        while (this.currentFileIndex < this.entries.length && this.dataWriteStream) {
            const entry = this.entries[this.currentFileIndex];
            if (entry.type === 1) {
                this.currentFileIndex++;
                continue;
            }

            const needed = this.totalBytesForCurrentFile - this.bytesWrittenForCurrentFile;
            if (needed <= 0) {

                this.dataWriteStream.end();
                await new Promise<void>((resolve, reject) => {
                    this.dataWriteStream!.on('finish', resolve).on('error', reject);
                });

                const fullPath = this.path_join_impl(this.targetDir, entry.path);
                await this.fs_utimes_impl(fullPath, new Date(), new Date(Number(entry.mtime)));
                console.log(`Finished writing file: ${fullPath}`);

                this.dataWriteStream = null;
                this.currentFileIndex++;
                await this.advanceToNextFile();
                continue;
            }

            if (this.leftoverDataQueue.length === 0) break;

            const nextData = this.leftoverDataQueue[0];
            const toWrite = nextData.subarray(0, Math.min(needed, nextData.length));
            this.dataWriteStream.write(toWrite);

            this.bytesWrittenForCurrentFile += toWrite.length;

            if (toWrite.length === nextData.length) {
                this.leftoverDataQueue.shift();
            } else {
                this.leftoverDataQueue[0] = nextData.subarray(toWrite.length);
            }
        }
    }

    async restoreFromUrl(snapshotUrl: string) {
        const response = await fetch(snapshotUrl, {
            headers: {
                accept: 'application/octet-stream',
            }
        });
        if (!response.ok || !response.body) {
            throw new Error(`Failed to fetch snapshot: ${response.status} ${response.statusText}`);
        }

        await this.restoreFromStream(response.body);
    }
}
