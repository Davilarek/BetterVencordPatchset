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

import { classNameFactory } from "@api/Styles";
import { FolderIcon, PlusIcon, RestartIcon } from "@components/Icons";
import { Button } from "@components/Button";
import { Text as BaseText } from "@components/Text";
import { Card } from "@components/Card";
import { Paragraph } from "@components/Paragraph";
import { QuickAction, QuickActionCard } from "@components/settings/QuickAction";
import { SettingsTab, wrapTab } from "@components/settings/tabs";
import { Plugin } from "@utils/types";
import { React, useState } from "@webpack/common";

import { PLUGIN_NAME } from "./constants";
import { getGlobalApi } from "./fakeBdApi";
import { addCustomPlugin, convertPlugin } from "./pluginConstructor";
import { compat_logger, FSUtils, readdirPromise, reloadCompatLayer, ZIPUtils } from "./utils";
import { TreeItem, TreeView } from "./treeView";
import { ComponentPropsWithoutRef } from "react";

type SettingsPlugin = Plugin & {
    customSections: ((ID: Record<string, unknown>) => any)[];
    customEntries: any[];
};

const TabName = "Virtual Filesystem";
const cl = classNameFactory("vc-bdcompat-fs-");

type MutedBaseTextProps = ComponentPropsWithoutRef<typeof BaseText>;

const MutedBaseText = ({ children, ...rest }: MutedBaseTextProps) => {
    return (
        <BaseText
            {...rest}
            style={{ color: "var(--text-muted)" }}
        >
            {children}
        </BaseText>
    );
};

const getChildren = (parentPath: string, items: FileSystemItem[]) => {
    const path = window.require("path");
    return items.filter(item => {
        const parentDir = parentPath === "/" ? "" : parentPath;
        const itemDir = path.dirname(item.path);
        return itemDir === parentDir && item.path !== parentPath;
    });
};

function fileSystemToTreeAdapter(
    items: FileSystemItem[],
    currentPath: string,
    expandedPaths: string[],
    selectedPath: string | null
): TreeItem<FileSystemItem>[] {
    const path = window.require("path");

    const createTreeItem = (item: FileSystemItem): TreeItem<FileSystemItem> => {
        const isExpanded = expandedPaths.includes(item.path);
        const isSelected = selectedPath === item.path;

        return {
            id: item.path,
            label: item.name,
            isDirectory: item.isDirectory,
            expanded: item.isDirectory ? isExpanded : undefined,
            selected: isSelected,
            metadata: item,
            children: item.isDirectory && isExpanded ?
                getChildren(item.path, items).map(createTreeItem) :
                (item.isDirectory ? [] : undefined)
        };
    };

    const rootItems = items.filter(item => {
        const itemDir = path.dirname(item.path);
        return itemDir === currentPath ||
            (currentPath === "/" && itemDir === "" || itemDir === "\\");
    });

    return rootItems.map(createTreeItem);
}

interface FileSystemItem {
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number;
    modified?: Date;
    type?: string;
}

const getDirectoryContents = async (path: string): Promise<FileSystemItem[]> => {
    const fs = window.require("fs");
    const path_ = window.require("path");

    try {
        // const items = await readdirPromise(path);
        const items = await fs.readdirSync(path);
        return Promise.all(items.map(async (item): Promise<FileSystemItem> => {
            const itemPath = path_.join(path, item);
            const stats = fs.statSync(itemPath);

            return {
                name: item,
                path: itemPath,
                isDirectory: stats.isDirectory(),
                size: stats.isFile() ? stats.size : undefined,
                modified: stats.mtime,
                type: stats.isDirectory()
                    ? "Folder"
                    : (item.split('.').pop() || "").toUpperCase() // lol who needs path.parse anyway?
            };
        }));
    } catch (error) {
        compat_logger.error(`Failed to read directory ${path}:`, error);
        return [];
    }
};

