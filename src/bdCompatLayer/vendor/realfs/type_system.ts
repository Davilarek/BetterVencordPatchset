// design rule: do not do anything for the user unless its necessary

export const oper_types = {
    "whole": 0x01, // consume all bytes
    "consume_n_bytes": 0x02,
    "concat_whole": 0x03,
}

export const type_maker = {
    make(name: string, byteLength: number | null, performOper: (buf: SpecBuffer) => Array<number>, endianness: "be" | "le" = "be") {
        return { name, byteLength, performOper, endianness };
    },
}

export class SpecBuffer {
    private buffer: Uint8Array;
    private offset: number;

    constructor(data?: ArrayBuffer | number[] | Uint8Array) {
        if (data instanceof ArrayBuffer) {
            this.buffer = new Uint8Array(data);
        } else if (Array.isArray(data)) {
            this.buffer = new Uint8Array(data);
        } else if (data instanceof Uint8Array) {
            this.buffer = data;
        } else {
            this.buffer = new Uint8Array(0);
        }
        this.offset = 0;
    }

    read(bytes: number): Uint8Array {
        if (this.offset + bytes > this.buffer.length) {
            throw new Error(`Not enough bytes in buffer. Requested: ${bytes}, Available: ${this.buffer.length - this.offset}`);
        }
        const result = this.buffer.slice(this.offset, this.offset + bytes);
        this.offset += bytes;
        return result;
    }

    throwOpError(operation: typeof oper_types[keyof typeof oper_types], message: string): never {
        const opName = (Object.keys(oper_types) as Array<keyof typeof oper_types>).find(k => oper_types[k] === operation);
        throw new Error(`Cannot use ${opName} operation: ${message}`);
    }

    readFromSpecType(typeName: string): number | Uint8Array {
        const typeSpec = spec_types.find(type => type.name === typeName);
        if (!typeSpec) {
            throw new Error(`Unknown type: ${typeName}`);
        }
        const readOper = typeSpec.performOper(this);

        if (Array.isArray(readOper)) {
            const [operType, ...params] = readOper;

            switch (operType) {
                case oper_types.whole:
                    if (typeSpec.byteLength === null)
                        this.throwOpError(oper_types.whole, 'variable-length types are not allowed.');
                    return this.read(typeSpec.byteLength);

                case oper_types.consume_n_bytes: {
                    const numBytes = params[0];
                    // console.log(numBytes);
                    if (typeof numBytes === 'number') {
                        return this.read(numBytes);
                    } else {
                        throw new Error(`Invalid parameter for consume_n_bytes operation: ${numBytes}`);
                    }
                }

                case oper_types.concat_whole: {
                    if (typeSpec.byteLength === null)
                        this.throwOpError(oper_types.concat_whole, 'variable-length types are not allowed.');
                    const bytesToRead = this.read(typeSpec.byteLength);
                    let result = 0;
                    if (typeSpec.endianness === "be") {
                        for (let i = 0; i < bytesToRead.length; i++) {
                            result = (result << 8) | bytesToRead[i];
                        }
                    } else {
                        for (let i = 0; i < bytesToRead.length; i++) {
                            result |= bytesToRead[i] << (i * 8);
                        }
                    }
                    return result;
                }

                default:
                    throw new Error(`Unsupported read operation: ${operType}`);
            }
        } else {
            throw new Error(`Invalid read operation for type ${typeName}`);
        }
    }

