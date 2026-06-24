"use client";

import { useState } from "react";
import { HELP_SECTIONS } from "@/lib/help/content";

export function HelpClient() {
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0]?.id ?? "overview");
  const active = HELP_SECTIONS.find((s) => s.id === activeId) ?? HELP_SECTIONS[0];

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="shrink-0 lg:w-56">
        <ul className="space-y-1 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          {HELP_SECTIONS.map((section) => (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => setActiveId(section.id)}
                className={
                  activeId === section.id
                    ? "w-full rounded-lg bg-indigo-50 px-3 py-2 text-left text-sm font-medium text-indigo-700"
                    : "w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                }
              >
                {section.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{active?.title}</h3>
        <div className="prose prose-sm mt-4 max-w-none whitespace-pre-wrap text-slate-700">
          {active?.content}
        </div>
      </article>
    </div>
  );
}
