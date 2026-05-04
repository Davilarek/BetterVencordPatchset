/*
 * This file is part of BetterVencord.
 * Copyright (c) 2026 Davilarek
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

function isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '$' || ch === '_';
}
function isIdentPart(ch: string): boolean {
    return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}
function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
function isDecDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}
function isHexDigit(ch: string): boolean {
    return isDecDigit(ch) || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F');
}
const CTRL_KW = new Set([
    'if', 'while', 'for', 'switch', 'catch', 'with', 'of', 'in',
    'instanceof', 'typeof',
]);
const PARAM_KW = new Set(['function', 'get', 'set']);
// const DEBUG = (() => {
//     try { return !!Deno.env.get("DEBUG"); } catch { return false; }
// })();
const DEBUG = false;
function debugLog(...args: unknown[]): void {
    if (DEBUG) console.error("[stripper]", ...args);
}
export function stripTypeScript(input: string): string {
    return new Stripper(input).process();
}
const enum Syn {
    Code,
    StrSingle,
    StrDouble,
    Tmpl,
    LineCmt,
    BlockCmt,
    Regex,
}
interface StripDecl {
    kind: 'interface' | 'type' | 'importtype' | 'declare';
    braceDepth: number;
    finished: boolean;
}
class Stripper {
    private readonly input: string;
    private readonly out: string[] = [];
    private pos = 0;
    constructor(input: string) {
        this.input = input;
    }
    private syn: Syn = Syn.Code;
    // private strQuote = '';
    private tmplExprDepth = 0;
    private stripType = -1;
    private typeHasContent = false;
    private stripDecl: StripDecl | null = null;
    private stripGeneric = 0;
    private stripAs = 0;
    private stripAsDepth = 0;
    private expectVarType = false;
    private afterVarKw = false;
    private afterReturn = false;
    private afterExport = false; // TODO: handle properly later
    private afterClassKw = false;
    private justClosedParamList = false;
    private readonly parenCtx: Array<{ type: 'param' | 'expr'; braceDepth: number; hasTypes: boolean }> = [];
    private classBraceDepth = -1;
    private typeBraceDepth = -1;
    private braceDepth = 0;
    private lastCh = '';
    private lastIdent = '';
    private atLineStart = true;
    process(): string {
        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            debugLog("top  pos=%d ch=%q syn=%d stripType=%d stripDecl=%s stripGeneric=%d stripAs=%d",
                this.pos, ch, this.syn, this.stripType,
                this.stripDecl?.kind ?? "null", this.stripGeneric, this.stripAs);
            if (this.syn === Syn.Code) {
                if (ch === "'" || ch === '"') {
                    if (this.stripDecl !== null) {
                        this.handleStripDecl(ch);
                        if (this.stripDecl?.finished) {
                            if (this.pos < this.input.length && this.input[this.pos] === '\\n') {
                                this.atLineStart = true;
                            }
                            this.stripDecl = null;
                        }
                        continue;
                    }
                    this.syn = ch === "'" ? Syn.StrSingle : Syn.StrDouble;
                    // this.strQuote = ch;
                    this.escaped = false;
                    this.write(ch);
                    this.pos++;
                    continue;
                }
                if (ch === '`') {
                    if (this.stripDecl !== null) {
                        this.handleStripDecl(ch);
                        if (this.stripDecl?.finished) {
                            if (this.pos < this.input.length && this.input[this.pos] === '\\n') {
                                this.atLineStart = true;
                            }
                            this.stripDecl = null;
                        }
                        continue;
                    }
                    this.syn = Syn.Tmpl;
                    this.escaped = false;
                    this.write(ch);
                    this.pos++;
                    continue;
                }
                if (ch === '/' && this.pos + 1 < this.input.length) {
                    const n = this.input[this.pos + 1];
                    if (n === '/') {
                        this.syn = Syn.LineCmt;
                        this.out.push('/');
                        this.pos++;
                        continue;
                    }
                    if (n === '*') {
                        this.syn = Syn.BlockCmt;
                        this.out.push('/');
                        this.pos++;
                        continue;
                    }
                    if (this.isRegexStart(this.pos)) {
                        this.syn = Syn.Regex;
                        this.write(ch);
                        this.pos++;
                        continue;
                    }
                }
            } else {
                this.handleInsideLiteral(ch);
                continue;
            }
            if (this.stripType >= 0) {
                this.handleStripType(ch);
                this.pos++;
                continue;
            }
            if (this.stripDecl !== null) {
                this.handleStripDecl(ch);
                if (this.stripDecl?.finished) {
                    debugLog("  decl %s finished", this.stripDecl.kind);
                    if (this.pos < this.input.length && this.input[this.pos] === '\n') {
                        this.atLineStart = true;
                    }
                    this.stripDecl = null;
                }
                continue;
            }
            if (this.stripGeneric > 0) {
                this.handleStripGeneric(ch);
                this.pos++;
                continue;
            }
            if (this.stripAs > 0) {
                this.handleStripAs(ch);
                this.pos++;
                continue;
            }
            this.processCodeChar();
        }
        return this.out.join('');
    }
    private write(s: string): void {
        this.out.push(s);
    }
    private trackChar(token: string): void {
        if (token.length === 0) return;
        if (isIdentStart(token[0])) {
            this.lastIdent = token;
        } else {
            this.lastIdent = '';
        }
        const last = token[token.length - 1];
        this.lastCh = last;
        if (last === '\n') {
            this.atLineStart = true;
        } else if (!isWhitespace(last)) {
            this.atLineStart = false;
        }
    }
    private escaped = false;
    private handleInsideLiteral(ch: string): void {
        switch (this.syn) {
            case Syn.StrSingle:
                this.write(ch);
                if (ch === "'" && !this.escaped) this.syn = Syn.Code;
                this.escaped = ch === '\\' && !this.escaped;
                this.trackChar(ch);
                this.pos++;
                return;
            case Syn.StrDouble:
                this.write(ch);
                if (ch === '"' && !this.escaped) this.syn = Syn.Code;
                this.escaped = ch === '\\' && !this.escaped;
                this.trackChar(ch);
                this.pos++;
                return;
            case Syn.Tmpl:
                if (this.tmplExprDepth > 0) {
                    if (ch === '!' && (isIdentStart(this.lastCh) || this.lastCh === ')' || this.lastCh === ']') &&
                        !this.escaped) {
                        this.trackChar('!');
                        this.escaped = false;
                        this.pos++;
                        return;
                    }
                    if (ch === '`' && !this.escaped) {
                        this.syn = Syn.Code;
                        this.tmplExprDepth = 0;
                    } else if (ch === '{' && !this.escaped) {
                        this.tmplExprDepth++;
                    } else if (ch === '}') {
                        if (this.tmplExprDepth > 0) this.tmplExprDepth--;
                    }
                    this.escaped = ch === '\\' && !this.escaped;
                    this.write(ch);
                    this.trackChar(ch);
                    this.pos++;
                    return;
                }
                this.write(ch);
                if (ch === '`' && !this.escaped) {
                    this.syn = Syn.Code;
                } else if (ch === '{' && this.lastCh === '$' && !this.escaped) {
                    this.tmplExprDepth++;
                } else if (ch === '}') {
                    if (this.tmplExprDepth > 0) this.tmplExprDepth--;
                }
                this.escaped = ch === '\\' && !this.escaped;
                this.trackChar(ch);
                this.pos++;
                return;
            case Syn.LineCmt:
                this.write(ch);
                if (ch === '\n') this.syn = Syn.Code;
                this.trackChar(ch);
                this.pos++;
                return;
            case Syn.BlockCmt: {
                this.write(ch);
                if (ch === '/' && this.lastCh === '*') this.syn = Syn.Code;
                this.trackChar(ch);
                this.pos++;
                return;
            }
            case Syn.Regex: {
                this.write(ch);
                if (ch === '/' && this.lastCh !== '\\') {
                    this.syn = Syn.Code;
                    while (this.pos + 1 < this.input.length &&
                        isIdentPart(this.input[this.pos + 1])) {
                        this.pos++;
                        this.write(this.input[this.pos]);
                    }
                }
                this.trackChar(ch);
                this.pos++;
                return;
            }
        }
    }
    private isRegexStart(pos: number): boolean {
        if (pos === 0) return true;
        let i = pos - 1;
        while (i >= 0 && isWhitespace(this.input[i])) i--;
        if (i < 0) return true;
        const c = this.input[i];
        if ('=(,:?!~+-*/%&|^<>;{['.includes(c)) return true;
        if (c === '(' || c === '[') return true;
        if (isIdentPart(c)) {
            let end = i;
            while (i >= 0 && isIdentPart(this.input[i])) i--;
            i++;
            const word = this.input.slice(i, end + 1);
            if (['return', 'case', 'typeof', 'void', 'delete', 'in',
                'instanceof', 'new', 'throw', 'yield', 'await',
                'do', 'else', 'finally'].includes(word)) return true;
            return false;
        }
        if (c === ')' || c === ']') return false;
        return false;
    }
    private handleStripType(ch: string): void {
        debugLog("  stripType depth=%d ch=%q", this.stripType, ch);
        if (ch === '{' && this.stripType === 0 && this.typeHasContent) {
            this.stripType = -1;
            this.pos--;
            debugLog("  stripType ended by { (has content), backtrack to %d", this.pos);
            return;
        }
        if (ch === '=' && this.pos + 1 < this.input.length &&
            this.input[this.pos + 1] === '>' && this.stripType === 0) {
            this.stripType = -1;
            this.pos--;
            debugLog("  stripType ended by =>, backtrack to %d", this.pos);
            return;
        }
        if (!isWhitespace(ch)) this.typeHasContent = true;
        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
            this.stripType++;
        } else if ((ch === ')' || ch === ']' || ch === '}' || ch === '>') && this.stripType > 0) {
            this.stripType--;
        } else if (ch === "'" || ch === '"') {
            const q = ch;
            this.pos++;
            while (this.pos < this.input.length && this.input[this.pos] !== q) {
                if (this.input[this.pos] === '\\') this.pos++;
                this.pos++;
            }
        } else if (ch === '`') {
            this.pos++;
            while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                if (this.input[this.pos] === '\\') this.pos++;
                if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                    this.input[this.pos + 1] === '{') {
                    this.pos++;
                    let d = 1;
                    while (d > 0 && this.pos < this.input.length) {
                        this.pos++;
                        if (this.input[this.pos] === '{') d++;
                        else if (this.input[this.pos] === '}') d--;
                    }
                }
                this.pos++;
            }
        }
        if (this.stripType === 0) {
            if (',)=;:'.includes(ch)) {
                this.stripType = -1;
                this.pos--;
                debugLog("  stripType done, backtrack to %d", this.pos);
                return;
            }
        }
    }
    private handleStripDecl(ch: string): void {
        const d = this.stripDecl!;
        debugLog("  stripDecl kind=%s braceDepth=%d ch=%q", d.kind, d.braceDepth, ch);
        if (d.finished) { this.pos++; return; }
        if (d.kind === 'importtype') {
            if (ch === ';') {
                d.finished = true;
                this.pos++;
                return;
            }
            if (ch === "'" || ch === '"') {
                const q = ch;
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== q) {
                    if (this.input[this.pos] === '\\') this.pos++;
                    this.pos++;
                }
                this.pos++;
                return;
            }
            if (ch === '`') {
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                    if (this.input[this.pos] === '\\') this.pos++;
                    if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                        this.input[this.pos + 1] === '{') {
                        this.pos++;
                        let d2 = 1;
                        while (d2 > 0 && this.pos < this.input.length) {
                            this.pos++;
                            if (this.input[this.pos] === '{') d2++;
                            else if (this.input[this.pos] === '}') d2--;
                        }
                    }
                    this.pos++;
                }
                this.pos++;
                return;
            }
            this.pos++;
            return;
        }
        if (d.kind === 'interface' || d.kind === 'type') {
            if (ch === '{') {
                d.braceDepth++;
                this.pos++;
                return;
            }
            if (ch === '}') {
                d.braceDepth--;
                this.pos++;
                if (d.braceDepth === 0) {
                    d.finished = true;
                }
                return;
            }
            if (ch === ';' && d.braceDepth === 0) {
                d.finished = true;
                this.pos++;
                return;
            }
            if (ch === "'" || ch === '"') {
                const q = ch;
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== q) {
                    if (this.input[this.pos] === '\\') this.pos++;
                    this.pos++;
                }
                this.pos++;
                return;
            }
            if (ch === '`') {
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                    if (this.input[this.pos] === '\\') this.pos++;
                    if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                        this.input[this.pos + 1] === '{') {
                        this.pos++;
                        let d2 = 1;
                        while (d2 > 0 && this.pos < this.input.length) {
                            this.pos++;
                            if (this.input[this.pos] === '{') d2++;
                            else if (this.input[this.pos] === '}') d2--;
                        }
                    }
                    this.pos++;
                }
                this.pos++;
                return;
            }
            this.pos++;
            return;
        }
        if (d.kind === 'declare') {
            if (ch === '{') {
                d.braceDepth++;
                this.pos++;
                return;
            }
            if (ch === '}') {
                d.braceDepth--;
                this.pos++;
                if (d.braceDepth === 0 && this.lastCh !== undefined) {
                    d.finished = true;
                }
                return;
            }
            if (ch === ';' && d.braceDepth === 0) {
                d.finished = true;
                this.pos++;
                return;
            }
            if (ch === "'" || ch === '"') {
                const q = ch;
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== q) {
                    if (this.input[this.pos] === '\\') this.pos++;
                    this.pos++;
                }
                this.pos++;
                return;
            }
            this.pos++;
            return;
        }
    }
    private handleStripGeneric(ch: string): void {
        debugLog("  stripGeneric depth=%d ch=%q", this.stripGeneric, ch);
        if (ch === '<') {
            this.stripGeneric++;
        } else if (ch === '>') {
            this.stripGeneric--;
            if (this.stripGeneric <= 0) {
                this.stripGeneric = 0;
                this.pos++;
                return;
            }
        } else if (ch === "'" || ch === '"') {
            const q = ch;
            this.pos++;
            while (this.pos < this.input.length && this.input[this.pos] !== q) {
                if (this.input[this.pos] === '\\') this.pos++;
                this.pos++;
            }
        } else if (ch === '`') {
            this.pos++;
            while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                if (this.input[this.pos] === '\\') this.pos++;
                if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                    this.input[this.pos + 1] === '{') {
                    this.pos++;
                    let d = 1;
                    while (d > 0 && this.pos < this.input.length) {
                        this.pos++;
                        if (this.input[this.pos] === '{') d++;
                        else if (this.input[this.pos] === '}') d--;
                    }
                }
                this.pos++;
            }
        }
    }
    private handleStripAs(ch: string): void {
        debugLog("  stripAs phase=%d depth=%d ch=%q", this.stripAs, this.stripAsDepth, ch);
        if (this.stripAs === 1) {
            if (isWhitespace(ch)) return;
            this.stripAs = 2;
        }
        if (this.stripAs === 2) {
            if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
                this.stripAsDepth++;
            } else if ((ch === ')' || ch === ']' || ch === '}' || ch === '>') && this.stripAsDepth > 0) {
                if (!(ch === '>' && this.pos > 0 && this.input[this.pos - 1] === '=')) {
                    this.stripAsDepth--;
                }
                if (this.stripAsDepth === 0) return;
            } else if (ch === "'" || ch === '"') {
                const q = ch;
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== q) {
                    if (this.input[this.pos] === '\\') this.pos++;
                    this.pos++;
                }
                return;
            } else if (ch === '`') {
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                    if (this.input[this.pos] === '\\') this.pos++;
                    if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                        this.input[this.pos + 1] === '{') {
                        this.pos++;
                        let d = 1;
                        while (d > 0 && this.pos < this.input.length) {
                            this.pos++;
                            if (this.input[this.pos] === '{') d++;
                            else if (this.input[this.pos] === '}') d--;
                        }
                    }
                    this.pos++;
                }
                return;
            }
            if (this.stripAsDepth === 0) {
                if (isWhitespace(ch)) return;
                if (ch === '=' && this.pos + 1 < this.input.length &&
                    this.input[this.pos + 1] === '>') {
                    return;
                }
                if (',);:}=]'.includes(ch)) {
                    this.stripAs = 0;
                    this.pos--;
                    debugLog("  stripAs done, backtrack to %d", this.pos);
                    return;
                }
                if (isIdentPart(ch)) return;
                return;
            }
            return;
        }
    }
    private processCodeChar(): void {
        const ch = this.input[this.pos];
        debugLog("  codeChar ch=%q pos=%d", ch, this.pos);
        if (isIdentStart(ch)) {
            const start = this.pos;
            this.pos++;
            while (this.pos < this.input.length && isIdentPart(this.input[this.pos])) {
                this.pos++;
            }
            const ident = this.input.slice(start, this.pos);
            debugLog("  ident %s", ident);
            if (ident === 'interface' && this.isAtStmtStart()) {
                debugLog("  strip int");
                this.skipWsAndComments();
                if (this.pos < this.input.length && isIdentStart(this.input[this.pos])) {
                    this.pos++;
                    while (this.pos < this.input.length && isIdentPart(this.input[this.pos])) this.pos++;
                }
                this.skipWsAndComments();
                if (this.pos < this.input.length && this.input[this.pos] === '<') {
                    this.skipAngle();
                }
                this.skipWsAndComments();
                if (this.pos + 7 <= this.input.length &&
                    this.input.slice(this.pos, this.pos + 7) === 'extends') {
                    this.pos += 7;
                    this.skipToCurlyOrSemi();
                } else if (this.pos + 10 <= this.input.length &&
                    this.input.slice(this.pos, this.pos + 10) === 'implements') {
                    this.pos += 10;
                    this.skipToCurlyOrSemi();
                }
                this.skipWsAndComments();
                if (this.pos < this.input.length && this.input[this.pos] === '{') {
                    this.stripDecl = { kind: 'interface', braceDepth: 1, finished: false };
                    this.pos++;
                    this.trackChar('{');
                    return;
                }
                if (this.pos < this.input.length && this.input[this.pos] === ';') {
                    this.pos++;
                    this.trackChar(';');
                    return;
                }
                return;
            }
            if (ident === 'type' && this.isAtStmtStart()) {
                debugLog("  stripping type alias");
                this.skipWsAndComments();
                if (this.pos < this.input.length && isIdentStart(this.input[this.pos])) {
                    this.pos++;
                    while (this.pos < this.input.length && isIdentPart(this.input[this.pos])) this.pos++;
                }
                this.skipWsAndComments();
                if (this.pos < this.input.length && this.input[this.pos] === '<') {
                    this.skipAngle();
                }
                this.skipWsAndComments();
                if (this.pos < this.input.length && this.input[this.pos] === '=') {
                    this.pos++;
                }
                this.skipWsAndComments();
                if (this.pos < this.input.length && this.input[this.pos] === '{') {
                    this.stripDecl = { kind: 'type', braceDepth: 1, finished: false };
                    this.pos++;
                    this.trackChar('{');
                    return;
                }
                this.stripDecl = { kind: 'type', braceDepth: 0, finished: false };
                this.trackChar(';');
                return;
            }
            if (ident === 'import') {
                const savedPos = this.pos;
                let p = this.pos;
                while (p < this.input.length && isWhitespace(this.input[p])) p++;
                if (p + 4 <= this.input.length &&
                    this.input.slice(p, p + 4) === 'type') {
                    debugLog("  stripping import type");
                    this.pos = p + 4;
                    this.stripDecl = { kind: 'importtype', braceDepth: 0, finished: false };
                    this.trackChar(';');
                    return;
                }
                this.pos = savedPos;
                this.write(ident);
                this.trackChar(ident);
                this.afterExport = false;
                this.afterVarKw = false;
                this.afterReturn = false;
                return;
            }
            if (ident === 'export') {
                this.afterExport = true;
                const savedPos = this.pos;
                let p = this.pos;
                while (p < this.input.length && isWhitespace(this.input[p])) p++;
                if (p + 4 <= this.input.length &&
                    this.input.slice(p, p + 4) === 'type') {
                    this.pos = p + 4;
                    while (this.pos < this.input.length &&
                        isWhitespace(this.input[this.pos])) this.pos++;
                    if (this.pos < this.input.length && this.input[this.pos] === '{') {
                        this.stripDecl = { kind: 'importtype', braceDepth: 0, finished: false };
                        this.trackChar('}');
                        return;
                    }
                    this.stripDecl = { kind: 'type', braceDepth: 0, finished: false };
                    this.trackChar(';');
                    return;
                }
                this.pos = savedPos;
                this.write(ident);
                this.trackChar(ident);
                return;
            }
            if (ident === 'declare') {
                debugLog("  stripping declare");
                this.stripDecl = { kind: 'declare', braceDepth: 0, finished: false };
                this.trackChar(';');
                return;
            }
            if (ident === 'public' || ident === 'private' || ident === 'protected' ||
                ident === 'readonly' || ident === 'abstract' || ident === 'override') {
                debugLog("  skipping modifier %s", ident);
                if (ident === 'abstract') {
                }
                this.trackChar(ident);
                return;
            }
            if (ident === 'const' || ident === 'let' || ident === 'var') {
                const savedPos = this.pos;
                let p = this.pos;
                while (p < this.input.length && isWhitespace(this.input[p])) p++;
                if (p + 4 <= this.input.length &&
                    this.input.slice(p, p + 4) === 'enum') {
                    this.pos = savedPos;
                }
                this.write(ident);
                this.trackChar(ident);
                this.afterVarKw = true;
                this.afterExport = false;
                this.afterReturn = false;
                return;
            }
            if (ident === 'return') {
                this.write(ident);
                this.trackChar(ident);
                this.afterReturn = true;
                this.afterVarKw = false;
                this.afterExport = false;
                return;
            }
            if (ident === 'as') {
                debugLog("  starting as type assertion");
                this.stripAs = 1;
                this.trackChar(ident);
                return;
            }
            if (ident === 'satisfies') {
                debugLog("  starting satisfies type");
                this.stripAs = 1;
                this.trackChar(ident);
                return;
            }
            if (ident === 'class') {
                this.write(ident);
                this.trackChar(ident);
                this.afterClassKw = true;
                this.afterExport = false;
                return;
            }
            if (ident === 'static') {
                this.write(ident);
                this.trackChar(ident);
                this.afterExport = false;
                return;
            }
            this.write(ident);
            this.trackChar(ident);
            this.afterExport = false;
            if (this.afterVarKw) {
                this.expectVarType = true;
                this.afterVarKw = false;
            }
            this.afterReturn = false;
            return;
        }
        if (ch === ':') {
            if (this.shouldStripColonType()) {
                debugLog("  colon starts type annotation");
                this.stripType = 0;
                this.typeHasContent = false;
                this.trackChar(':');
                this.expectVarType = false;
                this.afterReturn = false;
                this.afterExport = false;
                this.pos++;
                return;
            }
            this.write(':');
            this.trackChar(':');
            this.expectVarType = false;
            this.afterReturn = false;
            this.afterExport = false;
            this.pos++;
            return;
        }
        if (ch === '?') {
            if (this.isOptionalPosition()) {
                debugLog("  stripping optional ?");
                this.lastCh = '?';
                this.pos++;
                return;
            }
            this.write('?');
            this.trackChar('?');
            this.expectVarType = false;
            this.pos++;
            return;
        }
        if (ch === '!') {
            if (this.isNonNullPosition()) {
                if (this.pos + 1 < this.input.length &&
                    this.input[this.pos + 1] === '=') {
                    this.write('!');
                    this.trackChar('!');
                    return;
                }
                debugLog("  stripping non-null assertion !");
                this.trackChar('!');
                this.pos++;
                return;
            }
            this.write('!');
            this.trackChar('!');
            this.pos++;
            return;
        }
        if (ch === '<') {
            if (this.isGenericPosition()) {
                debugLog("  trying generic <...>");
                if (this.eatGeneric()) {
                    this.trackChar('>');
                    return;
                }
                debugLog("  generic match failed");
            }
            this.write('<');
            this.trackChar('<');
            this.expectVarType = false;
            this.afterReturn = false;
            this.pos++;
            return;
        }
        if (ch === '(') {
            const isParam = this.isParamListParen();
            this.parenCtx.push({ type: isParam ? 'param' : 'expr', braceDepth: this.braceDepth, hasTypes: false });
            debugLog("  ( push ctx=%s depth=%d", isParam ? 'param' : 'expr', this.parenCtx.length);
            this.write('(');
            this.trackChar('(');
            this.expectVarType = false;
            this.afterReturn = false;
            this.afterExport = false;
            this.pos++;
            return;
        }
        if (ch === ')') {
            this.justClosedParamList = false;
            if (this.parenCtx.length > 0) {
                const ctx = this.parenCtx.pop()!;
                if (ctx.type === 'param' || ctx.hasTypes) this.justClosedParamList = true;
                debugLog("  ) pop ctx=%s", ctx);
            }
            this.write(')');
            this.trackChar(')');
            this.expectVarType = false;
            this.afterReturn = false;
            this.afterExport = false;
            this.pos++;
            return;
        }
        if (ch === '{') {
            this.braceDepth++;
            if (this.afterClassKw) {
                this.classBraceDepth = this.braceDepth;
                this.afterClassKw = false;
                debugLog("  { class body at depth %d", this.braceDepth);
            }
            this.expectVarType = false;
            this.afterVarKw = false;
            this.write('{');
            this.trackChar('{');
            this.afterReturn = false;
            this.afterExport = false;
            this.justClosedParamList = false;
            this.pos++;
            return;
        }
        if (ch === '}') {
            if (this.classBraceDepth === this.braceDepth) {
                debugLog("  } exit class body");
                this.classBraceDepth = -1;
            }
            if (this.typeBraceDepth === this.braceDepth) {
                this.typeBraceDepth = -1;
            }
            this.braceDepth--;
            this.write('}');
            this.trackChar('}');
            this.expectVarType = false;
            this.afterReturn = false;
            this.afterExport = false;
            this.pos++;
            return;
        }
        if (isDecDigit(ch) || (ch === '.' && this.pos + 1 < this.input.length &&
            isDecDigit(this.input[this.pos + 1]))) {
            this.readNumber();
            return;
        }
        this.write(ch);
        this.trackChar(ch);
        if (ch === ';' || ch === ',') {
            this.expectVarType = false;
            this.afterVarKw = false;
            this.afterReturn = false;
            this.afterExport = false;
        } else if (ch === '=') {
            this.expectVarType = false;
            this.afterVarKw = false;
            this.afterReturn = false;
            this.afterExport = false;
        }
        this.pos++;
    }
    private shouldStripColonType(): boolean {
        if (this.typeBraceDepth >= 0) {
            debugLog("  : inside type body");
            return true;
        }
        if (this.expectVarType) {
            debugLog("  : after var decl");
            return true;
        }
        if (this.parenCtx.length > 0 && this.parenCtx[this.parenCtx.length - 1].type === 'param') {
            if (this.lastIdent.length > 0 || this.lastCh === ')' || this.lastCh === '.' ||
                this.lastCh === '}') {
                debugLog("  : in param list (last=%s)", this.lastCh);
                return true;
            }
        }
        if (this.justClosedParamList) {
            this.justClosedParamList = false;
            debugLog("  : after param list )");
            return true;
        }
        if (this.parenCtx.length > 0) {
            const pctx = this.parenCtx[this.parenCtx.length - 1];
            if (this.braceDepth === pctx.braceDepth && this.lastIdent.length > 0) {
                pctx.hasTypes = true;
                debugLog("  : arrow param in paren (brace=%d)", this.braceDepth);
                return true;
            }
        }
        if (this.classBraceDepth >= 0 && this.braceDepth === this.classBraceDepth &&
            this.lastIdent.length > 0) {
            debugLog("  : class property (depth=%d classDepth=%d)", this.braceDepth, this.classBraceDepth);
            return true;
        }
        return false;
    }
    private isOptionalPosition(): boolean {
        if (this.parenCtx.length > 0 && this.parenCtx[this.parenCtx.length - 1].type === 'param' &&
            this.lastIdent.length > 0) {
            return true;
        }
        if (this.classBraceDepth >= 0 && this.braceDepth === this.classBraceDepth &&
            this.lastIdent.length > 0) {
            return true;
        }
        return false;
    }
    private isNonNullPosition(): boolean {
        if (this.lastIdent.length > 0) return true;
        if (this.lastCh === ')' || this.lastCh === ']') return true;
        return false;
    }
    private isGenericPosition(): boolean {
        if (this.lastIdent.length > 0) return true;
        if (this.lastCh === ')') return true;
        if (this.lastCh === '>') return true;
        if (this.afterReturn) return true;
        if (this.lastCh === '=' || this.lastCh === ',' || this.lastCh === '(') return true;
        if ('!,~+-*/%&|^[?:'.includes(this.lastCh)) return true;
        if (this.lastCh === ' ' || this.lastCh === '	') {
            let scan = this.pos - 1;
            while (scan >= 0 && isWhitespace(this.input[scan])) scan--;
            if (scan >= 0 && (this.input[scan] === '=' || this.input[scan] === ',' ||
                this.input[scan] === '(')) return true;
            if (scan >= 0 && isIdentPart(this.input[scan])) return false;
        }
        return false;
    }
    private isParamListParen(): boolean {
        if (this.classBraceDepth >= 0 && this.braceDepth === this.classBraceDepth) {
            let i = this.pos - 1;
            while (i >= 0 && isWhitespace(this.input[i])) i--;
            if (i >= 0 && isIdentPart(this.input[i])) return true;
            if (i >= 0 && this.input[i] === '>') return true;
            return false;
        }
        if (this.classBraceDepth >= 0 && this.braceDepth > this.classBraceDepth) {
            return false;
        }
        let i = this.pos - 1;
        while (i >= 0) {
            const c = this.input[i];
            if (isWhitespace(c)) { i--; continue; }
            if (c === '/' && i > 0 && this.input[i - 1] === '*') {
                i -= 2;
                while (i >= 0) {
                    if (this.input[i] === '/' && i > 0 && this.input[i - 1] === '*') {
                        i -= 2; break;
                    }
                    i--;
                }
                continue;
            }
            if (c === '/' && i > 0 && this.input[i - 1] === '/') {
                i -= 2;
                while (i >= 0 && this.input[i] !== '\n') i--;
                continue;
            }
            if (isIdentPart(c)) {
                let end = i;
                while (i >= 0 && isIdentPart(this.input[i])) i--;
                i++;
                const word = this.input.slice(i, end + 1);
                if (PARAM_KW.has(word)) return true;
                if (CTRL_KW.has(word)) return false;
                if (word === 'async') return true;
                if (word === 'new') return false;
                let j = i - 1;
                while (j >= 0 && isWhitespace(this.input[j])) j--;
                if (j >= 0 && isIdentPart(this.input[j])) {
                    let end2 = j;
                    while (j >= 0 && isIdentPart(this.input[j])) j--;
                    j++;
                    const word2 = this.input.slice(j, end2 + 1);
                    if (PARAM_KW.has(word2)) return true;
                    if (word2 === 'async') return true;
                }
                return false;
            }
            if (c === ')' || c === ']') return false;
            if (c === '}') return false;
            if (c === '{') return true;
            if (c === '(') {
                let j = i - 1;
                while (j >= 0 && isWhitespace(this.input[j])) j--;
                if (j >= 0 && isIdentPart(this.input[j])) {
                    const w = this.readIdentAt(j);
                    if (CTRL_KW.has(w)) return false;
                    return false;
                }
                return true;
            }
            return false;
        }
        return false;
    }
    private readIdentAt(pos: number): string {
        let end = pos;
        while (pos >= 0 && isIdentPart(this.input[pos])) pos--;
        pos++;
        return this.input.slice(pos, end + 1);
    }
    private eatGeneric(): boolean {
        const start = this.pos;
        this.pos++;
        let depth = 1;
        let hasContent = false;
        while (this.pos < this.input.length && depth > 0) {
            const c = this.input[this.pos];
            if (c === '<') {
                depth++;
                hasContent = true;
                this.pos++;
                continue;
            }
            if (c === '>') {
                depth--;
                if (depth === 0) {
                    this.pos++;
                    break;
                }
                this.pos++;
                continue;
            }
            if (c === "'" || c === '"') {
                hasContent = true;
                const q = c;
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== q) {
                    if (this.input[this.pos] === '\\') this.pos++;
                    this.pos++;
                }
                this.pos++;
                continue;
            }
            if (c === '`') {
                hasContent = true;
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                    if (this.input[this.pos] === '\\') this.pos++;
                    if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                        this.input[this.pos + 1] === '{') {
                        this.pos++;
                        let d = 1;
                        while (d > 0 && this.pos < this.input.length) {
                            this.pos++;
                            if (this.input[this.pos] === '{') d++;
                            else if (this.input[this.pos] === '}') d--;
                        }
                    }
                    this.pos++;
                }
                this.pos++;
                continue;
            }
            if (c === '(' || c === '[' || c === '{') {
                hasContent = true;
                const close = c === '(' ? ')' : c === '[' ? ']' : '}';
                this.pos++;
                let d = 1;
                while (d > 0 && this.pos < this.input.length) {
                    if (this.input[this.pos] === c) d++;
                    else if (this.input[this.pos] === close) d--;
                    if (d > 0) this.pos++;
                }
                this.pos++;
                continue;
            }
            if (!isWhitespace(c)) hasContent = true;
            this.pos++;
        }
        if (depth === 0 && hasContent) {
            debugLog("  generic matched");
            return true;
        }
        this.pos = start;
        return false;
    }
    private readNumber(): void {
        const start = this.pos;
        const ch = this.input[this.pos];
        if (ch === '0' && this.pos + 1 < this.input.length) {
            const n = this.input[this.pos + 1];
            if (n === 'x' || n === 'X') {
                this.pos += 2;
                this.write('0x');
                while (this.pos < this.input.length && isHexDigit(this.input[this.pos])) {
                    this.write(this.input[this.pos]);
                    this.pos++;
                }
                this.trackChar('0');
                return;
            }
            if (n === 'o' || n === 'O') {
                this.pos += 2;
                this.write('0o');
                while (this.pos < this.input.length &&
                    this.input[this.pos] >= '0' && this.input[this.pos] <= '7') {
                    this.write(this.input[this.pos]);
                    this.pos++;
                }
                this.trackChar('0');
                return;
            }
            if (n === 'b' || n === 'B') {
                this.pos += 2;
                this.write('0b');
                while (this.pos < this.input.length &&
                    (this.input[this.pos] === '0' || this.input[this.pos] === '1')) {
                    this.write(this.input[this.pos]);
                    this.pos++;
                }
                this.trackChar('0');
                return;
            }
        }
        while (this.pos < this.input.length &&
            (isDecDigit(this.input[this.pos]) || this.input[this.pos] === '.' ||
                this.input[this.pos] === '_' ||
                this.input[this.pos] === 'e' || this.input[this.pos] === 'E' ||
                this.input[this.pos] === 'n' ||
                (this.input[this.pos] === '-' || this.input[this.pos] === '+') &&
                this.pos > start && (this.input[this.pos - 1] === 'e' ||
                    this.input[this.pos - 1] === 'E'))) {
            this.write(this.input[this.pos]);
            this.pos++;
        }
        this.trackChar('0');
        this.expectVarType = false;
        this.afterReturn = false;
    }
    private isAtStmtStart(): boolean {
        return this.atLineStart || this.lastCh === '' || this.lastCh === ';' ||
            this.lastCh === undefined;
    }
    private skipWsAndComments(): void {
        while (this.pos < this.input.length) {
            const c = this.input[this.pos];
            if (isWhitespace(c)) { this.pos++; continue; }
            if (c === '/' && this.pos + 1 < this.input.length) {
                const n = this.input[this.pos + 1];
                if (n === '/') {
                    this.pos += 2;
                    while (this.pos < this.input.length && this.input[this.pos] !== '\n') this.pos++;
                    continue;
                }
                if (n === '*') {
                    this.pos += 2;
                    while (this.pos < this.input.length) {
                        if (this.input[this.pos] === '*' && this.pos + 1 < this.input.length &&
                            this.input[this.pos + 1] === '/') {
                            this.pos += 2;
                            break;
                        }
                        this.pos++;
                    }
                    continue;
                }
            }
            break;
        }
    }
    private skipToCurlyOrSemi(): void {
        this.skipWsAndComments();
        while (this.pos < this.input.length &&
            this.input[this.pos] !== '{' && this.input[this.pos] !== ';') {
            if (this.input[this.pos] === "'" || this.input[this.pos] === '"') {
                const q = this.input[this.pos];
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== q) {
                    if (this.input[this.pos] === '\\') this.pos++;
                    this.pos++;
                }
                this.pos++;
                continue;
            }
            if (this.input[this.pos] === '`') {
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                    if (this.input[this.pos] === '\\') this.pos++;
                    if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                        this.input[this.pos + 1] === '{') {
                        this.pos++;
                        let d = 1;
                        while (d > 0 && this.pos < this.input.length) {
                            this.pos++;
                            if (this.input[this.pos] === '{') d++;
                            else if (this.input[this.pos] === '}') d--;
                        }
                    }
                    this.pos++;
                }
                this.pos++;
                continue;
            }
            this.pos++;
        }
    }
    private skipAngle(): void {
        let depth = 1;
        this.pos++;
        while (this.pos < this.input.length && depth > 0) {
            const c = this.input[this.pos];
            if (c === '<') depth++;
            else if (c === '>') depth--;
            else if (c === "'" || c === '"') {
                const q = c;
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== q) {
                    if (this.input[this.pos] === '\\') this.pos++;
                    this.pos++;
                }
            } else if (c === '`') {
                this.pos++;
                while (this.pos < this.input.length && this.input[this.pos] !== '`') {
                    if (this.input[this.pos] === '\\') this.pos++;
                    if (this.input[this.pos] === '$' && this.pos + 1 < this.input.length &&
                        this.input[this.pos + 1] === '{') {
                        this.pos++;
                        let d = 1;
                        while (d > 0 && this.pos < this.input.length) {
                            this.pos++;
                            if (this.input[this.pos] === '{') d++;
                            else if (this.input[this.pos] === '}') d--;
                        }
                    }
                    this.pos++;
                }
            }
            if (depth > 0) this.pos++;
        }
        if (depth === 0) this.pos++;
    }
}
