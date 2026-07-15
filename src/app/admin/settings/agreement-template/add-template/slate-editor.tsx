"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createEditor, Descendant, Editor } from "slate";
import { Slate, Editable, withReact, RenderLeafProps } from "slate-react";
import { withHistory } from "slate-history";
import { Bold, Italic, Underline } from "lucide-react";
import { Button } from "@/components/ui/button";

type ParagraphElement = {
  type: "paragraph";
  children: {
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
  }[];
};

const emptyValue: Descendant[] = [
  { type: "paragraph", children: [{ text: "" }] } as ParagraphElement,
];

function htmlOrTextToPlainText(input: string): string {
  if (!input) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, "text/html");
    return doc.body.textContent?.replace(/\r\n/g, "\n").trim() || "";
  } catch (e) {
    const withNewlines = input
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h\d)>/gi, "\n");
    const stripped = withNewlines.replace(/<[^>]+>/g, "");
    return stripped
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }
}

function plainTextToSlateValue(text: string): Descendant[] {
  const normalized = (text || "").replace(/\r\n/g, "\n");
  if (!normalized) return emptyValue;

  const lines = normalized.split("\n");
  return lines.map(
    (line) =>
      ({ type: "paragraph", children: [{ text: line }] } as ParagraphElement),
  );
}

function htmlToSlateValue(html: string): Descendant[] {
  if (!html) return emptyValue;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const blocks: Descendant[] = [];

    const nodeToInlines = (node: any): any[] => {
      const results: any[] = [];
      (node.childNodes || []).forEach((child: any) => {
        const nodeType = child.nodeType;
        const TEXT_NODE = (globalThis as any).Node.TEXT_NODE;
        const ELEMENT_NODE = (globalThis as any).Node.ELEMENT_NODE;
        if (nodeType === TEXT_NODE) {
          results.push({ text: child.textContent || "" });
        } else if (nodeType === ELEMENT_NODE) {
          const el = child as Element;
          const tag = el.tagName.toLowerCase();
          if (tag === "br") {
            results.push({ text: "\n" });
          } else if (tag === "strong" || tag === "b") {
            nodeToInlines(child).forEach((r) =>
              results.push({ ...r, bold: true }),
            );
          } else if (tag === "em" || tag === "i") {
            nodeToInlines(child).forEach((r) =>
              results.push({ ...r, italic: true }),
            );
          } else if (tag === "u") {
            nodeToInlines(child).forEach((r) =>
              results.push({ ...r, underline: true }),
            );
          } else {
            nodeToInlines(child).forEach((r) => results.push(r));
          }
        }
      });
      return results;
    };

    (doc.body.childNodes || []).forEach((child: any) => {
      const ELEMENT_NODE = (globalThis as any).Node.ELEMENT_NODE;
      const TEXT_NODE = (globalThis as any).Node.TEXT_NODE;
      if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        if (tag === "p" || tag === "div" || tag.match(/^h[1-6]$/)) {
          const inlines = nodeToInlines(child).map((n) => ({
            text: n.text || "",
            bold: n.bold,
            italic: n.italic,
            underline: n.underline,
          }));
          blocks.push({
            type: "paragraph",
            children: inlines.length ? inlines : [{ text: "" }],
          } as ParagraphElement);
        } else {
          const inlines = nodeToInlines(child);
          blocks.push({
            type: "paragraph",
            children: inlines.length ? inlines : [{ text: "" }],
          } as ParagraphElement);
        }
      } else if (child.nodeType === TEXT_NODE) {
        const txt = (child.textContent || "").trim();
        if (txt)
          blocks.push({
            type: "paragraph",
            children: [{ text: txt }],
          } as ParagraphElement);
      }
    });

    return blocks.length ? blocks : emptyValue;
  } catch (e) {
    return plainTextToSlateValue(htmlOrTextToPlainText(html));
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slateValueToHtml(value: Descendant[]): string {
  return value
    .map((n) => {
      const paragraph = n as any;
      const children = paragraph.children || [];
      const inner = children
        .map((leaf: any) => {
          let t = escapeHtml(leaf.text || "");
          if (leaf.bold) t = `<strong>${t}</strong>`;
          if (leaf.italic) t = `<em>${t}</em>`;
          if (leaf.underline) t = `<u>${t}</u>`;
          return t;
        })
        .join("");
      return inner.length === 0 ? "<p><br/></p>" : `<p>${inner}</p>`;
    })
    .join("");
}

export function stripHtmlToTextLength(input: string): number {
  return htmlOrTextToPlainText(input).trim().length;
}

export function AgreementTemplateSlateEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
}) {
  const editor = useMemo(() => withHistory(withReact(createEditor())), []);
  const [internalValue, setInternalValue] = useState<Descendant[]>(() =>
    value && value.includes("<")
      ? htmlToSlateValue(value)
      : plainTextToSlateValue(htmlOrTextToPlainText(value)),
  );

  useEffect(() => {
    setInternalValue(
      value && value.includes("<")
        ? htmlToSlateValue(value)
        : plainTextToSlateValue(htmlOrTextToPlainText(value)),
    );
    // Only when external string changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const renderElement = useCallback((props: any) => {
    const { attributes, children } = props;
    return <p {...attributes}>{children}</p>;
  }, []);

  const renderLeaf = useCallback((props: RenderLeafProps) => {
    const { attributes, children, leaf } = props;
    let el = <>{children}</>;
    if ((leaf as any).bold) el = <strong>{el}</strong>;
    if ((leaf as any).italic) el = <em>{el}</em>;
    if ((leaf as any).underline) el = <u>{el}</u>;
    return <span {...attributes}>{el}</span>;
  }, []);

  // When toolbar buttons are clicked we want to avoid triggering the
  // external `onChange` (which saves the template). Use a ref to suppress
  // the next onChange call coming from Slate after we programmatically
  // toggle a mark.
  const suppressOnChangeRef = useRef(false);

  const isMarkActive = (ed: Editor, format: string) => {
    const marks = Editor.marks(ed) as any;
    return marks ? marks[format] === true : false;
  };

  const toggleMark = (format: string) => {
    if (!editor) return;
    // Suppress external save/onChange for a short window to cover multiple
    // onChange calls emitted when toggling marks or during selection restores.
    suppressOnChangeRef.current = true;
    setTimeout(() => {
      suppressOnChangeRef.current = false;
    }, 250);

    const isActive = isMarkActive(editor, format);
    if (isActive) {
      Editor.removeMark(editor, format);
    } else {
      Editor.addMark(editor, format, true);
    }
    Editor.focus(editor);
  };

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="mb-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark("bold");
          }}
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark("italic");
          }}
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onMouseDown={(e) => {
            e.preventDefault();
            toggleMark("underline");
          }}
        >
          <Underline className="h-4 w-4" />
        </Button>
      </div>
      <Slate
        editor={editor}
        initialValue={internalValue}
        onChange={(next: Descendant[]) => {
          setInternalValue(next);
          if (suppressOnChangeRef.current) {
            // consume suppression once and do not call external onChange
            suppressOnChangeRef.current = false;
            return;
          }
          onChange(slateValueToHtml(next));
        }}
      >
        <Editable
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          placeholder={placeholder}
          className="agreement-slate-editable min-h-[300px] whitespace-pre-wrap focus:outline-none"
          spellCheck
        />
      </Slate>
    </div>
  );
}
