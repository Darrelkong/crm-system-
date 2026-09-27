import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import type { TimelineItem } from "@/lib/customers/timeline/types";
let directory: string;
let render: (items: TimelineItem[]) => string;
const item: TimelineItem = {
    id: "synthetic-follow-up", type: "follow_up", titleKey: "record",
    descriptionKey: "summary", descriptionParams: { summary: "Saved summary" },
    nextAction: "Saved next action\nSecond line <script>not executable</script>",
    actorName: "Synthetic", occurredAt: "2026-01-01T00:00:00Z", metadata: {}, sensitive: false,
};
before(async () => {
    directory = await mkdtemp(join(tmpdir(), "crm-f1-timeline-render-"));
    const outfile = join(directory, "render.cjs");
    // Render the real component; substitute only the locale hook, not timeline markup.
    await build({
        stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
      import {CustomerTimelineView} from './src/components/customers/customer-timeline-view';
      export const render = items => renderToStaticMarkup(React.createElement(CustomerTimelineView, {items, accessLevel:'full'}));`,
            resolveDir: process.cwd(), loader: "tsx" },
        bundle: true, platform: "node", format: "cjs", outfile,
        plugins: [{ name: "test-locale", setup(builder) {
                    builder.onLoad({ filter: /use-customer-labels\.ts$/ }, () => ({ contents: `
        export const useCustomerLabels = () => ({
          t: (key, params) => key === 'followUps.nextAction' ? '下一步行动' : params?.summary ?? key,
          timelineType: x => x, followUpChannel: x => x, followUpOutcome: x => x,
          approvalType: x => x, completenessField: x => x
        });`, loader: "js" }));
                } }],
    });
    render = (await import(pathToFileURL(outfile).href)).render;
});
after(async () => { if (directory)
    await rm(directory, { recursive: true, force: true }); });
it("renders saved nextAction separately below summary, with escaped text and preserved lines", () => {
    const html = render([item]);
    assert.ok(html.indexOf("Saved summary") < html.indexOf("下一步行动"));
    assert.match(html, /Saved next action\nSecond line &lt;script&gt;/);
    assert.equal((html.match(/data-testid="timeline-next-action"/g) ?? []).length, 1);
    assert.match(html, /whitespace-pre-wrap break-words \[overflow-wrap:anywhere\]/);
});
it("historical null/blank nextAction renders without an empty action heading", () => {
    for (const nextAction of [null, undefined, "   "]) {
        const html = render([{ ...item, nextAction }]);
        assert.match(html, /Saved summary/);
        assert.doesNotMatch(html, /timeline-next-action|下一步行动/);
    }
});
it("masked follow-ups never render nextAction, even if a payload accidentally includes it", () => {
    assert.doesNotMatch(render([{ ...item, sensitive: true }]), /Saved next action|下一步行动/);
});
it("desktop and mobile use the same customer timeline data/component without breakpoint hiding", async () => {
    const page = await readFile("src/app/(dashboard)/customers/[id]/customer-detail-client.tsx", "utf8");
    const component = await readFile("src/components/customers/customer-timeline-view.tsx", "utf8");
    assert.match(page, /<CustomerTimelineView[\s\S]*?items=\{timelineItems\}/);
    const actionMarkup = component.slice(component.indexOf('item.type === "follow_up"'), component.indexOf('{item.descriptionText &&'));
    assert.doesNotMatch(actionMarkup, /(?:sm|md|lg):|\bhidden\b/);
    assert.match(actionMarkup, /min-w-0/);
});
