// Shared between SalesPipeline and DistributorScorecard so the two pages
// never drift apart on what counts as "open" or how confident each stage is.
export const OPEN_STAGES = ['Contract & Negotiation', 'PO & $$$'];

// Rough close-probability per stage, used for weighted-forecast figures.
// PO & $$$ is much closer to a real order than early Contract & Negotiation deals.
export const STAGE_WEIGHT = { 'Contract & Negotiation': 0.4, 'PO & $$$': 0.75 };