    writeFromSpecType(typeName: string, value: any) {
        const typeSpec = spec_types.find(type => type.name === typeName);
        if (!typeSpec) {
            throw new Error(`Unknown type: ${typeName}`);
        }
        const this_ = this;

        let valueAsBytes: Uint8Array | undefined;
        /*if (typeof value === 'string') {
            valueAsBytes = new TextEncoder().encode(value);
        } else*/
        if (value instanceof Uint8Array) {
            valueAsBytes = value;
        }

        const writeOper = typeSpec.performOper({
            readFromSpecType(prefixTypeName: string) {
                if (!valueAsBytes) {
                    throw new Error(`Cannot determine length for type '${typeName}' on a non-Uint8Array value.`);
                }
                const length = valueAsBytes.length;
                this_.writeFromSpecType(prefixTypeName, length);
                return length;
            }
        } as SpecBuffer);

        if (Array.isArray(writeOper)) {
            const [operType, ...params] = writeOper;

            switch (operType) {
                case oper_types.whole: {
                    if (typeSpec.byteLength === null)
                        this.throwOpError(oper_types.whole, 'variable-length types are not allowed.');
                    if (value instanceof Uint8Array) {
                        this.ensureCapacity(this.offset + typeSpec.byteLength);
                        this.buffer.set(value.subarray(0, typeSpec.byteLength), this.offset);
                        this.offset += typeSpec.byteLength;
                    } else {
                        throw new Error(`Expected Uint8Array for type ${typeName} with 'whole' operation`);
                    }
                    break;
                }
                case oper_types.consume_n_bytes: {
                    const numBytes = params[0];
                    if (typeof numBytes !== 'number') {
                        throw new Error(`Invalid parameter for consume_n_bytes operation: ${params[0]}`);
                    }

                    if (!valueAsBytes) {
                        throw new Error(`Expected string or Uint8Array for 'consume_n_bytes' operation, but got ${typeof value}`);
                    }

                    this.ensureCapacity(this.offset + numBytes);
                    this.buffer.set(valueAsBytes.subarray(0, numBytes), this.offset);
                    this.offset += numBytes;
                    break;
                }
                case oper_types.concat_whole: {
                    if (typeSpec.byteLength === null)
                        this.throwOpError(oper_types.concat_whole, 'variable-length types are not allowed.');
                    if (typeof value === 'number') {
                        this.ensureCapacity(this.offset + typeSpec.byteLength);

                        if (typeSpec.endianness === "be") {
                            for (let i = typeSpec.byteLength - 1; i >= 0; i--) {
                                this.buffer[this.offset + i] = value & 0xFF;
                                value = value >> 8;
                            }
                        } else {
                            for (let i = 0; i < typeSpec.byteLength; i++) {
                                this.buffer[this.offset + i] = value & 0xFF;
                                value = value >> 8;
                            }
                        }
                        this.offset += typeSpec.byteLength;
                    } else {
                        throw new Error(`Expected number for type ${typeName} with 'concat_whole' operation`);
                    }
                    break;
                }

                default:
                    throw new Error(`Unsupported write operation: ${operType}`);
            }
        } else {
            throw new Error(`Invalid write operation for type ${typeName}`);
        }
    }

    private ensureCapacity(requiredSize: number) {
        if (this.buffer.length < requiredSize) {
            const newBuffer = new Uint8Array(Math.max(requiredSize * 2, this.buffer.length * 2));
            newBuffer.set(this.buffer, 0);
            this.buffer = newBuffer;
        }
    }

    getBuffer(): Uint8Array {
        return this.buffer;
    }

    getOffset(): number {
        return this.offset;
    }

    hasRemaining(): boolean {
        return this.offset < this.buffer.length;
    }

    remaining(): number {
        return this.buffer.length - this.offset;
    }

    reset(): void {
        this.offset = 0;
    }

    setOffset(offset: number): void {
        if (offset < 0 || offset > this.buffer.length) {
            throw new Error(`Invalid offset: ${offset}. Buffer length: ${this.buffer.length}`);
        }
        this.offset = offset;
    }

    emplaceIntoBuffer(buffer: Uint8Array): void {
        this.ensureCapacity(this.offset + buffer.byteLength);
        this.buffer.set(buffer, this.offset);
        this.offset += buffer.byteLength;
    }

    setExactSize(size: number) {
        const newBuffer = new Uint8Array(size);
        newBuffer.set(this.buffer, 0);
        this.buffer = newBuffer;
    }

    appendToBuffer(buffer: Uint8Array): void {
        const currentEnd = this.buffer.length;
        this.setExactSize(currentEnd + buffer.byteLength);
        this.buffer.set(buffer, currentEnd);
    }
}

export function createConcatWholeOper(): (buf: SpecBuffer) => number[] {
    return () => [oper_types.concat_whole];
}

export function createDefaultOper(): (buf: SpecBuffer) => number[] {
    return () => [oper_types.whole];
}

export const spec_types = [
    type_maker.make("uint8", 1, createConcatWholeOper()),
    type_maker.make("uint16", 2, createConcatWholeOper()),
    type_maker.make("uint32", 4, createConcatWholeOper()),
    // note: uint64 values > Number.MAX_SAFE_INTEGER may lose precision. you should make your own type for cases where that's unacceptable.
    type_maker.make("uint64", 8, createConcatWholeOper()),
    type_maker.make("string", null, (buf: SpecBuffer) => {
        return [oper_types.consume_n_bytes, buf.readFromSpecType("uint32") as number];
    }),
];
