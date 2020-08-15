import {
  ATOM,
  IAtom,
  IComposedAtom,
  IConfig,
  ICssPropToToken,
  IMediaQueries,
  ISheet,
  IThemeAtom,
  ITokensDefinition,
  TCss,
} from "./types";
import {
  createSheets,
  cssPropToToken,
  getVendorPrefixAndProps,
  hashString,
  specificityProps,
  isObject,
} from "./utils";

export * from "./types";
export * from "./css-types";

export const hotReloadingCache = new Map<string, any>();

const toStringCachedAtom = function (this: IAtom) {
  return this._className!;
};

const createSelector = (className: string, pseudo?: string) => {
  return pseudo && pseudo.includes("&")
    ? pseudo.replace(/&/gi, `.${className}`)
    : pseudo
    ? `.${className}${pseudo[0] === ":" ? pseudo : " " + pseudo}`
    : `.${className}`;
};

const toStringCompose = function (this: IComposedAtom) {
  const className = this.atoms.map((atom) => atom.toString()).join(" ");

  // cache the className on this instance
  // @ts-ignore
  this._className = className;
  // @ts-ignore
  this.toString = toStringCachedAtom;
  return className;
};

const createToString = (
  sheets: { [mediaQuery: string]: ISheet },
  mediaQueries: IMediaQueries = {},
  cssClassnameProvider: (atom: IAtom, seq: number | null) => string,
  preInjectedRules: Set<string>
) => {
  let seq = 0;
  return function toString(this: IAtom) {
    const className = cssClassnameProvider(
      this,
      preInjectedRules.size ? null : seq++
    );
    const shouldInject =
      !preInjectedRules.size || !preInjectedRules.has(`.${className}`);
    const value = this.value;

    // Allow using "&" to position the classname, also multiple times

    if (shouldInject) {
      let cssRule = "";
      if (this.inlineMediaQueries && this.inlineMediaQueries.length) {
        let allMediaQueries = "";
        let endBrackets = "";
        this.inlineMediaQueries.forEach((mediaQuery) => {
          allMediaQueries += `${mediaQuery}{`;
          endBrackets += "}";
        });

        cssRule = `${allMediaQueries}${createSelector(
          className,
          this.pseudo
        )}{${this.cssHyphenProp}:${value};}${endBrackets}`;
      } else {
        cssRule = `${createSelector(className, this.pseudo)}{${
          this.cssHyphenProp
        }:${value};}`;
      }

      sheets[this.mediaQuery].insertRule(
        this.mediaQuery ? mediaQueries[this.mediaQuery](cssRule) : cssRule
      );
    }

    // We are switching this atom from IAtom simpler representation
    // 1. delete everything but `id` for specificity check

    // @ts-ignore
    this.cssHyphenProp = this.value = this.pseudo = this.mediaQuery = this.mediaQueries = undefined;

    // 2. put on a _className
    this._className = className;

    // 3. switch from this `toString` to a much simpler one
    this.toString = toStringCachedAtom;

    return className;
  };
};

const createServerToString = (
  sheets: { [mediaQuery: string]: ISheet },
  mediaQueries: IMediaQueries = {},
  cssClassnameProvider: (atom: IAtom, seq: number | null) => string
) => {
  return function toString(this: IAtom) {
    const className = cssClassnameProvider(this, null);
    const value = this.value;
    const selector = createSelector(className, this.pseudo);

    let cssRule = "";
    cssRule = `${selector}{${this.cssHyphenProp}:${value};}`;

    sheets[this.mediaQuery].insertRule(
      this.mediaQuery ? mediaQueries[this.mediaQuery](cssRule) : cssRule
    );

    // We do not clean out the atom here, cause it will be reused
    // to inject multiple times for each request

    // 1. put on a _className
    this._className = className;

    // 2. switch from this `toString` to a much simpler one
    this.toString = toStringCachedAtom;

    return className;
  };
};

const createThemeToString = (classPrefix: string, variablesSheet: ISheet) =>
  function toString(this: IThemeAtom) {
    const themeClassName = `${classPrefix ? `${classPrefix}-` : ""}theme-${
      this.name
    }`;

    // @ts-ignore
    variablesSheet.insertRule(
      `.${themeClassName}{${Object.keys(this.definition).reduce(
        (aggr, tokenType) => {
          // @ts-ignore
          return `${aggr}${Object.keys(this.definition[tokenType]).reduce(
            (subAggr, tokenKey) => {
              // @ts-ignore
              return `${subAggr}--${tokenType}-${tokenKey}:${this.definition[tokenType][tokenKey]};`;
            },
            aggr
          )}`;
        },
        ""
      )}}`
    );

    this.toString = () => themeClassName;

    return themeClassName;
  };

