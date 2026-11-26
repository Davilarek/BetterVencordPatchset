import { SpecBuffer } from "./type_system";

export const opcode_map = {
    "ls": 0x01,
    "stat": 0x02,
    "read": 0x03,
    "write": 0x04,
    "unlink": 0x05,
    "new": 0x06,
    "touch": 0x07,
    "rmdir": 0x08,
    "move": 0x09,
    "stat64": 0xA2,
}

export type StatOutput = {
    size: number,
    mode: number,
    mtime: bigint,
    ctime: bigint,
    atime: bigint,
};

export type StatOutput64 = {
    size: bigint,
    mode: number,
    mtime: bigint,
    ctime: bigint,
    atime: bigint,
};

type HandlerResponseMap = {
    ls: {
        read(buf: SpecBuffer): { entries: string[], count: number };
        write(buf: SpecBuffer, entries: string[]): void;
    };
    stat: {
        read(buf: SpecBuffer): { stat: StatOutput };
        write(buf: SpecBuffer, stat: StatOutput): void;
    };
    read: {
        read(buf: SpecBuffer): { data: Uint8Array };
        write(buf: SpecBuffer, data: Uint8Array): void;
    };
    write: {
        read(buf: SpecBuffer): { success: boolean };
        write(buf: SpecBuffer, success: boolean): void;
    };
    unlink: {
        read(buf: SpecBuffer): { success: boolean };
        write(buf: SpecBuffer, success: boolean): void;
    };
    new: {
        read(buf: SpecBuffer): { result: StatOutput };
        write(buf: SpecBuffer, result: StatOutput): void;
    };
    touch: {
        read(buf: SpecBuffer): { success: boolean };
        write(buf: SpecBuffer, success: boolean): void;
    },
    rmdir: {
        read(buf: SpecBuffer): { success: boolean };
        write(buf: SpecBuffer, success: boolean): void;
    },
    move: {
        read(buf: SpecBuffer): { success: boolean };
        write(buf: SpecBuffer, success: boolean): void;
    },
    stat64: {
        read(buf: SpecBuffer): { stat: StatOutput64 };
        write(buf: SpecBuffer, stat: StatOutput64): void;
    };
}

function storeUint64(buf: SpecBuffer, value: bigint) {
    buf.writeFromSpecType("uint32", Number(value & 0xffffffffn) >>> 0);
    buf.writeFromSpecType("uint32", Number((value >> 32n) & 0xffffffffn) >>> 0);
}

const readUint64 = (buf: SpecBuffer) => {
    const low = (buf.readFromSpecType("uint32") as number) >>> 0;
    const high = (buf.readFromSpecType("uint32") as number) >>> 0;
    return (BigInt(high) << 32n) | BigInt(low);
}

