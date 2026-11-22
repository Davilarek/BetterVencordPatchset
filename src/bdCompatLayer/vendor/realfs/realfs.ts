import { SpecBuffer } from "./type_system";
import { control_message, opcode_map, response_spec, spec } from "./shared";

import type { Backend, CreationOptions, InodeLike, WriteStreamOptions } from '@zenfs/core';
import { _inode_fields, Async, FileSystem, Inode } from '@zenfs/core';
import { SnapshotRestorer } from "./snapshot";
import { dirname, join, sep } from "@zenfs/core/path";

const S_IFMT = 0o170000;  // bitmask for the file type
const S_IFDIR = 0o040000; // directory
const S_IFREG = 0o100000; // regular file

function hash32(x: number) {
    x = x >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    x = Math.imul(x, 0x85ebca6b) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    x = Math.imul(x, 0xc2b2ae35) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0;
    return x >>> 0;
}

type WriteArgs<O extends keyof typeof spec> =
    Parameters<(typeof spec)[O]["write"]> extends [SpecBuffer, ...infer P] ? P : never;

type ReadResponseArgs<O extends keyof typeof response_spec> =
    ReturnType<(typeof response_spec)[O]["read"]>;

function writeSpec<O extends keyof typeof spec>(
    op: O,
    buf: SpecBuffer,
    ...args: WriteArgs<O>
): void {
    (spec[op].write as any)(buf, ...args);
}

const errAsBytes = new TextEncoder().encode("ERR:");

function deserializeError(obj: any) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }
    const error = new Error(obj.message);
    error.name = obj.name || 'Error';
    error.stack = obj.stack;
    for (const key of Object.keys(obj)) {
        if (!['name', 'message', 'stack'].includes(key)) {
            (error as any)[key] = obj[key];
        }
    }
    return error;
}

export class RealFSClient {
    private socket: WebSocket;
    // private emitter: EventEmitter;
    private pendingRequests = new Map<number, (buffer: SpecBuffer) => void>();

    public ready: Promise<void>;
    private nextId: number;
    constructor(url: string) {
        this.socket = new WebSocket(`ws://${url}`);
        this.socket.binaryType = "arraybuffer";
        // this.emitter = new EventEmitter();
        this.socket.onmessage = async event => {
            const data = event.data instanceof Blob ? new Uint8Array(await event.data.arrayBuffer()) : event.data;
            const buf = new SpecBuffer(data);
            const head = control_message.read(buf);
            console.log("Received head", head);
            // console.log(buf.getBuffer().length);
            // this.emitter.emit(head.id.toString(), buf);
            const callback = this.pendingRequests.get(head.id);
            if (!callback) throw new Error("Orphaned request");
            this.pendingRequests.delete(head.id);
            callback(buf);
        }
        this.ready = new Promise(resolve => {
            this.socket.onopen = () => resolve();
        })
        // this.nextId = Date.now();
        this.nextId = 1; // date overflows for some reason
    }

    public send_request<O extends keyof typeof opcode_map>(
        operation: O,
        ...params: WriteArgs<O>
    ): Promise<ReadResponseArgs<O>> {
        const buffer = new SpecBuffer();
        const id = this.nextId++;
        control_message.write(buffer, operation, id);
        writeSpec(operation, buffer, ...params);
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, (buf) => {
                try {
                    console.log("Got response for", id);
                    const oldOffset = buf.getOffset();
                    const nextFourBytes = buf.read(4);
                    if (nextFourBytes.every((x, index) => {
                        return x === errAsBytes[index];
                    })) {
                        const decoded = new TextDecoder().decode(buf.read(buf.remaining()));
                        const errorRaw = JSON.parse(decoded.split("\x00")[0]);
                        throw deserializeError(errorRaw);
                    }
                    buf.setOffset(oldOffset);
                    const res = response_spec[operation].read(buf);
                    // console.log("Got response", res, id);
                    resolve(res as ReadResponseArgs<O>);
                } catch (err) {
                    reject(err);
                }
            });
            this.socket.send(buffer.getBuffer() as any);
            console.log("Sent", operation, params, id);
        });
    }

    public reattach() {
        const url = this.socket.url;
        if (this.socket.readyState != WebSocket.OPEN) {
            const originalMessageHandler = this.socket.onmessage;
            this.socket.close();
            this.socket = new WebSocket(url);
            this.socket.binaryType = "arraybuffer";
            this.socket.onmessage = originalMessageHandler;
        }
    }
    public getSnapshotPathname() {
        return this.socket.url.replace(/^ws/, "http").replace("/ws", "/snapshot");
    }

    public teardown() {
        this.socket.close();
    }
}
type Metadata = Partial<Record<keyof InodeLike, string>>;
function stringifyStats(stats: Partial<InodeLike>): Partial<Metadata> {
    const data: Partial<Metadata> = {};
    for (const prop of _inode_fields) {
        if (prop in stats) data[prop] = stats[prop]?.toString();
    }
    return data;
}

