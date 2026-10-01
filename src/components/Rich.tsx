import { Fragment, type ReactNode } from 'react';

/**
 * Render a translated sentence with markup inside it.
 *
 * `t()` can only interpolate strings, so a sentence that emphasises a value
 * used to be built from two translated halves: a leading `t()` call, the
 * marked-up value, then a trailing `t()` call that started with punctuation.
 * No translator can reorder that, and it reads as spliced English in Persian.
 *
 * This keeps one key for the whole sentence and splits the *translated* result
 * around its placeholders, so the translator decides where each value sits:
 *
 *   <Rich
 *     text={t(ONE_SENTENCE_WITH_A_PLACEHOLDER)}
 *     values={{ habit: <strong>{name}</strong>, direction: lift > 0 ? … : … }}
 *   />
 */
export function Rich({ text, values }: { text: string; values: Record<string, ReactNode> }): ReactNode {
  return (
    <>
      {text.split(/(\{\w+\})/).map((part, index) => {
        const placeholder = /^\{(\w+)\}$/.exec(part);
        const value = placeholder ? values[placeholder[1]] : undefined;
        // A missing placeholder renders as itself rather than vanishing: a
        // half-translated sentence should still be readable.
        return <Fragment key={index}>{value === undefined ? part : value}</Fragment>;
      })}
    </>
  );
}
