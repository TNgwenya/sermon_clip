import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClipStudioCaptionWords } from "./clip-studio-caption-words";

describe("caption word spacing", () => {
  it("preserves real word separators when line clamping disables flex gaps", () => {
    const markup = renderToStaticMarkup(<ClipStudioCaptionWords words={["receive", "power", "when"]}
      activeIndex={1} wordClassName="word" activeClassName="active" />);
    expect(markup.replace(/<[^>]+>/g, "")).toBe("receive power when");
    expect(markup).toContain("</span> <span");
    expect(markup.match(/is-active/g)).toHaveLength(1);
  });
  it("keeps a single-word caption free of padding spaces", () => {
    const markup = renderToStaticMarkup(<ClipStudioCaptionWords words={["Faith"]}
      activeIndex={0} wordClassName="word" activeClassName="active" />);
    expect(markup.replace(/<[^>]+>/g, "")).toBe("Faith");
  });
});
