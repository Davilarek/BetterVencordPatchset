/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2025 Vendicated and contributors
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

import { Button as VenButton } from "@components/Button";
import { Text as VenText } from "@components/Text";
import { React, showToast } from "@webpack/common";

type AnyProps = Record<string, any>;

const TextSizes = new Set(["xxs", "xs", "sm", "md", "lg", "xl", "xxl"]);
const TextWeights = new Set(["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold"]);

// Discord text variants look like "heading-lg/semibold" or "text-md/normal"
function parseTextVariant(variant: string | undefined) {
    if (!variant) return {};
    const [style, weight] = variant.split("/");
    const size = style?.split("-").pop();
    return {
        size: size && TextSizes.has(size) ? size : undefined,
        weight: weight && TextWeights.has(weight) ? weight : undefined,
    };
}

export function Text({ variant, ...rest }: AnyProps) {
    const { size, weight } = parseTextVariant(variant);
    return React.createElement(VenText, { size, weight, ...rest } as any);
}

export const ButtonColors = {
    WHITE: "white",
    GREY: "grey",
    RED: "red",
    GREEN: "green",
    LINK: "link",
    BRAND: "brand",
    TRANSPARENT: "transparent",
} as const;

export const ButtonLooks = {
    FILLED: "filled",
    OUTLINED: "outlined",
} as const;

function BdButton({ color, look, variant, ...rest }: AnyProps) {
    let venVariant = variant;
    if (!venVariant) {
        if (color === ButtonColors.RED || color === "danger") venVariant = "dangerPrimary";
        else if (color === ButtonColors.LINK) venVariant = "link";
        else if (look === ButtonLooks.OUTLINED) venVariant = "secondary";
        else venVariant = "primary";
    }
    return React.createElement(VenButton, { variant: venVariant, ...rest } as any);
}

export const Button: any = Object.assign(BdButton, {
    Colors: ButtonColors,
    Looks: ButtonLooks,
});

export const Forms = {
    FormText: (props: AnyProps) => React.createElement("div", { className: "bd-form-text", ...props }),
    FormTitle: ({ tag: Tag = "h3", ...props }: AnyProps) => React.createElement(Tag, props),
    FormDivider: (props: AnyProps) => React.createElement("hr", { className: "bd-form-divider", ...props }),
};

export const Toasts = {
    Type: { MESSAGE: 0, SUCCESS: 1, FAILURE: 2, CUSTOM: 3 } as const,
    create(content: any, type?: any) {
        return { content, type };
    },
    show(toast: any) {
        const t = typeof toast === "string" ? { content: toast } : toast ?? {};
        const type = t.type;
        const variant =
            type === 1 || type === "success" ? "success" :
                type === 2 || type === "failure" || type === "critical" ? "critical" : "default";
        showToast({ text: typeof t.content === "string" ? t.content : String(t.content ?? ""), variant });
    },
};
