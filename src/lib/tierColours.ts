// Tier colour scheme for the league ladder, matching Personal CEO.
//
// `id` and `rank` match the `tiers` table (1 = Intern, 10 = Elite). `displayNumber` is what users
// see in the UI (1 = Elite, 10 = Intern), so always show the number and name next to the colour
// for colour-blind accessibility.

export type TierColour = {
  id: number; // matches tiers.id in the database
  name: string;
  displayNumber: number; // top-down number shown to users
  colour: string; // main hex colour
  gradient?: [string, string]; // metallic tiers only (top four)
  metallic: boolean;
  /** Text colour that reads clearly on top of the badge */
  ink: string;
};

export const TIER_COLOURS: TierColour[] = [
  { id: 1, name: "Intern", displayNumber: 10, colour: "#8A929C", metallic: false, ink: "#ffffff" },
  { id: 2, name: "Junior Analyst", displayNumber: 9, colour: "#8FB59A", metallic: false, ink: "#14281a" },
  { id: 3, name: "Analyst", displayNumber: 8, colour: "#3FA356", metallic: false, ink: "#ffffff" },
  { id: 4, name: "Senior Analyst", displayNumber: 7, colour: "#1FA3A3", metallic: false, ink: "#ffffff" },
  { id: 5, name: "Financial Controller", displayNumber: 6, colour: "#2F5FD0", metallic: false, ink: "#ffffff" },
  { id: 6, name: "Finance Director", displayNumber: 5, colour: "#6D3FC0", metallic: false, ink: "#ffffff" },
  { id: 7, name: "CFO", displayNumber: 4, colour: "#CD7F32", gradient: ["#E3A869", "#A8641F"], metallic: true, ink: "#ffffff" },
  { id: 8, name: "Chairman", displayNumber: 3, colour: "#C0C0C0", gradient: ["#E8E8E8", "#9A9A9A"], metallic: true, ink: "#2b2b2b" },
  { id: 9, name: "Board of Directors", displayNumber: 2, colour: "#D4AF37", gradient: ["#F2D56B", "#B8922A"], metallic: true, ink: "#3a2c00" },
  { id: 10, name: "Elite", displayNumber: 1, colour: "#B9F2FF", gradient: ["#B9F2FF", "#FFFFFF"], metallic: true, ink: "#0b4a5a" },
];

/** Look up a tier's colour info by its database id. */
export function getTierColour(tierId: number): TierColour {
  const tier = TIER_COLOURS.find((t) => t.id === tierId);
  if (!tier) throw new Error(`Unknown tier id: ${tierId}`);
  return tier;
}

/** CSS background value for a tier badge: gradient for metallic tiers, flat colour for the rest. */
export function getTierBackground(tierId: number): string {
  const tier = getTierColour(tierId);
  return tier.gradient ? `linear-gradient(135deg, ${tier.gradient[0]}, ${tier.gradient[1]})` : tier.colour;
}

/** SVG paint for a tier: a reference to its gradient (see <TierGradients />) or its flat colour. */
export function getTierFill(tierId: number): string {
  const tier = getTierColour(tierId);
  return tier.gradient ? `url(#tier-gradient-${tier.id})` : tier.colour;
}
