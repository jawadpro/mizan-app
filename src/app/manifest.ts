import type { MetadataRoute } from "next";

/** Lets Mizan be added to the home screen and open full screen like an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Mizan",
    short_name: "Mizan",
    description: "Private expense tracking in PKR, with MCB SMS import.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f1e7",
    theme_color: "#f6f1e7",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