const makeFakeWriteStream = (sync: FileSystem, path: string, options: WriteStreamOptions) => {
    if (!sync.existsSync(path)) {
        sync.createFileSync(path, {
            mode: S_IFREG | 0o777,
            gid: 0,
            uid: 0,
        });
    }
    const streamWrite = sync.streamWrite(path, options);
    const writer = streamWrite.getWriter();
    const listeners = new Map<string, ((...args: any[]) => void)[]>();
    const state = {
        _closing: false,
    };
    return {
        end() {
            if (state._closing) return;
            state._closing = true;
            const promise = writer.close();
            promise.then(() => {
                listeners.get("finish")?.forEach(listener => listener());
                listeners.clear();
            });
        },
        close() {
            this.end();
        },
        on(event: string, listener: (...args: any[]) => void) {
            if (listeners.has(event))
                listeners.get(event)?.push(listener);
            else
                listeners.set(event, [listener]);
            return this;
        },
        async write(chunk: Uint8Array) {
            await writer.write(chunk);
        },
    } as any;
}

const syncBoundMkdir = (sync: FileSystem, path: string, options: { recursive: boolean } = { recursive: false }) => {
    if (options.recursive === true) {
        const split = path.split(sep).filter(Boolean);
        for (let i = 1; i < split.length - 1; ++i) {
            const subpath = split.slice(0, i + 1).join("/");
            if (sync.existsSync(subpath)) continue;
            sync.mkdirSync(subpath, {
                mode: S_IFDIR | 0o777,
                gid: 0,
                uid: 0,
            });
        }
    }
    if (sync.existsSync(path)) {
        return;
    }
    sync.mkdirSync(path, {
        mode: S_IFDIR | 0o777,
        gid: 0,
        uid: 0,
    });
}

const syncBoundUtimes = (sync: FileSystem, path: string, atime: Date | number, mtime: Date | number, cb: (err: Error | null) => void) => {
    sync.touchSync(path, {
        atimeMs: atime instanceof Date ? atime.getTime() : atime,
        mtimeMs: mtime instanceof Date ? mtime.getTime() : mtime,
    });
    if (cb)
        cb(null);
}

export class RealFS extends Async(FileSystem) {
    override _sync: FileSystem;
    private readonly client: RealFSClient;
    private snapshotRestorer: SnapshotRestorer;
    public constructor(
        client: RealFSClient,
        sync: FileSystem
    ) {
        super(0x7265616C, "realfs");
        this.client = client;
        this._sync = sync;
        this.snapshotRestorer = new SnapshotRestorer(
            "/",
            join,
            makeFakeWriteStream.bind(null, this._sync!),
            sep,
            dirname,
            syncBoundMkdir.bind(null, this._sync!) as any,
            syncBoundUtimes.bind(null, this._sync!) as any,
        );
    }
    async crossCopy(path: string) {
        if (path === "/")
            return await this.snapshotRestorer.restoreFromUrl(this.client.getSnapshotPathname());
        throw new Error(`not supposed to be here at ${path}`);
    }

    async readdir(path: string) {
        return (await this.client.send_request("ls", path)).entries;
    }

    async rename(oldPath: string, newPath: string) {
        if (oldPath == newPath) return;
        await this.client.send_request("move", oldPath, newPath);
    }
    async stat(path: string) {
        const res = await this.client.send_request("stat", path);
        return new Inode({
            atimeMs: Number(res.stat.atime),
            ctimeMs: Number(res.stat.ctime),
            mtimeMs: Number(res.stat.mtime),
            size: res.stat.size,
            mode: res.stat.mode,
        });
    }
    async touch(path: string, metadata: Partial<InodeLike>) {
        await this.client.send_request("touch", path, {
            atime: BigInt(metadata.atimeMs ?? 0),
            ctime: BigInt(metadata.ctimeMs ?? 0),
            mtime: BigInt(metadata.mtimeMs ?? 0),
            size: metadata.size ?? 0,
            mode: metadata.mode ?? 0,
        });
    }
    async createFile(path: string, options: CreationOptions) {
        const res = await this.client.send_request("new", path, {
            mode: options.mode | S_IFREG,
        });

        return new Inode({
            atimeMs: Number(res.result.atime),
            ctimeMs: Number(res.result.ctime),
            mtimeMs: Number(res.result.mtime),
            size: res.result.size,
            mode: res.result.mode,
        });
    }
    async unlink(path: string) {
        await this.client.send_request("unlink", path);
    }
    async rmdir(path: string) {
        await this.client.send_request("rmdir", path);
    }
    async mkdir(path: string, options: CreationOptions) {
        const res = await this.client.send_request("new", path, {
            mode: options.mode | S_IFDIR,
        });

        return new Inode({
            atimeMs: Number(res.result.atime),
            ctimeMs: Number(res.result.ctime),
            mtimeMs: Number(res.result.mtime),
            size: res.result.size,
            mode: res.result.mode,
        });
    }
    link(target: string, link: string): Promise<void> {
        console.log("link", ...arguments);
        throw new Error("Method not implemented.");
    }
    async read(path: string, buffer: Uint8Array, start: number, end: number) {
        const res = await this.client.send_request("read", path, start, end);
        buffer.set(res.data, 0);
    }
    async write(path: string, buffer: Uint8Array, offset: number) {
        await this.client.send_request("write", path, buffer, offset);
    }
}

export interface RealFSOptions {
    client: RealFSClient;
    sync: FileSystem;
}

export const _RealFS = {
    name: 'RealFS',

    options: {
        client: { type: 'object', required: true },
        sync: { type: 'object', required: true },
    },

    isAvailable(): boolean {
        return true;
    },

    create(options: RealFSOptions) {
        return new RealFS(options.client, options.sync);
    },
} satisfies Backend<RealFS, RealFSOptions>;
type _RealFS = typeof _RealFS;
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface RealFS_ extends _RealFS { }
export const RealFs: RealFS_ = _RealFS;
