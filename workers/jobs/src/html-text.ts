import { parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { IngestionError } from "./providers.ts";
// Inert HTML5 parsing: no scripts, resource fetching, DOM or HTML rendering.
export function htmlToPlainText(html: string): string {
  if (new TextEncoder().encode(html).byteLength > 200000)
    throw new IngestionError("description_bytes_limit");
  let root = parseFragment(html);
  // Greenhouse escapes the entire HTML content string once on some boards.
  if (
    root.childNodes.every(
      (n) => n.nodeName === "#text" || n.nodeName === "#comment",
    )
  ) {
    const decoded = root.childNodes
      .map((n) => ("value" in n ? n.value : ""))
      .join("");
    if (
      /<\/?(?:p|div|h[1-6]|ul|ol|li|br|strong|em|section|script|style)(?:\s|>|\/)/i.test(
        decoded,
      )
    )
      root = parseFragment(decoded);
  }
  const output: string[] = [],
    blocks = new Set([
      "p",
      "div",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "section",
      "article",
      "header",
      "footer",
      "blockquote",
      "pre",
      "tr",
    ]);
  const stack: Array<DefaultTreeAdapterTypes.Node | string> = [root];
  let visited = 0;
  while (stack.length) {
    if (++visited > 50000) throw new IngestionError("description_node_limit");
    const node = stack.pop()!;
    if (typeof node === "string") {
      output.push(node);
      continue;
    }
    if (node.nodeName === "#text" && "value" in node) {
      output.push(node.value);
      continue;
    }
    if ("tagName" in node) {
      if (["script", "style", "template", "noscript"].includes(node.tagName))
        continue;
      if (node.tagName === "br") {
        output.push("\n");
        continue;
      }
      if (blocks.has(node.tagName)) {
        output.push("\n");
        stack.push("\n");
      }
      if (node.tagName === "li") output.push("• ");
      if (node.tagName === "td" || node.tagName === "th") stack.push("\t");
    }
    if ("childNodes" in node)
      for (let i = node.childNodes.length - 1; i >= 0; i--)
        stack.push(node.childNodes[i]);
  }
  return output
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t \u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
