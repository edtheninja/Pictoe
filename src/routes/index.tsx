import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/editor/Editor";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pictoe — Canvas-first photo editor" },
      {
        name: "description",
        content:
          "Pictoe is a minimal, canvas-first photo editor with non-destructive light, colour and detail controls, crop, before/after and instant export.",
      },
      { property: "og:title", content: "Pictoe — Canvas-first photo editor" },
      {
        property: "og:description",
        content:
          "Edit photos with precise, non-destructive controls in a calm interface that gets out of your way.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <Editor />;
}
