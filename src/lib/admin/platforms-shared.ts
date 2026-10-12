/** Las redes de Meta (publisher_platform), sin imports de servidor: lo usan el servidor y el navegador. */
export type PlatformKey = "facebook" | "instagram" | "messenger" | "audience_network" | "threads" | "whatsapp" | "unknown";
export type PlatformNums = { platform: PlatformKey; spend: number; purchases: number; value: number; impressions: number; linkClicks: number };
export const PLATFORM_LABEL: Record<PlatformKey, string> = {
  facebook: "Facebook", instagram: "Instagram", messenger: "Messenger", audience_network: "Audience Network",
  threads: "Threads", whatsapp: "WhatsApp", unknown: "Otras",
};