const composeIntoMap = (
  map: Map<string, IAtom>,
  atoms: (IAtom | IComposedAtom)[]
) => {
  let i = atoms.length - 1;
  for (; i >= 0; i--) {
    const item = atoms[i];
    // atoms can be undefined, null, false or '' using ternary like
    // expressions with the properties
    if (item && item[ATOM] && "atoms" in item) {
      composeIntoMap(map, item.atoms);
    } else if (item && item[ATOM]) {
      if (!map.has((item as IAtom).id)) {
        map.set((item as IAtom).id, item as IAtom);
      }
    } else if (item) {
      map.set((item as unknown) as string, item as IAtom);
    }
  }
};

export const createTokens = <T extends ITokensDefinition>(tokens: T) => {
  return tokens;
};

export const createCss = <T extends IConfig>(
  config: T,
  env: Window | null = typeof window === "undefined" ? null : window
): TCss<T> => {
  const showFriendlyClassnames =
    typeof config.showFriendlyClassnames === "boolean"
      ? config.showFriendlyClassnames
      : process.env.NODE_ENV === "development";
  const prefix = config.prefix || "";
  const { vendorPrefix, vendorProps } = env
    ? getVendorPrefixAndProps(env)
    : { vendorPrefix: "-node-", vendorProps: [] };

  if (env && hotReloadingCache.has(prefix)) {
    const instance = hotReloadingCache.get(prefix);
    instance.dispose();
  }

  // pre-compute class prefix
  const classPrefix = prefix
    ? showFriendlyClassnames
      ? `${prefix}_`
      : prefix
    : "";
  const cssClassnameProvider = (atom: IAtom, seq: number | null): string => {
    const hash =
      seq === null
        ? hashString(
            `${atom.mediaQuery || ""}${atom.cssHyphenProp.replace(
              /-(moz|webkit|ms)-/,
              ""
            )}${atom.pseudo || ""}${atom.value}`
          )
        : seq;
    const name = showFriendlyClassnames
      ? `${atom.mediaQuery ? `${atom.mediaQuery}_` : ""}${atom.cssHyphenProp
          .replace(/-(moz|webkit|ms)-/, "")
          .split("-")
          .map((part) => part[0])
          .join("")}_${hash}`
      : `_${hash}`;

    return `${classPrefix}${name}`;
  };

  const { tags, sheets } = createSheets(env, config.mediaQueries);
  const preInjectedRules = new Set<string>();
  // tslint:disable-next-line
  for (const sheet in sheets) {
    for (let x = 0; x < sheets[sheet].cssRules.length; x++) {
      preInjectedRules.add(sheets[sheet].cssRules[x].selectorText);
    }
  }

  let toString = env
    ? createToString(
        sheets,
        config.mediaQueries,
        cssClassnameProvider,
        preInjectedRules
      )
    : createServerToString(sheets, config.mediaQueries, cssClassnameProvider);

  let themeToString = createThemeToString(classPrefix, sheets.__variables__);
  const compose = (...atoms: IAtom[]): IComposedAtom => {
    const map = new Map<string, IAtom>();
    composeIntoMap(map, atoms);
    return {
      atoms: Array.from(map.values()),
      toString: toStringCompose,
      [ATOM]: true,
    };
  };
  const createAtom = (
    cssProp: string,
    value: any,
    mediaQuery = "",
    mediaQuerySpecificityIndex: number,
    selectors?: string[]
  ) => {
    const token: any = cssPropToToken[cssProp as keyof ICssPropToToken<any>];
    let tokenValue: any;
    if (token) {
      if (Array.isArray(token) && Array.isArray(value)) {
        tokenValue = token.map((tokenName, index) =>
          token &&
          (tokens as any)[tokenName] &&
          (tokens as any)[tokenName][value[index]]
            ? (tokens as any)[tokenName][value[index]]
            : value[index]
        );
      } else {
        tokenValue =
          token && (tokens as any)[token] && (tokens as any)[token][value]
            ? (tokens as any)[token][value]
            : value;
      }
    } else {
      tokenValue = value;
    }
    const isVendorPrefixed = cssProp[0] === cssProp[0].toUpperCase();

    const inlineMediaQueries = selectors?.filter((part) =>
      part.startsWith("@")
    );
    let pseudoString = selectors
      ?.filter((part) => !part.startsWith("@"))
      .join("");

    // We want :active pseudo selectors to take presedence over other pseudo
    // selectors, so we increase specificity
    if (!pseudoString?.match("&") && pseudoString?.match(":active")) {
      pseudoString = `&&${pseudoString}`;
    }

    // generate id used for specificity check
    // two atoms are considered equal in regared to there specificity if the id is equal
    const id =
      cssProp.toLowerCase() +
      (pseudoString || "") +
      (inlineMediaQueries && inlineMediaQueries.length
        ? inlineMediaQueries.join("")
        : "") +
      mediaQuery;

    // make a uid accouting for different values
    const uid = id + value;

    // If this was created before return the cached atom
    if (atomCache.has(uid)) {
      return atomCache.get(uid)!;
    }

    // prepare the cssProp
    let cssHyphenProp = cssProp
      .split(/(?=[A-Z])/)
      .map((g) => g.toLowerCase())
      .join("-");

    if (isVendorPrefixed) {
      cssHyphenProp = `-${cssHyphenProp}`;
    } else if (vendorProps.includes(`${vendorPrefix}${cssHyphenProp}`)) {
      cssHyphenProp = `${vendorPrefix}${cssHyphenProp}`;
    }

    // Create a new atom
    const atom: IAtom = {
      id,
      cssHyphenProp,
      value: tokenValue,
      pseudo: pseudoString,
      inlineMediaQueries,
      mediaQuerySpecificityIndex: 0,
      mediaQuery,
      toString,
      [ATOM]: true,
    };

    // Cache it
    atomCache.set(uid, atom);

    return atom;
  };
  const createCssAtoms = (
    props: {
      [key: string]: any;
    },
    cb: (atom: IAtom) => void,
    mediaQuery = "",
    pseudo: string[] = [],
    mediaQuerySpecificityIndex = 0,
    canCallUtils = true,
    canCallSpecificityProps = true
  ) => {
    let mediaQueryIndex = 0;

    // tslint:disable-next-line
    for (const prop in props) {
      if (config.mediaQueries && prop in config.mediaQueries) {
        if (mediaQuery) {
          throw new Error(
            `@stitches/css - You are nesting the mediaQuery "${prop}" into "${mediaQuery}", that makes no sense? :-)`
          );
        }
        createCssAtoms(
          props[prop],
          cb,
          prop,
          pseudo,
          mediaQuerySpecificityIndex
        );
      } else if (isObject(props[prop])) {
        createCssAtoms(
          props[prop],
          cb,
          mediaQuery,
          pseudo.concat(prop),
          prop[0] === "@"
            ? mediaQuerySpecificityIndex + ++mediaQueryIndex
            : mediaQuerySpecificityIndex
        );
      } else if (canCallUtils && prop in utils) {
        createCssAtoms(
          utils[prop](config)(props[prop]) as any,
          cb,
          mediaQuery,
          pseudo,
          mediaQuerySpecificityIndex,
          false
        );
      } else if (canCallSpecificityProps && prop in specificityProps) {
        createCssAtoms(
          specificityProps[prop](config)(props[prop]) as any,
          cb,
          mediaQuery,
          pseudo,
          mediaQuerySpecificityIndex,
          false,
          false
        );
      } else {
        cb(
          createAtom(
            prop,
            props[prop],
            mediaQuery,
            mediaQuerySpecificityIndex,
            pseudo.length ? pseudo : undefined
          )
        );
      }
    }
  };
  const createUtilsAtoms = (
    props: {
      [key: string]: any;
    },
    cb: (atom: IAtom) => void,
    mediaQuery = "",
    pseudo: string[] = [],
    mediaQuerySpecificityIndex = 0,
    canOverride = true
  ) => {
    let mediaQueryIndex = 0;
    // tslint:disable-next-line
    for (const prop in props) {
      if (prop === "override") {
        if (!canOverride) {
          throw new Error(
            "@stitches/css - You can not override at this level, only at the top level definition"
          );
        }
        createCssAtoms(
          props[prop],
          cb,
          mediaQuery,
          pseudo,
          mediaQuerySpecificityIndex
        );
      } else if (config.mediaQueries && prop in config.mediaQueries) {
        if (mediaQuery) {
          throw new Error(
            `@stitches/css - You are nesting the mediaQuery "${prop}" into "${mediaQuery}", that makes no sense? :-)`
          );
        }
        createUtilsAtoms(
          props[prop],
          cb,
          prop,
          pseudo,
          mediaQuerySpecificityIndex,
          false
        );
      } else if (isObject(props[prop])) {
        createUtilsAtoms(
          props[prop],
          cb,
          mediaQuery,
          pseudo.concat(prop),
          prop[0] === "@"
            ? mediaQuerySpecificityIndex + ++mediaQueryIndex
            : mediaQuerySpecificityIndex,
          false
        );
      } else if (prop in utils) {
        createCssAtoms(
          utils[prop](config)(props[prop]) as any,
          cb,
          mediaQuery,
          pseudo,
          mediaQuerySpecificityIndex,
          false
        );
      } else {
        throw new Error(
          `@stitches/css - The prop "${prop}" is not a valid utility`
        );
      }
    }
  };

  // pre-checked config to avoid checking these all the time
  const mediaQueries = config.mediaQueries || {};
  const utils = config.utils || {};
  const tokens = config.tokens || {};

  let baseTokens = ":root{";
  // tslint:disable-next-line
  for (const tokenType in tokens) {
    // @ts-ignore
    // tslint:disable-next-line
    for (const token in tokens[tokenType]) {
      const cssvar = `--${tokenType}-${token}`;

      // @ts-ignore
      baseTokens += `${cssvar}:${tokens[tokenType][token]};`;

      // @ts-ignore
      tokens[tokenType][token] = `var(${cssvar})`;
    }
  }
  baseTokens += "}";

  if (!preInjectedRules.has(":root")) {
    sheets.__variables__.insertRule(baseTokens);
  }

  // atom cache
  const atomCache = new Map<string, IAtom>();
  const themeCache = new Map<ITokensDefinition, IThemeAtom>();

  const cssInstance = ((...definitions: any[]) => {
    const args: any[] = [];
    let index = 0;

    for (let x = 0; x < definitions.length; x++) {
      if (!definitions[x]) {
        continue;
      }
      if (typeof definitions[x] === "string" || definitions[x][ATOM]) {
        args[index++] = definitions[x];
      } else if (config.utilityFirst) {
        createUtilsAtoms(definitions[x], (atom) => {
          args[index++] = atom;
        });
      } else {
        createCssAtoms(definitions[x], (atom) => {
          args[index++] = atom;
        });
      }
    }

    return compose(...args);
  }) as any;

  cssInstance.dispose = () => {
    atomCache.clear();
    tags.forEach((tag) => {
      tag.parentNode?.removeChild(tag);
    });
  };
  cssInstance._config = () => config;
  cssInstance.theme = (definition: any): IThemeAtom => {
    if (themeCache.has(definition)) {
      return themeCache.get(definition)!;
    }

    const themeAtom = {
      // We could here also check if theme has been added from server,
      // though thinking it does not matter... just a simple rule
      name: String(themeCache.size),
      definition,
      toString: themeToString,
      [ATOM]: true as true,
    };

    themeCache.set(definition, themeAtom);

    return themeAtom;
  };
  cssInstance.getStyles = (cb: any) => {
    // tslint:disable-next-line
    for (let sheet in sheets) {
      sheets[sheet].content = "";
    }
    if (baseTokens) {
      sheets.__variables__.insertRule(baseTokens);
    }

    // We have to reset our toStrings so that they will now inject again,
    // and still cache is it is being reused
    toString = createServerToString(
      sheets,
      config.mediaQueries,
      cssClassnameProvider
    );

    // We have to reset our themeToStrings so that they will now inject again,
    // and still cache is it is being reused
    themeToString = createThemeToString(classPrefix, sheets.__variables__);

    atomCache.forEach((atom) => {
      atom.toString = toString;
    });

    themeCache.forEach((atom) => {
      atom.toString = themeToString;
    });

    const result = cb();

    return {
      result,
      styles: Object.keys(mediaQueries).reduce(
        (aggr, key) => {
          return aggr.concat(`/* STITCHES:${key} */\n${sheets[key].content}`);
        },
        [
          `/* STITCHES:__variables__ */\n${sheets.__variables__.content}`,
          `/* STITCHES */\n${sheets[""].content}`,
        ]
      ),
    };
  };

  if (env) {
    hotReloadingCache.set(prefix, cssInstance);
  }

  return cssInstance;
};
