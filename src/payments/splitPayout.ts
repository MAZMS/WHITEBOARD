export interface PayoutSplit {
  platformShare: number;
  creatorShare: number;
  affiliateShare: number;
}

export function calculateSplit(revenue: number, hasAffiliate: boolean): PayoutSplit {
  const platformShare = +(0.30 * revenue).toFixed(2);

  if (hasAffiliate) {
    const creatorShare = +(0.35 * revenue).toFixed(2);
    const affiliateShare = +(0.35 * revenue).toFixed(2);
    return { platformShare, creatorShare, affiliateShare };
  }

  return {
    platformShare,
    creatorShare: +(0.70 * revenue).toFixed(2),
    affiliateShare: 0,
  };
}