export const response_spec = {
    ls: {
        write(buf: SpecBuffer, entries: string[]) {
            buf.writeFromSpecType("uint16", entries.length);
            for (const entry of entries) {
                buf.writeFromSpecType("string", new TextEncoder().encode(entry));
            }
        },
        read(buf: SpecBuffer) {
            const count = buf.readFromSpecType("uint16") as number;
            const result: string[] = [];
            for (let i = 0; i < count; ++i) {
                result.push(new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array));
            }
            return {
                entries: result,
                count,
            };
        }
    },
    stat: {
        write(buf: SpecBuffer, stat: StatOutput) {
            buf.writeFromSpecType("uint32", stat.size);
            buf.writeFromSpecType("uint32", stat.mode);
            // buf.writeFromSpecType("uint32", stat.mtime);
            // buf.writeFromSpecType("uint32", stat.ctime);
            // buf.writeFromSpecType("uint32", stat.atime);
            storeUint64(buf, BigInt(stat.mtime));
            storeUint64(buf, BigInt(stat.ctime));
            storeUint64(buf, BigInt(stat.atime));
        },
        read(buf: SpecBuffer) {

            return {
                stat: {
                    size: Number(buf.readFromSpecType("uint32")) >>> 0,
                    mode: Number(buf.readFromSpecType("uint32")) >>> 0,
                    mtime: readUint64(buf),
                    ctime: readUint64(buf),
                    atime: readUint64(buf)
                }
            };
        }
    },
    read: {
        write(buf: SpecBuffer, data: Uint8Array) {
            buf.writeFromSpecType("uint32", data.byteLength);
            // for (let i = 0; i < data.byteLength; ++i) {
            //     buf.writeFromSpecType("uint8", data[i]);
            // }
            buf.emplaceIntoBuffer(data);
        },
        read(buf: SpecBuffer) {
            const length = Number(buf.readFromSpecType("uint32"));
            return {
                data: buf.read(length),
            };
        }
    },
    touch: {
        write(buf: SpecBuffer, success: boolean) {
            buf.writeFromSpecType("uint8", success ? 1 : 0);
        },
        read(buf: SpecBuffer) {
            return {
                success: Boolean(buf.readFromSpecType("uint8")),
            };
        }
    },
    write: {
        write(buf: SpecBuffer, success: boolean) {
            buf.writeFromSpecType("uint8", success ? 1 : 0);
        },
        read(buf: SpecBuffer) {
            return {
                success: Boolean(buf.readFromSpecType("uint8")),
            };
        }
    },
    new: {
        write(buf: SpecBuffer, result: StatOutput) {
            buf.writeFromSpecType("uint32", result.size);
            buf.writeFromSpecType("uint32", result.mode);
            storeUint64(buf, BigInt(result.mtime));
            storeUint64(buf, BigInt(result.ctime));
            storeUint64(buf, BigInt(result.atime));
        },
        read(buf: SpecBuffer) {
            return {
                result: {
                    size: Number(buf.readFromSpecType("uint32")) >>> 0,
                    mode: Number(buf.readFromSpecType("uint32")) >>> 0,
                    mtime: readUint64(buf),
                    ctime: readUint64(buf),
                    atime: readUint64(buf)
                }
            };
        }
    },
    unlink: {
        write(buf: SpecBuffer, success: boolean) {
            buf.writeFromSpecType("uint8", success ? 1 : 0);
        },
        read(buf: SpecBuffer) {
            return {
                success: Boolean(buf.readFromSpecType("uint8")),
            };
        }
    },
    rmdir: {
        write(buf: SpecBuffer, success: boolean) {
            buf.writeFromSpecType("uint8", success ? 1 : 0);
        },
        read(buf: SpecBuffer) {
            return {
                success: Boolean(buf.readFromSpecType("uint8")),
            };
        }
    },
    move: {
        write(buf: SpecBuffer, success: boolean) {
            buf.writeFromSpecType("uint8", success ? 1 : 0);
        },
        read(buf: SpecBuffer) {
            return {
                success: Boolean(buf.readFromSpecType("uint8")),
            };
        }
    },
    stat64: {
        write(buf: SpecBuffer, stat: StatOutput64) {
            storeUint64(buf, BigInt(stat.size));
            buf.writeFromSpecType("uint32", stat.mode);
            // buf.writeFromSpecType("uint32", stat.mtime);
            // buf.writeFromSpecType("uint32", stat.ctime);
            // buf.writeFromSpecType("uint32", stat.atime);
            storeUint64(buf, BigInt(stat.mtime));
            storeUint64(buf, BigInt(stat.ctime));
            storeUint64(buf, BigInt(stat.atime));
        },
        read(buf: SpecBuffer) {
            return {
                stat: {
                    size: readUint64(buf),
                    mode: Number(buf.readFromSpecType("uint32")) >>> 0,
                    mtime: readUint64(buf),
                    ctime: readUint64(buf),
                    atime: readUint64(buf)
                }
            };
        }
    },
} as { [K in keyof typeof opcode_map]: HandlerResponseMap[K] };

export const control_message = {
    read(buf: SpecBuffer) {
        const op_code = buf.read(1)[0];
        const op_name = (Object.keys(opcode_map) as Array<keyof typeof opcode_map>).find(key => opcode_map[key] === op_code)!;
        return {
            op_name,
            // message id
            id: (buf.readFromSpecType("uint32") as number) >>> 0,
        };
    },
    write(buf: SpecBuffer, op_name: keyof typeof opcode_map, id: number) {
        buf.writeFromSpecType("uint8", opcode_map[op_name]);
        buf.writeFromSpecType("uint32", id);
    }
}

type NewOptions = {
    mode: number,
};

