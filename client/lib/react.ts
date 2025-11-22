/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";

export type Command<Action> = () => Action | Promise<Action>;
export type Subscription<Action> = (dispatch: Dispatch<Action>) => void;

export function isCommand<Action>(
  f: Command<Action> | Subscription<Action>
): f is Command<Action> {
  return f.length === 0;
}

export function isSubscription<Action>(
  f: Command<Action> | Subscription<Action>
): f is Subscription<Action> {
  return f.length === 1;
}

export function areAllCommands<Action>(
  fns: Array<Command<Action> | Subscription<Action>>
): fns is Array<Command<Action>> {
  return fns.every(isCommand);
}

export function areAllSubscriptions<Action>(
  fns: Array<Command<Action> | Subscription<Action>>
): fns is Array<Subscription<Action>> {
  return fns.every(isSubscription);
}

export type Reducer<State, Action> = (
  state: State,
  action: Action
) => StateWithSideEffects<State, Action>;

export type StateWithSideEffects<State, Action> =
  | State
  | [State, Command<Action>]
  | [State, Command<Action>[]]
  | [State, Subscription<Action>]
  | [State, Subscription<Action>[]]
  | [State, Command<Action>[], Subscription<Action>]
  | [State, Command<Action>[], Subscription<Action>[]]
  | [State, Command<Action>, Subscription<Action>[]]
  | [State, Command<Action>, Subscription<Action>];

export type Dispatch<Action> = (action: Action) => void;

export function useReducerWithCommands<State, Action>(
  reducer: Reducer<State, Action>,
  initialState: State,
  initialCommand?: Command<Action>
): [State, Dispatch<Action>] {
  const [state, setState] = useState<State>(initialState);
  const stateRef = useRef<State>(state);
  const actionQueueRef = useRef<Action[]>([]);
  const processingRef = useRef<boolean>(false);

  function dispatch(action: Action) {
    actionQueueRef.current.push(action);
    if (!processingRef.current) {
      processQueue();
    }
  }

  function processQueue() {
    if (processingRef.current) return;
    processingRef.current = true;

    while (actionQueueRef.current.length > 0) {
      const action = actionQueueRef.current.shift()!;
      const result = reducer(stateRef.current, action);

      const newState: State = match(result)
        .when(Array.isArray, (result) => result[0])
        .otherwise((result) => result);
      let commands: Command<Action>[] = [];
      let subscriptions: Subscription<Action>[] = [];

      if (Array.isArray(result)) {
        if (result.length === 2) {
          const second = result[1];

          if (typeof second === "function") {
            if (isCommand(second)) {
              commands = [second];
            } else if (isSubscription(second)) {
              subscriptions = [second];
            }
          } else if (Array.isArray(second)) {
            if (areAllCommands(second)) {
              commands = second;
            } else if (areAllSubscriptions(second)) {
              subscriptions = second;
            }
          }
        } else if (result.length >= 3) {
          const second = result[1];
          const third = result[2];

          if (Array.isArray(second)) {
            // [State, Command<Action>[], Subscription<Action> | Subscription<Action>[]]
            commands = second;
          } else {
            commands = [second];
          }
          if (Array.isArray(third)) {
            subscriptions = third;
          } else {
            subscriptions = [third];
          }
        }
      }

      stateRef.current = newState;
      setState(newState);

      if (commands.length > 0) {
        for (const command of commands) {
          runCommand(command);
        }
      }

      if (subscriptions.length > 0) {
        for (const subscription of subscriptions) {
          subscription(dispatch);
        }
      }
    }

    processingRef.current = false;
  }

  const runCommand = useCallback(function runCommand(command: Command<Action>) {
    const result = command();
    if (result instanceof Promise) {
      result.then((nextAction) => {
        dispatch(nextAction);
      });
    } else {
      dispatch(result);
    }
  }, []);

  useEffect(() => {
    if (initialCommand) {
      runCommand(initialCommand);
    }
  }, []);

  return [state, dispatch];
}
