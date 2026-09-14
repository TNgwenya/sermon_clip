import { Fragment } from "react";

export function ClipStudioCaptionWords({ words, activeIndex, wordClassName, activeClassName }: {
  words: string[];
  activeIndex: number;
  wordClassName: string;
  activeClassName: string;
}) {
  return words.map((word, index) => (
    <Fragment key={`${word}-${index}`}>
      {index > 0 ? " " : null}
      <span aria-hidden="true" className={[
        "clip-studio-live-caption-word", wordClassName,
        index === activeIndex ? `is-active ${activeClassName}` : "",
      ].filter(Boolean).join(" ")}>
        {word}
      </span>
    </Fragment>
  ));
}
