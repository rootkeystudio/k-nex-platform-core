import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Alert, Avatar, Badge, Box, Card, Container, EmptyState, ErrorState, File, Footer,
  Grid, Header, Heading, Hero, Icon, Image, Inline, Link, List, Progress, ProgressBar, ProgressIndicator, Quote,
  Section, Separator, Skeleton, Spinner, Stack, Status, Text, Video, VisuallyHidden
} from "../src/index.js";

describe("foundation, content, and feedback components", () => {
  it("renders the complete P7.2 family with semantic roots", () => {
    const markup = renderToStaticMarkup(<Stack>
      <Box><Container><Inline><Text>Text</Text><Badge>Badge</Badge></Inline></Container></Box>
      <Grid><Card><Heading level={1}>Heading</Heading></Card></Grid>
      <Section label="Summary"><List><li>One</li></List></Section><Link href="/details">Details</Link>
      <Icon label="Approved">✓</Icon><Image src="/image.png" alt="Example" /><Avatar src="/avatar.png" alt="Ada" fallback="A" />
      <Alert title="Notice">Updated</Alert><Status>Saved</Status><Separator /><Skeleton label="Loading" /><Spinner label="Saving" />
      <Progress label="Upload" value={50} /><ProgressBar label="Import" value={25} /><ProgressIndicator label="Processing" /><EmptyState title="Empty" /><ErrorState title="Failed" /><VisuallyHidden>Screen reader text</VisuallyHidden>
      <Header>Header</Header><Footer>Footer</Footer><Hero title={<h2>Hero</h2>}>Lead</Hero><Quote citation="Ada">Words</Quote>
      <File href="/report.pdf" name="Report" download /><Video src="/demo.mp4" label="Demo" captions="/demo.vtt" />
    </Stack>);
    for (const id of ["section", "list", "icon", "image", "avatar", "alert", "separator", "spinner", "progress", "progress-bar", "progress-indicator", "visually-hidden", "header", "footer", "hero", "quote", "file", "video"]) expect(markup).toContain(`data-k-nex-component="${id}"`);
    expect(markup).toContain("<header");
    expect(markup).toContain("<footer");
    expect(markup).toContain("<blockquote");
    expect(markup).toContain("<progress");
    expect(markup).toContain('kind="captions"');
  });

  it("keeps decorative icons hidden and critical alerts assertive", () => {
    const markup = renderToStaticMarkup(<><Icon>•</Icon><Alert tone="critical">Failure</Alert><Progress label="Working" /></>);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('data-state="pending"');
  });
});
