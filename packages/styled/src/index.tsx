import { IConfig, TCss, TUtilityFirstCss } from "@stitches/css";
import * as React from "react";
import { Box, PolymorphicComponent } from "react-polymorphic-box";

export type IBaseStyled<C extends IConfig> = (
  cb: (
    css: C extends { utilityFirst: true } ? TUtilityFirstCss<C> : TCss<C>
  ) => string
) => string;

export type IStyled<C extends IConfig> = {
  [E in keyof JSX.IntrinsicElements]: <
    V extends {
      [propKey: string]: {
        [variantName: string]: (
          css: C extends { utilityFirst: true } ? TUtilityFirstCss<C> : TCss<C>
        ) => string;
      };
    }
  >(
    cb: (
      css: C extends { utilityFirst: true } ? TUtilityFirstCss<C> : TCss<C>
    ) => string,
    variants?: V
  ) => PolymorphicComponent<
    {
      [P in keyof V]: keyof V[P];
    },
    E
  >;
};

export const createStyled = <C extends IConfig>() => {
  let currentAs: string;

  const context = React.createContext<TCss<C> | TUtilityFirstCss<C>>(
    null as any
  );
  const useCssInstance = () => React.useContext(context);
  const ProviderComponent: React.FC<{
    css: C extends { utilityFirst: true } ? TUtilityFirstCss<C> : TCss<C>;
  }> = ({ css, children }) =>
    React.createElement(
      context.Provider,
      {
        value: css,
      },
      children
    );
  const styledInstance = (
    baseStyling: any,
    variants: { [variant: string]: { [name: string]: any } }
  ) => {
    const as = currentAs;
    return (props: any) => {
      const css = useCssInstance();
      if (!css) {
        throw new Error(
          "@stitches/styled - You do not seem to have added the Provider, please read the documentation for more help"
        );
      }

      const compositions = [baseStyling(css)];
      const evaluatedVariants = React.useMemo(() => {
        const currentEvaluatedVariants: any = {};
        Object.keys(variants).forEach((variantName) => {
          currentEvaluatedVariants[variantName] = {};
          Object.keys(variants[variantName]).forEach((variant) => {
            currentEvaluatedVariants[variantName][variant] = variants[
              variantName
            ][variant](css);
          });
        });

        return currentEvaluatedVariants;
      }, []);

      Object.keys(variants).forEach((variantName) => {
        if (
          variantName in props &&
          props[variantName] in variants[variantName]
        ) {
          compositions.push(evaluatedVariants[variantName][props[variantName]]);
        }
      });

      const className = css.compose(...compositions);

      return React.createElement(Box, {
        as,
        className,
        ...props,
      });
    };
  };

  const styledProxy = new Proxy(
    {},
    {
      get(_, prop) {
        currentAs = String(prop);
        return styledInstance;
      },
    }
  ) as IBaseStyled<C> & IStyled<C>;

  return {
    Provider: ProviderComponent,
    useCss: useCssInstance,
    styled: styledProxy,
  };
};

const { Provider, useCss, styled } = createStyled<{}>();

export { Provider, useCss, styled };

const Test = styled.div((css) => css.color("red"), {
  size: {
    small: (css) => css.fontSize("2px"),
  },
});

/*
const Test = styled.div({ color: 'red' }, {
  size: {
    small: { fontSize: '2px' }
  },
});
*/
