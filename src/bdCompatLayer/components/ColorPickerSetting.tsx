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

import { SettingsSection } from "@components/settings/tabs/plugins/components/Common";
import { ColorPicker, useState } from "@webpack/common";

export function ColorPickerSettingComponent(props: { onChange(value: any): void, option: any, pluginSettings: any, id: string; }) {
    const [error, setError] = useState<string | null>(null);
    const handleColorChange = (colorInt: number) => {
        const hexColor = "#" + colorInt.toString(16).padStart(6, "0");
        props.onChange(hexColor);
    };
    return <SettingsSection name={props.option?.displayName} id={props.id} description={props.option?.description ?? ""} error={error}>
        <ColorPicker
            color={parseInt((props.option?.color || "#000000").replace("#", ""), 16)}
            onChange={handleColorChange}
            showEyeDropper={false}
            suggestedColors={props.option?.colorPresets}
        />
    </SettingsSection>
}
