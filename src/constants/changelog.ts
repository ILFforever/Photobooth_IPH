import { Sparkles, Monitor } from "lucide-react";
import type { FeaturedItem } from "../components/Modals/system/ChangelogModal";

export const FEATURED_BY_VERSION: Record<string, FeaturedItem[]> = {
  '1.7.4': [
    {
      icon: Sparkles,
      label: 'New Feature',
      title: "What's New Panel",
      description: 'See release highlights and new features each time the app updates.',
    },
  ],
  '1.8.0': [
    {
      icon: Monitor,
      label: 'New Feature',
      title: 'Guest Display Editor',
      description: 'Design the second screen layout with a canvas editor — position the collage, QR code, text, and graphics.',
    },
  ],
};
