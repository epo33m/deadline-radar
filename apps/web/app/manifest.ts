import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Deadline Radar",
    short_name: "Radar",
    description:
      "Personal academic task tracker with tiered deadline reminders.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0088ff",
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
