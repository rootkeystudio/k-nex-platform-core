import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataList, DescriptionList, File, Image, KeyValueList, Table, Video, VirtualList } from "../src/index.js";

describe("data and media presentation", () => {
  it("renders semantic lists, tables, and media through platform components", () => {
    const markup = renderToStaticMarkup(<>
      <DataList label="Results" items={[{ id: "one", label: "Name", value: "Ada" }]} />
      <KeyValueList label="Details" items={[{ id: "one", key: "Status", value: "Open" }]} />
      <DescriptionList label="Description" items={[{ id: "one", key: "Owner", value: "Ada" }]} />
      <Table label="Records" columns={[{ id: "name", label: "Name" }]} rows={[{ id: "one", cells: { name: "Ada" } }]} />
      <Image src="/image.png" alt="Image" /><File href="/file.pdf" name="File" /><Video src="/video.mp4" label="Video" />
    </>);
    for (const id of ["data-list", "key-value-list", "description-list", "table", "image", "file", "video"]) expect(markup).toContain(`data-k-nex-component="${id}"`);
    expect(markup).toContain("<dl");
    expect(markup).toContain("<table");
  });

  it("preserves list semantics in its server-estimated virtual viewport", () => {
    const markup = renderToStaticMarkup(<VirtualList label="Rows" items={["a", "b", "c", "d"]} getKey={(item) => item} renderItem={(item) => item} height={72} estimateSize={36} overscan={0} />);
    expect(markup).toContain('aria-rowcount="4"');
    expect(markup).toContain('aria-posinset="1"');
    expect(markup).toContain('aria-posinset="2"');
    expect(markup).not.toContain('aria-posinset="3"');
    expect(markup).not.toContain(">d<");
  });
});
