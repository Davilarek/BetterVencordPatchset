/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import { wreq } from "@webpack";
import { addLogger, compat_logger, evalInScope, findFirstLineWithoutX } from "./utils";
import { stripTypeScript } from "./stripper";

export const TARGET_HASH = "df5c2887eb5eddb8d9f3e470b51cdfa5cec814db";
// export const TARGET_CONTEXT_MENU_NEW_HASH = "c10d0b67c0fd53fee582cf5b8bc4779e80006983";
export const TARGET_CONTEXT_MENU_NEW_HASH = "v1.13.13";

export const FakeEventEmitter = class {
    callbacks: any;
    constructor() {
        this.callbacks = {};
    }

    on(event, cb) {
        if (!this.callbacks[event]) this.callbacks[event] = [];
        this.callbacks[event].push(cb);
    }

    off(event, cb) {
        const cbs = this.callbacks[event];
        if (cbs) {
            this.callbacks[event] = cbs.filter(callback => callback !== cb);
        }
    }

    emit(event, data) {
        const cbs = this.callbacks[event];
        if (cbs) {
            cbs.forEach(cb => cb(data));
        }
    }
};

export const addDiscordModules = async proxyUrl => {
    const context = {
        get WebpackModules() {
            return window.BdApi.Webpack;
        }
    };
    // const ModuleDataText = simpleGET(
    //     proxyUrl +
    //     `https://github.com/BetterDiscord/BetterDiscord/raw/${TARGET_HASH}/renderer/src/modules/discordmodules.js`
    // ).responseText.replaceAll("\r", "");
    // const request = await fetchWithCorsProxyFallback(`https://github.com/BetterDiscord/BetterDiscord/raw/${TARGET_HASH}/renderer/src/modules/discordmodules.js`, undefined, proxyUrl);
    const request = await fetchWithCorsProxyFallback(`https://github.com/BetterDiscord/BetterDiscord/raw/${TARGET_CONTEXT_MENU_NEW_HASH}/src/betterdiscord/modules/discordmodules.ts`, undefined, proxyUrl);
    const ModuleDataText = (await request.text()).replaceAll("\r", "");
    // const ev =
    //     "(" +
    //     (ModuleDataText.split("const DiscordModules = Utilities.memoizeObject(")[1]).split(/;\s*export default DiscordModules;/)[0];
    // // const sourceBlob = new Blob([ev], { type: "application/javascript" });
    // const sourceBlobUrl = URL.createObjectURL(sourceBlob);
    // return { output: evalInScope(ev + "\n//# sourceURL=" + sourceBlobUrl, context), sourceBlobUrl };

    let code = stripTypeScript(ModuleDataText);

    code = code.replace(/^\s*import\s+[^;]+;\s*/gm, '');
    code = code.replace(/\bexport\s+default\s+DiscordModules\s*;/g, 'DiscordModules;');

    code = "const {Filters, getBulkKeyed, getByKeys, getBySource, getByStrings, getModule} = WebpackModules;\nconst memoize=(t)=>t;\n" + code;

    return { output: evalInScope(code + "\n//# sourceURL=" + "betterDiscord://internal/DiscordModules.js", context), sourceBlobUrl: undefined };
};

function javascriptifyContextMenuModule(rawSourceCode: string) {
    let code = rawSourceCode;

    code = code.replace(/^\s*import\s+[^;]+;\s*/gm, '');
    code = code.replace(/\bexport\s+default\s+ContextMenu\s*;/g, 'return ContextMenu;');

    // function removeBlock(keyword: string, openChar: string, closeChar: string) {
    //     let start: number;
    //     while ((start = code.indexOf(keyword)) !== -1) {
    //         let openIdx = code.indexOf(openChar, start);
    //         if (openIdx === -1) break;

    //         let depth = 1;
    //         let currentIdx = openIdx + 1;

    //         while (currentIdx < code.length && depth > 0) {
    //             if (code[currentIdx] === openChar) depth++;
    //             if (code[currentIdx] === closeChar) depth--;
    //             currentIdx++;
    //         }
    //         code = code.substring(0, start) + code.substring(currentIdx);
    //     }
    // }
    // removeBlock('interface ', '{', '}');
    // code = code.replace(/^\s*type\s+[A-Za-z0-9_$]+\s*=.*?[;\n]/gm, '');
    // code = code.replace(/\s+as\s+[A-Za-z0-9_$.<>\[\]]+\b/g, '');
    // code = code.replace(/([A-Za-z0-9_$\)\]\}])!(?=[\s;,\)\}\].])/g, '$1');
    // code = code.replace(/\bprivate\s+static\b/g, 'static');
    // code = code.replace(/const\s+out\s*:\s*any\s*=/g, 'const out =');
    // code = code.replace(/static\s+patches\s*:\s*\{[\s\S]*?\}\s*=\s*\{/gm, 'static patches = {');
    // code = code.replace(/getLazyByKeys\s*<[\s\S]+?>\s*\(/g, 'getLazyByKeys(');
    // code = code.replace(/addInterceptor\s*<[\s\S]+?>\s*\(/g, 'addInterceptor(');
    // code = code.replace(/handleRender\s*<[\s\S]+?>\s*\(\s*Component\s*:\s*T\s*\)\s*:\s*T\s*\{/g, 'handleRender(Component) {');

    // const paramTypesToRemove = [
    //     "string \\| RegExp",
    //     "PatchCallback",
    //     "MouseEvent",
    //     "React\\.ComponentType<MenuRenderProps>",
    //     "React\\.ComponentType",
    //     "MenuConfig",
    //     "MenuRenderNode",
    //     "MenuRenderProps",
    //     "React\\.Component<MenuRenderProps>",
    //     "React\\.MouseEvent",
    //     "string",
    //     "any",
    //     "T"
    // ].join("|");
    // const paramRegex = new RegExp(`\\b([A-Za-z0-9_$]+)\\s*\\??\\s*:\\s*(?:${paramTypesToRemove})(?=\\s*[,)])`, 'g');
    // code = code.replace(paramRegex, '$1');

    code = stripTypeScript(code);
    code = code.trim() + '\n';
    const wrappedCode = `(function(Filters, getByKeys, getLazyByKeys, getMangled, getModule, webpackRequire, Logger, React, DiscordModules, NodePatcher, DOMManager) {
"use strict";
${code}
})`;
    return new Function(
        'Filters', 'getByKeys', 'getLazyByKeys', 'getMangled', 'getModule', 'webpackRequire',
        'Logger', 'React', 'DiscordModules', 'NodePatcher', 'DOMManager',
        `return ${wrappedCode}`
    );
}