const formatFileSize = (bytes?: number): string => {
    if (bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

function FileExplorer() {
    const [navigationState, setNavigationState] = useState({
        history: ["/"],
        currentIndex: 0,
        currentPath: "/"
    });

    const { history, currentIndex, currentPath } = navigationState;
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [items, setItems] = useState<FileSystemItem[]>([]);
    const [items2, setItems2] = useState<FileSystemItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [sortBy, setSortBy] = useState<"name" | "type" | "size" | "date">("name");
    const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
    const [selectedItem, setSelectedItem] = useState<string | null>(null);

    const [expandedPaths, setExpandedPaths] = useState<string[]>(["/"]);
    const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());

    const handleToggleExpand = async (treeItem: TreeItem<FileSystemItem>) => {
        const item = treeItem.metadata!;
        if (!item.isDirectory) return;

        const isExpanded = expandedPaths.includes(item.path);

        if (isExpanded) {
            setExpandedPaths(prev => prev.filter(p => p !== item.path));
        } else {
            setExpandedPaths(prev => [...prev, item.path]);

            if (!items2.some(i => path.dirname(i.path) === item.path)) {
                setLoadingPaths(prev => {
                    const newSet = new Set(prev);
                    newSet.add(item.path);
                    return newSet;
                });

                try {
                    const children = await getDirectoryContents(item.path);
                    setItems2(prev => {
                        const filtered = prev.filter(i => !i.path.startsWith(item.path + path.sep));
                        return [...filtered, ...children];
                    });
                } catch (error) {
                    compat_logger.error(`Failed to load directory ${item.path}:`, error);
                } finally {
                    setLoadingPaths(prev => {
                        const newSet = new Set(prev);
                        newSet.delete(item.path);
                        return newSet;
                    });
                }
            }
        }
    };

    const handleSelect = (treeItem: TreeItem<FileSystemItem>) => {
        const item = treeItem.metadata!;
        setSelectedItem(item.path);

        if (item.isDirectory) {
            navigateToPath(item.path);
        }
    };

    const loadDirectoryContents = async (dirPath: string, updateMainView = true) => {
        setLoading(true);
        try {
            const contents = await getDirectoryContents(dirPath);

            let sortedItems = [...contents];
            switch (sortBy) {
                case "name":
                    sortedItems.sort((a, b) => a.name.localeCompare(b.name));
                    break;
                case "type":
                    sortedItems.sort((a, b) => (a.type || "").localeCompare(b.type || ""));
                    break;
                case "size":
                    sortedItems.sort((a, b) => (a.size || 0) - (b.size || 0));
                    break;
                case "date":
                    sortedItems.sort((a, b) => (b.modified?.getTime() || 0) - (a.modified?.getTime() || 0));
                    break;
            }

            if (sortDirection === "desc") {
                sortedItems.reverse();
            }

            if (updateMainView) setItems(sortedItems);
            setItems2(prev => [
                ...prev.filter(i => {
                    const idx = i.path.lastIndexOf("/");
                    const parent = idx <= 0 ? "/" : i.path.slice(0, idx);
                    return parent !== dirPath;
                }),
                ...sortedItems
            ]);
        } catch (error) {
            compat_logger.error(`Failed to load directory ${dirPath}:`, error);
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        loadDirectoryContents(currentPath);
    }, [currentPath, sortBy, sortDirection]);

    const navigateToPath = (path: string) => {
        if (currentPath === path) return;

        setNavigationState(prev => {
            if (prev.currentIndex < prev.history.length - 1) {
                const newHistory = [...prev.history.slice(0, prev.currentIndex + 1), path];
                return {
                    history: newHistory,
                    currentIndex: prev.currentIndex + 1,
                    currentPath: path
                };
            }

            if (prev.history[prev.history.length - 1] === path) {
                return {
                    ...prev,
                    currentPath: path
                };
            }

            return {
                history: [...prev.history, path],
                currentIndex: prev.history.length,
                currentPath: path
            };
        });
    };

    React.useEffect(() => {
        navigateToPath("/");
    }, []);

    const goUp = () => {
        const path = window.require("path");
        const parentPath = path.dirname(currentPath);
        if (parentPath !== currentPath) {
            navigateToPath(parentPath);
        }
    };

    const navigateBack = () => {
        if (currentIndex > 0) {
            const newIndex = currentIndex - 1;
            const newPath = history[newIndex];
            setNavigationState(prev => ({
                ...prev,
                currentIndex: newIndex,
                currentPath: newPath
            }));
        }
    };

    const navigateForward = () => {
        if (currentIndex < history.length - 1) {
            const newIndex = currentIndex + 1;
            const newPath = history[newIndex];
            setNavigationState(prev => ({
                ...prev,
                currentIndex: newIndex,
                currentPath: newPath
            }));
        }
    };

    const toggleSort = (column: "name" | "type" | "size" | "date") => {
        if (sortBy === column) {
            setSortDirection(prev => prev === "asc" ? "desc" : "asc");
        } else {
            setSortBy(column);
            setSortDirection("asc");
        }
    };

    const handleItemClick = (item: FileSystemItem) => {
        setSelectedItem(item.path);
        if (item.isDirectory) {
            navigateToPath(item.path);
        }
    };

    const showContextMenu = (event: React.MouseEvent, item?: FileSystemItem) => {
        event.preventDefault();

        if (item) {
            setSelectedItem(item.path);
        }

        const path = item?.path || currentPath;
        const isDirectory = item?.isDirectory ?? true;
        const isPluginFile = !isDirectory && path.endsWith(".plugin.js");

        const menuItems: any[] = [];
        menuItems.push({ label: path, disabled: true });

        if (isDirectory) {
            menuItems.push({
                label: "Import File Here",
                action: async () => {
                    try {
                        await FSUtils.importFile(path, true);
                        await Promise.all([
                            loadDirectoryContents(currentPath),
                            path !== currentPath ? loadDirectoryContents(path, false) : Promise.resolve()
                        ]);
                    } catch (error) {
                        compat_logger.error("File import failed:", error);
                    }
                }
            });
        } else {
            menuItems.push({
                label: "Export File",
                action: async () => {
                    try {
                        await FSUtils.exportFile(path);
                    } catch (error) {
                        compat_logger.error("File export failed:", error);
                    }
                }
            });
        }

        menuItems.push({
            type: "separator"
        });

        if (isDirectory) {
            menuItems.push({
                label: "Delete Folder",
                danger: true,
                action: () => {
                    getGlobalApi().UI.showConfirmationModal(
                        "Delete Folder",
                        `Are you sure you want to delete "${item?.name}" and all its contents? This cannot be undone.`,
                        {
                            confirmText: "Delete",
                            cancelText: "Cancel",
                            onConfirm: () => {
                                try {
                                    FSUtils.removeDirectoryRecursive(path);
                                    const parentPath = window.require("path").dirname(path);
                                    navigateToPath(parentPath);
                                } catch (error) {
                                    compat_logger.error("Folder deletion failed:", error);
                                }
                            }
                        }
                    );
                }
            });
        } else {
            menuItems.push({
                label: "Delete File",
                danger: true,
                action: () => {
                    getGlobalApi().UI.showConfirmationModal(
                        "Delete File",
                        `Are you sure you want to permanently delete "${item?.name}"?`,
                        {
                            confirmText: "Delete",
                            cancelText: "Cancel",
                            onConfirm: () => {
                                try {
                                    window.require("fs").unlinkSync(path);
                                    loadDirectoryContents(currentPath);
                                } catch (error) {
                                    compat_logger.error("File deletion failed:", error);
                                }
                            }
                        }
                    );
                }
            });
        }

        if (isPluginFile) {
            menuItems.push({
                type: "separator"
            });

            menuItems.push({
                label: "Reload Plugin",
                action: async () => {
                    try {
                        const parsed = window.require("path").parse(path);
                        parsed.dir = parsed.dir.startsWith("//") ? parsed.dir.slice(1) : parsed.dir;

                        const foundPlugin = getGlobalApi().Plugins.getAll().find(
                            x => x.sourcePath === parsed.dir && x.filename === parsed.base
                        );

                        if (foundPlugin) {
                            Vencord.Settings.plugins[foundPlugin.name].enabled = false;
                            if (foundPlugin.started) {
                                const currentStatus = Vencord.Settings.plugins[PLUGIN_NAME].pluginsStatus[foundPlugin.name];
                                await Vencord.Plugins.stopPlugin(foundPlugin as Plugin);
                                if (currentStatus === true) {
                                    Vencord.Settings.plugins[PLUGIN_NAME].pluginsStatus[foundPlugin.name] = currentStatus;
                                }
                            }
                            delete Vencord.Plugins.plugins[foundPlugin.name];
                            ((window as any).GeneratedPlugins as any[]).splice(
                                ((window as any).GeneratedPlugins as any[]).indexOf(foundPlugin),
                                1
                            );

                            await new Promise(resolve => setTimeout(resolve, 300));

                            const pluginContent = window.require("fs").readFileSync(path, "utf8");
                            const convertedPlugin = await convertPlugin(pluginContent, parsed.base, true, parsed.dir);
                            addCustomPlugin(convertedPlugin);

                            getGlobalApi().UI.showToast(`Plugin "${foundPlugin.name}" reloaded`, 1);
                        }
                    } catch (error) {
                        compat_logger.error("Plugin reload failed:", error);
                    }
                }
            });
        }

        // @ts-ignore
        getGlobalApi().ContextMenu.open(event, getGlobalApi().ContextMenu.buildMenu(menuItems.filter(Boolean)), {});
    };
    const path = window.require("path");
    const breadcrumbs = currentPath.split(path.sep).filter(Boolean);

    const calculateDirectorySize = (): number => {
        return items.reduce((total, item) => {
            if (!item.isDirectory) return total + (item.size || 0);
            return total;
        }, 0);
    };

    const totalSize = calculateDirectorySize();
    const itemCount = items.length;

    return (
        <div className={cl("explorer-container")}>
            <div className={cl("toolbar")}>
                <div className={cl("nav-buttons")}>
                    <Button
                        size={"small"}
                        variant="secondary"
                        disabled={currentIndex === 0}
                        onClick={navigateBack}
                    >
                        <MutedBaseText>{"<"}</MutedBaseText>
                    </Button>
                    <Button
                        size={"small"}
                        variant="none"
                        disabled={currentIndex === history.length - 1}
                        onClick={navigateForward}
                    >
                        <MutedBaseText>{">"}</MutedBaseText>
                    </Button>
                    <Button
                        size={"small"}
                        variant="none"
                        onClick={goUp}
                    >
                        <MutedBaseText>{"/\\"}</MutedBaseText>
                    </Button>
                </div>

                <div className={cl("address-bar")}>
                    <span className={cl("address-label")}><BaseText>Address:</BaseText></span>
                    <span
                        className={cl("breadcrumb")}
                        onClick={() => navigateToPath("/")}
                    >
                        <BaseText style={{
                            color: "var(--text-link)"
                        }}>/</BaseText>
                    </span>
                    {breadcrumbs.map((part, index) => {
                        const path = "/" + breadcrumbs.slice(0, index + 1).join("/");
                        return (
                            <React.Fragment key={path}>
                                <span className={cl("breadcrumb-separator")}>
                                    <MutedBaseText>
                                        {">"}
                                    </MutedBaseText>
                                </span>
                                <span
                                    className={cl("breadcrumb")}
                                    onClick={() => navigateToPath(path)}
                                >
                                    <BaseText style={{
                                        color: "var(--text-link)"
                                    }}>{part}</BaseText>
                                </span>
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>

            <div className={cl("content-container")}>
                <div style={{display:"none"}} className={`${cl("sidebar")} ${sidebarCollapsed ? cl("sidebar-collapsed") : ""}`}>
                    <Button
                        size={"small"}
                        variant="none"
                        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                    >
                        <MutedBaseText>{sidebarCollapsed ?
                            ">" :
                            "<"
                        }</MutedBaseText>
                    </Button>

                    {!sidebarCollapsed && (
                        <div className={cl("tree-container")}>
                            <TreeView<FileSystemItem>
                                items={fileSystemToTreeAdapter(items2, currentPath, expandedPaths, selectedItem)}
                                onToggleExpand={handleToggleExpand}
                                onSelect={handleSelect}
                                loadingPaths={loadingPaths}
                                headerComponent={<BaseText>Navigation</BaseText>}
                            />
                        </div>
                    )}
                </div>

                <div className={cl("main-content")}>
                    <div className={cl("sort-controls")}>
                        <span><BaseText>Sort:</BaseText></span>
                        <Button
                            size={"small"}
                            variant="none"
                            className={`${cl("sort-button")} ${sortBy === "name" ? cl("active") : ""}`}
                            onClick={() => toggleSort("name")}
                        >
                            <BaseText>Name {sortBy === "name" && (sortDirection === "asc" ? "↑" : "↓")}</BaseText>
                        </Button>
                        <Button
                            size={"small"}
                            variant="none"
                            className={`${cl("sort-button")} ${sortBy === "type" ? cl("active") : ""}`}
                            onClick={() => toggleSort("type")}
                        >
                            <BaseText>Type {sortBy === "type" && (sortDirection === "asc" ? "↑" : "↓")}</BaseText>
                        </Button>
                        <Button
                            size={"small"}
                            variant="none"
                            className={`${cl("sort-button")} ${sortBy === "size" ? cl("active") : ""}`}
                            onClick={() => toggleSort("size")}
                        >
                            <BaseText>Size {sortBy === "size" && (sortDirection === "asc" ? "↑" : "↓")}</BaseText>
                        </Button>
                        <Button
                            size={"small"}
                            variant="none"
                            className={`${cl("sort-button")} ${sortBy === "date" ? cl("active") : ""}`}
                            onClick={() => toggleSort("date")}
                        >
                            <BaseText>Date Modified {sortBy === "date" && (sortDirection === "asc" ? "↑" : "↓")}</BaseText>
                        </Button>
                    </div>

                    <div className={cl("file-list")}>
                        {loading ? (
                            <div className={cl("loading")}>Loading files...</div>
                        ) : items.length === 0 ? (
                            <div className={cl("empty-state")}>
                                <FolderIcon width={48} height={48} />
                                <Paragraph>This folder is empty</Paragraph>
                            </div>
                        ) : (
                            <table className={cl("file-table")}>
                                <colgroup>
                                    <col style={{ width: "55%" }} />
                                    <col style={{ width: "18%" }} />
                                    <col style={{ width: "12%" }} />
                                    <col style={{ width: "15%" }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th><MutedBaseText>Name</MutedBaseText></th>
                                        <th><MutedBaseText>Type</MutedBaseText></th>
                                        <th><MutedBaseText>Size</MutedBaseText></th>
                                        <th><MutedBaseText>Date Modified</MutedBaseText></th>
                                    </tr>
                                </thead>
                                <tbody onContextMenu={(e) => showContextMenu(e)}>
                                    {items.map((item) => (
                                        <tr
                                            key={item.path}
                                            className={`${cl("file-row")} ${selectedItem === item.path ? cl("selected") : ""}`}
                                            onClick={() => handleItemClick(item)}
                                            onContextMenu={(e) => showContextMenu(e, item)}
                                        >
                                            <td>
                                                <div className={cl("file-name")}>
                                                    {item.isDirectory ? (
                                                        <FolderIcon width={16} height={16} />
                                                    ) : (
                                                        <img src="/assets/94660b205108a49f.svg" width={16} height={16} />
                                                    )}
                                                    <span><BaseText>{item.name}</BaseText></span>
                                                </div>
                                            </td>
                                            <td><BaseText>{item.type}</BaseText></td>
                                            <td><BaseText>{item.isDirectory ? "" : formatFileSize(item.size)}</BaseText></td>
                                            <td><BaseText>{item.modified?.toLocaleDateString()}</BaseText></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            </div>

            <div className={cl("status-bar")}>
                <span><MutedBaseText size="sm">{itemCount} item{itemCount !== 1 ? "s" : ""} - {formatFileSize(totalSize)} used</MutedBaseText></span>
            </div>
        </div>
    );
}

function makeTab() {
    return (
        <SettingsTab>
            <section>
                <QuickActionCard>
                    <QuickAction
                        text="Export Filesystem as ZIP"
                        action={() => ZIPUtils.downloadZip()}
                        Icon={FolderIcon}
                    />
                    <QuickAction
                        text="Import Filesystem From ZIP"
                        action={() => ZIPUtils.importZip()}
                        Icon={FolderIcon}
                    />
                    <QuickAction
                        text="Reload BD Plugins"
                        action={() => reloadCompatLayer()}
                        Icon={RestartIcon}
                    />
                    <QuickAction
                        text="Import BD Plugin"
                        action={async () => await FSUtils.importFile("//BD/plugins", true, false, ".js")}
                        Icon={PlusIcon}
                    />
                    <QuickAction
                        text="Import Bulk Plugins"
                        action={async () => await FSUtils.importFile("//BD/plugins", true, true, ".js")}
                        Icon={FolderIcon}
                    />
                </QuickActionCard>
            </section>

            <Card className={cl("explorer-card")}>
                <FileExplorer />
            </Card>
        </SettingsTab>
    );
}

function createFilesSystemViewTab(ID: Record<string, unknown>) {
    return {
        section: `${typeof (Vencord.Util as any).isEquicordGuild === "undefined" ? "Vencord" : "Equicord"}BDCompatFS`, // workaround
        label: TabName,
        element: wrapTab(makeTab, TabName),
        className: "bv-fs-view",
    };
}

function createFilesSystemViewTabV2() {
    return {
        title: TabName,
        Component: wrapTab(makeTab, TabName),
        key: `${typeof (Vencord.Util as any).isEquicordGuild === "undefined" ? "vencord" : "equicord"}_bv_fs_view`,
        Icon: FolderIcon,
    };
}

export function injectSettingsTabs() {
    const settingsPlugin = Vencord.Plugins.plugins.Settings as SettingsPlugin;
    const { customSections, customEntries } = settingsPlugin;
    // customSections.push(createFilesSystemViewTab);
    if (customEntries) {
        customEntries.push(createFilesSystemViewTabV2());
    }
}

export function unInjectSettingsTab() {
    const settingsPlugin = Vencord.Plugins.plugins.Settings as SettingsPlugin;
    const { customSections, customEntries } = settingsPlugin;
    // customSections.splice(customSections.findIndex(x => x({}).className === createFilesSystemViewTab({}).className), 1);
    if (customEntries) {
        customEntries.splice(customEntries.findIndex(x => x.key === createFilesSystemViewTabV2().key), 1);
    }
}
