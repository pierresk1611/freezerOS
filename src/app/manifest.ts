import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FREEZER OS",
    short_name: "FREEZER OS",
    lang: "sk",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f6f1",
    theme_color: "#276746",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "any" },
    ],
  };
}
