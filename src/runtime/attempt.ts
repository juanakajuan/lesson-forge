const brand = Symbol("attempt");

const HINT_AFTER_MISSES = 1;
const ATTEMPTS_BEFORE_REVEAL = 2;

type Open = {
  readonly phase: "open";
  readonly hasHint: boolean;
  readonly misses: number;
  readonly hintShown: boolean;
};

type Done = {
  readonly phase: "done";
  readonly firstTry: boolean;
  readonly answer: string | null;
};

type Data = Open | Done;

export type Attempt = { readonly [brand]: Data };

export type AttemptEvent =
  | { readonly type: "graded"; readonly correct: boolean }
  | { readonly type: "hint" }
  | { readonly type: "reveal"; readonly answer: string };

export type AttemptOutcome =
  | { readonly kind: "met"; readonly firstTry: boolean }
  | { readonly kind: "revealed"; readonly answer: string };

export type Offers = {
  readonly hint: boolean;
  readonly reveal: boolean;
  readonly submitLabel: "Check" | "Check again";
};

function make(data: Data): Attempt {
  return { [brand]: data };
}

function read(state: Attempt): Data {
  return state[brand];
}

export function start(hasHint: boolean): Attempt {
  return make({ phase: "open", hasHint, misses: 0, hintShown: false });
}

function buttons(data: Open): { hint: boolean; reveal: boolean } {
  return {
    hint: data.hasHint && !data.hintShown && data.misses >= HINT_AFTER_MISSES,
    reveal: data.misses >= ATTEMPTS_BEFORE_REVEAL,
  };
}

function awardsSolid(data: Open): boolean {
  return data.misses === 0 && !data.hintShown;
}

export function step(state: Attempt, event: AttemptEvent): Attempt {
  const data = read(state);
  if (data.phase === "done") return state;
  switch (event.type) {
    case "graded": {
      if (!event.correct) return make({ ...data, misses: data.misses + 1 });
      return make({ phase: "done", firstTry: awardsSolid(data), answer: null });
    }
    case "hint":
      if (!buttons(data).hint) return state;
      return make({ ...data, hintShown: true });
    case "reveal":
      if (!buttons(data).reveal) return state;
      return make({ phase: "done", firstTry: false, answer: event.answer });
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function offers(state: Attempt): Offers | null {
  const data = read(state);
  if (data.phase === "done") return null;
  const open = buttons(data);
  return { hint: open.hint, reveal: open.reveal, submitLabel: data.misses === 0 ? "Check" : "Check again" };
}

export function outcome(state: Attempt): AttemptOutcome | null {
  const data = read(state);
  if (data.phase === "open") return null;
  if (data.answer !== null) return { kind: "revealed", answer: data.answer };
  return { kind: "met", firstTry: data.firstTry };
}