function javascriptifyNodePatcherModule(rawSourceCode: string) {
    let code = rawSourceCode;
    // const literals = [];
    // code = code.replace(/(["'`])(?:(?=(\\?))\2.)*?\1|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, match => {
    //     if (match.startsWith('//') || match.startsWith('/*')) return '';
    //     const id = `___LITERAL_${literals.length}___`;
    //     literals.push(match);
    //     return id;
    // });
    code = code.replace(/^\s*import\s+[^;]+;\s*/gm, '');
    code = code.replace(/\bexport\s+default\s+class\s+NodePatcher\b/g, 'class NodePatcher');

    // code = code.replace(/^\s*type\s+[A-Za-z0-9_$]+\s*<.*?>\s*=.*?[;\n]/gm, '');

    // code = code.replace(/\bpublic\s+patch\b/g, 'patch');
    // code = code.replace(/\bpublic\s+destroy\b/g, 'destroy');

    // code = code.replace(/let\s+newType\s*:\s*React\.ComponentType<any>\s*=/g, 'let newType =');
    // code = code.replace(/new\s+WeakMap<React\.ComponentType<any>,\s*React\.ComponentType<any>>\(\)/g, 'new WeakMap()');
    // code = code.replace(/patch<P,\s*T\s*extends\s*React\.ComponentType<P>\s*=\s*React\.ComponentType<P>>\(/g, 'patch(');
    // code = code.replace(/getType<React\.FunctionComponent<P>,\s*P>\(/g, 'getType(');

    // code = code.replace(/node\s*:\s*React\.ReactElement<P,\s*T>/g, 'node');
    // code = code.replace(/callback\s*:\s*UnknownPatch<P>/g, 'callback');
    // code = code.replace(/\.\.\.args\s*:\s*\[props:\s*P\]/g, '...args');
    // code = code.replace(/component\s*:\s*React\.ComponentType<any>/g, 'component');
    // code = code.replace(/err\s*:\s*\{default:\s*React\.ComponentType<any>;\}/g, 'err');

    // code = code.replace(/\(callback\s+as\s+\(\(_:\s*P,\s*__:\s*React\.ReactNode\)\s*=>\s*React\.ReactNode\)\)/g, 'callback');

    // code = code.replace(/\s+as\s+React\.ComponentType<any>\s*\|\s*Promise<never>/g, '');
    // code = code.replace(/\s+as\s+React\.ComponentClass<P>/g, '');
    // code = code.replace(/\s+as\s+React\.FunctionComponent<P>/g, '');
    // code = code.replace(/\s+as\s+React\.ReactElement<P,\s*T>/g, '');
    // code = code.replace(/\s+as\s+unknown\b/g, '');
    // code = code.replace(/\s+as\s+any\b/g, '');
    // code = code.replace(/\s+as\s+T\b/g, '');
    // code = code.replace(/\s+as\s+0\b/g, '');
    // literals.forEach((str, index) => {
    //     code = code.replace(`___LITERAL_${index}___`, str);
    // });

    code = stripTypeScript(code);
    code = code.trim() + '\n\nreturn NodePatcher;\n';
    const wrappedCode = `(function(React, ReactUtils) {
"use strict";
${code}
})`;

    return new Function(
        'React', 'ReactUtils',
        `return ${wrappedCode}`
    );
}

