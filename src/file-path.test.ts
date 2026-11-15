import { describe, expect, it } from "vitest";
import { directoryName, formatImageMarkdown, relativePathWithin, resolveImagePath } from "./file-path";

describe("local image path resolution", () => {
  it("resolves relative paths against the document and decodes once", () => {
    expect(resolveImagePath("images/a%20b.png", "/docs/note.md", "")).toBe("/docs/images/a b.png");
    expect(resolveImagePath("images/a%2520b.png", "/docs/note.md", "")).toBe("/docs/images/a%20b.png");
    expect(resolveImagePath("../图 片/(最终).png", "/docs/note.md", "")).toBe("/docs/../图 片/(最终).png");
  });

  it("uses the default folder for untitled documents", () => {
    expect(resolveImagePath("images/a.png", null, "/default")).toBe("/default/images/a.png");
  });

  it("keeps absolute local paths absolute", () => {
    expect(resolveImagePath("/tmp/a%20b.png", "/docs/note.md", "")).toBe("/tmp/a b.png");
    expect(resolveImagePath("~/图片/a.png", "/docs/note.md", "")).toBe("~/图片/a.png");
  });

  it("supports Windows drive and UNC document paths", () => {
    expect(resolveImagePath("images\\a.png", "C:\\docs\\note.md", "")).toBe("C:\\docs\\images\\a.png");
    expect(resolveImagePath("C:\\images\\a.png", "C:\\docs\\note.md", "")).toBe("C:\\images\\a.png");
    expect(resolveImagePath("images\\a.png", "\\\\server\\share\\note.md", "")).toBe("\\\\server\\share\\images\\a.png");
  });

  it("supports file URLs without treating plus as space", () => {
    expect(resolveImagePath("file:///Users/me/My%20File.png", null, "")).toBe("/Users/me/My File.png");
    expect(resolveImagePath("file:///C:/Users/me/a.png", null, "")).toBe("C:/Users/me/a.png");
    expect(resolveImagePath("a+b.png", "/docs/note.md", "")).toBe("/docs/a+b.png");
  });

  it("leaves remote, data, and existing custom protocol images alone", () => {
    expect(resolveImagePath("https://example.com/a%20b.png", "/docs/note.md", "")).toBeNull();
    expect(resolveImagePath("http://lightmd.localhost/C%3A%5Ca.png", "/docs/note.md", "")).toBeNull();
    expect(resolveImagePath("data:image/png;base64,AA%20BB", "/docs/note.md", "")).toBeNull();
    expect(resolveImagePath("lightmd://localhost/%2Fa.png", "/docs/note.md", "")).toBeNull();
  });

  it("does not throw on malformed percent escapes", () => {
    expect(resolveImagePath("bad%zz.png", "/docs/note.md", "")).toBe("/docs/bad%zz.png");
  });
});

describe("document paths and inserted Markdown", () => {
  it("finds parent directories on supported path formats", () => {
    expect(directoryName("/docs/note.md")).toBe("/docs");
    expect(directoryName("/note.md")).toBe("/");
    expect(directoryName("C:\\docs\\note.md")).toBe("C:\\docs");
    expect(directoryName("C:\\note.md")).toBe("C:\\");
    expect(directoryName("note.md")).toBe("");
  });

  it("finds paths relative to their document directory", () => {
    expect(relativePathWithin("/docs/note.images/a.png", "/docs")).toBe("note.images/a.png");
    expect(relativePathWithin("/note.images/a.png", "/")).toBe("note.images/a.png");
    expect(relativePathWithin("C:\\docs\\note.images\\a.png", "C:\\docs")).toBe("note.images\\a.png");
    expect(relativePathWithin("/other/a.png", "/docs")).toBeNull();
  });

  it("emits an unambiguous angle-bracket destination and escaped alt text", () => {
    expect(formatImageMarkdown("My Doc.images/a(b).png", "a[b]")).toBe("![a\\[b\\]](<My Doc.images/a(b).png>)");
    expect(formatImageMarkdown("images/100%25.png", "100%")).toBe("![100%](<images/100%2525.png>)");
    expect(formatImageMarkdown("C:\\images\\a.png", "image")).toBe("![image](<C:%5Cimages%5Ca.png>)");
  });
});
