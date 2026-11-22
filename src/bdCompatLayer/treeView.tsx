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
import { Text as BaseText } from "@components/Text";
import { FolderIcon } from "@components/Icons";
import { React } from "@webpack/common";
import { ComponentPropsWithoutRef } from "react";

export interface TreeItem<T = any> {
    id: string;
    label: string;
    isDirectory?: boolean;
    children?: TreeItem<T>[];
    expanded?: boolean;
    selected?: boolean;
    metadata?: T;
}

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

interface TreeViewProps<T = any> {
    items: TreeItem<T>[];
    onToggleExpand?: (item: TreeItem<T>) => void;
    onSelect?: (item: TreeItem<T>) => void;
    renderIcon?: (item: TreeItem<T>) => React.ReactNode;
    className?: string;
    loadingPaths?: Set<string>;
    headerComponent: React.ReactNode;
}
const cl = classNameFactory("vc-bdcompat-fs-");

export function TreeView<T>({
    items,
    onToggleExpand,
    onSelect,
    renderIcon,
    className = "",
    loadingPaths = new Set(),
    headerComponent,
}: TreeViewProps<T>) {
    const defaultRenderIcon = (item: TreeItem<T>) => {
        if (item.isDirectory) {
            return <FolderIcon width={16} height={16} />;
        }
        return <img src="/assets/94660b205108a49f.svg" width={16} height={16} />;
    };

    const itemIcon = renderIcon || defaultRenderIcon;

    const renderItem = (item: TreeItem<T>, level: number = 0) => {
        const isExpanded = !!item.expanded;
        const isLoading = loadingPaths.has(item.id);
        const hasChildren = item.children && item.children.length > 0;

        return (
            <React.Fragment key={item.id}>
                <div
                    className={`${cl("tree-item")} ${item.isDirectory ? cl("directory") : ""} ${item.selected ? cl("active") : ""}`}
                    style={{ paddingLeft: `${level * 16 + 8}px` }}
                >
                    {item.isDirectory ? (
                        <div
                            className={cl("folder-row")}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand?.(item);
                            }}
                        >
                            <span className={cl("folder-toggle")}>
                                <MutedBaseText size="sm">{isLoading ? (
                                    "Loading"
                                ) : (
                                    isExpanded ? "\\/" : hasChildren || item.children !== undefined ? ">" : "_"
                                )}</MutedBaseText>
                            </span>
                            {itemIcon(item)}
                            <span
                                className={cl("item-name")}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onSelect?.(item);
                                }}
                            >
                                <BaseText>{item.label}</BaseText>
                            </span>
                        </div>
                    ) : (
                        <div
                            className={cl("file-row")}
                            onClick={() => onSelect?.(item)}
                        >
                            <span className={cl("file-icon")}>
                                {itemIcon(item)}
                            </span>
                            <span className={cl("item-name")}><BaseText>{item.label}</BaseText></span>
                        </div>
                    )}
                </div>

                {item.isDirectory && isExpanded && item.children && (
                    <div className={cl("children-container")}>
                        {item.children.map(child => renderItem(child, level + 1))}
                    </div>
                )}
            </React.Fragment>
        );
    };

    return (
        <div className={`${cl("tree-view")} ${className}`}>
            <div className={cl("tree-header")}>
                {headerComponent}
            </div>
            <div className={cl("tree-content")}>
                {items.map(item => renderItem(item))}
            </div>
        </div>
    );
}