export const addContextMenu = async (DiscordModules, proxyUrl) => {
    // /**
    //  * @type {string}
    //  */
    // const ModuleDataText = simpleGET(
    //     proxyUrl +
    //     `https://github.com/BetterDiscord/BetterDiscord/raw/${TARGET_HASH}/renderer/src/modules/api/contextmenu.js`
    // ).responseText.replaceAll("\r", "");
    const request = await fetchWithCorsProxyFallback(`https://github.com/BetterDiscord/BetterDiscord/raw/${TARGET_CONTEXT_MENU_NEW_HASH}/src/betterdiscord/api/contextmenu.ts`, undefined, proxyUrl);
    const ModuleDataText = (await request.text()).replaceAll("\r", "");
    /*
    const context = {
        get WebpackModules() {
            return window.BdApi.Webpack;
        },
        get Filters() {
            return window.BdApi.Webpack.Filters;
        },
        DiscordModules,
        get Patcher() {
            return window.BdApi.Patcher;
        }
    };
    const linesToRemove = findFirstLineWithoutX(
        ModuleDataText,
        "import"
    );
    // eslint-disable-next-line prefer-const
    let ModuleDataArr = ModuleDataText.split("\n");
    ModuleDataArr.splice(0, linesToRemove);
    ModuleDataArr.pop();
    ModuleDataArr.pop();
    // for (let i = 0; i < ModuleDataArr.length; i++) {
    //     const element = ModuleDataArr[i];
    //     if (element.trimStart().startsWith("Patcher.before(\"ContextMenuPatcher\", ")) {
    //         ModuleDataArr[i] = "debugger;" + element;
    //     }
    // }
    const ModuleDataAssembly =
        "(()=>{" +
        addLogger.toString() +
        ";const Logger = " + addLogger.name + "();const {React} = DiscordModules;" +
        ModuleDataArr.join("\n") +
        "\nreturn ContextMenu;})();";
    // const sourceBlob = new Blob([ModuleDataAssembly], {
    //     type: "application/javascript",
    // });
    // const sourceBlobUrl = URL.createObjectURL(sourceBlob);
    // const evaluatedContextMenu = evalInScope(ModuleDataAssembly + "\n//# sourceURL=" + sourceBlobUrl, context);
    const evaluatedContextMenu = evalInScope(ModuleDataAssembly + "\n//# sourceURL=" + "betterDiscord://internal/ContextMenu.js", context);
    // return { output: new evaluatedContextMenu(), sourceBlobUrl };
    return { output: new evaluatedContextMenu(), sourceBlobUrl: undefined };
    */
    const NodePatcher_request = await fetchWithCorsProxyFallback(`https://github.com/BetterDiscord/BetterDiscord/raw/${TARGET_CONTEXT_MENU_NEW_HASH}/src/betterdiscord/modules/nodepatcher.ts`, undefined, proxyUrl);
    const NodePatcher_ModuleDataText = (await NodePatcher_request.text()).replaceAll("\r", "");
    const evaluatedNodePatcher = javascriptifyNodePatcherModule(NodePatcher_ModuleDataText + "\n//# sourceURL=" + "betterDiscord://internal/NodePatcher.js")();
    const evaluatedContextMenu = javascriptifyContextMenuModule(ModuleDataText + "\n//# sourceURL=" + "betterDiscord://internal/ContextMenu.js")();
    return {
        // 'Filters', 'getByKeys', 'getLazyByKeys', 'getMangled', 'getModule', 'webpackRequire',
        // 'Logger', 'React', 'DiscordModules', 'NodePatcher', 'DOMManager',
        output: new (evaluatedContextMenu(
            window.BdApi.Webpack.Filters,
            window.BdApi.Webpack.getByKeys,
            window.BdApi.Webpack.getLazyByKeys,
            window.BdApi.Webpack.getMangled,
            window.BdApi.Webpack.getModule,
            wreq,
            window.BdApi.Logger,
            window.BdApi.React,
            DiscordModules,
            (evaluatedNodePatcher(window.BdApi.React, window.BdApi.ReactUtils)),
            window.BdApi.DOM,
        )),
        sourceBlobUrl: undefined,
    };
};

export async function fetchWithCorsProxyFallback(url: string, options: any = {}, corsProxy: string) {
    const reqId = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    try {
        compat_logger.debug(`[${reqId}] Requesting ${url}...`, options);
        const result = await fetch(url, options);
        compat_logger.debug(`[${reqId}] Success.`);
        return result;
    } catch (error) {
        if (options.method === undefined || options.method === "get") {
            compat_logger.debug(`[${reqId}] Failed, trying with proxy.`);
            try {
                const result = await fetch(`${corsProxy}${url}`, options);
                compat_logger.debug(`[${reqId}] (Proxy) Success.`);
                return result;
            } catch (error) {
                compat_logger.debug(`[${reqId}] (Proxy) Failed completely.`);
                throw error;
            }
        }
        compat_logger.debug(`[${reqId}] Failed completely.`);
        throw error;
    }
}

export { Patcher } from "./stuffFromBD";