type HandlerMap = {
    ls: {
        read(buf: SpecBuffer): { path: string };
        write(buf: SpecBuffer, path: string): void;
    };
    stat: {
        read(buf: SpecBuffer): { path: string };
        write(buf: SpecBuffer, path: string): void;
    };
    read: {
        read(buf: SpecBuffer): { path: string, start: number, end: number };
        write(buf: SpecBuffer, path: string, start: number, end: number): void;
    };
    write: {
        read(buf: SpecBuffer): { path: string, data: Uint8Array, offset: number };
        write(buf: SpecBuffer, path: string, data: Uint8Array, offset: number): void;
    };
    unlink: {
        read(buf: SpecBuffer): { path: string };
        write(buf: SpecBuffer, path: string): void;
    };
    new: {
        read(buf: SpecBuffer): { path: string, opt: NewOptions };
        write(buf: SpecBuffer, path: string, opt: NewOptions): void;
    };
    touch: {
        read(buf: SpecBuffer): {
            path: string, stat: StatOutput
        };
        write(buf: SpecBuffer, path: string, stat: StatOutput): void;
    };
    rmdir: {
        read(buf: SpecBuffer): { path: string };
        write(buf: SpecBuffer, path: string): void;
    };
    move: {
        read(buf: SpecBuffer): { src_path: string, dst_path: string };
        write(buf: SpecBuffer, src_path: string, dst_path: string): void;
    };
    stat64: HandlerMap["stat"];
};

export const spec = {
    ls: {
        read(buf: SpecBuffer) {
            return {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
            };
        },
        write(buf: SpecBuffer, path: string) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
        }
    },
    stat: {
        read(buf: SpecBuffer) {
            return {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
            };
        },
        write(buf: SpecBuffer, path: string) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
        }
    },
    new: {
        read(buf: SpecBuffer) {
            return {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
                opt: {
                    mode: Number(buf.readFromSpecType("uint32")) >>> 0,
                }
            };
        },
        write(buf: SpecBuffer, path: string, opt: NewOptions) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
            buf.writeFromSpecType("uint32", opt.mode);
        }
    },
    unlink: {
        read(buf: SpecBuffer) {
            return {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
            };
        },
        write(buf: SpecBuffer, path: string) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
        }
    },
    read: {
        read(buf: SpecBuffer) {
            return {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
                start: Number(buf.readFromSpecType("uint32")) >>> 0,
                end: Number(buf.readFromSpecType("uint32")) >>> 0,
            };
        },
        write(buf: SpecBuffer, path: string, start: number, end: number) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
            buf.writeFromSpecType("uint32", start);
            buf.writeFromSpecType("uint32", end);
        }
    },
    touch: {
        read(buf: SpecBuffer) {
            const obj = {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
                stat: {
                    size: Number(buf.readFromSpecType("uint32")) >>> 0,
                    mode: Number(buf.readFromSpecType("uint32")) >>> 0,
                    mtime: readUint64(buf),
                    ctime: readUint64(buf),
                    atime: readUint64(buf)
                } as StatOutput,
            };
            return obj;
        },
        write(buf: SpecBuffer, path: string, stat: StatOutput) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
            buf.writeFromSpecType("uint32", stat.size);
            buf.writeFromSpecType("uint32", stat.mode);
            storeUint64(buf, BigInt(stat.mtime));
            storeUint64(buf, BigInt(stat.ctime));
            storeUint64(buf, BigInt(stat.atime));
        }
    },
    write: {
        read(buf: SpecBuffer) {
            return {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
                data: buf.read(Number(buf.readFromSpecType("uint32")) >>> 0),
                offset: Number(buf.readFromSpecType("uint32")) >>> 0,
            };
        },
        write(buf: SpecBuffer, path: string, data: Uint8Array, offset: number) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
            buf.writeFromSpecType("uint32", data.byteLength);
            // for (let i = 0; i < data.byteLength; ++i) {
            //     buf.writeFromSpecType("uint8", data[i]);
            // }
            buf.emplaceIntoBuffer(data);
            buf.writeFromSpecType("uint32", offset);
        },
    },
    rmdir: {
        read(buf: SpecBuffer) {
            return {
                path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
            };
        },
        write(buf: SpecBuffer, path: string) {
            buf.writeFromSpecType("string", new TextEncoder().encode(path));
        }
    },
    move: {
        read(buf: SpecBuffer) {
            return {
                src_path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
                dst_path: new TextDecoder().decode(buf.readFromSpecType("string") as Uint8Array),
            };
        },
        write(buf: SpecBuffer, src_path: string, dst_path: string) {
            buf.writeFromSpecType("string", new TextEncoder().encode(src_path));
            buf.writeFromSpecType("string", new TextEncoder().encode(dst_path));
        }
    },
    get stat64() {
        return spec.stat;
    },
} as { [K in keyof typeof opcode_map]: HandlerMap[K] };
