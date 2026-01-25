namespace Webpack {
    export type ExportedOnlyFilter = Function;
};

/* eslint-disable simple-header/header */
/* eslint-disable eqeqeq */
/* eslint-disable no-prototype-builtins */
/* globals BdApi window document Vencord */
/* eslint no-undef:error */
/**
 * This file contains code taken from https://github.com/BetterDiscord/BetterDiscord
 * @see https://github.com/BetterDiscord/BetterDiscord/blob/main/LICENSE
 */
!function () { };

/**
 * @summary Code taken from BetterDiscord (sourced from commit: c10d0b67c0fd53fee582cf5b8bc4779e80006983
 * @description Changes:
 *  Made mapped[key] setter update the original module's property if it's a getter without a setter
 *
 *  Formatting changed
 */
function mapObject<T extends object>(module: any, mappers: Record<keyof T, Webpack.ExportedOnlyFilter>): T {
    const mapped = {} as Partial<T>;

    const moduleKeys = Object.keys(module);
    const mapperKeys = Object.keys(mappers) as Array<keyof T>;

    for (let i = 0; i < moduleKeys.length; i++) {
        const searchKey = moduleKeys[i];
        if (!Object.prototype.hasOwnProperty.call(module, searchKey)) continue;

        for (let j = 0; j < mapperKeys.length; j++) {
            const key = mapperKeys[j];
            if (!Object.prototype.hasOwnProperty.call(mappers, key)) continue;
            if (Object.prototype.hasOwnProperty.call(mapped, key)) continue;

            if (mappers[key](module[searchKey])) {
                Object.defineProperty(mapped, key, {
                    get() {
                        return module[searchKey];
                    },
                    set(value) {
                        const desc = Object.getOwnPropertyDescriptor(module, searchKey);
                        if (desc && desc.get && !desc.set && desc.configurable) {
                            Object.defineProperty(module, searchKey, {
                                value: value,
                                writable: true,
                                configurable: true,
                                enumerable: desc.enumerable
                            });
                        } else {
                            module[searchKey] = value;
                        }
                    },
                    enumerable: true,
                    configurable: false
                });
            }
        }
    }

    for (let i = 0; i < mapperKeys.length; i++) {
        const key = mapperKeys[i];
        if (!Object.prototype.hasOwnProperty.call(mapped, key)) {
            Object.defineProperty(mapped, key, {
                value: undefined,
                enumerable: true,
                configurable: false
            });
        }
    }

    Object.defineProperty(mapped, Symbol("betterdiscord.getMangled"), {
        value: module,
        configurable: false
    });

    return mapped as T;
}

export {
    mapObject as BdApi_mapObject,
};
