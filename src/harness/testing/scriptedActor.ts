import { fromPromise } from "xstate";

/**
 * Builds a fromPromise XState actor that pops scripted outputs from a queue
 * per call, in order. Throws on exhaustion — prefer the loud failure to silent
 * wrap-around, which would mask off-by-one bugs in test scripts.
 *
 * Use when the test only needs to control what the actor returns. If you also
 * need to observe what the machine passed in, use capturingScripted().
 */
export function scripted<TOut>(outputs: TOut[]) {
  const queue = [...outputs];
  return fromPromise<TOut, any>(async () => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("scripted actor: script exhausted");
    }
    return next;
  });
}

/**
 * Variant of scripted() that also records each input on calls[]. Used for
 * tests asserting both "what did the machine pass in" and "return the next
 * canned result" — e.g. retry/session-propagation assertions where the
 * resumeSessionId threaded by the machine is the quantity under test.
 *
 * calls[] is append-only; the actor does not expose a reset. One mock per
 * test — if the suite reuses the actor across cases, shape drift across
 * tests gets masked.
 */
export function capturingScripted<TOut>(outputs: TOut[]) {
  const queue = [...outputs];
  const calls: any[] = [];
  const actor = fromPromise<TOut, any>(async ({ input }) => {
    calls.push({ ...input });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("capturingScripted: script exhausted");
    }
    return next;
  });
  return { actor, calls };
}
