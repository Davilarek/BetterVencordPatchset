import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

type Chunk = {
    changes: {
        type: "normal" | "del" | "add",
        content: string,
    }[],
    oldStart: number,
};

type File = {
    to: string,
    chunks: Chunk[],
};

const parseDiff = (input: string) => {
    if (!input || typeof input !== 'string') return [];

    const lines = input.split(/\r\n|\r|\n/);
    const files = [] as File[];
    let currentFile = null as null | File;
    let currentChunk = null as null | Chunk;

    const REGEX = {
        header: /^(diff\s|new\sfile|deleted\sfile|index\s)/,
        // +++ b/path/to/file
        toFile: /^\+\+\+\s+(.*)$/,
        // @@ -oldStart,oldLines +newStart,newLines @@
        chunk: /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
        // a/ and b/
        gitPrefix: /^[ab]\//
    };

    const parsePath = (rawPath: string) => {
        let path = rawPath.trim();
        const tabIndex = path.indexOf('\t');
        if (tabIndex > -1) path = path.substring(0, tabIndex);

        return REGEX.gitPrefix.test(path) ? path.substring(2) : path;
    };

    for (const line of lines) {
        if (REGEX.header.test(line)) {
            currentFile = null;
            currentChunk = null;
            continue;
        }

        const toMatch = line.match(REGEX.toFile);
        if (toMatch) {
            currentFile = {
                to: parsePath(toMatch[1]),
                chunks: []
            };
            files.push(currentFile);
            currentChunk = null;
            continue;
        }

        const chunkMatch = line.match(REGEX.chunk);
        if (chunkMatch) {
            if (!currentFile) {
                currentFile = { to: '/dev/null', chunks: [] };
                files.push(currentFile);
            }

            currentChunk = {
                oldStart: parseInt(chunkMatch[1], 10),
                changes: []
            };
            currentFile.chunks.push(currentChunk);
            continue;
        }

        if (currentChunk) {
            if (line.startsWith('+')) {
                currentChunk.changes.push({ type: 'add', content: line });
            } else if (line.startsWith('-')) {
                currentChunk.changes.push({ type: 'del', content: line });
            } else if (line.startsWith(' ')) {
                currentChunk.changes.push({ type: 'normal', content: line });
            } else if (line.startsWith('\\')) {
                currentChunk.changes.push({ type: 'normal', content: line });
            }
        }
    }

    return files;
};

const exec = promisify(execFile);

const execWithInheritedStdio = (command: string, args: string[], options: any = {}) => {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit", shell: true, ...options });
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
            }
            else {
                reject(new Error(`${command} exited with code ${code}`));
            }
        });
    })
};

async function fileExists(p: string) {
    try {
        await fs.access(p);
        return true;
    } catch (a) {
        return false;
    }
}

async function ensurePnpm() {
    try {
        console.log("checking pnpm...");
        await execWithInheritedStdio("pnpm", ["--version"]);
        console.log("done");
    } catch (err) {
        console.error(err instanceof Error ? err.stack || err.message : String(err));
        throw new Error("pnpm not installed");
    }
}

