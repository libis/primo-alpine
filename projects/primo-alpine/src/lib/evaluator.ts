import type { AlpineType } from './alpine';

/**
 * Alpine compiles directive expressions with `Object.getPrototypeOf(async function () {}).constructor`.
 * Angular CLI (webpack and esbuild alike) downlevels async/await in every module whenever zone.js
 * is used, so that lookup returns plain `Function`, and every expression then fails with
 * "func.call(...).catch is not a function".
 *
 * Code inside a `new Function` string is never transpiled, so this yields the real constructor
 * whatever the bundler did. (Standard Alpine needs `unsafe-eval` anyway.)
 */
const RealAsyncFunction: FunctionConstructor = new Function(
  'return Object.getPrototypeOf(async function () {}).constructor',
)();

/**
 * True when this bundle's async functions were downleveled. Our own module is transpiled exactly
 * like Alpine's, so if our `async function` is not a real one, neither is Alpine's.
 */
export function asyncIsDownleveled(): boolean {
  return Object.getPrototypeOf(async function () {}).constructor !== RealAsyncFunction;
}

/**
 * Whether Alpine's current evaluator fails on a trivial expression. False for the CSP build (its
 * own interpreter) and for bundles that kept native async, so those are never touched.
 */
export function alpineEvaluatorIsBroken(Alpine: AlpineType): boolean {
  let broken = false;
  Alpine.setErrorHandler(() => (broken = true));
  let result: unknown;
  try {
    result = (Alpine as any).evaluate(document.createElement('div'), '1 + 1');
  } catch {
    broken = true;
  }
  Alpine.setErrorHandler(defaultErrorHandler);
  return broken || result !== 2;
}

type ErrorHandler = (error: Error, el: Element, expression?: unknown) => void;
type Receiver = (value: unknown) => void;
interface EvaluateOptions {
  scope?: object;
  params?: unknown[];
  context?: unknown;
}
type CompiledExpression = ((self: CompiledExpression, scope: object) => Promise<unknown>) & {
  result?: unknown;
  finished?: boolean;
};

function defaultErrorHandler(error: any, el: Element, expression?: unknown): void {
  error = Object.assign(error ?? { message: 'No error message given.' }, { el, expression });
  console.warn(`Alpine Expression Error: ${error.message}\n\n${expression ? `Expression: "${expression}"\n\n` : ''}`, el);
  setTimeout(() => {
    throw error;
  }, 0);
}

/** Alpine's "if (...)" / "let|const" statement wrapping, unchanged. */
function rightSideSafe(expression: string, asyncWrapper: boolean): string {
  const trimmed = expression.trim();
  if (/^[\n\s]*if.*\(.*\)/.test(trimmed) || /^(let|const)\s/.test(trimmed)) {
    return asyncWrapper ? `(async()=>{ ${expression} })()` : `(()=>{ ${expression} })()`;
  }
  return expression;
}

/**
 * Replaces Alpine's evaluator and raw evaluator with line-for-line ports of Alpine 3.17's
 * `normalEvaluator` / `normalRawEvaluator` that use the real AsyncFunction.
 *
 * One behaviour cannot be reproduced: Alpine's internal `dontAutoEvaluateFunctions` flag, which
 * only `Alpine.extractProp` sets (for inline bindings read by some plugins). Here functions
 * returned by an expression are always called, which is Alpine's default everywhere else.
 */
export function installAsyncSafeEvaluator(Alpine: AlpineType): void {
  const A = Alpine as any;
  let errorHandler: ErrorHandler = defaultErrorHandler;
  const setErrorHandler = A.setErrorHandler.bind(A);
  A.setErrorHandler = (handler: ErrorHandler) => {
    errorHandler = handler;
    setErrorHandler(handler);
  };
  const handleError = (error: any, el: Element, expression?: unknown) => errorHandler(error, el, expression);

  const memo: Record<string, CompiledExpression> = {};

  function compile(expression: string, el: Element): CompiledExpression | undefined {
    if (memo[expression]) return memo[expression];
    try {
      const func = new RealAsyncFunction(
        '__self',
        'scope',
        `with (scope) { __self.result = ${rightSideSafe(expression, true)} }; __self.finished = true; return __self.result;`,
      ) as unknown as CompiledExpression;
      Object.defineProperty(func, 'name', { value: `[Alpine] ${expression}` });
      memo[expression] = func;
      return func;
    } catch (error) {
      handleError(error, el, expression);
      return undefined;
    }
  }

  function runIfTypeOfFunction(receiver: Receiver, value: unknown, scope?: object, params: unknown[] = [], el?: Element): void {
    if (typeof value === 'function') {
      const result = value.apply(scope, params);
      if (result instanceof Promise) {
        result.then((i) => runIfTypeOfFunction(receiver, i, scope, params)).catch((error) => handleError(error, el!, value));
      } else {
        receiver(result);
      }
    } else if (typeof value === 'object' && value instanceof Promise) {
      value.then((i) => receiver(i));
    } else {
      receiver(value);
    }
  }

  function fromString(dataStack: object[], expression: string, el: Element) {
    const func = compile(expression, el);
    return (receiver: Receiver = () => {}, { scope = {}, params = [], context }: EvaluateOptions = {}) => {
      if (!func) return;
      func.result = undefined;
      func.finished = false;
      const completeScope = A.mergeProxies([scope, ...dataStack]);
      const promise = func.call(context, func, completeScope).catch((error: unknown) => handleError(error, el, expression));
      if (func.finished) {
        runIfTypeOfFunction(receiver, func.result, completeScope, params, el);
        func.result = undefined;
      } else {
        promise
          .then((result: unknown) => runIfTypeOfFunction(receiver, result, completeScope, params, el))
          .catch((error: unknown) => handleError(error, el, expression))
          .finally(() => (func.result = undefined));
      }
    };
  }

  function fromFunction(dataStack: object[], func: Function) {
    return (receiver: Receiver = () => {}, { scope = {}, params = [] }: EvaluateOptions = {}) => {
      const result = func.apply(A.mergeProxies([scope, ...dataStack]), params);
      runIfTypeOfFunction(receiver, result);
    };
  }

  function dataStackFor(el: Element): object[] {
    const overriddenMagics = {};
    A.injectMagics(overriddenMagics, el);
    return [overriddenMagics, ...A.closestDataStack(el)];
  }

  A.setEvaluator((el: Element, expression: string | Function) => {
    const dataStack = dataStackFor(el);
    const evaluator =
      typeof expression === 'function' ? fromFunction(dataStack, expression) : fromString(dataStack, expression, el);
    return (...args: Parameters<typeof evaluator>) => {
      try {
        return evaluator(...args);
      } catch (error) {
        handleError(error, el, expression);
      }
    };
  });

  A.setRawEvaluator((el: Element, expression: string, extras: EvaluateOptions = {}) => {
    const scope = A.mergeProxies([extras.scope ?? {}, ...dataStackFor(el)]);
    const params = extras.params ?? [];
    const isAsync = expression.includes('await');
    const Ctor = isAsync ? RealAsyncFunction : Function;
    const func = new Ctor('scope', `with (scope) { let __result = ${rightSideSafe(expression, isAsync)}; return __result }`);
    const result = func.call(extras.context, scope);
    if (!isAsync && typeof result === 'function') return result.apply(scope, params);
    return result;
  });
}
