"use client";

import { useState } from "react";
import { HELP_SECTIONS } from "@/lib/help/content";
import { cn } from "@/lib/cn";

export function HelpClient() {
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0]?.id ?? "overview");
  const active = HELP_SECTIONS.find((s) => s.id === activeId) ?? HELP_SECTIONS[0];

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="shrink-0 lg:w-56">
        <ul className="surface-card space-y-1 p-3">
          {HELP_SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => setActiveId(section.id)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm",
                  activeId === section.id
                    ? "bg-[#E8F1FA] font-medium text-[#1F4E79]"
                    : "text-[#172033] hover:bg-[#F7F9FC]",
                )}
              >
                {section.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article className="surface-card min-w-0 flex-1 p-6">
        <h3 className="text-lg font-semibold text-[#172033]">{active?.title}</h3>
        <div className="prose prose-sm mt-4 max-w-none whitespace-pre-wrap text-[#172033]">
          {active?.content}
        </div>
      </article>
    </div>
  );
}