async function safeRmdir(dir: string) {
    if (await fileExists(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function copyDir(from: string, to: string) {
    await fs.mkdir(to, { recursive: true });
    const entries = await fs.readdir(from, { withFileTypes: true });

    for (const e of entries) {
        const src = path.join(from, e.name);
        const dst = path.join(to, e.name);
        if (e.name === ".git") continue;
        if (e.isDirectory()) {
            await copyDir(src, dst);
        } else {
            await fs.copyFile(src, dst);
        }
    }
}

async function readPatch(file: string) {
    const text = await fs.readFile(file, "utf8");
    return parseDiff(text);
}

async function applyParsedPatch(root: string, patches: ReturnType<typeof parseDiff>, workDir: string) {
    for (const p of patches) {
        const filePath = path.join(root, p.to.replace("dist/Vencord", "dist/" + workDir)); // TODO: maybe don't depend on p.to blindly?
        let original = "";

        try {
            original = await fs.readFile(filePath, "utf8");
        } catch {
            throw new Error(`Target file not found for patch: ${p.to}`);
        }

        const lines = original.split("\n");

        for (const chunk of p.chunks) {
            let cursor = chunk.oldStart - 1;

            for (const change of chunk.changes) {
                if (change.type === "del") {
                    lines.splice(cursor, 1);
                } else if (change.type === "add") {
                    lines.splice(cursor, 0, change.content.replace(/^\+ /, " ").replace(/^\+/, ""));
                    cursor++;
                } else {
                    cursor++;
                }
            }
        }

        await fs.writeFile(filePath, lines.join("\n"));
    }
}

async function gitHash(dir: string) {
    const { stdout } = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd: dir });
    return stdout.trim();
}

async function gitRemote(dir: string) {
    const { stdout } = await exec("git", ["remote", "get-url", "origin"], { cwd: dir });
    return stdout.trim()
        .replace("https://github.com/", "")
        .replace("git@github.com:", "")
        .replace(/.git$/, "");;
}

enum BuildTypes {
    UNIVERSAL,
    VENCORD,
    EQUICORD,
};

type PatchKind = {
    targetType: BuildTypes;
    file: string;
    targetFile: string;
};

const patches = [
    // Vencord Specific
    // {
    //     file: "src/patch-webpack.patch",
    //     targetFile: "src/webpack/patchWebpack.ts",
    //     targetType: BuildTypes.VENCORD,
    // },
    {
        file: "src/patch-package_json.patch",
        targetFile: "package.json",
        targetType: BuildTypes.VENCORD,
    },
    // Universal
    {
        file: "src/patch-csp.patch",
        targetFile: "src/main/csp/index.ts",
        targetType: BuildTypes.UNIVERSAL,
    },
    {
        file: "src/patch-banImportPlugin.patch",
        targetFile: "scripts/build/common.mjs",
        targetType: BuildTypes.UNIVERSAL,
    },
    // {
    //     file: "src/patch-updater.patch",
    //     targetFile: "src/main/updater/http.ts",
    //     targetType: BuildTypes.UNIVERSAL,
    // },
    // Equicord Specific
    // {
    //     file: "src/equicord/patch-webpack.patch",
    //     targetFile: "src/webpack/patchWebpack.ts",
    //     targetType: BuildTypes.EQUICORD,
    // },
    {
        file: "src/equicord/patch-package_json.patch",
        targetFile: "package.json",
        targetType: BuildTypes.EQUICORD,
    },
] as PatchKind[];

const selectPatch = (targetFile: string, forBuild: BuildTypes) => {
    const patch = patches.find(x => x.targetFile === targetFile && x.targetType === forBuild) ?? patches.find(x => x.targetFile === targetFile && x.targetType === BuildTypes.UNIVERSAL);
    return patch;
};

const buildTypeToPath = (forBuild: BuildTypes) => {
    switch (forBuild) {
        case BuildTypes.VENCORD:
            return "Vencord";
        case BuildTypes.EQUICORD:
            return "Equicord";
        default:
            throw new Error("impossible");
    }
};

if (process.argv.includes("--equicord")) {
    process.env.EQUICORD = "1";
}

const buildType = process.env.EQUICORD === "1" ? BuildTypes.EQUICORD : BuildTypes.VENCORD;

async function run() {
    await ensurePnpm();

    console.log("Warning: this will delete dist/. You have 5 seconds to cancel.");
    await new Promise(r => setTimeout(r, 5000));

    const builderHash = await gitHash(".");
    const builderRemote = await gitRemote(".");
    const workDir = buildTypeToPath(buildType);
    const baseDir = path.resolve("base/" + workDir);
    const distDir = path.resolve("dist/" + workDir);

    await safeRmdir("./dist");
    await fs.mkdir("./dist");
    await copyDir(baseDir, distDir);

    const baseHash = await gitHash(baseDir);

    const patchTargets = patches.map(x => x.targetFile).filter((x, i, a) => a.indexOf(x) == i).map(x => selectPatch(x, buildType));

    for (const item of patchTargets) {
        const diffParsed = await readPatch(item.file);
        try {
            await applyParsedPatch(".", diffParsed, workDir);
        } catch (e) {
            throw new Error(`Patch failed for ${item.targetFile}: ${(e as Error).message}`);
        }
    }

    await copyDir("src/bdCompatLayer", path.join(distDir, "src/plugins/bdCompatLayer"));
    console.log("now copying user plugins");
    await copyDir("src/userplugins", path.join(distDir, "src/userplugins"));

    await exec("git", ["init"], { cwd: distDir });
    await exec("git", ["remote", "add", "origin", "https://github.com/Vendicated/Vencord"], { cwd: distDir });

    await execWithInheritedStdio("pnpm", ["i"], { cwd: distDir });
    process.env.VENCORD_HASH = `${baseHash} (BetterVencord patchset built by ${builderHash})`;
    process.env.EQUICORD_HASH = process.env.VENCORD_HASH;
    process.env.BV_REMOTE = builderRemote;

    await execWithInheritedStdio("pnpm", ["build", "--standalone"], { cwd: distDir });
    await execWithInheritedStdio("pnpm", ["buildWeb"], { cwd: distDir });

    await fs.writeFile(`${distDir}/dist/package.json`, JSON.stringify({}));

    console.log("Build complete.");
    console.log("Base:", baseHash);
    console.log("Patchset:", builderHash);
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
